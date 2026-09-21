import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { usersService, UserAdminError } from './users.service.js';
import {
  ListUsersQuerySchema,
  InviteUserRequestSchema,
  UpdateUserRoleRequestSchema,
  UpdateUserPermissionsRequestSchema,
  AssignClientsRequestSchema,
  UpdateUserStatusRequestSchema,
} from '@zafira/contracts';

function handleControllerError(err: any, reply: FastifyReply) {
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

export const usersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/users
   * Permissão: users.view
   */
  app.get(
    '/api/v1/users',
    {
      preHandler: [authenticate, requirePermission('users.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;

      const parseResult = ListUsersQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros de busca inválidos',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.listMembers(organizationId, parseResult.data);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * GET /api/v1/users/:membershipId
   * Permissão: users.view
   */
  app.get(
    '/api/v1/users/:membershipId',
    {
      preHandler: [authenticate, requirePermission('users.view')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const { membershipId } = request.params;

      try {
        const result = await usersService.getMemberDetail(organizationId, membershipId);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * POST /api/v1/users/invite
   * Permissão: users.invite
   */
  app.post(
    '/api/v1/users/invite',
    {
      preHandler: [authenticate, requirePermission('users.invite')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;

      const parseResult = InviteUserRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Dados do convite inválidos',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.inviteUser(organizationId, actorUserId, parseResult.data);
        return reply.status(201).send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * POST /api/v1/users/:membershipId/invitation
   * Permissão: users.invite
   * Emite ou rotaciona token para membro com convite pendente (INVITED)
   */
  app.post(
    '/api/v1/users/:membershipId/invitation',
    {
      preHandler: [authenticate, requirePermission('users.invite')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const { membershipId } = request.params;

      try {
        const result = await usersService.reissueInvitation(organizationId, actorUserId, membershipId);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/v1/users/:membershipId/role
   * Permissão: users.edit_role
   */
  app.patch(
    '/api/v1/users/:membershipId/role',
    {
      preHandler: [authenticate, requirePermission('users.edit_role')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const { membershipId } = request.params;

      const parseResult = UpdateUserRoleRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Papel (role) informado é inválido',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.updateRole(organizationId, actorUserId, membershipId, parseResult.data);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/v1/users/:membershipId/permissions
   * Permissão: users.edit_permissions
   */
  app.patch(
    '/api/v1/users/:membershipId/permissions',
    {
      preHandler: [authenticate, requirePermission('users.edit_permissions')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const { membershipId } = request.params;

      const parseResult = UpdateUserPermissionsRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Alterações de permissão inválidas',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.updatePermissions(
          organizationId,
          actorUserId,
          membershipId,
          parseResult.data
        );
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PUT /api/v1/users/:membershipId/clients
   * Permissão: users.assign_clients
   */
  app.put(
    '/api/v1/users/:membershipId/clients',
    {
      preHandler: [authenticate, requirePermission('users.assign_clients')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const { membershipId } = request.params;

      const parseResult = AssignClientsRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Lista de clientes inválida',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.assignClients(organizationId, actorUserId, membershipId, parseResult.data);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/v1/users/:membershipId/status
   * Permissão: users.suspend
   */
  app.patch(
    '/api/v1/users/:membershipId/status',
    {
      preHandler: [authenticate, requirePermission('users.suspend')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const { membershipId } = request.params;

      const parseResult = UpdateUserStatusRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Status informado é inválido. Permitido apenas ACTIVE ou SUSPENDED',
          details: parseResult.error.errors,
        });
      }

      try {
        const result = await usersService.updateStatus(organizationId, actorUserId, membershipId, parseResult.data);
        return reply.send({
          status: 'success',
          data: result,
        });
      } catch (err: any) {
        return handleControllerError(err, reply);
      }
    }
  );

  /**
   * DELETE /api/v1/users/:membershipId
   * Permissão: users.remove
   */
  app.delete(
    '/api/v1/users/:membershipId',
    {
      preHandler: [authenticate, requirePermission('users.remove')],
    },
    async (request: FastifyRequest<{ Params: { membershipId: string } }>, reply: FastifyReply) => {
      const organizationId = request.authorizationResult!.organizationId;
      const actorUserId = request.authContext?.type === 'user' ? request.authContext.userId : null;
      const { membershipId } = request.params;

      try {
        const result = await usersService.removeMember(organizationId, actorUserId, membershipId);
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
