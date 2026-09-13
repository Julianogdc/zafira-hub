import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requireRole } from '../../../middleware/auth.js';
import { AsanaService, AsanaIntegrationError } from './asana.service.js';
import { prisma } from '../../../lib/prisma.js';
import { createAndPersistOAuthState, verifyAndConsumeOAuthState } from '../../../lib/oauthState.js';
import { sseHub } from '../../../lib/sseHub.js';

const linkProjectsSchema = z.object({
  projectGids: z.array(z.string().min(1)).min(1, 'Selecione pelo menos um projeto para vincular'),
});

const updateTaskSchema = z.object({
  name: z.string().min(1, 'O nome da tarefa não pode estar vazio').optional(),
  notes: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (YYYY-MM-DD)').nullable().optional(),
  due_at: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  sectionGid: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).optional(),
});

const createTaskSchema = z.object({
  projectGid: z.string().min(1, 'Projeto de destino é obrigatório'),
  name: z.string().min(1, 'Título da tarefa é obrigatório'),
  notes: z.string().nullable().optional(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (YYYY-MM-DD)').nullable().optional(),
  assignee: z.string().nullable().optional(),
  sectionGid: z.string().nullable().optional(),
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
  'webhooks:delete',
  'webhooks:read',
  'webhooks:write',
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

  // 2.1 GET /integrations/asana/users (Lista membros válidos do workspace Asana para atribuição)
  const getUsersHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      const users = await asanaService.getWorkspaceUsers(organizationId);
      return reply.status(200).send(users);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/integrations/asana/users',
    {
      preHandler: [authenticate],
    },
    getUsersHandler
  );
  app.get(
    '/api/integrations/asana/users',
    {
      preHandler: [authenticate],
    },
    getUsersHandler
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
  const getTasksHandler = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      const tasks = await asanaService.getClientTasks(request.params.id, organizationId);
      return reply.status(200).send(tasks);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/tasks',
    {
      preHandler: [authenticate],
    },
    getTasksHandler
  );
  app.get(
    '/api/clients/:id/asana/tasks',
    {
      preHandler: [authenticate],
    },
    getTasksHandler
  );

  // 6.1 GET /clients/:id/asana/tasks/:taskGid (Busca rápida de tarefa individual para atualização instantânea na UI)
  const getSingleTaskHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const task = await asanaService.getClientSingleTask(request.params.id, organizationId, request.params.taskGid);
      return reply.status(200).send(task);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate],
    },
    getSingleTaskHandler
  );
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate],
    },
    getSingleTaskHandler
  );

  // 6.2 PATCH /clients/:id/asana/tasks/:taskGid (Edição de tarefa com RBAC ADMIN/MANAGER)
  const patchSingleTaskHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const parsedBody = updateTaskSchema.parse(request.body);
      const updated = await asanaService.updateClientTask(
        request.params.id,
        organizationId,
        request.params.taskGid,
        parsedBody
      );
      return reply.status(200).send(updated);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.patch(
    '/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    patchSingleTaskHandler
  );
  app.patch(
    '/api/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    patchSingleTaskHandler
  );

  // 6.2.1 POST /clients/:id/asana/tasks (Criação de nova tarefa/demanda com RBAC ADMIN/MANAGER)
  const postCreateTaskHandler = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const parsedBody = createTaskSchema.parse(request.body);
      const created = await asanaService.createClientTask(
        request.params.id,
        organizationId,
        parsedBody
      );
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/clients/:id/asana/tasks',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postCreateTaskHandler
  );
  app.post(
    '/api/clients/:id/asana/tasks',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postCreateTaskHandler
  );

  // 6.3 GET /clients/:id/asana/projects/:projectGid/sections (Lista seções válidas do projeto)
  const getSectionsHandler = async (
    request: FastifyRequest<{ Params: { id: string; projectGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const sections = await asanaService.getProjectSections(
        request.params.id,
        organizationId,
        request.params.projectGid
      );
      return reply.status(200).send(sections);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/projects/:projectGid/sections',
    {
      preHandler: [authenticate],
    },
    getSectionsHandler
  );
  app.get(
    '/api/clients/:id/asana/projects/:projectGid/sections',
    {
      preHandler: [authenticate],
    },
    getSectionsHandler
  );

  // 6.4 POST /clients/:id/asana/tasks/:taskGid/section (Move tarefa entre seções com RBAC ADMIN/MANAGER)
  const moveTaskSectionSchema = z.object({
    sectionGid: z.string().min(1, 'O gid da seção é obrigatório'),
  });

  const postTaskSectionHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const { sectionGid } = moveTaskSectionSchema.parse(request.body);
      const updated = await asanaService.moveTaskSection(
        request.params.id,
        organizationId,
        request.params.taskGid,
        sectionGid
      );
      return reply.status(200).send(updated);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/clients/:id/asana/tasks/:taskGid/section',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postTaskSectionHandler
  );
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/section',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postTaskSectionHandler
  );

  // 6.5 Subtarefas: GET e POST
  const createSubtaskSchema = z.object({
    name: z.string().min(1, 'O nome da subtarefa não pode estar vazio'),
    due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (YYYY-MM-DD)').nullable().optional(),
    assignee: z.string().nullable().optional(),
  });

  const getSubtasksHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const subtasks = await asanaService.getTaskSubtasks(
        request.params.id,
        organizationId,
        request.params.taskGid
      );
      return reply.status(200).send(subtasks);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate],
    },
    getSubtasksHandler
  );
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate],
    },
    getSubtasksHandler
  );

  const postSubtaskHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const parsedBody = createSubtaskSchema.parse(request.body);
      const created = await asanaService.createTaskSubtask(
        request.params.id,
        organizationId,
        request.params.taskGid,
        parsedBody
      );
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postSubtaskHandler
  );
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postSubtaskHandler
  );

  // 6.6 Histórico e Comentários (Stories): GET e POST
  const addCommentSchema = z.object({
    text: z.string().min(1, 'O comentário não pode estar vazio'),
  });

  const getStoriesHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const stories = await asanaService.getTaskStories(
        request.params.id,
        organizationId,
        request.params.taskGid
      );
      return reply.status(200).send(stories);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate],
    },
    getStoriesHandler
  );
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate],
    },
    getStoriesHandler
  );

  const postStoryHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const { text } = addCommentSchema.parse(request.body);
      const story = await asanaService.addTaskComment(
        request.params.id,
        organizationId,
        request.params.taskGid,
        text
      );
      return reply.status(201).send(story);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postStoryHandler
  );
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postStoryHandler
  );

  // 6.7 Anexos: GET e POST (Upload Multipart direto para Asana Cloud sem retenção na VPS)
  const getAttachmentsHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const attachments = await asanaService.getTaskAttachments(
        request.params.id,
        organizationId,
        request.params.taskGid
      );
      return reply.status(200).send(attachments);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate],
    },
    getAttachmentsHandler
  );
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate],
    },
    getAttachmentsHandler
  );

  const postAttachmentHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: 'Nenhum arquivo enviado para upload.' });
      }

      const buffer = await file.toBuffer();
      const attachment = await asanaService.uploadTaskAttachment(
        request.params.id,
        organizationId,
        request.params.taskGid,
        buffer,
        file.filename,
        file.mimetype
      );
      return reply.status(201).send(attachment);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postAttachmentHandler
  );
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postAttachmentHandler
  );

  // 6.8 Tags: GET workspace tags, POST add tag, DELETE remove tag
  const getWorkspaceTagsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      const tags = await asanaService.getWorkspaceTags(organizationId);
      return reply.status(200).send(tags);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/integrations/asana/tags',
    {
      preHandler: [authenticate],
    },
    getWorkspaceTagsHandler
  );
  app.get(
    '/api/integrations/asana/tags',
    {
      preHandler: [authenticate],
    },
    getWorkspaceTagsHandler
  );

  const addTagSchema = z.object({
    tagGid: z.string().min(1, 'O gid da tag é obrigatório'),
  });

  const postTagHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const { tagGid } = addTagSchema.parse(request.body);
      await asanaService.addTagToTask(request.params.id, organizationId, request.params.taskGid, tagGid);
      return reply.status(200).send({ status: 'ok', message: 'Tag vinculada com sucesso.' });
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/clients/:id/asana/tasks/:taskGid/tags',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postTagHandler
  );
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/tags',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    postTagHandler
  );

  const deleteTagHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string; tagGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      await asanaService.removeTagFromTask(
        request.params.id,
        organizationId,
        request.params.taskGid,
        request.params.tagGid
      );
      return reply.status(200).send({ status: 'ok', message: 'Tag desvinculada com sucesso.' });
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.delete(
    '/clients/:id/asana/tasks/:taskGid/tags/:tagGid',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    deleteTagHandler
  );
  app.delete(
    '/api/clients/:id/asana/tasks/:taskGid/tags/:tagGid',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    deleteTagHandler
  );

  // 6.9 Dependências: GET
  const getDependenciesHandler = async (
    request: FastifyRequest<{ Params: { id: string; taskGid: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const dependencies = await asanaService.getTaskDependencies(
        request.params.id,
        organizationId,
        request.params.taskGid
      );
      return reply.status(200).send(dependencies);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/clients/:id/asana/tasks/:taskGid/dependencies',
    {
      preHandler: [authenticate],
    },
    getDependenciesHandler
  );
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/dependencies',
    {
      preHandler: [authenticate],
    },
    getDependenciesHandler
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

  // 9. GET /integrations/asana/events (Canal SSE autenticado e isolado por organização)
  const eventsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      sseHub.register(organizationId, reply);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/integrations/asana/events',
    {
      preHandler: [authenticate],
    },
    eventsHandler
  );
  app.get(
    '/api/integrations/asana/events',
    {
      preHandler: [authenticate],
    },
    eventsHandler
  );

  // 10. POST /integrations/asana/webhooks/:subscriptionId (Endpoint público para Webhooks do Asana)
  const webhookHandler = async (
    request: FastifyRequest<{
      Params: { subscriptionId: string };
    }>,
    reply: FastifyReply
  ) => {
    const { subscriptionId } = request.params;
    const xHookSecret = request.headers['x-hook-secret'] as string | undefined;
    const xHookSignature = request.headers['x-hook-signature'] as string | undefined;

    // 1. Handshake do Asana: recebe X-Hook-Secret, salva e devolve no header
    if (xHookSecret) {
      try {
        await asanaService.handleWebhookHandshake(subscriptionId, xHookSecret);
        return reply
          .status(200)
          .header('X-Hook-Secret', xHookSecret)
          .send();
      } catch (err: any) {
        app.log.error(err, '[AsanaWebhook] Erro no handshake do webhook');
        return reply.status(400).send({ error: 'Falha no handshake' });
      }
    }

    // 2. Eventos posteriores: validação de assinatura HMAC-SHA256 usando o raw body
    if (xHookSignature) {
      const t0 = performance.now();
      const tWebhookReceived = Date.now();
      console.log(`[TIMING] [1. Webhook Recebido] subId=${subscriptionId} timestamp=${new Date(tWebhookReceived).toISOString()}`);

      // Mede a latência interna do Asana (entre criação no Asana e entrega na nossa API)
      const events = Array.isArray((request.body as any)?.events) ? (request.body as any).events : [];
      for (const ev of events) {
        if (ev.created_at) {
          const asanaEventTime = new Date(ev.created_at).getTime();
          const asanaLagMs = tWebhookReceived - asanaEventTime;
          console.log(`[TIMING] [Asana Delivery Lag] tempo decorrido no Asana até enviar webhook=${(asanaLagMs / 1000).toFixed(2)}s (resource=${ev.resource?.gid} action=${ev.action})`);
        }
      }

      const rawBody = (request as any).rawBody || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
      const sub = await asanaService.verifyAndGetSubscription(subscriptionId, xHookSignature, rawBody);

      const tSignature = performance.now();
      const isValid = sub !== null;
      console.log(`[TIMING] [2. Assinatura Validada] dur=${(tSignature - t0).toFixed(1)}ms signatureValid=${isValid}`);

      if (!sub) {
        return reply.status(401).send({
          error: 'Assinatura de webhook inválida.',
        });
      }

      // Processa e publica via SSE imediatamente (zero espera no banco antes de publicar)
      asanaService.processWebhookPayloadFast(sub, request.body, tWebhookReceived);
      const tSsePublished = performance.now();
      console.log(`[TIMING] [3. SSE Publicado] dur=${(tSsePublished - t0).toFixed(1)}ms`);

      return reply.status(200).send({ status: 'ok' });
    }

    return reply.status(400).send({
      error: 'Requisição inválida. Cabeçalhos de webhook ausentes.',
    });
  };

  app.post('/integrations/asana/webhooks/:subscriptionId', webhookHandler);
  app.post('/api/integrations/asana/webhooks/:subscriptionId', webhookHandler);

  // 11. GET /integrations/asana/diagnostics (Diagnóstico seguro de Webhooks, SSE e banco - ADMIN)
  const diagnosticsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      const diagnostics = await asanaService.getDiagnostics(organizationId);
      return reply.status(200).send(diagnostics);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.get(
    '/integrations/asana/diagnostics',
    {
      preHandler: [authenticate, requireRole(['ADMIN'])],
    },
    diagnosticsHandler
  );
  app.get(
    '/api/integrations/asana/diagnostics',
    {
      preHandler: [authenticate, requireRole(['ADMIN'])],
    },
    diagnosticsHandler
  );

  // 12. POST /integrations/asana/webhooks/sync (Sincroniza e garante webhooks para todos os projetos vinculados)
  const syncWebhooksHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      const result = await asanaService.syncWebhooks(organizationId);
      return reply.status(200).send(result);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  app.post(
    '/integrations/asana/webhooks/sync',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    syncWebhooksHandler
  );
  app.post(
    '/api/integrations/asana/webhooks/sync',
    {
      preHandler: [authenticate, requireRole(['ADMIN', 'MANAGER'])],
    },
    syncWebhooksHandler
  );
}
