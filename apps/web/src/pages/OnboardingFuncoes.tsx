import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Users } from 'lucide-react';
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
  OnboardingMemberView,
  OrganizationFunctionView,
  onboardingErrorInfo,
  onboardingService,
} from '@/services/onboarding';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import styles from './Onboarding.module.css';

/**
 * F7-1b — Funções operacionais (ex.: "Designer", "Tráfego").
 * Uma função NÃO concede permissão nenhuma: só indica quem executa etapas (DEC-F7-005).
 */
export default function OnboardingFuncoes() {
  const { currentOrganization } = useAuthStore();
  const caps = useOnboardingCapabilities(currentOrganization?.id);

  const [functions, setFunctions] = useState<OrganizationFunctionView[] | null>(null);
  const [members, setMembers] = useState<OnboardingMemberView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);

  const [nameDialog, setNameDialog] = useState<{ mode: 'create' } | { mode: 'rename'; fn: OrganizationFunctionView } | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const [membersDialog, setMembersDialog] = useState<OrganizationFunctionView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [fns, people] = await Promise.all([onboardingService.listFunctions(), onboardingService.listMembers()]);
      setFunctions(fns);
      setMembers(people);
    } catch (error) {
      setLoadError(onboardingErrorInfo(error).message);
      setFunctions(null);
    }
  }, []);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  const nameOf = (memberId: string) => members.find((m) => m.id === memberId)?.name ?? 'Pessoa removida ou inativa';

  const submitName = async () => {
    if (!nameDialog) return;
    setSaving(true);
    setNameError(null);
    try {
      if (nameDialog.mode === 'create') {
        await onboardingService.createFunction(nameValue);
        setNotice({ kind: 'ok', text: `Função "${nameValue.trim()}" criada.` });
      } else {
        await onboardingService.updateFunction(nameDialog.fn.id, { name: nameValue });
        setNotice({ kind: 'ok', text: 'Nome da função atualizado.' });
      }
      setNameDialog(null);
      await load();
    } catch (error) {
      setNameError(onboardingErrorInfo(error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (fn: OrganizationFunctionView) => {
    setNotice(null);
    try {
      await onboardingService.updateFunction(fn.id, { isActive: !fn.isActive });
      setNotice({
        kind: 'ok',
        text: fn.isActive
          ? `Função "${fn.name}" desativada. Modelos já publicados continuam como estão; novas publicações exigem outra função.`
          : `Função "${fn.name}" reativada.`,
      });
      await load();
    } catch (error) {
      setNotice({ kind: 'danger', text: onboardingErrorInfo(error).message });
    }
  };

  const saveMembers = async () => {
    if (!membersDialog) return;
    setSaving(true);
    setMembersError(null);
    try {
      await onboardingService.setFunctionMembers(membersDialog.id, selected);
      setNotice({ kind: 'ok', text: `Pessoas da função "${membersDialog.name}" atualizadas.` });
      setMembersDialog(null);
      await load();
    } catch (error) {
      setMembersError(onboardingErrorInfo(error).message);
    } finally {
      setSaving(false);
    }
  };

  if (caps.loading) {
    return (
      <OnboardingShell title="Funções" tabs={false}>
        <LoadingState message="Carregando permissões..." />
      </OnboardingShell>
    );
  }
  if (!caps.view) {
    return (
      <OnboardingShell title="Funções" tabs={false}>
        <PermissionState
          title="Sem permissão para ver as funções"
          description="Seu perfil não tem acesso ao onboarding desta organização."
        />
      </OnboardingShell>
    );
  }

  const canManage = caps.manageFunctions;

  return (
    <OnboardingShell
      title="Funções"
      subtitle="Quem executa o quê no onboarding. Uma função não concede nenhuma permissão no Hub."
      actions={
        canManage ? (
          <Button
            data-testid="new-function"
            onClick={() => {
              setNameValue('');
              setNameError(null);
              setNameDialog({ mode: 'create' });
            }}
          >
            <Plus size={16} /> Nova função
          </Button>
        ) : null
      }
    >
      {notice ? <Banner kind={notice.kind} testId="onboarding-notice">{notice.text}</Banner> : null}
      {!canManage ? <Banner testId="onboarding-readonly">Você pode consultar as funções, mas não alterá-las.</Banner> : null}

      {loadError ? (
        <ErrorState title="Não foi possível carregar as funções" description={loadError} onRetry={() => void load()} />
      ) : functions === null ? (
        <LoadingState message="Carregando funções..." />
      ) : functions.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nenhuma função criada"
          description={
            canManage
              ? 'Crie funções (por exemplo, Designer ou Atendimento) para atribuir etapas de onboarding.'
              : 'Ainda não há funções. Peça a quem administra para criá-las.'
          }
          primaryAction={canManage ? { label: 'Nova função', onClick: () => setNameDialog({ mode: 'create' }) } : undefined}
        />
      ) : (
        <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="function-list">
          {functions.map((fn) => (
            <li key={fn.id} className={`${styles.card} ${fn.isActive ? '' : styles.cardArchived}`} data-testid="function-card" data-function-name={fn.name}>
              <div className={styles.fnRow}>
                <h2 className={styles.cardTitle}>{fn.name}</h2>
                <Badge variant={fn.isActive ? 'success' : 'neutral'}>{fn.isActive ? 'Ativa' : 'Desativada'}</Badge>
              </div>
              <p className={styles.fnMembers}>
                {fn.memberIds.length === 0
                  ? 'Nenhuma pessoa nesta função.'
                  : fn.memberIds.map(nameOf).join(', ')}
              </p>
              {canManage ? (
                <div className={styles.cardActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="edit-function-members"
                    onClick={() => {
                      setSelected(fn.memberIds);
                      setMembersError(null);
                      setMembersDialog(fn);
                    }}
                  >
                    <Users size={14} /> Pessoas
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNameValue(fn.name);
                      setNameError(null);
                      setNameDialog({ mode: 'rename', fn });
                    }}
                  >
                    <Pencil size={14} /> Renomear
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void toggleActive(fn)} data-testid="toggle-function">
                    {fn.isActive ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={nameDialog !== null} onOpenChange={(open) => !saving && !open && setNameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'rename' ? 'Renomear função' : 'Nova função'}</DialogTitle>
            <DialogDescription>O nome aparece nos modelos de onboarding.</DialogDescription>
          </DialogHeader>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="fn-name">Nome da função</label>
            <input
              id="fn-name"
              className={styles.input}
              value={nameValue}
              maxLength={80}
              onChange={(e) => setNameValue(e.target.value)}
            />
            {nameError ? <p className={styles.fieldError} role="alert">{nameError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNameDialog(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void submitName()} disabled={saving || nameValue.trim().length === 0} data-testid="confirm-function-name">
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={membersDialog !== null} onOpenChange={(open) => !saving && !open && setMembersDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pessoas em "{membersDialog?.name}"</DialogTitle>
            <DialogDescription>
              Marque quem exerce esta função. Isso não altera o que a pessoa pode fazer no Hub.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.checkList} data-testid="member-checklist">
            {members.length === 0 ? <p className={styles.help}>Não há pessoas ativas nesta organização.</p> : null}
            {members.map((m) => (
              <label key={m.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)))
                  }
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
          {membersError ? <p className={styles.fieldError} role="alert">{membersError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMembersDialog(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void saveMembers()} disabled={saving} data-testid="confirm-function-members">
              {saving ? 'Salvando...' : 'Salvar pessoas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingShell>
  );
}
