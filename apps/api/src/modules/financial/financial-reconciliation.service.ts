import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { FinancialTransferStatus } from '@prisma/client';

export class FinancialReconciliationService {
  private readonly prisma: typeof defaultPrisma;

  constructor(prismaClient?: any) {
    this.prisma = prismaClient || defaultPrisma;
  }

  /**
   * Executa a conciliação automática de transferências internas Asaas -> Inter na organização.
   * Regras:
   * 1. Débito no Asaas e crédito no Inter.
   * 2. Mesma organização.
   * 3. Valor exatamente igual.
   * 4. Datas dentro de janela de até 3 dias (diferença <= 3 dias).
   * 5. Se houver referência/identificador compatível: AUTO_MATCHED.
   * 6. Se houver mesmo valor e data aproximada, mas sem identificador confiável: REVIEW.
   * 7. Nunca conciliar por nome de cliente.
   */
  async reconcileTransfers(organizationId: string): Promise<{
    autoMatched: number;
    reviewCount: number;
  }> {
    // 1. Busca contas Asaas e Inter da organização
    const accounts = await this.prisma.financialAccount.findMany({
      where: { organizationId, isActive: true },
    });

    const asaasAccount = accounts.find((a) => a.provider === 'ASAAS');
    const interAccount = accounts.find((a) => a.provider === 'INTER');

    if (!asaasAccount || !interAccount) {
      return { autoMatched: 0, reviewCount: 0 };
    }

    // 2. Busca débitos no Asaas que ainda não foram conciliados
    const asaasDebits = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        accountId: asaasAccount.id,
        direction: 'DEBIT',
        sourceTransfer: null, // sem transferência de saída associada
      },
      orderBy: { occurredAt: 'asc' },
    });

    // 3. Busca créditos no Inter que ainda não foram associados a uma transferência
    const interCredits = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        accountId: interAccount.id,
        direction: 'CREDIT',
        destTransfer: null, // sem transferência de entrada associada
      },
      orderBy: { occurredAt: 'asc' },
    });

    let autoMatched = 0;
    let reviewCount = 0;

    const matchedDestIds = new Set<string>();

    for (const debit of asaasDebits) {
      const debitTime = new Date(debit.occurredAt).getTime();
      const debitAmount = Number(debit.amount);

      // Candidatos no Inter com mesmo valor exato e data de até 3 dias depois (ou mesmo dia)
      const candidates = interCredits.filter((credit) => {
        if (matchedDestIds.has(credit.id)) return false;
        const creditAmount = Number(credit.amount);
        if (Math.abs(creditAmount - debitAmount) > 0.001) return false;

        const creditTime = new Date(credit.occurredAt).getTime();
        const diffDays = (creditTime - debitTime) / (1000 * 60 * 60 * 24);
        // Janela de -1 dia até +3 dias permitida
        return diffDays >= -0.5 && diffDays <= 3.5;
      });

      if (candidates.length === 0) continue;

      // Verifica se há match confiável por identificador / referência externa
      let bestCandidate = candidates[0];
      let isAutoMatched = false;
      let matchReason = 'Valor exato e data próxima (janela <= 3 dias)';

      for (const cand of candidates) {
        const hasMatchingRef =
          (debit.externalReference && cand.externalReference && debit.externalReference === cand.externalReference) ||
          (debit.externalId && cand.description && cand.description.includes(debit.externalId)) ||
          (cand.externalId && debit.description && debit.description.includes(cand.externalId));

        if (hasMatchingRef) {
          bestCandidate = cand;
          isAutoMatched = true;
          matchReason = 'Identificador compatível em ambas as transações';
          break;
        }
      }

      matchedDestIds.add(bestCandidate.id);

      const status: FinancialTransferStatus = isAutoMatched ? 'AUTO_MATCHED' : 'REVIEW';
      const confidence = isAutoMatched ? 0.98 : 0.75;

      // Cria registro de transferência interna
      await this.prisma.financialTransfer.create({
        data: {
          organizationId,
          sourceAccountId: asaasAccount.id,
          destinationAccountId: interAccount.id,
          sourceTransactionId: debit.id,
          destinationTransactionId: bestCandidate.id,
          amount: debit.amount,
          transferredAt: debit.occurredAt,
          status,
          confidence,
          matchReason,
          confirmedAt: isAutoMatched ? new Date() : null,
        },
      });

      // Atualiza o kind da transação para TRANSFER_INTERNAL para não contar como despesa/receita e assegura clientId nulo
      await this.prisma.financialTransaction.update({
        where: { id: debit.id },
        data: { kind: 'TRANSFER_INTERNAL', clientId: null },
      });

      await this.prisma.financialTransaction.update({
        where: { id: bestCandidate.id },
        data: { kind: 'TRANSFER_INTERNAL', clientId: null },
      });

      if (isAutoMatched) {
        autoMatched += 1;
      } else {
        reviewCount += 1;
      }
    }

    return { autoMatched, reviewCount };
  }

  /**
   * Confirmação manual de um vínculo de transferência em REVIEW.
   */
  async confirmTransfer(organizationId: string, transferId: string) {
    const transfer =
      typeof this.prisma.financialTransfer.findUnique === 'function'
        ? await this.prisma.financialTransfer.findUnique({ where: { id: transferId } })
        : await this.prisma.financialTransfer.findFirst({ where: { id: transferId, organizationId } });

    if (!transfer || transfer.organizationId !== organizationId) {
      throw new Error('Transferência não encontrada na organização.');
    }

    return this.prisma.financialTransfer.update({
      where: { id: transferId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
  }
}

export const financialReconciliationService = new FinancialReconciliationService();
