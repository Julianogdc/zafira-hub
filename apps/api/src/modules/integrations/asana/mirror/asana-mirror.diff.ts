/**
 * F6-IMP.8 — Lógica pura do espelho do Asana (DEC-F6-003). Sem banco e sem rede.
 *
 * - normaliza a tarefa lida do Asana para os campos que o Hub guarda;
 * - compara com o último estado conhecido e devolve as mudanças relevantes;
 * - calcula os números do projeto (mesma regra de atraso usada em /projetos);
 * - define a data da foto diária no fuso de referência.
 */

import { DEFAULT_ORGANIZATION_TIMEZONE, isOverdueInTimeZone } from '@zafira/domain';

/** Fuso padrão (o espelho usa o fuso da organização; DEC-F6-005). */
export const MIRROR_TIMEZONE = DEFAULT_ORGANIZATION_TIMEZONE;
export const MIRROR_RETENTION_MONTHS = 13;

export interface MirrorTask {
  taskGid: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  dueAt: string | null;
  assigneeGid: string | null;
  assigneeName: string | null;
  sectionGid: string | null;
  sectionName: string | null;
  permalinkUrl: string | null;
}

export type MirrorChangeField = 'created' | 'restored' | 'removed' | 'completed' | 'due' | 'assignee' | 'section' | 'name';

export interface MirrorChange {
  taskGid: string;
  taskName: string;
  field: MirrorChangeField;
  before: unknown;
  after: unknown;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Converte a tarefa crua do Asana. A seção preferida é a do próprio projeto espelhado. */
export function normalizeAsanaTask(raw: any, projectGid: string): MirrorTask | null {
  const taskGid = str(raw?.gid);
  if (!taskGid) return null;
  const memberships: any[] = Array.isArray(raw?.memberships) ? raw.memberships : [];
  const membership =
    memberships.find((m) => m?.project?.gid === projectGid && m?.section?.gid) ??
    memberships.find((m) => m?.section?.gid) ??
    null;
  return {
    taskGid,
    name: str(raw?.name) ?? '(sem nome)',
    completed: raw?.completed === true,
    dueOn: str(raw?.due_on),
    dueAt: str(raw?.due_at),
    assigneeGid: str(raw?.assignee?.gid),
    assigneeName: str(raw?.assignee?.name),
    sectionGid: str(membership?.section?.gid),
    sectionName: str(membership?.section?.name),
    permalinkUrl: str(raw?.permalink_url),
  };
}

/** Tarefa atrasada no fuso da organização (regra única do domínio, igual à de /projetos). */
export function isTaskOverdue(
  task: Pick<MirrorTask, 'completed' | 'dueOn' | 'dueAt'>,
  now: Date,
  timeZone: string = MIRROR_TIMEZONE
): boolean {
  return isOverdueInTimeZone(task, timeZone, now);
}

export function computeProjectCounts(tasks: readonly MirrorTask[], now: Date, timeZone: string = MIRROR_TIMEZONE) {
  let completedTasks = 0;
  let pendingTasks = 0;
  let overdueTasks = 0;
  for (const task of tasks) {
    if (task.completed) completedTasks++;
    else {
      pendingTasks++;
      if (isTaskOverdue(task, now, timeZone)) overdueTasks++;
    }
  }
  return { totalTasks: tasks.length, completedTasks, pendingTasks, overdueTasks };
}

/** Data (YYYY-MM-DD) da foto diária no fuso de referência. */
export function snapshotDateFor(now: Date, timeZone = MIRROR_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Corte de retenção: tudo antes desta data/hora pode ser descartado. */
export function retentionCutoff(now: Date, months = MIRROR_RETENTION_MONTHS): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

export interface KnownTask extends MirrorTask {
  removed: boolean;
}

export interface MirrorDiff {
  /** Tarefas novas ou que voltaram (inserir / reativar). */
  added: MirrorTask[];
  /** Tarefas existentes cujo conteúdo mudou. */
  updated: MirrorTask[];
  /** taskGids que sumiram do projeto (marcar como removidas, nunca apagar). */
  removed: string[];
  /** Mudanças a registrar no histórico (vazio na primeira conferência). */
  changes: MirrorChange[];
}

/**
 * Compara o estado conhecido com o lido agora.
 * `recordChanges=false` na primeira conferência: o espelho é criado sem poluir o histórico.
 */
export function diffMirror(known: readonly KnownTask[], fetched: readonly MirrorTask[], recordChanges: boolean): MirrorDiff {
  const byGid = new Map(known.map((t) => [t.taskGid, t]));
  const fetchedGids = new Set<string>();
  const result: MirrorDiff = { added: [], updated: [], removed: [], changes: [] };
  const push = (change: MirrorChange) => {
    if (recordChanges) result.changes.push(change);
  };

  for (const task of fetched) {
    if (fetchedGids.has(task.taskGid)) continue; // proteção contra duplicata na paginação
    fetchedGids.add(task.taskGid);
    const previous = byGid.get(task.taskGid);

    if (!previous || previous.removed) {
      result.added.push(task);
      push({
        taskGid: task.taskGid,
        taskName: task.name,
        field: previous ? 'restored' : 'created',
        before: null,
        after: { completed: task.completed, dueOn: task.dueOn, assigneeName: task.assigneeName, sectionName: task.sectionName },
      });
      continue;
    }

    let changed = false;
    if (previous.completed !== task.completed) {
      changed = true;
      push({ taskGid: task.taskGid, taskName: task.name, field: 'completed', before: previous.completed, after: task.completed });
    }
    if (previous.dueOn !== task.dueOn || previous.dueAt !== task.dueAt) {
      changed = true;
      push({
        taskGid: task.taskGid,
        taskName: task.name,
        field: 'due',
        before: { dueOn: previous.dueOn, dueAt: previous.dueAt },
        after: { dueOn: task.dueOn, dueAt: task.dueAt },
      });
    }
    if (previous.assigneeGid !== task.assigneeGid) {
      changed = true;
      push({
        taskGid: task.taskGid,
        taskName: task.name,
        field: 'assignee',
        before: { gid: previous.assigneeGid, name: previous.assigneeName },
        after: { gid: task.assigneeGid, name: task.assigneeName },
      });
    }
    if (previous.sectionGid !== task.sectionGid) {
      changed = true;
      push({
        taskGid: task.taskGid,
        taskName: task.name,
        field: 'section',
        before: { gid: previous.sectionGid, name: previous.sectionName },
        after: { gid: task.sectionGid, name: task.sectionName },
      });
    }
    if (previous.name !== task.name) {
      changed = true;
      push({ taskGid: task.taskGid, taskName: task.name, field: 'name', before: previous.name, after: task.name });
    }
    // Mudanças só de exibição (nome do responsável/seção, link) atualizam o espelho sem virar histórico.
    if (
      !changed &&
      (previous.assigneeName !== task.assigneeName ||
        previous.sectionName !== task.sectionName ||
        previous.permalinkUrl !== task.permalinkUrl)
    ) {
      changed = true;
    }
    if (changed) result.updated.push(task);
  }

  for (const task of known) {
    if (!task.removed && !fetchedGids.has(task.taskGid)) {
      result.removed.push(task.taskGid);
      push({ taskGid: task.taskGid, taskName: task.name, field: 'removed', before: { completed: task.completed }, after: null });
    }
  }
  return result;
}
