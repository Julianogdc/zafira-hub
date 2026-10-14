import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui/ds';
import { Banner } from '@/components/onboarding/OnboardingShell';
import styles from '@/pages/Onboarding.module.css';
import { PublicationMetrics } from './PublicationMetrics';
import {
  contentErrorInfo,
  contentService,
  type ApprovalStatus,
  type PublicationSettings,
  type PublicationTarget,
} from '@/services/content';
import {
  PUBLICATION_STATE_META,
  deliveryNote,
  formatInZone,
  safeHttpsUrl,
  scheduleProblem,
  suggestedSchedule,
  toOffsetIso,
  type PublicationView,
} from '@/lib/publication-view';

/**
 * F8-4b (DEC-F8-027, D-F84B-1) - Publicação no Instagram pela versão atual aprovada pelo cliente.
 * F8-5c (DEC-F8-029): publicações confirmadas mostram o desempenho (somente leitura).
 * O Hub só registra o pedido; o envio real é do despachante (desligado por padrão). As ações
 * exibidas vêm da API (estado + cancelamento pendente) e o servidor valida tudo de novo.
 */
interface Props {
  itemId: string;
  approvalStatus: ApprovalStatus | null;
  currentVersionNumber: number;
  canSchedule: boolean;
  timeZone: string;
  /** F8-5p.3 (P39): formato do conteudo, para a politica do piloto. */
  format?: string;
}

type Confirm =
  | { kind: 'create'; socialAccountId: string; iso: string }
  | { kind: 'reschedule'; id: string; iso: string }
  | { kind: 'cancel'; id: string };

export function PublicationPanel({ itemId, approvalStatus, currentVersionNumber, canSchedule, timeZone, format }: Props) {
  const [pubs, setPubs] = useState<PublicationView[] | null>(null);
  const [targets, setTargets] = useState<PublicationTarget[]>([]);
  const [settings, setSettings] = useState<PublicationSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [account, setAccount] = useState('');
  const [when, setWhen] = useState(() => suggestedSchedule(timeZone));
  const [editing, setEditing] = useState<string | null>(null);
  const [editWhen, setEditWhen] = useState(() => suggestedSchedule(timeZone));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, t, s] = await Promise.all([
        contentService.publications(itemId),
        contentService.publicationTargets(itemId),
        contentService.publicationSettings(),
      ]);
      setPubs(p);
      setTargets(t);
      setSettings(s);
      setLoadFailed(false);
      setAccount((a) => a || t[0]?.socialAccountId || '');
    } catch {
      setLoadFailed(true);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load, approvalStatus, currentVersionNumber]);

  const minLead = settings?.minLeadMinutes ?? 5;
  const dispatchEnabled = settings?.dispatchEnabled ?? false;
  const approved = approvalStatus === 'APPROVED';
  // F8-5p.3 (P39): com a politica do piloto em vigor, so organizacao e formato autorizados podem agendar (o servidor confere de novo)
  const pilot = settings?.pilotPolicy;
  const pilotBlocked = Boolean(pilot?.enforced && (!pilot.organizationAuthorized || (format ? !pilot.formats.includes(format) : false)));
  const activeFor = (socialAccountId: string) =>
    (pubs ?? []).some(
      (p) => p.socialAccountId === socialAccountId && p.versionNumber === currentVersionNumber && p.state !== 'CANCELLED' && p.state !== 'FAILED'
    );
  const accountLabel = (socialAccountId: string) => targets.find((t) => t.socialAccountId === socialAccountId)?.label ?? 'Conta Instagram';

  const review = (kind: 'create' | 'reschedule', id?: string) => {
    setDone(null);
    const w = kind === 'create' ? when : editWhen;
    const iso = toOffsetIso(w.date, w.time, timeZone);
    const err = scheduleProblem(iso, minLead);
    if (err) return setProblem(err);
    if (kind === 'create' && !account) return setProblem('Escolha a conta do Instagram.');
    setProblem(null);
    setConfirm(kind === 'create' ? { kind, socialAccountId: account, iso: iso! } : { kind, id: id!, iso: iso! });
  };

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    setProblem(null);
    let message: string | null = null;
    try {
      if (confirm.kind === 'create') {
        await contentService.requestPublication(itemId, { socialAccountId: confirm.socialAccountId, scheduledAt: confirm.iso });
        message = 'Agendamento registrado no Hub.';
      } else if (confirm.kind === 'reschedule') {
        await contentService.reschedulePublication(confirm.id, confirm.iso);
        message = 'Novo horário registrado no Hub.';
        setEditing(null);
      } else {
        const p = await contentService.cancelPublication(confirm.id);
        message = p.state === 'CANCELLED' ? 'Agendamento cancelado.' : 'Cancelamento solicitado. O Hub vai confirmar com o provedor.';
      }
    } catch (e) {
      setProblem(contentErrorInfo(e).message);
    }
    // a lista é recarregada antes do aviso, para nunca exibir sucesso ao lado de dados antigos
    await load();
    setConfirm(null);
    setBusy(false);
    if (message) setDone(message);
  };

  const confirmText = (c: Confirm): string => {
    if (c.kind === 'create') return `Agendar a versão ${currentVersionNumber} em ${accountLabel(c.socialAccountId)} para ${formatInZone(c.iso, timeZone)}?`;
    if (c.kind === 'reschedule') return `Mudar o horário para ${formatInZone(c.iso, timeZone)}?`;
    return 'Cancelar este agendamento? Se já estiver no provedor, o Hub pede o cancelamento e confirma depois.';
  };

  return (
    <section className={styles.panel} aria-labelledby="publication-title" data-testid="publication-panel">
      <h2 id="publication-title" className={styles.panelTitle}>Publicação no Instagram</h2>

      {settings && !dispatchEnabled ? (
        <Banner kind="warn" testId="publication-dispatch-off">
          O envio automático ao Instagram está desligado neste ambiente. Os agendamentos ficam só registrados no Hub e nada é publicado.
        </Banner>
      ) : null}
      {loadFailed ? <Banner kind="danger" testId="publication-load-error">Não foi possível carregar os agendamentos.</Banner> : null}
      {problem ? <Banner kind="danger" testId="publication-problem">{problem}</Banner> : null}
      {done ? <Banner kind="ok" testId="publication-done">{done}</Banner> : null}

      {!approved ? (
        <p className={styles.readOnlyNote} data-testid="publication-not-approved">
          Só a versão atual aprovada pelo cliente pode ser agendada. Envie o link de aprovação e aguarde a resposta.
        </p>
      ) : pilotBlocked ? (
        <p className={styles.readOnlyNote} data-testid="publication-pilot-blocked">
          {pilot?.organizationAuthorized
            ? 'Este formato não está autorizado no piloto de publicação.'
            : 'Esta organização não está autorizada a publicar no piloto.'}
        </p>
      ) : !canSchedule ? (
        <p className={styles.readOnlyNote} data-testid="publication-noperm">Agendar publicações exige a permissão de agendamento.</p>
      ) : targets.length === 0 && pubs ? (
        <p className={styles.readOnlyNote} data-testid="publication-no-targets">
          Este cliente não tem conta do Instagram vinculada. Vincule a conta na integração do cliente para agendar.
        </p>
      ) : pubs ? (
        <div className={styles.form} data-testid="publication-form">
          <div className={styles.field}>
            <label className={styles.label} htmlFor="pub-account">Conta do Instagram</label>
            <select id="pub-account" className={styles.select} value={account} onChange={(e) => setAccount(e.target.value)} data-testid="publication-account">
              {targets.map((t) => (
                <option key={t.socialAccountId} value={t.socialAccountId} disabled={activeFor(t.socialAccountId)}>
                  {t.label}{activeFor(t.socialAccountId) ? ' (já agendada)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="pub-date">Data</label>
              <input id="pub-date" className={styles.input} type="date" value={when.date} onChange={(e) => setWhen({ ...when, date: e.target.value })} data-testid="publication-date" />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="pub-time">Horário</label>
              <input id="pub-time" className={styles.input} type="time" value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} data-testid="publication-time" />
            </div>
          </div>
          <p className={styles.help}>Horário no fuso da organização ({timeZone}), com pelo menos {minLead} minutos de antecedência.</p>
          <div className={styles.actions}>
            <Button onClick={() => review('create')} disabled={busy || !account || activeFor(account) || confirm !== null} data-testid="publication-review">
              Revisar agendamento
            </Button>
          </div>
        </div>
      ) : null}

      {confirm ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`} role="alertdialog" aria-label="Confirmação" data-testid="publication-confirm">
          <div className={styles.bannerText}>
            <strong>{confirmText(confirm)}</strong>
            {confirm.kind !== 'cancel' && !dispatchEnabled ? <p className={styles.help}>Com o envio desligado, nada é enviado ao Instagram.</p> : null}
          </div>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => void run()} disabled={busy} data-testid="publication-confirm-yes">Confirmar</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirm(null)} disabled={busy} data-testid="publication-confirm-no">Voltar</Button>
          </div>
        </div>
      ) : null}

      {pubs && pubs.length > 0 ? (
        <ul className={styles.eventList} data-testid="publication-list">
          {pubs.map((p) => {
            const meta = PUBLICATION_STATE_META[p.state];
            const link = p.state === 'PUBLISHED' ? safeHttpsUrl(p.permalink) : null;
            return (
              <li key={p.id} className={styles.event} data-publication-state={p.state} data-testid="publication-item">
                <div className={styles.badges}>
                  <Badge variant={meta.tone}>{meta.label}</Badge>
                  <Badge variant="neutral">v{p.versionNumber ?? '?'}</Badge>
                  <Badge variant={p.sentToProvider ? 'info' : 'neutral'}>{p.sentToProvider ? 'Enviado ao provedor' : 'Registrado no Hub'}</Badge>
                </div>
                <span>
                  {accountLabel(p.socialAccountId)} · {p.state === 'PUBLISHED' ? `publicado em ${formatInZone(p.publishedAt, timeZone)}` : `previsto para ${formatInZone(p.scheduledAt, timeZone)}`}
                </span>
                <span className={styles.eventMeta} data-testid="publication-delivery">{deliveryNote(p, dispatchEnabled)}</span>
                <span className={styles.eventMeta}>{meta.help}</span>
                {p.state === 'FAILED' && p.failureMessage ? <span className={styles.eventMeta}>Motivo: {p.failureMessage}</span> : null}
                {link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer" data-testid="publication-permalink">Ver no Instagram</a>
                ) : null}
                {p.state === 'PUBLISHED' ? (
                  <PublicationMetrics publicationId={p.id} timeZone={timeZone} refreshKey={p.metrics?.lastCheckedAt ?? undefined} />
                ) : null}
                {canSchedule && (p.actions.reschedule || p.actions.cancel) ? (
                  editing === p.id ? (
                    <div className={styles.form} data-testid="publication-reschedule-form">
                      <div className={styles.row}>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor={`rs-date-${p.id}`}>Nova data</label>
                          <input id={`rs-date-${p.id}`} className={styles.input} type="date" value={editWhen.date} onChange={(e) => setEditWhen({ ...editWhen, date: e.target.value })} data-testid="publication-reschedule-date" />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor={`rs-time-${p.id}`}>Novo horário</label>
                          <input id={`rs-time-${p.id}`} className={styles.input} type="time" value={editWhen.time} onChange={(e) => setEditWhen({ ...editWhen, time: e.target.value })} data-testid="publication-reschedule-time" />
                        </div>
                      </div>
                      <div className={styles.actions}>
                        <Button size="sm" onClick={() => review('reschedule', p.id)} disabled={busy || confirm !== null} data-testid="publication-reschedule-review">Revisar novo horário</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Fechar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.actions}>
                      {p.actions.reschedule ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || confirm !== null}
                          onClick={() => {
                            setEditing(p.id);
                            setEditWhen(suggestedSchedule(timeZone));
                          }}
                          data-testid="publication-reschedule"
                        >
                          Reagendar
                        </Button>
                      ) : null}
                      {p.actions.cancel ? (
                        <Button size="sm" variant="ghost" disabled={busy || confirm !== null} onClick={() => {
                            setDone(null);
                            setConfirm({ kind: 'cancel', id: p.id });
                          }} data-testid="publication-cancel">
                          Cancelar
                        </Button>
                      ) : null}
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : pubs ? (
        <p className={styles.help} data-testid="publication-empty">Nenhum agendamento registrado.</p>
      ) : null}
    </section>
  );
}
