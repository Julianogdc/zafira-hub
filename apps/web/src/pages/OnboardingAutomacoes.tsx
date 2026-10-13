import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Workflow } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, EmptyState, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Banner, OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { flowFormProblem, secretProblem, suggestFlowKey } from '@/lib/automation-view';
import {
  AutomationConnectionView,
  AutomationFlowView,
  automationErrorInfo,
  automationService,
  useAutomationCapabilities,
} from '@/services/automation';
import styles from './Onboarding.module.css';

interface FlowForm {
  key: string;
  name: string;
  description: string;
  webhookUrl: string;
  enabled: boolean;
  subscribeLifecycle: boolean;
  includeClientName: boolean;
}

const EMPTY_FLOW: FlowForm = {
  key: '',
  name: '',
  description: '',
  webhookUrl: '',
  enabled: true,
  subscribeLifecycle: false,
  includeClientName: false,
};

/**
 * F7-4b - Conexao com o n8n e fluxos registrados da organizacao (DEC-F7-016/017).
 * O segredo e a URL do webhook so entram por aqui e NUNCA voltam: a tela mostra impressao digital e host.
 */
export default function OnboardingAutomacoes() {
  const { currentOrganization } = useAuthStore();
  const caps = useAutomationCapabilities(currentOrganization?.id);

  const [conn, setConn] = useState<AutomationConnectionView | null>(null);
  const [flows, setFlows] = useState<AutomationFlowView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [secret, setSecret] = useState('');
  const [timeoutHours, setTimeoutHours] = useState(24);
  const [maxAttempts, setMaxAttempts] = useState(6);
  const [connError, setConnError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const [flowDialog, setFlowDialog] = useState<{ mode: 'create' } | { mode: 'edit'; flow: AutomationFlowView } | null>(null);
  const [form, setForm] = useState<FlowForm>(EMPTY_FLOW);
  const [flowError, setFlowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c, f] = await Promise.all([automationService.connection().catch((e) => {
        // quem so consulta (automation.view) nao ve a conexao: segue so com os fluxos
        if (automationErrorInfo(e).status === 403) return null;
        throw e;
      }), automationService.flows()]);
      setConn(c);
      if (c) {
        setTimeoutHours(c.timeoutHours);
        setMaxAttempts(c.maxAttempts);
      }
      setFlows(f);
    } catch (e) {
      setLoadError(automationErrorInfo(e).message);
    }
  }, []);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  const fail = (e: unknown) => setNotice({ kind: 'danger', text: automationErrorInfo(e).message });

  const saveConnection = async () => {
    const problem = secretProblem(secret);
    if (problem) {
      setConnError(problem);
      return;
    }
    setBusy(true);
    setConnError(null);
    try {
      const next = await automationService.saveConnection({ secret, timeoutHours, maxAttempts });
      setSecret('');
      setConn(next);
      setNotice({ kind: 'ok', text: 'Conexão salva. O segredo não é exibido novamente.' });
    } catch (e) {
      setConnError(automationErrorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const removeConnection = async () => {
    setBusy(true);
    try {
      setConn(await automationService.removeConnection());
      setRemoveOpen(false);
      setNotice({ kind: 'ok', text: 'Conexão removida. Pedidos novos não serão enviados e resultados não serão aceitos.' });
    } catch (e) {
      setRemoveOpen(false);
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const openFlow = (state: { mode: 'create' } | { mode: 'edit'; flow: AutomationFlowView }) => {
    setFlowError(null);
    setForm(
      state.mode === 'create'
        ? EMPTY_FLOW
        : {
            key: state.flow.key,
            name: state.flow.name,
            description: state.flow.description ?? '',
            webhookUrl: '',
            enabled: state.flow.enabled,
            subscribeLifecycle: state.flow.subscribeLifecycle,
            includeClientName: state.flow.includeClientName,
          }
    );
    setFlowDialog(state);
  };

  const saveFlow = async () => {
    if (!flowDialog) return;
    const isNew = flowDialog.mode === 'create';
    const problem = flowFormProblem(form, isNew);
    if (problem) {
      setFlowError(problem);
      return;
    }
    setBusy(true);
    setFlowError(null);
    try {
      if (isNew) {
        await automationService.createFlow({
          key: form.key,
          name: form.name.trim(),
          description: form.description.trim() || null,
          webhookUrl: form.webhookUrl.trim(),
          enabled: form.enabled,
          subscribeLifecycle: form.subscribeLifecycle,
          includeClientName: form.includeClientName,
        });
      } else {
        await automationService.updateFlow(flowDialog.flow.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          ...(form.webhookUrl.trim() ? { webhookUrl: form.webhookUrl.trim() } : {}),
          enabled: form.enabled,
          subscribeLifecycle: form.subscribeLifecycle,
          includeClientName: form.includeClientName,
        });
      }
      setFlowDialog(null);
      setNotice({ kind: 'ok', text: isNew ? 'Fluxo cadastrado.' : 'Fluxo atualizado.' });
      await load();
    } catch (e) {
      setFlowError(automationErrorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleFlow = async (flow: AutomationFlowView) => {
    setBusy(true);
    try {
      await automationService.updateFlow(flow.id, { enabled: !flow.enabled });
      setNotice({ kind: 'ok', text: flow.enabled ? 'Fluxo desabilitado. Etapas que o usam não poderão ser publicadas.' : 'Fluxo habilitado.' });
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (caps.loading) {
    return (
      <OnboardingShell title="Automações">
        <LoadingState message="Carregando permissões..." />
      </OnboardingShell>
    );
  }
  if (!caps.view) {
    return (
      <OnboardingShell title="Automações" tabs={false}>
        <PermissionState title="Sem permissão para ver as automações" description="Seu perfil não tem acesso às automações desta organização." />
      </OnboardingShell>
    );
  }
  if (loadError) {
    return (
      <OnboardingShell title="Automações">
        <ErrorState title="Não foi possível carregar as automações" description={loadError} onRetry={() => void load()} />
      </OnboardingShell>
    );
  }

  const canManage = caps.manage;
  const isNewFlow = flowDialog?.mode === 'create';

  return (
    <OnboardingShell
      title="Automações"
      subtitle="Fluxos do n8n que executam etapas do onboarding. O Hub envia o pedido e só conclui a etapa com o resultado de sucesso autenticado."
      actions={
        canManage ? (
          <Button onClick={() => openFlow({ mode: 'create' })} data-testid="new-flow">
            <Plus size={16} /> Novo fluxo
          </Button>
        ) : undefined
      }
    >
      {notice ? <Banner kind={notice.kind} testId="automation-notice">{notice.text}</Banner> : null}

      <Banner kind="info" testId="asana-policy">
        Fluxos operados em nome do Hub não criam nem alteram projetos, tarefas ou outros dados no Asana (DEC-ASANA-001).
      </Banner>

      {conn && !conn.dispatcherEnabled ? (
        <Banner kind="warn" testId="dispatcher-off">
          O envio automático está desligado neste ambiente. Pedidos ficam aguardando e nenhuma automação é concluída até que quem administra o Hub o ative.
        </Banner>
      ) : null}

      <section className={styles.panel} aria-labelledby="conn-title" data-testid="connection-panel">
        <h2 id="conn-title" className={styles.panelTitle}>Conexão com o n8n</h2>
        {conn === null ? (
          <p className={styles.readOnlyNote} data-testid="connection-hidden">
            A conexão só é visível para quem administra as automações.
          </p>
        ) : (
          <>
            <div className={styles.badges} data-testid="connection-status">
              <Badge variant={conn.configured ? 'success' : 'warning'}>{conn.configured ? 'Conexão configurada' : 'Sem conexão'}</Badge>
              {conn.secretFingerprint ? <Badge variant="neutral">Impressão digital do segredo: {conn.secretFingerprint}</Badge> : null}
              <Badge variant="neutral">Prazo: {conn.timeoutHours} h</Badge>
              <Badge variant="neutral">Tentativas: {conn.maxAttempts}</Badge>
            </div>
            {!conn.configured ? (
              <p className={styles.execWarn} data-testid="no-connection">
                Sem conexão, pedidos não são enviados e resultados do n8n são recusados. Configure o segredo compartilhado abaixo.
              </p>
            ) : null}
            <p className={styles.help} style={{ overflowWrap: 'anywhere' }}>
              Endereço de retorno do n8n (anexe ao endereço público do Hub): <code>{conn.callbackPath}</code>
            </p>
            {canManage ? (
              <div className={styles.form} data-testid="connection-form">
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="n8n-secret">Segredo compartilhado (mínimo 32 caracteres)</label>
                  <input
                    id="n8n-secret"
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={conn.hasSecret ? 'Informe um novo segredo para substituir' : 'Informe o segredo'}
                  />
                  <p className={styles.help}>O segredo assina os pedidos e os resultados. Depois de salvo, não é exibido novamente.</p>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="n8n-timeout">Prazo para o resultado (horas)</label>
                    <input id="n8n-timeout" className={styles.input} type="number" min={1} max={168} value={timeoutHours} onChange={(e) => setTimeoutHours(Number(e.target.value))} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="n8n-attempts">Tentativas de envio</label>
                    <input id="n8n-attempts" className={styles.input} type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
                  </div>
                </div>
                {connError ? <p className={styles.fieldError} role="alert" data-testid="connection-error">{connError}</p> : null}
                <div className={styles.actions}>
                  <Button onClick={() => void saveConnection()} disabled={busy || secret.length === 0} data-testid="save-connection">
                    Salvar conexão
                  </Button>
                  {conn.hasSecret ? (
                    <Button variant="danger" onClick={() => setRemoveOpen(true)} disabled={busy} data-testid="remove-connection">
                      Remover conexão
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className={styles.readOnlyNote} data-testid="connection-readonly">Somente quem administra as automações pode alterar a conexão.</p>
            )}
          </>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="flows-title" data-testid="flows-panel">
        <h2 id="flows-title" className={styles.panelTitle}>Fluxos registrados</h2>
        {flows.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="Nenhum fluxo cadastrado"
            description={canManage ? 'Cadastre um fluxo do n8n para usá-lo em etapas de automação.' : 'Peça a quem administra as automações para cadastrar um fluxo.'}
          />
        ) : (
          <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="flow-list">
            {flows.map((f) => (
              <li key={f.id} className={`${styles.card} ${f.enabled ? '' : styles.cardArchived}`} data-testid="flow-card" data-flow-key={f.key} data-enabled={f.enabled}>
                <div className={styles.cardText}>
                  <h3 className={styles.cardTitle}>{f.name}</h3>
                  <p className={styles.help}>Identificador: {f.key} · Destino: {f.webhookHost || 'não disponível'}</p>
                  {f.description ? <p className={styles.execNote}>{f.description}</p> : null}
                  <div className={styles.badges}>
                    <Badge variant={f.enabled ? 'success' : 'neutral'}>{f.enabled ? 'Habilitado' : 'Desabilitado'}</Badge>
                    {f.subscribeLifecycle ? <Badge variant="info">Recebe avisos de início, conclusão e cancelamento</Badge> : null}
                    {f.includeClientName ? <Badge variant="warning">Recebe o nome do cliente</Badge> : null}
                  </div>
                </div>
                {canManage ? (
                  <div className={styles.cardActions}>
                    <Button size="sm" variant="secondary" onClick={() => openFlow({ mode: 'edit', flow: f })} disabled={busy} data-testid="edit-flow">
                      <Pencil size={14} /> Editar
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void toggleFlow(f)} disabled={busy} data-testid="toggle-flow">
                      {f.enabled ? 'Desabilitar' : 'Habilitar'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={removeOpen} onOpenChange={(open) => !busy && setRemoveOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover conexão com o n8n</DialogTitle>
            <DialogDescription>
              O segredo é apagado. Pedidos novos falham por falta de conexão e resultados do n8n deixam de ser aceitos até uma nova configuração.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="danger" onClick={() => void removeConnection()} disabled={busy} data-testid="confirm-remove-connection">
              Remover conexão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={flowDialog !== null} onOpenChange={(open) => !busy && !open && setFlowDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNewFlow ? 'Novo fluxo' : 'Editar fluxo'}</DialogTitle>
            <DialogDescription>
              O destino precisa ser https e de um host permitido neste ambiente. A URL pode conter um caminho secreto: ela não é exibida depois de salva.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="flow-name">Nome</label>
              <input
                id="flow-name"
                className={styles.input}
                value={form.name}
                maxLength={120}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name, key: isNewFlow && (f.key === '' || f.key === suggestFlowKey(f.name)) ? suggestFlowKey(name) : f.key }));
                }}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="flow-key">Identificador</label>
              <input
                id="flow-key"
                className={styles.input}
                value={form.key}
                maxLength={64}
                disabled={!isNewFlow}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
              />
              {!isNewFlow ? <p className={styles.help}>O identificador não muda depois de cadastrado.</p> : null}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="flow-desc">Descrição (opcional)</label>
              <textarea id="flow-desc" className={styles.textarea} value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="flow-url">URL do webhook do n8n{isNewFlow ? '' : ' (deixe em branco para manter)'}</label>
              <input
                id="flow-url"
                className={styles.input}
                type="password"
                autoComplete="off"
                value={form.webhookUrl}
                onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <label className={styles.check}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              <span>Habilitado</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.subscribeLifecycle} onChange={(e) => setForm({ ...form, subscribeLifecycle: e.target.checked })} />
              <span>Receber avisos informativos de início, conclusão e cancelamento do onboarding</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.includeClientName} onChange={(e) => setForm({ ...form, includeClientName: e.target.checked })} />
              <span>Enviar o nome do cliente ao fluxo (por padrão só o identificador)</span>
            </label>
            {flowError ? <p className={styles.fieldError} role="alert" data-testid="flow-error">{flowError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFlowDialog(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void saveFlow()} disabled={busy} data-testid="save-flow">
              {busy ? 'Salvando...' : 'Salvar fluxo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingShell>
  );
}
