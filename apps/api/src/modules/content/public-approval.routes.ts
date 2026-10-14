import { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { PublicApprovalDecisionRequestSchema, PublicApprovalViewRequestSchema } from '@zafira/contracts';
import { ContentError } from './content.service.js';
import { PublicLinkUnavailableError, approvalService } from './approval.service.js';

/**
 * F8-2 (DEC-F8-004) - Rotas PUBLICAS da aprovacao do cliente (sem sessao).
 *  - o token vai no CORPO (nunca na URL da API) para nao aparecer em logs de acesso;
 *  - respostas identicas para link invalido, expirado e revogado;
 *  - limite de taxa por origem; cabecalhos no-store, noindex e no-referrer;
 *  - midia por URL curta assinada, sem expor a chave de armazenamento.
 */
export async function publicApprovalRoutes(app: FastifyInstance) {
  await app.register(async (scope) => {
    scope.addHook('onSend', async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Robots-Tag', 'noindex, nofollow');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Content-Type-Options', 'nosniff');
      return payload;
    });

    const fail = (error: unknown, reply: FastifyReply) => {
      if (error instanceof PublicLinkUnavailableError) {
        return reply.status(404).send({ status: 'error', code: 'LINK_UNAVAILABLE', message: 'Este link não está disponível.' });
      }
      if (error instanceof ContentError) {
        return reply.status(error.status).send({ status: 'error', code: error.code, message: error.message, ...error.extra });
      }
      if (error instanceof ZodError) {
        return reply.status(400).send({ status: 'error', code: 'INVALID_REQUEST', message: 'Dados inválidos.' });
      }
      app.log.error({ err: (error as Error)?.message }, '[approval] erro nao tratado');
      return reply.status(500).send({ status: 'error', message: 'Não foi possível concluir a operação.' });
    };

    for (const prefix of ['', '/api']) {
      // CLASSE: PUBLIC_INTENTIONAL
      scope.post(
        `${prefix}/public/approval/view`,
        { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
        async (request, reply) => {
          try {
            const { token } = PublicApprovalViewRequestSchema.parse(request.body ?? {});
            return reply.send(await approvalService.view(token));
          } catch (error) {
            return fail(error, reply);
          }
        }
      );

      // CLASSE: PUBLIC_INTENTIONAL
      scope.post(
        `${prefix}/public/approval/decision`,
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
          try {
            const body = PublicApprovalDecisionRequestSchema.parse(request.body ?? {});
            const out = await approvalService.decide(body.token, body, {
              ip: request.ip ?? '',
              userAgent: String(request.headers['user-agent'] ?? ''),
            });
            return reply.send(out);
          } catch (error) {
            return fail(error, reply);
          }
        }
      );

      // CLASSE: PUBLIC_INTENTIONAL
      scope.get(
        `${prefix}/public/approval/media`,
        { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
        async (request, reply) => {
          try {
            const mediaToken = String((request.query as { t?: string }).t ?? '');
            const f = await approvalService.openMediaStream(mediaToken);
            reply
              .header('Content-Type', f.mimeType)
              .header('Content-Disposition', 'inline')
              .header('Content-Length', f.sizeBytes);

            if (f.cleanup) {
              reply.raw.on('finish', () => { f.cleanup?.().catch(() => {}); });
              reply.raw.on('close', () => { f.cleanup?.().catch(() => {}); });
            }
            return reply.send(f.stream);
          } catch (error) {
            return fail(error, reply);
          }
        }
      );
    }
  });
}
