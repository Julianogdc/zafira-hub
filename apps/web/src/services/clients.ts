import { api } from '@/lib/api';

export type ApiClientStatus = 'LEAD' | 'ACTIVE' | 'PAUSED' | 'INACTIVE';

export interface ClientIntegration {
  id: string;
  clientId: string;
  provider: 'TWENTY' | 'ASANA' | 'POSTIZ' | 'BRIGHTBEAN' | 'META' | 'GOOGLE_ADS' | 'ASAAS';
  externalId: string;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResponsibleUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface HubClient {
  id: string;
  organizationId: string;
  name: string;
  legalName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  status: ApiClientStatus;
  responsibleUserId?: string | null;
  responsibleUser?: ResponsibleUser | null;
  contractValue?: number | string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  integrations?: ClientIntegration[];
  _count?: {
    integrations: number;
  };
}

export interface CreateClientDTO {
  name: string;
  legalName?: string;
  document?: string;
  email?: string;
  phone?: string;
  status?: ApiClientStatus;
  responsibleUserId?: string;
  contractValue?: number;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

export interface UpdateClientDTO {
  name?: string;
  legalName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: ApiClientStatus;
  responsibleUserId?: string | null;
  contractValue?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export const statusLabels: Record<ApiClientStatus, string> = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  INACTIVE: 'Inativo',
  LEAD: 'Lead',
};

export const statusColors: Record<ApiClientStatus, { bg: string; text: string; border: string }> = {
  ACTIVE: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  PAUSED: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  INACTIVE: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' },
  LEAD: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
};

export const clientsService = {
  async listClients(filters?: { status?: string; search?: string }): Promise<HubClient[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);

    const query = params.toString();
    const endpoint = query ? `/clients?${query}` : '/clients';

    return api.get<HubClient[]>(endpoint);
  },

  async getClientById(id: string): Promise<HubClient> {
    return api.get<HubClient>(`/clients/${id}`);
  },

  async createClient(data: CreateClientDTO): Promise<HubClient> {
    return api.post<HubClient>('/clients', data);
  },

  async updateClient(id: string, data: UpdateClientDTO): Promise<HubClient> {
    return api.patch<HubClient>(`/clients/${id}`, data);
  },
};
