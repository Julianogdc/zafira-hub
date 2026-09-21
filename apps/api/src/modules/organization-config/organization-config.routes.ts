import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { organizationConfigService, UpdateConfigInput } from './organization-config.service.js';
import { featureFlagService } from './feature-flag.service.js';
import { isValidFeatureFlagKey } from '@zafira/domain';

function getOrganizationContext(req: FastifyRequest, reply: FastifyReply): string | null {
  const auth = req.authContext;

  if (!auth) {
    reply.status(401).send({ error: 'unauthorized' });
    return null;
  }

  if (auth.type === 'api_key') {
    reply.status(403).send({
      status: 'error',
      error: 'forbidden',
      code: 'MACHINE_CREDENTIAL_NOT_ALLOWED',
      message: 'Credencial de máquina não tem permissão para acessar recursos de usuário humano.',
    });
    return null;
  }

  const memberships = auth.memberships || [];
  const headerOrg = req.headers['x-organization-id'] as string | undefined;

  // 1. activeOrganizationId tem prioridade
  if (auth.activeOrganizationId) {
    const match = memberships.find(
      (m) => m.organizationId === auth.activeOrganizationId || m.organizationSlug === auth.activeOrganizationId
    );
    if (!match) {
      reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Organização ativa não pertence às memberships do usuário.',
      });
      return null;
    }
    return match.organizationId;
  }

  // 2. Se activeOrganizationId for null e houver x-organization-id
  if (headerOrg) {
    const match = memberships.find(
      (m) => m.organizationId === headerOrg || m.organizationSlug === headerOrg
    );
    if (!match) {
      reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Organização informada no cabeçalho não pertence às memberships do usuário.',
      });
      return null;
    }
    return match.organizationId;
  }

  // 3. Se não houver activeOrganizationId nem header: exatamente 1 membership resolve ela
  if (memberships.length === 1) {
    return memberships[0].organizationId;
  }

  // 4. Múltiplas memberships sem contexto explícito => 400
  if (memberships.length > 1) {
    reply.status(400).send({
      status: 'error',
      error: 'ORGANIZATION_CONTEXT_REQUIRED',
      message: 'Contexto de organização ativo é obrigatório.',
    });
    return null;
  }

  // 5. Nenhuma membership => 403
  reply.status(403).send({
    status: 'error',
    error: 'forbidden',
    message: 'Usuário não possui organizações associadas.',
  });
  return null;
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
