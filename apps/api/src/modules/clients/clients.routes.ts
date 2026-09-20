import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import {
  clientIdParamSchema,
  createClientSchema,
  listClientsQuerySchema,
  updateClientSchema,
} from './clients.schemas.js';
import { AppError, ClientsService, ClientServiceContext } from './clients.service.js';
import { AuthorizationResult } from '../authorization/resolver.js';

export async function clientRoutes(app: FastifyInstance) {
  const clientsService = new ClientsService();

  app.addHook('preHandler', authenticate);

  function handleError(error: unknown, reply: FastifyReply) {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        status: 'error',
        message: 'Dados inválidos na requisição',
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        status: 'error',
        message: error.message,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      status: 'error',
      message: 'Ocorreu um erro interno no servidor',
    });
  }

  function getClientContext(request: FastifyRequest): ClientServiceContext {
    const authResult = (request as any).authorizationResult as AuthorizationResult;
    return {
      organizationId: authResult.organizationId!,
      membershipId: authResult.membershipId!,
      role: authResult.role!
    };
  }

  app.get(
    '/clients',
    { preHandler: [requirePermission('clients.list')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const filters = listClientsQuerySchema.parse(request.query);
        const clients = await clientsService.listClients(getClientContext(request), filters);
        return reply.status(200).send(clients);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.get(
    '/clients/:id',
    { preHandler: [requirePermission('clients.view')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const client = await clientsService.getClientById(getClientContext(request), id);
        return reply.status(200).send(client);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.post(
    '/clients',
    { preHandler: [requirePermission('clients.create')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = createClientSchema.parse(request.body);
        const client = await clientsService.createClient(getClientContext(request), body);
        return reply.status(201).send(client);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.patch(
    '/clients/:id',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const body = updateClientSchema.parse(request.body);
        const client = await clientsService.updateClient(getClientContext(request), id, body);
        return reply.status(200).send(client);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
