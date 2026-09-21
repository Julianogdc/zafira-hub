import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { usersService, UserAdminError } from './users.service.js';
import {
  InspectInvitationRequestSchema,
  AcceptInvitationRequestSchema,
} from '@zafira/contracts';

function handleInvitationError(err: any, reply: FastifyReply) {
  if (err instanceof UserAdminError) {
    return reply.status(err.statusCode).send({
      status: 'error',
      code: err.code,
      message: err.message,
    });
  }

  return reply.status(500).send({
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: err.message || 'Erro interno do servidor',
  });
}

export const invitationsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/v1/invitations/inspect
   * Rota pública (sem autenticação) com rate limit conservador
   */
  app.post(
    '/api/v1/invitations/inspect',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = InspectInvitationRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Token de convite inválido ou ausente',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.inspectInvitation(parseResult.data.token);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleInvitationError(err, reply);
      }
    }
  );

  /**
   * POST /api/v1/invitations/accept
   * Rota pública (sem autenticação) com rate limit estrito
   */
  app.post(
    '/api/v1/invitations/accept',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = AcceptInvitationRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Dados de aceite inválidos',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.acceptInvitation(
          parseResult.data.token,
          parseResult.data.password
        );
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleInvitationError(err, reply);
      }
    }
  );
};
