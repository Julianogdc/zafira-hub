/* ==========================================================================
   F7-4a - Regras da caixa de saida de automacoes n8n (DEC-F7-016). Funcoes puras.
   O Hub garante persistencia antes do envio, chave estavel e resultado aplicado uma vez;
   NAO garante execucao "exatamente uma vez" no sistema externo (depende do fluxo respeitar a chave).
   ========================================================================== */

export type OutboxStatus = 'PENDING' | 'SENT' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'DEAD';

export const OUTBOX_FINAL_STATUSES: readonly OutboxStatus[] = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'DEAD'];
export const OUTBOX_RESENDABLE_STATUSES: readonly OutboxStatus[] = ['FAILED', 'TIMED_OUT', 'DEAD'];

/** Espera (min) antes da tentativa seguinte, indexada pelo numero de tentativas ja feitas (1, 2, ...). */
export const RETRY_SCHEDULE_MINUTES = [1, 5, 15, 60, 360] as const;
export const DEFAULT_MAX_ATTEMPTS = 6;
export const DEFAULT_TIMEOUT_HOURS = 24;
export const CALLBACK_WINDOW_MS = 5 * 60_000;

export type SendOutcome = 'OK' | 'RETRY' | 'PERMANENT';

/** 2xx = aceito; 408/425/429/5xx e falha de rede = repetir; demais 4xx e 3xx = permanente. */
export function classifySendStatus(status: number | null): SendOutcome {
  if (status === null) return 'RETRY';
  if (status >= 200 && status < 300) return 'OK';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'RETRY';
  return 'PERMANENT';
}

export function retryDelayMs(attemptsDone: number): number {
  const i = Math.min(Math.max(attemptsDone, 1), RETRY_SCHEDULE_MINUTES.length) - 1;
  return RETRY_SCHEDULE_MINUTES[i] * 60_000;
}

/** Resultado do envio: proximo estado e quando tentar de novo. */
export function nextAfterSend(input: { outcome: SendOutcome; attemptsDone: number; maxAttempts: number; now: Date }): {
  status: OutboxStatus;
  nextAttemptAt: Date | null;
} {
  if (input.outcome === 'OK') return { status: 'SENT', nextAttemptAt: null };
  if (input.outcome === 'PERMANENT') return { status: 'FAILED', nextAttemptAt: null };
  if (input.attemptsDone >= input.maxAttempts) return { status: 'DEAD', nextAttemptAt: null };
  return { status: 'RETRYING', nextAttemptAt: new Date(input.now.getTime() + retryDelayMs(input.attemptsDone)) };
}

export function isTimestampFresh(timestampSeconds: number, now: Date, windowMs: number = CALLBACK_WINDOW_MS): boolean {
  if (!Number.isFinite(timestampSeconds)) return false;
  return Math.abs(now.getTime() - timestampSeconds * 1000) <= windowMs;
}

export function isTimedOut(sentAt: Date | null, now: Date, timeoutHours: number): boolean {
  return sentAt !== null && now.getTime() - sentAt.getTime() >= timeoutHours * 3_600_000;
}

export type CallbackDecision =
  | { apply: true }
  | { apply: false; reason: 'DUPLICATE' | 'ALREADY_FINAL' | 'NOT_SENT' | 'SUPERSEDED' | 'EXECUTION_CLOSED' | 'STEP_NOT_OPEN' };

/**
 * Um resultado so e aplicado se o pedido esta SENT (foi de fato enviado), e a geracao e a vigente,
 * a execucao esta ativa e a etapa segue aberta. Qualquer outra coisa e ignorada e auditada.
 */
export function decideCallback(input: {
  outboxStatus: OutboxStatus;
  generation: number;
  latestGeneration: number;
  executionActive: boolean;
  stepOpen: boolean;
}): CallbackDecision {
  if (input.outboxStatus === 'SUCCEEDED') return { apply: false, reason: 'DUPLICATE' };
  if (OUTBOX_FINAL_STATUSES.includes(input.outboxStatus)) return { apply: false, reason: 'ALREADY_FINAL' };
  if (input.outboxStatus !== 'SENT') return { apply: false, reason: 'NOT_SENT' };
  if (input.generation !== input.latestGeneration) return { apply: false, reason: 'SUPERSEDED' };
  if (!input.executionActive) return { apply: false, reason: 'EXECUTION_CLOSED' };
  if (!input.stepOpen) return { apply: false, reason: 'STEP_NOT_OPEN' };
  return { apply: true };
}

/** Pode reenviar (mesma chave) ou refazer (nova geracao) apenas pedido em estado nao-sucesso e final. */
export function canResend(status: OutboxStatus): boolean {
  return OUTBOX_RESENDABLE_STATUSES.includes(status);
}
