/**
 * F6-IMP.8 — Apresentação do histórico do Asana (DEC-F6-003). Funções puras, sem rede.
 * Ausência de dado nunca vira zero: dia sem foto fica sem ponto no gráfico.
 */

export interface AsanaSnapshotPoint {
  date: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  capturedAt: string;
}

export interface AsanaHistoryProject {
  projectGid: string;
  name: string;
  baselineAt: string | null;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastSyncStatus: 'SUCCESS' | 'FAILED' | 'NEVER';
  lastSyncError: string | null;
  snapshots: AsanaSnapshotPoint[];
}

export interface AsanaHistoryChange {
  id: string;
  projectGid: string;
  taskGid: string;
  taskName: string;
  field: string;
  before: unknown;
  after: unknown;
  detectedAt: string;
}

export interface AsanaHistoryResponse {
  clientId: string;
  days: number;
  generatedAt: string;
  projects: AsanaHistoryProject[];
  changes: AsanaHistoryChange[];
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** "20/10" a partir de YYYY-MM-DD (sem passar por fuso). */
export function formatDayMonth(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'sem data';
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value : fallback);

/** Frase curta para uma mudança detectada numa tarefa. */
export function describeAsanaChange(change: Pick<AsanaHistoryChange, 'field' | 'before' | 'after' | 'taskName'>): string {
  const before = obj(change.before);
  const after = obj(change.after);
  switch (change.field) {
    case 'created':
      return 'Tarefa criada no projeto';
    case 'restored':
      return 'Tarefa voltou ao projeto';
    case 'removed':
      return 'Tarefa saiu do projeto (ou foi apagada no Asana)';
    case 'completed':
      return change.after === true ? 'Marcada como concluída' : 'Reaberta (deixou de estar concluída)';
    case 'due':
      return `Prazo: ${formatDayMonth(before.dueOn as string)} → ${formatDayMonth(after.dueOn as string)}`;
    case 'assignee':
      return `Responsável: ${text(before.name, 'ninguém')} → ${text(after.name, 'ninguém')}`;
    case 'section':
      return `Seção: ${text(before.name, 'sem seção')} → ${text(after.name, 'sem seção')}`;
    case 'name':
      return `Renomeada (antes: "${text(change.before, '')}")`;
    default:
      return 'Alteração registrada';
  }
}

/** Frescor do espelho de um projeto, para exibir com cor. */
export function describeFreshness(project: Pick<AsanaHistoryProject, 'lastSyncStatus' | 'lastSyncedAt' | 'lastAttemptAt' | 'lastSyncError'>): {
  tone: 'ok' | 'error' | 'never';
  label: string;
  detail: string | null;
} {
  if (project.lastSyncStatus === 'NEVER' || (!project.lastSyncedAt && !project.lastAttemptAt)) {
    return { tone: 'never', label: 'Ainda não conferido', detail: 'A primeira conferência cria o ponto de partida do histórico.' };
  }
  if (project.lastSyncStatus === 'FAILED') {
    return {
      tone: 'error',
      label: project.lastAttemptAt ? `Falhou em ${formatDateTime(project.lastAttemptAt)}` : 'Última conferência falhou',
      detail: project.lastSyncedAt
        ? `Mostrando dados da última conferência boa (${formatDateTime(project.lastSyncedAt)}).${project.lastSyncError ? ` Motivo: ${project.lastSyncError}` : ''}`
        : project.lastSyncError,
    };
  }
  return { tone: 'ok', label: `Conferido em ${formatDateTime(project.lastSyncedAt as string)}`, detail: null };
}

/**
 * Pontos do gráfico (x de 0 a 1 ao longo do período, y no valor). Dias sem foto ficam de fora —
 * a linha liga só dias que existem, sem inventar zero.
 */
export function chartPoints(
  snapshots: readonly AsanaSnapshotPoint[],
  key: 'pendingTasks' | 'overdueTasks',
  periodStart: string,
  periodDays: number
): Array<{ x: number; y: number; date: string }> {
  const start = Date.parse(`${periodStart}T00:00:00Z`);
  const span = Math.max(1, periodDays - 1);
  return snapshots
    .map((s) => {
      const day = Math.round((Date.parse(`${s.date}T00:00:00Z`) - start) / 86_400_000);
      return { x: day / span, y: s[key], date: s.date };
    })
    .filter((p) => Number.isFinite(p.x) && p.x >= 0 && p.x <= 1);
}

/** Primeiro dia (YYYY-MM-DD) de uma janela de N dias terminando hoje (dia local do navegador). */
export function periodStartFor(days: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}
