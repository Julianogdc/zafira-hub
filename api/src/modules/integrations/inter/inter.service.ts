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
        const datePrecision = extractInterDatePrecision(item);
        const direction = normalizeInterDirection(item);
        const amount = normalizeInterAmount(item.valor);
        const externalId = generateInterExternalId(item, occurredAt, direction, amount);
        const description = (item.descricao || item.titulo || 'Transação Banco Inter').trim();
        const counterpartyName = item.contraparte?.nome?.trim() || null;
        const counterpartyDocument = item.contraparte?.cpfCnpj?.replace(/\D/g, '').trim() || null;
        const externalReference = item.chavePix || item.idTransacao || null;

        // Prevenção contra criação de registros fantasmas de R$ 0,00:
        // Se amount === 0, verifica se já existe registro com valor real na mesma data e contraparte
        if (amount === 0 && this.prisma.financialTransaction?.findFirst) {
          const dateOnlyStr = occurredAt.toISOString().slice(0, 10);
          const existingWithAmount = await this.prisma.financialTransaction.findFirst({
            where: {
              accountId: account.id,
              occurredAt: {
                gte: new Date(`${dateOnlyStr}T00:00:00.000Z`),
                lte: new Date(`${dateOnlyStr}T23:59:59.999Z`),
              },
              amount: { gt: 0 },
              OR: [
                { counterpartyName: counterpartyName || undefined },
                { description: description },
              ],
            },
          });
          if (existingWithAmount) {
            // Já existe o registro canônico com valor real: não cria duplicata de R$ 0,00
            continue;
          }
        }

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
   * Rotina idempotente de reparo de integridade do extrato Banco Inter PJ.
   * Identifica e remove as duplicatas espúrias com valor R$ 0,00 geradas na primeira importação.
   * - Garante pareamento robusto mesmo se counterpartyName divergir (ex: nulo no registro de 0 e preenchido no canônico).
   * - Se o registro de R$ 0,00 possuir classificação manual (categorizationSource === 'MANUAL'),
   *   essa classificação (categoryId, clientId, categorizationSource, categorizationConfidence)
   *   é transferida para o registro canônico.
   * - Se houver vínculos de transferências internas (sourceTransfer / destTransfer), são transferidos para o canônico.
   * - Apenas o registro duplicado confirmado de R$ 0,00 é excluído.
   * - Execução 100% idempotente: executar novamente resulta em 0 alterações.
   */
  async repairInterDuplicates(organizationId?: string): Promise<{
    scanned: number;
    duplicatesRemoved: number;
    manualDataMerged: number;
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

    const totalScanned = transactions.length;

    // Separa transações válidas (amount > 0) e potenciais duplicatas de R$ 0,00
    const zeroTxs = transactions.filter((t) => Number(t.amount) === 0);
    const validTxs = transactions.filter((t) => Number(t.amount) > 0);

    let duplicatesRemoved = 0;
    let manualDataMerged = 0;
    const matchedCanonicalIds = new Set<string>();

    for (const duplicate of zeroTxs) {
      const dupDateStr = duplicate.occurredAt.toISOString().slice(0, 10);
      const dupRaw = (duplicate.rawPayload as any) || {};
      const dupId = String(dupRaw.idTransacao || dupRaw.codigoTransacao || dupRaw.nossoNumero || '').trim();
      const dupDescClean = (duplicate.description || dupRaw.titulo || dupRaw.descricao || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

      // Procura o registro canônico correspondente dentre os válidos que ainda não foram associados
      let canonical = validTxs.find((c) => {
        if (matchedCanonicalIds.has(c.id)) return false;
        if (c.accountId !== duplicate.accountId) return false;

        const cRaw = (c.rawPayload as any) || {};
        const cId = String(cRaw.idTransacao || cRaw.codigoTransacao || cRaw.nossoNumero || '').trim();

        // 1. Identificador oficial idTransacao idêntico
        if (dupId && cId && dupId === cId) return true;

        const cDateStr = c.occurredAt.toISOString().slice(0, 10);
        if (dupDateStr !== cDateStr) return false;

        // 2. Mesma direção e descrição/título compatível
        if (c.direction === duplicate.direction) {
          const cDescClean = (c.description || cRaw.titulo || cRaw.descricao || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');

          if (
            dupDescClean === cDescClean ||
            (dupDescClean.length > 3 && cDescClean.includes(dupDescClean)) ||
            (cDescClean.length > 3 && dupDescClean.includes(cDescClean))
          ) {
            return true;
          }
        }

        return false;
      });

      // Fallback: se houver apenas uma transação válida na mesma data e mesma direção ainda não pareada
      if (!canonical) {
        canonical = validTxs.find((c) => {
          if (matchedCanonicalIds.has(c.id)) return false;
          if (c.accountId !== duplicate.accountId) return false;
          const cDateStr = c.occurredAt.toISOString().slice(0, 10);
          return cDateStr === dupDateStr && c.direction === duplicate.direction;
        });
      }

      if (canonical) {
        matchedCanonicalIds.add(canonical.id);

        // Se o duplicado foi classificado manualmente:
        // transfere a classificação manual para o canônico com prioridade máxima
        const shouldTransferClassification =
          duplicate.categorizationSource === 'MANUAL' ||
          (duplicate.categoryId && !canonical.categoryId) ||
          (duplicate.clientId && !canonical.clientId);

        if (shouldTransferClassification) {
          await this.prisma.financialTransaction.update({
            where: { id: canonical.id },
            data: {
              categoryId: duplicate.categoryId || canonical.categoryId,
              clientId: duplicate.clientId || canonical.clientId,
              suggestedClientId: duplicate.suggestedClientId || canonical.suggestedClientId,
              categorizationSource: duplicate.categorizationSource === 'MANUAL' ? 'MANUAL' : canonical.categorizationSource,
              categorizationConfidence: duplicate.categorizationSource === 'MANUAL' ? 1.0 : canonical.categorizationConfidence,
            },
          });
          manualDataMerged += 1;
        }

        // Se o duplicado tiver transferência vinculada e o canônico não tiver, transfere
        if (duplicate.sourceTransfer && !canonical.sourceTransfer) {
          await this.prisma.financialTransfer.update({
            where: { id: duplicate.sourceTransfer.id },
            data: { sourceTransactionId: canonical.id },
          });
        }
        if (duplicate.destTransfer && !canonical.destTransfer) {
          await this.prisma.financialTransfer.update({
            where: { id: duplicate.destTransfer.id },
            data: { destinationTransactionId: canonical.id },
          });
        }

        // Remove com segurança o registro de R$ 0,00 comprovadamente espúrio
        await this.prisma.financialTransaction.delete({
          where: { id: duplicate.id },
        });

        duplicatesRemoved += 1;
      }
    }

    let remainingTransactions = Math.max(0, totalScanned - duplicatesRemoved);
    if (typeof (this.prisma.financialTransaction as any).count === 'function') {
      try {
        remainingTransactions = await this.prisma.financialTransaction.count({
          where: whereClause,
        });
      } catch {
        remainingTransactions = Math.max(0, totalScanned - duplicatesRemoved);
      }
    }

    return {
      scanned: totalScanned,
      duplicatesRemoved,
      manualDataMerged,
      remainingTransactions,
      totalInspected: totalScanned,
      mergedCount: manualDataMerged,
      removedCount: duplicatesRemoved,
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
}

export const interService = new InterService();
