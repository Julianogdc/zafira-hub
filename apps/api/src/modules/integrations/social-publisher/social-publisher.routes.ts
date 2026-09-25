import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requirePermission } from '../../../middleware/auth.js';
import {
  SocialPublisherService,
  SocialPublisherServiceError,
} from './social-publisher.service.js';

const linkAccountSchema = z.object({
  accountId: z.string().min(1, 'accountId da conta social é obrigatório'),
});

const createPostSchema = z.object({
  accountId: z.string().min(1, 'accountId é obrigatório'),
  format: z.enum(['FEED', 'REEL', 'STORY_IMAGE', 'STORY_VIDEO', 'CAROUSEL']),
  content: z.string().default(''),
  mediaIds: z.array(z.string()).default([]),
  isDraft: z.boolean().optional(),
  scheduledAt: z.string().nullable().optional(),
});

const schedulePostSchema = z.object({
  scheduledAt: z.string().min(1, 'scheduledAt é obrigatório'),
});

export function createSocialPublisherRoutes(service: SocialPublisherService) {
  return async function socialPublisherRoutes(app: FastifyInstance) {
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

      if (error instanceof SocialPublisherServiceError) {
        return reply.status(error.statusCode).send({
          status: 'error',
          error: error.code,
          message: error.message,
        });
      }

      app.log.error({ err: error }, 'Erro inesperado nas rotas do SocialPublisher');

      return reply.status(500).send({
        status: 'error',
        error: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro inesperado no serviço de publicação social.',
      });
    };

    function getOrganizationId(request: FastifyRequest): string {
      const authResultOrg = (request as any).authorizationResult?.organizationId;
      if (typeof authResultOrg === 'string' && authResultOrg.trim()) {
        return authResultOrg.trim();
      }

      throw new SocialPublisherServiceError(
        'ORGANIZATION_CONTEXT_REQUIRED',
        'Contexto de organização ativo é obrigatório para acessar este recurso.',
        400
      );
    }

    function requireIdempotencyKey(request: FastifyRequest): string {
      const key = request.headers['idempotency-key'];
      if (!key || typeof key !== 'string' || !key.trim()) {
        throw new SocialPublisherServiceError(
          'IDEMPOTENCY_KEY_REQUIRED',
          'Header Idempotency-Key é obrigatório para esta operação.',
          400
        );
      }
      return key.trim();
    }

    // =========================================================================
    // ROTAS GLOBAIS DE SOCIAL PUBLISHER (/api/v1/social/*)
    // =========================================================================

    // 1. GET /api/v1/social/status
    app.get(
      '/api/v1/social/status',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const result = await service.getStatus(organizationId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 2. GET /api/v1/social/accounts/available
    app.get(
      '/api/v1/social/accounts/available',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const result = await service.getAvailableAccounts(organizationId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 3. GET /api/v1/social/content (Agenda agregada da organização)
    app.get(
      '/api/v1/social/content',
      { preHandler: [authenticate, requirePermission('content.review')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const query = request.query as any;
          const result = await service.getAggregatedContent(organizationId, {
            startDate: query.startDate,
            endDate: query.endDate,
            clientId: query.clientId,
            accountId: query.accountId,
            status: query.status,
            format: query.format,
            search: query.search,
            limit: query.limit ? parseInt(query.limit, 10) : undefined,
            offset: query.offset ? parseInt(query.offset, 10) : undefined,
          });
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 4. POST /api/v1/social/upload (Upload de mídia com Idempotency-Key obrigatória)
    app.post(
      '/api/v1/social/upload',
      { preHandler: [authenticate, requirePermission('content.create')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const idempotencyKey = requireIdempotencyKey(request);

          const fileData = await request.file();
          if (!fileData) {
            return reply.status(400).send({
              status: 'error',
              error: 'FILE_REQUIRED',
              message: 'Nenhum arquivo enviado para upload.',
            });
          }

          const buffer = await fileData.toBuffer();
          const result = await service.uploadMedia(organizationId, {
            buffer,
            filename: fileData.filename,
            mimeType: fileData.mimetype,
            idempotencyKey,
          });

          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // =========================================================================
    // ROTAS DE CLIENTE (/api/v1/clients/:clientId/social/*)
    // =========================================================================

    // 5. GET /api/v1/clients/:clientId/social/accounts
    app.get(
      '/api/v1/clients/:clientId/social/accounts',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId } = request.params as { clientId: string };
          const result = await service.getClientAccounts(organizationId, clientId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 6. GET /api/v1/clients/:clientId/social/accounts/available
    app.get(
      '/api/v1/clients/:clientId/social/accounts/available',
      { preHandler: [authenticate, requirePermission('integrations.view')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const result = await service.getAvailableAccounts(organizationId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 7. POST /api/v1/clients/:clientId/social/accounts (Vincular conta)
    app.post(
      '/api/v1/clients/:clientId/social/accounts',
      { preHandler: [authenticate, requirePermission('integrations.connect')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId } = request.params as { clientId: string };
          const body = linkAccountSchema.parse(request.body);
          const result = await service.linkAccountToClient(organizationId, clientId, body.accountId);
          return reply.status(201).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 8. DELETE /api/v1/clients/:clientId/social/accounts/:accountId (Desvincular conta)
    app.delete(
      '/api/v1/clients/:clientId/social/accounts/:accountId',
      { preHandler: [authenticate, requirePermission('integrations.remove')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId, accountId } = request.params as { clientId: string; accountId: string };
          const result = await service.unlinkAccountFromClient(organizationId, clientId, accountId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 9. GET /api/v1/clients/:clientId/social/content (Publicações do cliente)
    app.get(
      '/api/v1/clients/:clientId/social/content',
      { preHandler: [authenticate, requirePermission('content.review')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId } = request.params as { clientId: string };
          const query = request.query as any;
          const result = await service.getClientPosts(organizationId, clientId, {
            status: query.status,
            limit: query.limit ? parseInt(query.limit, 10) : undefined,
            offset: query.offset ? parseInt(query.offset, 10) : undefined,
          });
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 10. GET /api/v1/clients/:clientId/social/content/:postId
    app.get(
      '/api/v1/clients/:clientId/social/content/:postId',
      { preHandler: [authenticate, requirePermission('content.review')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId, postId } = request.params as { clientId: string; postId: string };
          const result = await service.getClientPost(organizationId, clientId, postId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 11. POST /api/v1/clients/:clientId/social/content (Criar publicação com Idempotency-Key obrigatória)
    app.post(
      '/api/v1/clients/:clientId/social/content',
      { preHandler: [authenticate, requirePermission('content.create')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const idempotencyKey = requireIdempotencyKey(request);
          const { clientId } = request.params as { clientId: string };
          const body = createPostSchema.parse(request.body);

          const result = await service.createPost(organizationId, clientId, {
            accountId: body.accountId,
            format: body.format,
            content: body.content,
            mediaIds: body.mediaIds,
            isDraft: body.isDraft,
            scheduledAt: body.scheduledAt ?? null,
            idempotencyKey,
          });

          return reply.status(201).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 12. PATCH /api/v1/clients/:clientId/social/content/:postId/schedule
    app.patch(
      '/api/v1/clients/:clientId/social/content/:postId/schedule',
      { preHandler: [authenticate, requirePermission('content.schedule')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId, postId } = request.params as { clientId: string; postId: string };
          const body = schedulePostSchema.parse(request.body);
          const result = await service.schedulePost(organizationId, clientId, {
            postId,
            scheduledAt: body.scheduledAt,
          });
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 13. POST /api/v1/clients/:clientId/social/content/:postId/cancel
    app.post(
      '/api/v1/clients/:clientId/social/content/:postId/cancel',
      { preHandler: [authenticate, requirePermission('content.delete')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId, postId } = request.params as { clientId: string; postId: string };
          const result = await service.cancelPost(organizationId, clientId, postId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 14. GET /api/v1/clients/:clientId/social/content/:postId/analytics
    app.get(
      '/api/v1/clients/:clientId/social/content/:postId/analytics',
      { preHandler: [authenticate, requirePermission('content.review')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId, postId } = request.params as { clientId: string; postId: string };
          const result = await service.getPostAnalytics(organizationId, clientId, postId);
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );

    // 15. GET /api/v1/clients/:clientId/social/accounts/:accountId/analytics
    app.get(
      '/api/v1/clients/:clientId/social/accounts/:accountId/analytics',
      { preHandler: [authenticate, requirePermission('content.review')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const organizationId = getOrganizationId(request);
          const { clientId, accountId } = request.params as { clientId: string; accountId: string };
          const query = request.query as any;
          const result = await service.getAccountAnalytics(organizationId, clientId, accountId, {
            startDate: query.startDate,
            endDate: query.endDate,
          });
          return reply.status(200).send(result);
        } catch (error) {
          return handleError(error, reply);
        }
      }
    );
  };
}
