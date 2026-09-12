import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requireRole } from '../../../middleware/auth.js';
import { AsanaService, AsanaIntegrationError } from './asana.service.js';
import { generateOAuthState, verifyOAuthState } from '../../../lib/oauthState.js';

const linkProjectsSchema = z.object({
  projectGids: z.array(z.string().min(1)).min(1, 'Selecione pelo menos um projeto para vincular'),
});

export async function asanaRoutes(app: FastifyInstance) {
  const asanaService = new AsanaService();

  function handleError(error: unknown, reply: FastifyReply) {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        status: 'error',
        message: 'Dados inválidos na requisição',
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof AsanaIntegrationError) {
      return reply.status(error.statusCode).send({
        status: 'error',
        message: error.message,
        details: error.details,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      status: 'error',
      message: 'Ocorreu um erro interno no servidor ao processar a integração Asana.',
    });
  }

  function getOrganizationId(request: FastifyRequest): string {
    const auth = request.authContext;
    if (!auth) {
      throw new AsanaIntegrationError(401, 'Não autenticado.');
    }

    if (auth.type === 'user' && auth.memberships.length > 0) {
      // Prioriza a organização 'zafira' ou a primeira organização vinculada
      const org = auth.memberships.find((m) => m.organizationSlug === 'zafira') || auth.memberships[0];
      return org.organizationId;
    }

    // Se for api_key interna, podemos buscar a organização padrão
    throw new AsanaIntegrationError(403, 'Acesso requer contexto de organização.');
  }

  // 1. GET /integrations/asana/status
  app.get(
    '/integrations/asana/status',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const status = await asanaService.getStatus(organizationId);
        return reply.status(200).send(status);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 2. GET /integrations/asana/projects
  app.get(
    '/integrations/asana/projects',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const projects = await asanaService.getWorkspaceProjects(organizationId);
        return reply.status(200).send(projects);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 3. GET /clients/:id/asana/projects
  app.get(
    '/clients/:id/asana/projects',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const projects = await asanaService.getClientProjects(request.params.id, organizationId);
        return reply.status(200).send(projects);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 4. POST /clients/:id/asana/projects (ADMIN / MANAGER)
  app.post(
    '/clients/:id/asana/projects',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const body = linkProjectsSchema.parse(request.body);
        const result = await asanaService.linkProjectsToClient(request.params.id, organizationId, body.projectGids);
        return reply.status(201).send({
          status: 'ok',
          message: `${result.linked} projeto(s) vinculado(s) com sucesso.`,
          ...result,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 5. DELETE /clients/:id/asana/projects/:integrationId (ADMIN / MANAGER)
  app.delete(
    '/clients/:id/asana/projects/:integrationId',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    async (
      request: FastifyRequest<{ Params: { id: string; integrationId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const organizationId = getOrganizationId(request);
        await asanaService.unlinkProject(request.params.id, organizationId, request.params.integrationId);
        return reply.status(200).send({
          status: 'ok',
          message: 'Projeto desvinculado com sucesso.',
        });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 6. GET /clients/:id/asana/tasks
  app.get(
    '/clients/:id/asana/tasks',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const tasks = await asanaService.getClientTasks(request.params.id, organizationId);
        return reply.status(200).send(tasks);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 7. GET /integrations/asana/oauth/authorize (Gera URL oficial de autorização do Asana com state seguro e assinado)
  app.get(
    '/integrations/asana/oauth/authorize',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const clientId = process.env.ASANA_CLIENT_ID;
        if (!clientId) {
          throw new AsanaIntegrationError(500, 'ASANA_CLIENT_ID não configurado no servidor.');
        }

        const auth = request.authContext;
        const userId = auth?.type === 'user' ? auth.userId : 'system';
        const organizationId = getOrganizationId(request);

        // Gera state criptograficamente seguro e assinado via HMAC com TTL de 10 min
        const { stateParam, cookieNonce } = generateOAuthState(organizationId, userId);

        const isProduction = process.env.NODE_ENV === 'production';
        reply.setCookie('asana_oauth_nonce', cookieNonce, {
          path: '/api/integrations/asana/oauth',
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          maxAge: 600, // 10 minutos
        });

        const protocol = request.protocol;
        const host = request.headers.host || 'localhost:5173';
        const redirectUri = `${protocol}://${host}/api/integrations/asana/oauth/callback`;

        const params = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          state: stateParam,
          scope: 'default',
        });

        const authUrl = `https://app.asana.com/-/oauth_authorize?${params.toString()}`;
        return reply.status(200).send({ url: authUrl });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 8. GET /integrations/asana/oauth/callback (Valida state criptografado e realiza token exchange seguro no backend)
  app.get(
    '/integrations/asana/oauth/callback',
    async (
      request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
      reply: FastifyReply
    ) => {
      const { code, state: stateParam, error } = request.query;
      const cookieNonce = request.cookies.asana_oauth_nonce;

      // Limpa imediatamente o cookie de nonce (uso único)
      reply.clearCookie('asana_oauth_nonce', {
        path: '/api/integrations/asana/oauth',
      });

      if (error || !code || !stateParam) {
        return reply.type('text/html').send(`
          <html>
            <body>
              <script>
                window.opener ? window.opener.postMessage({ type: 'ASANA_AUTH_ERROR', error: '${error || 'canceled'}' }, '*') : null;
                window.close();
              </script>
              <p>Falha ou cancelamento na autorização do Asana. Você pode fechar esta janela.</p>
            </body>
          </html>
        `);
      }

      try {
        // Validação estrita do state: assinatura HMAC, expiração de 10 min e nonce da sessão
        const verified = verifyOAuthState(stateParam, cookieNonce);
        const organizationId = verified.organizationId;

        const protocol = request.protocol;
        const host = request.headers.host || 'localhost:5173';
        const redirectUri = `${protocol}://${host}/api/integrations/asana/oauth/callback`;

        // Executa a troca do código por tokens cifrados com AES-256-GCM
        await asanaService.exchangeOAuthCode(organizationId, code, redirectUri);

        return reply.type('text/html').send(`
          <html>
            <body>
              <script>
                window.opener ? window.opener.postMessage({ type: 'ASANA_AUTH_SUCCESS' }, '*') : null;
                window.close();
              </script>
              <p>Asana conectado com sucesso! Esta janela será fechada automaticamente.</p>
            </body>
          </html>
        `);
      } catch (err: any) {
        return reply.type('text/html').send(`
          <html>
            <body>
              <script>
                window.opener ? window.opener.postMessage({ type: 'ASANA_AUTH_ERROR', error: '${err?.message || 'Falha na validação de segurança'}' }, '*') : null;
                window.close();
              </script>
              <p>Erro de segurança ou validação: ${err?.message || 'Acesso negado'}</p>
            </body>
          </html>
        `);
      }
    }
  );
}
