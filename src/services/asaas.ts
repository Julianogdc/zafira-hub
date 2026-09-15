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
   * Ação restrita a usuários ADMIN e MANAGER para a página Financeiro global futura.
   */
  async triggerSync(): Promise<AsaasSyncResult> {
    return api.post<AsaasSyncResult>('/integrations/asaas/sync');
  },
};
