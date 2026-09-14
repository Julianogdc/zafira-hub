import { api } from '@/lib/api';

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'DELETED'
  | 'CANCELLED';

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
  asaasCustomerId: string | null;
  kpis: ClientFinancialKPIs;
  payments: AsaasPaymentItem[];
  totalPayments: number;
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
   * Dispara a sincronização manual de cobranças e clientes do Asaas (Modo somente leitura).
   * Ação restrita a usuários ADMIN e MANAGER.
   */
  async triggerSync(): Promise<AsaasSyncResult> {
    return api.post<AsaasSyncResult>('/integrations/asaas/sync');
  },
};
