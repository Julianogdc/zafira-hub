import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { FinancialAccountProvider, FinancialTransactionDirection, FinancialTransactionKind } from '@prisma/client';
import { FinancialCategoryService, financialCategoryService } from './financial-category.service.js';

export interface FinancialAccountsOverviewResponse {
  asaasBalance: number;
  interBalance: number;
  consolidatedBalance: number;
  operationalIncome: number;
  operationalExpense: number;
  internalTransfersAmount: number;
  toReviewCount: number;
  accounts: {
    id: string;
    provider: FinancialAccountProvider;
    name: string;
    currency: string;
    currentBalance: number;
    balanceAsOf: string | null;
    lastSyncedAt: string | null;
    isActive: boolean;
  }[];
  periodSummary?: {
    startDate: string;
    endDate: string;
    operationalIncome: number;
    operationalExpense: number;
    internalTransfersAmount: number;
    pendingReviewCount: number;
  };
  timestamp: string;
}

export interface FinancialTransactionsFilters {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  provider?: FinancialAccountProvider;
  direction?: FinancialTransactionDirection;
  kind?: FinancialTransactionKind;
  categoryId?: string;
  clientId?: string;
  pendingCategoryOnly?: boolean;
  counterparty?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class FinancialService {
  private readonly prisma: typeof defaultPrisma;
  private readonly categoryService: FinancialCategoryService;

  constructor(prismaClient?: any, categoryService?: FinancialCategoryService) {
    this.prisma = prismaClient || defaultPrisma;
    this.categoryService = categoryService || new FinancialCategoryService(this.prisma);
  }

  /**
   * Visão geral de contas, saldos e indicadores operacionais consolidada da organização.
   * Estritamente leitura local sem mutação.
   */
  async getAccountsOverview(
    organizationId: string,
    period?: { startDate?: string; endDate?: string }
  ): Promise<FinancialAccountsOverviewResponse> {
    // 1. Busca todas as contas ativas do Banco Inter PJ da organização
    const accounts = await this.prisma.financialAccount.findMany({
      where: { organizationId, isActive: true, provider: 'INTER' },
      orderBy: { name: 'asc' },
    });

    let interBalance = 0;

    const formattedAccounts = accounts.map((acc) => {
      const bal = Number(acc.currentBalance);
      interBalance += bal;
      return {
        id: acc.id,
        provider: acc.provider,
        name: acc.name,
        currency: acc.currency,
        currentBalance: bal,
        balanceAsOf: acc.balanceAsOf ? acc.balanceAsOf.toISOString() : null,
        lastSyncedAt: acc.lastSyncedAt ? acc.lastSyncedAt.toISOString() : null,
        isActive: acc.isActive,
      };
    });

    // O Asaas é estritamente visor de cobranças e contas a receber.
    // O caixa e os saldos operacionais são alimentados exclusivamente pelo Banco Inter PJ.
    const consolidatedBalance = interBalance;
    const asaasBalance = 0;

    // 2. Filtro de período para fluxos operacionais
    const dateWhere: any = {};
    if (period?.startDate) {
      dateWhere.gte = new Date(period.startDate);
    }
    if (period?.endDate) {
      dateWhere.lte = new Date(period.endDate);
    }

    // 3. Busca transações para cálculo de entradas, saídas e movimentações exclusivamente do Banco Inter PJ
    const txWhere: any = {
      organizationId,
      account: { provider: 'INTER' },
      ...(Object.keys(dateWhere).length > 0 ? { occurredAt: dateWhere } : {}),
    };

    const transactions = await this.prisma.financialTransaction.findMany({
      where: txWhere,
      select: {
        amount: true,
        direction: true,
        kind: true,
        categorizationSource: true,
      },
    });

    let operationalIncome = 0;
    let operationalExpense = 0;
    let internalTransfersAmount = 0;
    let toReviewCount = 0;

    for (const tx of transactions) {
      const amt = Number(tx.amount);
      if (tx.categorizationSource === 'PENDING') {
        toReviewCount += 1;
      }

      // Transferências internas NÃO entram em receitas nem em despesas
      if (tx.kind === 'TRANSFER_INTERNAL') {
        if (tx.direction === 'DEBIT') {
          internalTransfersAmount += amt;
        }
        continue;
      }

      if (tx.direction === 'CREDIT') {
        operationalIncome += amt;
      } else if (tx.direction === 'DEBIT') {
        operationalExpense += amt;
      }
    }

    return {
      asaasBalance,
      interBalance,
      consolidatedBalance,
      operationalIncome,
      operationalExpense,
      internalTransfersAmount,
      toReviewCount,
      accounts: formattedAccounts,
      periodSummary: {
        startDate: period?.startDate || '',
        endDate: period?.endDate || '',
        operationalIncome,
        operationalExpense,
        internalTransfersAmount,
        pendingReviewCount: toReviewCount,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Extrato unificado de transações com filtros avançados e paginação.
   */
  async getTransactions(organizationId: string, filters: FinancialTransactionsFilters = {}) {
    const {
      startDate,
      endDate,
      accountId,
      provider,
      direction,
      kind,
      categoryId,
      counterparty,
      status,
      search,
      page = 1,
      limit = 30,
    } = filters;

    // A aba de Caixa e Movimentações é estritamente Banco Inter PJ.
    // Registros históricos do Asaas são preservados no banco para auditoria,
    // mas excluídos rigorosamente das consultas e extrato do caixa.
    const where: any = {
      organizationId,
      account: { provider: 'INTER' },
    };

    if (accountId) {
      where.accountId = accountId;
    }

    if (startDate || endDate) {
      where.occurredAt = {};
      if (startDate) where.occurredAt.gte = new Date(startDate);
      if (endDate) where.occurredAt.lte = new Date(endDate);
    }

    if (direction) {
      where.direction = direction;
    }

    if (kind) {
      where.kind = kind;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (counterparty) {
      where.OR = [
        { counterpartyName: { contains: counterparty, mode: 'insensitive' } },
        { counterpartyDocument: { contains: counterparty.replace(/\D/g, '') } },
      ];
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { externalReference: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      if (status === 'CONFIRMED' || status === 'AUTO_MATCHED') {
        where.OR = [
          { sourceTransfer: { status: { in: ['CONFIRMED', 'AUTO_MATCHED'] } } },
          { destTransfer: { status: { in: ['CONFIRMED', 'AUTO_MATCHED'] } } },
        ];
      } else if (status === 'REVIEW') {
        where.OR = [
          { sourceTransfer: { status: 'REVIEW' } },
          { destTransfer: { status: 'REVIEW' } },
        ];
      } else if (status === 'UNMATCHED') {
        where.sourceTransfer = null;
        where.destTransfer = null;
      }
    }

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    const total = await this.prisma.financialTransaction.count({ where });
    const transactions = await this.prisma.financialTransaction.findMany({
      where,
      include: {
        account: {
          select: { id: true, name: true, provider: true },
        },
        category: {
          select: { id: true, name: true, type: true, color: true },
        },
        client: {
          select: { id: true, name: true, document: true },
        },
        suggestedClient: {
          select: { id: true, name: true },
        },
        sourceTransfer: {
          select: { id: true, status: true, matchReason: true, confirmedAt: true },
        },
        destTransfer: {
          select: { id: true, status: true, matchReason: true, confirmedAt: true },
        },
      },
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        accountId: t.accountId,
        accountName: t.account.name,
        provider: t.account.provider,
        externalId: t.externalId,
        occurredAt: t.occurredAt.toISOString(),
        transactedAt: t.occurredAt.toISOString(),
        direction: t.direction,
        kind: t.kind,
        amount: Number(t.amount),
        description: t.description,
        counterpartyName: t.counterpartyName,
        counterpartyDocument: t.counterpartyDocument,
        externalReference: t.externalReference,
        datePrecision: (t as any).datePrecision || 'DATE_ONLY',
        categoryId: t.categoryId,
        category: t.category,
        clientId: (t as any).clientId || null,
        client: (t as any).client || null,
        suggestedClientId: (t as any).suggestedClientId || null,
        suggestedClient: (t as any).suggestedClient || null,
        categorizationSource: t.categorizationSource,
        categorizationConfidence: t.categorizationConfidence ? Number(t.categorizationConfidence) : null,
        transfer: t.sourceTransfer || t.destTransfer || null,
        rawPayload: t.rawPayload,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Atualização manual de categoria e cliente de uma transação.
   * Registra categorizationSource = MANUAL e limpa suggestedClientId.
   * Opcionalmente cria uma regra de categorização para transações futuras da organização.
   */
  async updateTransactionCategory(
    organizationId: string,
    transactionId: string,
    data: {
      categoryId?: string;
      clientId?: string | null;
      createRule?: boolean;
      ruleMatchField?: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
      ruleMatchType?: 'CONTAINS' | 'EXACT';
      rulePattern?: string;
      rulePriority?: number;
      ruleLinkClient?: boolean;
    }
  ) {
    const tx = await this.prisma.financialTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!tx || tx.organizationId !== organizationId) {
      throw new Error('Transação financeira não encontrada.');
    }

    const updatePayload: any = {
      categorizationSource: 'MANUAL',
      categorizationConfidence: 1.0,
      suggestedClientId: null, // Limpa sugestão pendente após classificação manual
    };

    if (data.categoryId) {
      updatePayload.categoryId = data.categoryId;
    }

    if (data.clientId !== undefined) {
      if (data.clientId && this.prisma.client) {
        const client = await this.prisma.client.findFirst({
          where: { id: data.clientId, organizationId },
        });
        if (!client) throw new Error('Cliente informado não pertence a esta organização.');
        updatePayload.clientId = data.clientId;
      } else {
        updatePayload.clientId = null;
      }
    }

    const updated = await this.prisma.financialTransaction.update({
      where: { id: transactionId },
      data: updatePayload,
      include: {
        category: true,
        client: { select: { id: true, name: true, document: true } },
      },
    });

    if (data.createRule) {
      const matchField = data.ruleMatchField || (data as any).ruleField || (tx.counterpartyName ? 'COUNTERPARTY_NAME' : 'DESCRIPTION');
      let matchVal = data.rulePattern?.trim() || '';
      if (!matchVal) {
        if (matchField === 'COUNTERPARTY_NAME') matchVal = tx.counterpartyName || '';
        else if (matchField === 'COUNTERPARTY_DOCUMENT') matchVal = tx.counterpartyDocument || '';
        else matchVal = tx.description;
      }

      if (matchVal) {
        let ruleCatId = data.categoryId || tx.categoryId;
        if (!ruleCatId) {
          const catMap = await this.categoryService.ensureDefaultCategories(organizationId);
          ruleCatId = catMap.get('Receita de clientes') || catMap.get('Receita de cliente') || '';
        }

        const ruleClientId = data.clientId !== undefined ? data.clientId : (tx as any).clientId;

        await this.categoryService.createCategoryRule(organizationId, {
          categoryId: ruleCatId,
          clientId: ruleClientId || null,
          matchField: matchField as any,
          matchType: data.ruleMatchType || 'CONTAINS',
          matchValue: matchVal,
          priority: data.rulePriority ?? 20,
        });
      }
    }

    return updated;
  }
}

export const financialService = new FinancialService();
