import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { organizationConfigService, UpdateConfigInput } from './organization-config.service.js';
import { featureFlagService } from './feature-flag.service.js';
import { isValidFeatureFlagKey } from '@zafira/domain';

function getOrganizationContext(req: FastifyRequest, reply: FastifyReply): string | null {
  const auth = req.authContext;
  const headerOrg = req.headers['x-organization-id'] as string | undefined;
  const organizationId = (auth?.type === 'user' ? auth.activeOrganizationId : null) || headerOrg;

  if (!organizationId) {
    reply.status(400).send({
      status: 'error',
      error: 'ORGANIZATION_CONTEXT_REQUIRED',
      message: 'Contexto de organização ativo é obrigatório.',
    });
    return null;
  }

  return organizationId;
}

export const organizationConfigRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/organization/config
   * Classificação: HUMAN_AUTHENTICATED
   * Proteção: authenticate
   */
  app.get(
    '/api/v1/organization/config',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrganizationContext(request, reply);
      if (!organizationId) return;

      try {
        const config = await organizationConfigService.getConfig(organizationId);
        return reply.send({
          status: 'success',
          data: config,
        });
      } catch (err: any) {
        return reply.status(500).send({
          status: 'error',
          error: 'INTERNAL_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * PATCH /api/v1/organization/config
   * Classificação: HUMAN_AUTHENTICATED
   * Proteção: authenticate + requirePermission('admin.configure_organization')
   */
  app.patch(
    '/api/v1/organization/config',
    {
      preHandler: [authenticate, requirePermission('admin.configure_organization')],
    },
    async (request: FastifyRequest<{ Body: UpdateConfigInput }>, reply: FastifyReply) => {
      const organizationId = getOrganizationContext(request, reply);
      if (!organizationId) return;

      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const body = request.body || {};

      try {
        const updated = await organizationConfigService.updateConfig(organizationId, actorUserId, body);
        return reply.send({
          status: 'success',
          data: updated,
        });
      } catch (err: any) {
        return reply.status(400).send({
          status: 'error',
          error: 'INVALID_CONFIG_INPUT',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/organization/feature-flags
   * Classificação: HUMAN_AUTHENTICATED
   * Proteção: authenticate
   */
  app.get(
    '/api/v1/organization/feature-flags',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrganizationContext(request, reply);
      if (!organizationId) return;

      try {
        const flags = await featureFlagService.listFlags(organizationId);
        return reply.send({
          status: 'success',
          data: flags,
        });
      } catch (err: any) {
        return reply.status(500).send({
          status: 'error',
          error: 'INTERNAL_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * PATCH /api/v1/organization/feature-flags/:key
   * Classificação: HUMAN_AUTHENTICATED
   * Proteção: authenticate + requirePermission('admin.configure_organization')
   */
  app.patch(
    '/api/v1/organization/feature-flags/:key',
    {
      preHandler: [authenticate, requirePermission('admin.configure_organization')],
    },
    async (
      request: FastifyRequest<{ Params: { key: string }; Body: { enabled: boolean } }>,
      reply: FastifyReply
    ) => {
      const organizationId = getOrganizationContext(request, reply);
      if (!organizationId) return;

      const { key } = request.params;
      const { enabled } = request.body || {};

      if (!isValidFeatureFlagKey(key)) {
        return reply.status(400).send({
          status: 'error',
          error: 'INVALID_FEATURE_FLAG_KEY',
          message: `Chave de feature flag inválida ou desconhecida: "${key}"`,
        });
      }

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          status: 'error',
          error: 'INVALID_FLAG_VALUE',
          message: 'O campo "enabled" deve ser booleano',
        });
      }

      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;

      try {
        const updated = await featureFlagService.setFlag(organizationId, actorUserId, key, enabled);
        return reply.send({
          status: 'success',
          data: updated,
        });
      } catch (err: any) {
        return reply.status(400).send({
          status: 'error',
          error: 'FLAG_UPDATE_FAILED',
          message: err.message,
        });
      }
    }
  );
};
