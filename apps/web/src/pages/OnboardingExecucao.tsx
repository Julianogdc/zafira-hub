import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Banner, OnboardingShell } from '@/components/onboarding/OnboardingShell';
import {
  EXECUTION_STATUS_LABEL,
  assigneeIssueMessage,
  calendarConditionText,
  earlyCompletionPreview,
  eventLabel,
  formatDay,
  isHighlightedEvent,
  isOpenStatus,
  stepBadges,
} from '@/lib/onboarding-execution-view';
import {
  ExecutionDetail,
  ExecutionStepView,
  StepActionKey,
  executionErrorInfo,
  onboardingExecutionService,
} from '@/services/onboardingExecution';
import { OnboardingMemberView, onboardingService } from '@/services/onboarding';
import { asanaIntegrationService, type ClientAsanaProject } from '@/services/asana';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import { AutomationHistoryItem, automationErrorInfo, automationService, useAutomationCapabilities } from '@/services/automation';
import { automationNotice, automationStatusText, isAutomationEvent, safeExternalUrl } from '@/lib/automation-view';
import styles from './Onboarding.module.css';

type DialogState =
  | { kind: 'complete' | 'block' | 'unblock' | 'skip' | 'reassign'; step: ExecutionStepView }
  | { kind: 'resend'; step: ExecutionStepView; mode: 'RETRY' | 'REDO' }
  | { kind: 'early' | 'cancel' }
  | null;

const ACTION_LABEL: Record<StepActionKey, string> = {
  start: 'Iniciar etapa',
  complete: 'Concluir',
  block: 'Bloquear',
  unblock: 'Desbloquear',
  skip: 'Dispensar',
  reassign: 'Reatribuir',
};

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** F7-2b - Detalhe do onboarding de um cliente: etapas, prazos, dependencias, evidencias, acoes e historico. */
export default function OnboardingExecucao() {
  const { id = '' } = useParams();
  const { currentOrganization } = useAuthStore();
  const caps = useOnboardingCapabilities(currentOrganization?.id);
  const autoCaps = useAutomationCapabilities(currentOrganization?.id);
  const [history, setHistory] = useState<AutomationHistoryItem[]>([]);

  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // campos dos dialogos
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [asanaGid, setAsanaGid] = useState('');
  const [calendarEventId, setCalendarEventId] = useState('');
  const [asanaProjects, setAsanaProjects] = useState<ClientAsanaProject[] | null>(null);
  const [asanaError, setAsanaError] = useState(false);
  const [members, setMembers] = useState<OnboardingMemberView[]>([]);
  const [newAssignee, setNewAssignee] = useState('');

  const load = useCallback(async (keepConflict = false) => {
    setLoadError(null);
    try {
      setDetail(await onboardingExecutionService.get(id));
      if (!keepConflict) setConflict(null);
    } catch (e) {
      const info = executionErrorInfo(e);
      setLoadError({ status: info.status, message: info.message });
      setDetail(null);
    }
  }, [id]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  const hasAutomation = Boolean(detail?.steps.some((s) => s.automation));
  useEffect(() => {
    if (!hasAutomation || autoCaps.loading || !autoCaps.view) {
      setHistory([]);
      return;
    }
    let alive = true;
    automationService
      .history(id)
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [id, hasAutomation, autoCaps.loading, autoCaps.view, detail]);

  const submitResend = async () => {
    if (dialog?.kind !== 'resend') return;
    setBusy(true);
    setDialogError(null);
    try {
      await automationService.resend(id, dialog.step.stepKey, dialog.mode, reason.trim());
      setDialog(null);
      setConflict(null);
      setNotice({
        kind: 'ok',
        text: dialog.mode === 'RETRY' ? 'Reenvio solicitado. O pedido volta para a fila com a mesma chave.' : 'Nova execução solicitada. Um novo pedido foi registrado.',
      });
      await load();
    } catch (e) {
      const info = automationErrorInfo(e);
      if (info.status === 409) {
        setDialog(null);
        setConflict(info.message);
        void load(true);
      } else {
        setDialogError(info.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const titleOf = useMemo(() => new Map((detail?.steps ?? []).map((s) => [s.stepKey, s.title] as const)), [detail]);

  const openDialog = (state: Exclude<DialogState, null>) => {
    setReason('');
    setConfirm(false);
    setLink('');
    setNote('');
    setAsanaGid('');
    setCalendarEventId('');
    setNewAssignee('');
    setDialogError(null);
    setDialog(state);
    if (state.kind === 'reassign') {
      void onboardingService.listMembers().then(setMembers).catch(() => setMembers([]));
    }
    if (state.kind === 'complete' && state.step.completionCondition === 'ASANA_PROJECT_LINKED' && detail) {
      setAsanaProjects(null);
      setAsanaError(false);
      void asanaIntegrationService
        .getClientProjects(detail.clientId)
        .then(setAsanaProjects)
        .catch(() => {
          setAsanaProjects([]);
          setAsanaError(true);
        });
    }
  };

  /** Executa uma chamada; 409 vira aviso de conflito e recarrega sem sobrescrever nada. */
  const run = async (call: () => Promise<ExecutionDetail>, okText: string) => {
    setBusy(true);
    setDialogError(null);
    try {
      const next = await call();
      setDetail(next);
      setDialog(null);
      setConflict(null);
      setNotice({ kind: 'ok', text: okText });
    } catch (e) {
      const info = executionErrorInfo(e);
      if (info.status === 409) {
        setDialog(null);
        setConflict(info.message);
        void load(true);
      } else {
        setDialogError(info.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const quickStart = (step: ExecutionStepView) =>
    run(() => onboardingExecutionService.stepAction(id, step.stepKey, 'start'), `Etapa "${step.title}" iniciada.`);

  if (caps.loading) {
    return (
      <OnboardingShell title="Onboarding" tabs={false}>
        <LoadingState message="Carregando permissões..." />
      </OnboardingShell>
    );
  }
  if (!caps.view) {
    return (
      <OnboardingShell title="Onboarding" tabs={false}>
        <PermissionState title="Sem permissão para ver o onboarding" description="Seu perfil não tem acesso ao onboarding desta organização." />
      </OnboardingShell>
    );
  }
  if (loadError) {
    return (
      <OnboardingShell title="Onboarding" tabs={false}>
        <ErrorState
          title={loadError.status === 404 ? 'Onboarding não encontrado' : 'Não foi possível carregar o onboarding'}
          description={loadError.message}
          onRetry={loadError.status === 404 ? undefined : () => void load()}
        />
        <Link to="/onboarding/execucoes">Voltar ao acompanhamento</Link>
      </OnboardingShell>
    );
  }
  if (!detail) {
    return (
      <OnboardingShell title="Onboarding" tabs={false}>
        <LoadingState message="Carregando onboarding..." />
      </OnboardingShell>
    );
  }

  const status = EXECUTION_STATUS_LABEL[detail.status];
  const active = detail.status === 'ACTIVE';
  const attention = detail.steps.filter((s) => s.assigneeIssue !== null);
  const preview = earlyCompletionPreview(detail.steps);
  const canEarly = active && (caps.start || caps.override);
  const canCancel = active && caps.cancel;
  const reasonOk = reason.trim().length >= 3;

  const submitComplete = () => {
    if (dialog?.kind !== 'complete') return;
    const s = dialog.step;
    const body: Record<string, unknown> = { confirm };
    if (s.completionCondition === 'EVIDENCE_PROVIDED') {
      body.confirm = true;
      if (s.evidenceKind === 'LINK') body.evidenceLink = link;
      else body.evidenceNote = note;
    }
    if (s.completionCondition === 'ASANA_PROJECT_LINKED') {
      body.confirm = true;
      body.asanaProjectGid = asanaGid;
    }
    if (s.completionCondition === 'CALENDAR_EVENT_LINKED') {
      body.confirm = true;
      body.calendarEventId = calendarEventId;
    }
    void run(() => onboardingExecutionService.stepAction(id, s.stepKey, 'complete', body), `Etapa "${s.title}" concluída.`);
  };

  const completeReady = (s: ExecutionStepView) => {
    if (s.completionCondition === 'EVIDENCE_PROVIDED') return s.evidenceKind === 'LINK' ? link.trim().length > 0 : note.trim().length > 0;
    if (s.completionCondition === 'ASANA_PROJECT_LINKED') return asanaGid.trim().length > 0;
    if (s.completionCondition === 'CALENDAR_EVENT_LINKED') return calendarEventId.trim().length > 0;
    return confirm;
  };

  return (
    <OnboardingShell
      tabs={false}
      title={detail.clientName}
      subtitle={
        <>
          <Link to="/onboarding/execucoes" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowLeft size={14} /> Acompanhamento
          </Link>
          {' · '}
          {detail.templateName} · v{detail.versionNumber}
        </>
      }
      actions={
        <>
          {canEarly ? (
            <Button variant="secondary" onClick={() => openDialog({ kind: 'early' })} data-testid="early-complete">
              <CheckCircle2 size={16} /> Concluir antecipadamente
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="danger" onClick={() => openDialog({ kind: 'cancel' })} data-testid="cancel-execution">
              <Ban size={16} /> Cancelar onboarding
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.badges} data-testid="execution-state">
        <Badge variant={status.tone}>{status.label}</Badge>
        {detail.completionMode ? <Badge variant="neutral">{detail.completionMode === 'AUTO' ? 'Conclusão automática' : 'Conclusão antecipada'}</Badge> : null}
        {detail.counts.late > 0 ? <Badge variant="warning">{detail.counts.late} atrasada(s)</Badge> : null}
        {detail.counts.blocked > 0 ? <Badge variant="danger">{detail.counts.blocked} bloqueada(s)</Badge> : null}
        {detail.counts.unresolved > 0 ? <Badge variant="warning">{detail.counts.unresolved} sem responsável elegível</Badge> : null}
        <Badge variant="neutral">Iniciado em {formatDay(detail.startedAt)}</Badge>
      </div>

      <div>
        <div className={styles.progress} role="progressbar" aria-valuenow={detail.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do onboarding">
          <div className={styles.progressBar} style={{ width: `${detail.progress.percent}%` }} />
        </div>
        <span className={styles.progressText} data-testid="progress-text">{detail.progress.closed} de {detail.progress.total} etapas encerradas ({detail.progress.percent}%)</span>
      </div>

      {notice ? <Banner kind={notice.kind} testId="onboarding-notice">{notice.text}</Banner> : null}

      {conflict ? (
        <Banner
          kind="danger"
          testId="conflict-banner"
          actions={<Button size="sm" onClick={() => void load()}>Recarregar</Button>}
        >
          Esta ação não foi aplicada porque o onboarding mudou enquanto você a preparava: {conflict} Nenhum dado foi sobrescrito; a tela foi atualizada com a situação atual.
        </Banner>
      ) : null}

      {detail.status === 'CANCELLED' ? (
        <Banner kind="warn" testId="cancelled-banner">Onboarding cancelado{detail.cancelReason ? `: ${detail.cancelReason}` : '.'}</Banner>
      ) : null}

      {active && attention.length > 0 ? (
        <section className={`${styles.panel}`} aria-labelledby="attention-title" data-testid="attention-panel">
          <h2 id="attention-title" className={styles.panelTitle}>Atribuições para resolver ({attention.length})</h2>
          <ul className={styles.attention}>
            {attention.map((s) => (
              <li key={s.stepKey}>
                <strong>{s.title}</strong>: {assigneeIssueMessage(s.assigneeIssue)}
              </li>
            ))}
          </ul>
          {!caps.override ? <p className={styles.help}>Peça a quem tem permissão de exceção para atribuir um responsável.</p> : null}
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="exec-steps-title">
        <h2 id="exec-steps-title" className={styles.panelTitle}>Etapas ({detail.steps.length})</h2>
        <ol className={styles.stepList} data-testid="exec-step-list">
          {detail.steps.map((s) => {
            const badges = stepBadges({ ...s, automatic: s.kind === 'AUTOMATION' });
            const open = isOpenStatus(s.status);
            return (
              <li
                key={s.stepKey}
                className={`${styles.execStep} ${s.blocked && open ? styles.execStepBlocked : ''} ${s.late ? styles.execStepLate : ''} ${!open ? styles.execStepDone : ''}`}
                data-testid="exec-step"
                data-step-key={s.stepKey}
                data-status={s.status}
              >
                <div className={styles.execStepHead}>
                  <h3 className={styles.execStepTitle}>{s.position + 1}. {s.title}</h3>
                  <div className={styles.badges}>
                    {badges.map((b) => (
                      <Badge key={b.key} variant={b.tone}>{b.label}</Badge>
                    ))}
                    {s.blocksCompletion ? <Badge variant="info">Obrigatória para concluir</Badge> : null}
                  </div>
                </div>
                {s.description ? <p className={styles.execNote}>{s.description}</p> : null}
                <div className={styles.execMeta}>
                  <span>Responsável: {s.assigneeName ?? (s.functionName ? `função ${s.functionName} (sem pessoa elegível)` : 'não atribuído')}</span>
                  {s.functionName && s.assigneeName ? <span>Função: {s.functionName}</span> : null}
                  <span>Prazo: {s.dueDate ? formatDay(s.dueDate) : s.status === 'WAITING' ? 'definido ao liberar' : 'sem prazo'}</span>
                  {s.dependsOn.length > 0 ? <span>Depende de: {s.dependsOn.map((k) => titleOf.get(k) ?? k).join(', ')}</span> : null}
                  {s.completedAt ? <span>Encerrada em {formatDay(s.completedAt)}</span> : null}
                </div>
                {s.blocked && s.blockedReason ? <p className={styles.execDanger}>Bloqueada: {s.blockedReason}</p> : null}
                {s.skipReason ? <p className={styles.execNote}>Justificativa da dispensa: {s.skipReason}</p> : null}
                {s.evidenceLink ? (
                  <p className={styles.execNote}>
                    Evidência: <a className={styles.linkInline} href={s.evidenceLink} target="_blank" rel="noopener noreferrer">{s.evidenceLink}</a>
                  </p>
                ) : null}
                {s.evidenceNote ? <p className={styles.execNote}>Evidência: {s.evidenceNote}</p> : null}
                {s.asanaProjectGid ? <p className={styles.execNote}>Projeto do Asana vinculado: {s.asanaProjectGid}</p> : null}
                {s.calendarEvent ? (
                  <p className={styles.execNote} data-testid="calendar-snapshot">
                    Evento do Calendar usado: {s.calendarEvent.title ?? 'sem título'}
                    {s.calendarEvent.startAt ? ` (${formatDay(s.calendarEvent.startAt)})` : ''}
                  </p>
                ) : null}
                {s.calendarCondition ? (
                  <div data-testid="calendar-condition" data-state={s.calendarCondition.state}>
                    <p className={calendarConditionText(s.calendarCondition).tone === 'success' ? styles.execNote : styles.execWarn}>
                      <strong>{calendarConditionText(s.calendarCondition).label}.</strong> {calendarConditionText(s.calendarCondition).message}{' '}
                      <Link className={styles.linkInline} to="/agenda">Abrir a Agenda</Link>
                    </p>
                    {s.calendarCondition.ineligible.length > 0 ? (
                      <p className={styles.help}>
                        Eventos vinculados que não servem: {s.calendarCondition.ineligible.map((c) => `${c.title} (${c.reason})`).join('; ')}.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {s.automation ? (
                  <div data-testid="automation-block" data-automation-status={s.automation.status ?? 'NONE'}>
                    {(() => {
                      const a = s.automation;
                      const st = automationStatusText(a.status);
                      const stepNotice = automationNotice(
                        { flowKey: a.flowKey, status: a.status, dispatcherEnabled: a.dispatcherEnabled, appliedAt: a.appliedAt },
                        s.blocked
                      );
                      const stepHistory = history.filter((h) => h.stepKey === s.stepKey && h.eventType === 'STEP_AUTOMATION');
                      const failed = a.status === 'FAILED' || a.status === 'TIMED_OUT' || a.status === 'DEAD';
                      return (
                        <>
                          <p className={a.status === 'SUCCEEDED' ? styles.execNote : failed ? styles.execDanger : styles.execWarn}>
                            <strong data-testid="automation-status">Automação: {st.label}.</strong> {st.help}
                          </p>
                          <p className={styles.help}>
                            Fluxo: {a.flowKey ?? 'não definido'}
                            {a.generation ? ' · execução ' + a.generation : ''}
                            {a.attempts > 0 ? ' · ' + a.attempts + ' envio(s)' : ''}
                            {a.sentAt ? ' · enviada em ' + fmtDateTime(a.sentAt) : ''}
                            {a.finishedAt ? ' · encerrada em ' + fmtDateTime(a.finishedAt) : ''}
                          </p>
                          {a.lastError && a.lastError !== a.resultMessage ? <p className={styles.execDanger} data-testid="automation-error">Detalhe: {a.lastError}</p> : null}
                          {a.resultMessage || a.resultCode ? (
                            <p className={styles.execNote} data-testid="automation-result">
                              Resultado{a.resultCode ? ' (' + a.resultCode + ')' : ''}: {a.resultMessage ?? 'sem mensagem'}
                            </p>
                          ) : null}
                          {a.externalRefs.length > 0 ? (
                            <ul className={styles.help} data-testid="automation-refs">
                              {a.externalRefs.map((r, i) => {
                                const href = safeExternalUrl(r.url);
                                return (
                                  <li key={i}>
                                    {href ? <a className={styles.linkInline} href={href} target="_blank" rel="noopener noreferrer">{r.label}</a> : r.label}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                          {s.completedBySystem ? <p className={styles.execNote} data-testid="completed-by-system">Concluída automaticamente pelo resultado do n8n.</p> : null}
                          {stepNotice ? <p className={styles.execWarn} role="status" data-testid="automation-notice-step">{stepNotice.text}</p> : null}
                          {a.canResend && caps.override ? (
                            <div className={styles.execActions} data-testid="automation-actions">
                              <Button size="sm" variant="secondary" disabled={busy} data-testid="action-resend" onClick={() => openDialog({ kind: 'resend', step: s, mode: 'RETRY' })}>
                                Reenviar
                              </Button>
                              <Button size="sm" variant="secondary" disabled={busy} data-testid="action-redo" onClick={() => openDialog({ kind: 'resend', step: s, mode: 'REDO' })}>
                                Refazer
                              </Button>
                            </div>
                          ) : a.canResend ? (
                            <p className={styles.help} data-testid="automation-noperm">
                              Reenviar ou refazer exige a permissão de exceção do onboarding. Fale com quem administra o Hub.
                            </p>
                          ) : null}
                          {stepHistory.length > 0 ? (
                            <ul className={styles.help} data-testid="automation-history">
                              {stepHistory.map((h) => (
                                <li key={h.id}>
                                  Execução {h.generation}: {automationStatusText(h.status).label} · {h.attempts} envio(s)
                                  {h.finishedAt ? ' · ' + fmtDateTime(h.finishedAt) : ''}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                ) : null}
                {open && assigneeIssueMessage(s.assigneeIssue) ? <p className={styles.execWarn}>{assigneeIssueMessage(s.assigneeIssue)}</p> : null}
                {s.actions.length > 0 ? (
                  <div className={styles.execActions} data-testid="step-actions">
                    {s.actions.map((a) => (
                      <Button
                        key={a}
                        size="sm"
                        variant={a === 'complete' ? 'primary' : a === 'skip' ? 'warning' : 'secondary'}
                        disabled={busy}
                        data-testid={`action-${a}`}
                        onClick={() => (a === 'start' ? void quickStart(s) : openDialog({ kind: a, step: s }))}
                      >
                        {ACTION_LABEL[a]}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section className={styles.panel} aria-labelledby="history-exec-title" data-testid="execution-history">
        <h2 id="history-exec-title" className={styles.panelTitle}>Histórico</h2>
        <ul className={styles.eventList}>
          {detail.events.map((e) => (
            <li key={e.id} className={`${styles.event} ${isHighlightedEvent(e) ? styles.eventHighlight : ''}`} data-event-type={e.type}>
              <span>
                <strong>{eventLabel(e.type)}</strong>
                {e.stepKey ? ` — ${titleOf.get(e.stepKey) ?? e.stepKey}` : ''}
                {isHighlightedEvent(e) ? ' (etapa obrigatória dispensada)' : ''}
              </span>
              {e.reason ? <span>Justificativa: {e.reason}</span> : null}
              <span className={styles.eventMeta}>{fmtDateTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : isAutomationEvent(e.type) || (e.after as { completedBySystem?: boolean } | null)?.completedBySystem ? ' · Sistema' : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------- dialogos ---------------------------- */}
      <Dialog open={dialog !== null} onOpenChange={(open) => !busy && !open && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === 'complete' ? (
            <>
              <DialogHeader>
                <DialogTitle>Concluir etapa</DialogTitle>
                <DialogDescription>{dialog.step.title}</DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                {dialog.step.completionCondition === 'EVIDENCE_PROVIDED' ? (
                  dialog.step.evidenceKind === 'LINK' ? (
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="ev-link">Link da evidência</label>
                      <input id="ev-link" className={styles.input} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
                    </div>
                  ) : (
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="ev-note">Nota da evidência</label>
                      <textarea id="ev-note" className={styles.textarea} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                  )
                ) : dialog.step.completionCondition === 'CALENDAR_EVENT_LINKED' ? (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="calendar-event">Evento do Calendar vinculado ao cliente</label>
                    {dialog.step.calendarCondition && dialog.step.calendarCondition.state === 'MET' ? (
                      <select id="calendar-event" className={styles.select} value={calendarEventId} onChange={(e) => setCalendarEventId(e.target.value)}>
                        <option value="">Escolha o evento</option>
                        {dialog.step.calendarCondition.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}{c.startAt ? ` — ${formatDay(c.startAt)}` : c.startDate ? ` — ${formatDay(c.startDate)}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className={styles.execWarn} role="alert" data-testid="calendar-dialog-blocked">
                        {dialog.step.calendarCondition ? calendarConditionText(dialog.step.calendarCondition).message : 'Condição do Calendar indisponível.'}
                      </p>
                    )}
                    <p className={styles.help}>Somente leitura: o Hub usa eventos já sincronizados e não altera nada no Google.</p>
                  </div>
                ) : dialog.step.completionCondition === 'ASANA_PROJECT_LINKED' ? (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="asana-project">Projeto do Asana vinculado ao cliente</label>
                    {asanaProjects && asanaProjects.length > 0 ? (
                      <select id="asana-project" className={styles.select} value={asanaGid} onChange={(e) => setAsanaGid(e.target.value)}>
                        <option value="">Escolha o projeto</option>
                        {asanaProjects.map((p) => (
                          <option key={p.integrationId} value={p.projectGid}>{p.projectName}</option>
                        ))}
                      </select>
                    ) : asanaProjects === null ? (
                      <p className={styles.help}>Carregando projetos vinculados...</p>
                    ) : (
                      <>
                        <p className={styles.help}>
                          {asanaError
                            ? 'Não foi possível listar os projetos agora.'
                            : 'Este cliente ainda não tem projeto do Asana vinculado.'}{' '}
                          Esta etapa só confirma um vínculo já existente; o Hub não cria nem altera nada no Asana.
                        </p>
                        <input id="asana-project" className={styles.input} value={asanaGid} onChange={(e) => setAsanaGid(e.target.value)} placeholder="Identificador do projeto vinculado" />
                      </>
                    )}
                  </div>
                ) : (
                  <label className={styles.check}>
                    <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                    <span>Confirmo que esta etapa foi concluída.</span>
                  </label>
                )}
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button onClick={submitComplete} disabled={busy || !completeReady(dialog.step)} data-testid="confirm-complete">
                  {busy ? 'Concluindo...' : 'Concluir etapa'}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'block' ? (
            <>
              <DialogHeader>
                <DialogTitle>Bloquear etapa</DialogTitle>
                <DialogDescription>{dialog.step.title}. A etapa bloqueada não pode ser concluída até ser desbloqueada.</DialogDescription>
              </DialogHeader>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reason">Motivo do bloqueio</label>
                <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button
                  disabled={busy || !reasonOk}
                  data-testid="confirm-block"
                  onClick={() => void run(() => onboardingExecutionService.stepAction(id, dialog.step.stepKey, 'block', { reason }), 'Etapa bloqueada.')}
                >
                  Bloquear
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'unblock' ? (
            <>
              <DialogHeader>
                <DialogTitle>Desbloquear etapa</DialogTitle>
                <DialogDescription>{dialog.step.title}. Bloqueio atual: {dialog.step.blockedReason}</DialogDescription>
              </DialogHeader>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reason">Observação (opcional)</label>
                <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button
                  disabled={busy}
                  data-testid="confirm-unblock"
                  onClick={() => void run(() => onboardingExecutionService.stepAction(id, dialog.step.stepKey, 'unblock', reason.trim() ? { reason } : {}), 'Etapa desbloqueada.')}
                >
                  Desbloquear
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'resend' ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.mode === 'RETRY' ? 'Reenviar automação' : 'Refazer automação'}</DialogTitle>
                <DialogDescription>
                  {dialog.step.title}.{' '}
                  {dialog.mode === 'RETRY'
                    ? 'O mesmo pedido volta para a fila com a mesma chave de idempotência; o fluxo deve ignorar repetições já processadas.'
                    : 'Um novo pedido é registrado com nova chave. Resultados do pedido anterior deixam de valer. Pode repetir efeitos se o fluxo anterior chegou a executar.'}
                </DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reason">Justificativa</label>
                  <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                {dialog.mode === 'REDO' ? (
                  <label className={styles.check}>
                    <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                    <span>Entendo que isto cria um novo pedido e invalida o anterior.</span>
                  </label>
                ) : null}
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button disabled={busy || !reasonOk || (dialog.mode === 'REDO' && !confirm)} data-testid="confirm-resend" onClick={() => void submitResend()}>
                  {dialog.mode === 'RETRY' ? 'Reenviar' : 'Refazer'}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'skip' ? (
            <>
              <DialogHeader>
                <DialogTitle>Dispensar etapa</DialogTitle>
                <DialogDescription>
                  {dialog.step.title}. Ação excepcional: a etapa é encerrada sem ser executada e libera as etapas que dependem dela.
                </DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                {dialog.step.blocksCompletion ? (
                  <p className={styles.execWarn} role="alert">
                    Esta etapa é obrigatória para concluir o onboarding. A dispensa ficará destacada no histórico.
                  </p>
                ) : null}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reason">Justificativa</label>
                  <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <label className={styles.check}>
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  <span>Entendo que esta ação não pode ser desfeita.</span>
                </label>
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button
                  variant="danger"
                  disabled={busy || !reasonOk || !confirm}
                  data-testid="confirm-skip"
                  onClick={() => void run(() => onboardingExecutionService.stepAction(id, dialog.step.stepKey, 'skip', { reason }), 'Etapa dispensada.')}
                >
                  Dispensar etapa
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'reassign' ? (
            <>
              <DialogHeader>
                <DialogTitle>Reatribuir etapa</DialogTitle>
                <DialogDescription>
                  {dialog.step.title}. A pessoa precisa estar ativa e ter este cliente na carteira; a execução não amplia carteiras.
                </DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="assignee">Novo responsável</label>
                  <select id="assignee" className={styles.select} value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)}>
                    <option value="">Escolha uma pessoa</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reason">Justificativa</label>
                  <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                {dialogError ? <p className={styles.fieldError} role="alert" data-testid="dialog-error">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button
                  disabled={busy || !reasonOk || !newAssignee}
                  data-testid="confirm-reassign"
                  onClick={() =>
                    void run(
                      () => onboardingExecutionService.stepAction(id, dialog.step.stepKey, 'reassign', { memberId: newAssignee, reason }),
                      'Responsável alterado.'
                    )
                  }
                >
                  Reatribuir
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'early' ? (
            <>
              <DialogHeader>
                <DialogTitle>Concluir antecipadamente</DialogTitle>
                <DialogDescription>
                  Encerra o onboarding agora. As etapas ainda abertas serão dispensadas, com a justificativa abaixo, e nenhuma etapa fica aberta.
                </DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                {preview.blockingOpen.length > 0 ? (
                  <p className={styles.execDanger} role="alert" data-testid="early-blocked">
                    Não é possível concluir: há etapas obrigatórias abertas ({preview.blockingOpen.map((s) => s.title).join(', ')}). Conclua ou dispense essas etapas antes.
                  </p>
                ) : (
                  <>
                    {preview.toSkip.length > 0 ? (
                      <div>
                        <p className={styles.label}>Serão dispensadas ({preview.toSkip.length}):</p>
                        <ul className={styles.attention}>
                          {preview.toSkip.map((s) => (
                            <li key={s.stepKey}>{s.title}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {preview.toSkip.length > 0 ? (
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="reason">Justificativa</label>
                        <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                      </div>
                    ) : null}
                    <label className={styles.check}>
                      <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                      <span>Entendo que esta ação não pode ser desfeita.</span>
                    </label>
                  </>
                )}
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button
                  disabled={busy || preview.blockingOpen.length > 0 || !confirm || (preview.toSkip.length > 0 && !reasonOk)}
                  data-testid="confirm-early"
                  onClick={() =>
                    void run(() => onboardingExecutionService.completeEarly(id, preview.toSkip.length > 0 ? reason : undefined), 'Onboarding concluído antecipadamente.')
                  }
                >
                  Concluir onboarding
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog?.kind === 'cancel' ? (
            <>
              <DialogHeader>
                <DialogTitle>Cancelar onboarding</DialogTitle>
                <DialogDescription>
                  As etapas abertas serão canceladas e o onboarding não poderá ser retomado. Depois disso, um novo onboarding deste modelo pode ser iniciado para o cliente.
                </DialogDescription>
              </DialogHeader>
              <div className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reason">Motivo do cancelamento</label>
                  <textarea id="reason" className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <label className={styles.check}>
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  <span>Entendo que esta ação não pode ser desfeita.</span>
                </label>
                {dialogError ? <p className={styles.fieldError} role="alert">{dialogError}</p> : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Voltar</Button>
                <Button
                  variant="danger"
                  disabled={busy || !reasonOk || !confirm}
                  data-testid="confirm-cancel"
                  onClick={() => void run(() => onboardingExecutionService.cancel(id, reason), 'Onboarding cancelado.')}
                >
                  Cancelar onboarding
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </OnboardingShell>
  );
}
