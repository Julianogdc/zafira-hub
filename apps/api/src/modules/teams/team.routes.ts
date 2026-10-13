import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { teamService, TeamError } from './team.service.js';
import {
  CreateTeamRequestSchema,
  UpdateTeamRequestSchema,
  ReplaceTeamMembersRequestSchema,
  ReplaceTeamClientsRequestSchema,
} from '@zafira/contracts';

function handleControllerError(err: any, reply: FastifyReply) {
  if (err instanceof TeamError) {
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

function getActorUserId(request: FastifyRequest, reply: FastifyReply): string | null {
  if (request.authContext?.type === 'user' && request.authContext.userId) {
    return request.authContext.userId;
  }
  reply.status(401).send({
    status: 'error',
    code: 'UNAUTHORIZED',
    message: 'Usuário autenticado obrigatório para esta operação',
  });
  return null;
}

export const teamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/teams
   * Permissão: teams.view
   */
  app.get(
    '/api/v1/teams',
    {
      preHandler: [authenticate, requirePermission('teams.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId!;

      try {
        const teams = await teamService.listTeams(organizationId);
        return reply.send({
          status: 'success',
          data: teams,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * GET /api/v1/teams/:teamId
   * Permissão: teams.view
   */
  app.get(
    '/api/v1/teams/:teamId',
    {
      preHandler: [authenticate, requirePermission('teams.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId!;
      const { teamId } = request.params as { teamId: string };

      try {
        const team = await teamService.getTeamDetail(organizationId, teamId);
        return reply.send({
          status: 'success',
          data: team,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * POST /api/v1/teams
   * Permissão: teams.manage
   */
  app.post(
    '/api/v1/teams',
    {
      preHandler: [authenticate, requirePermission('teams.manage')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId!;
      const actorUserId = getActorUserId(request, reply);
      if (!actorUserId) return;

      const parseResult = CreateTeamRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Dados de criação de equipe inválidos',
          details: parseResult.error.issues,
        });
      }

      try {
        const team = await teamService.createTeam(
          {
            organizationId,
            actorUserId,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] as string | undefined,
          },
          parseResult.data
        );

        return reply.status(201).send({
          status: 'success',
          data: team,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/v1/teams/:teamId
   * Permissão: teams.manage
   */
  app.patch(
    '/api/v1/teams/:teamId',
    {
      preHandler: [authenticate, requirePermission('teams.manage')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId!;
      const actorUserId = getActorUserId(request, reply);
      if (!actorUserId) return;

      const { teamId } = request.params as { teamId: string };

      const parseResult = UpdateTeamRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Dados de atualização de equipe inválidos',
          details: parseResult.error.issues,
        });
      }

      try {
        const team = await teamService.updateTeam(
          {
            organizationId,
            actorUserId,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] as string | undefined,
          },
          teamId,
          parseResult.data
        );

        return reply.send({
          status: 'success',
          data: team,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PUT /api/v1/teams/:teamId/members
   * Permissão: teams.manage
   */
  app.put(
    '/api/v1/teams/:teamId/members',
    {
      preHandler: [authenticate, requirePermission('teams.manage')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId!;
      const actorUserId = getActorUserId(request, reply);
      if (!actorUserId) return;

      const { teamId } = request.params as { teamId: string };

      const parseResult = ReplaceTeamMembersRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Lista de membros inválida',
          details: parseResult.error.issues,
        });
      }

      try {
        await teamService.replaceMembers(
          {
            organizationId,
            actorUserId,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] as string | undefined,
          },
          teamId,
          parseResult.data
        );

        return reply.send({
          status: 'success',
          message: 'Membros da equipe atualizados com sucesso',
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PUT /api/v1/teams/:teamId/clients
   * Permissão: teams.manage
   */
  app.put(
    '/api/v1/teams/:teamId/clients',
    {
      preHandler: [authenticate, requirePermission('teams.manage')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId!;
      const actorUserId = getActorUserId(request, reply);
      if (!actorUserId) return;

      const { teamId } = request.params as { teamId: string };

      const parseResult = ReplaceTeamClientsRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Lista de clientes inválida',
          details: parseResult.error.issues,
        });
      }

      try {
        await teamService.replaceClients(
          {
            organizationId,
            actorUserId,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] as string | undefined,
          },
          teamId,
          parseResult.data
        );

        return reply.send({
          status: 'success',
          message: 'Clientes da equipe atualizados com sucesso',
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );
};
