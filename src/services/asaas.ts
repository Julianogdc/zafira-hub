import { api } from '@/lib/api';

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'DELETED'
  | 'CANCELLED';

export type AsaasLinkStatus = 'LINKED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'NO_DOCUMENT';

export interface AsaasPaymentItem {
  id: string;
  externalId: string;
  description: string;
  value: number;
  netValue: number | null;
  billingType: string;
  status: AsaasPaymentStatus;
  statusLabel: string;
  dueDate: string;
  paymentDate: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  isOverdue: boolean;
}

export interface ClientFinancialKPIs {
  pending: number;
  pendingCount: number;
  receivedMonth: number;
  receivedMonthCount: number;
  overdue: number;
  overdueCount: number;
}

export interface ClientFinancialSummaryResponse {
  clientId: string;
  isLinked: boolean;
  linkStatus?: AsaasLinkStatus;
  linkStatusLabel?: string;
  asaasCustomerId: string | null;
  kpis: ClientFinancialKPIs;
  payments: AsaasPaymentItem[];
  totalPayments: number;
}

export interface ClientSyncResult {
  success: boolean;
  clientId: string;
  linkStatus: AsaasLinkStatus;
  linkStatusLabel: string;
  asaasCustomerId: string | null;
  syncedPayments: number;
  timestamp: string;
}

export interface AsaasSyncResult {
  success: boolean;
  syncedCustomers: number;
  linkedClients: number;
  unlinkedCustomers: number;
  syncedPayments: number;
  timestamp: string;
}

export interface FinancialOverviewFilters {
  period?: 'current-month' | 'last-month' | 'current-year' | 'all' | 'custom' | string;
  startDate?: string;
  endDate?: string;
  clientId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface FinancialOverviewKPIs {
  receivedMonth: number;
  receivedMonthCount: number;
  pending: number;
  pendingCount: number;
  overdue: number;
  overdueCount: number;
  nextDueDate: {
    date: string | null;
    value: number | null;
    clientName: string | null;
  } | null;
  statusCounts: {
    pending: number;
    received: number;
    overdue: number;
    refunded: number;
    cancelled: number;
  };
  incompletePaymentsCount?: number;
}

export interface TimeSeriesPoint {
  month: string;
  label: string;
  value: number;
  count: number;
}

export interface FinancialOverviewPaymentItem extends AsaasPaymentItem {
  client: {
    id: string;
    name: string;
  } | null;
}

export interface FinancialOverviewResponse {
  kpis: FinancialOverviewKPIs;
  recebidosTimeSeries: TimeSeriesPoint[];
  previstosTimeSeries: TimeSeriesPoint[];
  payments: FinancialOverviewPaymentItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  hasUnsyncedData: boolean;
  disclaimer: string;
}

export interface AsaasWalletSyncResult {
  success: boolean;
  totalCustomersAsaas: number;
  linkedClients: number;
  createdClients: number;
  syncedPayments: number;
  ignoredWithoutDoc: number;
  ambiguousCount: number;
  errors: string[];
  timestamp: string;
}

export const asaasService = {
  /**
   * Obtém o resumo financeiro consolidado e as cobranças do Asaas para o cliente.
   */
  async getClientFinancialSummary(clientId: string): Promise<ClientFinancialSummaryResponse> {
    return api.get<ClientFinancialSummaryResponse>(
      `/clients/${clientId}/integrations/asaas/financial-summary`
    );
  },

  /**
   * Dispara a sincronização manual de cobranças do Asaas restrita ao cliente específico.
   * Não varre outros clientes da organização.
   */
  async triggerClientSync(clientId: string): Promise<ClientSyncResult> {
    return api.post<ClientSyncResult>(
      `/clients/${clientId}/integrations/asaas/sync`
    );
  },

  /**
   * Dispara a sincronização manual de cobranças e clientes do Asaas global (Modo somente leitura).
   */
  async triggerSync(): Promise<AsaasSyncResult> {
    return api.post<AsaasSyncResult>('/integrations/asaas/sync');
  },

  /**
   * Sincroniza a carteira completa de clientes e cobranças do Asaas,
   * criando novos clientes ausentes no Hub e vinculando existentes.
   */
  async syncAllWallet(): Promise<AsaasWalletSyncResult> {
    return api.post<AsaasWalletSyncResult>('/integrations/asaas/sync-all');
  },

  /**
   * Obtém a visão financeira consolidada global da organização no Hub (Etapa 4C).
   * Consulta puramente os dados locais do Hub sem chamar a API externa do Asaas.
   */
  async getFinancialOverview(filters: FinancialOverviewFilters = {}): Promise<FinancialOverviewResponse> {
    const searchParams = new URLSearchParams();
    if (filters.period) searchParams.set('period', filters.period);
    if (filters.startDate) searchParams.set('startDate', filters.startDate);
    if (filters.endDate) searchParams.set('endDate', filters.endDate);
    if (filters.clientId) searchParams.set('clientId', filters.clientId);
    if (filters.status) searchParams.set('status', filters.status);
    if (filters.search) searchParams.set('search', filters.search);
    if (filters.page) searchParams.set('page', String(filters.page));
    if (filters.limit) searchParams.set('limit', String(filters.limit));

    const qs = searchParams.toString();
    const endpoint = `/integrations/asaas/financial-overview${qs ? `?${qs}` : ''}`;
    return api.get<FinancialOverviewResponse>(endpoint);
  },
};

