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

export interface ClientAsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  sectionName?: string | null;
  assignee?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
  permalinkUrl?: string | null;
  projectGid: string;
  projectName: string;
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
   * Obtém a URL oficial para autorização OAuth no Asana
   */
  async getOAuthAuthorizeUrl(): Promise<{ url: string }> {
    return api.get<{ url: string }>('/integrations/asana/oauth/authorize');
  },
};
