import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requirePermission } from '../../../middleware/auth.js';
import { IntegrationProvider, SyncRunStatus } from '@prisma/client';
import {
  IntegrationRegistryService,
  integrationRegistryService as defaultRegistry,
  IntegrationRegistryError,
} from './integration-registry.service.js';
import {
  IntegrationObservabilityService,
  integrationObservabilityService as defaultObservability,
} from './integration-observability.service.js';
import {
  IntegrationConnectionService,
  IntegrationConnectionError,
} from '../connections/integration-connection.service.js';

const providerParamSchema = z.object({
  provider: z.nativeEnum(IntegrationProvider),
});

const syncRunQuerySchema = z.object({
  clientId: z.string().optional(),
  connectionId: z.string().optional(),
  provider: z.nativeEnum(IntegrationProvider).optional(),
  status: z.nativeEnum(SyncRunStatus).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const errorQuerySchema = z.object({
  clientId: z.string().optional(),
  connectionId: z.string().optional(),
  provider: z.nativeEnum(IntegrationProvider).optional(),
  resolved: z
    .string()
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

export async function commonIntegrationsRoutes(
  app: FastifyInstance,
  options?: {
    registry?: IntegrationRegistryService;
    observability?: IntegrationObservabilityService;
    connectionService?: IntegrationConnectionService;
  }
) {
  const registry = options?.registry || defaultRegistry;
  const observability = options?.observability || defaultObservability;
  const connectionService = options?.connectionService || new IntegrationConnectionService();

  function handleError(error: unknown, reply: FastifyReply) {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        status: 'error',
        message: 'Dados inválidos na requisição',
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof IntegrationRegistryError || error instanceof IntegrationConnectionError) {
      return reply.status(error.statusCode).send({
        status: 'error',
        code: error.code,
        message: error.message,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      status: 'error',
      message: 'Ocorreu um erro interno no servidor ao processar a central de integrações.',
    });
  }

  function getOrganizationId(request: FastifyRequest): string {
    const auth = request.authContext;
    if (!auth) {
      throw new IntegrationRegistryError('Não autenticado.', 401, 'UNAUTHORIZED');
    }

    if (auth.type === 'user' && auth.memberships.length > 0) {
      const org = auth.memberships.find((m) => m.organizationSlug === 'zafira') || auth.memberships[0];
      return org.organizationId;
    }

    throw new IntegrationRegistryError('Acesso requer contexto de organização.', 403, 'ORGANIZATION_CONTEXT_REQUIRED');
  }

  // 1. GET /api/v1/integrations/overview
  app.get(
    '/api/v1/integrations/overview',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const overview = await registry.getIntegrationOverview(organizationId);
        return reply.status(200).send({ status: 'ok', data: overview });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 2. GET /api/v1/integrations/connections
  app.get(
    '/api/v1/integrations/connections',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const connections = await connectionService.listConnections(organizationId);
        return reply.status(200).send({ status: 'ok', data: connections });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 3. POST /api/v1/integrations/:provider/test
  app.post(
    '/api/v1/integrations/:provider/test',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const { provider } = providerParamSchema.parse(request.params);
        const body = (request.body as any) || {};

        const result = await registry.testConnection(organizationId, provider, body.connectionId);
        return reply.status(200).send({ status: 'ok', data: result });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 4. POST /api/v1/integrations/:provider/sync
  app.post(
    '/api/v1/integrations/:provider/sync',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const { provider } = providerParamSchema.parse(request.params);
        const body = (request.body as any) || {};

        const result = await registry.triggerSync(organizationId, provider, body.connectionId, body.options);
        return reply.status(200).send({ status: 'ok', data: result });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 4.1 POST /api/v1/integrations/:provider/reconnect
  app.post(
    '/api/v1/integrations/:provider/reconnect',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const { provider } = providerParamSchema.parse(request.params);
        const body = (request.body as any) || {};

        const auth = request.authContext;
        const userId = auth?.type === 'user' ? auth.userId : null;

        const result = await registry.reconnect(organizationId, provider, body.connectionId, userId, body);
        return reply.status(200).send({ status: 'ok', data: result });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 5. POST /api/v1/integrations/:provider/disconnect
  app.post(
    '/api/v1/integrations/:provider/disconnect',
    {
      preHandler: [authenticate, requirePermission('integrations.remove')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const { provider } = providerParamSchema.parse(request.params);
        const body = (request.body as any) || {};

        const result = await registry.disconnect(organizationId, provider, body.connectionId);
        return reply.status(200).send({ status: 'ok', data: result });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 6. GET /api/v1/integrations/sync-runs
  app.get(
    '/api/v1/integrations/sync-runs',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const query = syncRunQuerySchema.parse(request.query);
        const syncRuns = await observability.listSyncRuns(organizationId, query);
        return reply.status(200).send({ status: 'ok', data: syncRuns });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 7. GET /api/v1/integrations/errors
  app.get(
    '/api/v1/integrations/errors',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const query = errorQuerySchema.parse(request.query);
        const errors = await observability.listErrors(organizationId, query);
        return reply.status(200).send({ status: 'ok', data: errors });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 8. PATCH /api/v1/integrations/errors/:errorId/resolve
  app.patch(
    '/api/v1/integrations/errors/:errorId/resolve',
    {
      preHandler: [authenticate, requirePermission('integrations.remove')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const { errorId } = (request.params as any) || {};
        const resolved = await observability.resolveError(organizationId, errorId);
        return reply.status(200).send({ status: 'ok', data: resolved });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
