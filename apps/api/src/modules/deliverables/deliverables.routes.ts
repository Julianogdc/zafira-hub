import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AdjustDeliverableTargetRequestSchema,
  AdvanceDeliverablePieceRequestSchema,
  CancelDeliverablePieceRequestSchema,
  CloseDeliverablePlanRequestSchema,
  CreateDeliverableItemRequestSchema,
  CreateDeliverablePieceRequestSchema,
  CreateDeliverablePlanRequestSchema,
  DeliverablePeriodSchema,
  ReopenDeliverablePlanRequestSchema,
  RevertDeliverablePieceRequestSchema,
} from '@zafira/contracts';
import { DeliverableDomainError, PermissionCode, RoleType } from '@zafira/domain';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { findClientInResourceScope } from '../authorization/client-resource-scope.js';
import { DeliverablesService } from './deliverables.service.js';
import { DeliverablesOperationsService, OperationContext } from './deliverables-operations.service.js';

/**
 * Rotas de Entregas.
 * F6-IMP.7A: leitura (GET). F6-IMP.7B: operação no Hub (DEC-F6-002) — nunca escreve no Asana.
 * Cada rota: sessão + permissão própria + cliente na carteira (Client Resource Scope) + organização da sessão.
 */

const DOMAIN_ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  PERMISSION_DENIED: 403,
  TENANT_MISMATCH: 404,
  PLAN_EXISTS: 409,
  PLAN_CLOSED_IMMUTABLE: 409,
  PLAN_CANCELLED_IMMUTABLE: 409,
  ALREADY_CLOSED: 409,
  INVALID_STATUS_TRANSITION: 409,
  INVALID_STAGE_TRANSITION: 409,
  STAGE_CONFLICT: 409,
  ITEM_CANCELLED: 409,
  REASON_REQUIRED: 400,
  FORMAT_REQUIRED: 400,
  FORMAT_NOT_ALLOWED: 400,
  INVALID_TARGET_QUANTITY: 400,
};

type Authz = { organizationId?: string; membershipId?: string; role?: RoleType };

export async function deliverablesRoutes(app: FastifyInstance) {
  const service = new DeliverablesService();
  const operations = new DeliverablesOperationsService();

  /** Valida organização ativa e cliente na carteira. Responde e devolve null quando negar. */
  const resolveClient = async (request: FastifyRequest, reply: FastifyReply) => {
    const authz = (request as any).authorizationResult as Authz | undefined;
    const userId = request.authContext?.type === 'user' ? request.authContext.userId : undefined;
    if (!authz?.organizationId || !authz.membershipId || !authz.role || !userId) {
      reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organização válido.' });
      return null;
    }
    const clientId = (request.params as { id: string }).id;
    const client = await findClientInResourceScope(
      prisma,
      { organizationId: authz.organizationId, membershipId: authz.membershipId, role: authz.role },
      clientId
    );
    if (!client) {
      reply.status(404).send({ status: 'error', message: 'Cliente não encontrado.' });
      return null;
    }
    return { organizationId: authz.organizationId, clientId, userId } satisfies OperationContext;
  };

  const route = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permission: PermissionCode,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  ) => {
    for (const prefix of ['', '/api']) {
      // CLASSE: HUMAN_AUTHENTICATED
      app.route({
        method,
        url: `${prefix}${path}`,
        preHandler: [authenticate, requirePermission(permission)],
        handler,
      });
    }
  };

  /** Executa uma operação e devolve o plano atualizado do período. */
  const mutation =
    <S extends z.ZodTypeAny>(
      schema: S,
      run: (ctx: OperationContext, params: Record<string, string>, body: z.infer<S>) => Promise<{ period: string }>,
      successStatus = 200
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = await resolveClient(request, reply);
      if (!ctx) return reply;
      const parsed = schema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          status: 'error',
          message: parsed.error.issues[0]?.message || 'Dados inválidos.',
        });
      }
      try {
        const { period } = await run(ctx, request.params as Record<string, string>, parsed.data);
        const plan = await service.getClientPlan(ctx.organizationId, ctx.clientId, period);
        return reply.status(successStatus).send({ plan, period, clientId: ctx.clientId });
      } catch (error) {
        if (error instanceof DeliverableDomainError) {
          return reply
            .status(DOMAIN_ERROR_STATUS[error.code] ?? 400)
            .send({ status: 'error', code: error.code, message: error.message });
        }
        app.log.error(error);
        return reply.status(500).send({ status: 'error', message: 'Não foi possível salvar a operação de entregas.' });
      }
    };

  // ---------------------------------------------------------------- leitura (F6-IMP.7A)
  route('GET', '/clients/:id/deliverables', 'deliverables.view', async (request, reply) => {
    const parsedPeriod = DeliverablePeriodSchema.safeParse((request.query as { period?: unknown })?.period);
    if (!parsedPeriod.success) {
      // Contexto ainda é validado antes de responder sobre o formato, para não vazar nada sem permissão.
      const authz = (request as any).authorizationResult as Authz | undefined;
      if (!authz?.organizationId) {
        return reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organização válido.' });
      }
      return reply.status(400).send({ status: 'error', message: 'Período deve estar no formato YYYY-MM.' });
    }
    const ctx = await resolveClient(request, reply);
    if (!ctx) return reply;
    try {
      const plan = await service.getClientPlan(ctx.organizationId, ctx.clientId, parsedPeriod.data);
      return reply.status(200).send({ plan, period: parsedPeriod.data, clientId: ctx.clientId });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ status: 'error', message: 'Não foi possível carregar o plano de entregas.' });
    }
  });

  // ---------------------------------------------------------------- plano (admin/gestor)
  route(
    'POST',
    '/clients/:id/deliverables',
    'deliverables.plan',
    mutation(CreateDeliverablePlanRequestSchema, (ctx, _p, body) => operations.createPlan(ctx, body), 201)
  );
  route(
    'POST',
    '/clients/:id/deliverables/:planId/items',
    'deliverables.plan',
    mutation(CreateDeliverableItemRequestSchema, (ctx, p, body) => operations.addItem(ctx, p.planId, body), 201)
  );
  route(
    'PATCH',
    '/clients/:id/deliverables/:planId/items/:itemId/target',
    'deliverables.adjust_target',
    mutation(AdjustDeliverableTargetRequestSchema, (ctx, p, body) => operations.adjustTarget(ctx, p.planId, p.itemId, body))
  );
  route(
    'POST',
    '/clients/:id/deliverables/:planId/close',
    'deliverables.complete',
    mutation(CloseDeliverablePlanRequestSchema, (ctx, p, body) => operations.closePlan(ctx, p.planId, body))
  );
  route(
    'POST',
    '/clients/:id/deliverables/:planId/reopen',
    'deliverables.reopen',
    mutation(ReopenDeliverablePlanRequestSchema, (ctx, p, body) => operations.reopenPlan(ctx, p.planId, body))
  );

  // ---------------------------------------------------------------- peças (toda a equipe da carteira)
  route(
    'POST',
    '/clients/:id/deliverables/:planId/items/:itemId/pieces',
    'deliverables.register',
    mutation(CreateDeliverablePieceRequestSchema, (ctx, p, body) => operations.addPiece(ctx, p.planId, p.itemId, body), 201)
  );
  route(
    'POST',
    '/clients/:id/deliverables/:planId/pieces/:pieceId/advance',
    'deliverables.register',
    mutation(AdvanceDeliverablePieceRequestSchema, (ctx, p, body) => operations.advancePiece(ctx, p.planId, p.pieceId, body))
  );
  route(
    'POST',
    '/clients/:id/deliverables/:planId/pieces/:pieceId/revert',
    'deliverables.register',
    mutation(RevertDeliverablePieceRequestSchema, (ctx, p, body) => operations.revertPiece(ctx, p.planId, p.pieceId, body))
  );
  route(
    'POST',
    '/clients/:id/deliverables/:planId/pieces/:pieceId/cancel',
    'deliverables.register',
    mutation(CancelDeliverablePieceRequestSchema, (ctx, p, body) => operations.cancelPiece(ctx, p.planId, p.pieceId, body))
  );
}
