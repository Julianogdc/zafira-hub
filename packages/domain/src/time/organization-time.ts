/**
 * Fuso horário da organização (DEC-F6-005).
 * "Hoje", "atrasado" e o mês corrente seguem o fuso configurado da organização,
 * não o relógio do navegador nem o do servidor. Padrão: America/Sao_Paulo.
 */

export const DEFAULT_ORGANIZATION_TIMEZONE = 'America/Sao_Paulo';

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Fuso válido ou o padrão (nunca lança). */
export function resolveTimeZone(timeZone: unknown): string {
  return isValidTimeZone(timeZone) ? timeZone.trim() : DEFAULT_ORGANIZATION_TIMEZONE;
}

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayInTimeZone(timeZone: unknown, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Mês corrente (YYYY-MM) no fuso informado. */
export function currentPeriodInTimeZone(timeZone: unknown, now: Date = new Date()): string {
  return todayInTimeZone(timeZone, now).slice(0, 7);
}

/** Data (YYYY-MM-DD) de um instante no fuso informado. */
export function dateInTimeZone(instant: Date | string, timeZone: unknown): string | null {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return null;
  return todayInTimeZone(timeZone, date);
}

/**
 * Tarefa atrasada no fuso da organização:
 *  - com horário (dueAt): atrasada quando o instante já passou;
 *  - só com data (dueOn): atrasada a partir do dia seguinte ao prazo, no fuso da organização.
 * Concluída ou sem prazo nunca está atrasada.
 */
export function isOverdueInTimeZone(
  task: { completed?: boolean | null; dueOn?: string | null; dueAt?: string | null },
  timeZone: unknown,
  now: Date = new Date()
): boolean {
  if (task.completed) return false;
  if (task.dueAt) {
    const due = new Date(task.dueAt);
    return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
  }
  if (task.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(task.dueOn)) {
    return task.dueOn < todayInTimeZone(timeZone, now);
  }
  return false;
}
