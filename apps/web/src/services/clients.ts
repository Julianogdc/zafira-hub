import { api } from '@/lib/api';
import {
  ClientPortfolioItem,
  ClientDetail,
  ClientMutationResult,
  ClientStatus,
  ClientTimelineEvent,
  ClientAddress,
  ClientContact,
  CreateClientContactRequest,
  UpdateClientContactRequest,
  ClientMeetingNote,
  CreateClientMeetingNoteRequest,
  UpdateClientMeetingNoteRequest,
  ClientBriefing,
  ClientBrandKit,
} from '@zafira/contracts';

// Reexporta os contratos canônicos para consumo uniforme no frontend
export type {
  ClientPortfolioItem,
  ClientDetail,
  ClientMutationResult,
  ClientStatus,
  ClientTimelineEvent,
  ClientAddress,
  ClientContact,
  CreateClientContactRequest,
  UpdateClientContactRequest,
  ClientMeetingNote,
  CreateClientMeetingNoteRequest,
  UpdateClientMeetingNoteRequest,
  ClientBriefing,
  ClientBrandKit,
};

export type ApiClientStatus = ClientStatus;

// Tipos de compatibilidade preservados estritamente para consumidores legados não migrados
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

export type HubClient = ClientDetail & {
  integrations?: ClientIntegration[];
  _count?: {
    integrations: number;
  };
};

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
  address?: ClientAddress | null;
  briefing?: ClientBriefing | null;
  brandKit?: ClientBrandKit | null;
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
  /**
   * Lista a carteira canônica de clientes com DTO mínimo seguro (ClientPortfolioItem).
   */
  async listClients(filters?: { status?: string; search?: string }): Promise<ClientPortfolioItem[]> {
    const params = new URLSearchParams();
    if (filters?.status && filters.status !== 'ALL') params.append('status', filters.status);
    if (filters?.search && filters.search.trim()) params.append('search', filters.search.trim());

    const query = params.toString();
    const endpoint = query ? `/clients?${query}` : '/clients';

    return api.get<ClientPortfolioItem[]>(endpoint);
  },

  /**
   * Obtém detalhes estruturados do cliente (ClientDetail) com autorização condicional de campos sensíveis.
   */
  async getClientById(id: string): Promise<ClientDetail> {
    return api.get<ClientDetail>(`/clients/${id}`);
  },

  /**
   * Criação de cliente retornando DTO mínimo de mutação sanitizado (ClientMutationResult).
   */
  async createClient(data: CreateClientDTO): Promise<ClientMutationResult> {
    return api.post<ClientMutationResult>('/clients', data);
  },

  /**
   * Atualização de cliente retornando DTO mínimo de mutação sanitizado (ClientMutationResult).
   */
  async updateClient(id: string, data: UpdateClientDTO): Promise<ClientMutationResult> {
    return api.patch<ClientMutationResult>(`/clients/${id}`, data);
  },

  /**
   * Obtém a timeline sanitizada do ciclo de vida do cliente (ClientTimelineEvent[]).
   */
  async getClientTimeline(id: string): Promise<ClientTimelineEvent[]> {
    return api.get<ClientTimelineEvent[]>(`/clients/${id}/timeline`);
  },

  /**
   * Cria um novo contato para o cliente.
   */
  async createClientContact(clientId: string, data: CreateClientContactRequest): Promise<ClientContact> {
    return api.post<ClientContact>(`/clients/${clientId}/contacts`, data);
  },

  /**
   * Atualiza um contato existente do cliente.
   */
  async updateClientContact(clientId: string, contactId: string, data: UpdateClientContactRequest): Promise<ClientContact> {
    return api.patch<ClientContact>(`/clients/${clientId}/contacts/${contactId}`, data);
  },

  /**
   * Exclui um contato do cliente.
   */
  async deleteClientContact(clientId: string, contactId: string): Promise<{ success: boolean }> {
    return api.delete<{ success: boolean }>(`/clients/${clientId}/contacts/${contactId}`);
  },

  /**
   * Cria uma nova ata de reunião para o cliente.
   */
  async createClientMeeting(clientId: string, data: CreateClientMeetingNoteRequest): Promise<ClientMeetingNote> {
    return api.post<ClientMeetingNote>(`/clients/${clientId}/meetings`, data);
  },

  /**
   * Atualiza uma ata de reunião existente do cliente.
   */
  async updateClientMeeting(clientId: string, meetingId: string, data: UpdateClientMeetingNoteRequest): Promise<ClientMeetingNote> {
    return api.patch<ClientMeetingNote>(`/clients/${clientId}/meetings/${meetingId}`, data);
  },

  /**
   * Exclui uma ata de reunião do cliente.
   */
  async deleteClientMeeting(clientId: string, meetingId: string): Promise<{ success: boolean }> {
    return api.delete<{ success: boolean }>(`/clients/${clientId}/meetings/${meetingId}`);
  },
};
