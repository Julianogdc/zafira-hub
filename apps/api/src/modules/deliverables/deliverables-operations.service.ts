import { Prisma } from '@prisma/client';
import type {
  AdvanceDeliverablePieceRequest,
  AdjustDeliverableTargetRequest,
  CancelDeliverablePieceRequest,
  CloseDeliverablePlanRequest,
  CreateDeliverableItemRequest,
  CreateDeliverablePieceRequest,
  CreateDeliverablePlanRequest,
  DeliverablePieceStage,
  DeliverablePlanStatus,
  ReopenDeliverablePlanRequest,
  RevertDeliverablePieceRequest,
} from '@zafira/contracts';
import {
  DeliverableDomainError,
  assertPlanMutable,
  deriveItemProgress,
  nextPieceStage,
  previousPieceStage,
  validatePieceCancel,
  validatePieceFormat,
  validatePlanClosure,
  validatePlanReopen,
  validateTargetAdjustment,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Operação de Entregas (F6-IMP.7B — DEC-F6-002). Escreve SOMENTE no Hub, nunca no Asana.
 *
 * Toda operação:
 *  - roda em transação e trava a linha do plano (SELECT ... FOR UPDATE), serializando
 *    alterações concorrentes no mesmo plano;
 *  - filtra plano, linha e peça pela organização da sessão e pelo cliente da rota;
 *  - recalcula a quantidade entregue da linha a partir das peças (nunca confia no cliente HTTP);
 *  - grava DeliverableEvent (histórico visível) e AuditLog.
 */

export interface OperationContext {
  organizationId: string;
  clientId: string;
  userId: string;
}

type Tx = Prisma.TransactionClient;

const notFound = (what: string) => new DeliverableDomainError(`${what} não encontrado.`, 'NOT_FOUND');

async function lockPlan(tx: Tx, ctx: OperationContext, planId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM deliverable_plans
    WHERE id = ${planId} AND "organizationId" = ${ctx.organizationId} AND "clientId" = ${ctx.clientId}
    FOR UPDATE`;
  if (locked.length === 0) throw notFound('Plano de entregas');
  const plan = await tx.deliverablePlan.findFirst({
    where: { id: planId, organizationId: ctx.organizationId, clientId: ctx.clientId },
  });
  if (!plan) throw notFound('Plano de entregas');
  return plan;
}

async function findItem(tx: Tx, ctx: OperationContext, planId: string, itemId: string) {
  const item = await tx.deliverableItem.findFirst({
    where: { id: itemId, planId, organizationId: ctx.organizationId },
  });
  if (!item) throw notFound('Item do plano');
  return item;
}

async function findPiece(tx: Tx, ctx: OperationContext, planId: string, pieceId: string) {
  const piece = await tx.deliverablePiece.findFirst({
    where: { id: pieceId, organizationId: ctx.organizationId, item: { planId, organizationId: ctx.organizationId } },
    include: { item: true },
  });
  if (!piece) throw notFound('Peça');
  return piece;
}

function assertExpectedStage(current: DeliverablePieceStage, expected: DeliverablePieceStage | undefined) {
  if (expected && expected !== current) {
    throw new DeliverableDomainError(
      'A peça mudou de etapa enquanto você editava. Atualize a tela e tente de novo.',
      'STAGE_CONFLICT'
    );
  }
}

/** Recalcula entregues/situação da linha a partir das peças. */
async function syncItem(tx: Tx, ctx: OperationContext, itemId: string) {
  const item = await tx.deliverableItem.findFirstOrThrow({ where: { id: itemId, organizationId: ctx.organizationId } });
  const pieces = await tx.deliverablePiece.findMany({
    where: { itemId, organizationId: ctx.organizationId },
    select: { stage: true },
  });
  const progress = deriveItemProgress(
    item.targetQuantity,
    pieces.map((p) => p.stage as DeliverablePieceStage)
  );
  await tx.deliverableItem.update({
    where: { id: itemId },
    data: {
      deliveredQuantity: progress.deliveredQuantity,
      status: item.status === 'CANCELLED' ? 'CANCELLED' : progress.status,
    },
  });
}

/** Meta contratada do plano = soma das metas das linhas não extras e não canceladas. */
async function syncPlanTarget(tx: Tx, ctx: OperationContext, planId: string) {
  const agg = await tx.deliverableItem.aggregate({
    where: { planId, organizationId: ctx.organizationId, isExtra: false, status: { not: 'CANCELLED' } },
    _sum: { targetQuantity: true },
  });
  await tx.deliverablePlan.update({ where: { id: planId }, data: { targetCount: agg._sum.targetQuantity ?? 0 } });
}

async function record(
  tx: Tx,
  ctx: OperationContext,
  event: {
    planId: string;
    itemId?: string | null;
    eventType: Prisma.DeliverableEventCreateManyInput['eventType'];
    action: string;
    entityType: string;
    entityId: string;
    reason?: string | null;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }
) {
  await tx.deliverableEvent.create({
    data: {
      organizationId: ctx.organizationId,
      planId: event.planId,
      itemId: event.itemId ?? null,
      eventType: event.eventType,
      actorUserId: ctx.userId,
      reason: event.reason ?? null,
      before: event.before,
      after: event.after,
    },
  });
  await new AuditService(tx).record({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    before: event.before,
    after: event.after,
    metadata: { clientId: ctx.clientId, planId: event.planId, reason: event.reason ?? null },
  });
}

function itemData(ctx: OperationContext, planId: string, input: CreateDeliverableItemRequest) {
  return {
    organizationId: ctx.organizationId,
    planId,
    title: input.title,
    description: input.description ?? null,
    type: input.serviceType,
    targetQuantity: input.targetQuantity,
    isExtra: input.isExtra ?? false,
  };
}

export class DeliverablesOperationsService {
  /** Cria o plano do mês com as linhas contratadas. Um plano por cliente e período. */
  async createPlan(ctx: OperationContext, input: CreateDeliverablePlanRequest): Promise<{ period: string }> {
    try {
      await prisma.$transaction(async (tx) => {
        const plan = await tx.deliverablePlan.create({
          data: {
            organizationId: ctx.organizationId,
            clientId: ctx.clientId,
            period: input.period,
            title: input.title,
            notes: input.description ?? null,
            status: 'ACTIVE',
          },
        });
        for (const item of input.items) {
          await tx.deliverableItem.create({ data: itemData(ctx, plan.id, item) });
        }
        await syncPlanTarget(tx, ctx, plan.id);
        await record(tx, ctx, {
          planId: plan.id,
          eventType: 'PLAN_CREATED',
          action: 'deliverables.plan_created',
          entityType: 'DeliverablePlan',
          entityId: plan.id,
          after: {
            period: input.period,
            items: input.items.map((i) => ({ serviceType: i.serviceType, targetQuantity: i.targetQuantity, isExtra: i.isExtra ?? false })),
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DeliverableDomainError('Já existe um plano de entregas para este cliente neste mês.', 'PLAN_EXISTS');
      }
      throw error;
    }
    return { period: input.period };
  }

  /** Acrescenta uma linha (contratada ou extra) ao plano. */
  async addItem(ctx: OperationContext, planId: string, input: CreateDeliverableItemRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      assertPlanMutable({ status: plan.status as DeliverablePlanStatus });
      const item = await tx.deliverableItem.create({ data: itemData(ctx, planId, input) });
      await syncPlanTarget(tx, ctx, planId);
      await record(tx, ctx, {
        planId,
        itemId: item.id,
        eventType: 'ITEM_ADDED',
        action: 'deliverables.item_added',
        entityType: 'DeliverableItem',
        entityId: item.id,
        after: { title: item.title, serviceType: item.type, targetQuantity: item.targetQuantity, isExtra: item.isExtra },
      });
      return { period: plan.period };
    });
  }

  /** Ajusta a meta de uma linha, com justificativa. */
  async adjustTarget(ctx: OperationContext, planId: string, itemId: string, input: AdjustDeliverableTargetRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      const item = await findItem(tx, ctx, planId, itemId);
      validateTargetAdjustment({
        currentTargetQuantity: item.targetQuantity,
        newTargetQuantity: input.newTargetQuantity,
        userPermissions: ['deliverables.adjust_target'],
        reason: input.reason,
        planStatus: plan.status as DeliverablePlanStatus,
      });
      if (item.targetQuantity === input.newTargetQuantity) return { period: plan.period };
      await tx.deliverableItem.update({ where: { id: item.id }, data: { targetQuantity: input.newTargetQuantity } });
      await syncItem(tx, ctx, item.id);
      await syncPlanTarget(tx, ctx, planId);
      await record(tx, ctx, {
        planId,
        itemId: item.id,
        eventType: 'TARGET_ADJUSTED',
        action: 'deliverables.target_adjusted',
        entityType: 'DeliverableItem',
        entityId: item.id,
        reason: input.reason,
        before: { targetQuantity: item.targetQuantity },
        after: { targetQuantity: input.newTargetQuantity },
      });
      return { period: plan.period };
    });
  }

  /** Registra uma peça produzida numa linha. */
  async addPiece(ctx: OperationContext, planId: string, itemId: string, input: CreateDeliverablePieceRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      assertPlanMutable({ status: plan.status as DeliverablePlanStatus });
      const item = await findItem(tx, ctx, planId, itemId);
      if (item.status === 'CANCELLED') {
        throw new DeliverableDomainError('Linha cancelada não recebe peças.', 'ITEM_CANCELLED');
      }
      const format = validatePieceFormat(item.type, input.format ?? null);
      const piece = await tx.deliverablePiece.create({
        data: {
          organizationId: ctx.organizationId,
          itemId: item.id,
          title: input.title,
          format,
          url: input.url ?? null,
          producedByUserId: ctx.userId,
        },
      });
      await syncItem(tx, ctx, item.id);
      await record(tx, ctx, {
        planId,
        itemId: item.id,
        eventType: 'PIECE_ADDED',
        action: 'deliverables.piece_added',
        entityType: 'DeliverablePiece',
        entityId: piece.id,
        after: { pieceId: piece.id, title: piece.title, format, stage: 'PRODUCED' },
      });
      return { period: plan.period };
    });
  }

  /** Avança a peça uma etapa: produzida → aprovada → entregue/postada. */
  async advancePiece(ctx: OperationContext, planId: string, pieceId: string, input: AdvanceDeliverablePieceRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      assertPlanMutable({ status: plan.status as DeliverablePlanStatus });
      const piece = await findPiece(tx, ctx, planId, pieceId);
      const from = piece.stage as DeliverablePieceStage;
      assertExpectedStage(from, input.expectedStage);
      const to = nextPieceStage(from);
      const now = new Date();
      await tx.deliverablePiece.update({
        where: { id: piece.id },
        data:
          to === 'APPROVED'
            ? { stage: to, approvedAt: now, approvedByUserId: ctx.userId }
            : { stage: to, deliveredAt: now, deliveredByUserId: ctx.userId, ...(input.url ? { url: input.url } : {}) },
      });
      await syncItem(tx, ctx, piece.itemId);
      await record(tx, ctx, {
        planId,
        itemId: piece.itemId,
        eventType: 'PIECE_ADVANCED',
        action: 'deliverables.piece_advanced',
        entityType: 'DeliverablePiece',
        entityId: piece.id,
        before: { pieceId: piece.id, title: piece.title, stage: from },
        after: { pieceId: piece.id, title: piece.title, stage: to },
      });
      return { period: plan.period };
    });
  }

  /** Volta a peça uma etapa (correção), com justificativa. */
  async revertPiece(ctx: OperationContext, planId: string, pieceId: string, input: RevertDeliverablePieceRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      assertPlanMutable({ status: plan.status as DeliverablePlanStatus });
      const piece = await findPiece(tx, ctx, planId, pieceId);
      const from = piece.stage as DeliverablePieceStage;
      assertExpectedStage(from, input.expectedStage);
      const to = previousPieceStage(from, input.reason);
      await tx.deliverablePiece.update({
        where: { id: piece.id },
        data:
          from === 'DELIVERED'
            ? { stage: to, deliveredAt: null, deliveredByUserId: null }
            : { stage: to, approvedAt: null, approvedByUserId: null },
      });
      await syncItem(tx, ctx, piece.itemId);
      await record(tx, ctx, {
        planId,
        itemId: piece.itemId,
        eventType: 'PIECE_REVERTED',
        action: 'deliverables.piece_reverted',
        entityType: 'DeliverablePiece',
        entityId: piece.id,
        reason: input.reason,
        before: { pieceId: piece.id, title: piece.title, stage: from },
        after: { pieceId: piece.id, title: piece.title, stage: to },
      });
      return { period: plan.period };
    });
  }

  /** Cancela a peça (deixa de contar), com justificativa. */
  async cancelPiece(ctx: OperationContext, planId: string, pieceId: string, input: CancelDeliverablePieceRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      assertPlanMutable({ status: plan.status as DeliverablePlanStatus });
      const piece = await findPiece(tx, ctx, planId, pieceId);
      const from = piece.stage as DeliverablePieceStage;
      assertExpectedStage(from, input.expectedStage);
      validatePieceCancel(from, input.reason);
      await tx.deliverablePiece.update({ where: { id: piece.id }, data: { stage: 'CANCELLED', cancelledAt: new Date() } });
      await syncItem(tx, ctx, piece.itemId);
      await record(tx, ctx, {
        planId,
        itemId: piece.itemId,
        eventType: 'PIECE_CANCELLED',
        action: 'deliverables.piece_cancelled',
        entityType: 'DeliverablePiece',
        entityId: piece.id,
        reason: input.reason,
        before: { pieceId: piece.id, title: piece.title, stage: from },
        after: { pieceId: piece.id, title: piece.title, stage: 'CANCELLED' },
      });
      return { period: plan.period };
    });
  }

  /** Fecha o mês: o plano fica somente leitura até ser reaberto. */
  async closePlan(ctx: OperationContext, planId: string, input: CloseDeliverablePlanRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      validatePlanClosure({ currentStatus: plan.status as DeliverablePlanStatus, userPermissions: ['deliverables.complete'] });
      await tx.deliverablePlan.update({
        where: { id: planId },
        data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: ctx.userId },
      });
      await record(tx, ctx, {
        planId,
        eventType: 'PLAN_CLOSED',
        action: 'deliverables.plan_closed',
        entityType: 'DeliverablePlan',
        entityId: planId,
        reason: input.reason || null,
        before: { status: plan.status },
        after: { status: 'CLOSED' },
      });
      return { period: plan.period };
    });
  }

  /** Reabre um mês fechado, com justificativa. */
  async reopenPlan(ctx: OperationContext, planId: string, input: ReopenDeliverablePlanRequest) {
    return prisma.$transaction(async (tx) => {
      const plan = await lockPlan(tx, ctx, planId);
      validatePlanReopen({
        currentStatus: plan.status as DeliverablePlanStatus,
        userPermissions: ['deliverables.reopen'],
        reason: input.reason,
      });
      await tx.deliverablePlan.update({
        where: { id: planId },
        data: { status: 'ACTIVE', closedAt: null, closedByUserId: null },
      });
      await record(tx, ctx, {
        planId,
        eventType: 'PLAN_REOPENED',
        action: 'deliverables.plan_reopened',
        entityType: 'DeliverablePlan',
        entityId: planId,
        reason: input.reason,
        before: { status: 'CLOSED' },
        after: { status: 'ACTIVE' },
      });
      return { period: plan.period };
    });
  }
}
