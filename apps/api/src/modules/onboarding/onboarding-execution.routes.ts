import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import {
  BlockOnboardingStepRequestSchema,
  CancelOnboardingExecutionRequestSchema,
  CompleteOnboardingExecutionRequestSchema,
  CompleteOnboardingStepRequestSchema,
  ReassignOnboardingStepRequestSchema,
  SkipOnboardingStepRequestSchema,
  StartOnboardingExecutionRequestSchema,
  UnblockOnboardingStepRequestSchema,
} from '@zafira/contracts';
import type { PermissionCode, RoleType } from '@zafira/domain';
import { authenticate, requireAnyPermission } from '../../middleware/auth.js';
import { OnboardingError } from './onboarding.service.js';
import { ExecutionContext, onboardingExecutionService as service } from './onboarding-execution.service.js';

/**
 * F7-2a - Rotas da execucao do onboarding (DEC-F7-008). Prefixos "" e "/api".
 * Cada rota: sessao + permissao + organizacao da sessao + carteira do cliente (no servico).
 */

type Authz = { organizationId?: string; membershipId?: string; role?: RoleType };

function contextOf(request: FastifyRequest, reply: FastifyReply): ExecutionContext | null {
  const authz = (request as any).authorizationResult as Authz | undefined;
  const userId = request.authContext?.type === 'user' ? request.authContext.userId : undefined;
  if (!authz?.organizationId || !authz.membershipId || !authz.role || !userId) {
    reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organizacao valido.' });
    return null;
  }
  return { organizationId: authz.organizationId, userId, membershipId: authz.membershipId, role: authz.role };
}

export async function onboardingExecutionRoutes(app: FastifyInstance) {
  const route = (
    method: 'GET' | 'POST',
    path: string,
    permissions: PermissionCode[],
    handler: (ctx: ExecutionContext, request: FastifyRequest) => Promise<unknown>,
    successStatus = 200
  ) => {
    for (const prefix of ['', '/api']) {
      // CLASSE: HUMAN_AUTHENTICATED
      app.route({
        method,
        url: `${prefix}${path}`,
        preHandler: [authenticate, requireAnyPermission(permissions)],
        handler: async (request, reply) => {
          const ctx = contextOf(request, reply);
          if (!ctx) return reply;
          try {
            return reply.status(successStatus).send(await handler(ctx, request));
          } catch (error) {
            if (error instanceof OnboardingError) {
              return reply.status(error.status).send({
                status: 'error',
                code: error.code,
                message: error.message,
                ...((error as OnboardingError & { existingId?: string }).existingId
                  ? { existingExecutionId: (error as OnboardingError & { existingId?: string }).existingId }
                  : {}),
              });
            }
            if (error instanceof ZodError) {
              return reply.status(400).send({ status: 'error', code: 'INVALID_REQUEST', message: error.issues[0]?.message || 'Dados invalidos.' });
            }
            app.log.error(error);
            return reply.status(500).send({ status: 'error', message: 'Nao foi possivel concluir a operacao de onboarding.' });
          }
        },
      });
    }
  };

  const params = (request: FastifyRequest) => request.params as Record<string, string>;
  const body = <S extends z.ZodTypeAny>(schema: S, request: FastifyRequest): z.infer<S> => schema.parse(request.body ?? {});
  const query = (request: FastifyRequest) => request.query as Record<string, string | undefined>;

  // ---- leitura (carteira do usuario)
  route('GET', '/onboarding/executions', ['onboarding.view'], (ctx, r) => {
    const q = query(r);
    return service.list(ctx, {
      status: q.status,
      clientId: q.clientId,
      templateId: q.templateId,
      assigneeId: q.assigneeId,
      late: q.late === 'true',
      blocked: q.blocked === 'true',
    });
  });
  route('GET', '/onboarding/overview', ['onboarding.view'], (ctx) => service.overview(ctx));
  route('GET', '/onboarding/my-steps', ['onboarding.view'], (ctx) => service.mySteps(ctx));
  route('GET', '/onboarding/executions/:id', ['onboarding.view'], (ctx, r) => service.get(ctx, params(r).id));

  // ---- inicio manual (B2)
  route(
    'POST',
    '/onboarding/executions',
    ['onboarding.start'],
    (ctx, r) => service.start(ctx, body(StartOnboardingExecutionRequestSchema, r)),
    201
  );

  // ---- acoes na execucao
  route('POST', '/onboarding/executions/:id/complete', ['onboarding.start', 'onboarding.override'], (ctx, r) =>
    service.completeExecution(ctx, params(r).id, body(CompleteOnboardingExecutionRequestSchema, r))
  );
  route('POST', '/onboarding/executions/:id/cancel', ['onboarding.cancel'], (ctx, r) =>
    service.cancel(ctx, params(r).id, body(CancelOnboardingExecutionRequestSchema, r))
  );

  // ---- acoes nas etapas (responsavel com execute, ou override; o servico confere quem e o responsavel)
  const stepRoute = (action: string, permissions: PermissionCode[], run: (ctx: ExecutionContext, r: FastifyRequest) => Promise<unknown>) =>
    route('POST', `/onboarding/executions/:id/steps/:stepKey/${action}`, permissions, run);
  const actor: PermissionCode[] = ['onboarding.execute', 'onboarding.override'];
  stepRoute('start', actor, (ctx, r) => service.startStep(ctx, params(r).id, params(r).stepKey));
  stepRoute('complete', actor, (ctx, r) =>
    service.completeStep(ctx, params(r).id, params(r).stepKey, body(CompleteOnboardingStepRequestSchema, r))
  );
  stepRoute('block', actor, (ctx, r) =>
    service.blockStep(ctx, params(r).id, params(r).stepKey, body(BlockOnboardingStepRequestSchema, r))
  );
  stepRoute('unblock', actor, (ctx, r) =>
    service.unblockStep(ctx, params(r).id, params(r).stepKey, body(UnblockOnboardingStepRequestSchema, r))
  );
  stepRoute('skip', ['onboarding.override'], (ctx, r) =>
    service.skipStep(ctx, params(r).id, params(r).stepKey, body(SkipOnboardingStepRequestSchema, r))
  );
  stepRoute('reassign', ['onboarding.override'], (ctx, r) =>
    service.reassignStep(ctx, params(r).id, params(r).stepKey, body(ReassignOnboardingStepRequestSchema, r))
  );
}
