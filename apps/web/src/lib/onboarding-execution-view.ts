import { automationEventLabel } from '@/lib/automation-view';
import type { AssigneeIssue, ExecutionStatus, ExecutionStepView, StepRunStatus } from '@/services/onboardingExecution';

/** F7-2b - Apresentacao pura da execucao do onboarding (sem React, sem rede). */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StepBadge {
  key: string;
  label: string;
  tone: BadgeTone;
}

const STATUS_LABEL: Record<StepRunStatus, { label: string; tone: BadgeTone }> = {
  WAITING: { label: 'Aguardando etapas anteriores', tone: 'neutral' },
  READY: { label: 'Pronta para iniciar', tone: 'info' },
  IN_PROGRESS: { label: 'Em andamento', tone: 'info' },
  DONE: { label: 'Concluída', tone: 'success' },
  SKIPPED: { label: 'Dispensada', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Em andamento', tone: 'info' },
  COMPLETED: { label: 'Concluído', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};

const OPEN: StepRunStatus[] = ['WAITING', 'READY', 'IN_PROGRESS'];
export const isOpenStatus = (s: StepRunStatus) => OPEN.includes(s);

/** Selos de uma etapa: situacao + bloqueada + atrasada + problema de responsavel. */
export function stepBadges(
  step: Pick<ExecutionStepView, 'status' | 'blocked' | 'late' | 'assigneeIssue'> & { automatic?: boolean }
): StepBadge[] {
  const base =
    step.automatic && (step.status === 'READY' || step.status === 'IN_PROGRESS')
      ? { label: 'Em automação', tone: 'info' as BadgeTone }
      : STATUS_LABEL[step.status];
  const badges: StepBadge[] = [{ key: 'status', label: base.label, tone: base.tone }];
  if (step.blocked && isOpenStatus(step.status)) badges.push({ key: 'blocked', label: 'Bloqueada', tone: 'danger' });
  if (step.late) badges.push({ key: 'late', label: 'Atrasada', tone: 'warning' });
  if (step.assigneeIssue === 'UNASSIGNED') badges.push({ key: 'unassigned', label: 'Sem responsável', tone: 'warning' });
  if (step.assigneeIssue === 'INACTIVE_OR_OUT_OF_SCOPE') badges.push({ key: 'inactive', label: 'Responsável indisponível', tone: 'warning' });
  return badges;
}

/** Explica por que a etapa precisa de atencao no responsavel (mensagem compreensivel). */
export function assigneeIssueMessage(issue: AssigneeIssue): string | null {
  if (issue === 'UNASSIGNED') {
    return 'Esta etapa não tem responsável elegível (pessoa ativa com este cliente na carteira). Até que alguém seja atribuído, somente quem tem permissão de exceção pode concluí-la.';
  }
  if (issue === 'INACTIVE_OR_OUT_OF_SCOPE') {
    return 'O responsável não está mais ativo ou não tem este cliente na carteira. Reatribua a etapa para que ela possa avançar.';
  }
  return null;
}

const EVENT_LABEL: Record<string, string> = {
  EXECUTION_STARTED: 'Onboarding iniciado',
  EXECUTION_COMPLETED: 'Onboarding concluído',
  EXECUTION_CANCELLED: 'Onboarding cancelado',
  STEP_STARTED: 'Etapa iniciada',
  STEP_COMPLETED: 'Etapa concluída',
  STEP_BLOCKED: 'Etapa bloqueada',
  STEP_UNBLOCKED: 'Etapa desbloqueada',
  STEP_SKIPPED: 'Etapa dispensada',
  STEP_REASSIGNED: 'Responsável alterado',
  STEP_RELEASED: 'Etapa liberada',
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? automationEventLabel(type) ?? type;
}

/** Evento de dispensa de etapa que bloqueia a conclusao (P4): destaque no historico. */
export function isHighlightedEvent(event: { type: string; after: unknown }): boolean {
  const after = event.after as { highlight?: string } | null;
  return event.type === 'STEP_SKIPPED' && after?.highlight === 'BLOCKING_STEP_SKIPPED';
}

/** Data AAAA-MM-DD -> DD/MM/AAAA, sem fuso (e uma data de calendario). */
export function formatDay(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Etapas abertas que seriam dispensadas na conclusao antecipada, e bloqueantes que impedem (P3). */
export function earlyCompletionPreview(steps: readonly Pick<ExecutionStepView, 'stepKey' | 'title' | 'status' | 'blocksCompletion'>[]) {
  const open = steps.filter((s) => isOpenStatus(s.status));
  return {
    blockingOpen: open.filter((s) => s.blocksCompletion),
    toSkip: open.filter((s) => !s.blocksCompletion),
  };
}

/** Visibilidade do item de menu: exige a capacidade quando informada (DEC-F7-009). */
export function isNavItemVisible(
  item: { requires?: 'onboarding.view' | 'calendar.view' | 'content.view' },
  caps: { view: boolean; calendarView?: boolean; contentView?: boolean }
): boolean {
  if (item.requires === 'onboarding.view') return caps.view;
  if (item.requires === 'calendar.view') return Boolean(caps.calendarView);
  if (item.requires === 'content.view') return Boolean(caps.contentView);
  return true;
}

/** Texto da condicao "evento do Calendar vinculado": atendida, pendente ou indisponivel (F7-3c). */
export function calendarConditionText(c: {
  state: 'MET' | 'PENDING' | 'UNAVAILABLE';
  reason: 'CONNECTION_UNAVAILABLE' | 'NO_MONITORED_CALENDAR' | 'NO_LINKED_EVENT' | null;
}): { label: string; tone: BadgeTone; message: string } {
  if (c.state === 'MET') {
    return { label: 'Evento vinculado: atendida', tone: 'success', message: 'Há evento do Calendar vinculado a este cliente. Escolha-o ao concluir a etapa; o vínculo sozinho não conclui.' };
  }
  if (c.state === 'PENDING') {
    return { label: 'Evento vinculado: pendente', tone: 'warning', message: 'Ainda não há evento ativo do Calendar vinculado a este cliente. Vincule um evento na Agenda.' };
  }
  return {
    label: 'Evento vinculado: indisponível',
    tone: 'danger',
    message:
      c.reason === 'CONNECTION_UNAVAILABLE'
        ? 'A conexão com o Google Calendar está revogada ou desconectada, então a condição não pode ser conferida. Reconecte a conta ou dispense a etapa com justificativa.'
        : 'Nenhum calendário está monitorado, então a condição não pode ser conferida.',
  };
}
