import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  CreateAutomationFlowRequestSchema,
  ResendAutomationRequestSchema,
  SetupAutomationConnectionRequestSchema,
  UpdateAutomationFlowRequestSchema,
} from '@zafira/contracts';
import type { PermissionCode, RoleType } from '@zafira/domain';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { AutomationError, automationService as service } from './automation.service.js';
import { OnboardingError } from './onboarding.service.js';
import type { ExecutionContext } from './onboarding-execution.service.js';
import { dispatcherEnabled } from './automation-config.js';

/**
 * F7-4a - Rotas das automacoes n8n. Prefixos "" e "/api".
 * Administracao: automation.manage; consulta: automation.view; reenvio: onboarding.override.
 * Callback publico do n8n: autenticado por assinatura HMAC por organizacao (nao por sessao).
 */

type Authz = { organizationId?: string; membershipId?: string; role?: RoleType };

function contextOf(request: FastifyRequest, reply: FastifyReply): ExecutionContext | null {
  const authz = (request as any).authorizationResult as Authz | undefined;
  const userId = request.authContext?.type === 'user' ? request.authContext.userId : undefined;
  if (!authz?.organizationId || !authz.membershipId || !authz.role || !userId) {
    reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organizacao valido.' });
    return null;
  }
  return { organizationId: authz.organizationId, userId, membershipId: authz.membershipId, role: authz.role } as ExecutionContext;
}

export async function automationRoutes(app: FastifyInstance) {
  const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    permission: PermissionCode,
    handler: (ctx: ExecutionContext, request: FastifyRequest) => Promise<unknown>,
    successStatus = 200
  ) => {
    for (const prefix of ['', '/api']) {
      // CLASSE: HUMAN_AUTHENTICATED
      app.route({
        method,
        url: `${prefix}${path}`,
        preHandler: [authenticate, requirePermission(permission)],
        handler: async (request, reply) => {
          const ctx = contextOf(request, reply);
          if (!ctx) return reply;
          try {
            return reply.status(successStatus).send(await handler(ctx, request));
          } catch (error) {
            if (error instanceof AutomationError || error instanceof OnboardingError) {
              return reply.status(error.status).send({ status: 'error', code: error.code, message: error.message });
            }
            if (error instanceof ZodError) {
              return reply.status(400).send({ status: 'error', code: 'INVALID_REQUEST', message: error.issues[0]?.message || 'Dados invalidos.' });
            }
            app.log.error(error);
            return reply.status(500).send({ status: 'error', message: 'Nao foi possivel concluir a operacao de automacao.' });
          }
        },
      });
    }
  };

  const params = (r: FastifyRequest) => r.params as Record<string, string>;

  // ---- conexao e fluxos (administracao)
  route('GET', '/automation/connection', 'automation.manage', (ctx) => service.connectionStatus(ctx.organizationId));
  route('PUT', '/automation/connection', 'automation.manage', (ctx, r) =>
    service.setupConnection(ctx, SetupAutomationConnectionRequestSchema.parse(r.body ?? {}))
  );
  route('DELETE', '/automation/connection', 'automation.manage', (ctx) => service.removeConnection(ctx));
  route('GET', '/automation/flows', 'automation.view', (ctx) => service.listFlows(ctx.organizationId));
  route('POST', '/automation/flows', 'automation.manage', (ctx, r) =>
    service.createFlow(ctx, CreateAutomationFlowRequestSchema.parse(r.body ?? {})), 201
  );
  route('PATCH', '/automation/flows/:id', 'automation.manage', (ctx, r) =>
    service.updateFlow(ctx, params(r).id, UpdateAutomationFlowRequestSchema.parse(r.body ?? {}))
  );
  // despacho manual (so atua com N8N_DISPATCH_ENABLED=true; desligado nada e enviado)
  route('POST', '/automation/dispatch', 'automation.manage', async (ctx) => {
    if (!dispatcherEnabled()) return { enabled: false, claimed: 0 };
    const r = await service.dispatchDue({ limit: 20, organizationId: ctx.organizationId });
    return { enabled: r.enabled, claimed: r.claimed };
  });

  // ---- por execucao
  route('GET', '/onboarding/executions/:id/automation', 'automation.view', (ctx, r) =>
    service.listForExecution(ctx.organizationId, params(r).id)
  );
  route('POST', '/onboarding/executions/:id/steps/:stepKey/automation/resend', 'onboarding.override', (ctx, r) =>
    service.resend(ctx, params(r).id, params(r).stepKey, ResendAutomationRequestSchema.parse(r.body ?? {}))
  );

  // ---- callback do n8n (sem sessao; assinatura HMAC com o segredo da organizacao)
  // Escopo proprio: o corpo chega como texto bruto (a assinatura cobre os bytes exatos enviados).
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
      done(null, body);
    });
    for (const prefix of ['', '/api']) {
      // CLASSE: MACHINE_AUTHENTICATED
      scope.post(
        `${prefix}/integrations/n8n/callback/:organizationId`,
        { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
        async (request, reply) => {
          const raw = typeof request.body === 'string' ? request.body : '';
          const { organizationId } = request.params as { organizationId: string };
          if (!raw) {
            return reply.status(400).send({ status: 'error', code: 'INVALID_REQUEST', message: 'Corpo invalido.' });
          }
          try {
            const out = await service.handleCallback(organizationId, raw, request.headers as Record<string, string | string[] | undefined>);
            return reply.status(out.status).send(out.body);
          } catch (error) {
            app.log.error(error);
            return reply.status(500).send({ status: 'error', message: 'Nao foi possivel processar o resultado.' });
          }
        }
      );
    }
  });
}
