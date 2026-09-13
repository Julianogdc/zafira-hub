import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  RefreshCw,
  FolderGit2,
  User,
  Calendar,
  AlertCircle,
  Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/useAuthStore';
import {
  asanaIntegrationService,
  ClientAsanaProject,
  ClientAsanaTask,
  AsanaStatus,
  AsanaProjectSummary,
} from '@/services/asana';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface Cliente360ProjetosProps {
  clientId: string;
  canManage: boolean;
}

export function Cliente360Projetos({ clientId, canManage }: Cliente360ProjetosProps) {
  const [loading, setLoading] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [status, setStatus] = useState<AsanaStatus | null>(null);
  const [projects, setProjects] = useState<ClientAsanaProject[]>([]);
  const [tasks, setTasks] = useState<ClientAsanaTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Modal de Vinculação
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<AsanaProjectSummary[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [selectedGids, setSelectedGids] = useState<string[]>([]);
  const [isLinking, setIsLinking] = useState(false);

  // Desvinculação
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  // Informações de autenticação e papel
  const { user } = useAuthStore();
  const isAdmin = user?.role?.toLowerCase() === 'admin';

  // Conexão OAuth
  const [isConnecting, setIsConnecting] = useState(false);

  // Desconexão total da organização
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Estados de sincronização em tempo real / segundo plano
  const [isSilentSyncing, setIsSilentSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Carregamento de dados (inicial e refetch geral)
  const loadData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setIsSilentSyncing(true);
      }
      setError(null);

      // 1. Checa status e projetos vinculados em paralelo
      const [statusData, projectsData] = await Promise.all([
        asanaIntegrationService.getStatus().catch(() => ({ configured: false, connected: false })),
        asanaIntegrationService.getClientProjects(clientId).catch(() => []),
      ]);

      setStatus(statusData);
      setProjects(projectsData);

      // 2. Se houver projetos vinculados e o Asana estiver conectado, carrega as tarefas
      if (projectsData.length > 0 && statusData.connected) {
        if (isInitial) setLoadingTasks(true);
        const tasksData = await asanaIntegrationService.getClientTasks(clientId).catch(() => []);
        setTasks(tasksData);
        if (isInitial) setLoadingTasks(false);
      } else {
        setTasks([]);
      }
      setLastSyncedAt(new Date());
    } catch (err: any) {
      console.error('Erro ao carregar dados do Asana:', err);
      setError(err?.message || 'Falha ao carregar dados da integração Asana.');
    } finally {
      if (isInitial) {
        setLoading(false);
      } else {
        setIsSilentSyncing(false);
      }
    }
  }, [clientId]);

  // Atualização em segundo plano (silenciosa, sem desmontar UI nem acionar spinners invasivos)
  const silentRefresh = useCallback(async () => {
    try {
      console.log('[Asana UI] silent refresh triggered');
      setIsSilentSyncing(true);
      const [projectsData, tasksData] = await Promise.all([
        asanaIntegrationService.getClientProjects(clientId).catch(() => null),
        asanaIntegrationService.getClientTasks(clientId).catch(() => null),
      ]);

      if (projectsData) {
        setProjects(projectsData);
      }
      if (tasksData) {
        setTasks(tasksData);
      }
      setLastSyncedAt(new Date());
    } catch (err) {
      console.warn('[Cliente360Projetos] Erro ao sincronizar dados silenciosamente:', err);
    } finally {
      setIsSilentSyncing(false);
    }
  }, [clientId]);

  // Preparação de arquitetura para futuras ações com atualização otimista (Etapa 2)
  const optimisticUpdateTask = useCallback((taskGid: string, updates: Partial<ClientAsanaTask>) => {
    setTasks((prev) => prev.map((t) => (t.gid === taskGid ? { ...t, ...updates } : t)));
  }, []);

  // Carregamento inicial e sincronização de webhooks
  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Assegura webhooks ativos no Asana quando a integração estiver conectada
  useEffect(() => {
    if (status?.connected && projects.length > 0) {
      asanaIntegrationService.syncWebhooks().catch((err) => {
        console.warn('[Cliente360Projetos] Falha ao sincronizar webhooks remotos:', err);
      });
    }
  }, [status?.connected, projects.length]);

  // Conexão SSE em tempo real: recebe eventos da organização e atualiza silenciosamente
  useEffect(() => {
    if (!status?.connected) return;

    const unsubscribe = asanaIntegrationService.subscribeToEvents((event) => {
      // Quando chega evento referente a projetos ou tarefas, sincroniza silenciosamente
      silentRefresh();
    });

    return () => {
      unsubscribe();
    };
  }, [status?.connected, silentRefresh]);

  // Polling de segurança leve: 15s em ambiente DEV para validação ágil, 3 min (180s) em PROD
  useEffect(() => {
    if (!status?.connected) return;

    const pollInterval = import.meta.env.DEV ? 15000 : 180000;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return; // Não executa se a aba do navegador estiver em segundo plano
      }
      silentRefresh();
    }, pollInterval);

    return () => {
      clearInterval(interval);
    };
  }, [status?.connected, silentRefresh]);

  // Escuta mensagem de sucesso disparada pelo popup OAuth do Asana
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      // Validação estrita de origem: aceita apenas mensagens vindas da API oficial ou da origem local autorizada
      const allowedOrigins = [
        'https://zafira-hub-v2-api.hvrb9d.easypanel.host',
        window.location.origin,
      ];
      if (import.meta.env.VITE_API_URL) {
        try {
          allowedOrigins.push(new URL(import.meta.env.VITE_API_URL).origin);
        } catch {}
      }

      if (!allowedOrigins.includes(event.origin)) {
        // Ignora eventos de origens não autorizadas
        return;
      }

      if (event.data?.type === 'ASANA_AUTH_SUCCESS') {
        toast.success('Asana conectado com sucesso!');
        setIsConnecting(false);
        loadData();
      } else if (event.data?.type === 'ASANA_AUTH_ERROR') {
        toast.error(`Falha na autorização do Asana: ${event.data?.error || 'Erro desconhecido'}`);
        setIsConnecting(false);
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => {
      window.removeEventListener('message', handleOAuthMessage);
    };
  }, [loadData]);

  const handleConnectAsana = async () => {
    try {
      setIsConnecting(true);
      const res = await asanaIntegrationService.getOAuthAuthorizeUrl();
      if (!res?.url) {
        throw new Error('A API não retornou uma URL de autorização válida.');
      }

      // Abre popup centrado na tela
      const width = 640;
      const height = 720;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        res.url,
        'AsanaOAuthAuthorization',
        `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`
      );

      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        toast.error('O navegador bloqueou a abertura do popup. Por favor, permita popups neste site.');
        setIsConnecting(false);
        return;
      }

      popup.focus();

      // Monitoramento periódico caso a janela seja fechada pelo usuário
      const checkInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkInterval);
          setIsConnecting(false);
          loadData();
        }
      }, 1000);
    } catch (err: any) {
      console.error('Erro ao conectar Asana:', err);
      toast.error(err?.data?.message || err?.message || 'Falha ao iniciar conexão com o Asana.');
      setIsConnecting(false);
    }
  };

  const handleDisconnectAsana = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    try {
      setIsDisconnecting(true);
      await asanaIntegrationService.disconnect();
      toast.success('Integração Asana desconectada com sucesso.');
      setIsDisconnectDialogOpen(false);
      setStatus({ configured: false, connected: false });
      setProjects([]);
      setTasks([]);
      loadData();
    } catch (err: any) {
      console.error('Erro ao desconectar Asana:', err);
      toast.error(err?.data?.message || err?.message || 'Erro ao desconectar Asana da organização.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Abre modal para vincular projetos
  const handleOpenLinkDialog = async () => {
    setIsLinkDialogOpen(true);
    setSelectedGids([]);
    try {
      setLoadingAvailable(true);
      const data = await asanaIntegrationService.getWorkspaceProjects();
      setAvailableProjects(data);
    } catch (err: any) {
      toast.error('Não foi possível carregar os projetos do Asana. Verifique a conexão.');
    } finally {
      setLoadingAvailable(false);
    }
  };

  const handleToggleProject = (gid: string) => {
    setSelectedGids((prev) =>
      prev.includes(gid) ? prev.filter((id) => id !== gid) : [...prev, gid]
    );
  };

  const handleSaveLinks = async () => {
    if (selectedGids.length === 0) {
      toast.error('Selecione pelo menos um projeto.');
      return;
    }

    try {
      setIsLinking(true);
      const result = await asanaIntegrationService.linkProjects(clientId, selectedGids);
      toast.success(`${result.linked} projeto(s) vinculado(s) com sucesso!`);
      setIsLinkDialogOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao vincular projetos.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async (integrationId: string, projectName: string) => {
    if (!confirm(`Deseja desvincular o projeto "${projectName}" deste cliente?`)) {
      return;
    }

    try {
      setUnlinkingId(integrationId);
      await asanaIntegrationService.unlinkProject(clientId, integrationId);
      toast.success('Projeto desvinculado com sucesso.');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao desvincular projeto.');
    } finally {
      setUnlinkingId(null);
    }
  };

  // Totais agregados
  const totalTasksCount = projects.reduce((acc, p) => acc + p.totalTasks, 0);
  const completedTasksCount = projects.reduce((acc, p) => acc + p.completedTasks, 0);
  const pendingTasksCount = projects.reduce((acc, p) => acc + p.pendingTasks, 0);
  const overdueTasksCount = projects.reduce((acc, p) => acc + p.overdueTasks, 0);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      const [year, month, day] = dateStr.split('T')[0].split('-');
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  if (loading && !status) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        <p className="text-sm">Carregando projetos Asana do cliente...</p>
      </div>
    );
  }

  // Estado: Asana não configurado
  if (!status?.configured || !status?.connected) {
    return (
      <Card className="bg-zinc-950/40 border-white/10 p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
          <Briefcase className="w-6 h-6 text-amber-400" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="text-base font-semibold text-white">Integração Asana não configurada</h3>
          <p className="text-xs text-zinc-400">
            A conexão do Asana com a organização ainda não foi estabelecida ou as credenciais precisam ser configuradas no servidor.
          </p>
        </div>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {canManage && (
            <Button
              onClick={handleConnectAsana}
              disabled={isConnecting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm shadow-emerald-900/20 text-xs font-medium h-9 px-4"
            >
              {isConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Conectar Asana
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(false)}
            disabled={isSilentSyncing}
            className="border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 gap-2 text-xs h-9 px-4"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSilentSyncing ? 'animate-spin text-emerald-400' : ''}`} />
            Verificar Conexão
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header da Aba */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-emerald-400" />
            Projetos & Tarefas Asana
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <p className="text-xs text-zinc-400">
              Projetos vinculados no workspace {status.workspaceName ? `"${status.workspaceName}"` : 'da organização'}.
            </p>
            {isAdmin && (
              <>
                <span className="text-zinc-600 text-xs hidden sm:inline">•</span>
                <button
                  type="button"
                  onClick={() => setIsDisconnectDialogOpen(true)}
                  disabled={isDisconnecting}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors underline-offset-2 hover:underline inline-flex items-center gap-1"
                  title="Desconectar workspace Asana do Hub"
                >
                  <Unlink className="w-3 h-3" />
                  Desconectar Asana
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {lastSyncedAt && (
            <span className="text-[11px] text-zinc-400 hidden sm:inline-flex items-center gap-1.5 bg-zinc-900/80 px-2.5 py-1 rounded-md border border-white/5">
              <span className={`w-1.5 h-1.5 rounded-full ${isSilentSyncing ? 'bg-emerald-400 animate-ping' : 'bg-emerald-500'}`} />
              {isSilentSyncing ? 'Sincronizando...' : 'Sincronizado'}
            </span>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => silentRefresh()}
            disabled={isSilentSyncing}
            className="border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 h-8 gap-1.5"
            title="Atualizar dados do Asana"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSilentSyncing ? 'animate-spin text-emerald-400' : ''}`} />
          </Button>

          {canManage && (
            <Button
              onClick={handleOpenLinkDialog}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm shadow-emerald-900/20 h-8 text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Vincular projeto Asana
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={loadData} className="h-7 text-xs text-red-300 hover:bg-red-500/10">
            Tentar novamente
          </Button>
        </div>
      )}

      {/* ESTADO VAZIO: Nenhum projeto vinculado */}
      {projects.length === 0 ? (
        <Card className="bg-zinc-950/40 border-white/10 p-12 text-center border-dashed">
          <FolderGit2 className="w-12 h-12 mb-3 opacity-20 text-zinc-400 mx-auto" />
          <h3 className="text-base font-semibold text-white">Nenhum projeto Asana vinculado</h3>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
            Vincule projetos do workspace Asana para visualizar tarefas, prazos e métricas consolidadas neste cliente.
          </p>
          {canManage && (
            <Button
              onClick={handleOpenLinkDialog}
              size="sm"
              className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <Plus className="w-4 h-4" />
              Vincular Primeiro Projeto
            </Button>
          )}
        </Card>
      ) : (
        <>
          {/* CARDS DE RESUMO (KPIs DO ASANA) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Card className="bg-zinc-950/40 border-white/10">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-zinc-400">Projetos</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-xl font-bold text-white">{projects.length}</div>
                <p className="text-[10px] text-zinc-500 mt-0.5">Vinculados</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/40 border-white/10">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-zinc-400">Tarefas Totais</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-xl font-bold text-white">{totalTasksCount}</div>
                <p className="text-[10px] text-zinc-500 mt-0.5">No Asana</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/40 border-white/10">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-emerald-400/90">Concluídas</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-xl font-bold text-emerald-400">{completedTasksCount}</div>
                <p className="text-[10px] text-zinc-500 mt-0.5">Finalizadas</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/40 border-white/10">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-amber-400/90">Pendentes</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-xl font-bold text-amber-400">{pendingTasksCount}</div>
                <p className="text-[10px] text-zinc-500 mt-0.5">Em andamento</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/40 border-white/10">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-red-400/90">Atrasadas</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={`text-xl font-bold ${overdueTasksCount > 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                  {overdueTasksCount}
                </div>
                <p className="text-[10px] text-zinc-500 mt-0.5">Prazo expirado</p>
              </CardContent>
            </Card>
          </div>

          {/* LISTA DE PROJETOS VINCULADOS */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Projetos Conectados</h3>
            <div className="rounded-xl border border-white/10 overflow-hidden bg-zinc-950/40">
              <Table>
                <TableHeader className="bg-zinc-900/60">
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-zinc-400 font-medium">Projeto Asana</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-center">Tarefas</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-center">Concluídas</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-center">Pendentes</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-center">Atrasadas</TableHead>
                    <TableHead className="text-right text-zinc-400 font-medium">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.integrationId} className="border-white/5 hover:bg-zinc-900/40">
                      <TableCell className="py-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: p.color || '#10b981' }}
                          />
                          <span>{p.projectName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-zinc-300 font-medium">{p.totalTasks}</TableCell>
                      <TableCell className="text-center text-emerald-400 font-medium">{p.completedTasks}</TableCell>
                      <TableCell className="text-center text-amber-400 font-medium">{p.pendingTasks}</TableCell>
                      <TableCell className="text-center font-medium">
                        {p.overdueTasks > 0 ? (
                          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                            {p.overdueTasks} atrasada(s)
                          </Badge>
                        ) : (
                          <span className="text-zinc-500">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-2">
                          <a
                            href={`https://app.asana.com/0/${p.projectGid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-white/5 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Abrir no Asana
                          </a>

                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={unlinkingId === p.integrationId}
                              onClick={() => handleUnlink(p.integrationId, p.projectName)}
                              className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-red-950/20"
                              title="Desvincular projeto"
                            >
                              {unlinkingId === p.integrationId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* LISTA CONSOLIDADA DE TAREFAS */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Tarefas Vinculadas ({tasks.length})</h3>
              {loadingTasks && (
                <span className="text-xs text-zinc-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                  Sincronizando tarefas...
                </span>
              )}
            </div>

            <div className="rounded-xl border border-white/10 overflow-hidden bg-zinc-950/40">
              {tasks.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500">
                  Nenhuma tarefa encontrada nos projetos vinculados.
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-zinc-900/60">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-zinc-400 font-medium">Tarefa</TableHead>
                      <TableHead className="text-zinc-400 font-medium">Projeto</TableHead>
                      <TableHead className="text-zinc-400 font-medium">Seção / Etapa</TableHead>
                      <TableHead className="text-zinc-400 font-medium">Responsável</TableHead>
                      <TableHead className="text-zinc-400 font-medium">Prazo</TableHead>
                      <TableHead className="text-zinc-400 font-medium">Status</TableHead>
                      <TableHead className="text-right text-zinc-400 font-medium">Asana</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => (
                      <TableRow key={task.gid} className="border-white/5 hover:bg-zinc-900/40">
                        {/* Nome da Tarefa */}
                        <TableCell className="font-medium text-white max-w-xs truncate py-3">
                          {task.name}
                        </TableCell>

                        {/* Projeto */}
                        <TableCell className="text-xs text-zinc-400 py-3">
                          {task.projectName}
                        </TableCell>

                        {/* Seção */}
                        <TableCell className="text-xs text-zinc-400 py-3">
                          {task.sectionName || '-'}
                        </TableCell>

                        {/* Responsável */}
                        <TableCell className="text-xs text-zinc-300 py-3">
                          {task.assignee ? (
                            <div className="flex items-center gap-1.5">
                              {task.assignee.photoUrl ? (
                                <img
                                  src={task.assignee.photoUrl}
                                  alt={task.assignee.name}
                                  className="w-4 h-4 rounded-full"
                                />
                              ) : (
                                <User className="w-3.5 h-3.5 text-zinc-500" />
                              )}
                              <span>{task.assignee.name}</span>
                            </div>
                          ) : (
                            <span className="text-zinc-600">Não atribuído</span>
                          )}
                        </TableCell>

                        {/* Prazo */}
                        <TableCell className="text-xs py-3">
                          {task.dueOn || task.dueAt ? (
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                              <span
                                className={
                                  task.isOverdue && !task.completed
                                    ? 'text-red-400 font-medium'
                                    : 'text-zinc-300'
                                }
                              >
                                {formatDate(task.dueOn || task.dueAt)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-zinc-600">-</span>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="py-3">
                          {task.completed ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Concluída
                            </Badge>
                          ) : task.isOverdue ? (
                            <Badge
                              variant="outline"
                              className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] gap-1"
                            >
                              <AlertTriangle className="w-3 h-3" /> Atrasada
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] gap-1"
                            >
                              <Clock className="w-3 h-3" /> Pendente
                            </Badge>
                          )}
                        </TableCell>

                        {/* Link externo */}
                        <TableCell className="text-right py-3">
                          {task.permalinkUrl && (
                            <a
                              href={task.permalinkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-400 hover:text-emerald-400 transition-colors p-1"
                              title="Ver tarefa no Asana"
                            >
                              <ExternalLink className="w-3.5 h-3.5 inline" />
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </>
      )}

      {/* MODAL DE VINCULAÇÃO DE PROJETOS */}
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="bg-zinc-950 border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Vincular Projeto do Asana</DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs">
              Selecione os projetos do workspace Asana para associar a este cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3 max-h-72 overflow-y-auto pr-1">
            {loadingAvailable ? (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <span className="text-xs">Buscando projetos no Asana...</span>
              </div>
            ) : availableProjects.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-500">
                Nenhum projeto encontrado no workspace Asana.
              </div>
            ) : (
              availableProjects.map((p) => {
                const isAlreadyLinked = projects.some((linked) => linked.projectGid === p.gid);
                const isSelected = selectedGids.includes(p.gid);

                return (
                  <div
                    key={p.gid}
                    onClick={() => !isAlreadyLinked && handleToggleProject(p.gid)}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                      isAlreadyLinked
                        ? 'opacity-50 border-white/5 bg-zinc-900/20 cursor-not-allowed'
                        : isSelected
                        ? 'border-emerald-500/50 bg-emerald-950/20 cursor-pointer'
                        : 'border-white/10 bg-zinc-900/40 hover:bg-zinc-900/80 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        checked={isSelected || isAlreadyLinked}
                        disabled={isAlreadyLinked}
                        onCheckedChange={() => handleToggleProject(p.gid)}
                        className="data-[state=checked]:bg-emerald-600"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color || '#10b981' }}
                      />
                      <span className="text-xs font-medium text-white">{p.name}</span>
                    </div>

                    {isAlreadyLinked && (
                      <span className="text-[10px] text-zinc-500 italic">Já vinculado</span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsLinkDialogOpen(false)}
              className="border-white/10 text-zinc-400 hover:bg-white/5"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isLinking || selectedGids.length === 0}
              onClick={handleSaveLinks}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {isLinking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Vincular Selecionados ({selectedGids.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação Forte para Desconectar Asana */}
      <AlertDialog open={isDisconnectDialogOpen} onOpenChange={setIsDisconnectDialogOpen}>
        <AlertDialogContent className="bg-zinc-950 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-base">Desconectar Asana?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs leading-relaxed">
              Esta ação desconectará o workspace Asana do Zafira Hub e removerá os vínculos locais entre clientes e projetos. Nenhum projeto, tarefa, comentário ou arquivo será apagado do Asana.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel
              disabled={isDisconnecting}
              className="border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white text-xs"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnectAsana}
              disabled={isDisconnecting}
              className="bg-red-600 hover:bg-red-700 text-white text-xs gap-1.5"
            >
              {isDisconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Desconectar Asana
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
