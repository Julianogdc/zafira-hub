import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { CALENDAR_EVENT_CATEGORIES, type PermissionCode, type RoleType } from '@zafira/domain';
import { authenticate, requirePermission } from '../../../middleware/auth.js';
import { resolveAuthorizationContext } from '../../authorization/resolver.js';
import { CalendarContext, CalendarError, googleCalendarService as service } from './google-calendar.service.js';

/**
 * F7-3a - Rotas da agenda Google (SOMENTE LEITURA). Prefixos "" e "/api".
 * Cada rota: sessao + permissao + organizacao da sessao; carteira e mascaramento no servico.
 * Nenhuma rota escreve no Google.
 */

type Authz = { organizationId?: string; membershipId?: string; role?: RoleType };

const Category = z.enum(CALENDAR_EVENT_CATEGORIES as unknown as [string, ...string[]]);

const SettingsBody = z.object({
  windowPastDays: z.number().int().min(1).max(365).optional(),
  windowFutureDays: z.number().int().min(1).max(365).optional(),
});
const SourceBody = z.object({ isMonitored: z.boolean().optional(), defaultCategory: Category.nullable().optional() });
const SyncBody = z.object({ forceFull: z.boolean().optional() });
const IdentityBody = z.object({ memberId: z.string().min(1), email: z.string().min(3).max(254) });
const LinkBody = z.object({
  scope: z.enum(['EVENT', 'SERIES']).default('EVENT'),
  clientId: z.string().min(1).nullable().optional(),
  asanaProjectGid: z.string().min(1).max(128).nullable().optional(),
  category: Category.default('OTHER'),
  notes: z.string().max(2000).nullable().optional(),
});

function contextOf(request: FastifyRequest, reply: FastifyReply): CalendarContext | null {
  const authz = (request as any).authorizationResult as Authz | undefined;
  const userId = request.authContext?.type === 'user' ? request.authContext.userId : undefined;
  if (!authz?.organizationId || !authz.membershipId || !authz.role || !userId) {
    reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organizacao valido.' });
    return null;
  }
  return { organizationId: authz.organizationId, userId, membershipId: authz.membershipId, role: authz.role };
}

export async function googleCalendarRoutes(app: FastifyInstance) {
  const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    permission: PermissionCode,
    handler: (ctx: CalendarContext, request: FastifyRequest) => Promise<unknown>,
    successStatus = 200
  ) => {
    for (const prefix of ['', '/api']) {
      // CLASSE: HUMAN_AUTHENTICATED
      app.route({
        method,
        url: `${prefix}${path}`,
        preHandler: [authenticate, requirePermission(permission)],
        handler: async (request, reply) => {
          const ctx = contextOf(request, reply);
          if (!ctx) return reply;
          try {
            return reply.status(successStatus).send(await handler(ctx, request));
          } catch (error) {
            if (error instanceof CalendarError) {
              return reply.status(error.status).send({ status: 'error', code: error.code, message: error.message });
            }
            if (error instanceof ZodError) {
              return reply.status(400).send({ status: 'error', code: 'INVALID_REQUEST', message: error.issues[0]?.message || 'Dados invalidos.' });
            }
            app.log.error(error);
            return reply.status(500).send({ status: 'error', message: 'Nao foi possivel concluir a operacao da agenda.' });
          }
        },
      });
    }
  };

  const params = (r: FastifyRequest) => r.params as Record<string, string>;
  const query = (r: FastifyRequest) => r.query as Record<string, string | undefined>;
  const body = <S extends z.ZodTypeAny>(schema: S, r: FastifyRequest): z.infer<S> => schema.parse(r.body ?? {});
  const hasViewAll = async (ctx: CalendarContext) =>
    Boolean((await resolveAuthorizationContext({ userId: ctx.userId, activeOrganizationId: ctx.organizationId, permissionCode: 'calendar.view_all' })).allowed);
  const parseDate = (v?: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new CalendarError(400, 'INVALID_DATE', 'Data invalida.');
    return d;
  };

  // ---- conexao e calendarios (administracao)
  route('GET', '/calendar/connection', 'calendar.manage_connections', (ctx) => service.connectionStatus(ctx));
  route('POST', '/calendar/connection/authorize', 'calendar.manage_connections', (ctx) => service.authorizeUrl(ctx));
  route('DELETE', '/calendar/connection', 'calendar.manage_connections', (ctx) => service.disconnect(ctx));
  route('PATCH', '/calendar/settings', 'calendar.manage_connections', (ctx, r) => service.updateSettings(ctx, body(SettingsBody, r)));
  route('GET', '/calendar/sources', 'calendar.manage_connections', (ctx) => service.listSources(ctx));
  route('POST', '/calendar/sources/discover', 'calendar.manage_connections', (ctx) => service.discover(ctx));
  route('PATCH', '/calendar/sources/:id', 'calendar.manage_connections', (ctx, r) =>
    service.updateSource(ctx, params(r).id, body(SourceBody, r) as never)
  );
  route('POST', '/calendar/sync', 'calendar.manage_connections', (ctx, r) => service.syncOrganization(ctx.organizationId, body(SyncBody, r)));

  // ---- identidades (associacao explicita membro <-> identidade Google, so HMAC)
  route('GET', '/calendar/identities', 'calendar.manage_connections', (ctx) => service.listIdentities(ctx));
  route('PUT', '/calendar/identities', 'calendar.manage_connections', (ctx, r) => service.setIdentity(ctx, body(IdentityBody, r)));
  route('DELETE', '/calendar/identities/:id', 'calendar.manage_connections', (ctx, r) => service.removeIdentity(ctx, params(r).id));

  // ---- agenda (leitura com acesso decidido no servidor)
  route('GET', '/calendar/status', 'calendar.view', (ctx) => service.agendaStatus(ctx));
  route('GET', '/calendar/events', 'calendar.view', async (ctx, r) => {
    const q = query(r);
    return service.listEvents(ctx, { from: parseDate(q.from), to: parseDate(q.to), clientId: q.clientId, hasViewAll: await hasViewAll(ctx) });
  });
  route('PUT', '/calendar/events/:id/link', 'calendar.link', async (ctx, r) =>
    service.setLink(ctx, params(r).id, body(LinkBody, r) as never, await hasViewAll(ctx))
  );
  route('DELETE', '/calendar/events/:id/link', 'calendar.link', async (ctx, r) =>
    service.removeLink(ctx, params(r).id, query(r).scope === 'SERIES' ? 'SERIES' : 'EVENT', await hasViewAll(ctx))
  );

  // ---- retorno do OAuth (publico; protegido por state assinado, de uso unico)
  for (const prefix of ['', '/api']) {
    // CLASSE: PUBLIC_INTENTIONAL
    app.get(`${prefix}/calendar/oauth/callback`, async (request, reply) => {
      const q = request.query as { code?: string; state?: string; error?: string };
      const target = process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT || '/';
      if (q.error || !q.code || !q.state) {
        return reply.redirect(`${target}${target.includes('?') ? '&' : '?'}calendar=denied`);
      }
      try {
        await service.handleCallback(q.code, q.state);
        return reply.redirect(`${target}${target.includes('?') ? '&' : '?'}calendar=connected`);
      } catch (error) {
        if (!(error instanceof CalendarError)) app.log.error(error);
        return reply.redirect(`${target}${target.includes('?') ? '&' : '?'}calendar=error`);
      }
    });
  }
}
