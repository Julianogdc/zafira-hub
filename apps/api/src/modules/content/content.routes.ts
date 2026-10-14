import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  CreateApprovalLinkRequestSchema,
  ContentStagesQuerySchema,
  CreateContentItemRequestSchema,
  RequestPublicationSchema,
  ReschedulePublicationSchema,
  RevokeApprovalLinkRequestSchema,
  UpdateContentItemRequestSchema,
} from '@zafira/contracts';
import type { PermissionCode, RoleType } from '@zafira/domain';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { ContentContext, ContentError, contentService as service } from './content.service.js';
import { approvalService } from './approval.service.js';
import { contentStagesService } from './content-stages.service.js';
import { publicationService } from './publication/publication.service.js';

/**
 * F8-1 (DEC-F8-003) - Rotas de conteudo. Prefixos "" e "/api".
 * Cada rota: sessao + permissao + organizacao da sessao + carteira do cliente (no servico).
 * Nenhuma rota fala com o BrightBean ou com o Asana; nenhuma rota apaga conteudo.
 */

type Authz = { organizationId?: string; membershipId?: string; role?: RoleType };

function contextOf(request: FastifyRequest, reply: FastifyReply): ContentContext | null {
  const authz = (request as any).authorizationResult as Authz | undefined;
  const userId = request.authContext?.type === 'user' ? request.authContext.userId : undefined;
  if (!authz?.organizationId || !authz.membershipId || !authz.role || !userId) {
    reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organizacao valido.' });
    return null;
  }
  return { organizationId: authz.organizationId, userId, membershipId: authz.membershipId, role: authz.role };
}

export async function contentRoutes(app: FastifyInstance) {
  const fail = (error: unknown, reply: FastifyReply) => {
    if (error instanceof ContentError) {
      return reply.status(error.status).send({ status: 'error', code: error.code, message: error.message, ...error.extra });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ status: 'error', code: 'INVALID_REQUEST', message: error.issues[0]?.message || 'Dados invalidos.' });
    }
    app.log.error(error);
    return reply.status(500).send({ status: 'error', message: 'Nao foi possivel concluir a operacao de conteudo.' });
  };

  const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    permission: PermissionCode | PermissionCode[],
    handler: (ctx: ContentContext, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
    successStatus = 200
  ) => {
    for (const prefix of ['', '/api']) {
      // CLASSE: HUMAN_AUTHENTICATED
      app.route({
        method,
        url: `${prefix}${path}`,
        // varias permissoes = todas exigidas (negacao por padrao)
        preHandler: [authenticate, ...(Array.isArray(permission) ? permission : [permission]).map((p) => requirePermission(p))],
        handler: async (request, reply) => {
          const ctx = contextOf(request, reply);
          if (!ctx) return reply;
          try {
            const out = await handler(ctx, request, reply);
            if (reply.sent) return reply;
            return reply.status(successStatus).send(out);
          } catch (error) {
            return fail(error, reply);
          }
        },
      });
    }
  };

  const params = (r: FastifyRequest) => r.params as Record<string, string>;
  const query = (r: FastifyRequest) => r.query as Record<string, string | undefined>;

  route('GET', '/content/items', 'content.view', async (ctx, r) => {
    const items = await service.list(ctx, { clientId: query(r).clientId });
    const status = await approvalService.statusMap(ctx, items.map((i) => i.id));
    return items.map((i) => ({ ...i, approvalStatus: status.get(i.id) ?? 'NOT_SENT' }));
  });
  route('POST', '/content/items', 'content.create', (ctx, r) => service.create(ctx, CreateContentItemRequestSchema.parse(r.body ?? {})), 201);
  route('GET', '/content/items/:id', 'content.view', (ctx, r) => service.get(ctx, params(r).id));
  route('PATCH', '/content/items/:id', 'content.create', (ctx, r) =>
    service.update(ctx, params(r).id, UpdateContentItemRequestSchema.parse(r.body ?? {}))
  );
  route('POST', '/content/items/:id/versions', 'content.create', (ctx, r) => service.newVersion(ctx, params(r).id), 201);
  route('POST', '/content/items/:id/media', 'content.create', async (ctx, r) => {
    const file = await (r as any).file();
    if (!file) throw new ContentError(400, 'FILE_REQUIRED', 'Nenhum arquivo enviado.');
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.');
    }
    if (file.file?.truncated) throw new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.');
    return service.uploadMedia(ctx, params(r).id, { buffer, filename: String(file.filename || 'arquivo') }, {
      replaceMediaId: query(r).replace,
    });
  }, 201);
  route('DELETE', '/content/items/:id/media/:mediaId', 'content.create', (ctx, r) =>
    service.removeMedia(ctx, params(r).id, params(r).mediaId)
  );
  // F8-2: aprovacao do cliente por link (envio, acompanhamento, revogacao/reemissao)
  route('GET', '/content/items/:id/approval', 'content.view', (ctx, r) => approvalService.status(ctx, params(r).id));
  route('POST', '/content/items/:id/approval-links', 'content.send_to_client', (ctx, r) =>
    approvalService.createLink(ctx, params(r).id, CreateApprovalLinkRequestSchema.parse(r.body ?? {})), 201);
  route('POST', '/content/items/:id/approval-links/:linkId/revoke', 'content.send_to_client', (ctx, r) =>
    approvalService.revokeLink(ctx, params(r).id, params(r).linkId, RevokeApprovalLinkRequestSchema.parse(r.body ?? {}).reason));
  // F8-4a: agendamento pela versao aprovada (piloto Instagram). So grava publicacao + caixa de saida;
  // o despachante (desligado por padrao) e quem fala com o provedor.
  route('GET', '/content/items/:id/publications', 'content.view', (ctx, r) => publicationService.list(ctx, params(r).id));
  route('GET', '/content/items/:id/publication-targets', 'content.view', (ctx, r) => publicationService.targets(ctx, params(r).id));
  route('GET', '/content/publication-settings', 'content.view', async () => publicationService.settings());
  route('POST', '/content/items/:id/publications', 'content.schedule', (ctx, r) =>
    publicationService.request(ctx, params(r).id, RequestPublicationSchema.parse(r.body ?? {})), 201);
  route('POST', '/content/publications/:publicationId/reschedule', 'content.schedule', (ctx, r) =>
    publicationService.reschedule(ctx, params(r).publicationId, ReschedulePublicationSchema.parse(r.body ?? {})));
  route('POST', '/content/publications/:publicationId/cancel', 'content.schedule', (ctx, r) =>
    publicationService.cancel(ctx, params(r).publicationId));
  // F8-3: contador de Entregas por estagio (somente leitura; exige ver Entregas E ver Conteudos)
  route('GET', '/clients/:id/deliverables/content-stages', ['deliverables.view', 'content.view'], (ctx, r) =>
    contentStagesService.forClientPeriod(ctx, params(r).id, ContentStagesQuerySchema.parse(query(r)).period));
  // Arquivo servido pela API (autorizado por sessao/carteira); nunca URL publica do storage
  route('GET', '/content/items/:id/media/:mediaId/file', 'content.view', async (ctx, r, reply) => {
    const f = await service.readFile(ctx, params(r).id, params(r).mediaId);
    reply
      .header('Content-Type', f.mimeType)
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(f.data);
  });
}
