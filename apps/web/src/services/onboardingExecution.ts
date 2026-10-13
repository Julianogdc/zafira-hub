import { api } from '@/lib/api';
import type { AutomationOutboxStatus } from '@/services/automation';
import type {
  OnboardingCompletionCondition,
  OnboardingEvidenceKind,
  OnboardingStepKind,
} from '@zafira/contracts';

/**
 * F7-2b - Cliente da API de execucao do onboarding (DEC-F7-008/009).
 * Nunca devolve dados de demonstracao. A autorizacao real e do backend; `actions` e so orientacao da tela.
 */

export type ExecutionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type StepRunStatus = 'WAITING' | 'READY' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED' | 'CANCELLED';
export type StepActionKey = 'start' | 'complete' | 'block' | 'unblock' | 'skip' | 'reassign';
export type AssigneeIssue = 'UNASSIGNED' | 'INACTIVE_OR_OUT_OF_SCOPE' | null;

export interface ExecutionListItem {
  id: string;
  clientId: string;
  clientName: string;
  templateId: string;
  templateName: string;
  versionNumber: number;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  progress: { closed: number; total: number; percent: number };
  counts: { late: number; blocked: number; unassigned: number };
}

export interface CalendarCandidateView {
  id: string;
  title: string;
  masked: boolean;
  startAt: string | null;
  startDate: string | null;
  isAllDay: boolean;
  sourceName: string;
  eligible: boolean;
  reason: string | null;
}

export interface CalendarConditionView {
  state: 'MET' | 'PENDING' | 'UNAVAILABLE';
  reason: 'CONNECTION_UNAVAILABLE' | 'NO_MONITORED_CALENDAR' | 'NO_LINKED_EVENT' | null;
  candidates: CalendarCandidateView[];
  ineligible: CalendarCandidateView[];
}

/** F7-4b: estado da automacao de uma etapa AUTOMATION (nunca inclui segredo, assinatura ou payload). */
export interface AutomationStepView {
  flowKey: string | null;
  status: AutomationOutboxStatus | null;
  generation: number | null;
  attempts: number;
  sentAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  resultCode: string | null;
  resultMessage: string | null;
  externalRefs: { type: string; label: string; url: string }[];
  appliedAt: string | null;
  dispatcherEnabled: boolean;
  canResend: boolean;
}

export interface ExecutionStepView {
  stepKey: string;
  title: string;
  description: string | null;
  position: number;
  kind: OnboardingStepKind;
  status: StepRunStatus;
  blocked: boolean;
  blockedReason: string | null;
  blocksCompletion: boolean;
  completionCondition: OnboardingCompletionCondition;
  evidenceKind: OnboardingEvidenceKind;
  dependsOn: string[];
  assigneeMemberId: string | null;
  assigneeName: string | null;
  assigneeSource: string;
  assigneeIssue: AssigneeIssue;
  functionId: string | null;
  functionName: string | null;
  releasedAt: string | null;
  dueDate: string | null;
  late: boolean;
  startedAt: string | null;
  completedAt: string | null;
  evidenceLink: string | null;
  evidenceNote: string | null;
  asanaProjectGid: string | null;
  /** F7-3c: condicao do Calendar (so em etapas abertas) e instantaneo do evento usado (etapas concluidas). */
  calendarCondition: CalendarConditionView | null;
  calendarEvent: { id: string; title: string | null; startAt: string | null } | null;
  /** F7-4b */
  completedBySystem: boolean;
  automation: AutomationStepView | null;
  skipReason: string | null;
  actions: StepActionKey[];
}

export interface ExecutionEventView {
  id: string;
  type: string;
  stepKey: string | null;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface ExecutionDetail {
  id: string;
  clientId: string;
  clientName: string;
  templateId: string;
  templateName: string;
  versionId: string;
  versionNumber: number;
  status: ExecutionStatus;
  startTrigger: string;
  startedAt: string;
  completedAt: string | null;
  completionMode: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  progress: { closed: number; total: number; percent: number };
  counts: { late: number; blocked: number; unresolved: number };
  steps: ExecutionStepView[];
  events: ExecutionEventView[];
}

export interface ExecutionOverview {
  activeExecutions: number;
  lateSteps: number;
  blockedSteps: number;
  unassignedSteps: number;
  inactiveAssigneeSteps: number;
  completedLast30Days: number;
  openStepsByAssignee: { memberId: string; name: string | null; openSteps: number }[];
}

export interface MyStepItem {
  executionId: string;
  clientId: string;
  clientName: string;
  templateName: string;
  stepKey: string;
  title: string;
  status: StepRunStatus;
  blocked: boolean;
  dueDate: string | null;
  late: boolean;
}

export interface ExecutionFilters {
  status?: string;
  clientId?: string;
  templateId?: string;
  assigneeId?: string;
  late?: boolean;
  blocked?: boolean;
}

const base = '/onboarding';
const enc = encodeURIComponent;

export const onboardingExecutionService = {
  list(filters: ExecutionFilters = {}) {
    const p = new URLSearchParams();
    if (filters.status) p.set('status', filters.status);
    if (filters.clientId) p.set('clientId', filters.clientId);
    if (filters.templateId) p.set('templateId', filters.templateId);
    if (filters.assigneeId) p.set('assigneeId', filters.assigneeId);
    if (filters.late) p.set('late', 'true');
    if (filters.blocked) p.set('blocked', 'true');
    const qs = p.toString();
    return api.get<ExecutionListItem[]>(`${base}/executions${qs ? `?${qs}` : ''}`);
  },
  overview: () => api.get<ExecutionOverview>(`${base}/overview`),
  mySteps: () => api.get<MyStepItem[]>(`${base}/my-steps`),
  get: (id: string) => api.get<ExecutionDetail>(`${base}/executions/${enc(id)}`),
  start: (clientId: string, templateId: string) =>
    api.post<ExecutionDetail>(`${base}/executions`, { clientId, templateId }),
  cancel: (id: string, reason: string) => api.post<ExecutionDetail>(`${base}/executions/${enc(id)}/cancel`, { reason }),
  completeEarly: (id: string, reason?: string) =>
    api.post<ExecutionDetail>(`${base}/executions/${enc(id)}/complete`, reason ? { reason } : {}),
  stepAction: (id: string, stepKey: string, action: StepActionKey, body: Record<string, unknown> = {}) =>
    api.post<ExecutionDetail>(`${base}/executions/${enc(id)}/steps/${enc(stepKey)}/${action}`, body),
};

/** Erro da API com codigo e id da execucao existente (B2). */
export function executionErrorInfo(error: unknown): { status: number; code?: string; message: string; existingExecutionId?: string } {
  const e = error as { status?: number; message?: string; data?: { code?: string; existingExecutionId?: string } } | null;
  return {
    status: e?.status ?? 0,
    code: e?.data?.code,
    message: e?.message || 'Nao foi possivel concluir a operacao.',
    existingExecutionId: e?.data?.existingExecutionId,
  };
}
