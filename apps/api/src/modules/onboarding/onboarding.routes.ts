import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import {
  CreateOnboardingTemplateRequestSchema,
  CreateOrganizationFunctionRequestSchema,
  PublishOnboardingVersionRequestSchema,
  SaveOnboardingDraftRequestSchema,
  SetFunctionMembersRequestSchema,
  UpdateOnboardingTemplateRequestSchema,
  UpdateOrganizationFunctionRequestSchema,
} from '@zafira/contracts';
import type { PermissionCode } from '@zafira/domain';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { OnboardingContext, OnboardingError, onboardingService } from './onboarding.service.js';

/**
 * F7-1a — Rotas do construtor de onboarding (DEC-F7-005).
 * Modelos e funções são da ORGANIZAÇÃO (sem escopo de cliente; execuções, na F7-2, seguem a carteira).
 * Cada rota: sessão + permissão própria + organização da sessão. Prefixos "" e "/api".
 */

type Authz = { organizationId?: string };

function contextOf(request: FastifyRequest, reply: FastifyReply): OnboardingContext | null {
  const authz = (request as any).authorizationResult as Authz | undefined;
  const userId = request.authContext?.type === 'user' ? request.authContext.userId : undefined;
  if (!authz?.organizationId || !userId) {
    reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organização válido.' });
    return null;
  }
  return { organizationId: authz.organizationId, userId };
}

export async function onboardingRoutes(app: FastifyInstance) {
  const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    permission: PermissionCode,
    handler: (ctx: OnboardingContext, request: FastifyRequest) => Promise<unknown>,
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
            const body = await handler(ctx, request);
            return reply.status(successStatus).send(body);
          } catch (error) {
            if (error instanceof OnboardingError) {
              return reply.status(error.status).send({
                status: 'error',
                code: error.code,
                message: error.message,
                ...(error.problems ? { problems: error.problems } : {}),
              });
            }
            if (error instanceof ZodError) {
              return reply.status(400).send({
                status: 'error',
                code: 'INVALID_REQUEST',
                message: error.issues[0]?.message || 'Dados inválidos.',
              });
            }
            app.log.error(error);
            return reply.status(500).send({ status: 'error', message: 'Não foi possível concluir a operação de onboarding.' });
          }
        },
      });
    }
  };

  const params = (request: FastifyRequest) => request.params as Record<string, string>;
  const body = <S extends z.ZodTypeAny>(schema: S, request: FastifyRequest): z.infer<S> => schema.parse(request.body ?? {});

  // ---- modelos (leitura)
  route('GET', '/onboarding/templates', 'onboarding.view', (ctx) => onboardingService.listTemplates(ctx));
  route('GET', '/onboarding/templates/:id', 'onboarding.view', (ctx, r) => onboardingService.getTemplate(ctx, params(r).id));
  route('GET', '/onboarding/functions', 'onboarding.view', (ctx) => onboardingService.listFunctions(ctx));
  route('GET', '/onboarding/members', 'onboarding.view', (ctx) => onboardingService.listMembers(ctx));

  // ---- modelos (gestão)
  route(
    'POST',
    '/onboarding/templates',
    'onboarding.manage_templates',
    (ctx, r) => onboardingService.createTemplate(ctx, body(CreateOnboardingTemplateRequestSchema, r)),
    201
  );
  route('PATCH', '/onboarding/templates/:id', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.updateTemplate(ctx, params(r).id, body(UpdateOnboardingTemplateRequestSchema, r))
  );
  route(
    'POST',
    '/onboarding/templates/:id/duplicate',
    'onboarding.manage_templates',
    (ctx, r) => onboardingService.duplicateTemplate(ctx, params(r).id),
    201
  );
  route('POST', '/onboarding/templates/:id/archive', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.archiveTemplate(ctx, params(r).id)
  );
  route('POST', '/onboarding/templates/:id/reactivate', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.reactivateTemplate(ctx, params(r).id)
  );

  // ---- versões
  route(
    'POST',
    '/onboarding/templates/:id/versions',
    'onboarding.manage_templates',
    (ctx, r) => onboardingService.createDraft(ctx, params(r).id),
    201
  );
  route('PUT', '/onboarding/templates/:id/versions/:versionId', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.saveDraft(ctx, params(r).id, params(r).versionId, body(SaveOnboardingDraftRequestSchema, r))
  );
  route('POST', '/onboarding/templates/:id/versions/:versionId/validate', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.validateVersion(ctx, params(r).id, params(r).versionId)
  );
  route('POST', '/onboarding/templates/:id/versions/:versionId/publish', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.publish(ctx, params(r).id, params(r).versionId, body(PublishOnboardingVersionRequestSchema, r))
  );
  route('DELETE', '/onboarding/templates/:id/versions/:versionId', 'onboarding.manage_templates', (ctx, r) =>
    onboardingService.discardDraft(ctx, params(r).id, params(r).versionId)
  );

  // ---- funções operacionais (gestão)
  route(
    'POST',
    '/onboarding/functions',
    'onboarding.manage_functions',
    (ctx, r) => onboardingService.createFunction(ctx, body(CreateOrganizationFunctionRequestSchema, r)),
    201
  );
  route('PATCH', '/onboarding/functions/:id', 'onboarding.manage_functions', (ctx, r) =>
    onboardingService.updateFunction(ctx, params(r).id, body(UpdateOrganizationFunctionRequestSchema, r))
  );
  route('PUT', '/onboarding/functions/:id/members', 'onboarding.manage_functions', (ctx, r) =>
    onboardingService.setFunctionMembers(ctx, params(r).id, body(SetFunctionMembersRequestSchema, r).memberIds)
  );
}
