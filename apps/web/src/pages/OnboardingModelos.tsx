import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Copy, FilePlus2, ListChecks, RotateCcw } from 'lucide-react';
import type { OnboardingTemplateScopeKind } from '@zafira/contracts';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, EmptyState, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
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
  onboardingErrorInfo,
  onboardingService,
  OnboardingTemplateListItem,
  SCOPE_KIND_LABEL,
} from '@/services/onboarding';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import styles from './Onboarding.module.css';

/** F7-1b — Lista de modelos de onboarding (criar, duplicar, arquivar, reativar). */
export default function OnboardingModelos() {
  const navigate = useNavigate();
  const { currentOrganization } = useAuthStore();
  const caps = useOnboardingCapabilities(currentOrganization?.id);

  const [items, setItems] = useState<OnboardingTemplateListItem[] | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    description: string;
    scopeKind: OnboardingTemplateScopeKind;
    scopeLabel: string;
  }>({ name: '', description: '', scopeKind: 'GENERAL', scopeLabel: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<OnboardingTemplateListItem | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await onboardingService.listTemplates());
    } catch (error) {
      const info = onboardingErrorInfo(error);
      setLoadError({ status: info.status, message: info.message });
      setItems(null);
    }
  }, []);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onboardingService.createTemplate({
        name: form.name,
        description: form.description.trim() ? form.description : null,
        scopeKind: form.scopeKind,
        scopeLabel: form.scopeKind !== 'GENERAL' && form.scopeLabel.trim() ? form.scopeLabel : null,
      });
      setCreateOpen(false);
      navigate(`/onboarding/modelos/${created.id}`);
    } catch (error) {
      setCreateError(onboardingErrorInfo(error).message);
    } finally {
      setCreating(false);
    }
  };

  const run = async (item: OnboardingTemplateListItem, action: 'duplicate' | 'archive' | 'reactivate') => {
    setBusyId(item.id);
    setNotice(null);
    try {
      if (action === 'duplicate') {
        const copy = await onboardingService.duplicateTemplate(item.id);
        setNotice({ kind: 'ok', text: `Modelo duplicado como "${copy.name}".` });
      } else if (action === 'archive') {
        await onboardingService.archiveTemplate(item.id);
        setNotice({ kind: 'ok', text: `Modelo "${item.name}" arquivado.` });
      } else {
        await onboardingService.reactivateTemplate(item.id);
        setNotice({ kind: 'ok', text: `Modelo "${item.name}" reativado.` });
      }
      await load();
    } catch (error) {
      setNotice({ kind: 'danger', text: onboardingErrorInfo(error).message });
    } finally {
      setBusyId(null);
      setArchiveTarget(null);
    }
  };

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
        <PermissionState
          title="Sem permissão para ver o onboarding"
          description={
            caps.error
              ? 'Não foi possível confirmar suas permissões agora. Tente novamente em instantes.'
              : 'Seu perfil não tem acesso aos modelos de onboarding desta organização.'
          }
        />
      </OnboardingShell>
    );
  }

  const canManage = caps.manageTemplates;

  return (
    <OnboardingShell
      title="Onboarding"
      subtitle="Modelos que a equipe usa para receber novos clientes."
      actions={
        canManage ? (
          <Button
            data-testid="new-template"
            onClick={() => {
              setForm({ name: '', description: '', scopeKind: 'GENERAL', scopeLabel: '' });
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            <FilePlus2 size={16} /> Novo modelo
          </Button>
        ) : null
      }
    >
      {notice ? <Banner kind={notice.kind} testId="onboarding-notice">{notice.text}</Banner> : null}
      {!canManage ? (
        <Banner testId="onboarding-readonly">Você pode consultar os modelos, mas não criar nem alterar.</Banner>
      ) : null}

      {loadError ? (
        <ErrorState
          title={loadError.status === 403 ? 'Sem permissão' : 'Não foi possível carregar os modelos'}
          description={loadError.message}
          onRetry={() => void load()}
        />
      ) : items === null ? (
        <LoadingState message="Carregando modelos..." />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="Nenhum modelo criado"
          description={
            canManage
              ? 'Crie o primeiro modelo para configurar o onboarding da sua organização.'
              : 'Ainda não há modelos de onboarding. Peça a quem administra para criar o primeiro.'
          }
          primaryAction={canManage ? { label: 'Novo modelo', onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="template-list">
          {items.map((item) => {
            const archived = item.status === 'ARCHIVED';
            const busy = busyId === item.id;
            return (
              <li
                key={item.id}
                className={`${styles.card} ${archived ? styles.cardArchived : ''}`}
                data-testid="template-card"
                data-template-name={item.name}
                data-status={item.status}
              >
                <div>
                  <h2 className={styles.cardTitle}>
                    <Link to={`/onboarding/modelos/${item.id}`}>{item.name}</Link>
                  </h2>
                  {item.description ? <p className={styles.cardText}>{item.description}</p> : null}
                </div>
                <div className={styles.badges}>
                  {archived ? (
                    <Badge variant="neutral">Arquivado</Badge>
                  ) : item.publishedVersion ? (
                    <Badge variant="success">Publicado v{item.publishedVersion}</Badge>
                  ) : (
                    <Badge variant="warning">Nunca publicado</Badge>
                  )}
                  {item.hasDraft ? <Badge variant="info">Rascunho em andamento</Badge> : null}
                  <Badge variant="neutral">
                    {SCOPE_KIND_LABEL[item.scopeKind]}
                    {item.scopeLabel ? `: ${item.scopeLabel}` : ''}
                  </Badge>
                </div>
                <div className={styles.cardActions}>
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/onboarding/modelos/${item.id}`)}>
                    {canManage && !archived ? 'Abrir e editar' : 'Abrir'}
                  </Button>
                  {canManage ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void run(item, 'duplicate')}
                        data-testid="duplicate-template"
                      >
                        <Copy size={14} /> Duplicar
                      </Button>
                      {archived ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void run(item, 'reactivate')}
                          data-testid="reactivate-template"
                        >
                          <RotateCcw size={14} /> Reativar
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setArchiveTarget(item)}
                          data-testid="archive-template"
                        >
                          <Archive size={14} /> Arquivar
                        </Button>
                      )}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo modelo de onboarding</DialogTitle>
            <DialogDescription>Você configura as etapas na próxima tela. Nada é publicado ainda.</DialogDescription>
          </DialogHeader>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tpl-name">Nome do modelo</label>
              <input
                id="tpl-name"
                className={styles.input}
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex.: Onboarding de gestão de redes sociais"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tpl-desc">Descrição (opcional)</label>
              <textarea
                id="tpl-desc"
                className={styles.textarea}
                value={form.description}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="tpl-scope">Vale para</label>
                <select
                  id="tpl-scope"
                  className={styles.select}
                  value={form.scopeKind}
                  onChange={(e) => setForm({ ...form, scopeKind: e.target.value as OnboardingTemplateScopeKind })}
                >
                  {(Object.keys(SCOPE_KIND_LABEL) as OnboardingTemplateScopeKind[]).map((k) => (
                    <option key={k} value={k}>{SCOPE_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              {form.scopeKind !== 'GENERAL' ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tpl-scope-label">Nome do {SCOPE_KIND_LABEL[form.scopeKind].toLowerCase()}</label>
                  <input
                    id="tpl-scope-label"
                    className={styles.input}
                    value={form.scopeLabel}
                    maxLength={120}
                    onChange={(e) => setForm({ ...form, scopeLabel: e.target.value })}
                  />
                </div>
              ) : null}
            </div>
            {createError ? <p className={styles.fieldError} role="alert">{createError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</Button>
            <Button onClick={() => void create()} disabled={creating || form.name.trim().length === 0} data-testid="confirm-create">
              {creating ? 'Criando...' : 'Criar modelo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveTarget !== null} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar modelo</DialogTitle>
            <DialogDescription>
              "{archiveTarget?.name}" deixa de ser oferecido para novos onboardings. As versões publicadas continuam preservadas e você pode reativá-lo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => archiveTarget && void run(archiveTarget, 'archive')}
              data-testid="confirm-archive"
            >
              Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingShell>
  );
}
