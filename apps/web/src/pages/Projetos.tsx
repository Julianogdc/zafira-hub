import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FolderGit2,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Layers,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  asanaIntegrationService,
  AsanaStatus,
  ClientAsanaProject,
  ClientAsanaTask,
} from '@/services/asana';
import { clientsService, ClientPortfolioItem } from '@/services/clients';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  LoadingState,
  EmptyState,
  ErrorState,
  PermissionState,
} from '@/components/ui/ds';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CanonicalTaskList } from '@/components/projects/canonical/CanonicalTaskList';
import { CanonicalDeliverablesView } from '@/components/projects/canonical/CanonicalDeliverablesView';
import { AsanaHistoryPanel } from '@/components/projects/canonical/AsanaHistoryPanel';
import { AsanaTaskDetailSheet } from '@/components/clients/AsanaTaskDetailSheet';
import styles from './Projetos.module.css';

/** Formato mínimo dos erros de requisição usados nesta página (sem `any`). */
type RequestError = { status?: number; message?: string; response?: { status?: number } } | null | undefined;

export default function Projetos() {
  const { currentOrganization } = useAuthStore();
  const [, setSearchParams] = useSearchParams();

  // 1. Estado da Conexão Corporativa Asana
  const [asanaStatus, setAsanaStatus] = useState<AsanaStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState<boolean>(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // 2. Estado da Carteira de Clientes Autorizados
  const [clients, setClients] = useState<ClientPortfolioItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState<boolean>(true);
  const [clientsError, setClientsError] = useState<{ status?: number; message: string } | null>(null);

  // 3. Cliente Selecionado (inicialmente vazio; reconciliado após validação da carteira)
  const [selectedClientId, setSelectedClientId] = useState<string>('');

  // 4. Projetos do Cliente Selecionado
  const [projects, setProjects] = useState<ClientAsanaProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState<boolean>(false);
  const [projectsError, setProjectsError] = useState<{ status?: number; message: string } | null>(null);

  // 5. Tarefas Operacionais do Cliente Selecionado (F6-IMP.3)
  const [tasks, setTasks] = useState<ClientAsanaTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState<boolean>(false);
  const [tasksError, setTasksError] = useState<{ status?: number; message: string } | null>(null);

  // 6. Detalhe de tarefa (somente leitura — DEC-ASANA-001)
  const [selectedTaskForDetail, setSelectedTaskForDetail] = useState<ClientAsanaTask | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);

  // 7. Controle estrito de ciclo de vida e concorrência assíncrona
  const isMountedRef = useRef<boolean>(true);
  const orgSequenceRef = useRef<number>(0);
  const clientSequenceRef = useRef<number>(0);
  const projectsRequestSeqRef = useRef<number>(0);
  const tasksRequestSeqRef = useRef<number>(0);
  const lastOrgIdRef = useRef<string | undefined>(undefined);

  // Limpeza segura na desmontagem do componente
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      orgSequenceRef.current++;
      clientSequenceRef.current++;
      projectsRequestSeqRef.current++;
      tasksRequestSeqRef.current++;
    };
  }, []);

  /**
   * Consulta o status da conexão corporativa com o Asana via backend Fastify do Hub.
   * Não depende de searchParams nem da carteira de clientes.
   */
  const loadAsanaStatus = useCallback(async (orgSeq: number) => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const status = await asanaIntegrationService.getStatus();
      if (!isMountedRef.current || orgSeq !== orgSequenceRef.current) return;
      setAsanaStatus(status);
    } catch (caught: unknown) {
      const err = caught as RequestError;
      if (!isMountedRef.current || orgSeq !== orgSequenceRef.current) return;
      console.warn('Falha ao consultar status da integração Asana:', err);
      const statusCode = err?.status || err?.response?.status;
      setAsanaStatus(null);
      setStatusError(
        statusCode === 403
          ? 'Sem permissão para consultar o status de integrações da organização.'
          : 'Não foi possível verificar a conexão corporativa com o Asana.'
      );
    } finally {
      if (isMountedRef.current && orgSeq === orgSequenceRef.current) {
        setStatusLoading(false);
      }
    }
  }, []);

  /**
   * Lista os clientes autorizados da organização ativa e reconcilia o cliente inicial da URL.
   * Totalmente desacoplado de searchParams reativo para evitar loops cíclicos de renderização.
   */
  const loadClientsAndReconcile = useCallback(
    async (orgSeq: number, targetUrlClientId: string | null) => {
      setClientsLoading(true);
      setClientsError(null);

      try {
        const list = await clientsService.listClients();
        if (!isMountedRef.current || orgSeq !== orgSequenceRef.current) return;
        const safeClients = Array.isArray(list) ? list : [];
        setClients(safeClients);

        // Validação estrita do cliente solicitado na URL contra a carteira autorizada
        if (targetUrlClientId) {
          const isAuthorized = safeClients.some((c) => c.id === targetUrlClientId);
          if (isAuthorized) {
            // Preserva link direto legítimo autorizado
            setSelectedClientId(targetUrlClientId);
          } else {
            // Cliente da URL inválido ou não pertencente a esta organização: limpa e remove da URL
            setSelectedClientId('');
            setSearchParams({}, { replace: true });
          }
        } else {
          setSelectedClientId('');
        }
      } catch (caught: unknown) {
        const err = caught as RequestError;
        if (!isMountedRef.current || orgSeq !== orgSequenceRef.current) return;
        console.error('Falha ao listar clientes autorizados:', err);
        const statusCode = err?.status || err?.response?.status;
        setClients([]);
        setSelectedClientId('');
        setSearchParams({}, { replace: true });
        setClientsError({
          status: statusCode,
          message:
            statusCode === 403
              ? 'Acesso restrito: você não possui permissão para visualizar a carteira de clientes.'
              : 'Erro ao carregar a lista de clientes autorizados.',
        });
      } finally {
        if (isMountedRef.current && orgSeq === orgSequenceRef.current) {
          setClientsLoading(false);
        }
      }
    },
    [setSearchParams]
  );

  /**
   * Carrega os projetos Asana vinculados ao cliente selecionado.
   * Utiliza sequenciadores dedicados para permitir retries independentes de tarefas.
   */
  const loadClientProjects = useCallback(
    async (clientId: string, clientSeq: number, orgSeq: number, reqSeq: number) => {
      if (!clientId) {
        setProjects([]);
        setProjectsLoading(false);
        setProjectsError(null);
        return;
      }

      setProjectsLoading(true);
      setProjectsError(null);

      try {
        const result = await asanaIntegrationService.getClientProjects(clientId);
        if (
          !isMountedRef.current ||
          clientSeq !== clientSequenceRef.current ||
          orgSeq !== orgSequenceRef.current ||
          reqSeq !== projectsRequestSeqRef.current
        ) {
          return;
        }
        setProjects(Array.isArray(result) ? result : []);
      } catch (caught: unknown) {
        const err = caught as RequestError;
        if (
          !isMountedRef.current ||
          clientSeq !== clientSequenceRef.current ||
          orgSeq !== orgSequenceRef.current ||
          reqSeq !== projectsRequestSeqRef.current
        ) {
          return;
        }
        console.warn('Falha ao carregar projetos Asana do cliente:', err);
        const statusCode = err?.status || err?.response?.status;

        if (statusCode === 403) {
          setProjectsError({
            status: 403,
            message:
              "Acesso restrito: você não possui a permissão 'projects.view' ou este cliente está fora do seu escopo autorizado.",
          });
        } else if (statusCode === 404) {
          setProjectsError({
            status: 404,
            message: 'Cliente não encontrado ou indisponível nesta organização.',
          });
        } else {
          setProjectsError({
            status: statusCode,
            message: 'Não foi possível carregar os projetos Asana vinculados a este cliente no momento.',
          });
        }
      } finally {
        if (
          isMountedRef.current &&
          clientSeq === clientSequenceRef.current &&
          orgSeq === orgSequenceRef.current &&
          reqSeq === projectsRequestSeqRef.current
        ) {
          setProjectsLoading(false);
        }
      }
    },
    []
  );

  /**
   * Carrega todas as tarefas Asana consolidadas vinculadas aos projetos do cliente.
   * Utiliza sequenciadores dedicados para permitir retries independentes de projetos.
   */
  const loadClientTasks = useCallback(
    async (clientId: string, clientSeq: number, orgSeq: number, reqSeq: number) => {
      if (!clientId) {
        setTasks([]);
        setTasksLoading(false);
        setTasksError(null);
        return;
      }

      setTasksLoading(true);
      setTasksError(null);

      try {
        const result = await asanaIntegrationService.getClientTasks(clientId);
        if (
          !isMountedRef.current ||
          clientSeq !== clientSequenceRef.current ||
          orgSeq !== orgSequenceRef.current ||
          reqSeq !== tasksRequestSeqRef.current
        ) {
          return;
        }
        setTasks(Array.isArray(result) ? result : []);
      } catch (caught: unknown) {
        const err = caught as RequestError;
        if (
          !isMountedRef.current ||
          clientSeq !== clientSequenceRef.current ||
          orgSeq !== orgSequenceRef.current ||
          reqSeq !== tasksRequestSeqRef.current
        ) {
          return;
        }
        console.warn('Falha ao carregar tarefas Asana do cliente:', err);
        const statusCode = err?.status || err?.response?.status;

        if (statusCode === 403) {
          setTasksError({
            status: 403,
            message:
              "Acesso restrito: você não possui a permissão 'projects.view' ou este cliente está fora do seu escopo autorizado.",
          });
        } else if (statusCode === 404) {
          setTasksError({
            status: 404,
            message: 'Cliente não encontrado ou indisponível nesta organização.',
          });
        } else {
          setTasksError({
            status: statusCode,
            message:
              err?.message ||
              'Não foi possível consolidar as tarefas Asana vinculadas a este cliente no momento.',
          });
        }
      } finally {
        if (
          isMountedRef.current &&
          clientSeq === clientSequenceRef.current &&
          orgSeq === orgSequenceRef.current &&
          reqSeq === tasksRequestSeqRef.current
        ) {
          setTasksLoading(false);
        }
      }
    },
    []
  );

  /**
   * EFEITO 1: Ciclo de Vida da Organização Ativa
   * Disparado EXCLUSIVAMENTE quando currentOrganization?.id muda (ou na montagem inicial).
   * Não é acionado na seleção de clientes, garantindo estabilidade total da página.
   */
  useEffect(() => {
    const currentOrgId = currentOrganization?.id;
    const isOrgSwitch =
      lastOrgIdRef.current !== undefined && lastOrgIdRef.current !== currentOrgId;
    lastOrgIdRef.current = currentOrgId;

    const currentOrgSeq = ++orgSequenceRef.current;
    ++clientSequenceRef.current;
    ++projectsRequestSeqRef.current;
    ++tasksRequestSeqRef.current;

    // Em troca real de organização, limpa imediatamente cliente selecionado e URL
    if (isOrgSwitch) {
      setSelectedClientId('');
      setSearchParams({}, { replace: true });
    }

    // Limpeza atômica dos estados de dados da organização anterior
    setAsanaStatus(null);
    setStatusLoading(true);
    setStatusError(null);

    setClients([]);
    setClientsLoading(true);
    setClientsError(null);

    setProjects([]);
    setProjectsLoading(false);
    setProjectsError(null);

    setTasks([]);
    setTasksLoading(false);
    setTasksError(null);

    setIsDetailOpen(false);
    setSelectedTaskForDetail(null);

    // Na montagem inicial, preserva o clientId presente na URL para validação;
    // em troca de organização, busca sem cliente alvo
    const initialUrlClientId = isOrgSwitch
      ? null
      : new URLSearchParams(window.location.search).get('clientId');

    loadAsanaStatus(currentOrgSeq);
    loadClientsAndReconcile(currentOrgSeq, initialUrlClientId);
  }, [currentOrganization?.id, loadAsanaStatus, loadClientsAndReconcile, setSearchParams]);

  /**
   * EFEITO 2: Troca de Cliente Selecionado
   * Dispara a consulta dos projetos e tarefas do cliente sob sequenciadores dedicados.
   * Não afeta o status da organização nem a lista de clientes.
   */
  useEffect(() => {
    const currentClientSeq = ++clientSequenceRef.current;
    const currentOrgSeq = orgSequenceRef.current;
    const currentProjReqSeq = ++projectsRequestSeqRef.current;
    const currentTaskReqSeq = ++tasksRequestSeqRef.current;

    if (selectedClientId) {
      loadClientProjects(selectedClientId, currentClientSeq, currentOrgSeq, currentProjReqSeq);
      loadClientTasks(selectedClientId, currentClientSeq, currentOrgSeq, currentTaskReqSeq);
    } else {
      setProjects([]);
      setProjectsError(null);
      setProjectsLoading(false);

      setTasks([]);
      setTasksError(null);
      setTasksLoading(false);

      setIsDetailOpen(false);
      setSelectedTaskForDetail(null);
    }
  }, [selectedClientId, loadClientProjects, loadClientTasks]);

  /**
   * Handler para seleção de cliente via Dropdown
   * Não reinicializa a organização nem causa refetch da carteira.
   */
  const handleClientSelect = (clientId: string) => {
    if (clientId === selectedClientId) return;

    // Limpa imediatamente projetos e tarefas do cliente anterior
    setProjects([]);
    setProjectsError(null);
    setTasks([]);
    setTasksError(null);
    setIsDetailOpen(false);
    setSelectedTaskForDetail(null);

    setSelectedClientId(clientId);

    if (clientId) {
      setSearchParams({ clientId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  /**
   * 8. Asana somente leitura (DEC-ASANA-001 / F6-RO.0)
   * O Hub apenas abre o detalhe da tarefa; criação e edição acontecem no próprio Asana.
   */
  const handleOpenTaskDetail = (task: ClientAsanaTask) => {
    setSelectedTaskForDetail(task);
    setIsDetailOpen(true);
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  return (
    <div className={styles.container}>
      {/* 1. CABEÇALHO */}
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h1 className={styles.headerTitle}>Projetos e Tarefas</h1>
          <p className={styles.headerSubtitle}>
            Cockpit operacional integrado •{' '}
            <span className={styles.headerOrgBadge}>
              <Building2 size={14} />
              {currentOrganization?.name || 'Organização Ativa'}
            </span>
          </p>
        </div>

        {/* Estado da Conexão Corporativa Asana com Diferenciação Rigorosa */}
        <div className={styles.statusContainer}>
          <div className={styles.statusCard}>
            <div
              className={`${styles.statusIndicator} ${
                statusLoading
                  ? styles.statusLoading
                  : statusError
                  ? styles.statusError
                  : asanaStatus?.connected
                  ? styles.statusConnected
                  : styles.statusDisconnected
              }`}
            />
            <div className={styles.statusDetails}>
              <span className={styles.statusTitle}>
                {statusLoading
                  ? 'Verificando conexão...'
                  : statusError
                  ? 'Falha na Verificação'
                  : asanaStatus?.connected
                  ? 'Asana Conectado'
                  : 'Asana Desconectado'}
              </span>
              <span className={styles.statusMeta}>
                {statusLoading ? (
                  'Consultando API corporativa'
                ) : statusError ? (
                  <button
                    type="button"
                    className={styles.statusRetryBtn}
                    onClick={() => loadAsanaStatus(orgSequenceRef.current)}
                  >
                    <RefreshCw size={10} /> Tentar novamente
                  </button>
                ) : asanaStatus?.connected ? (
                  asanaStatus.workspaceName
                    ? `Workspace: ${asanaStatus.workspaceName}`
                    : 'Conexão ativa na organização'
                ) : (
                  'Integração inativa na organização'
                )}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Alerta de Erro na Consulta de Status */}
      {!statusLoading && statusError && (
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={20} className="shrink-0 mt-0.5 text-red-400" />
          <div>
            <div className={styles.warningBannerTitle}>
              Erro na Consulta de Integração
            </div>
            <div>
              {statusError} Não foi possível determinar com segurança o estado da integração com o Asana.
            </div>
          </div>
        </div>
      )}

      {/* Alerta se o Asana corporativo estiver efetivamente desconectado (sem erro de API) */}
      {!statusLoading && !statusError && !asanaStatus?.connected && (
        <div className={styles.warningBanner} role="alert">
          <AlertTriangle size={20} className="shrink-0 mt-0.5 text-amber-400" />
          <div>
            <div className={styles.warningBannerTitle}>
              Integração Asana Inativa
            </div>
            <div>
              A conexão corporativa com o Asana não está configurada ou ativa para esta organização.
              Os projetos e tarefas vinculados podem não refletir métricas em tempo real.
            </div>
          </div>
        </div>
      )}

      {/* 2. SELETOR DE CLIENTE */}
      <section className={styles.selectorCard}>
        <div className={styles.selectorLabelGroup}>
          <div className={styles.selectorIconBox}>
            <Building2 size={20} />
          </div>
          <div className={styles.selectorTexts}>
            <span className={styles.selectorTitle}>Selecione o Cliente</span>
            <span className={styles.selectorHint}>
              Exibindo apenas clientes dentro do seu escopo de acesso autorizado
            </span>
          </div>
        </div>

        <div className={styles.selectorControls}>
          {clientsLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
              <RefreshCw size={14} className="animate-spin" /> Carregando carteira autorizada...
            </div>
          ) : clientsError ? (
            <div className="text-xs text-red-400 flex items-center justify-between gap-2">
              <span>{clientsError.message}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const initialUrlClientId = new URLSearchParams(window.location.search).get('clientId');
                  loadClientsAndReconcile(orgSequenceRef.current, initialUrlClientId);
                }}
              >
                Tentar
              </Button>
            </div>
          ) : clients.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Nenhum cliente disponível no seu perfil
            </div>
          ) : (
            <Select
              value={selectedClientId}
              onValueChange={handleClientSelect}
            >
              <SelectTrigger className="w-full bg-[#0d0d12] border-white/10 text-white">
                <SelectValue placeholder="Escolha um cliente..." />
              </SelectTrigger>
              <SelectContent className="bg-[#111116] border-white/10 text-white max-h-[300px]">
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </section>

      {/* 3. CONTEÚDO: PROJETOS DO CLIENTE SELECIONADO */}
      <div className={styles.contentArea}>
        {/* Caso A: Nenhum cliente selecionado */}
        {!selectedClientId && (
          <EmptyState
            icon={<Building2 size={40} />}
            title="Nenhum cliente selecionado"
            description="Selecione um cliente no menu acima para consultar seus projetos do Asana e acompanhar as entregas operacionais."
          />
        )}

        {/* Caso B: Carregando projetos */}
        {selectedClientId && projectsLoading && (
          <LoadingState
            message={`Consultando projetos Asana de ${selectedClient?.name || 'cliente'}...`}
            fullHeight={false}
          />
        )}

        {/* Caso C: Erro ao consultar projetos */}
        {selectedClientId && !projectsLoading && projectsError && (
          projectsError.status === 403 ? (
            <PermissionState
              title="Acesso Restrito a Projetos"
              description={projectsError.message}
            />
          ) : (
            <ErrorState
              title="Falha ao carregar projetos"
              description={projectsError.message}
              onRetry={() => {
                const currentReqSeq = ++projectsRequestSeqRef.current;
                loadClientProjects(
                  selectedClientId,
                  clientSequenceRef.current,
                  orgSequenceRef.current,
                  currentReqSeq
                );
              }}
            />
          )
        )}

        {/* Caso D: Sucesso sem projetos vinculados */}
        {selectedClientId && !projectsLoading && !projectsError && projects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={40} />}
            title="Nenhum projeto Asana vinculado"
            description={`O cliente "${selectedClient?.name || ''}" ainda não possui projetos do Asana vinculados nesta organização.`}
          />
        )}

        {/* Entregas são do Hub (não do Asana): continuam visíveis sem projeto Asana ou com falha na consulta */}
        {selectedClientId && !projectsLoading && (projectsError || projects.length === 0) && (
          <section className="mt-8" aria-label="Entregas do cliente">
            <CanonicalDeliverablesView
              key={selectedClientId}
              clientId={selectedClientId}
              clientName={selectedClient?.name}
            />
          </section>
        )}

        {/* Caso E: Sucesso com projetos vinculados */}
        {selectedClientId && !projectsLoading && !projectsError && projects.length > 0 && (
          <>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <FolderGit2 size={20} />
                Projetos Vinculados ({selectedClient?.name})
                <span className={styles.projectCountBadge}>
                  {projects.length} {projects.length === 1 ? 'projeto' : 'projetos'}
                </span>
              </div>
            </div>

            <div className={styles.projectsGrid}>
              {projects.map((proj) => {
                const isLive = proj.metricsStatus === 'LIVE';
                const isError = proj.metricsStatus === 'ERROR';
                const isUnavailable =
                  proj.metricsStatus === 'UNAVAILABLE' ||
                  (!proj.metricsStatus && !asanaStatus?.connected);

                const formattedTime = proj.metricsUpdatedAt
                  ? new Date(proj.metricsUpdatedAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : null;

                return (
                  <div
                    key={proj.projectGid || proj.integrationId}
                    className={styles.projectCard}
                  >
                    <div className={styles.projectCardHeader}>
                      <span className={styles.projectCardName}>{proj.projectName}</span>
                      {proj.projectGid && (
                        <span className={styles.projectCardGid}>
                          GID: {proj.projectGid}
                        </span>
                      )}
                    </div>

                    {/* Métricas com Confiabilidade e Frescor */}
                    {isLive && proj.totalTasks !== null ? (
                      <div>
                        <div className={styles.metricsGrid}>
                          <div className={styles.metricBox}>
                            <span className={styles.metricLabel}>Total</span>
                            <span className={styles.metricValue}>{proj.totalTasks}</span>
                          </div>
                          <div className={styles.metricBox}>
                            <span className={styles.metricLabel}>Concluídas</span>
                            <span className={styles.metricValue}>{proj.completedTasks ?? 0}</span>
                          </div>
                          <div className={styles.metricBox}>
                            <span className={styles.metricLabel}>Pendentes</span>
                            <span className={styles.metricValue}>{proj.pendingTasks ?? 0}</span>
                          </div>
                          <div className={styles.metricBox}>
                            <span className={styles.metricLabel}>Em Atraso</span>
                            <span
                              className={`${styles.metricValue} ${
                                (proj.overdueTasks ?? 0) > 0 ? styles.metricOverdue : ''
                              }`}
                            >
                              {proj.overdueTasks ?? 0}
                            </span>
                          </div>
                        </div>

                        {proj.totalTasks === 0 ? (
                          <div className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 shrink-0" />
                            0 tarefas confirmadas no Asana{formattedTime ? ` às ${formattedTime}` : ''}
                          </div>
                        ) : formattedTime ? (
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            Consulta confirmada às {formattedTime}
                          </div>
                        ) : null}
                      </div>
                    ) : isError ? (
                      <div className="text-xs text-red-400/90 p-3 bg-red-500/5 rounded-md border border-red-500/10">
                        <div className="font-medium text-red-400 flex items-center gap-1.5 mb-1">
                          <AlertTriangle size={14} className="shrink-0" />
                          Falha ao consultar métricas no Asana
                        </div>
                        <div className="text-[11px] text-red-300/80">
                          {proj.metricsError ||
                            'Não foi possível carregar as tarefas deste projeto. Os números não foram zerados para preservar a precisão dos dados.'}
                        </div>
                      </div>
                    ) : isUnavailable ? (
                      <div className="text-xs text-amber-400/80 p-3 bg-amber-500/5 rounded-md border border-amber-500/10">
                        Métricas indisponíveis (conexão Asana inativa ou credencial não configurada).
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground p-3 bg-white/[0.02] rounded-md border border-white/5">
                        Métricas de tarefas aguardando verificação.
                      </div>
                    )}

                    <div className={styles.projectFooter}>
                      <span className="flex items-center gap-1.5">
                        <Clock size={12} />
                        Vinculado em {new Date(proj.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                      <Badge variant="neutral" className="text-[10px] bg-white/5">
                        Asana
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* F6-IMP.8 — evolução e histórico guardados no Hub */}
            <AsanaHistoryPanel key={`history-${selectedClientId}`} clientId={selectedClientId} />

            {/* 4. SEÇÃO OPERACIONAL DE TAREFAS ASANA (F6-IMP.3) */}
            <section className="mt-8">
              <CanonicalTaskList
                key={selectedClientId}
                tasks={tasks}
                projects={projects}
                loading={tasksLoading}
                error={tasksError}
                onRetry={() => {
                  const currentReqSeq = ++tasksRequestSeqRef.current;
                  loadClientTasks(
                    selectedClientId,
                    clientSequenceRef.current,
                    orgSequenceRef.current,
                    currentReqSeq
                  );
                }}
                onTaskClick={handleOpenTaskDetail}
                clientId={selectedClientId}
                clientName={selectedClient?.name}
              />
            </section>
          </>
        )}
      </div>

      {/* 5. SHEET DE DETALHES DA TAREFA */}
      {selectedTaskForDetail && (
        <AsanaTaskDetailSheet
          isOpen={isDetailOpen}
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedTaskForDetail(null);
          }}
          task={selectedTaskForDetail}
          clientId={selectedClientId}
        />
      )}

    </div>
  );
}
