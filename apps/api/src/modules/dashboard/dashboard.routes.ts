import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { dashboardService, DashboardError } from './dashboard.service.js';
import { DashboardAdminQuerySchema } from '@zafira/contracts';

function handleControllerError(err: any, reply: FastifyReply) {
  if (err instanceof DashboardError) {
    return reply.status(err.statusCode).send({
      status: 'error',
      code: err.code,
      message: err.message,
    });
  }

  return reply.status(500).send({
    status: 'error',
    code: 'INTERNAL_SERVER_ERROR',
    message: err?.message || 'Erro interno no processamento do Dashboard Admin',
  });
}

export const dashboardRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/dashboard/admin/summary
   * Permissão: admin.configure_metrics
   */
  app.get(
    '/api/v1/dashboard/admin/summary',
    {
      preHandler: [authenticate, requirePermission('admin.configure_metrics')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = request.authorizationResult!;
      const organizationId = authResult.organizationId!;
      const membershipId = authResult.membershipId!;
      const role = authResult.role!;
      const userId = request.authContext?.type === 'user' ? request.authContext.userId : null;

      const parseResult = DashboardAdminQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros de consulta do dashboard inválidos',
          details: parseResult.error.issues,
        });
      }

      try {
        const result = await dashboardService.getAdminSummary({
          organizationId,
          membershipId,
          role,
          userId,
          query: parseResult.data,
        });

        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );
};
