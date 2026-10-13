import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CATEGORY_LABEL, formatDateTime } from '@/lib/calendar-view';
import { resolveTimeZone } from '@/lib/organization-time';
import { onboardingService, type OnboardingMemberView } from '@/services/onboarding';
import {
  CalendarCategory,
  CalendarSourceView,
  ConnectionStatus,
  IdentityView,
  calendarErrorInfo,
  calendarService,
  useCalendarCapabilities,
} from '@/services/calendar';
import styles from './Agenda.module.css';

const CATEGORIES = Object.keys(CATEGORY_LABEL) as CalendarCategory[];

/** F7-3b - Conexao do Google, calendarios monitorados, janela e identidades (somente leitura no Google). */
export default function AgendaConfiguracao() {
  const { currentOrganization } = useAuthStore();
  const caps = useCalendarCapabilities(currentOrganization?.id);
  const tz = resolveTimeZone(currentOrganization?.timezone);
  const [params] = useSearchParams();

  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [sources, setSources] = useState<CalendarSourceView[]>([]);
  const [identities, setIdentities] = useState<IdentityView[]>([]);
  const [members, setMembers] = useState<OnboardingMemberView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [pastDays, setPastDays] = useState(30);
  const [futureDays, setFutureDays] = useState(180);
  const [idMember, setIdMember] = useState('');
  const [idEmail, setIdEmail] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const c = await calendarService.connection();
      setConn(c);
      setPastDays(c.windowPastDays);
      setFutureDays(c.windowFutureDays);
      const [s, i, m] = await Promise.all([
        calendarService.sources(),
        calendarService.identities(),
        onboardingService.listMembers().catch(() => [] as OnboardingMemberView[]),
      ]);
      setSources(s);
      setIdentities(i);
      setMembers(m);
    } catch (e) {
      setLoadError(calendarErrorInfo(e).message);
    }
  }, []);

  useEffect(() => {
    if (caps.loading || !caps.manageConnections) return;
    void load();
  }, [caps.loading, caps.manageConnections, load]);

  useEffect(() => {
    const r = params.get('calendar');
    if (r === 'connected') setNotice({ kind: 'ok', text: 'Conta Google conectada. Descubra os calendários e escolha quais monitorar.' });
    else if (r === 'denied') setNotice({ kind: 'warn', text: 'A autorização do Google foi negada ou cancelada.' });
    else if (r === 'error') setNotice({ kind: 'danger', text: 'Não foi possível concluir a conexão com o Google. Tente novamente.' });
  }, [params]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ kind: 'ok', text: msg });
    } catch (e) {
      setNotice({ kind: 'danger', text: calendarErrorInfo(e).message });
    } finally {
      setBusy(null);
    }
  };

  if (caps.loading) {
    return (
      <div className={styles.container}>
        <LoadingState message="Carregando permissões..." />
      </div>
    );
  }
  if (!caps.manageConnections) {
    return (
      <div className={styles.container}>
        <PermissionState title="Sem permissão para administrar a agenda" description="Somente quem administra as conexões pode configurar o Google Calendar." />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className={styles.container}>
        <ErrorState title="Não foi possível carregar a configuração" description={loadError} onRetry={() => void load()} />
      </div>
    );
  }
  if (!conn) {
    return (
      <div className={styles.container}>
        <LoadingState message="Carregando configuração..." />
      </div>
    );
  }

  const connected = conn.connected && !conn.requiresReconnect;

  return (
    <div className={styles.container} data-testid="agenda-settings">
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Conexão e calendários</h1>
          <p className={styles.subtitle}>
            <Link to="/agenda" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> Agenda</Link>
            {' · '}Leitura apenas: o Hub nunca cria, altera ou exclui eventos ou calendários no Google.
          </p>
        </div>
      </header>

      {notice ? (
        <div className={`${styles.banner} ${notice.kind === 'danger' ? styles.bannerDanger : notice.kind === 'warn' ? styles.bannerWarn : styles.bannerOk}`} role={notice.kind === 'ok' ? 'status' : 'alert'} data-testid="settings-notice">
          <span className={styles.bannerText}>{notice.text}</span>
        </div>
      ) : null}

      <section className={styles.panel} aria-labelledby="conn-title">
        <h2 id="conn-title" className={styles.panelTitle}>Conta Google</h2>
        {!conn.configured ? (
          <p className={styles.fieldError} role="alert" data-testid="not-configured">
            A integração com o Google ainda não está configurada neste ambiente (credenciais OAuth ausentes). Nada pode ser conectado até lá.
          </p>
        ) : null}
        <div className={styles.badges} data-testid="connection-state">
          {conn.requiresReconnect ? <Badge variant="danger">Conexão revogada: reconecte</Badge> : connected ? <Badge variant="success">Conectada</Badge> : <Badge variant="neutral">Não conectada</Badge>}
          {conn.accountHint ? <Badge variant="neutral">{conn.accountHint}</Badge> : null}
          {conn.lastValidatedAt ? <Badge variant="neutral">Autorizada em {formatDateTime(conn.lastValidatedAt, tz)}</Badge> : null}
        </div>
        {conn.requiresReconnect ? (
          <p className={styles.help}>A autorização do Google expirou ou foi revogada. Os dados já lidos continuam disponíveis, mas não serão atualizados até reconectar.</p>
        ) : null}
        <div className={styles.actions}>
          <Button
            disabled={busy !== null || !conn.configured}
            data-testid="connect-google"
            onClick={() =>
              void run('connect', async () => {
                const { url } = await calendarService.authorize();
                window.location.href = url;
              })
            }
          >
            {connected ? 'Reconectar conta' : conn.requiresReconnect ? 'Reconectar conta' : 'Conectar conta Google'}
          </Button>
          {conn.connected || conn.requiresReconnect ? (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirmDisconnect(true)} data-testid="disconnect-google">Desconectar</Button>
          ) : null}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="src-title">
        <h2 id="src-title" className={styles.panelTitle}>Calendários</h2>
        <p className={styles.help}>Escolha quais calendários acessíveis à conta conectada aparecem na agenda. Você pode alterar a escolha depois; o histórico e os vínculos locais são preservados.</p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={busy !== null || !connected}
            data-testid="discover-calendars"
            onClick={() => void run('discover', async () => { setSources(await calendarService.discover()); return 'Calendários atualizados a partir do Google.'; })}
          >
            <RefreshCw size={14} /> Descobrir calendários
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null || !connected || sources.every((s) => !s.isMonitored)}
            data-testid="sync-now"
            onClick={() =>
              void run('sync', async () => {
                const results = (await calendarService.sync(false)) as Array<{ ok?: boolean; skipped?: string; message?: string }>;
                await load();
                const failed = results.find((r) => r.ok === false);
                if (failed) throw new Error(failed.message || 'A leitura falhou. Verifique a conexão.');
                return 'Leitura concluída. A agenda é atualizada periodicamente, não em tempo real.';
              })
            }
          >
            Sincronizar agora
          </Button>
        </div>
        {sources.length === 0 ? (
          <p className={styles.help} data-testid="no-sources">Nenhum calendário descoberto ainda. Use "Descobrir calendários".</p>
        ) : (
          <div data-testid="source-list">
            {sources.map((s) => (
              <div key={s.id} className={styles.row} data-testid="source-row" data-name={s.name}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{s.name}</span>
                  <span className={styles.eventMeta}>
                    {s.limitedDetails ? 'Somente livre/ocupado (detalhes limitados) · ' : ''}
                    {s.lastSyncedAt ? `Última leitura ${formatDateTime(s.lastSyncedAt, tz)}` : s.isMonitored ? 'Ainda não lido' : 'Não monitorado'}
                    {s.lastError ? ` · Erro: ${s.lastError}` : ''}
                  </span>
                </div>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={s.isMonitored}
                    disabled={busy !== null}
                    onChange={(e) => void run(`src-${s.id}`, async () => { setSources(await calendarService.updateSource(s.id, { isMonitored: e.target.checked })); })}
                  />
                  <span>Monitorar</span>
                </label>
                <div className={styles.field} style={{ minWidth: 180 }}>
                  <label className={styles.label} htmlFor={`cat-${s.id}`}>Categoria padrão</label>
                  <select
                    id={`cat-${s.id}`}
                    className={styles.select}
                    value={s.defaultCategory ?? ''}
                    disabled={busy !== null}
                    onChange={(e) => void run(`cat-${s.id}`, async () => { setSources(await calendarService.updateSource(s.id, { defaultCategory: (e.target.value || null) as CalendarCategory | null })); })}
                  >
                    <option value="">Nenhuma</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="win-title">
        <h2 id="win-title" className={styles.panelTitle}>Janela de leitura</h2>
        <div className={styles.twoCols}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="win-past">Dias anteriores (1–365)</label>
            <input id="win-past" className={styles.input} type="number" min={1} max={365} value={pastDays} onChange={(e) => setPastDays(Number(e.target.value))} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="win-future">Dias futuros (1–365)</label>
            <input id="win-future" className={styles.input} type="number" min={1} max={365} value={futureDays} onChange={(e) => setFutureDays(Number(e.target.value))} />
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={busy !== null || !connected}
            data-testid="save-window"
            onClick={() => void run('window', async () => { setConn(await calendarService.settings(pastDays, futureDays)); return 'Janela atualizada. Uma nova leitura completa será feita.'; })}
          >
            Salvar janela
          </Button>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="id-title">
        <h2 id="id-title" className={styles.panelTitle}>Identidades de participantes</h2>
        <p className={styles.help}>
          Associe explicitamente cada pessoa do Hub ao e-mail que ela usa no Google. O e-mail é convertido em uma impressão criptográfica e não é guardado; só a pessoa associada passa a ser reconhecida como participante.
        </p>
        {!conn.identityKeyConfigured ? (
          <p className={styles.fieldError} role="alert" data-testid="identity-key-missing">A chave de identidades não está configurada neste ambiente; a associação está desativada.</p>
        ) : (
          <div className={styles.twoCols}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="id-member">Pessoa</label>
              <select id="id-member" className={styles.select} value={idMember} onChange={(e) => setIdMember(e.target.value)}>
                <option value="">Escolha uma pessoa</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="id-email">E-mail no Google</label>
              <input id="id-email" className={styles.input} type="email" value={idEmail} onChange={(e) => setIdEmail(e.target.value)} />
            </div>
          </div>
        )}
        {conn.identityKeyConfigured ? (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={busy !== null || !idMember || !idEmail.includes('@')}
              data-testid="associate-identity"
              onClick={() => void run('identity', async () => { setIdentities(await calendarService.setIdentity(idMember, idEmail)); setIdEmail(''); return 'Identidade associada.'; })}
            >
              Associar
            </Button>
          </div>
        ) : null}
        <div data-testid="identity-list">
          {identities.map((i) => (
            <div key={i.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{i.memberName}</span>
                <span className={styles.eventMeta}>{i.displayHint}</span>
              </div>
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run(`rm-${i.id}`, async () => { setIdentities(await calendarService.removeIdentity(i.id)); })}>
                Remover
              </Button>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={confirmDisconnect} onOpenChange={(open) => busy === null && setConfirmDisconnect(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar conta Google</DialogTitle>
            <DialogDescription>
              A autorização armazenada é apagada e a leitura dos calendários é pausada. Os eventos e vínculos já lidos permanecem no Hub (sem exclusão automática).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>Cancelar</Button>
            <Button
              variant="danger"
              data-testid="confirm-disconnect"
              onClick={() => void run('disconnect', async () => { setConn(await calendarService.disconnect()); setConfirmDisconnect(false); await load(); return 'Conta desconectada.'; })}
            >
              Desconectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
