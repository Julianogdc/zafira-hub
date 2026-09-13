import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requireRole } from '../../../middleware/auth.js';
import { postizService, PostizService } from './postiz.service.js';
import { PostizIntegrationError } from './postiz.client.js';

const linkAccountSchema = z.object({
  externalId: z.string().min(1, 'externalId da conta Postiz é obrigatório'),
});

interface ClientParams {
  clientId?: string;
  id?: string;
}

interface ClientExternalIdParams extends ClientParams {
  externalId: string;
}

export function createPostizRoutes(customService?: PostizService) {
  const service = customService || postizService;

  return async function postizRoutes(app: FastifyInstance) {
    const sanitizeMessage = (msg: string): string => {
      const apiKey = process.env.POSTIZ_API_KEY;
      if (apiKey && apiKey.length > 0) {
        return msg.split(apiKey).join('[REDACTED]');
      }
      return msg;
    };

    const handleError = (error: unknown, reply: FastifyReply) => {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          status: 'error',
          error: 'VALIDATION_ERROR',
          message: 'Parâmetros inválidos.',
          details: error.flatten(),
        });
      }

      if (error instanceof PostizIntegrationError) {
        return reply.status(error.statusCode).send({
          status: 'error',
          error: error.code,
          message: sanitizeMessage(error.message),
        });
      }

      return reply.status(500).send({
        status: 'error',
        error: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro inesperado na integração com Postiz.',
      });
    };

    function extractClientId(params: ClientParams): string {
      return (params.clientId || params.id || '').trim();
    }

    // =========================================================================
    // ROTAS GLOBAIS DE INTEGRAÇÃO POSTIZ
    // =========================================================================

    // 1. GET /integrations/postiz/status
    const getStatusHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getStatus();
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.get('/integrations/postiz/status', { preHandler: [authenticate] }, getStatusHandler);
    app.get('/api/integrations/postiz/status', { preHandler: [authenticate] }, getStatusHandler);

    // 2. GET /integrations/postiz/accounts
    const getAccountsHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getAccounts();
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.get('/integrations/postiz/accounts', { preHandler: [authenticate] }, getAccountsHandler);
    app.get('/api/integrations/postiz/accounts', { preHandler: [authenticate] }, getAccountsHandler);

    // =========================================================================
    // ROTAS DE ASSOCIAÇÃO CLIENTE 360 ↔ CONTAS POSTIZ
    // =========================================================================

    // 3. GET /clients/:clientId/integrations/postiz (Consultar contas vinculadas)
    const getClientAccountsHandler = async (
      request: FastifyRequest<{ Params: ClientParams }>,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const result = await service.getClientAccounts(clientId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.get(
      '/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate] },
      getClientAccountsHandler
    );
    app.get(
      '/api/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate] },
      getClientAccountsHandler
    );

    // 4. POST /clients/:clientId/integrations/postiz (Vincular conta Postiz)
    const linkAccountHandler = async (
      request: FastifyRequest<{ Params: ClientParams }>,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const body = linkAccountSchema.parse(request.body);
        const account = await service.linkAccountToClient(clientId, body.externalId);

        return reply.status(201).send({
          status: 'ok',
          message: 'Conta Postiz vinculada ao cliente com sucesso.',
          account,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.post(
      '/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      linkAccountHandler
    );
    app.post(
      '/api/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      linkAccountHandler
    );

    // 5. DELETE /clients/:clientId/integrations/postiz/:externalId (Remover vínculo)
    const unlinkAccountHandler = async (
      request: FastifyRequest<{ Params: ClientExternalIdParams }>,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const externalId = (request.params.externalId || '').trim();

        const result = await service.unlinkAccountFromClient(clientId, externalId);

        return reply.status(200).send({
          status: 'ok',
          success: true,
          message: 'Vínculo da conta Postiz removido com sucesso.',
          deleted: result,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.delete(
      '/clients/:clientId/integrations/postiz/:externalId',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      unlinkAccountHandler
    );
    app.delete(
      '/api/clients/:clientId/integrations/postiz/:externalId',
      { preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])] },
      unlinkAccountHandler
    );
  };
}

export const postizRoutes = createPostizRoutes();
