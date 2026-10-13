import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, Play } from 'lucide-react';
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
import { EXECUTION_STATUS_LABEL, formatDay } from '@/lib/onboarding-execution-view';
import { clientsService, type ClientPortfolioItem } from '@/services/clients';
import {
  ExecutionFilters,
  ExecutionListItem,
  ExecutionOverview,
  executionErrorInfo,
  onboardingExecutionService,
} from '@/services/onboardingExecution';
import {
  OnboardingMemberView,
  OnboardingTemplateListItem,
  onboardingService,
} from '@/services/onboarding';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import styles from './Onboarding.module.css';

/** F7-2b - Painel de acompanhamento dos onboardings por cliente (carteira do usuario). */
export default function OnboardingExecucoes() {
  const navigate = useNavigate();
  const { currentOrganization } = useAuthStore();
  const caps = useOnboardingCapabilities(currentOrganization?.id);

  const [filters, setFilters] = useState<ExecutionFilters>({ status: 'ACTIVE' });
  const [items, setItems] = useState<ExecutionListItem[] | null>(null);
  const [overview, setOverview] = useState<ExecutionOverview | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const [clients, setClients] = useState<ClientPortfolioItem[]>([]);
  const [templates, setTemplates] = useState<OnboardingTemplateListItem[]>([]);
  const [members, setMembers] = useState<OnboardingMemberView[]>([]);

  const [startOpen, setStartOpen] = useState(false);
  const [startClient, setStartClient] = useState('');
  const [startTemplate, setStartTemplate] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ message: string; existing?: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, ov] = await Promise.all([onboardingExecutionService.list(filters), onboardingExecutionService.overview()]);
      setItems(list);
      setOverview(ov);
    } catch (e) {
      const info = executionErrorInfo(e);
      setError({ status: info.status, message: info.message });
      setItems(null);
    }
  }, [filters]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    // opcoes dos filtros: falha aqui nunca derruba o painel
    void clientsService.listClients().then(setClients).catch(() => setClients([]));
    void onboardingService.listTemplates().then(setTemplates).catch(() => setTemplates([]));
    void onboardingService.listMembers().then(setMembers).catch(() => setMembers([]));
  }, [caps.loading, caps.view]);

  const startable = templates.filter((t) => t.status === 'ACTIVE' && t.publishedVersion !== null);

  const submitStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const created = await onboardingExecutionService.start(startClient, startTemplate);
      setStartOpen(false);
      navigate(`/onboarding/execucoes/${created.id}`);
    } catch (e) {
      const info = executionErrorInfo(e);
      setStartError({ message: info.message, existing: info.existingExecutionId });
    } finally {
      setStarting(false);
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
              : 'Seu perfil não tem acesso ao onboarding desta organização.'
          }
        />
      </OnboardingShell>
    );
  }

  const set = (patch: Partial<ExecutionFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <OnboardingShell
      title="Onboarding"
      subtitle="Acompanhe a entrada dos clientes da sua carteira."
      actions={
        caps.start ? (
          <Button
            data-testid="start-onboarding"
            onClick={() => {
              setStartClient('');
              setStartTemplate('');
              setStartError(null);
              setStartOpen(true);
            }}
          >
            <Play size={16} /> Iniciar onboarding
          </Button>
        ) : null
      }
    >
      {overview ? (
        <section className={styles.kpis} aria-label="Resumo" data-testid="overview">
          <div className={styles.kpi}>
            <span className={styles.kpiValue} data-testid="kpi-active">{overview.activeExecutions}</span>
            <span className={styles.kpiLabel}>Em andamento</span>
          </div>
          <div className={`${styles.kpi} ${overview.lateSteps > 0 ? styles.kpiWarn : ''}`}>
            <span className={styles.kpiValue} data-testid="kpi-late">{overview.lateSteps}</span>
            <span className={styles.kpiLabel}>Etapas atrasadas</span>
          </div>
          <div className={`${styles.kpi} ${overview.blockedSteps > 0 ? styles.kpiDanger : ''}`}>
            <span className={styles.kpiValue} data-testid="kpi-blocked">{overview.blockedSteps}</span>
            <span className={styles.kpiLabel}>Etapas bloqueadas</span>
          </div>
          <div className={`${styles.kpi} ${overview.unassignedSteps > 0 ? styles.kpiWarn : ''}`}>
            <span className={styles.kpiValue} data-testid="kpi-unassigned">{overview.unassignedSteps}</span>
            <span className={styles.kpiLabel}>Sem responsável</span>
          </div>
          <div className={`${styles.kpi} ${overview.inactiveAssigneeSteps > 0 ? styles.kpiWarn : ''}`}>
            <span className={styles.kpiValue}>{overview.inactiveAssigneeSteps}</span>
            <span className={styles.kpiLabel}>Responsável indisponível</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>{overview.completedLast30Days}</span>
            <span className={styles.kpiLabel}>Concluídos em 30 dias</span>
          </div>
        </section>
      ) : null}

      <section className={styles.filters} aria-label="Filtros">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="f-status">Situação</label>
          <select id="f-status" className={styles.select} value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">Todas</option>
            <option value="ACTIVE">Em andamento</option>
            <option value="COMPLETED">Concluídos</option>
            <option value="CANCELLED">Cancelados</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="f-client">Cliente</label>
          <select id="f-client" className={styles.select} value={filters.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || undefined })}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="f-template">Modelo</label>
          <select id="f-template" className={styles.select} value={filters.templateId ?? ''} onChange={(e) => set({ templateId: e.target.value || undefined })}>
            <option value="">Todos</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="f-assignee">Responsável</label>
          <select id="f-assignee" className={styles.select} value={filters.assigneeId ?? ''} onChange={(e) => set({ assigneeId: e.target.value || undefined })}>
            <option value="">Todos</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={Boolean(filters.late)} onChange={(e) => set({ late: e.target.checked || undefined })} />
          <span>Só com etapas atrasadas</span>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={Boolean(filters.blocked)} onChange={(e) => set({ blocked: e.target.checked || undefined })} />
          <span>Só com etapas bloqueadas</span>
        </label>
      </section>

      {error ? (
        <ErrorState
          title={error.status === 403 ? 'Sem permissão' : 'Não foi possível carregar os onboardings'}
          description={error.message}
          onRetry={() => void load()}
        />
      ) : items === null ? (
        <LoadingState message="Carregando onboardings..." />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="Nenhum onboarding encontrado"
          description={
            caps.start
              ? 'Inicie o onboarding de um cliente da sua carteira a partir de um modelo publicado.'
              : 'Não há onboardings para os filtros escolhidos na sua carteira.'
          }
          primaryAction={caps.start ? { label: 'Iniciar onboarding', onClick: () => setStartOpen(true) } : undefined}
        />
      ) : (
        <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="execution-list">
          {items.map((e) => {
            const st = EXECUTION_STATUS_LABEL[e.status];
            return (
              <li key={e.id} className={styles.card} data-testid="execution-card" data-client={e.clientName} data-status={e.status}>
                <div>
                  <h2 className={styles.cardTitle}>
                    <Link to={`/onboarding/execucoes/${e.id}`}>{e.clientName}</Link>
                  </h2>
                  <p className={styles.cardText}>{e.templateName} · v{e.versionNumber} · iniciado em {formatDay(e.startedAt)}</p>
                </div>
                <div className={styles.badges}>
                  <Badge variant={st.tone}>{st.label}</Badge>
                  {e.counts.late > 0 ? <Badge variant="warning">{e.counts.late} atrasada(s)</Badge> : null}
                  {e.counts.blocked > 0 ? <Badge variant="danger">{e.counts.blocked} bloqueada(s)</Badge> : null}
                  {e.counts.unassigned > 0 ? <Badge variant="warning">{e.counts.unassigned} sem responsável</Badge> : null}
                </div>
                <div>
                  <div className={styles.progress} role="progressbar" aria-valuenow={e.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${e.clientName}`}>
                    <div className={styles.progressBar} style={{ width: `${e.progress.percent}%` }} />
                  </div>
                  <span className={styles.progressText}>{e.progress.closed} de {e.progress.total} etapas encerradas</span>
                </div>
                <div className={styles.cardActions}>
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/onboarding/execucoes/${e.id}`)}>Abrir</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={startOpen} onOpenChange={(open) => !starting && setStartOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar onboarding</DialogTitle>
            <DialogDescription>
              O onboarding usa a versão publicada mais recente do modelo e fica fixado nela. Etapas sem responsável elegível aparecem destacadas para atribuição.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="start-client">Cliente</label>
              <select id="start-client" className={styles.select} value={startClient} onChange={(e) => setStartClient(e.target.value)}>
                <option value="">Escolha um cliente da sua carteira</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="start-template">Modelo</label>
              <select id="start-template" className={styles.select} value={startTemplate} onChange={(e) => setStartTemplate(e.target.value)}>
                <option value="">Escolha um modelo publicado</option>
                {startable.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} (v{t.publishedVersion})</option>
                ))}
              </select>
              {startable.length === 0 ? <p className={styles.help}>Não há modelos ativos com versão publicada.</p> : null}
            </div>
            {startError ? (
              <p className={styles.fieldError} role="alert" data-testid="start-error">
                {startError.message}{' '}
                {startError.existing ? (
                  <Link className={styles.linkInline} to={`/onboarding/execucoes/${startError.existing}`}>Abrir o onboarding ativo</Link>
                ) : null}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStartOpen(false)} disabled={starting}>Cancelar</Button>
            <Button onClick={() => void submitStart()} disabled={starting || !startClient || !startTemplate} data-testid="confirm-start">
              {starting ? 'Iniciando...' : 'Iniciar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingShell>
  );
}
