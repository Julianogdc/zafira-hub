import type { AgendaEvent, CalendarCategory } from '@/services/calendar';

/** F7-3b - Apresentacao pura da agenda (sem React, sem rede). Datas de calendario em AAAA-MM-DD. */

export type AgendaMode = 'month' | 'week';

export const CATEGORY_LABEL: Record<CalendarCategory, string> = {
  MEETING: 'Reunião',
  CAPTURE: 'Captação',
  TECHNICAL_VISIT: 'Visita técnica',
  PRESENTATION: 'Apresentação',
  TRAINING: 'Treinamento',
  OTHER: 'Outro',
};

const DAY = 86_400_000;
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => fmt(new Date(parse(iso).getTime() + n * DAY));
export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
export const addMonths = (iso: string, n: number) => {
  const d = parse(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmt(d);
};
/** Domingo da semana que contem a data. */
export const startOfWeek = (iso: string) => addDays(iso, -parse(iso).getUTCDay());

export interface DayCell {
  iso: string;
  inMonth: boolean;
}

/** Grade mensal (domingo a sabado), sempre 6 semanas para altura estavel. */
export function buildMonthGrid(anchorIso: string): DayCell[] {
  const first = startOfMonth(anchorIso);
  const start = startOfWeek(first);
  const month = first.slice(0, 7);
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    return { iso, inMonth: iso.slice(0, 7) === month };
  });
}

export function buildWeek(anchorIso: string): DayCell[] {
  const start = startOfWeek(anchorIso);
  return Array.from({ length: 7 }, (_, i) => ({ iso: addDays(start, i), inMonth: true }));
}

/** Janela a pedir ao servidor (com margem de 1 dia para fusos). */
export function rangeFor(mode: AgendaMode, anchorIso: string): { from: Date; to: Date } {
  const cells = mode === 'month' ? buildMonthGrid(anchorIso) : buildWeek(anchorIso);
  return {
    from: new Date(parse(addDays(cells[0].iso, -1)).getTime()),
    to: new Date(parse(addDays(cells[cells.length - 1].iso, 2)).getTime()),
  };
}

function dayInZone(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/** Dias (no fuso da organizacao) que o evento cobre; dia inteiro tem fim exclusivo. */
export function eventDays(e: Pick<AgendaEvent, 'isAllDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate'>, timeZone: string): string[] {
  let first: string | null = null;
  let last: string | null = null;
  if (e.isAllDay) {
    first = e.startDate;
    last = e.endDate ? addDays(e.endDate, -1) : e.startDate;
  } else if (e.startAt) {
    first = dayInZone(e.startAt, timeZone);
    last = e.endAt ? dayInZone(new Date(new Date(e.endAt).getTime() - 1).toISOString(), timeZone) : first;
  }
  if (!first) return [];
  if (!last || last < first) last = first;
  const out: string[] = [];
  for (let d = first, i = 0; d <= last && i < 62; d = addDays(d, 1), i++) out.push(d);
  return out;
}

export function groupByDay(events: readonly AgendaEvent[], timeZone: string): Map<string, AgendaEvent[]> {
  const map = new Map<string, AgendaEvent[]>();
  for (const e of events) {
    for (const d of eventDays(e, timeZone)) map.set(d, [...(map.get(d) ?? []), e]);
  }
  for (const [d, list] of map) {
    map.set(
      d,
      [...list].sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        return (a.startAt ?? '').localeCompare(b.startAt ?? '') || a.title.localeCompare(b.title);
      })
    );
  }
  return map;
}

export function formatTime(instant: string | null, timeZone: string): string {
  if (!instant) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

export function formatDateTime(instant: string | null, timeZone: string): string {
  if (!instant) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(instant));
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const monthTitle = (iso: string) => {
  const name = MONTHS[Number(iso.slice(5, 7)) - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${iso.slice(0, 4)}`;
};
export const dayTitle = (iso: string) => `${WEEKDAYS[parse(iso).getUTCDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface AgendaFilters {
  sourceId?: string;
  category?: CalendarCategory | 'NONE';
  clientId?: string;
}

/** Filtros de visualizacao (por calendario, categoria e cliente); o acesso ja foi decidido no servidor. */
export function applyFilters(events: readonly AgendaEvent[], f: AgendaFilters): AgendaEvent[] {
  return events.filter((e) => {
    if (f.sourceId && e.sourceId !== f.sourceId) return false;
    if (f.clientId && e.link?.clientId !== f.clientId) return false;
    if (f.category === 'NONE' && e.link) return false;
    if (f.category && f.category !== 'NONE' && e.link?.category !== f.category) return false;
    return true;
  });
}

/** Mensagem de frescor: a agenda e uma leitura periodica, nunca tempo real. */
export function freshnessMessage(
  status: { connected: boolean; requiresReconnect: boolean; monitoredCalendars: number; lastSyncedAt: string | null; stale: boolean; neverSynced: boolean },
  timeZone: string
): { kind: 'none' | 'info' | 'warn' | 'danger'; text: string } {
  if (status.requiresReconnect) {
    return { kind: 'danger', text: 'A conexão com o Google foi revogada ou expirou. Os compromissos abaixo são a última leitura salva; peça a quem administra para reconectar a conta.' };
  }
  if (!status.connected) return { kind: 'none', text: '' };
  if (status.monitoredCalendars === 0) return { kind: 'none', text: '' };
  if (status.neverSynced || !status.lastSyncedAt) {
    return { kind: 'warn', text: 'Os calendários monitorados ainda não foram lidos. A agenda aparecerá após a primeira sincronização.' };
  }
  const when = formatDateTime(status.lastSyncedAt, timeZone);
  if (status.stale) {
    return { kind: 'warn', text: `Agenda desatualizada: última leitura em ${when}. Os dados não são em tempo real e podem não refletir mudanças recentes no Google.` };
  }
  return { kind: 'info', text: `Última leitura em ${when}. A agenda é atualizada periodicamente, não em tempo real.` };
}
