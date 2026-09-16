import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { InterClient, interClient, InterIntegrationError } from './inter.client.js';
import { FinancialCategoryService } from '../../financial/financial-category.service.js';
import { FinancialReconciliationService } from '../../financial/financial-reconciliation.service.js';

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
      return {
        success: false,
        code: 'INTER_NOT_CONFIGURED',
        message: 'Credenciais do Banco Inter PJ não configuradas no servidor.',
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

    try {
      // 2. Consulta saldo atual (se autorizado pelo escopo contratado)
      const now = new Date();
      let disponivel = Number(account.currentBalance);
      try {
        const balances = await this.client.getBalances();
        if (typeof balances.disponivel === 'number') {
          disponivel = balances.disponivel;
        }
      } catch (balErr: any) {
        // Escopo padrão mínimo 'extrato.read' não inclui 'saldo.read' sem autorização específica no Internet Banking
        console.warn('[InterService] Consulta de saldo ignorada ou não autorizada no escopo atual:', balErr?.message || balErr);
      }

      await this.prisma.financialAccount.update({
        where: { id: account.id },
        data: {
          currentBalance: disponivel,
          balanceAsOf: now,
          lastSyncedAt: now,
        },
      });

      // 3. Consulta extrato bancário
      const todayStr = now.toISOString().slice(0, 10);
      const thirtyDaysAgoStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const startDate = options?.startDate || thirtyDaysAgoStr;
      const endDate = options?.endDate || todayStr;

      const items = await this.client.getStatement(startDate, endDate);
      let syncedTransactions = 0;

      for (const item of items) {
        const occurredAt = new Date(item.dataEntrada);
        const direction = item.tipoOperacao === 'C' ? 'CREDIT' : 'DEBIT';
        const amount = Math.abs(Number(item.valor));
        const externalId = item.idTransacao || `${item.dataEntrada}_${item.tipoOperacao}_${item.valor}_${item.titulo}`;
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

      return {
        success: true,
        account: {
          id: account.id,
          name: account.name,
          balance: disponivel,
          balanceAsOf: now.toISOString(),
        },
        syncedTransactions,
        syncedCount: syncedTransactions,
        autoMatchedTransfers: reconcileRes.autoMatched,
        reviewTransfers: reconcileRes.reviewCount,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      if (err instanceof InterIntegrationError && err.code === 'INTER_NOT_CONFIGURED') {
        return {
          success: false,
          code: 'INTER_NOT_CONFIGURED',
          message: err.message,
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
      throw err;
    }
  }
}

export const interService = new InterService();
