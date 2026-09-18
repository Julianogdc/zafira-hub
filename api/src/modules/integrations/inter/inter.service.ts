import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { InterClient, interClient, InterIntegrationError } from './inter.client.js';
import { FinancialCategoryService } from '../../financial/financial-category.service.js';
import { FinancialReconciliationService } from '../../financial/financial-reconciliation.service.js';
import {
  normalizeInterDate,
  normalizeInterDirection,
  normalizeInterAmount,
  generateInterExternalId,
  extractInterDatePrecision,
  toPrismaDecimal,
  isZeroDecimal,
  isPositiveDecimal,
  areDecimalsEqual,
  toSafeNumber,
} from './inter.normalizer.js';
import { Prisma } from '@prisma/client';

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
        const datePrecision = extractInterDatePrecision(item);
        const direction = normalizeInterDirection(item);
        const amount = normalizeInterAmount(item.valor);

        // Prevenção contra criação de registros fantasmas de R$ 0,00 ou inválidos:
        // Se o valor for nulo, indefinido, inválido ou <= 0, NÃO cria FinancialTransaction.
        if (amount === null || amount <= 0) {
          continue;
        }

        const externalId = generateInterExternalId(item, occurredAt, direction, amount);
        const description = (item.descricao || item.titulo || 'Transação Banco Inter').trim();
        const counterpartyName = item.contraparte?.nome?.trim() || null;
        const counterpartyDocument = item.contraparte?.cpfCnpj?.replace(/\D/g, '').trim() || null;
        const externalReference = item.chavePix || item.idTransacao || null;

        // Verifica se já existe o registro para preservar classificação MANUAL
        const existingTx = this.prisma.financialTransaction?.findUnique
          ? await this.prisma.financialTransaction.findUnique({
              where: {
                accountId_externalId: {
                  accountId: account.id,
                  externalId,
                },
              },
            })
          : null;

        // Categorização automática
        const catService = new FinancialCategoryService(this.prisma);
        const cat = await catService.categorizeTransaction(organizationId, {
          description,
          counterpartyName,
          counterpartyDocument,
          direction,
        });

        // Kind inicial (pode ser refinado para TRANSFER_INTERNAL na reconciliação)
        const kind = direction === 'CREDIT' ? 'CUSTOMER_PAYMENT' : 'EXPENSE';

        const updateData: any = {
          amount,
          occurredAt,
          datePrecision,
          direction,
          description,
          counterpartyName,
          counterpartyDocument,
          externalReference,
          rawPayload: item as any,
        };

        // Preserva categorização e cliente se o usuário já classificou manualmente
        if (existingTx && existingTx.categorizationSource === 'MANUAL') {
          // Não sobrescreve categoryId nem clientId manuais
        } else {
          updateData.categoryId = cat.categoryId;
          updateData.clientId = cat.clientId || null;
          updateData.suggestedClientId = cat.suggestedClientId || null;
          updateData.categorizationSource = cat.categorizationSource;
          updateData.categorizationConfidence = cat.categorizationConfidence;
        }

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
            datePrecision,
            direction,
            kind,
            amount,
            description,
            counterpartyName,
            counterpartyDocument,
            externalReference,
            categoryId: cat.categoryId,
            clientId: cat.clientId || null,
            suggestedClientId: cat.suggestedClientId || null,
            categorizationSource: cat.categorizationSource,
            categorizationConfidence: cat.categorizationConfidence,
            rawPayload: item as any,
          },
          update: updateData,
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

      const datePrecision = extractInterDatePrecision(raw);

      const updateData: any = {
        occurredAt: normalizedDate,
        datePrecision,
        direction: normalizedDirection,
        amount: normalizedAmount,
      };

      if (isInternal) {
        updateData.kind = 'TRANSFER_INTERNAL';
        updateData.clientId = null;
      } else {
        updateData.kind = normalizedDirection === 'CREDIT' ? 'CUSTOMER_PAYMENT' : 'EXPENSE';
      }

      await this.prisma.financialTransaction.update({
        where: { id: tx.id },
        data: updateData,
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

  /**
   * Rotina de reparo local, segura e estritamente idempotente para duplicatas comprovadas do Banco Inter PJ.
   *
   * Critério objetivo de duplicidade:
   * 1. Mesma conta bancária (accountId) e organização (organizationId).
   * 2. Mesma data civil (occurredAt ano-mês-dia).
   * 3. Mesma contraparte ou descrição bancária idêntica.
   * 4. Um registro é canônico (amount > 0) e o outro é duplicado espúrio (amount === 0).
   *
   * Regras de preservação e mesclagem:
   * - O registro canônico (com valor real > 0) é preservado.
   * - Se o registro de R$ 0,00 possuir classificação manual (categorizationSource === 'MANUAL'),
   *   essa classificação (categoryId, clientId, categorizationSource, categorizationConfidence)
   *   é transferida para o registro canônico.
   * - Se houver vínculos de transferências internas (sourceTransfer / destTransfer), são mantidos.
   * - Apenas o registro duplicado confirmado de R$ 0,00 é excluído.
   * - Execução 100% idempotente: executar novamente resulta em 0 alterações.
   */
  /**
   * Rotina endurecida e segura de reparo de integridade do extrato Banco Inter PJ.
   * REGRAS INEGOCIÁVEIS DE SEGURANÇA:
   * 1. Nunca considerar "mesma data + mesma direção" suficiente para remover ou mesclar lançamentos.
   * 2. Uma duplicata de R$ 0,00 só é excluída se houver:
   *    - Prova A: idTransacao/codigoTransacao/nossoNumero oficial idêntico; OU
   *    - Prova B: exatamente UM candidato canônico não-zero na mesma conta, mesma data civil, mesma direção
   *      e mesmo título bancário após normalização estrita (sem acentos, sem maiúsculas/minúsculas, sem espaços extras,
   *      sem correspondência parcial e sem correspondência subjetiva).
   * 3. Se houver dois ou mais candidatos possíveis:
   *    - NÃO excluir
   *    - NÃO mesclar
   *    - Contar como ambiguousDuplicatesSkipped
   * 4. Transfere classificação manual (categorizationSource === 'MANUAL'), categoria e cliente da duplicata
   *    para o registro canônico.
   */
  async repairInterDuplicates(organizationId?: string): Promise<{
    success: boolean;
    scanned: number;
    zeroRecordsCount: number;
    duplicatesRemoved: number;
    manualDataMerged: number;
    ambiguousDuplicatesSkipped: number;
    remainingTransactions: number;
    totalInspected: number;
    mergedCount: number;
    removedCount: number;
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
        category: true,
        client: true,
        sourceTransfer: true,
        destTransfer: true,
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });

    const resolution = this.calculateDuplicateMatches(transactions);

    // Executa operações de mescla manual e exclusão
    const updatesToRun: Array<() => Promise<any>> = [];
    const deletesToRun: Array<() => Promise<any>> = [];

    // 1. Atualizações de dados manuais para os canônicos
    for (const [canonicalId, updateData] of resolution.canonicalUpdates.entries()) {
      updatesToRun.push(() =>
        this.prisma.financialTransaction.update({
          where: { id: canonicalId },
          data: updateData,
        })
      );
    }

    // 2. Transferências internas associadas
    for (const transferOp of resolution.transferUpdates) {
      updatesToRun.push(() =>
        this.prisma.financialTransfer.update({
          where: { id: transferOp.id },
          data: transferOp.data,
        })
      );
    }

    // 3. Exclusão das duplicatas comprovadas
    for (const dupId of resolution.duplicateIdsToRemove) {
      deletesToRun.push(() =>
        this.prisma.financialTransaction.delete({
          where: { id: dupId },
        })
      );
    }

    // Execução em transação Prisma (somente se houver operações a executar - idempotência)
    if (resolution.duplicateIdsToRemove.length > 0 || resolution.canonicalUpdates.size > 0 || resolution.transferUpdates.length > 0) {
      if (typeof (this.prisma as any).$transaction === 'function') {
        await (this.prisma as any).$transaction(async (txPrisma: any) => {
          for (const [canonicalId, updateData] of resolution.canonicalUpdates.entries()) {
            await txPrisma.financialTransaction.update({
              where: { id: canonicalId },
              data: updateData,
            });
          }
          for (const transferOp of resolution.transferUpdates) {
            await txPrisma.financialTransfer.update({
              where: { id: transferOp.id },
              data: transferOp.data,
            });
          }
          if (resolution.duplicateIdsToRemove.length > 0) {
            if (typeof txPrisma.financialTransaction?.deleteMany === 'function') {
              await txPrisma.financialTransaction.deleteMany({
                where: { id: { in: resolution.duplicateIdsToRemove } },
              });
            } else if (typeof txPrisma.financialTransaction?.delete === 'function') {
              for (const dupId of resolution.duplicateIdsToRemove) {
                await txPrisma.financialTransaction.delete({
                  where: { id: dupId },
                });
              }
            }
          }
        });
      } else {
        for (const op of updatesToRun) await op();
        for (const op of deletesToRun) await op();
      }
    }

    let remainingTransactions = Math.max(0, resolution.totalScanned - resolution.duplicateIdsToRemove.length);
    if (typeof (this.prisma.financialTransaction as any).count === 'function') {
      try {
        remainingTransactions = await this.prisma.financialTransaction.count({
          where: whereClause,
        });
      } catch {
        remainingTransactions = Math.max(0, resolution.totalScanned - resolution.duplicateIdsToRemove.length);
      }
    }

    return {
      success: true,
      scanned: resolution.totalScanned,
      zeroRecordsCount: resolution.zeroTxsCount,
      duplicatesRemoved: resolution.duplicateIdsToRemove.length,
      manualDataMerged: resolution.manualDataMergedCount,
      ambiguousDuplicatesSkipped: resolution.ambiguousDuplicatesSkipped,
      remainingTransactions,
      totalInspected: resolution.totalScanned,
      mergedCount: resolution.manualDataMergedCount,
      removedCount: resolution.duplicateIdsToRemove.length,
    };
  }

  /**
   * Prévia somente leitura do reparo de integridade do Banco Inter PJ.
   * Não executa update nem delete no banco de dados.
   * Retorna contadores agregados seguros para exibição no modal de confirmação do usuário.
   */
  async previewRepairInterDuplicates(organizationId?: string): Promise<{
    success: boolean;
    repairAlgorithmVersion: string;
    scanned: number;
    zeroRecordsCount: number;
    provenDuplicatesToRemove: number;
    manualClassificationsToPreserve: number;
    ambiguousRecordsKept: number;
    canonicalCandidates: number;
    remainingEstimated: number;
    duplicatesToRemove: number;
    manualDataToMerge: number;
    ambiguousDuplicatesToSkip: number;
    expectedRemaining: number;
    unmatchedZeroCount: number;
    patterns: Record<string, number>;
    
    // Novas métricas
    analyzedRecords: number;
    positiveRecordsCount: number;
    candidatePairsEvaluated: number;
    matchesByOfficialId: number;
    matchesByLegacyAmount: number;
    matchesByStrictFallback: number;
    rejectedByAccount: number;
    rejectedByDate: number;
    rejectedByDirection: number;
    rejectedByTitle: number;
    rejectedByAmount: number;
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
        category: true,
        client: true,
        sourceTransfer: true,
        destTransfer: true,
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });

    const resolution = this.calculateDuplicateMatches(transactions);

    return {
      success: true,
      repairAlgorithmVersion: 'v3-decimal-diagnostics',
      scanned: resolution.totalScanned,
      zeroRecordsCount: resolution.zeroTxsCount,
      provenDuplicatesToRemove: resolution.duplicateIdsToRemove.length,
      manualClassificationsToPreserve: resolution.manualDataMergedCount,
      ambiguousRecordsKept: resolution.ambiguousDuplicatesSkipped,
      canonicalCandidates: resolution.canonicalCount,
      remainingEstimated: Math.max(0, resolution.totalScanned - resolution.duplicateIdsToRemove.length),
      duplicatesToRemove: resolution.duplicateIdsToRemove.length,
      manualDataToMerge: resolution.manualDataMergedCount,
      ambiguousDuplicatesToSkip: resolution.ambiguousDuplicatesSkipped,
      expectedRemaining: Math.max(0, resolution.totalScanned - resolution.duplicateIdsToRemove.length),
      unmatchedZeroCount: resolution.unmatchedZeroCount,
      patterns: resolution.patterns,
      
      // Diagnósticos agregados detalhados
      analyzedRecords: resolution.analyzedRecords,
      positiveRecordsCount: resolution.positiveRecordsCount,
      candidatePairsEvaluated: resolution.candidatePairsEvaluated,
      matchesByOfficialId: resolution.matchesByOfficialId,
      matchesByLegacyAmount: resolution.matchesByLegacyAmount,
      matchesByStrictFallback: resolution.matchesByStrictFallback,
      rejectedByAccount: resolution.rejectedByAccount,
      rejectedByDate: resolution.rejectedByDate,
      rejectedByDirection: resolution.rejectedByDirection,
      rejectedByTitle: resolution.rejectedByTitle,
      rejectedByAmount: resolution.rejectedByAmount,
    };
  }

  /**
   * Helper unificado de cálculo e matching de duplicatas (Provas A, B e C).
   * Compartilhado entre a prévia somente leitura e o reparo definitivo.
   */
  private calculateDuplicateMatches(transactions: any[]): {
    totalScanned: number;
    zeroTxsCount: number;
    canonicalCount: number;
    duplicateIdsToRemove: string[];
    canonicalUpdates: Map<string, any>;
    transferUpdates: Array<{ id: string; data: any }>;
    manualDataMergedCount: number;
    ambiguousDuplicatesSkipped: number;
    unmatchedZeroCount: number;
    patterns: Record<string, number>;
    
    // Novas métricas de diagnóstico
    analyzedRecords: number;
    positiveRecordsCount: number;
    candidatePairsEvaluated: number;
    matchesByOfficialId: number;
    matchesByLegacyAmount: number;
    matchesByStrictFallback: number;
    rejectedByAccount: number;
    rejectedByDate: number;
    rejectedByDirection: number;
    rejectedByTitle: number;
    rejectedByAmount: number;
    provenDuplicatesToRemove: number;
  } {
    const totalScanned = transactions.length;
    // Seleção robusta de linhas de R$ 0,00 e candidatos canônicos com suporte nativo a Prisma.Decimal
    const zeroTxs = transactions.filter((t) => isZeroDecimal(t.amount));
    // CORREÇÃO CRÍTICA: lançamentos reais podem ser negativos (ex: -450.00 para DEBIT no BD)
    const validTxs = transactions.filter((t) => !isZeroDecimal(t.amount));

    const normalizeStrict = (str?: string | null): string => {
      if (!str || typeof str !== 'string') return '';
      return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
    };

    const getOfficialId = (rawPayload: any, extRef?: string | null): string => {
      if (rawPayload && typeof rawPayload === 'object') {
        const id = String(rawPayload.idTransacao || rawPayload.codigoTransacao || rawPayload.nossoNumero || '').trim();
        if (id) return id;
      }
      if (extRef && typeof extRef === 'string') {
        const cleanRef = extRef.trim();
        if (cleanRef && !cleanRef.startsWith('inter_')) return cleanRef;
      }
      return '';
    };

    const getCivilDate = (tx: any): string => {
      const raw = (tx.rawPayload as any) || {};
      const rawDate =
        raw.dataHoraMovimento ||
        raw.dataEntrada ||
        raw.dataMovimento ||
        raw.dataInclusao ||
        raw.dataLancamento ||
        raw.data;

      if (typeof rawDate === 'string') {
        const isoMatch = rawDate.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        if (isoMatch) return isoMatch[1];
        const brMatch = rawDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
      }

      const occ = tx.occurredAt;
      if (occ) {
        if (typeof occ === 'string') {
          const m = occ.match(/^(\d{4}-\d{2}-\d{2})/);
          if (m) return m[1];
        } else if (occ instanceof Date && !isNaN(occ.getTime())) {
          return occ.toISOString().slice(0, 10);
        }
      }

      if (typeof tx.externalId === 'string') {
        const m = tx.externalId.match(/(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
      }

      return '';
    };

    const getTitlesStrict = (tx: any): string[] => {
      const set = new Set<string>();
      const raw = (tx.rawPayload as any) || {};
      if (raw.titulo) set.add(normalizeStrict(raw.titulo));
      if (raw.descricao) set.add(normalizeStrict(raw.descricao));
      if (tx.description) set.add(normalizeStrict(tx.description));
      return Array.from(set).filter(Boolean);
    };

    const hasMatchingTitle = (txA: any, txB: any): boolean => {
      const titlesA = getTitlesStrict(txA);
      const titlesB = getTitlesStrict(txB);
      for (const tA of titlesA) {
        if (titlesB.includes(tA)) return true;
      }
      return false;
    };

    const extractLegacyAmount = (extId: string): Prisma.Decimal | null => {
      if (!extId || typeof extId !== 'string') return null;
      const matchDir = extId.match(/(?:CREDIT|DEBIT)_([0-9.]+)(?:_|$)/);
      if (matchDir && matchDir[1]) {
        const dec = toPrismaDecimal(matchDir[1]);
        if (dec && dec.gt(0)) return dec;
      }
      const matchFallback = extId.match(/^inter_.*_([0-9.]+)(?:_|$)/);
      if (matchFallback && matchFallback[1]) {
        const dec = toPrismaDecimal(matchFallback[1]);
        if (dec && dec.gt(0)) return dec;
      }
      return null;
    };

    const patterns: Record<string, number> = {};
    for (const z of zeroTxs) {
      const ext = z.externalId || '';
      let pat = 'OUTRO';
      if (ext.startsWith('inter_') && ext.includes('_0_')) {
        pat = 'INTER_COMPOSTO_VALOR_ZERO';
      } else if (ext.startsWith('inter_') && !ext.includes('_0_')) {
        pat = 'INTER_COMPOSTO_VALOR_LEGADO';
      } else if (!ext.startsWith('inter_') && ext.trim() !== '') {
        pat = 'ID_OFICIAL_DIRETO';
      }
      patterns[pat] = (patterns[pat] || 0) + 1;
    }

    let candidatePairsEvaluated = 0;
    let matchesByOfficialId = 0;
    let matchesByLegacyAmount = 0;
    let matchesByStrictFallback = 0;
    let rejectedByAccount = 0;
    let rejectedByDate = 0;
    let rejectedByDirection = 0;
    let rejectedByTitle = 0;
    let rejectedByAmount = 0;
    let ambiguousDuplicatesSkipped = 0;
    const confirmedMatches: Array<{ duplicate: any; canonical: any }> = [];

    for (const duplicate of zeroTxs) {
      const dupRaw = (duplicate.rawPayload as any) || {};
      const dupId = getOfficialId(dupRaw, duplicate.externalReference);
      const dupDateStr = getCivilDate(duplicate);
      const dupLegacyAmount = extractLegacyAmount(duplicate.externalId);

      let matchingCandidates: typeof validTxs = [];
      let matchType = '';

      // PROVA A: idTransacao / codigoTransacao / nossoNumero oficial idêntico
      if (dupId) {
        matchingCandidates = validTxs.filter((c) => {
          candidatePairsEvaluated++;
          if (c.accountId !== duplicate.accountId) { rejectedByAccount++; return false; }
          const cId = getOfficialId(c.rawPayload, c.externalReference);
          return cId.length > 0 && cId === dupId;
        });
        if (matchingCandidates.length === 1) matchType = 'OFFICIAL_ID';
      }

      // PROVA B: externalId legado contém o valor original e coincide com o lançamento canônico
      if (matchingCandidates.length === 0 && dupLegacyAmount !== null && dupLegacyAmount.gt(0)) {
        matchingCandidates = validTxs.filter((c) => {
          candidatePairsEvaluated++;
          if (c.accountId !== duplicate.accountId) { rejectedByAccount++; return false; }
          const cDateStr = getCivilDate(c);
          if (cDateStr !== dupDateStr) { rejectedByDate++; return false; }
          if (c.direction !== duplicate.direction) { rejectedByDirection++; return false; }
          if (!hasMatchingTitle(duplicate, c)) { rejectedByTitle++; return false; }
          
          // CORREÇÃO CRÍTICA: c.amount pode ser negativo (ex: -450.00 para DEBIT). Usa abs()
          const cAbs = toPrismaDecimal(c.amount)?.abs();
          if (cAbs && areDecimalsEqual(cAbs, dupLegacyAmount)) {
             return true;
          }
          rejectedByAmount++;
          return false;
        });
        if (matchingCandidates.length === 1) matchType = 'LEGACY_AMOUNT';
      }

      // PROVA C: artefato com externalId contendo valor zero ou padrão conhecido
      if (matchingCandidates.length === 0) {
        matchingCandidates = validTxs.filter((c) => {
          candidatePairsEvaluated++;
          if (c.accountId !== duplicate.accountId) { rejectedByAccount++; return false; }
          const cDateStr = getCivilDate(c);
          if (cDateStr !== dupDateStr) { rejectedByDate++; return false; }
          if (c.direction !== duplicate.direction) { rejectedByDirection++; return false; }
          if (!hasMatchingTitle(duplicate, c)) { rejectedByTitle++; return false; }
          return true;
        });
        if (matchingCandidates.length === 1) matchType = 'STRICT_FALLBACK';
      }

      // Decisão baseada em evidências estritas
      if (matchingCandidates.length === 1) {
        confirmedMatches.push({
          duplicate,
          canonical: matchingCandidates[0],
        });
        if (matchType === 'OFFICIAL_ID') matchesByOfficialId++;
        if (matchType === 'LEGACY_AMOUNT') matchesByLegacyAmount++;
        if (matchType === 'STRICT_FALLBACK') matchesByStrictFallback++;
      } else if (matchingCandidates.length > 1) {
        // Ambiguidade: 2 ou mais candidatos legítimos. NÃO exclui por segurança.
        ambiguousDuplicatesSkipped += 1;
      }
    }

    // Agrupamento por lançamento canônico para transferência segura de classificações manuais
    const canonicalGroups = new Map<string, { canonical: any; duplicates: any[] }>();
    for (const match of confirmedMatches) {
      const existing = canonicalGroups.get(match.canonical.id) || {
        canonical: match.canonical,
        duplicates: [],
      };
      existing.duplicates.push(match.duplicate);
      canonicalGroups.set(match.canonical.id, existing);
    }

    const canonicalUpdates = new Map<string, any>();
    const transferUpdates: Array<{ id: string; data: any }> = [];
    let manualDataMergedCount = 0;

    for (const [canonicalId, group] of canonicalGroups.entries()) {
      const canonical = group.canonical;
      const manualDup = group.duplicates.find(
        (d) =>
          d.categorizationSource === 'MANUAL' ||
          (d.categoryId && !canonical.categoryId) ||
          (d.clientId && !canonical.clientId)
      );

      if (manualDup) {
        canonicalUpdates.set(canonicalId, {
          categoryId: manualDup.categoryId || canonical.categoryId,
          clientId: manualDup.clientId || canonical.clientId,
          suggestedClientId: manualDup.suggestedClientId || canonical.suggestedClientId,
          categorizationSource: manualDup.categorizationSource === 'MANUAL' ? 'MANUAL' : canonical.categorizationSource,
          categorizationConfidence: manualDup.categorizationSource === 'MANUAL' ? 1.0 : canonical.categorizationConfidence,
        });
        manualDataMergedCount += 1;
      }

      for (const dup of group.duplicates) {
        if (dup.sourceTransfer && !canonical.sourceTransfer) {
          transferUpdates.push({
            id: dup.sourceTransfer.id,
            data: { sourceTransactionId: canonical.id },
          });
        }
        if (dup.destTransfer && !canonical.destTransfer) {
          transferUpdates.push({
            id: dup.destTransfer.id,
            data: { destinationTransactionId: canonical.id },
          });
        }
      }
    }

    const duplicateIdsToRemove = confirmedMatches.map((m) => m.duplicate.id);
    const unmatchedZeroCount = Math.max(0, zeroTxs.length - duplicateIdsToRemove.length - ambiguousDuplicatesSkipped);

    return {
      totalScanned,
      zeroTxsCount: zeroTxs.length,
      canonicalCount: validTxs.length,
      duplicateIdsToRemove,
      canonicalUpdates,
      transferUpdates,
      manualDataMergedCount,
      ambiguousDuplicatesSkipped,
      unmatchedZeroCount,
      patterns,
      
      // Novas métricas
      analyzedRecords: totalScanned,
      positiveRecordsCount: validTxs.length,
      candidatePairsEvaluated,
      matchesByOfficialId,
      matchesByLegacyAmount,
      matchesByStrictFallback,
      rejectedByAccount,
      rejectedByDate,
      rejectedByDirection,
      rejectedByTitle,
      rejectedByAmount,
      provenDuplicatesToRemove: duplicateIdsToRemove.length,
    };
  }

  /**
   * Diagnóstico seguro e estrito sobre os rawPayloads das transações do Banco Inter PJ.
   * REGRA INEGOCIÁVEL DE SEGURANÇA:
   * NÃO registrar, retornar ou expor:
   * - payload bruto
   * - descrições
   * - documentos (CPF/CNPJ)
   * - contas bancárias
   * - chaves ou dados Pix
   * - IDs de transação
   * - valores monetários
   * - tokens ou credenciais
   *
   * Analisa apenas nomes de campos e contagem de presença / precisão detectada.
   */
  async getInterDateFieldDiagnostics(organizationId?: string): Promise<{
    totalTransactions: number;
    dateFieldPresence: Record<string, number>;
    detectedPrecision: {
      DATETIME: number;
      DATE_ONLY: number;
    };
  }> {
    const whereClause: any = {
      account: { provider: 'INTER' },
    };
    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    const transactions = await this.prisma.financialTransaction.findMany({
      where: whereClause,
      select: {
        id: true,
        datePrecision: true,
        rawPayload: true,
      },
    });

    const dateFieldPresence: Record<string, number> = {
      dataHoraMovimento: 0,
      dataHoraLancamento: 0,
      dataHora: 0,
      dataHoraTransacao: 0,
      dataMovimento: 0,
      dataEntrada: 0,
      dataInclusao: 0,
      horario: 0,
      horaMovimento: 0,
      hora: 0,
      horaLancamento: 0,
      timestamp: 0,
    };

    let datetimeCount = 0;
    let dateOnlyCount = 0;

    for (const tx of transactions) {
      const raw = (tx.rawPayload as any) || {};

      // Inspeciona presença dos campos conhecidos
      for (const field of Object.keys(dateFieldPresence)) {
        if (raw[field] !== undefined && raw[field] !== null && String(raw[field]).trim() !== '') {
          dateFieldPresence[field] += 1;
        }
      }

      // Inspeciona também campos aninhados plausíveis (transacao, pix, detalhes) sem expor valores
      const nestedObjs = [raw.transacao, raw.pix, raw.detalhes].filter((o) => o && typeof o === 'object');
      for (const obj of nestedObjs) {
        for (const [k, v] of Object.entries(obj)) {
          const lowerK = k.toLowerCase();
          if (lowerK.includes('data') || lowerK.includes('hora') || lowerK.includes('time') || lowerK.includes('date')) {
            const nestedKey = `nested.${k}`;
            if (v !== undefined && v !== null && String(v).trim() !== '') {
              dateFieldPresence[nestedKey] = (dateFieldPresence[nestedKey] || 0) + 1;
            }
          }
        }
      }

      // Avalia precisão usando o normalizador estrito
      const precision = extractInterDatePrecision(raw);
      if (precision === 'DATETIME') {
        datetimeCount += 1;
      } else {
        dateOnlyCount += 1;
      }
    }

    return {
      totalTransactions: transactions.length,
      dateFieldPresence,
      detectedPrecision: {
        DATETIME: datetimeCount,
        DATE_ONLY: dateOnlyCount,
      },
    };
  }

  /**
   * Prévia somente leitura dos horários do extrato completo do Banco Inter PJ.
   * Não grava nada no banco de dados.
   * Retorna contadores agregados seguros sem expor dados pessoais, valores ou credenciais.
   */
  async previewEnrichedTimes(
    organizationId: string,
    range?: { startDate?: string; endDate?: string }
  ): Promise<{
    totalReceived: number;
    withOfficialTransactionId: number;
    withRealTimestamp: number;
    withoutTimestamp: number;
    scopeAvailable: boolean;
  }> {
    let dataInicio: string;
    let dataFim: string;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (range?.startDate && range?.endDate) {
      dataInicio = range.startDate;
      dataFim = range.endDate;
    } else {
      const txLimits = await this.prisma.financialTransaction.aggregate({
        where: { organizationId, account: { provider: 'INTER' } },
        _min: { occurredAt: true },
        _max: { occurredAt: true },
      });

      if (txLimits._min.occurredAt && txLimits._max.occurredAt) {
        dataInicio = txLimits._min.occurredAt.toISOString().slice(0, 10);
        dataFim = txLimits._max.occurredAt.toISOString().slice(0, 10);
        const startMs = new Date(dataInicio).getTime();
        const endMs = new Date(dataFim).getTime();
        if ((endMs - startMs) / (1000 * 60 * 60 * 24) > 90) {
          const d90 = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
          dataInicio = d90.toISOString().slice(0, 10);
          dataFim = todayStr;
        }
      } else {
        const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dataInicio = d30.toISOString().slice(0, 10);
        dataFim = todayStr;
      }
    }

    const completeItems = await this.client.getCompleteStatement(dataInicio, dataFim);

    let withOfficialTransactionId = 0;
    let withRealTimestamp = 0;
    let withoutTimestamp = 0;

    for (const item of completeItems) {
      const officialId = String(item.idTransacao || item.codigoTransacao || item.nossoNumero || '').trim();
      if (officialId) {
        withOfficialTransactionId += 1;
      }

      const rawDateTimeStr = String(item.dataHoraMovimento || item.dataHora || item.dataHoraLancamento || '').trim();
      let hasRealTime = false;

      if (rawDateTimeStr) {
        const match = rawDateTimeStr.match(/[ T](\d{2}:\d{2}(?::\d{2})?)/);
        if (match) {
          const timeStr = match[1];
          if (timeStr !== '12:00' && timeStr !== '12:00:00' && timeStr !== '00:00' && timeStr !== '00:00:00') {
            hasRealTime = true;
          }
        }
      }

      if (hasRealTime) {
        withRealTimestamp += 1;
      } else {
        withoutTimestamp += 1;
      }
    }

    return {
      totalReceived: completeItems.length,
      withOfficialTransactionId,
      withRealTimestamp,
      withoutTimestamp,
      scopeAvailable: true,
    };
  }

  /**
   * Aplicação controlada dos horários oficiais analíticos do Banco Inter PJ.
   * Regras estritas:
   * - Atualiza SOMENTE registros que possuem ligação inequívoca por identificador bancário oficial.
   * - Grava datePrecision = DATETIME e atualiza occurredAt com a data/hora oficial.
   * - Preserva valores, categorias, clientes, conciliações e histórico.
   * - NENHUM registro é criado ou removido.
   * - Retorna contadores de atualizados, ignorados e ambíguos.
   */
  async applyEnrichedTimes(
    organizationId: string,
    range?: { startDate?: string; endDate?: string }
  ): Promise<{
    success: boolean;
    updatedCount: number;
    skippedCount: number;
    ambiguousCount: number;
    message: string;
  }> {
    let dataInicio: string;
    let dataFim: string;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (range?.startDate && range?.endDate) {
      dataInicio = range.startDate;
      dataFim = range.endDate;
    } else {
      const txLimits = await this.prisma.financialTransaction.aggregate({
        where: { organizationId, account: { provider: 'INTER' } },
        _min: { occurredAt: true },
        _max: { occurredAt: true },
      });

      if (txLimits._min.occurredAt && txLimits._max.occurredAt) {
        dataInicio = txLimits._min.occurredAt.toISOString().slice(0, 10);
        dataFim = txLimits._max.occurredAt.toISOString().slice(0, 10);
        const startMs = new Date(dataInicio).getTime();
        const endMs = new Date(dataFim).getTime();
        if ((endMs - startMs) / (1000 * 60 * 60 * 24) > 90) {
          const d90 = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
          dataInicio = d90.toISOString().slice(0, 10);
          dataFim = todayStr;
        }
      } else {
        const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dataInicio = d30.toISOString().slice(0, 10);
        dataFim = todayStr;
      }
    }

    const completeItems = await this.client.getCompleteStatement(dataInicio, dataFim);

    // Carrega todas as transações Inter existentes da organização
    const existingTransactions = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        account: { provider: 'INTER' },
      },
    });

    const getOfficialId = (rawPayload: any, extRef?: string | null): string => {
      if (rawPayload && typeof rawPayload === 'object') {
        const id = String(rawPayload.idTransacao || rawPayload.codigoTransacao || rawPayload.nossoNumero || '').trim();
        if (id) return id;
      }
      if (extRef && typeof extRef === 'string') {
        const cleanRef = extRef.trim();
        if (cleanRef && !cleanRef.startsWith('inter_')) return cleanRef;
      }
      return '';
    };

    // Mapeia transações locais por identificador oficial
    const existingByOfficialId = new Map<string, typeof existingTransactions>();
    for (const tx of existingTransactions) {
      const offId = getOfficialId(tx.rawPayload, tx.externalReference);
      if (offId) {
        const list = existingByOfficialId.get(offId) || [];
        list.push(tx);
        existingByOfficialId.set(offId, list);
      }
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let ambiguousCount = 0;

    for (const item of completeItems) {
      const itemOfficialId = String(item.idTransacao || item.codigoTransacao || item.nossoNumero || '').trim();
      const rawDateTimeStr = String(item.dataHoraMovimento || item.dataHora || item.dataHoraLancamento || '').trim();

      // Se não possui identificador oficial ou não possui string de data/hora
      if (!itemOfficialId || !rawDateTimeStr) {
        skippedCount += 1;
        continue;
      }

      // Valida se o horário é real e não técnico (00:00 ou 12:00)
      const match = rawDateTimeStr.match(/[ T](\d{2}:\d{2}(?::\d{2})?)/);
      if (!match) {
        skippedCount += 1;
        continue;
      }
      const timeStr = match[1];
      if (timeStr === '12:00' || timeStr === '12:00:00' || timeStr === '00:00' || timeStr === '00:00:00') {
        skippedCount += 1;
        continue;
      }

      const candidates = existingByOfficialId.get(itemOfficialId) || [];

      if (candidates.length === 0) {
        // Nenhuma transação existente encontrada com este ID oficial
        skippedCount += 1;
      } else if (candidates.length > 1) {
        // Ambiguidade detectada (múltiplas transações com mesmo ID oficial): NÃO atualiza
        ambiguousCount += 1;
      } else {
        // Exatamente 1 correspondência inequívoca
        const target = candidates[0];

        try {
          const parsedRealDate = normalizeInterDate(rawDateTimeStr);
          const currentRaw = (target.rawPayload as any) || {};
          const updatedRaw = {
            ...currentRaw,
            dataHoraMovimento: rawDateTimeStr,
            interTransactionId: itemOfficialId,
          };

          await this.prisma.financialTransaction.update({
            where: { id: target.id },
            data: {
              occurredAt: parsedRealDate,
              datePrecision: 'DATETIME',
              rawPayload: updatedRaw,
            },
          });

          updatedCount += 1;
        } catch {
          skippedCount += 1;
        }
      }
    }

    return {
      success: true,
      updatedCount,
      skippedCount,
      ambiguousCount,
      message: `${updatedCount} movimentações tiveram seus horários oficiais aplicados com sucesso.`,
    };
  }
}

export const interService = new InterService();
