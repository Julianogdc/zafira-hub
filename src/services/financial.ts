import { api } from '@/lib/api';

export type FinancialAccountProvider = 'ASAAS' | 'INTER' | 'MANUAL';
export type FinancialTransactionDirection = 'INCOME' | 'EXPENSE';
export type FinancialTransactionKind = 'OPERATIONAL' | 'TRANSFER_INTERNAL' | 'FEE' | 'TAX' | 'ADJUSTMENT';
export type FinancialCategorizationSource = 'RULE' | 'MANUAL' | 'DEFAULT' | 'PENDING';
export type FinancialTransferStatus = 'AUTO_MATCHED' | 'REVIEW' | 'CONFIRMED' | 'REJECTED';

export interface FinancialAccountSummary {
  id: string;
  provider: FinancialAccountProvider;
  name: string;
  accountNumber?: string | null;
  agency?: string | null;
  balance?: number;
  currentBalance?: number;
  lastSyncAt?: string | null;
  lastSyncedAt?: string | null;
  isActive?: boolean;
  status?: string;
  metadata?: any;
}

export interface FinancialAccountsOverviewResponse {
  accounts: FinancialAccountSummary[];
  consolidatedBalance: number;
  periodSummary: {
    startDate: string;
    endDate: string;
    operationalIncome: number;
    operationalExpense: number;
    internalTransfersAmount: number;
    pendingReviewCount: number;
  };
}

export interface FinancialCategoryItem {
  id: string;
  name: string;
  slug: string;
  color?: string | null;
  icon?: string | null;
  type: 'INCOME' | 'EXPENSE' | 'BOTH' | 'TRANSFER';
}

export interface FinancialTransactionItem {
  id: string;
  accountId: string;
  accountName: string;
  provider: FinancialAccountProvider;
  externalId: string;
  direction: FinancialTransactionDirection;
  kind: FinancialTransactionKind;
  amount: number;
  transactedAt: string;
  description: string;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  category: FinancialCategoryItem | null;
  categorizationSource: FinancialCategorizationSource;
  transferId: string | null;
  transferStatus: FinancialTransferStatus | null;
  pairedTransactionId: string | null;
  isConciliated: boolean;
}

export interface FinancialTransactionsParams {
  accountId?: string;
  categoryId?: string;
  direction?: FinancialTransactionDirection;
  kind?: FinancialTransactionKind;
  pendingCategoryOnly?: boolean;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface FinancialTransactionsResponse {
  transactions: FinancialTransactionItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface UpdateCategoryPayload {
  categoryId: string;
  createRule?: boolean;
  rulePattern?: string;
  ruleField?: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
  ruleMatchType?: 'CONTAINS' | 'EXACT';
}

export interface SyncLedgerResult {
  success: boolean;
  syncedCount: number;
  balance: number;
  reconciliation?: {
    createdTransfersCount: number;
    autoMatchedCount: number;
    reviewCount: number;
  };
  error?: string;
}

export interface SyncInterResult {
  success: boolean;
  syncedCount: number;
  balance: number;
  reconciliation?: {
    createdTransfersCount: number;
    autoMatchedCount: number;
    reviewCount: number;
  };
  code?: string;
  message?: string;
  error?: string;
}

export const financialApi = {
  getOverview: async (startDate?: string, endDate?: string): Promise<FinancialAccountsOverviewResponse> => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const qs = params.toString();
    return api.get<FinancialAccountsOverviewResponse>(`/financial/accounts/overview${qs ? `?${qs}` : ''}`);
  },

  getTransactions: async (params: FinancialTransactionsParams = {}): Promise<FinancialTransactionsResponse> => {
    const searchParams = new URLSearchParams();
    if (params.accountId) searchParams.append('accountId', params.accountId);
    if (params.categoryId) searchParams.append('categoryId', params.categoryId);
    if (params.direction) searchParams.append('direction', params.direction);
    if (params.kind) searchParams.append('kind', params.kind);
    if (params.pendingCategoryOnly) searchParams.append('pendingCategoryOnly', 'true');
    if (params.startDate) searchParams.append('startDate', params.startDate);
    if (params.endDate) searchParams.append('endDate', params.endDate);
    if (params.search) searchParams.append('search', params.search);
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.limit) searchParams.append('limit', params.limit.toString());

    const qs = searchParams.toString();
    return api.get<FinancialTransactionsResponse>(`/financial/transactions${qs ? `?${qs}` : ''}`);
  },

  getCategories: async (): Promise<FinancialCategoryItem[]> => {
    const result = await api.get<{ categories: FinancialCategoryItem[] } | FinancialCategoryItem[]>('/financial/categories');
    if (Array.isArray(result)) {
      return result;
    }
    if (result && Array.isArray(result.categories)) {
      return result.categories;
    }
    return [];
  },

  updateTransactionCategory: async (id: string, payload: UpdateCategoryPayload): Promise<any> => {
    return api.patch(`/financial/transactions/${id}/category`, payload);
  },

  confirmTransfer: async (transferId: string): Promise<any> => {
    return api.patch(`/financial/transfers/${transferId}/confirm`);
  },

  syncAsaasLedger: async (): Promise<SyncLedgerResult> => {
    return api.post<SyncLedgerResult>('/integrations/asaas/sync-ledger');
  },

  syncInter: async (payload?: { startDate?: string; endDate?: string }): Promise<SyncInterResult> => {
    return api.post<SyncInterResult>('/integrations/inter/sync', payload || {});
  },
};
