import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  clientIdParamSchema,
  createClientSchema,
  listClientsQuerySchema,
  updateClientSchema,
} from './clients.schemas.js';
import { AppError, ClientsService } from './clients.service.js';

export async function clientRoutes(app: FastifyInstance) {
  const clientsService = new ClientsService();

  // Exige autenticação (sessão ou API Key) para todas as rotas de clientes
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

  // GET /clients (ADMIN, MANAGER, MEMBER, API Key)
  app.get('/clients', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const filters = listClientsQuerySchema.parse(request.query);
      const clients = await clientsService.listClients(filters);
      return reply.status(200).send(clients);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // GET /clients/:id (ADMIN, MANAGER, MEMBER, API Key)
  app.get('/clients/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = clientIdParamSchema.parse(request.params);
      const client = await clientsService.getClientById(id);
      return reply.status(200).send(client);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // POST /clients (ADMIN, MANAGER, API Key)
  app.post(
    '/clients',
    {
      preHandler: [requireRole(['ADMIN', 'MANAGER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = createClientSchema.parse(request.body);
        const client = await clientsService.createClient(body);
        return reply.status(201).send(client);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // PATCH /clients/:id (ADMIN, MANAGER, API Key)
  app.patch(
    '/clients/:id',
    {
      preHandler: [requireRole(['ADMIN', 'MANAGER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const body = updateClientSchema.parse(request.body);
        const client = await clientsService.updateClient(id, body);
        return reply.status(200).send(client);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}

