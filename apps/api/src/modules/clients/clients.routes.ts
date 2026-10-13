import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import {
  clientIdParamSchema,
  clientContactParamsSchema,
  clientMeetingParamsSchema,
  createClientContactSchema,
  createClientMeetingNoteSchema,
  createClientSchema,
  listClientsQuerySchema,
  listMeetingsQuerySchema,
  updateClientContactSchema,
  updateClientMeetingNoteSchema,
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
    const authContext = request.authContext;
    if (!authContext || authContext.type !== 'user') {
      throw new AppError(401, 'Usuário não autenticado');
    }
    return {
      userId: authContext.userId,
      organizationId: authResult.organizationId!,
      membershipId: authResult.membershipId!,
      role: authResult.role!,
    };
  }

  /* ==========================================================================
     ROTAS PRINCIPAIS DE CLIENTE
     ========================================================================== */

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

  /* ==========================================================================
     SUB-RECURSO: CONTATOS (Stakeholders)
     ========================================================================== */

  app.get(
    '/clients/:id/contacts',
    { preHandler: [requirePermission('clients.view')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const contacts = await clientsService.listContacts(getClientContext(request), id);
        return reply.status(200).send(contacts);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.post(
    '/clients/:id/contacts',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const body = createClientContactSchema.parse(request.body);
        const contact = await clientsService.createContact(getClientContext(request), id, body);
        return reply.status(201).send(contact);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.patch(
    '/clients/:id/contacts/:contactId',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id, contactId } = clientContactParamsSchema.parse(request.params);
        const body = updateClientContactSchema.parse(request.body);
        const contact = await clientsService.updateContact(getClientContext(request), id, contactId, body);
        return reply.status(200).send(contact);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    '/clients/:id/contacts/:contactId',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id, contactId } = clientContactParamsSchema.parse(request.params);
        const result = await clientsService.deleteContact(getClientContext(request), id, contactId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  /* ==========================================================================
     SUB-RECURSO: REUNIÕES (Client Meeting Notes)
     ========================================================================== */

  app.get(
    '/clients/:id/meetings',
    { preHandler: [requirePermission('clients.view')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const query = listMeetingsQuerySchema.parse(request.query);
        const meetings = await clientsService.listMeetings(getClientContext(request), id, query);
        return reply.status(200).send(meetings);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.post(
    '/clients/:id/meetings',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const body = createClientMeetingNoteSchema.parse(request.body);
        const meeting = await clientsService.createMeeting(getClientContext(request), id, body);
        return reply.status(201).send(meeting);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.patch(
    '/clients/:id/meetings/:meetingId',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id, meetingId } = clientMeetingParamsSchema.parse(request.params);
        const body = updateClientMeetingNoteSchema.parse(request.body);
        const meeting = await clientsService.updateMeeting(getClientContext(request), id, meetingId, body);
        return reply.status(200).send(meeting);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    '/clients/:id/meetings/:meetingId',
    { preHandler: [requirePermission('clients.edit')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id, meetingId } = clientMeetingParamsSchema.parse(request.params);
        const result = await clientsService.deleteMeeting(getClientContext(request), id, meetingId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  /* ==========================================================================
     SUB-RECURSO: TIMELINE CONTEXTUAL
     ========================================================================== */

  app.get(
    '/clients/:id/timeline',
    { preHandler: [requirePermission('clients.view')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = clientIdParamSchema.parse(request.params);
        const timeline = await clientsService.getTimeline(getClientContext(request), id);
        return reply.status(200).send(timeline);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
