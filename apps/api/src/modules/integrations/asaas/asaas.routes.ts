import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '../../../middleware/auth.js';
import { prisma } from '../../../lib/prisma.js';
import { AsaasClient, AsaasIntegrationError } from './asaas.client.js';
import { AsaasService } from './asaas.service.js';

interface ClientParams {
  clientId?: string;
  id?: string;
}

export function createAsaasRoutes(customService?: AsaasService) {
  const service = customService || new AsaasService(new AsaasClient(), prisma);

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

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/clients/:clientId/integrations/asaas/financial-summary',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getFinancialSummaryHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/clients/:clientId/integrations/asaas/financial-summary',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
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

    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/integrations/asaas/sync',
      { preHandler: [authenticate, requirePermission('integrations.sync')] },
      syncAsaasHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/api/integrations/asaas/sync',
      { preHandler: [authenticate, requirePermission('integrations.sync')] },
      syncAsaasHandler
    );

    // =========================================================================
    // 3. POST /clients/:clientId/integrations/asaas/sync (Sincronização restrita a 1 cliente)
    // =========================================================================
    const syncClientHandler = async (
      request: FastifyRequest<{ Params: ClientParams }>,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);
        if (!organizationId) {
          return reply.status(400).send({
            status: 'error',
            message: 'Organização do usuário não identificada para sincronização.',
          });
        }

        const result = await service.syncClientAsaasData(clientId, organizationId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/clients/:clientId/integrations/asaas/sync',
      { preHandler: [authenticate, requirePermission('integrations.sync')] },
      syncClientHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/api/clients/:clientId/integrations/asaas/sync',
      { preHandler: [authenticate, requirePermission('integrations.sync')] },
      syncClientHandler
    );

    // =========================================================================
    // 4. GET /integrations/asaas/financial-overview (Visão financeira global do Hub)
    // =========================================================================
    const getFinancialOverviewHandler = async (
      request: FastifyRequest<{
        Querystring: {
          period?: string;
          startDate?: string;
          endDate?: string;
          clientId?: string;
          status?: string;
          search?: string;
          page?: string;
          limit?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const organizationId = getOrganizationId(request);
        if (!organizationId) {
          return reply.status(400).send({
            status: 'error',
            message: 'Organização do usuário não identificada.',
          });
        }

        const filters = {
          period: request.query.period,
          startDate: request.query.startDate,
          endDate: request.query.endDate,
          clientId: request.query.clientId,
          status: request.query.status,
          search: request.query.search,
          page: request.query.page ? parseInt(request.query.page, 10) : undefined,
          limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        };

        const result = await service.getFinancialOverview(organizationId, filters);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/integrations/asaas/financial-overview',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getFinancialOverviewHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/integrations/asaas/financial-overview',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getFinancialOverviewHandler
    );

    // =========================================================================
    // 5. POST /integrations/asaas/sync-all (Sincronização completa da carteira Asaas)
    // =========================================================================
    const syncAllWalletHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        if (!organizationId) {
          return reply.status(400).send({
            status: 'error',
            message: 'Organização do usuário não identificada para sincronização.',
          });
        }

        const result = await service.syncAllWallet(organizationId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/integrations/asaas/sync-all',
      { preHandler: [authenticate, requirePermission('integrations.sync')] },
      syncAllWalletHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/api/integrations/asaas/sync-all',
      { preHandler: [authenticate, requirePermission('integrations.sync')] },
      syncAllWalletHandler
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

    // CLASSE: MACHINE_AUTHENTICATED
    app.post('/api/webhooks/asaas', asaasWebhookHandler);
    // CLASSE: MACHINE_AUTHENTICATED
    app.post('/webhooks/asaas', asaasWebhookHandler);
  };
}

export const asaasRoutes = createAsaasRoutes();
