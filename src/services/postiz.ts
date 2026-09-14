import { api } from '@/lib/api';

export interface PostizStatus {
  connected: boolean;
  provider: 'POSTIZ';
}

export interface ClientLinkedPostizAccount {
  id: string;
  externalId: string;
  provider: 'POSTIZ';
  name?: string | null;
  metadata?: any;
  createdAt: string;
  updatedAt?: string;
}

export interface ClientPostizAccountsResponse {
  clientId: string;
  accounts: ClientLinkedPostizAccount[];
  total: number;
}

export interface ClientPostizPost {
  id: string;
  integrationId: string;
  platform: string;
  accountName: string;
  accountPicture?: string | null;
  status: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT' | string;
  content: string;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  releaseUrl?: string | null;
}

export interface ClientPostizContentResponse {
  clientId: string;
  posts: ClientPostizPost[];
  total: number;
}

export interface AvailablePostizAccount {
  integrationId: string;
  platform: string;
  accountName: string;
  accountPicture?: string | null;
  isLinked: boolean;
  linkedClientId?: string | null;
  linkedClientName?: string | null;
  isLinkedToCurrentClient: boolean;
}

export interface AvailablePostizAccountsResponse {
  accounts: AvailablePostizAccount[];
  total: number;
}

export const postizIntegrationService = {
  /**
   * Consulta status de conectividade do Hub com o Postiz Lab.
   */
  async getStatus(): Promise<PostizStatus> {
    return api.get<PostizStatus>('/integrations/postiz/status');
  },

  /**
   * Lista as contas do Postiz vinculadas ao cliente no Client 360.
   */
  async getClientAccounts(clientId: string): Promise<ClientPostizAccountsResponse> {
    return api.get<ClientPostizAccountsResponse>(`/clients/${clientId}/integrations/postiz`);
  },

  /**
   * Lista as contas disponíveis do Postiz com status de vínculo para este cliente e organização.
   */
  async getAvailableAccounts(clientId: string): Promise<AvailablePostizAccountsResponse> {
    return api.get<AvailablePostizAccountsResponse>(`/clients/${clientId}/integrations/postiz/available`);
  },

  /**
   * Obtém as publicações do Postiz filtradas para as contas vinculadas a este cliente.
   */
  async getClientContent(
    clientId: string,
    params?: { startDate?: string; endDate?: string }
  ): Promise<ClientPostizContentResponse> {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);

    const qs = query.toString() ? `?${query.toString()}` : '';
    return api.get<ClientPostizContentResponse>(`/clients/${clientId}/content/postiz${qs}`);
  },

  /**
   * Vincula uma conta do Postiz a um cliente.
   */
  async linkAccount(clientId: string, externalId: string) {
    return api.post(`/clients/${clientId}/integrations/postiz`, { externalId });
  },

  /**
   * Desvincula uma conta do Postiz de um cliente (remove apenas do Hub).
   */
  async unlinkAccount(clientId: string, externalId: string) {
    return api.delete(`/clients/${clientId}/integrations/postiz/${externalId}`);
  },
};

