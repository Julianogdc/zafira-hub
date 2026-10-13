/**
 * Fuso da organização na tela (DEC-F6-005). Mesma regra de `@zafira/domain/time`:
 * "hoje" e o mês corrente seguem o fuso da organização ativa, não o relógio do computador.
 */

export const DEFAULT_ORGANIZATION_TIMEZONE = 'America/Sao_Paulo';

export function resolveTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return DEFAULT_ORGANIZATION_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return timeZone.trim();
  } catch {
    return DEFAULT_ORGANIZATION_TIMEZONE;
  }
}

/** Hoje (YYYY-MM-DD) no fuso da organização. */
export function todayInTimeZone(timeZone: unknown, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Mês corrente (YYYY-MM) no fuso da organização. */
export function currentPeriodInTimeZone(timeZone: unknown, now: Date = new Date()): string {
  return todayInTimeZone(timeZone, now).slice(0, 7);
}

/** Converte YYYY-MM-DD em Date ao meio-dia UTC (seguro para montar calendário sem pular dia). */
export function isoDateToCalendarDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
