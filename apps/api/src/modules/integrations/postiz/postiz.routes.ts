import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requirePermission } from '../../../middleware/auth.js';
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

      if ((error as any)?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.status(413).send({
          status: 'error',
          error: 'FILE_TOO_LARGE',
          message: 'O arquivo excede o limite máximo permitido de upload (100MB).',
        });
      }

      if (error instanceof PostizIntegrationError) {
        return reply.status(error.statusCode).send({
          status: 'error',
          error: error.code,
          message: sanitizeMessage(error.message),
        });
      }

      // Log seguro no servidor sem expor dados sensíveis ao cliente
      app.log.error({ err: error }, 'Erro inesperado na rota Postiz');

      return reply.status(500).send({
        status: 'error',
        error: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro inesperado na integração com Postiz.',
      });
    };

    function extractClientId(params: ClientParams): string {
      return (params.clientId || params.id || '').trim();
    }

    function getOrganizationId(request: FastifyRequest): string | undefined {
      const auth = request.authContext;
      if (!auth) return undefined;

      if (auth.type === 'user' && auth.memberships && auth.memberships.length > 0) {
        const org = auth.memberships.find((m) => m.organizationSlug === 'zafira') || auth.memberships[0];
        return org?.organizationId;
      }

      const headerOrg = request.headers['x-organization-id'];
      if (typeof headerOrg === 'string' && headerOrg.trim()) {
        return headerOrg.trim();
      }

      return undefined;
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

    // CLASSE: HUMAN_AUTHENTICATED
    app.get('/integrations/postiz/status', { preHandler: [authenticate, requirePermission('integrations.view')] }, getStatusHandler);
    // CLASSE: HUMAN_AUTHENTICATED
    app.get('/api/integrations/postiz/status', { preHandler: [authenticate, requirePermission('integrations.view')] }, getStatusHandler);

    // 2. GET /integrations/postiz/accounts
    const getAccountsHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getAccounts();
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get('/integrations/postiz/accounts', { preHandler: [authenticate, requirePermission('integrations.view')] }, getAccountsHandler);
    // CLASSE: HUMAN_AUTHENTICATED
    app.get('/api/integrations/postiz/accounts', { preHandler: [authenticate, requirePermission('integrations.view')] }, getAccountsHandler);

    // 2b. GET /integrations/postiz/available-accounts (Contas disponíveis e status de vínculo na organização)
    const getOrgAvailableAccountsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const result = await service.getAvailableAccounts(organizationId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/integrations/postiz/available-accounts',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getOrgAvailableAccountsHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/integrations/postiz/available-accounts',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getOrgAvailableAccountsHandler
    );

    // =========================================================================
    // ROTAS DE ASSOCIAÇÃO CLIENTE 360 ↔ CONTAS POSTIZ
    // =========================================================================

    // 3. GET /clients/:clientId/integrations/postiz (Consultar contas vinculadas)
    const getClientAccountsHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);
        const result = await service.getClientAccounts(clientId, organizationId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getClientAccountsHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getClientAccountsHandler
    );

    // 3b. GET /clients/:clientId/integrations/postiz/available (Contas disponíveis para este cliente)
    const getClientAvailableAccountsHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);
        const result = await service.getAvailableAccounts(organizationId, clientId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/clients/:clientId/integrations/postiz/available',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getClientAvailableAccountsHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/clients/:clientId/integrations/postiz/available',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      getClientAvailableAccountsHandler
    );

    // 4. POST /clients/:clientId/integrations/postiz (Vincular conta Postiz)
    const linkAccountHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);
        const body = linkAccountSchema.parse(request.body);
        const account = await service.linkAccountToClient(clientId, body.externalId, organizationId);

        return reply.status(201).send({
          status: 'ok',
          message: 'Conta Postiz vinculada ao cliente com sucesso.',
          account,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate, requirePermission('integrations.connect')] },
      linkAccountHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/api/clients/:clientId/integrations/postiz',
      { preHandler: [authenticate, requirePermission('integrations.connect')] },
      linkAccountHandler
    );

    // 5. DELETE /clients/:clientId/integrations/postiz/:externalId (Remover vínculo)
    const unlinkAccountHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);
        const externalId = (request.params.externalId || '').trim();

        const result = await service.unlinkAccountFromClient(clientId, externalId, organizationId);

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

    // CLASSE: HUMAN_AUTHENTICATED
    app.delete(
      '/clients/:clientId/integrations/postiz/:externalId',
      { preHandler: [authenticate, requirePermission('integrations.remove')] },
      unlinkAccountHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.delete(
      '/api/clients/:clientId/integrations/postiz/:externalId',
      { preHandler: [authenticate, requirePermission('integrations.remove')] },
      unlinkAccountHandler
    );

    // 6. GET /clients/:clientId/content/postiz (Buscar publicações do Postiz vinculadas ao cliente)
    const getClientContentHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const clientId = extractClientId(request.params);
        const organizationId = getOrganizationId(request);
        const { startDate, endDate } = request.query || {};

        const result = await service.getClientPosts(clientId, { startDate, endDate }, organizationId);

        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/clients/:clientId/content/postiz',
      { preHandler: [authenticate, requirePermission('content.review')] },
      getClientContentHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/clients/:clientId/content/postiz',
      { preHandler: [authenticate, requirePermission('content.review')] },
      getClientContentHandler
    );

    // 7. GET /clients/:clientId/content/postiz/:postId (Buscar publicação específica do cliente)
    const getClientPostByIdHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const params = request.params as any;
        const clientId = extractClientId(params);
        const postId = (params.postId || '').trim();
        const organizationId = getOrganizationId(request);

        const result = await service.getClientPostById(clientId, postId, organizationId);
        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/clients/:clientId/content/postiz/:postId',
      { preHandler: [authenticate, requirePermission('content.review')] },
      getClientPostByIdHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/clients/:clientId/content/postiz/:postId',
      { preHandler: [authenticate, requirePermission('content.review')] },
      getClientPostByIdHandler
    );

    // =========================================================================
    // 7b. PATCH /clients/:clientId/content/postiz/:postId/schedule (Reagendar publicação / Agendar rascunho)
    // =========================================================================
    const reschedulePostSchema = z.object({
      scheduledAt: z.string().min(1, 'scheduledAt é obrigatório'),
    });

    const reschedulePostHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const params = request.params as any;
        const clientId = extractClientId(params);
        const postId = (params.postId || '').trim();
        const organizationId = getOrganizationId(request);
        const body = reschedulePostSchema.parse(request.body);

        const result = await service.rescheduleClientPost(
          clientId,
          postId,
          body.scheduledAt,
          organizationId
        );
        return reply.status(200).send({
          status: 'ok',
          message: 'Agendamento atualizado com sucesso.',
          post: result.post,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.patch(
      '/clients/:clientId/content/postiz/:postId/schedule',
      { preHandler: [authenticate, requirePermission('content.schedule')] },
      reschedulePostHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.patch(
      '/api/clients/:clientId/content/postiz/:postId/schedule',
      { preHandler: [authenticate, requirePermission('content.schedule')] },
      reschedulePostHandler
    );

    // =========================================================================
    // ROTA AGREGADA OPERACIONAL: CONTEÚDOS & AGENDA (ADMIN & MANAGER)
    // =========================================================================
    // 8. GET /integrations/postiz/content (Visão consolidada de conteúdos da organização)
    const getAggregatedContentHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const organizationId = getOrganizationId(request);
        const q = (request.query || {}) as any;

        const page = q.page ? parseInt(q.page, 10) : 1;
        const limit = q.limit !== undefined ? parseInt(q.limit, 10) : 0;
        const forceRefresh = q.forceRefresh === 'true' || q.forceRefresh === '1';

        const result = await service.getAggregatedContent({
          organizationId,
          startDate: q.startDate,
          endDate: q.endDate,
          clientId: q.clientId,
          integrationId: q.integrationId,
          status: q.status,
          format: q.format,
          search: q.search,
          page: isNaN(page) ? 1 : page,
          limit: isNaN(limit) ? 0 : limit,
          forceRefresh,
        });

        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/integrations/postiz/content',
      { preHandler: [authenticate, requirePermission('content.review')] },
      getAggregatedContentHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.get(
      '/api/integrations/postiz/content',
      { preHandler: [authenticate, requirePermission('content.review')] },
      getAggregatedContentHandler
    );

    // =========================================================================
    // 9. POST /integrations/postiz/upload (Upload de mídia seguro)
    // =========================================================================
    const uploadHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const fileData = await request.file();
        if (!fileData) {
          return reply.status(400).send({
            status: 'error',
            error: 'FILE_REQUIRED',
            message: 'Nenhum arquivo enviado para upload.',
          });
        }

        const buffer = await fileData.toBuffer();
        const result = await service.uploadMedia({
          buffer,
          filename: fileData.filename,
          mimetype: fileData.mimetype,
        });

        return reply.status(200).send(result);
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/integrations/postiz/upload',
      { preHandler: [authenticate, requirePermission('content.create')] },
      uploadHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/api/integrations/postiz/upload',
      { preHandler: [authenticate, requirePermission('content.create')] },
      uploadHandler
    );

    // =========================================================================
    // 10. POST /clients/:clientId/content/postiz (Criar ou agendar publicação)
    // =========================================================================
    const createPostSchema = z.object({
      integrationId: z.string().min(1, 'integrationId é obrigatório'),
      format: z.enum(['FEED', 'REEL', 'STORY_IMAGE', 'STORY_VIDEO', 'CAROUSEL']),
      content: z.string().optional(),
      mediaItems: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
        })
      ).min(1, 'Pelo menos uma mídia é necessária'),
      isDraft: z.boolean().optional(),
      scheduledDate: z.string().optional(),
    });

    const createPostHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const params = request.params as any;
        const clientId = extractClientId(params);
        const organizationId = getOrganizationId(request);
        const body = createPostSchema.parse(request.body);

        const result = await service.createClientPost(clientId, body, organizationId);
        return reply.status(201).send({
          status: 'ok',
          message: body.isDraft ? 'Rascunho salvo com sucesso.' : 'Publicação agendada com sucesso.',
          post: result.post,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    };

    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/clients/:clientId/content/postiz',
      { preHandler: [authenticate, requirePermission('content.create')] },
      createPostHandler
    );
    // CLASSE: HUMAN_AUTHENTICATED
    app.post(
      '/api/clients/:clientId/content/postiz',
      { preHandler: [authenticate, requirePermission('content.create')] },
      createPostHandler
    );
  };
}

export const postizRoutes = createPostizRoutes();



