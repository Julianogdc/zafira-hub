import { api } from '@/lib/api';

export interface AsanaStatus {
  configured: boolean;
  connected: boolean;
  source?: 'organization' | 'env';
  workspaceId?: string | null;
  workspaceName?: string | null;
  user?: {
    gid: string;
    name: string;
    email?: string;
  } | null;
}

export interface AsanaProjectSummary {
  gid: string;
  name: string;
  color?: string | null;
  notes?: string | null;
  workspaceGid?: string | null;
}

export interface ClientAsanaProject {
  integrationId: string;
  clientId: string;
  projectGid: string;
  projectName: string;
  color?: string | null;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  createdAt: string;
}

export interface AsanaTag {
  gid: string;
  name: string;
}

export interface AsanaCustomField {
  gid: string;
  name: string;
  value: string;
  type: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
}

export interface UpdateAsanaTaskInput {
  name?: string;
  notes?: string | null;
  completed?: boolean;
  due_on?: string | null;
  due_at?: string | null;
  assignee?: string | null;
}

export interface ClientAsanaTask {
  gid: string;
  name: string;
  notes?: string | null;
  completed: boolean;
  dueOn: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  sectionName?: string | null;
  sectionGid?: string | null;
  assignee?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
  permalinkUrl?: string | null;
  projectGid: string;
  projectName: string;
  tags?: AsanaTag[];
  customFields?: AsanaCustomField[];
}

export const asanaIntegrationService = {
  /**
   * Consulta o status de integração da organização com o Asana
   */
  async getStatus(): Promise<AsanaStatus> {
    return api.get<AsanaStatus>('/integrations/asana/status');
  },

  /**
   * Lista projetos do workspace disponíveis para vincular
   */
  async getWorkspaceProjects(): Promise<AsanaProjectSummary[]> {
    return api.get<AsanaProjectSummary[]>('/integrations/asana/projects');
  },

  /**
   * Lista projetos Asana vinculados a um cliente com métricas
   */
  async getClientProjects(clientId: string): Promise<ClientAsanaProject[]> {
    return api.get<ClientAsanaProject[]>(`/clients/${clientId}/asana/projects`);
  },

  /**
   * Vincula um ou mais projetos Asana ao cliente
   */
  async linkProjects(clientId: string, projectGids: string[]): Promise<{ linked: number }> {
    return api.post<{ linked: number }>(`/clients/${clientId}/asana/projects`, { projectGids });
  },

  /**
   * Desvincula um projeto Asana do cliente
   */
  async unlinkProject(clientId: string, integrationId: string): Promise<void> {
    return api.delete(`/clients/${clientId}/asana/projects/${integrationId}`);
  },

  /**
   * Lista tarefas de todos os projetos vinculados ao cliente
   */
  async getClientTasks(clientId: string): Promise<ClientAsanaTask[]> {
    return api.get<ClientAsanaTask[]>(`/clients/${clientId}/asana/tasks`);
  },

  /**
   * Obtém os dados de uma única tarefa (para atualização imediata sem overhead)
   */
  async getSingleTask(clientId: string, taskGid: string): Promise<ClientAsanaTask | null> {
    return api.get<ClientAsanaTask | null>(`/clients/${clientId}/asana/tasks/${taskGid}`);
  },

  /**
   * Atualiza os dados de uma tarefa existente no Asana (name, notes, completed, due_on, due_at, assignee)
   */
  async updateTask(clientId: string, taskGid: string, data: UpdateAsanaTaskInput): Promise<ClientAsanaTask> {
    return api.patch<ClientAsanaTask>(`/clients/${clientId}/asana/tasks/${taskGid}`, data);
  },

  /**
   * Retorna os membros válidos do workspace Asana para seleção de responsável
   */
  async getWorkspaceUsers(): Promise<AsanaUser[]> {
    return api.get<AsanaUser[]>('/integrations/asana/users');
  },

  /**
   * Obtém a URL oficial para autorização OAuth no Asana
   */
  async getOAuthAuthorizeUrl(): Promise<{ url: string }> {
    return api.get<{ url: string }>('/integrations/asana/oauth/authorize');
  },

  /**
   * Desconecta completamente o Asana da organização (ADMIN)
   */
  async disconnect(): Promise<{ status: string; message: string }> {
    return api.delete('/integrations/asana/disconnect');
  },

  /**
   * Sincroniza e garante webhooks ativos para todos os projetos vinculados da organização
   */
  async syncWebhooks(): Promise<{ synced: number; details: any[] }> {
    return api.post('/integrations/asana/webhooks/sync');
  },

  /**
   * Retorna diagnóstico seguro da integração Asana (ADMIN)
   */
  async getDiagnostics(): Promise<any> {
    return api.get('/integrations/asana/diagnostics');
  },

  /**
   * Conecta ao stream Server-Sent Events (SSE) do Asana para receber atualizações da organização
   */
  subscribeToEvents(onEvent: (event: AsanaRealtimeEvent) => void, onError?: (err: any) => void): () => void {
    const url = '/api/integrations/asana/events';
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onopen = () => {
      console.log('[Asana SSE] connected');
    };

    const handleData = (raw: string) => {
      console.log('[Asana SSE] event received');
      try {
        const parsed = JSON.parse(raw);
        onEvent(parsed);
      } catch (err) {
        console.warn('[AsanaSSE] Falha no parse do evento recebido:', err);
      }
    };

    // Escuta eventos tipados 'asana_event'
    eventSource.addEventListener('asana_event', (e: MessageEvent) => {
      handleData(e.data);
    });

    eventSource.onerror = (err) => {
      console.error('[Asana SSE] error', err);
      if (onError) onError(err);
    };

    return () => {
      eventSource.close();
    };
  },
};

export interface AsanaRealtimeEvent {
  type: string;
  organizationId: string;
  projectGid: string;
  resourceGid?: string;
  resourceType?: string;
  action?: string;
  timestamp: string;
  details?: any;
  timing?: {
    asanaCreatedAt?: string | null;
    serverReceivedAt?: number;
    serverPublishedAt?: number;
  };
}


