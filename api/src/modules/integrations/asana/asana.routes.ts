import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requireRole } from '../../../middleware/auth.js';
import { AsanaService, AsanaIntegrationError } from './asana.service.js';
import { prisma } from '../../../lib/prisma.js';
import { createAndPersistOAuthState, verifyAndConsumeOAuthState } from '../../../lib/oauthState.js';

const linkProjectsSchema = z.object({
  projectGids: z.array(z.string().min(1)).min(1, 'Selecione pelo menos um projeto para vincular'),
});

export const ASANA_OAUTH_SCOPES = [
  'attachments:read',
  'attachments:write',
  'custom_fields:read',
  'custom_fields:write',
  'jobs:read',
  'project_templates:read',
  'projects:read',
  'projects:write',
  'stories:read',
  'stories:write',
  'tags:read',
  'tags:write',
  'task_templates:read',
  'tasks:read',
  'tasks:write',
  'team_memberships:read',
  'teams:read',
  'users:read',
  'workspaces:read',
] as const;

export function buildAsanaAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scopes = ASANA_OAUTH_SCOPES,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[] | string[];
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(' '),
  });

  return `https://app.asana.com/-/oauth_authorize?${params.toString()}`;
}

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

  // 1.1 DELETE /integrations/asana/disconnect (ADMIN)
  app.delete(
    '/integrations/asana/disconnect',
    {
      preHandler: [authenticate, requireRole(['ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        await asanaService.disconnect(organizationId);
        return reply.status(200).send({
          status: 'ok',
          message: 'Integração Asana desconectada com sucesso da organização.',
        });
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

  function getOAuthRedirectUri(): string {
    return process.env.ASANA_REDIRECT_URI || 'https://zafira-hub-v2-api.hvrb9d.easypanel.host/integrations/asana/oauth/callback';
  }

  function getTargetOrigin(): string {
    if (process.env.FRONTEND_ORIGIN) {
      return process.env.FRONTEND_ORIGIN.trim();
    }
    if (process.env.CORS_ORIGIN) {
      const first = process.env.CORS_ORIGIN.split(',')[0].trim();
      if (first) return first;
    }
    return 'http://localhost:5173';
  }

  // 7. GET /integrations/asana/oauth/authorize (Gera URL oficial de autorização do Asana com scopes explícitos e state seguro)
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

        // Gera state assinado via HMAC e persiste no PostgreSQL para validação com uso único
        const { stateParam } = await createAndPersistOAuthState(prisma, organizationId, userId, 'ASANA');

        const redirectUri = getOAuthRedirectUri();

        const authUrl = buildAsanaAuthorizeUrl({
          clientId,
          redirectUri,
          state: stateParam,
          scopes: ASANA_OAUTH_SCOPES,
        });

        return reply.status(200).send({ url: authUrl });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  const callbackHandler = async (
    request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
    reply: FastifyReply
  ) => {
    const { code, state: stateParam, error } = request.query;
    const targetOrigin = getTargetOrigin();

    // Limpa opcionalmente o cookie legado se presente
    if (request.cookies.asana_oauth_nonce) {
      reply.clearCookie('asana_oauth_nonce', { path: '/' });
    }

    if (error || !code || !stateParam) {
      const errDescription = error || 'Autorização cancelada ou recusada.';
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <title>Autorização Asana - Zafira Hub</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
              .icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 22px; font-weight: bold; }
              h2 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
              p { margin: 0 0 20px; font-size: 14px; color: #a1a1aa; line-height: 1.5; }
              button { background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
              button:hover { background: #3f3f46; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✕</div>
              <h2>Conexão não concluída</h2>
              <p>${errDescription}</p>
              <button onclick="window.close()">Fechar Janela</button>
            </div>
            <script>
              const targetOrigin = "${targetOrigin}";
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'ASANA_AUTH_ERROR', error: '${errDescription}' }, targetOrigin);
                }
              } catch (e) {}
            </script>
          </body>
        </html>
      `);
    }

    try {
      // Validação criptográfica HMAC + verificação e consumo atômico no banco de dados (uso único garantido)
      const verified = await verifyAndConsumeOAuthState(prisma, stateParam, 'ASANA');
      const organizationId = verified.organizationId;
      const redirectUri = getOAuthRedirectUri();

      // Executa a troca do código por tokens cifrados com AES-256-GCM
      await asanaService.exchangeOAuthCode(organizationId, code, redirectUri);

      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <title>Asana Conectado - Zafira Hub</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
              .icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #10b981; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 22px; font-weight: bold; }
              h2 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
              p { margin: 0 0 16px; font-size: 14px; color: #a1a1aa; line-height: 1.5; }
              .badge { display: inline-block; padding: 4px 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; font-size: 12px; color: #71717a; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✓</div>
              <h2>Asana Conectado!</h2>
              <p>A autorização foi validada com sucesso. O Zafira Hub já está sincronizado com seu Asana.</p>
              <div class="badge">Fechando esta janela em instantes...</div>
            </div>
            <script>
              const targetOrigin = "${targetOrigin}";
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'ASANA_AUTH_SUCCESS' }, targetOrigin);
                }
              } catch (e) {
                console.error(e);
              }
              setTimeout(function() {
                window.close();
              }, 1200);
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      const errMsg = err?.message || 'Falha na validação de segurança';
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <title>Erro de Conexão - Zafira Hub</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
              .icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 22px; font-weight: bold; }
              h2 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
              p { margin: 0 0 20px; font-size: 14px; color: #a1a1aa; line-height: 1.5; }
              button { background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
              button:hover { background: #3f3f46; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✕</div>
              <h2>Erro de Validação</h2>
              <p>${errMsg}</p>
              <button onclick="window.close()">Fechar Janela</button>
            </div>
            <script>
              const targetOrigin = "${targetOrigin}";
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'ASANA_AUTH_ERROR', error: '${errMsg}' }, targetOrigin);
                }
              } catch (e) {}
            </script>
          </body>
        </html>
      `);
    }
  };

  // 8. GET /integrations/asana/oauth/callback (Valida state criptografado e realiza token exchange seguro no backend)
  app.get('/integrations/asana/oauth/callback', callbackHandler);
  app.get('/api/integrations/asana/oauth/callback', callbackHandler);
}
