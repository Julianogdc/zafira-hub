import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PermissionCode, RoleType } from '@zafira/domain';
import { authenticate, requirePermission } from '../../../../middleware/auth.js';
import { prisma } from '../../../../lib/prisma.js';
import { findClientInResourceScope } from '../../../authorization/client-resource-scope.js';
import { asanaMirrorService } from './asana-mirror.service.js';

/**
 * F6-IMP.8 — Histórico do Asana por cliente (DEC-F6-003).
 *  GET  /clients/:id/asana/history?days=30   (projects.view)  frescor, fotos diárias e mudanças recentes
 *  POST /clients/:id/asana/history/refresh   (projects.sync)  "Atualizar agora" dos projetos deste cliente
 * Ambos exigem o cliente na carteira e filtram pela organização da sessão. Nada é escrito no Asana.
 */

type Authz = { organizationId?: string; membershipId?: string; role?: RoleType };

export async function asanaMirrorRoutes(app: FastifyInstance) {
  const resolveClient = async (request: FastifyRequest, reply: FastifyReply) => {
    const authz = (request as any).authorizationResult as Authz | undefined;
    if (!authz?.organizationId || !authz.membershipId || !authz.role) {
      reply.status(403).send({ status: 'error', message: 'Acesso requer contexto de organização válido.' });
      return null;
    }
    const clientId = (request.params as { id: string }).id;
    const client = await findClientInResourceScope(
      prisma,
      { organizationId: authz.organizationId, membershipId: authz.membershipId, role: authz.role },
      clientId
    );
    if (!client) {
      reply.status(404).send({ status: 'error', message: 'Cliente não encontrado.' });
      return null;
    }
    return { organizationId: authz.organizationId, clientId };
  };

  const route = (
    method: 'GET' | 'POST',
    path: string,
    permission: PermissionCode,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  ) => {
    for (const prefix of ['', '/api']) {
      // CLASSE: HUMAN_AUTHENTICATED
      app.route({ method, url: `${prefix}${path}`, preHandler: [authenticate, requirePermission(permission)], handler });
    }
  };

  route('GET', '/clients/:id/asana/history', 'projects.view', async (request, reply) => {
    const raw = (request.query as { days?: string })?.days;
    const days = raw === undefined ? 30 : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 400) {
      return reply.status(400).send({ status: 'error', message: 'days deve ser um inteiro entre 1 e 400.' });
    }
    const ctx = await resolveClient(request, reply);
    if (!ctx) return reply;
    try {
      return reply.status(200).send(await asanaMirrorService.getClientHistory(ctx.organizationId, ctx.clientId, days));
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ status: 'error', message: 'Não foi possível carregar o histórico do Asana.' });
    }
  });

  route('POST', '/clients/:id/asana/history/refresh', 'projects.sync', async (request, reply) => {
    const ctx = await resolveClient(request, reply);
    if (!ctx) return reply;
    try {
      const links = await prisma.clientIntegration.findMany({
        where: { provider: 'ASANA', clientId: ctx.clientId, client: { organizationId: ctx.organizationId } },
        select: { externalId: true },
      });
      if (links.length === 0) {
        return reply.status(200).send({ skipped: false, projects: 0, succeeded: 0, failed: 0, history: null });
      }
      const result = await asanaMirrorService.syncOrganization(ctx.organizationId, 'manual', {
        projectGids: links.map((l) => l.externalId),
      });
      if (result.skipped) {
        return reply
          .status(409)
          .send({ status: 'error', message: 'Já existe uma conferência do Asana em andamento. Tente de novo em instantes.' });
      }
      const history = await asanaMirrorService.getClientHistory(ctx.organizationId, ctx.clientId, 30);
      return reply.status(200).send({ ...result, history });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ status: 'error', message: 'Não foi possível conferir o Asana agora.' });
    }
  });
}
