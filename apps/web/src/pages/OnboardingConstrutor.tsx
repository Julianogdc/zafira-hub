import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { OnboardingStepInput, OnboardingTemplateScopeKind } from '@zafira/contracts';
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
import { StepEditor } from '@/components/onboarding/StepEditor';
import {
  ASSIGNEE_REMOVED_LABEL,
  FUNCTION_REMOVED_LABEL,
  STEP_KIND_OPTIONS,
  groupProblemsByStep,
  moveStep,
  newStep,
  removeStep,
  stepsEqual,
} from '@/lib/onboarding-builder';
import {
  OnboardingMemberView,
  OnboardingProblemView,
  OnboardingTemplateDetail,
  OrganizationFunctionView,
  SCOPE_KIND_LABEL,
  onboardingErrorInfo,
  onboardingService,
} from '@/services/onboarding';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import { automationService, useAutomationCapabilities, type AutomationFlowView } from '@/services/automation';
import styles from './Onboarding.module.css';

type Busy = 'save' | 'validate' | 'publish' | 'draft' | 'discard' | 'meta' | 'archive' | null;

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

/** F7-1b — Construtor visual de um modelo de onboarding (rascunho, validação, publicação, versões). */
export default function OnboardingConstrutor() {
  const { id = '' } = useParams();
  const { currentOrganization } = useAuthStore();
  const caps = useOnboardingCapabilities(currentOrganization?.id);
  const autoCaps = useAutomationCapabilities(currentOrganization?.id);
  const [flows, setFlows] = useState<AutomationFlowView[] | null>(null);

  const [tpl, setTpl] = useState<OnboardingTemplateDetail | null>(null);
  const [functions, setFunctions] = useState<OrganizationFunctionView[]>([]);
  const [members, setMembers] = useState<OnboardingMemberView[]>([]);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);

  const [steps, setSteps] = useState<OnboardingStepInput[]>([]);
  const [baseline, setBaseline] = useState<OnboardingStepInput[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [problems, setProblems] = useState<OnboardingProblemView[]>([]);
  const [validatedOk, setValidatedOk] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [meta, setMeta] = useState<{ name: string; description: string; scopeKind: OnboardingTemplateScopeKind; scopeLabel: string }>({
    name: '',
    description: '',
    scopeKind: 'GENERAL',
    scopeLabel: '',
  });
  const [metaError, setMetaError] = useState<string | null>(null);

  const applyDetail = useCallback((detail: OnboardingTemplateDetail) => {
    setTpl(detail);
    const next = detail.draft?.steps ?? detail.published?.steps ?? [];
    setSteps(next);
    setBaseline(next);
    setSelectedKey((current) => (current && next.some((s) => s.stepKey === current) ? current : next[0]?.stepKey ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [detail, fns, people] = await Promise.all([
        onboardingService.getTemplate(id),
        onboardingService.listFunctions(),
        onboardingService.listMembers(),
      ]);
      setFunctions(fns);
      setMembers(people);
      applyDetail(detail);
      setConflict(false);
      setProblems([]);
      setValidatedOk(false);
    } catch (error) {
      const info = onboardingErrorInfo(error);
      setLoadError({ status: info.status, message: info.message });
      setTpl(null);
    }
  }, [id, applyDetail]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  const draft = tpl?.draft ?? null;
  const archived = tpl?.status === 'ARCHIVED';
  useEffect(() => {
    if (autoCaps.loading || !autoCaps.view) {
      setFlows(null);
      return;
    }
    let alive = true;
    automationService
      .flows()
      .then((f) => alive && setFlows(f))
      .catch(() => alive && setFlows(null));
    return () => {
      alive = false;
    };
  }, [autoCaps.loading, autoCaps.view]);

  const editable = Boolean(caps.manageTemplates && draft && !archived);
  const dirty = editable && !stepsEqual(steps, baseline);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const problemsByStep = useMemo(() => groupProblemsByStep(problems), [problems]);
  const selectedIndex = steps.findIndex((s) => s.stepKey === selectedKey);
  const selected = selectedIndex >= 0 ? steps[selectedIndex] : null;

  const edit = (next: OnboardingStepInput[]) => {
    setSteps(next);
    setValidatedOk(false);
    setNotice(null);
  };

  const handleError = (error: unknown) => {
    const info = onboardingErrorInfo(error);
    if (info.code === 'STALE_DRAFT') {
      setConflict(true);
      return;
    }
    if (info.problems.length > 0) setProblems(info.problems);
    setNotice({ kind: info.status === 400 || info.status === 409 ? 'warn' : 'danger', text: info.message });
  };

  /** Salva o rascunho; devolve a versão atualizada ou null em caso de falha. */
  const save = async (): Promise<OnboardingTemplateDetail | null> => {
    if (!tpl || !draft) return null;
    setBusy('save');
    try {
      const detail = await onboardingService.saveDraft(tpl.id, draft.id, draft.updatedAt, steps);
      applyDetail(detail);
      setProblems([]);
      return detail;
    } catch (error) {
      handleError(error);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    const detail = await save();
    if (detail) setNotice({ kind: 'ok', text: 'Rascunho salvo.' });
  };

  const onValidate = async () => {
    if (!tpl || !draft) return;
    let current = tpl;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
      current = saved;
    }
    const versionId = current.draft?.id;
    if (!versionId) return;
    setBusy('validate');
    try {
      const result = await onboardingService.validateVersion(current.id, versionId);
      setProblems(result.problems);
      setValidatedOk(result.publishable);
      setNotice(
        result.publishable
          ? { kind: 'ok', text: 'Tudo certo: o modelo pode ser publicado.' }
          : { kind: 'warn', text: `${result.problems.length} ${result.problems.length === 1 ? 'problema impede' : 'problemas impedem'} a publicação.` }
      );
      const first = result.problems.find((p) => p.stepKey);
      if (first?.stepKey) setSelectedKey(first.stepKey);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(null);
    }
  };

  const onPublish = async () => {
    if (!tpl || !draft) return;
    let current = tpl;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
      current = saved;
    }
    const version = current.draft;
    if (!version) return;
    setBusy('publish');
    try {
      const detail = await onboardingService.publish(current.id, version.id, version.updatedAt, changeNote);
      setPublishOpen(false);
      setChangeNote('');
      setProblems([]);
      setValidatedOk(false);
      applyDetail(detail);
      setNotice({ kind: 'ok', text: `Versão ${detail.published?.versionNumber ?? ''} publicada. Ela agora é imutável.` });
    } catch (error) {
      setPublishOpen(false);
      handleError(error);
    } finally {
      setBusy(null);
    }
  };

  const onCreateDraft = async () => {
    if (!tpl) return;
    setBusy('draft');
    setNotice(null);
    try {
      applyDetail(await onboardingService.createDraft(tpl.id));
      setProblems([]);
      setValidatedOk(false);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(null);
    }
  };

  const onDiscard = async () => {
    if (!tpl || !draft) return;
    setBusy('discard');
    try {
      applyDetail(await onboardingService.discardDraft(tpl.id, draft.id));
      setDiscardOpen(false);
      setProblems([]);
      setNotice({ kind: 'ok', text: 'Rascunho descartado. A versão publicada permanece como estava.' });
    } catch (error) {
      setDiscardOpen(false);
      handleError(error);
    } finally {
      setBusy(null);
    }
  };

  const onToggleArchive = async () => {
    if (!tpl) return;
    setBusy('archive');
    try {
      applyDetail(
        archived ? await onboardingService.reactivateTemplate(tpl.id) : await onboardingService.archiveTemplate(tpl.id)
      );
      setNotice({ kind: 'ok', text: archived ? 'Modelo reativado.' : 'Modelo arquivado.' });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(null);
    }
  };

  const onSaveMeta = async () => {
    if (!tpl) return;
    setBusy('meta');
    setMetaError(null);
    try {
      const detail = await onboardingService.updateTemplate(tpl.id, {
        name: meta.name,
        description: meta.description.trim() ? meta.description : null,
        scopeKind: meta.scopeKind,
        scopeLabel: meta.scopeKind !== 'GENERAL' && meta.scopeLabel.trim() ? meta.scopeLabel : null,
      });
      // preserva alterações locais ainda não salvas das etapas
      setTpl((prev) => (prev ? { ...prev, ...detail, draft: prev.draft, published: prev.published } : detail));
      setMetaOpen(false);
      setNotice({ kind: 'ok', text: 'Dados do modelo atualizados.' });
    } catch (error) {
      setMetaError(onboardingErrorInfo(error).message);
    } finally {
      setBusy(null);
    }
  };

  const assigneeLabel = (s: OnboardingStepInput) => {
    if (s.assigneeMode === 'FUNCTION') {
      const fn = functions.find((f) => f.id === s.functionId);
      if (!s.functionId) return 'Função não escolhida';
      if (!fn) return FUNCTION_REMOVED_LABEL;
      return fn.isActive ? fn.name : `${fn.name} (desativada)`;
    }
    if (s.assigneeMode === 'MEMBER') {
      const m = members.find((x) => x.id === s.memberId);
      if (!s.memberId) return 'Pessoa não escolhida';
      return m ? m.name : ASSIGNEE_REMOVED_LABEL;
    }
    return 'Sem responsável';
  };

  /* ---------------------------------- estados ---------------------------------- */
  if (caps.loading) {
    return (
      <OnboardingShell title="Modelo de onboarding" tabs={false}>
        <LoadingState message="Carregando permissões..." />
      </OnboardingShell>
    );
  }
  if (!caps.view) {
    return (
      <OnboardingShell title="Modelo de onboarding" tabs={false}>
        <PermissionState
          title="Sem permissão para ver este modelo"
          description="Seu perfil não tem acesso ao onboarding desta organização."
        />
      </OnboardingShell>
    );
  }
  if (loadError) {
    return (
      <OnboardingShell title="Modelo de onboarding" tabs={false}>
        <ErrorState
          title={loadError.status === 404 ? 'Modelo não encontrado' : 'Não foi possível carregar o modelo'}
          description={loadError.message}
          onRetry={loadError.status === 404 ? undefined : () => void load()}
        />
        <Link to="/onboarding/modelos">Voltar para a lista de modelos</Link>
      </OnboardingShell>
    );
  }
  if (!tpl) {
    return (
      <OnboardingShell title="Modelo de onboarding" tabs={false}>
        <LoadingState message="Carregando modelo..." />
      </OnboardingShell>
    );
  }

  const publishedNumber = tpl.published?.versionNumber ?? null;
  const showingPublishedOnly = !draft && Boolean(tpl.published);
  const busyAny = busy !== null;

  const stateBadge = archived ? (
    <Badge variant="neutral">Modelo arquivado</Badge>
  ) : draft ? (
    <Badge variant="info">Rascunho v{draft.versionNumber}</Badge>
  ) : (
    <Badge variant="success">Publicado v{publishedNumber}</Badge>
  );

  return (
    <OnboardingShell
      tabs={false}
      title={tpl.name}
      subtitle={
        <>
          <Link to="/onboarding/modelos" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowLeft size={14} /> Modelos
          </Link>
          {tpl.description ? <> · {tpl.description}</> : null}
        </>
      }
      actions={
        <>
          {caps.manageTemplates ? (
            <Button
              variant="ghost"
              disabled={busyAny}
              onClick={() => {
                setMeta({
                  name: tpl.name,
                  description: tpl.description ?? '',
                  scopeKind: tpl.scopeKind,
                  scopeLabel: tpl.scopeLabel ?? '',
                });
                setMetaError(null);
                setMetaOpen(true);
              }}
              data-testid="edit-meta"
            >
              <Pencil size={14} /> Dados do modelo
            </Button>
          ) : null}
          {caps.manageTemplates ? (
            <Button variant="ghost" disabled={busyAny} onClick={() => void onToggleArchive()} data-testid="toggle-archive">
              {archived ? 'Reativar modelo' : 'Arquivar modelo'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.badges} data-testid="template-state">
        {stateBadge}
        {draft && publishedNumber ? <Badge variant="success">Última publicada: v{publishedNumber}</Badge> : null}
        <Badge variant="neutral">
          {SCOPE_KIND_LABEL[tpl.scopeKind]}
          {tpl.scopeLabel ? `: ${tpl.scopeLabel}` : ''}
        </Badge>
        {dirty ? <Badge variant="warning">Alterações não salvas</Badge> : null}
      </div>

      {notice ? (
        <Banner kind={notice.kind} testId="onboarding-notice">{notice.text}</Banner>
      ) : null}

      {conflict ? (
        <Banner
          kind="danger"
          testId="conflict-banner"
          actions={<Button size="sm" onClick={() => void load()}>Recarregar rascunho</Button>}
        >
          Outra pessoa alterou este rascunho enquanto você editava. Suas alterações locais não foram salvas;
          recarregue para ver a versão mais recente.
        </Banner>
      ) : null}

      {archived ? (
        <Banner kind="warn" testId="archived-banner">
          Este modelo está arquivado: não aceita edição nem publicação até ser reativado.
        </Banner>
      ) : null}

      {!caps.manageTemplates ? (
        <Banner testId="readonly-banner">Você pode consultar este modelo, mas não alterá-lo.</Banner>
      ) : null}

      {showingPublishedOnly && caps.manageTemplates && !archived ? (
        <Banner
          testId="published-banner"
          actions={
            <Button onClick={() => void onCreateDraft()} disabled={busyAny} data-testid="create-draft">
              {busy === 'draft' ? 'Criando rascunho...' : `Editar (criar rascunho v${(publishedNumber ?? 0) + 1})`}
            </Button>
          }
        >
          Versão {publishedNumber} publicada e imutável. Para alterar, crie um rascunho da próxima versão; execuções
          em andamento não são afetadas.
        </Banner>
      ) : null}

      {editable ? (
        <div className={styles.actions} data-testid="builder-actions">
          <Button variant="secondary" onClick={() => void onSave()} disabled={busyAny || !dirty} data-testid="save-draft">
            {busy === 'save' ? 'Salvando...' : 'Salvar rascunho'}
          </Button>
          <Button variant="secondary" onClick={() => void onValidate()} disabled={busyAny} data-testid="validate-draft">
            {busy === 'validate' ? 'Validando...' : 'Validar'}
          </Button>
          <Button
            onClick={() => {
              setChangeNote('');
              setPublishOpen(true);
            }}
            disabled={busyAny || (!validatedOk && problems.length > 0) || steps.length === 0}
            data-testid="publish-draft"
          >
            <CheckCircle2 size={16} /> Publicar
          </Button>
          {publishedNumber ? (
            <Button variant="ghost" onClick={() => setDiscardOpen(true)} disabled={busyAny} data-testid="discard-draft">
              Descartar rascunho
            </Button>
          ) : null}
        </div>
      ) : null}

      {problems.length > 0 ? (
        <section className={`${styles.panel}`} aria-labelledby="problems-title" data-testid="problems-panel">
          <h2 id="problems-title" className={styles.panelTitle}>
            <TriangleAlert size={15} style={{ verticalAlign: '-2px' }} /> Problemas encontrados ({problems.length})
          </h2>
          <ul className={styles.problems}>
            {problems.map((p, i) => (
              <li key={`${p.code}-${p.stepKey ?? 'geral'}-${i}`} className={styles.problemItem}>
                {p.stepKey ? (
                  <button type="button" className={styles.problemLink} onClick={() => setSelectedKey(p.stepKey!)}>
                    {p.message}
                  </button>
                ) : (
                  p.message
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.workspace}>
        <section className={styles.panel} aria-labelledby="steps-title">
          <div className={styles.fnRow}>
            <h2 id="steps-title" className={styles.panelTitle}>Etapas ({steps.length})</h2>
            {editable ? (
              <Button
                size="sm"
                variant="secondary"
                data-testid="add-step"
                disabled={busyAny || steps.length >= 100}
                onClick={() => {
                  const created = newStep();
                  edit([...steps, created]);
                  setSelectedKey(created.stepKey);
                }}
              >
                <Plus size={14} /> Etapa
              </Button>
            ) : null}
          </div>

          {steps.length === 0 ? (
            <p className={styles.readOnlyNote} data-testid="steps-empty">
              {editable
                ? 'Este modelo ainda não tem etapas. Use "+ Etapa" para começar.'
                : 'Este modelo não tem etapas.'}
            </p>
          ) : (
            <ol className={styles.stepList} data-testid="step-list">
              {steps.map((s, index) => {
                const hasProblem = problemsByStep.has(s.stepKey);
                const kindLabel = STEP_KIND_OPTIONS.find((o) => o.value === s.kind)?.label ?? s.kind;
                return (
                  <li
                    key={s.stepKey}
                    className={`${styles.step} ${selectedKey === s.stepKey ? styles.stepSelected : ''} ${
                      hasProblem ? styles.stepProblem : ''
                    }`}
                    data-testid="step-item"
                    data-step-key={s.stepKey}
                  >
                    <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                    <button
                      type="button"
                      className={styles.stepButton}
                      aria-pressed={selectedKey === s.stepKey}
                      onClick={() => setSelectedKey(s.stepKey)}
                    >
                      <span className={`${styles.stepName} ${s.title.trim() ? '' : styles.stepNameEmpty}`}>
                        {hasProblem ? <TriangleAlert size={13} aria-label="Com problema" style={{ marginRight: 4, verticalAlign: '-2px' }} /> : null}
                        {s.title.trim() || 'Etapa sem título'}
                      </span>
                      <span className={styles.stepMeta}>
                        {kindLabel} · {assigneeLabel(s)}
                        {s.dueBusinessDays !== null && s.dueBusinessDays !== undefined ? ` · ${s.dueBusinessDays} d.u.` : ''}
                      </span>
                    </button>
                    {editable ? (
                      <span className={styles.stepTools}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label={`Mover etapa ${index + 1} para cima`}
                          disabled={index === 0 || busyAny}
                          onClick={() => edit(moveStep(steps, s.stepKey, -1))}
                          data-testid="move-up"
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label={`Mover etapa ${index + 1} para baixo`}
                          disabled={index === steps.length - 1 || busyAny}
                          onClick={() => edit(moveStep(steps, s.stepKey, 1))}
                          data-testid="move-down"
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label={`Remover etapa ${index + 1}`}
                          disabled={busyAny}
                          onClick={() => {
                            const next = removeStep(steps, s.stepKey);
                            edit(next);
                            if (selectedKey === s.stepKey) setSelectedKey(next[Math.min(index, next.length - 1)]?.stepKey ?? null);
                          }}
                          data-testid="remove-step"
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="config-title">
          <h2 id="config-title" className={styles.panelTitle}>Configuração da etapa</h2>
          {selected ? (
            <StepEditor
              key={selected.stepKey}
              step={selected}
              index={selectedIndex}
              allSteps={steps}
              functions={functions}
              members={members}
              problems={problemsByStep.get(selected.stepKey) ?? []}
              automationFlows={flows}
              disabled={!editable || busyAny}
              onChange={(next) => edit(steps.map((s) => (s.stepKey === next.stepKey ? next : s)))}
            />
          ) : (
            <p className={styles.readOnlyNote}>Selecione uma etapa para ver ou configurar os detalhes.</p>
          )}
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="history-title" data-testid="version-history">
        <h2 id="history-title" className={styles.panelTitle}>Histórico de versões</h2>
        <ul className={styles.history}>
          {tpl.versions.map((v) => (
            <li key={v.id} className={styles.historyItem} data-version={v.versionNumber} data-status={v.status}>
              <Badge variant={v.status === 'PUBLISHED' ? 'success' : 'info'}>
                v{v.versionNumber} · {v.status === 'PUBLISHED' ? 'Publicada' : 'Rascunho'}
              </Badge>
              {v.publishedAt ? <span>{formatDate(v.publishedAt)}</span> : null}
              {v.changeNote ? <span>{v.changeNote}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={publishOpen} onOpenChange={(open) => busy !== 'publish' && setPublishOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar versão {draft?.versionNumber}</DialogTitle>
            <DialogDescription>
              Depois de publicada, a versão não pode mais ser editada. Mudanças futuras criam uma nova versão e não
              alteram execuções em andamento.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="change-note">Nota da versão</label>
            <textarea
              id="change-note"
              className={styles.textarea}
              value={changeNote}
              maxLength={500}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="O que mudou nesta versão?"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={busy === 'publish'}>Cancelar</Button>
            <Button
              onClick={() => void onPublish()}
              disabled={busy === 'publish' || changeNote.trim().length < 3}
              data-testid="confirm-publish"
            >
              {busy === 'publish' ? 'Publicando...' : 'Publicar versão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={(open) => busy !== 'discard' && setDiscardOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar rascunho</DialogTitle>
            <DialogDescription>
              O rascunho v{draft?.versionNumber} será apagado. A versão publicada v{publishedNumber} não é afetada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardOpen(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void onDiscard()} disabled={busy === 'discard'} data-testid="confirm-discard">
              Descartar rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={metaOpen} onOpenChange={(open) => busy !== 'meta' && setMetaOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dados do modelo</DialogTitle>
            <DialogDescription>Nome, descrição e abrangência. Não criam nova versão.</DialogDescription>
          </DialogHeader>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="meta-name">Nome</label>
              <input id="meta-name" className={styles.input} value={meta.name} maxLength={120} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="meta-desc">Descrição</label>
              <textarea id="meta-desc" className={styles.textarea} value={meta.description} maxLength={2000} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="meta-scope">Vale para</label>
                <select id="meta-scope" className={styles.select} value={meta.scopeKind} onChange={(e) => setMeta({ ...meta, scopeKind: e.target.value as OnboardingTemplateScopeKind })}>
                  {(Object.keys(SCOPE_KIND_LABEL) as OnboardingTemplateScopeKind[]).map((k) => (
                    <option key={k} value={k}>{SCOPE_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              {meta.scopeKind !== 'GENERAL' ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="meta-scope-label">Nome do {SCOPE_KIND_LABEL[meta.scopeKind].toLowerCase()}</label>
                  <input id="meta-scope-label" className={styles.input} value={meta.scopeLabel} maxLength={120} onChange={(e) => setMeta({ ...meta, scopeLabel: e.target.value })} />
                </div>
              ) : null}
            </div>
            {metaError ? <p className={styles.fieldError} role="alert">{metaError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMetaOpen(false)} disabled={busy === 'meta'}>Cancelar</Button>
            <Button onClick={() => void onSaveMeta()} disabled={busy === 'meta' || meta.name.trim().length === 0} data-testid="confirm-meta">
              {busy === 'meta' ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingShell>
  );
}
