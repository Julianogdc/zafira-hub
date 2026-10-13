import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { auditService } from './audit.service.js';

interface AuditQuery {
  limit?: string;
  cursor?: string;
  action?: string;
  entityType?: string;
  actorUserId?: string;
}

export const auditRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/audit
   * Classificação: HUMAN_AUTHENTICATED
   * Proteção: authenticate + requirePermission('admin.view_audit')
   * Escopo: organizationId resolvido exclusivamente pelo contexto de autenticação/autorização
   */
  app.get(
    '/api/v1/audit',
    {
      preHandler: [authenticate, requirePermission('admin.view_audit')],
    },
    async (request: FastifyRequest, reply) => {
      const auth = request.authContext;
      const headerOrg = request.headers['x-organization-id'] as string | undefined;
      const organizationId = (auth?.type === 'user' ? auth.activeOrganizationId : null) || headerOrg;

      if (!organizationId) {
        return reply.status(400).send({
          status: 'error',
          error: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Contexto de organização ativo é obrigatório para consultar auditoria.',
        });
      }

      const query = (request.query || {}) as AuditQuery;
      const { limit, cursor, action, entityType, actorUserId } = query;

      const parsedLimit = limit ? parseInt(limit, 10) : 50;

      const result = await auditService.list({
        organizationId,
        limit: parsedLimit,
        cursor,
        action,
        entityType,
        actorUserId,
      });

      return reply.send({
        status: 'success',
        data: result,
      });
    }
  );
};
