import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, EmptyState, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clientsService, type ClientPortfolioItem } from '@/services/clients';
import { asanaIntegrationService, type ClientAsanaProject } from '@/services/asana';
import {
  AgendaEvent,
  AgendaStatus,
  CalendarCategory,
  calendarErrorInfo,
  calendarService,
  useCalendarCapabilities,
} from '@/services/calendar';
import {
  AgendaFilters,
  AgendaMode,
  CATEGORY_LABEL,
  WEEKDAYS,
  addDays,
  addMonths,
  applyFilters,
  buildMonthGrid,
  buildWeek,
  dayTitle,
  formatDateTime,
  formatTime,
  freshnessMessage,
  groupByDay,
  monthTitle,
  rangeFor,
  startOfMonth,
} from '@/lib/calendar-view';
import { resolveTimeZone, todayInTimeZone } from '@/lib/organization-time';
import styles from './Agenda.module.css';

const CATEGORIES = Object.keys(CATEGORY_LABEL) as CalendarCategory[];

/** F7-3b - Agenda (leitura do Google Calendar): mensal/semanal, filtros, vinculo local a cliente e projeto. */
export default function Agenda() {
  const { currentOrganization } = useAuthStore();
  const caps = useCalendarCapabilities(currentOrganization?.id);
  const tz = resolveTimeZone(currentOrganization?.timezone);
  const today = todayInTimeZone(tz);

  const [mode, setMode] = useState<AgendaMode>('month');
  const [anchor, setAnchor] = useState<string>(today);
  const [selected, setSelected] = useState<string>(today);
  const [filters, setFilters] = useState<AgendaFilters>({});

  const [status, setStatus] = useState<AgendaStatus | null>(null);
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [clients, setClients] = useState<ClientPortfolioItem[]>([]);

  const [detail, setDetail] = useState<AgendaEvent | null>(null);
  const [form, setForm] = useState<{ scope: 'EVENT' | 'SERIES'; clientId: string; projectGid: string; category: CalendarCategory; notes: string }>({
    scope: 'EVENT',
    clientId: '',
    projectGid: '',
    category: 'MEETING',
    notes: '',
  });
  const [projects, setProjects] = useState<ClientAsanaProject[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [st, list] = await Promise.all([calendarService.status(), calendarService.events(range.from, range.to)]);
      setStatus(st);
      setEvents(list);
    } catch (e) {
      const info = calendarErrorInfo(e);
      setError({ status: info.status, message: info.message });
      setEvents(null);
    }
  }, [range]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void clientsService.listClients().then(setClients).catch(() => setClients([]));
  }, [caps.loading, caps.view]);

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name] as const)), [clients]);
  const visible = useMemo(() => applyFilters(events ?? [], filters), [events, filters]);
  const byDay = useMemo(() => groupByDay(visible, tz), [visible, tz]);
  const sources = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events ?? []) m.set(e.sourceId, e.sourceName);
    return [...m.entries()];
  }, [events]);

  const cells = mode === 'month' ? buildMonthGrid(anchor) : buildWeek(anchor);
  const title = mode === 'month' ? monthTitle(startOfMonth(anchor)) : `Semana de ${dayTitle(cells[0].iso)} a ${dayTitle(cells[6].iso)}`;
  const move = (dir: -1 | 1) => setAnchor((a) => (mode === 'month' ? addMonths(a, dir) : addDays(a, dir * 7)));

  const openDetail = (e: AgendaEvent) => {
    setDetail(e);
    setDialogError(null);
    setForm({
      scope: e.link?.scope ?? 'EVENT',
      clientId: e.link?.clientId ?? '',
      projectGid: e.link?.asanaProjectGid ?? '',
      category: e.link?.category ?? 'MEETING',
      notes: e.link?.notes ?? '',
    });
    setProjects([]);
    if (e.link?.clientId) void asanaIntegrationService.getClientProjects(e.link.clientId).then(setProjects).catch(() => setProjects([]));
  };

  const onClientChange = (clientId: string) => {
    setForm((f) => ({ ...f, clientId, projectGid: '' }));
    setProjects([]);
    if (clientId) void asanaIntegrationService.getClientProjects(clientId).then(setProjects).catch(() => setProjects([]));
  };

  const saveLink = async () => {
    if (!detail) return;
    setSaving(true);
    setDialogError(null);
    try {
      await calendarService.setLink(detail.id, {
        scope: form.scope,
        clientId: form.clientId || null,
        asanaProjectGid: form.projectGid || null,
        category: form.category,
        notes: form.notes.trim() ? form.notes : null,
      });
      setDetail(null);
      await load();
    } catch (e) {
      setDialogError(calendarErrorInfo(e).message);
    } finally {
      setSaving(false);
    }
  };

  const removeLink = async () => {
    if (!detail?.link) return;
    setSaving(true);
    setDialogError(null);
    try {
      await calendarService.removeLink(detail.id, detail.link.scope);
      setDetail(null);
      await load();
    } catch (e) {
      setDialogError(calendarErrorInfo(e).message);
    } finally {
      setSaving(false);
    }
  };

  if (caps.loading) {
    return (
      <div className={styles.container}>
        <LoadingState message="Carregando permissões..." />
      </div>
    );
  }
  if (!caps.view) {
    return (
      <div className={styles.container}>
        <PermissionState
          title="Sem permissão para ver a agenda"
          description={caps.error ? 'Não foi possível confirmar suas permissões agora. Tente novamente em instantes.' : 'Seu perfil não tem acesso à agenda desta organização.'}
        />
      </div>
    );
  }

  const fresh = status ? freshnessMessage(status, tz) : { kind: 'none' as const, text: '' };
  const notConnected = status !== null && !status.connected && !status.requiresReconnect;
  const noCalendars = status !== null && status.connected && status.monitoredCalendars === 0;
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <div className={styles.container} data-testid="agenda-page">
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Agenda</h1>
          <p className={styles.subtitle}>Compromissos lidos do Google Calendar. Somente leitura: nada é criado, alterado ou excluído no Google.</p>
        </div>
        <div className={styles.actions}>
          {caps.manageConnections ? (
            <Link to="/agenda/configuracao" data-testid="open-settings">
              <Button variant="secondary"><Settings2 size={16} /> Conexão e calendários</Button>
            </Link>
          ) : null}
        </div>
      </header>

      {fresh.kind !== 'none' ? (
        <div
          className={`${styles.banner} ${fresh.kind === 'danger' ? styles.bannerDanger : fresh.kind === 'warn' ? styles.bannerWarn : ''}`}
          role={fresh.kind === 'danger' || fresh.kind === 'warn' ? 'alert' : 'status'}
          data-testid="freshness"
          data-kind={fresh.kind}
        >
          <span className={styles.bannerText}>{fresh.text}</span>
        </div>
      ) : null}

      {error ? (
        <ErrorState
          title={error.status === 403 ? 'Sem permissão' : 'Não foi possível carregar a agenda'}
          description={error.message}
          onRetry={() => void load()}
        />
      ) : events === null ? (
        <LoadingState message="Carregando a agenda..." />
      ) : notConnected ? (
        <EmptyState
          icon={<CalendarDays />}
          title="Google Calendar não conectado"
          description={
            caps.manageConnections
              ? 'Conecte a conta Google da agência em "Conexão e calendários" para ver os compromissos aqui.'
              : 'A agenda ainda não foi conectada. Peça a quem administra para conectar a conta Google.'
          }
        />
      ) : noCalendars ? (
        <EmptyState
          icon={<CalendarDays />}
          title="Nenhum calendário monitorado"
          description={
            caps.manageConnections
              ? 'Escolha em "Conexão e calendários" quais calendários do Google devem aparecer na agenda.'
              : 'Nenhum calendário foi escolhido para monitoramento ainda.'
          }
        />
      ) : (
        <>
          <section className={styles.toolbar} aria-label="Navegação da agenda">
            <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Período anterior"><ChevronLeft size={16} /></Button>
            <span className={styles.monthTitle} data-testid="agenda-title" aria-live="polite">{title}</span>
            <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Próximo período"><ChevronRight size={16} /></Button>
            <Button variant="secondary" size="sm" onClick={() => { setAnchor(today); setSelected(today); }}>Hoje</Button>
            <Button variant={mode === 'month' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('month')} aria-pressed={mode === 'month'} data-testid="mode-month">Mês</Button>
            <Button variant={mode === 'week' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('week')} aria-pressed={mode === 'week'} data-testid="mode-week">Semana</Button>
          </section>

          <section className={styles.filters} aria-label="Filtros">
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ag-source">Calendário</label>
              <select id="ag-source" className={styles.select} value={filters.sourceId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, sourceId: e.target.value || undefined }))}>
                <option value="">Todos</option>
                {sources.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ag-category">Categoria</label>
              <select id="ag-category" className={styles.select} value={filters.category ?? ''} onChange={(e) => setFilters((f) => ({ ...f, category: (e.target.value || undefined) as AgendaFilters['category'] }))}>
                <option value="">Todas</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
                <option value="NONE">Sem categoria</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ag-client">Cliente</label>
              <select id="ag-client" className={styles.select} value={filters.clientId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value || undefined }))}>
                <option value="">Todos</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </section>

          <section aria-label="Grade da agenda" data-testid="agenda-grid">
            <div className={styles.grid} role="grid">
              {WEEKDAYS.map((w) => (
                <div key={w} className={styles.weekday} role="columnheader">{w}</div>
              ))}
              {cells.map((c) => {
                const list = byDay.get(c.iso) ?? [];
                return (
                  <button
                    key={c.iso}
                    type="button"
                    className={`${styles.cell} ${mode === 'week' ? styles.weekCell : ''} ${c.inMonth ? '' : styles.cellOut} ${selected === c.iso ? styles.cellSelected : ''} ${c.iso === today ? styles.cellToday : ''}`}
                    onClick={() => setSelected(c.iso)}
                    aria-label={`${dayTitle(c.iso)}: ${list.length} compromisso(s)`}
                    aria-pressed={selected === c.iso}
                    data-testid="day-cell"
                    data-day={c.iso}
                    data-count={list.length}
                  >
                    <span className={styles.dayNumber}>{Number(c.iso.slice(8, 10))}</span>
                    {list.slice(0, mode === 'week' ? 6 : 2).map((e) => (
                      <span key={e.id} className={`${styles.chip} ${e.masked ? styles.chipMasked : ''}`}>
                        {e.isAllDay ? '' : `${formatTime(e.startAt, tz)} `}{e.title}
                      </span>
                    ))}
                    {list.length > (mode === 'week' ? 6 : 2) ? <span className={styles.more}>+{list.length - (mode === 'week' ? 6 : 2)}</span> : null}
                    {list.length > 0 ? <span className={styles.dot} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="day-title" data-testid="day-panel">
            <h2 id="day-title" className={styles.panelTitle}>{dayTitle(selected)}</h2>
            {dayEvents.length === 0 ? (
              <p className={styles.help}>Nenhum compromisso neste dia{Object.values(filters).some(Boolean) ? ' com os filtros escolhidos' : ''}.</p>
            ) : (
              <ul className={styles.eventList}>
                {dayEvents.map((e) => (
                  <li key={e.id}>
                    <button type="button" className={styles.eventItem} onClick={() => openDetail(e)} data-testid="event-item" data-title={e.title}>
                      <span className={styles.eventTitle}>{e.title}</span>
                      <span className={styles.eventMeta}>
                        {e.isAllDay ? 'Dia inteiro' : `${formatTime(e.startAt, tz)} – ${formatTime(e.endAt, tz)}`} · {e.sourceName}
                      </span>
                      <span className={styles.badges}>
                        {e.masked ? <Badge variant="neutral">Privado</Badge> : null}
                        {e.link ? <Badge variant="info">{CATEGORY_LABEL[e.link.category]}</Badge> : null}
                        {e.link?.clientId ? <Badge variant="success">{clientName.get(e.link.clientId) ?? 'Cliente'}</Badge> : null}
                        {e.isRecurringInstance ? <Badge variant="neutral">Recorrente</Badge> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Dialog open={detail !== null} onOpenChange={(open) => !saving && !open && setDetail(null)}>
        <DialogContent>
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription>
                  {detail.isAllDay ? 'Dia inteiro' : `${formatDateTime(detail.startAt, tz)} – ${formatTime(detail.endAt, tz)}`} · {detail.sourceName}
                </DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                {detail.masked ? (
                  <p className={styles.help} data-testid="masked-note">Compromisso privado: detalhes ocultos para o seu perfil. Você pode vinculá-lo a um cliente da sua carteira.</p>
                ) : (
                  <>
                    {detail.location ? <p className={styles.eventMeta}>Local: {detail.location}</p> : null}
                    {detail.attendeeCount > 0 ? <p className={styles.eventMeta}>{detail.attendeeCount} participante(s)</p> : null}
                    {detail.htmlLink ? (
                      <p className={styles.eventMeta}>
                        <a href={detail.htmlLink} target="_blank" rel="noopener noreferrer">Abrir no Google Calendar</a>
                      </p>
                    ) : null}
                  </>
                )}
                {caps.link ? (
                  <>
                    <div className={styles.twoCols}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="lk-client">Cliente</label>
                        <select id="lk-client" className={styles.select} value={form.clientId} onChange={(e) => onClientChange(e.target.value)}>
                          <option value="">Sem cliente</option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="lk-category">Categoria</label>
                        <select id="lk-category" className={styles.select} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CalendarCategory })}>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {form.clientId ? (
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="lk-project">Projeto do Asana (vínculo local)</label>
                        <select id="lk-project" className={styles.select} value={form.projectGid} onChange={(e) => setForm({ ...form, projectGid: e.target.value })}>
                          <option value="">Sem projeto</option>
                          {projects.map((p) => (
                            <option key={p.integrationId} value={p.projectGid}>{p.projectName}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {detail.isRecurringInstance ? (
                      <label className={styles.check}>
                        <input type="checkbox" checked={form.scope === 'SERIES'} onChange={(e) => setForm({ ...form, scope: e.target.checked ? 'SERIES' : 'EVENT' })} />
                        <span>Aplicar a toda a série (inclusive novas ocorrências)</span>
                      </label>
                    ) : null}
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="lk-notes">Nota interna (fica só no Hub)</label>
                      <textarea id="lk-notes" className={styles.textarea} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                    <p className={styles.help}>O vínculo é local: nada é gravado no Google.</p>
                  </>
                ) : (
                  <p className={styles.help}>
                    {detail.link ? `Categoria: ${CATEGORY_LABEL[detail.link.category]}.` : 'Sem vínculo.'}
                  </p>
                )}
                {dialogError ? <p className={styles.fieldError} role="alert" data-testid="link-error">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDetail(null)} disabled={saving}>Fechar</Button>
                {caps.link && detail.link ? (
                  <Button variant="danger" onClick={() => void removeLink()} disabled={saving} data-testid="remove-link">Remover vínculo</Button>
                ) : null}
                {caps.link ? (
                  <Button onClick={() => void saveLink()} disabled={saving} data-testid="save-link">{saving ? 'Salvando...' : 'Salvar vínculo'}</Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
