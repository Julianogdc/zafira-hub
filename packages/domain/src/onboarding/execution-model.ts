import type {
  OnboardingAssigneeSource,
  OnboardingCompletionCondition,
  OnboardingStepRunStatus,
  OnboardingStepInput,
} from '@zafira/contracts';
import { addBusinessDays } from './onboarding-model.js';
import { dateInTimeZone, todayInTimeZone } from '../time/organization-time.js';

/* ==========================================================================
   F7-2a - Regras da EXECUCAO do onboarding (DEC-F7-008). Funcoes puras.
   ========================================================================== */

export const OPEN_STEP_STATUSES: readonly OnboardingStepRunStatus[] = ['WAITING', 'READY', 'IN_PROGRESS'];
export const CLOSED_STEP_STATUSES: readonly OnboardingStepRunStatus[] = ['DONE', 'SKIPPED', 'CANCELLED'];
/** Satisfazem dependencias e contam como encerradas com sucesso. */
const SATISFYING: readonly OnboardingStepRunStatus[] = ['DONE', 'SKIPPED'];

export const isOpenStep = (s: OnboardingStepRunStatus) => OPEN_STEP_STATUSES.includes(s);

export type StepDef = Pick<
  OnboardingStepInput,
  | 'stepKey'
  | 'dueBusinessDays'
  | 'dueAnchor'
  | 'dependsOn'
  | 'blocksCompletion'
  | 'completionCondition'
  | 'evidenceKind'
  | 'evidenceRequired'
  | 'assigneeMode'
  | 'functionId'
  | 'memberId'
  | 'kind'
>;

export interface StepRunState {
  stepKey: string;
  status: OnboardingStepRunStatus;
  blocked: boolean;
}

/* ------------------------------ prazos e liberacao ------------------------------ */

export interface PlannedStep {
  stepKey: string;
  status: 'READY' | 'WAITING';
  releasedAt: Date | null;
  dueDate: string | null;
}

/** Data (AAAA-MM-DD) do prazo a partir de uma ancora, em dias uteis no fuso da organizacao. */
export function computeDueDate(
  anchor: Date,
  days: number | null | undefined,
  timeZone: unknown,
  holidays: ReadonlySet<string> = new Set()
): string | null {
  if (days === null || days === undefined) return null;
  const day = dateInTimeZone(anchor, timeZone);
  if (!day) return null;
  return addBusinessDays(day, days, holidays);
}

/** Plano inicial: sem dependencia = READY (liberada agora); com dependencia = WAITING. */
export function planExecutionStart(
  steps: readonly StepDef[],
  opts: { startedAt: Date; timeZone: unknown; holidays?: ReadonlySet<string> }
): PlannedStep[] {
  return steps.map((s) => {
    const ready = s.dependsOn.length === 0;
    const releasedAt = ready ? opts.startedAt : null;
    // START: calculavel ja; RELEASED: so quando liberada.
    const anchor = s.dueAnchor === 'START' ? opts.startedAt : releasedAt;
    return {
      stepKey: s.stepKey,
      status: ready ? 'READY' : 'WAITING',
      releasedAt,
      dueDate: anchor ? computeDueDate(anchor, s.dueBusinessDays, opts.timeZone, opts.holidays) : null,
    };
  });
}

/** Etapas WAITING cujas dependencias estao todas DONE/SKIPPED. */
export function findReleasable(steps: readonly StepDef[], runs: readonly StepRunState[]): string[] {
  const status = new Map(runs.map((r) => [r.stepKey, r.status] as const));
  return steps
    .filter((s) => status.get(s.stepKey) === 'WAITING')
    .filter((s) => s.dependsOn.every((d) => SATISFYING.includes(status.get(d) as OnboardingStepRunStatus)))
    .map((s) => s.stepKey);
}

/** Atrasada = prazo anterior a hoje (fuso da organizacao) e etapa aberta. Indicador; nunca muda estado. */
export function isStepLate(
  run: { status: OnboardingStepRunStatus; dueDate: string | null },
  timeZone: unknown,
  now: Date = new Date()
): boolean {
  if (!run.dueDate || !isOpenStep(run.status)) return false;
  return run.dueDate < todayInTimeZone(timeZone, now);
}

export function progressOf(runs: readonly Pick<StepRunState, 'status'>[]) {
  const counted = runs.filter((r) => r.status !== 'CANCELLED');
  const closed = counted.filter((r) => SATISFYING.includes(r.status)).length;
  return { closed, total: counted.length, percent: counted.length === 0 ? 0 : Math.round((closed / counted.length) * 100) };
}

/* ------------------------------ responsaveis (P1/P2) ------------------------------ */

export interface AssigneeResolution {
  memberId: string | null;
  source: OnboardingAssigneeSource;
  /** Quando nao resolvido: motivo, para a interface mostrar o que precisa ser atribuido. */
  unresolved: null | 'NO_ASSIGNEE_CONFIGURED' | 'MEMBER_NOT_ELIGIBLE' | 'FUNCTION_NO_ELIGIBLE_MEMBER' | 'FUNCTION_MANY_CANDIDATES';
  candidates: string[];
}

/**
 * `eligible`: pessoas ATIVAS com o cliente na carteira (a execucao nunca amplia carteira - P1).
 * `functionMembers`: membros das funcoes (filtrados por `eligible` aqui).
 * `chosen`: escolha explicita do gestor para a etapa (precisa ser elegivel; senao e ignorada).
 */
export function resolveAssignee(
  step: Pick<StepDef, 'assigneeMode' | 'functionId' | 'memberId' | 'stepKey'>,
  ctx: { eligible: ReadonlySet<string>; functionMembers: ReadonlyMap<string, readonly string[]>; chosen?: string | null }
): AssigneeResolution {
  if (ctx.chosen && ctx.eligible.has(ctx.chosen)) {
    return { memberId: ctx.chosen, source: 'MANUAL', unresolved: null, candidates: [] };
  }
  if (step.assigneeMode === 'MEMBER' && step.memberId) {
    return ctx.eligible.has(step.memberId)
      ? { memberId: step.memberId, source: 'MODEL_MEMBER', unresolved: null, candidates: [] }
      : { memberId: null, source: 'NONE', unresolved: 'MEMBER_NOT_ELIGIBLE', candidates: [] };
  }
  if (step.assigneeMode === 'FUNCTION' && step.functionId) {
    const candidates = [...new Set(ctx.functionMembers.get(step.functionId) ?? [])].filter((m) => ctx.eligible.has(m)).sort();
    if (candidates.length === 1) return { memberId: candidates[0], source: 'FUNCTION_RESOLVED', unresolved: null, candidates };
    return {
      memberId: null,
      source: 'NONE',
      unresolved: candidates.length === 0 ? 'FUNCTION_NO_ELIGIBLE_MEMBER' : 'FUNCTION_MANY_CANDIDATES',
      candidates,
    };
  }
  return { memberId: null, source: 'NONE', unresolved: 'NO_ASSIGNEE_CONFIGURED', candidates: [] };
}

/**
 * Quem pode agir na etapa. P2: sem responsavel elegivel, so `override`.
 * `assigneeEligible` = responsavel atual ainda ativo e com o cliente na carteira.
 */
export function canActOnStep(input: {
  actorMemberId: string;
  hasExecute: boolean;
  hasOverride: boolean;
  assigneeMemberId: string | null;
  assigneeEligible: boolean;
}): boolean {
  if (input.hasOverride) return true;
  if (!input.hasExecute) return false;
  return Boolean(input.assigneeMemberId) && input.assigneeEligible && input.assigneeMemberId === input.actorMemberId;
}

/* ------------------------------ conclusao da etapa ------------------------------ */

export interface CompletionInput {
  confirm: boolean;
  calendarEventId?: string | null;
  evidenceLink?: string | null;
  evidenceNote?: string | null;
  asanaProjectGid?: string | null;
}

export type CompletionProblemCode = 'CONFIRMATION_REQUIRED' | 'EVIDENCE_REQUIRED' | 'ASANA_PROJECT_REQUIRED' | 'CALENDAR_EVENT_REQUIRED' | 'AUTOMATION_MANUAL_COMPLETION';
export interface CompletionProblem {
  code: CompletionProblemCode;
  message: string;
}

export function validateStepCompletion(
  def: Pick<StepDef, 'completionCondition' | 'evidenceKind' | 'evidenceRequired'>,
  input: CompletionInput
): CompletionProblem[] {
  const problems: CompletionProblem[] = [];
  const condition: OnboardingCompletionCondition = def.completionCondition;
  if (condition === 'AUTOMATION_SUCCEEDED') {
    // Nunca por acao manual: so o resultado SUCCEEDED autenticado de um pedido autorizado (F7-4a, D2/D4).
    problems.push({ code: 'AUTOMATION_MANUAL_COMPLETION', message: 'Esta etapa conclui somente pelo resultado da automacao. Reenvie ou dispense com justificativa.' });
    return problems;
  }
  if (condition === 'CALENDAR_EVENT_LINKED') {
    // A existencia e a elegibilidade do evento sao conferidas no servidor (dados locais); aqui so a escolha.
    if (!input.calendarEventId?.trim()) {
      problems.push({ code: 'CALENDAR_EVENT_REQUIRED', message: 'Escolha o evento do Calendar vinculado a este cliente.' });
    }
    return problems;
  }
  if (condition === 'ASANA_PROJECT_LINKED') {
    if (!input.asanaProjectGid?.trim()) {
      problems.push({ code: 'ASANA_PROJECT_REQUIRED', message: 'Escolha o projeto do Asana ja vinculado ao cliente.' });
    }
    return problems;
  }
  if (condition === 'EVIDENCE_PROVIDED') {
    const link = input.evidenceLink?.trim();
    const note = input.evidenceNote?.trim();
    const ok = def.evidenceKind === 'LINK' ? Boolean(link) : def.evidenceKind === 'NOTE' ? Boolean(note) : Boolean(link || note);
    if (!ok) {
      problems.push({
        code: 'EVIDENCE_REQUIRED',
        message: def.evidenceKind === 'LINK' ? 'Informe o link da evidencia.' : 'Informe a nota da evidencia.',
      });
    }
    return problems;
  }
  if (!input.confirm) problems.push({ code: 'CONFIRMATION_REQUIRED', message: 'Confirme a conclusao da etapa.' });
  return problems;
}

/* ------------------------------ conclusao do onboarding (P3) ------------------------------ */

export interface EarlyCompletionPlan {
  allowed: boolean;
  /** Etapas blocksCompletion ainda abertas (impedem a conclusao antecipada). */
  blockingOpen: string[];
  /** Demais etapas abertas: serao dispensadas explicitamente, na mesma transacao. */
  toSkip: string[];
}

export function planEarlyCompletion(
  steps: readonly Pick<StepDef, 'stepKey' | 'blocksCompletion'>[],
  runs: readonly StepRunState[]
): EarlyCompletionPlan {
  const status = new Map(runs.map((r) => [r.stepKey, r.status] as const));
  const open = steps.filter((s) => isOpenStep(status.get(s.stepKey) as OnboardingStepRunStatus));
  const blockingOpen = open.filter((s) => s.blocksCompletion).map((s) => s.stepKey);
  return {
    allowed: blockingOpen.length === 0,
    blockingOpen,
    toSkip: open.filter((s) => !s.blocksCompletion).map((s) => s.stepKey),
  };
}

/** Conclusao automatica: todas as etapas DONE ou SKIPPED (nenhuma aberta, nenhuma cancelada). */
export function isAutoCompletable(runs: readonly Pick<StepRunState, 'status'>[]): boolean {
  return runs.length > 0 && runs.every((r) => SATISFYING.includes(r.status));
}

/* ------------------------------ transicoes ------------------------------ */

export type StepAction = 'start' | 'complete' | 'block' | 'unblock' | 'skip' | 'reassign';

/** Acoes de ESTADO permitidas (a autorizacao e decidida a parte). */
export function allowedStepActions(run: StepRunState, opts: { automatic?: boolean } = {}): StepAction[] {
  if (!isOpenStep(run.status)) return [];
  if (opts.automatic) {
    // etapa automatica: sem concluir/iniciar manualmente; so bloquear, dispensar e reatribuir
    if (run.blocked) return ['unblock', 'skip', 'reassign'];
    return ['block', 'skip', 'reassign'];
  }
  if (run.blocked) return ['unblock', 'skip', 'reassign'];
  if (run.status === 'READY') return ['start', 'complete', 'block', 'skip', 'reassign'];
  if (run.status === 'IN_PROGRESS') return ['complete', 'block', 'skip', 'reassign'];
  return ['block', 'skip', 'reassign']; // WAITING: nao conclui, pode ser bloqueada/dispensada
}
