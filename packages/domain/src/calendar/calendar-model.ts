/* ==========================================================================
   F7-3a - Regras da agenda (Google Calendar, SOMENTE LEITURA) - DEC-F7-012.
   Funcoes puras: mapeamento do evento, janela, reconciliacao, visibilidade.
   ========================================================================== */

export const CALENDAR_EVENT_CATEGORIES = ['MEETING', 'CAPTURE', 'TECHNICAL_VISIT', 'PRESENTATION', 'TRAINING', 'OTHER'] as const;
export type CalendarEventCategoryValue = (typeof CALENDAR_EVENT_CATEGORIES)[number];

export const DEFAULT_WINDOW_PAST_DAYS = 30;
export const DEFAULT_WINDOW_FUTURE_DAYS = 180;
/** Sobreposicao de seguranca do cursor `updatedMin` (minutos). */
export const CURSOR_OVERLAP_MINUTES = 5;
export const MASKED_EVENT_TITLE = 'Compromisso privado';

export type CalendarEventStatusValue = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
export type GoogleVisibility = 'default' | 'public' | 'private' | 'confidential';

interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** Subconjunto do evento da API (campos nao listados sao ignorados e NUNCA persistidos). */
export interface GoogleEventRaw {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  visibility?: string;
  recurringEventId?: string;
  originalStartTime?: GoogleTime;
  iCalUID?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  updated?: string;
  organizer?: { email?: string };
  attendees?: { email?: string; resource?: boolean }[];
}

export interface NormalizedCalendarEvent {
  googleEventId: string;
  recurringEventId: string | null;
  originalStartDateTime: string | null;
  originalStartDate: string | null;
  originalStartTimeZone: string | null;
  iCalUID: string | null;
  title: string;
  isAllDay: boolean;
  startAt: Date | null;
  startDate: string | null;
  endAt: Date | null;
  endDate: string | null;
  timeZone: string | null;
  status: CalendarEventStatusValue;
  visibility: GoogleVisibility;
  location: string | null;
  htmlLink: string | null;
  attendeeCount: number;
  attendeeHashes: string[];
  googleUpdatedAt: Date | null;
  /** Evento cancelado costuma vir sem horarios: a gravacao NAO deve apagar os horarios locais. */
  hasTiming: boolean;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toDate = (v?: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const mapStatus = (s?: string): CalendarEventStatusValue =>
  s === 'cancelled' ? 'CANCELLED' : s === 'tentative' ? 'TENTATIVE' : 'CONFIRMED';

const mapVisibility = (v?: string): GoogleVisibility =>
  v === 'private' || v === 'confidential' || v === 'public' ? v : 'default';

/**
 * Converte o evento da API em registro minimo. `hasher` e o HMAC protegido do servidor:
 * e-mails, descricao, links de videoconferencia e o payload bruto nunca saem daqui.
 * Devolve null se nao houver id (evento invalido e ignorado).
 */
export function mapGoogleEvent(raw: GoogleEventRaw, hasher: (normalizedEmail: string) => string): NormalizedCalendarEvent | null {
  if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const isAllDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  const emails = new Set<string>();
  for (const a of raw.attendees ?? []) {
    if (a.email && !a.resource) emails.add(normalizeEmail(a.email));
  }
  if (raw.organizer?.email) emails.add(normalizeEmail(raw.organizer.email));
  const startAt = isAllDay ? null : toDate(raw.start?.dateTime);
  const endAt = isAllDay ? null : toDate(raw.end?.dateTime);
  return {
    googleEventId: raw.id,
    recurringEventId: raw.recurringEventId ?? null,
    originalStartDateTime: raw.originalStartTime?.dateTime ?? null,
    originalStartDate: raw.originalStartTime?.date ?? null,
    originalStartTimeZone: raw.originalStartTime?.timeZone ?? null,
    iCalUID: raw.iCalUID ?? null,
    title: typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : '',
    isAllDay,
    startAt,
    startDate: isAllDay ? raw.start?.date ?? null : null,
    endAt,
    endDate: isAllDay ? raw.end?.date ?? null : null,
    timeZone: raw.start?.timeZone ?? raw.end?.timeZone ?? null,
    status: mapStatus(raw.status),
    visibility: mapVisibility(raw.visibility),
    location: typeof raw.location === 'string' ? raw.location.slice(0, 300) : null,
    htmlLink: typeof raw.htmlLink === 'string' ? raw.htmlLink : null,
    attendeeCount: (raw.attendees ?? []).length,
    attendeeHashes: [...emails].map((e) => hasher(e)).sort(),
    googleUpdatedAt: toDate(raw.updated),
    hasTiming: Boolean(raw.start?.dateTime || raw.start?.date),
  };
}

/* ------------------------------ janela e cursor ------------------------------ */

const clampDays = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : fallback;
};

export function resolveWindowConfig(config: { windowPastDays?: unknown; windowFutureDays?: unknown } | null | undefined) {
  return {
    pastDays: clampDays(config?.windowPastDays, DEFAULT_WINDOW_PAST_DAYS),
    futureDays: clampDays(config?.windowFutureDays, DEFAULT_WINDOW_FUTURE_DAYS),
  };
}

export function computeSyncWindow(now: Date, pastDays: number, futureDays: number) {
  const day = 86_400_000;
  return {
    timeMin: new Date(now.getTime() - pastDays * day),
    timeMax: new Date(now.getTime() + futureDays * day),
  };
}

/** `updatedMin` do ciclo incremental: cursor menos a sobreposicao; sem cursor = carga completa (null). */
export function updatedMinFromCursor(cursor: Date | null): Date | null {
  return cursor ? new Date(cursor.getTime() - CURSOR_OVERLAP_MINUTES * 60_000) : null;
}

export function backoffDelayMs(attempt: number, random: () => number = Math.random, baseMs = 500, capMs = 8000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/* ------------------------------ reconciliacao ------------------------------ */

export interface LocalEventForReconcile {
  id: string;
  googleEventId: string;
  status: CalendarEventStatusValue;
  startAt: Date | null;
  endAt: Date | null;
  startDate: string | null;
  endDate: string | null;
  missingFromSourceAt: Date | null;
}

const eventRange = (e: LocalEventForReconcile): [number, number] | null => {
  const s = e.startAt?.getTime() ?? (e.startDate ? Date.parse(`${e.startDate}T00:00:00Z`) : NaN);
  const en = e.endAt?.getTime() ?? (e.endDate ? Date.parse(`${e.endDate}T00:00:00Z`) : s);
  return Number.isNaN(s) ? null : [s, Number.isNaN(en) ? s : en];
};

/**
 * Reconciliacao apos leitura COMPLETA da janela: o que estava dentro da janela e nao veio e marcado
 * como ausente (nunca apagado nem desvinculado); o que reapareceu perde a marca.
 */
export function reconcileWindow(
  local: readonly LocalEventForReconcile[],
  seenGoogleIds: ReadonlySet<string>,
  window: { timeMin: Date; timeMax: Date }
): { markMissing: string[]; clearMissing: string[] } {
  const markMissing: string[] = [];
  const clearMissing: string[] = [];
  const wMin = window.timeMin.getTime();
  const wMax = window.timeMax.getTime();
  for (const e of local) {
    const seen = seenGoogleIds.has(e.googleEventId);
    if (seen) {
      if (e.missingFromSourceAt) clearMissing.push(e.id);
      continue;
    }
    if (e.status === 'CANCELLED' || e.missingFromSourceAt) continue;
    const range = eventRange(e);
    if (!range) continue;
    if (range[0] <= wMax && range[1] >= wMin) markMissing.push(e.id);
  }
  return { markMissing, clearMissing };
}

/** Compromisso ativo: nem cancelado nem ausente da origem. */
export const isActiveAppointment = (e: { status: CalendarEventStatusValue; missingFromSourceAt: Date | null }) =>
  e.status !== 'CANCELLED' && !e.missingFromSourceAt;

/* ------------------------------ visibilidade (backend) ------------------------------ */

export interface EventAccessInput {
  googleVisibility: GoogleVisibility;
  /** Interseccao entre os hashes do evento e as identidades ASSOCIADAS ao membro autenticado. */
  isParticipant: boolean;
  linkedClientId: string | null;
  /** O cliente vinculado esta na carteira do membro (decidido no servidor). */
  clientInScope: boolean;
  hasViewAll: boolean;
}

/**
 * Quem ve o que (DEC-F7-012):
 *  - participante (identidade associada) ve;
 *  - evento vinculado a cliente da carteira ve;
 *  - `calendar.view_all` lista tudo, mas NAO revela detalhe privado/confidencial;
 *  - evento sem cliente nao e visivel a "toda a agencia".
 * Privado/confidencial: mascarado para quem nao e participante.
 */
export function decideEventAccess(input: EventAccessInput): { visible: boolean; masked: boolean } {
  const byClient = input.linkedClientId !== null && input.clientInScope;
  const visible = input.isParticipant || byClient || input.hasViewAll;
  const sensitive = input.googleVisibility === 'private' || input.googleVisibility === 'confidential';
  return { visible, masked: visible && sensitive && !input.isParticipant };
}

export function maskCalendarEvent<T extends { title: string; location: string | null; htmlLink: string | null; attendeeCount: number }>(
  e: T
): T {
  return { ...e, title: MASKED_EVENT_TITLE, location: null, htmlLink: null, attendeeCount: 0 };
}

/* ------------------------------ onboarding por evento (F7-3c) ------------------------------ */

export type CalendarIneligibleReason = 'CANCELLED' | 'REMOVED_FROM_SOURCE' | 'SOURCE_NOT_MONITORED';

/**
 * Um evento so serve a uma etapa de onboarding enquanto for compromisso ATIVO de um calendario monitorado.
 * Cancelado, ausente da origem (removido ou fora da janela) ou calendario desmarcado = inelegivel.
 * (Etapas ja concluidas guardam o evento como historico e nao sao afetadas.)
 */
export function eventEligibility(e: {
  status: CalendarEventStatusValue;
  missingFromSourceAt: Date | null;
  sourceMonitored: boolean;
}): { eligible: true } | { eligible: false; reason: CalendarIneligibleReason } {
  if (e.status === 'CANCELLED') return { eligible: false, reason: 'CANCELLED' };
  if (e.missingFromSourceAt) return { eligible: false, reason: 'REMOVED_FROM_SOURCE' };
  if (!e.sourceMonitored) return { eligible: false, reason: 'SOURCE_NOT_MONITORED' };
  return { eligible: true };
}

export type CalendarConditionState = 'MET' | 'PENDING' | 'UNAVAILABLE';
export type CalendarConditionReason = 'CONNECTION_UNAVAILABLE' | 'NO_MONITORED_CALENDAR' | 'NO_LINKED_EVENT' | null;

/**
 * Estado da condicao "evento vinculado" para a interface e para a conclusao:
 *  - UNAVAILABLE: conexao revogada/desconectada ou nenhum calendario monitorado (nao ha como conferir);
 *  - PENDING: conectado, mas nao ha evento ATIVO vinculado ao cliente;
 *  - MET: ha ao menos um evento elegivel. MET nao conclui a etapa: a conclusao e uma acao da pessoa.
 */
export function evaluateCalendarCondition(input: {
  connectionActive: boolean;
  monitoredSources: number;
  eligibleEvents: number;
}): { state: CalendarConditionState; reason: CalendarConditionReason } {
  if (!input.connectionActive) return { state: 'UNAVAILABLE', reason: 'CONNECTION_UNAVAILABLE' };
  if (input.monitoredSources === 0) return { state: 'UNAVAILABLE', reason: 'NO_MONITORED_CALENDAR' };
  if (input.eligibleEvents === 0) return { state: 'PENDING', reason: 'NO_LINKED_EVENT' };
  return { state: 'MET', reason: null };
}
