import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { authenticate, requirePermission } from '../../../middleware/auth.js';
import { AsanaService, AsanaIntegrationError } from './asana.service.js';
import { prisma } from '../../../lib/prisma.js';
import { createAndPersistOAuthState, verifyAndConsumeOAuthState } from '../../../lib/oauthState.js';
import { sseHub } from '../../../lib/sseHub.js';
import {
  integrationObservabilityService,
  sanitizeMetadata,
} from '../common/integration-observability.service.js';

const linkProjectsSchema = z.object({
  projectGids: z.array(z.string().min(1)).min(1, 'Selecione pelo menos um projeto para vincular'),
});

const updateTaskSchema = z.object({
  name: z.string().min(1, 'O nome da tarefa não pode estar vazio').optional(),
  notes: z.string().nullable().optional(),
  html_notes: z.string().nullable().optional(),
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
  html_notes: z.string().nullable().optional(),
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
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/integrations/asana/status',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
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
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete(
    '/integrations/asana/disconnect',
    {
      preHandler: [authenticate, requirePermission('integrations.remove')],
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
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/integrations/asana/projects',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
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

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/integrations/asana/users',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    getUsersHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/integrations/asana/users',
    {
      preHandler: [authenticate, requirePermission('integrations.view')],
    },
    getUsersHandler
  );

  // 3. GET /clients/:id/asana/projects
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/projects',
    {
      preHandler: [authenticate, requirePermission('projects.view')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const projects = await asanaService.getClientProjects((request.params as any).id, organizationId);
        return reply.status(200).send(projects);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // 4. POST /clients/:id/asana/projects (ADMIN / MANAGER)
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/projects',
    {
      preHandler: [authenticate, requirePermission('projects.manage_links')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const organizationId = getOrganizationId(request);
        const body = linkProjectsSchema.parse(request.body);
        const result = await asanaService.linkProjectsToClient((request.params as any).id, organizationId, body.projectGids);
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
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete(
    '/clients/:id/asana/projects/:integrationId',
    {
      preHandler: [authenticate, requirePermission('projects.manage_links')],
    },
    async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        const organizationId = getOrganizationId(request);
        await asanaService.unlinkProject((request.params as any).id, organizationId, (request.params as any).integrationId);
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
  const getTasksHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const organizationId = getOrganizationId(request);
      const tasks = await asanaService.getClientTasks((request.params as any).id, organizationId);
      return reply.status(200).send(tasks);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/tasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getTasksHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/tasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getTasksHandler
  );

  // 6.1 GET /clients/:id/asana/tasks/:taskGid (Busca rápida de tarefa individual para atualização instantânea na UI)
  const getSingleTaskHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const task = await asanaService.getClientSingleTask((request.params as any).id, organizationId, (request.params as any).taskGid);
      return reply.status(200).send(task);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getSingleTaskHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getSingleTaskHandler
  );

  // 6.2 PATCH /clients/:id/asana/tasks/:taskGid (Edição de tarefa com RBAC ADMIN/MANAGER)
  const patchSingleTaskHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const parsedBody = updateTaskSchema.parse(request.body);
      const updated = await asanaService.updateClientTask(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid,
        parsedBody
      );
      return reply.status(200).send(updated);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.patch(
    '/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    patchSingleTaskHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch(
    '/api/clients/:id/asana/tasks/:taskGid',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    patchSingleTaskHandler
  );

  // 6.2.1 POST /clients/:id/asana/tasks (Criação de nova tarefa/demanda com RBAC ADMIN/MANAGER)
  const postCreateTaskHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const parsedBody = createTaskSchema.parse(request.body);
      const created = await asanaService.createClientTask(
        (request.params as any).id,
        organizationId,
        parsedBody
      );
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/tasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postCreateTaskHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/clients/:id/asana/tasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postCreateTaskHandler
  );

  // 6.3 GET /clients/:id/asana/projects/:projectGid/sections (Lista seções válidas do projeto)
  const getSectionsHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const sections = await asanaService.getProjectSections(
        (request.params as any).id,
        organizationId,
        (request.params as any).projectGid
      );
      return reply.status(200).send(sections);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/projects/:projectGid/sections',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getSectionsHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/projects/:projectGid/sections',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getSectionsHandler
  );

  // 6.4 POST /clients/:id/asana/tasks/:taskGid/section (Move tarefa entre seções com RBAC ADMIN/MANAGER)
  const moveTaskSectionSchema = z.object({
    sectionGid: z.string().min(1, 'O gid da seção é obrigatório'),
  });

  const postTaskSectionHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const { sectionGid } = moveTaskSectionSchema.parse(request.body);
      const updated = await asanaService.moveTaskSection(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid,
        sectionGid
      );
      return reply.status(200).send(updated);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/tasks/:taskGid/section',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postTaskSectionHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/section',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
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
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const subtasks = await asanaService.getTaskSubtasks(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid
      );
      return reply.status(200).send(subtasks);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getSubtasksHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getSubtasksHandler
  );

  const postSubtaskHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const parsedBody = createSubtaskSchema.parse(request.body);
      const created = await asanaService.createTaskSubtask(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid,
        parsedBody
      );
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postSubtaskHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/subtasks',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postSubtaskHandler
  );

  // 6.6 Histórico e Comentários (Stories): GET e POST
  const addCommentSchema = z.object({
    text: z.string().min(1, 'O comentário não pode estar vazio'),
  });

  const getStoriesHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const stories = await asanaService.getTaskStories(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid
      );
      return reply.status(200).send(stories);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getStoriesHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getStoriesHandler
  );

  const postStoryHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const { text } = addCommentSchema.parse(request.body);
      const story = await asanaService.addTaskComment(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid,
        text
      );
      return reply.status(201).send(story);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postStoryHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/stories',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postStoryHandler
  );

  // 6.7 Anexos: GET e POST (Upload Multipart direto para Asana Cloud sem retenção na VPS)
  const getAttachmentsHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const attachments = await asanaService.getTaskAttachments(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid
      );
      return reply.status(200).send(attachments);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getAttachmentsHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getAttachmentsHandler
  );

  const postAttachmentHandler = async (
    request: FastifyRequest,
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
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid,
        buffer,
        file.filename,
        file.mimetype
      );
      return reply.status(201).send(attachment);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postAttachmentHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/attachments',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
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

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/integrations/asana/tags',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getWorkspaceTagsHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/integrations/asana/tags',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getWorkspaceTagsHandler
  );

  const addTagSchema = z.object({
    tagGid: z.string().min(1, 'O gid da tag é obrigatório'),
  });

  const postTagHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const { tagGid } = addTagSchema.parse(request.body);
      await asanaService.addTagToTask((request.params as any).id, organizationId, (request.params as any).taskGid, tagGid);
      return reply.status(200).send({ status: 'ok', message: 'Tag vinculada com sucesso.' });
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/clients/:id/asana/tasks/:taskGid/tags',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postTagHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/clients/:id/asana/tasks/:taskGid/tags',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    postTagHandler
  );

  const deleteTagHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      await asanaService.removeTagFromTask(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid,
        (request.params as any).tagGid
      );
      return reply.status(200).send({ status: 'ok', message: 'Tag desvinculada com sucesso.' });
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.delete(
    '/clients/:id/asana/tasks/:taskGid/tags/:tagGid',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    deleteTagHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete(
    '/api/clients/:id/asana/tasks/:taskGid/tags/:tagGid',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    deleteTagHandler
  );

  // 6.9 Dependências: GET
  const getDependenciesHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const organizationId = getOrganizationId(request);
      const dependencies = await asanaService.getTaskDependencies(
        (request.params as any).id,
        organizationId,
        (request.params as any).taskGid
      );
      return reply.status(200).send(dependencies);
    } catch (error) {
      return handleError(error, reply);
    }
  };

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/clients/:id/asana/tasks/:taskGid/dependencies',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
    },
    getDependenciesHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/clients/:id/asana/tasks/:taskGid/dependencies',
    {
      preHandler: [authenticate, requirePermission('deliverables.view')],
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
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/integrations/asana/oauth/authorize',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
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

  const webhookHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { subscriptionId } = (request.params || {}) as { subscriptionId: string };
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

      // Deduplicação determinística e auditoria do evento via WebhookEvent (tenant isolation da própria subscription)
      const rawHash = crypto.createHash('sha256').update(rawBody).digest('hex');
      const dedupeKey = `ASANA:${sub.id}:${rawHash}`;
      const sanitizedPayload = sanitizeMetadata(request.body);

      const { isDuplicate, event } = await integrationObservabilityService.recordWebhookEvent({
        organizationId: sub.organizationId,
        provider: 'ASANA',
        dedupeKey,
        eventType: 'asana.webhook',
        payload: sanitizedPayload,
      });

      if (isDuplicate) {
        console.log(`[AsanaWebhook] Evento duplicado detectado e deduplicado: dedupeKey=${dedupeKey}`);
        return reply.status(200).send({ status: 'ok', deduplicated: true });
      }

      try {
        // Processa e publica via SSE imediatamente (zero espera no banco antes de publicar)
        asanaService.processWebhookPayloadFast(sub, request.body, tWebhookReceived);
        const tSsePublished = performance.now();
        console.log(`[TIMING] [3. SSE Publicado] dur=${(tSsePublished - t0).toFixed(1)}ms`);

        await integrationObservabilityService.updateWebhookStatus(event.id, 'PROCESSED');
        return reply.status(200).send({ status: 'ok' });
      } catch (err: any) {
        app.log.error(err, '[AsanaWebhook] Erro no processamento do payload do webhook');
        await integrationObservabilityService.updateWebhookStatus(
          event.id,
          'FAILED',
          err?.message || 'Erro durante o processamento do payload'
        ).catch(() => {});

        return reply.status(500).send({ error: 'Erro no processamento do evento de webhook' });
      }
    }

    return reply.status(400).send({
      error: 'Requisição inválida. Cabeçalhos de webhook ausentes.',
    });
  };

  // CLASSE: MACHINE_AUTHENTICATED
  app.post('/integrations/asana/webhooks/:subscriptionId', webhookHandler);
  // CLASSE: MACHINE_AUTHENTICATED
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

  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/integrations/asana/diagnostics',
    {
      preHandler: [authenticate, requirePermission('integrations.remove')],
    },
    diagnosticsHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/integrations/asana/diagnostics',
    {
      preHandler: [authenticate, requirePermission('integrations.remove')],
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

  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/integrations/asana/webhooks/sync',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    syncWebhooksHandler
  );
  // CLASSE: HUMAN_AUTHENTICATED
  app.post(
    '/api/integrations/asana/webhooks/sync',
    {
      preHandler: [authenticate, requirePermission('deliverables.plan')],
    },
    syncWebhooksHandler
  );
}
