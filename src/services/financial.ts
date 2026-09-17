import { api } from '@/lib/api';

export type FinancialAccountProvider = 'ASAAS' | 'INTER' | 'MANUAL';
export type FinancialTransactionDirection = 'CREDIT' | 'DEBIT' | 'INCOME' | 'EXPENSE';
export type FinancialTransactionKind = 'OPERATIONAL' | 'CUSTOMER_PAYMENT' | 'EXPENSE' | 'TRANSFER_INTERNAL' | 'FEE' | 'TAX' | 'ADJUSTMENT';
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
  slug?: string;
  color?: string | null;
  icon?: string | null;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'FEE' | 'TAX' | 'OTHER';
  isSystem?: boolean;
  isActive?: boolean;
  _count?: {
    transactions: number;
  };
}

export interface FinancialCategoryRuleItem {
  id: string;
  categoryId: string;
  clientId?: string | null;
  matchField: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
  matchType: 'CONTAINS' | 'EXACT';
  matchValueNormalized: string;
  priority: number;
  isActive: boolean;
  category?: {
    id: string;
    name: string;
    color?: string | null;
    type: string;
  };
  client?: {
    id: string;
    name: string;
  } | null;
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
  occurredAt?: string;
  transactedAt?: string;
  description: string;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  categoryId?: string | null;
  category: FinancialCategoryItem | null;
  clientId?: string | null;
  client?: { id: string; name: string; document?: string | null } | null;
  suggestedClientId?: string | null;
  suggestedClient?: { id: string; name: string } | null;
  categorizationSource: FinancialCategorizationSource;
  transferId?: string | null;
  transferStatus?: FinancialTransferStatus | null;
  pairedTransactionId?: string | null;
  isConciliated?: boolean;
  datePrecision?: 'DATE_ONLY' | 'DATETIME';
  rawPayload?: any;
}

export interface FinancialTransactionsParams {
  accountId?: string;
  categoryId?: string;
  clientId?: string;
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
  categoryId?: string;
  clientId?: string | null;
  createRule?: boolean;
  rulePattern?: string;
  ruleField?: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
  ruleMatchType?: 'CONTAINS' | 'EXACT';
  rulePriority?: number;
  ruleLinkClient?: boolean;
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

  getCategories: async (includeArchived = false): Promise<FinancialCategoryItem[]> => {
    const result = await api.get<{ categories: FinancialCategoryItem[] } | FinancialCategoryItem[]>(
      `/financial/categories${includeArchived ? '?includeArchived=true' : ''}`
    );
    if (Array.isArray(result)) {
      return result;
    }
    if (result && Array.isArray(result.categories)) {
      return result.categories;
    }
    return [];
  },

  createCategory: async (data: { name: string; type?: string; color?: string }): Promise<FinancialCategoryItem> => {
    return api.post('/financial/categories', data);
  },

  updateCategory: async (id: string, data: { name?: string; type?: string; color?: string }): Promise<FinancialCategoryItem> => {
    return api.patch(`/financial/categories/${id}`, data);
  },

  archiveCategory: async (id: string): Promise<{ success: boolean; category: FinancialCategoryItem }> => {
    return api.post(`/financial/categories/${id}/archive`);
  },

  reactivateCategory: async (id: string): Promise<{ success: boolean; category: FinancialCategoryItem }> => {
    return api.post(`/financial/categories/${id}/reactivate`);
  },

  deleteCategory: async (id: string): Promise<{ success: boolean; message: string }> => {
    return api.delete(`/financial/categories/${id}`);
  },

  migrateCategory: async (id: string, targetCategoryId: string): Promise<{ success: boolean; migratedCount: number }> => {
    return api.post(`/financial/categories/${id}/migrate`, { targetCategoryId });
  },

  getCategoryRules: async (): Promise<FinancialCategoryRuleItem[]> => {
    const res = await api.get<{ rules: FinancialCategoryRuleItem[] }>('/financial/category-rules');
    return res.rules || [];
  },

  createCategoryRule: async (data: {
    categoryId: string;
    clientId?: string | null;
    matchField: string;
    matchType: string;
    matchValue: string;
    priority?: number;
    isActive?: boolean;
  }): Promise<FinancialCategoryRuleItem> => {
    return api.post('/financial/category-rules', data);
  },

  updateCategoryRule: async (id: string, data: Partial<FinancialCategoryRuleItem>): Promise<FinancialCategoryRuleItem> => {
    return api.patch(`/financial/category-rules/${id}`, data);
  },

  deleteCategoryRule: async (id: string): Promise<{ success: boolean }> => {
    return api.delete(`/financial/category-rules/${id}`);
  },

  previewCategoryRule: async (data: {
    matchField: string;
    matchType: string;
    matchValue: string;
  }): Promise<{ totalMatches: number; sampleMatches: any[] }> => {
    return api.post('/financial/category-rules/preview', data);
  },

  applyCategoryRule: async (id: string): Promise<{ success: boolean; appliedCount: number }> => {
    return api.post(`/financial/category-rules/${id}/apply`);
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

  reprocessInter: async (): Promise<{ success: boolean; message: string; reprocessedCount: number; updatedCount: number }> => {
    return api.post('/integrations/inter/reprocess');
  },

  repairInterDuplicates: async (): Promise<{
    success: boolean;
    scanned: number;
    duplicatesRemoved: number;
    manualDataMerged: number;
    ambiguousDuplicatesSkipped: number;
    remainingTransactions: number;
    message?: string;
    totalInspected?: number;
    mergedCount?: number;
    removedCount?: number;
  }> => {
    return api.post('/integrations/inter/repair-duplicates');
  },

  getInterDateDiagnostics: async (): Promise<{
    totalTransactions: number;
    dateFieldPresence: Record<string, number>;
    detectedPrecision: {
      DATETIME: number;
      DATE_ONLY: number;
    };
  }> => {
    return api.get('/integrations/inter/diagnostics/date-fields');
  },
};
