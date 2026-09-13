import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { postizService, PostizService } from './postiz.service.js';
import { PostizIntegrationError } from './postiz.client.js';

export function createPostizRoutes(customService?: PostizService) {
  const service = customService || postizService;

  return async function postizRoutes(app: FastifyInstance) {
    function handleError(error: unknown, reply: FastifyReply) {
      if (error instanceof PostizIntegrationError) {
        return reply.status(error.statusCode).send({
          status: 'error',
          error: error.code,
          message: error.message,
        });
      }

      // Erro genérico inesperado: nunca vazar stack trace ou segredos
      const message = error instanceof Error ? error.message : 'Erro interno ao processar integração Postiz';
      return reply.status(502).send({
        status: 'error',
        error: 'POSTIZ_ERROR',
        message,
      });
    }

    // 1. GET /integrations/postiz/status
    const getStatusHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getStatus();
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.get(
      '/integrations/postiz/status',
      {
        preHandler: [authenticate],
      },
      getStatusHandler
    );

    app.get(
      '/api/integrations/postiz/status',
      {
        preHandler: [authenticate],
      },
      getStatusHandler
    );

    // 2. GET /integrations/postiz/accounts
    const getAccountsHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getAccounts();
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    app.get(
      '/integrations/postiz/accounts',
      {
        preHandler: [authenticate],
      },
      getAccountsHandler
    );

    app.get(
      '/api/integrations/postiz/accounts',
      {
        preHandler: [authenticate],
      },
      getAccountsHandler
    );
  };
}

export const postizRoutes = createPostizRoutes();
