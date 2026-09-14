import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, requireRole } from '../../../middleware/auth.js';
import { AsaasIntegrationError } from './asaas.client.js';
import { AsaasService } from './asaas.service.js';

interface ClientParams {
  clientId?: string;
  id?: string;
}

export function createAsaasRoutes(customService?: AsaasService) {
  const service = customService || new AsaasService();

  function handleError(error: unknown, reply: FastifyReply) {
    if (error instanceof AsaasIntegrationError) {
      return reply.status(error.statusCode).send({
        status: 'error',
        code: error.code,
        message: error.message,
      });
    }

    const err = error as any;
    const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 500;
    return reply.status(statusCode).send({
      status: 'error',
      code: err?.code || 'INTERNAL_SERVER_ERROR',
      message: err?.message || 'Ocorreu um erro interno no processamento do Asaas',
    });
  }

  function getOrganizationId(request: FastifyRequest): string | undefined {
    const auth = request.authContext;
    if (auth && auth.type === 'user' && auth.memberships && auth.memberships.length > 0) {
      return auth.memberships[0].organizationId;
    }
    return undefined;
  }

  function extractClientId(params: ClientParams): string {
    return (params.clientId || params.id || '').trim();
  }

  return async function asaasRoutes(app: FastifyInstance) {
    // =========================================================================
    // 1. GET /clients/:clientId/integrations/asaas/financial-summary
    // =========================================================================
    const getFinancialSummaryHandler = async (
      request: FastifyRequest<{ Params: ClientParams }>,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);

        const summary = await service.getClientFinancialSummary(clientId, organizationId);
        return reply.status(200).send(summary);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.get(
      '/clients/:clientId/integrations/asaas/financial-summary',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      getFinancialSummaryHandler
    );
    app.get(
      '/api/clients/:clientId/integrations/asaas/financial-summary',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      getFinancialSummaryHandler
    );

    // =========================================================================
    // 2. POST /integrations/asaas/sync (Ação manual somente leitura de sincronização)
    // =========================================================================
    const syncAsaasHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        if (!organizationId) {
          return reply.status(400).send({
            status: 'error',
            message: 'Organização do usuário não identificada para sincronização.',
          });
        }

        const result = await service.syncAsaasData(organizationId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.post(
      '/integrations/asaas/sync',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      syncAsaasHandler
    );
    app.post(
      '/api/integrations/asaas/sync',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      syncAsaasHandler
    );

    // =========================================================================
    // 3. POST /api/webhooks/asaas (Endpoint seguro de Webhook do Asaas)
    // =========================================================================
    const asaasWebhookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tokenHeader = (request.headers['asaas-access-token'] as string) || '';
        const payload = request.body;

        const result = await service.processWebhookEvent(payload, tokenHeader);
        return reply.status(200).send({ received: true, ...result });
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.post('/api/webhooks/asaas', asaasWebhookHandler);
    app.post('/webhooks/asaas', asaasWebhookHandler);
  };
}

export const asaasRoutes = createAsaasRoutes();
