import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { InterClient, interClient, InterIntegrationError } from './inter.client.js';
import { FinancialCategoryService } from '../../financial/financial-category.service.js';
import { FinancialReconciliationService } from '../../financial/financial-reconciliation.service.js';
import {
  normalizeInterDate,
  normalizeInterDirection,
  normalizeInterAmount,
} from './inter.normalizer.js';

export interface InterSyncResult {
  success: boolean;
  code?: string;
  message?: string;
  account?: {
    id: string;
    name: string;
    balance: number;
    balanceAsOf: string | null;
  };
  syncedTransactions: number;
  autoMatchedTransfers?: number;
  reviewTransfers?: number;
  timestamp: string;
}

export class InterService {
  private readonly client: InterClient;
  private readonly prisma: typeof defaultPrisma;

  constructor(clientOrPrisma?: any, prismaClient?: any) {
    if (
      clientOrPrisma &&
      (clientOrPrisma.financialAccount ||
        clientOrPrisma.financialTransaction ||
        typeof clientOrPrisma.$transaction === 'function')
    ) {
      this.client = interClient;
      this.prisma = clientOrPrisma;
    } else {
      this.client = clientOrPrisma || interClient;
      this.prisma = prismaClient || defaultPrisma;
    }
  }

  async syncAccountAndStatement(organizationId: string, options?: { startDate?: string; endDate?: string }): Promise<InterSyncResult> {
    return this.sync(organizationId, options);
  }

  /**
   * Obtém ou cria a conta financeira correspondente ao Banco Inter PJ na organização.
   */
  async getOrCreateAccount(organizationId: string) {
    const existing = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId,
        provider: 'INTER',
      },
    });

    if (existing) return existing;

    return this.prisma.financialAccount.create({
      data: {
        organizationId,
        provider: 'INTER',
        name: 'Conta Corrente Banco Inter PJ',
        currency: 'BRL',
        currentBalance: 0,
        isActive: true,
      },
    });
  }

  /**
   * Executa a sincronização manual de saldo e extrato do Banco Inter PJ.
   * Se as variáveis de ambiente não estiverem configuradas, retorna estado controlado sem quebrar o Hub.
   */
  async sync(organizationId: string, options?: { startDate?: string; endDate?: string }): Promise<InterSyncResult> {
    const account = await this.getOrCreateAccount(organizationId);

    // 1. Verificação de ambiente
    if (!this.client.isConfigured()) {
      const missingVars = typeof (this.client as any).getMissingConfig === 'function'
        ? (this.client as any).getMissingConfig()
        : [];
      const message = missingVars.length > 0
        ? `Credenciais do Banco Inter PJ não configuradas no servidor. Variáveis ausentes: ${missingVars.join(', ')}`
        : 'Credenciais do Banco Inter PJ não configuradas no servidor.';

      return {
        success: false,
        code: 'INTER_NOT_CONFIGURED',
        message,
        account: {
          id: account.id,
          name: account.name,
          balance: Number(account.currentBalance),
          balanceAsOf: account.balanceAsOf ? account.balanceAsOf.toISOString() : null,
        },
        syncedTransactions: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const thirtyDaysAgoStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const startDate = options?.startDate || thirtyDaysAgoStr;
    const endDate = options?.endDate || todayStr;

    try {
      // 2. Consulta extrato bancário PRIMEIRO.
      // Se houver qualquer falha de autenticação OAuth ou rede, NENHUMA mutação em financialAccount ocorre.
      const items = await this.client.getStatement(startDate, endDate);

      // 3. Consulta saldo atual (opcional, se autorizado pelo escopo contratado)
      let disponivel: number | undefined;
      try {
        const balances = await this.client.getBalances();
        if (typeof balances?.disponivel === 'number') {
          disponivel = balances.disponivel;
        }
      } catch (balErr: any) {
        // Escopo padrão mínimo 'extrato.read' não inclui 'saldo.read' sem autorização específica
        console.warn('[InterService] Consulta de saldo ignorada ou não autorizada no escopo atual:', balErr?.message || balErr);
      }

      let syncedTransactions = 0;

      for (const item of items) {
        const rawDate =
          (item as any).dataHoraMovimento ||
          (item as any).dataEntrada ||
          (item as any).dataMovimento ||
          (item as any).dataInclusao ||
          (item as any).dataLancamento ||
          (item as any).data;

        const occurredAt = normalizeInterDate(rawDate);
        const direction = normalizeInterDirection(item);
        const amount = normalizeInterAmount(item.valor);
        const externalId =
          item.idTransacao ||
          `${occurredAt.toISOString().slice(0, 10)}_${direction}_${amount}_${item.titulo || ''}`;
        const description = (item.descricao || item.titulo || 'Transação Banco Inter').trim();
        const counterpartyName = item.contraparte?.nome?.trim() || null;
        const counterpartyDocument = item.contraparte?.cpfCnpj?.replace(/\D/g, '').trim() || null;
        const externalReference = item.chavePix || item.idTransacao || null;

        // Categorização automática
        const catService = new FinancialCategoryService(this.prisma);
        const cat = await catService.categorizeTransaction(organizationId, {
          description,
          counterpartyName,
          counterpartyDocument,
        });

        // Kind inicial (pode ser refinado para TRANSFER_INTERNAL na reconciliação)
        const kind = direction === 'CREDIT' ? 'CUSTOMER_PAYMENT' : 'EXPENSE';

        await this.prisma.financialTransaction.upsert({
          where: {
            accountId_externalId: {
              accountId: account.id,
              externalId,
            },
          },
          create: {
            organizationId,
            accountId: account.id,
            externalId,
            occurredAt,
            direction,
            kind,
            amount,
            description,
            counterpartyName,
            counterpartyDocument,
            externalReference,
            categoryId: cat.categoryId,
            categorizationSource: cat.categorizationSource,
            categorizationConfidence: cat.categorizationConfidence,
            rawPayload: item as any,
          },
          update: {
            amount,
            occurredAt,
            direction,
            description,
            counterpartyName,
            counterpartyDocument,
            externalReference,
            rawPayload: item as any,
          },
        });

        syncedTransactions += 1;
      }

      // 4. Executa conciliação de transferências com o Asaas
      const recService = new FinancialReconciliationService(this.prisma);
      const reconcileRes = await recService.reconcileTransfers(organizationId);

      // 5. Atualiza a conta no banco SOMENTE AGORA após sucesso comprovado da sincronização
      const updateData: any = {
        lastSyncedAt: now,
      };
      if (typeof disponivel === 'number') {
        updateData.currentBalance = disponivel;
        updateData.balanceAsOf = now;
      }

      const updatedAccount = await this.prisma.financialAccount.update({
        where: { id: account.id },
        data: updateData,
      });

      return {
        success: true,
        account: {
          id: updatedAccount.id,
          name: updatedAccount.name,
          balance: Number(updatedAccount.currentBalance),
          balanceAsOf: updatedAccount.balanceAsOf ? updatedAccount.balanceAsOf.toISOString() : null,
        },
        syncedTransactions,
        syncedCount: syncedTransactions,
        autoMatchedTransfers: reconcileRes.autoMatched,
        reviewTransfers: reconcileRes.reviewCount,
        timestamp: now.toISOString(),
      };
    } catch (err: any) {
      console.error('[InterService] Falha na sincronização do Banco Inter:', err?.message || err);
      // NUNCA atualiza lastSyncedAt nem força saldo zero em caso de falha
      return {
        success: false,
        code: err.code || 'INTER_SYNC_FAILED',
        message: err.message || 'Falha ao sincronizar com Banco Inter PJ.',
        account: {
          id: account.id,
          name: account.name,
          balance: Number(account.currentBalance),
          balanceAsOf: account.balanceAsOf ? account.balanceAsOf.toISOString() : null,
        },
        syncedTransactions: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Reprocessa de forma idempotente todas as transações importadas do Banco Inter PJ.
   * - Corrige data (occurredAt) usando o rawPayload armazenado ou data existente.
   * - Corrige a direção (CREDIT / DEBIT) usando os campos estruturados oficiais do Inter.
   * - Garante magnitude positiva absoluta para o valor.
   * - Preserva transferências internas já conciliadas (TRANSFER_INTERNAL).
   * - NUNCA duplica nem apaga registros existentes (mantém ID da transação).
   * - Reexecuta conciliação de transferências com o Asaas.
   */
  async reprocessExistingTransactions(organizationId?: string): Promise<{
    reprocessedCount: number;
    updatedCount: number;
    autoMatchedTransfers?: number;
    reviewTransfers?: number;
  }> {
    const whereClause: any = {
      account: { provider: 'INTER' },
    };
    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    const transactions = await this.prisma.financialTransaction.findMany({
      where: whereClause,
      include: {
        sourceTransfer: true,
        destTransfer: true,
      },
    });

    let updatedCount = 0;

    for (const tx of transactions) {
      const raw = (tx.rawPayload as any) || {};

      // 1. Extração segura da data do rawPayload ou fallback para a data existente da transação
      let rawDateCandidate =
        raw.dataHoraMovimento ||
        raw.dataEntrada ||
        raw.dataMovimento ||
        raw.dataInclusao ||
        raw.dataLancamento ||
        raw.data;

      // Se não houver campo no rawPayload, utiliza a data já persistida se for válida
      if (!rawDateCandidate && tx.occurredAt && !isNaN(new Date(tx.occurredAt).getTime())) {
        rawDateCandidate = tx.occurredAt;
      }

      const normalizedDate = normalizeInterDate(rawDateCandidate);

      // 2. Extração da direção pelos campos estruturados oficiais do Inter
      const itemToEval = Object.keys(raw).length > 0 ? raw : {
        tipoOperacao: (tx as any).direction === 'CREDIT' ? 'C' : 'D',
        titulo: tx.description,
        descricao: tx.description,
      };
      const normalizedDirection = normalizeInterDirection(itemToEval);

      // 3. Magnitude positiva do valor
      const normalizedAmount = normalizeInterAmount(tx.amount || raw.valor);

      // 4. Kind: Preserva TRANSFER_INTERNAL se a transação estiver ligada a conciliação
      let normalizedKind = tx.kind;
      const isInternal =
        tx.kind === 'TRANSFER_INTERNAL' ||
        Boolean(tx.sourceTransfer) ||
        Boolean(tx.destTransfer);

      if (!isInternal) {
        normalizedKind = normalizedDirection === 'CREDIT' ? 'CUSTOMER_PAYMENT' : 'EXPENSE';
      }

      await this.prisma.financialTransaction.update({
        where: { id: tx.id },
        data: {
          occurredAt: normalizedDate,
          direction: normalizedDirection,
          amount: normalizedAmount,
          kind: normalizedKind,
        },
      });

      updatedCount += 1;
    }

    // Reconciliação pós-reprocessamento para cada organização envolvida
    let autoMatched = 0;
    let reviewCount = 0;
    if (organizationId) {
      const recService = new FinancialReconciliationService(this.prisma);
      const recRes = await recService.reconcileTransfers(organizationId);
      autoMatched = recRes.autoMatched;
      reviewCount = recRes.reviewCount;
    }

    return {
      reprocessedCount: transactions.length,
      updatedCount,
      autoMatchedTransfers: autoMatched,
      reviewTransfers: reviewCount,
    };
  }
}

export const interService = new InterService();
