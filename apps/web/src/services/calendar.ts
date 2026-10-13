import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import { capabilitiesService } from '@/services/capabilities';

/**
 * F7-3b - Cliente da API da agenda Google (SOMENTE LEITURA no Google; DEC-F7-011/012/013).
 * A autorizacao real (RBAC, carteira, mascaramento) e do backend; aqui nada oculto chega ao navegador.
 */

export type CalendarCategory = 'MEETING' | 'CAPTURE' | 'TECHNICAL_VISIT' | 'PRESENTATION' | 'TRAINING' | 'OTHER';

export interface AgendaStatus {
  connected: boolean;
  requiresReconnect: boolean;
  monitoredCalendars: number;
  neverSynced: boolean;
  lastSyncedAt: string | null;
  hasErrors: boolean;
  stale: boolean;
}

export interface CalendarEventLinkView {
  scope: 'EVENT' | 'SERIES';
  clientId: string | null;
  category: CalendarCategory;
  asanaProjectGid: string | null;
  notes: string | null;
}

export interface AgendaEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  color: string | null;
  title: string;
  isAllDay: boolean;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  timeZone: string | null;
  status: string;
  location: string | null;
  htmlLink: string | null;
  attendeeCount: number;
  isRecurringInstance: boolean;
  masked: boolean;
  participant: boolean;
  link: CalendarEventLinkView | null;
}

export interface ConnectionStatus {
  configured: boolean;
  identityKeyConfigured: boolean;
  connected: boolean;
  status: string;
  requiresReconnect: boolean;
  accountHint: string | null;
  lastValidatedAt: string | null;
  windowPastDays: number;
  windowFutureDays: number;
}

export interface CalendarSourceView {
  id: string;
  name: string;
  accessRole: string;
  limitedDetails: boolean;
  timeZone: string | null;
  color: string | null;
  isMonitored: boolean;
  defaultCategory: CalendarCategory | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface IdentityView {
  id: string;
  memberId: string;
  memberName: string;
  displayHint: string;
  createdAt: string;
}

const enc = encodeURIComponent;

export const calendarService = {
  status: () => api.get<AgendaStatus>('/calendar/status'),
  events: (from: Date, to: Date) => api.get<AgendaEvent[]>(`/calendar/events?from=${enc(from.toISOString())}&to=${enc(to.toISOString())}`),
  setLink: (
    eventId: string,
    body: { scope: 'EVENT' | 'SERIES'; clientId: string | null; asanaProjectGid: string | null; category: CalendarCategory; notes: string | null }
  ) => api.put<{ ok: boolean }>(`/calendar/events/${enc(eventId)}/link`, body),
  removeLink: (eventId: string, scope: 'EVENT' | 'SERIES') =>
    api.delete<{ ok: boolean }>(`/calendar/events/${enc(eventId)}/link?scope=${scope}`),

  connection: () => api.get<ConnectionStatus>('/calendar/connection'),
  authorize: () => api.post<{ url: string }>('/calendar/connection/authorize'),
  disconnect: () => api.delete<ConnectionStatus>('/calendar/connection'),
  settings: (windowPastDays: number, windowFutureDays: number) =>
    api.patch<ConnectionStatus>('/calendar/settings', { windowPastDays, windowFutureDays }),
  sources: () => api.get<CalendarSourceView[]>('/calendar/sources'),
  discover: () => api.post<CalendarSourceView[]>('/calendar/sources/discover'),
  updateSource: (id: string, body: { isMonitored?: boolean; defaultCategory?: CalendarCategory | null }) =>
    api.patch<CalendarSourceView[]>(`/calendar/sources/${enc(id)}`, body),
  sync: (forceFull = false) => api.post<unknown[]>('/calendar/sync', { forceFull }),
  identities: () => api.get<IdentityView[]>('/calendar/identities'),
  setIdentity: (memberId: string, email: string) => api.put<IdentityView[]>('/calendar/identities', { memberId, email }),
  removeIdentity: (id: string) => api.delete<IdentityView[]>(`/calendar/identities/${enc(id)}`),
};

export function calendarErrorInfo(error: unknown): { status: number; code?: string; message: string } {
  const e = error as { status?: number; message?: string; data?: { code?: string } } | null;
  return { status: e?.status ?? 0, code: e?.data?.code, message: e?.message || 'Nao foi possivel concluir a operacao.' };
}

export interface CalendarCapabilities {
  loading: boolean;
  error: boolean;
  view: boolean;
  link: boolean;
  manageConnections: boolean;
  viewAll: boolean;
}

/** Capacidades so decidem o que MOSTRAR; o backend valida cada rota. Falha = nenhuma capacidade. */
export function useCalendarCapabilities(organizationId?: string | null): CalendarCapabilities {
  const [state, setState] = useState<CalendarCapabilities>({
    loading: true,
    error: false,
    view: false,
    link: false,
    manageConnections: false,
    viewAll: false,
  });
  useEffect(() => {
    let alive = true;
    capabilitiesService
      .getEffectiveCapabilities(organizationId ?? undefined)
      .then((c) => {
        if (!alive) return;
        const p = c.permissions as Record<string, boolean>;
        setState({
          loading: false,
          error: false,
          view: Boolean(p['calendar.view']),
          link: Boolean(p['calendar.link']),
          manageConnections: Boolean(p['calendar.manage_connections']),
          viewAll: Boolean(p['calendar.view_all']),
        });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: true, view: false, link: false, manageConnections: false, viewAll: false });
      });
    return () => {
      alive = false;
    };
  }, [organizationId]);
  return state;
}
