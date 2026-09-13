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

export interface AsanaEnumOption {
  gid: string;
  name: string;
  color?: string | null;
  enabled?: boolean;
}

export interface AsanaCustomField {
  gid: string;
  name: string;
  value: string;
  type: string;
  textValue?: string | null;
  numberValue?: number | null;
  enumOptions?: AsanaEnumOption[];
  enumValue?: { gid: string; name: string; color?: string | null } | null;
}

export interface AsanaDependency {
  gid: string;
  name: string;
  completed: boolean;
  relationship: 'blocking' | 'dependent';
}

export interface AsanaUser {
  gid: string;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
}

export interface AsanaSection {
  gid: string;
  name: string;
}

export interface AsanaSubtask {
  gid: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  dueAt: string | null;
  assignee?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
}

export interface AsanaStory {
  gid: string;
  text: string;
  htmlText?: string | null;
  type: 'comment' | 'system';
  createdAt: string;
  createdBy?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
}

export interface AsanaAttachment {
  gid: string;
  name: string;
  downloadUrl: string | null;
  viewUrl: string | null;
  permanentUrl: string | null;
  host: string;
  size: number | null;
  createdAt: string;
}

export interface UpdateAsanaTaskInput {
  name?: string;
  notes?: string | null;
  completed?: boolean;
  due_on?: string | null;
  due_at?: string | null;
  assignee?: string | null;
  sectionGid?: string | null;
  custom_fields?: Record<string, any>;
}

export interface CreateAsanaTaskInput {
  projectGid: string;
  name: string;
  notes?: string | null;
  due_on?: string | null;
  assignee?: string | null;
  sectionGid?: string | null;
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
   * Cria uma nova tarefa/demanda em um projeto Asana vinculado ao cliente
   */
  async createTask(clientId: string, data: CreateAsanaTaskInput): Promise<ClientAsanaTask> {
    return api.post<ClientAsanaTask>(`/clients/${clientId}/asana/tasks`, data);
  },

  /**
   * Busca as seções de um projeto vinculado ao cliente
   */
  async getProjectSections(clientId: string, projectGid: string): Promise<AsanaSection[]> {
    return api.get<AsanaSection[]>(`/clients/${clientId}/asana/projects/${projectGid}/sections`);
  },

  /**
   * Move uma tarefa para uma seção específica
   */
  async moveTaskSection(clientId: string, taskGid: string, sectionGid: string): Promise<ClientAsanaTask> {
    return api.post<ClientAsanaTask>(`/clients/${clientId}/asana/tasks/${taskGid}/section`, { sectionGid });
  },

  /**
   * Busca subtarefas de uma tarefa no Asana
   */
  async getTaskSubtasks(clientId: string, taskGid: string): Promise<AsanaSubtask[]> {
    return api.get<AsanaSubtask[]>(`/clients/${clientId}/asana/tasks/${taskGid}/subtasks`);
  },

  /**
   * Cria uma nova subtarefa no Asana
   */
  async createTaskSubtask(
    clientId: string,
    taskGid: string,
    data: { name: string; due_on?: string | null; assignee?: string | null }
  ): Promise<AsanaSubtask> {
    return api.post<AsanaSubtask>(`/clients/${clientId}/asana/tasks/${taskGid}/subtasks`, data);
  },

  /**
   * Busca comentários e histórico de atividades de uma tarefa
   */
  async getTaskStories(clientId: string, taskGid: string): Promise<AsanaStory[]> {
    return api.get<AsanaStory[]>(`/clients/${clientId}/asana/tasks/${taskGid}/stories`);
  },

  /**
   * Adiciona um novo comentário à tarefa no Asana
   */
  async addTaskComment(clientId: string, taskGid: string, text: string): Promise<AsanaStory> {
    return api.post<AsanaStory>(`/clients/${clientId}/asana/tasks/${taskGid}/stories`, { text });
  },

  /**
   * Busca lista de anexos vinculados à tarefa no Asana Cloud
   */
  async getTaskAttachments(clientId: string, taskGid: string): Promise<AsanaAttachment[]> {
    return api.get<AsanaAttachment[]>(`/clients/${clientId}/asana/tasks/${taskGid}/attachments`);
  },

  /**
   * Envia anexo multipart diretamente ao Asana Cloud (sem retenção em disco na VPS)
   */
  async uploadTaskAttachment(clientId: string, taskGid: string, file: File): Promise<AsanaAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<AsanaAttachment>(`/clients/${clientId}/asana/tasks/${taskGid}/attachments`, formData);
  },

  /**
   * Busca tags do workspace Asana
   */
  async getWorkspaceTags(): Promise<AsanaTag[]> {
    return api.get<AsanaTag[]>('/integrations/asana/tags');
  },

  /**
   * Adiciona uma tag à tarefa no Asana
   */
  async addTagToTask(clientId: string, taskGid: string, tagGid: string): Promise<void> {
    return api.post(`/clients/${clientId}/asana/tasks/${taskGid}/tags`, { tagGid });
  },

  /**
   * Remove uma tag de uma tarefa no Asana
   */
  async removeTagFromTask(clientId: string, taskGid: string, tagGid: string): Promise<void> {
    return api.delete(`/clients/${clientId}/asana/tasks/${taskGid}/tags/${tagGid}`);
  },

  /**
   * Busca dependências da tarefa (bloqueantes e dependentes)
   */
  async getTaskDependencies(clientId: string, taskGid: string): Promise<AsanaDependency[]> {
    return api.get<AsanaDependency[]>(`/clients/${clientId}/asana/tasks/${taskGid}/dependencies`);
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


