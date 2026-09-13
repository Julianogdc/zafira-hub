import crypto from 'crypto';
import { prisma } from '../../../lib/prisma.js';
import { encryptToken, decryptToken } from '../../../lib/crypto.js';
import { sseHub, AsanaNormalizedEvent } from '../../../lib/sseHub.js';

export class AsanaIntegrationError extends Error {
  constructor(public statusCode: number, message: string, public details?: any) {
    super(message);
    this.name = 'AsanaIntegrationError';
  }
}

export interface AsanaStatus {
  configured: boolean;
  connected: boolean;
  source?: 'organization' | 'env';
  workspaceId?: string | null;
  workspaceName?: string | null;
  user?: {
    gid: string;
    name: string;
    email?: string;
  } | null;
}

export interface AsanaProjectSummary {
  gid: string;
  name: string;
  color?: string | null;
  notes?: string | null;
  workspaceGid?: string | null;
}

export interface ClientAsanaProject {
  integrationId: string;
  clientId: string;
  projectGid: string;
  projectName: string;
  color?: string | null;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  createdAt: Date;
}

export interface AsanaTag {
  gid: string;
  name: string;
}

export interface AsanaSection {
  gid: string;
  name: string;
}

export interface AsanaCustomField {
  gid: string;
  name: string;
  value: string;
  type: string;
}

export interface AsanaSubtask {
  gid: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  dueAt: string | null;
  assignee?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
}

export interface AsanaStory {
  gid: string;
  text: string;
  htmlText?: string | null;
  type: 'comment' | 'system';
  createdAt: string;
  createdBy?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
}

export interface AsanaAttachment {
  gid: string;
  name: string;
  downloadUrl: string | null;
  viewUrl: string | null;
  permanentUrl: string | null;
  host: string;
  size: number | null;
  createdAt: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
}

export interface ClientAsanaTask {
  gid: string;
  name: string;
  notes?: string | null;
  completed: boolean;
  dueOn: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  sectionName?: string | null;
  sectionGid?: string | null;
  assignee?: {
    gid: string;
    name: string;
    photoUrl?: string | null;
  } | null;
  permalinkUrl?: string | null;
  projectGid: string;
  projectName: string;
  tags?: AsanaTag[];
  customFields?: AsanaCustomField[];
}

export class AsanaService {
  private asanaBaseUrl = 'https://app.asana.com/api/1.0';

  /**
   * Obtém token de acesso válido para a organização.
   * Prioridade:
   * 1. Banco de dados (organization_integrations com criptografia AES-256-GCM)
   * 2. Fallback estrito de desenvolvimento (apenas se NODE_ENV !== 'production')
   */
  async getValidToken(organizationId: string): Promise<{ token: string; source: 'organization' | 'env'; workspaceId?: string | null }> {
    // 1. Consulta no banco
    const orgIntegration = await prisma.organizationIntegration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: 'ASANA',
        },
      },
    });

    if (orgIntegration?.accessToken) {
      const plainAccessToken = decryptToken(orgIntegration.accessToken);
      const plainRefreshToken = orgIntegration.refreshToken ? decryptToken(orgIntegration.refreshToken) : null;

      // Verifica se o token expirou e possui refresh token
      if (orgIntegration.expiresAt && orgIntegration.expiresAt < new Date() && plainRefreshToken) {
        const refreshed = await this.refreshToken(orgIntegration.id, plainRefreshToken);
        return { token: refreshed.accessToken, source: 'organization', workspaceId: orgIntegration.workspaceId };
      }
      return { token: plainAccessToken, source: 'organization', workspaceId: orgIntegration.workspaceId };
    }

    // 2. Fallback estrito para ambiente de desenvolvimento local (NUNCA em produção)
    if (process.env.NODE_ENV !== 'production') {
      const devToken = process.env.ASANA_DEV_PAT || process.env.ASANA_ACCESS_TOKEN;
      if (devToken) {
        return { token: devToken, source: 'env' };
      }
    }

    throw new AsanaIntegrationError(400, 'A integração com o Asana não está configurada para esta organização.');
  }

  /**
   * Realiza chamadas seguras à API oficial do Asana.
   */
  private async fetchAsana<T = any>(endpoint: string, token: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.asanaBaseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData?.errors?.[0]?.message || `Erro na comunicação com a API do Asana (HTTP ${response.status})`;
      throw new AsanaIntegrationError(response.status, message, errorData);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return {} as T;
    }

    const data = JSON.parse(text);
    return data.data !== undefined ? data.data : data;
  }

  /**
   * Retorna o status de conexão da organização com o Asana.
   */
  async getStatus(organizationId: string): Promise<AsanaStatus> {
    try {
      const { token, source, workspaceId } = await this.getValidToken(organizationId);

      // Valida o token buscando /users/me
      const me = await this.fetchAsana<any>('/users/me', token);

      const defaultWorkspace = me.workspaces?.[0];
      const activeWorkspaceId = workspaceId || defaultWorkspace?.gid || null;
      const activeWorkspaceName = defaultWorkspace?.name || null;

      return {
        configured: true,
        connected: true,
        source,
        workspaceId: activeWorkspaceId,
        workspaceName: activeWorkspaceName,
        user: {
          gid: me.gid,
          name: me.name,
          email: me.email,
        },
      };
    } catch (error: any) {
      if (error instanceof AsanaIntegrationError && error.statusCode === 400) {
        return {
          configured: false,
          connected: false,
        };
      }
      return {
        configured: true,
        connected: false,
      };
    }
  }

  /**
   * Lista todos os projetos disponíveis no workspace do Asana para vincular a clientes.
   */
  async getWorkspaceProjects(organizationId: string): Promise<AsanaProjectSummary[]> {
    const { token } = await this.getValidToken(organizationId);
    const me = await this.fetchAsana<any>('/users/me', token);
    const workspaceGid = me.workspaces?.[0]?.gid;

    if (!workspaceGid) {
      throw new AsanaIntegrationError(404, 'Nenhum workspace encontrado no Asana.');
    }

    const projects = await this.fetchAsana<any[]>(
      `/projects?workspace=${workspaceGid}&archived=false&opt_fields=name,color,notes`,
      token
    );

    return projects.map((p) => ({
      gid: p.gid,
      name: p.name,
      color: p.color || null,
      notes: p.notes || null,
      workspaceGid,
    }));
  }

  /**
   * Retorna os projetos Asana vinculados a um cliente com métricas de progresso.
   */
  async getClientProjects(clientId: string, organizationId: string): Promise<ClientAsanaProject[]> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA' },
        },
      },
    });

    if (!client) {
      throw new AsanaIntegrationError(404, 'Cliente não encontrado.');
    }

    if (client.integrations.length === 0) {
      return [];
    }

    let token: string | null = null;
    try {
      const auth = await this.getValidToken(organizationId);
      token = auth.token;
    } catch {
      // Se Asana não estiver conectado, retorna os dados estáticos salvos no metadata
      token = null;
    }

    const now = new Date();
    const result: ClientAsanaProject[] = [];

    for (const integration of client.integrations) {
      const meta = (integration.metadata as any) || {};
      let totalTasks = 0;
      let completedTasks = 0;
      let pendingTasks = 0;
      let overdueTasks = 0;
      let projectName = meta.projectName || `Projeto Asana (${integration.externalId})`;
      let color = meta.color || null;

      if (token) {
        try {
          // Busca detalhes do projeto e tarefas
          const [projectDetails, tasks] = await Promise.all([
            this.fetchAsana<any>(`/projects/${integration.externalId}?opt_fields=name,color`, token).catch(() => null),
            this.fetchAsana<any[]>(
              `/projects/${integration.externalId}/tasks?opt_fields=name,completed,due_on,due_at`,
              token
            ).catch(() => []),
          ]);

          if (projectDetails?.name) {
            projectName = projectDetails.name;
            color = projectDetails.color || color;
          }

          totalTasks = tasks.length;
          for (const t of tasks) {
            if (t.completed) {
              completedTasks++;
            } else {
              pendingTasks++;
              if (t.due_on || t.due_at) {
                const dueDate = new Date(t.due_at || `${t.due_on}T23:59:59`);
                if (dueDate < now) {
                  overdueTasks++;
                }
              }
            }
          }
        } catch (err) {
          // Mantém contadores zerados se falhar a chamada individual
        }
      }

      result.push({
        integrationId: integration.id,
        clientId: client.id,
        projectGid: integration.externalId,
        projectName,
        color,
        totalTasks,
        completedTasks,
        pendingTasks,
        overdueTasks,
        createdAt: integration.createdAt,
      });
    }

    return result;
  }

  /**
   * Vincula um ou mais projetos Asana a um cliente em client_integrations.
   */
  async linkProjectsToClient(
    clientId: string,
    organizationId: string,
    projectGids: string[]
  ): Promise<{ linked: number }> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
    });

    if (!client) {
      throw new AsanaIntegrationError(404, 'Cliente não encontrado.');
    }

    if (!projectGids || projectGids.length === 0) {
      throw new AsanaIntegrationError(400, 'Nenhum projeto fornecido para vincular.');
    }

    let token: string | null = null;
    try {
      const auth = await this.getValidToken(organizationId);
      token = auth.token;
    } catch {
      token = null;
    }

    let linkedCount = 0;

    for (const projectGid of projectGids) {
      let projectName = `Projeto ${projectGid}`;
      let color: string | null = null;

      if (token) {
        try {
          const p = await this.fetchAsana<any>(`/projects/${projectGid}?opt_fields=name,color`, token);
          if (p?.name) {
            projectName = p.name;
            color = p.color || null;
          }
        } catch {
          // Prossegue com nome padrão se a consulta falhar
        }
      }

      // Upsert para garantir idempotência sem duplicar
      await prisma.clientIntegration.upsert({
        where: {
          clientId_provider_externalId: {
            clientId,
            provider: 'ASANA',
            externalId: projectGid,
          },
        },
        create: {
          clientId,
          provider: 'ASANA',
          externalId: projectGid,
          metadata: {
            projectName,
            color,
            linkedAt: new Date().toISOString(),
          },
        },
        update: {
          metadata: {
            projectName,
            color,
            updatedAt: new Date().toISOString(),
          },
        },
      });

      // Cria ou assegura webhook ativo para o projeto nesta organização
      await this.createProjectWebhook(organizationId, projectGid).catch((err) => {
        console.warn(`[AsanaService] Não foi possível registrar webhook para o projeto ${projectGid}:`, err?.message || err);
      });

      linkedCount++;
    }

    return { linked: linkedCount };
  }

  /**
   * Desvincula um projeto Asana de um cliente.
   */
  async unlinkProject(clientId: string, organizationId: string, integrationId: string): Promise<void> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
    });

    if (!client) {
      throw new AsanaIntegrationError(404, 'Cliente não encontrado.');
    }

    const integration = await prisma.clientIntegration.findFirst({
      where: {
        id: integrationId,
        clientId,
        provider: 'ASANA',
      },
    });

    if (!integration) {
      throw new AsanaIntegrationError(404, 'Vínculo de integração não encontrado.');
    }

    const projectGid = integration.externalId;

    await prisma.clientIntegration.delete({
      where: { id: integrationId },
    });

    // Se nenhum outro cliente da organização ainda usar este projeto, remove o webhook
    await this.removeProjectWebhookIfNeeded(organizationId, projectGid).catch((err) => {
      console.warn(`[AsanaService] Erro ao verificar/remover webhook do projeto ${projectGid}:`, err?.message || err);
    });
  }

  /**
   * Retorna as tarefas consolidadas de todos os projetos vinculados ao cliente.
   */
  async getClientTasks(clientId: string, organizationId: string): Promise<ClientAsanaTask[]> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA' },
        },
      },
    });

    if (!client) {
      throw new AsanaIntegrationError(404, 'Cliente não encontrado.');
    }

    if (client.integrations.length === 0) {
      return [];
    }

    const { token } = await this.getValidToken(organizationId);
    const now = new Date();
    const allTasks: ClientAsanaTask[] = [];

    for (const integration of client.integrations) {
      const meta = (integration.metadata as any) || {};
      const projectName = meta.projectName || `Projeto ${integration.externalId}`;

      try {
        const tasks = await this.fetchAsana<any[]>(
          `/projects/${integration.externalId}/tasks?opt_fields=name,completed,due_on,due_at,assignee.name,assignee.photo,memberships.section.name,memberships.section.gid,permalink_url`,
          token
        );

        for (const t of tasks) {
          let isOverdue = false;
          if (!t.completed && (t.due_on || t.due_at)) {
            const dueDate = new Date(t.due_at || `${t.due_on}T23:59:59`);
            if (dueDate < now) {
              isOverdue = true;
            }
          }

          const sectionMembership = t.memberships?.find((m: any) => m.section?.name);
          const sectionName = sectionMembership?.section?.name || null;
          const sectionGid = sectionMembership?.section?.gid || null;

          allTasks.push({
            gid: t.gid,
            name: t.name,
            completed: t.completed || false,
            dueOn: t.due_on || null,
            dueAt: t.due_at || null,
            isOverdue,
            sectionName,
            sectionGid,
            assignee: t.assignee
              ? {
                  gid: t.assignee.gid,
                  name: t.assignee.name,
                  photoUrl: t.assignee.photo?.image_60x60 || null,
                }
              : null,
            permalinkUrl: t.permalink_url || `https://app.asana.com/0/${integration.externalId}/${t.gid}`,
            projectGid: integration.externalId,
            projectName,
          });
        }
      } catch (err) {
        // Prossegue com os outros projetos caso algum falhe
      }
    }

    // Ordenação: primeiro pendentes (atrasadas primeiro), depois concluídas
    return allTasks.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      if (a.isOverdue !== b.isOverdue) {
        return a.isOverdue ? -1 : 1;
      }
      if (a.dueOn && b.dueOn) {
        return a.dueOn.localeCompare(b.dueOn);
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Busca os dados detalhados de uma única tarefa no Asana.
   * Valida estritamente se a tarefa pertence a um dos projetos vinculados ao cliente.
   */
  async getClientSingleTask(
    clientId: string,
    organizationId: string,
    taskGid: string
  ): Promise<ClientAsanaTask | null> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA' },
        },
      },
    });

    if (!client || client.integrations.length === 0) {
      return null;
    }

    const { token } = await this.getValidToken(organizationId);
    const now = new Date();

    try {
      const t = await this.fetchAsana<any>(
        `/tasks/${taskGid}?opt_fields=name,completed,due_on,due_at,notes,assignee.name,assignee.photo,memberships.section.name,memberships.section.gid,memberships.project.name,memberships.project.gid,permalink_url,projects.gid,projects.name,tags.name,custom_fields.name,custom_fields.display_value,custom_fields.resource_subtype`,
        token
      );

      if (!t || !t.gid) return null;

      const clientProjectGids = new Set(client.integrations.map((i) => i.externalId));
      const matchingProject = t.projects?.find((p: any) => clientProjectGids.has(p.gid));

      // Validação estrita de pertencimento: impede acesso a tarefas fora dos projetos vinculados ao cliente
      if (!matchingProject) {
        throw new AsanaIntegrationError(403, 'A tarefa informada não pertence aos projetos Asana vinculados a este cliente.');
      }

      let isOverdue = false;
      if (!t.completed && (t.due_on || t.due_at)) {
        const dueDate = new Date(t.due_at || `${t.due_on}T23:59:59`);
        if (dueDate < now) {
          isOverdue = true;
        }
      }

      const sectionMembership = t.memberships?.find((m: any) => m.section?.name);
      const sectionName = sectionMembership?.section?.name || null;
      const sectionGid = sectionMembership?.section?.gid || null;

      const projectGid = matchingProject.gid;
      const meta = (client.integrations.find((i) => i.externalId === projectGid)?.metadata as any) || {};
      const projectName = matchingProject.name || meta.projectName || `Projeto ${projectGid}`;

      const tags: AsanaTag[] = Array.isArray(t.tags)
        ? t.tags.map((tag: any) => ({ gid: tag.gid, name: tag.name }))
        : [];

      const customFields: AsanaCustomField[] = Array.isArray(t.custom_fields)
        ? t.custom_fields
            .filter((cf: any) => cf.display_value !== null && cf.display_value !== undefined && cf.display_value !== '')
            .map((cf: any) => ({
              gid: cf.gid,
              name: cf.name,
              value: String(cf.display_value),
              type: cf.resource_subtype || 'text',
            }))
        : [];

      return {
        gid: t.gid,
        name: t.name,
        notes: t.notes || null,
        completed: t.completed || false,
        dueOn: t.due_on || null,
        dueAt: t.due_at || null,
        isOverdue,
        sectionName,
        sectionGid,
        assignee: t.assignee
          ? {
              gid: t.assignee.gid,
              name: t.assignee.name,
              photoUrl: t.assignee.photo?.image_60x60 || null,
            }
          : null,
        permalinkUrl: t.permalink_url || `https://app.asana.com/0/${projectGid}/${t.gid}`,
        projectGid,
        projectName,
        tags,
        customFields,
      };
    } catch (err: any) {
      if (err instanceof AsanaIntegrationError) {
        throw err;
      }
      if (err?.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Atualiza uma tarefa existente no Asana.
   * Validação prévia de pertencimento obrigatória (ADMIN/MANAGER).
   */
  async updateClientTask(
    clientId: string,
    organizationId: string,
    taskGid: string,
    data: {
      name?: string;
      notes?: string | null;
      completed?: boolean;
      due_on?: string | null;
      due_at?: string | null;
      assignee?: string | null;
    }
  ): Promise<ClientAsanaTask> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA' },
        },
      },
    });

    if (!client || client.integrations.length === 0) {
      throw new AsanaIntegrationError(404, 'Cliente ou projetos vinculados não encontrados.');
    }

    const { token } = await this.getValidToken(organizationId);

    // Validação de pertencimento no Asana
    const existing = await this.fetchAsana<any>(`/tasks/${taskGid}?opt_fields=projects.gid`, token);
    if (!existing || !existing.gid) {
      throw new AsanaIntegrationError(404, 'Tarefa não encontrada no Asana.');
    }

    const clientProjectGids = new Set(client.integrations.map((i) => i.externalId));
    const belongsToClient = existing.projects?.some((p: any) => clientProjectGids.has(p.gid));

    if (!belongsToClient) {
      throw new AsanaIntegrationError(403, 'A tarefa informada não pertence aos projetos vinculados a este cliente.');
    }

    const payloadData: Record<string, any> = {};
    if (data.name !== undefined) payloadData.name = data.name;
    if (data.notes !== undefined) payloadData.notes = data.notes ?? '';
    if (data.completed !== undefined) payloadData.completed = data.completed;
    if (data.due_on !== undefined) payloadData.due_on = data.due_on;
    if (data.due_at !== undefined) payloadData.due_at = data.due_at;
    if (data.assignee !== undefined) payloadData.assignee = data.assignee;

    if (Object.keys(payloadData).length > 0) {
      await this.fetchAsana(`/tasks/${taskGid}`, token, {
        method: 'PUT',
        body: JSON.stringify({ data: payloadData }),
      });
    }

    // Se uma nova seção foi especificada, move a tarefa para ela
    if (data.sectionGid) {
      await this.fetchAsana(`/sections/${data.sectionGid}/addTask`, token, {
        method: 'POST',
        body: JSON.stringify({ data: { task: taskGid } }),
      }).catch((err) => {
        console.warn(`[AsanaService] Falha ao mover tarefa ${taskGid} para seção ${data.sectionGid}:`, err);
      });
    }

    const updated = await this.getClientSingleTask(clientId, organizationId, taskGid);
    if (!updated) {
      throw new AsanaIntegrationError(500, 'Não foi possível recuperar a tarefa atualizada do Asana.');
    }

    return updated;
  }

  /**
   * Retorna as seções válidas de um projeto Asana vinculado ao cliente.
   */
  async getProjectSections(
    clientId: string,
    organizationId: string,
    projectGid: string
  ): Promise<AsanaSection[]> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA', externalId: projectGid },
        },
      },
    });

    if (!client || client.integrations.length === 0) {
      throw new AsanaIntegrationError(404, 'Projeto não encontrado ou não vinculado a este cliente.');
    }

    const { token } = await this.getValidToken(organizationId);

    try {
      const sections = await this.fetchAsana<any[]>(
        `/projects/${projectGid}/sections?opt_fields=name`,
        token
      );

      if (!Array.isArray(sections)) return [];

      return sections.map((s) => ({
        gid: s.gid,
        name: s.name,
      }));
    } catch (err: any) {
      console.warn(`[AsanaService] Falha ao buscar seções do projeto ${projectGid}:`, err);
      return [];
    }
  }

  /**
   * Move uma tarefa para uma seção específica no Asana.
   * Valida obrigatoriamente se a tarefa e o projeto pertencem ao cliente informado.
   */
  async moveTaskSection(
    clientId: string,
    organizationId: string,
    taskGid: string,
    sectionGid: string
  ): Promise<ClientAsanaTask> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA' },
        },
      },
    });

    if (!client || client.integrations.length === 0) {
      throw new AsanaIntegrationError(404, 'Cliente ou projetos vinculados não encontrados.');
    }

    const { token } = await this.getValidToken(organizationId);

    // Validação de pertencimento no Asana
    const existing = await this.fetchAsana<any>(`/tasks/${taskGid}?opt_fields=projects.gid`, token);
    if (!existing || !existing.gid) {
      throw new AsanaIntegrationError(404, 'Tarefa não encontrada no Asana.');
    }

    const clientProjectGids = new Set(client.integrations.map((i) => i.externalId));
    const belongsToClient = existing.projects?.some((p: any) => clientProjectGids.has(p.gid));

    if (!belongsToClient) {
      throw new AsanaIntegrationError(403, 'A tarefa informada não pertence aos projetos vinculados a este cliente.');
    }

    // Executa a movimentação da tarefa para a seção desejada no Asana
    await this.fetchAsana(`/sections/${sectionGid}/addTask`, token, {
      method: 'POST',
      body: JSON.stringify({
        data: {
          task: taskGid,
        },
      }),
    });

    const updated = await this.getClientSingleTask(clientId, organizationId, taskGid);
    if (!updated) {
      throw new AsanaIntegrationError(500, 'Não foi possível recuperar a tarefa após mover de seção.');
    }

    return updated;
  }

  /**
   * Helper privado para validar se a tarefa informada pertence a projetos vinculados ao cliente
   */
  private async validateTaskBelongsToClient(
    clientId: string,
    organizationId: string,
    taskGid: string
  ): Promise<{ token: string; task: any }> {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: {
        integrations: {
          where: { provider: 'ASANA' },
        },
      },
    });

    if (!client || client.integrations.length === 0) {
      throw new AsanaIntegrationError(404, 'Cliente ou projetos vinculados não encontrados.');
    }

    const { token } = await this.getValidToken(organizationId);
    const task = await this.fetchAsana<any>(`/tasks/${taskGid}?opt_fields=projects.gid,parent.projects.gid`, token);
    if (!task || !task.gid) {
      throw new AsanaIntegrationError(404, 'Tarefa não encontrada no Asana.');
    }

    const clientProjectGids = new Set(client.integrations.map((i) => i.externalId));
    const belongsDirectly = task.projects?.some((p: any) => clientProjectGids.has(p.gid));
    const belongsViaParent = task.parent?.projects?.some((p: any) => clientProjectGids.has(p.gid));

    if (!belongsDirectly && !belongsViaParent) {
      throw new AsanaIntegrationError(403, 'A tarefa informada não pertence aos projetos vinculados a este cliente.');
    }

    return { token, task };
  }

  /**
   * Lista subtarefas de uma tarefa Asana vinculada ao cliente.
   */
  async getTaskSubtasks(
    clientId: string,
    organizationId: string,
    taskGid: string
  ): Promise<AsanaSubtask[]> {
    const { token } = await this.validateTaskBelongsToClient(clientId, organizationId, taskGid);

    try {
      const subtasks = await this.fetchAsana<any[]>(
        `/tasks/${taskGid}/subtasks?opt_fields=name,completed,due_on,due_at,assignee.name,assignee.photo`,
        token
      );

      if (!Array.isArray(subtasks)) return [];

      return subtasks.map((st) => ({
        gid: st.gid,
        name: st.name || 'Subtarefa sem título',
        completed: Boolean(st.completed),
        dueOn: st.due_on || null,
        dueAt: st.due_at || null,
        assignee: st.assignee
          ? {
              gid: st.assignee.gid,
              name: st.assignee.name,
              photoUrl: st.assignee.photo?.image_60x60 || null,
            }
          : null,
      }));
    } catch (err: any) {
      if (err instanceof AsanaIntegrationError) throw err;
      console.warn(`[AsanaService] Erro ao buscar subtarefas da tarefa ${taskGid}:`, err);
      return [];
    }
  }

  /**
   * Cria uma nova subtarefa no Asana.
   */
  async createTaskSubtask(
    clientId: string,
    organizationId: string,
    taskGid: string,
    data: {
      name: string;
      due_on?: string | null;
      assignee?: string | null;
    }
  ): Promise<AsanaSubtask> {
    const { token } = await this.validateTaskBelongsToClient(clientId, organizationId, taskGid);

    const payload: Record<string, any> = {
      name: data.name.trim(),
    };
    if (data.due_on) payload.due_on = data.due_on;
    if (data.assignee) payload.assignee = data.assignee;

    const res = await this.fetchAsana<any>(`/tasks/${taskGid}/subtasks`, token, {
      method: 'POST',
      body: JSON.stringify({ data: payload }),
    });

    if (!res || !res.gid) {
      throw new AsanaIntegrationError(500, 'Não foi possível criar a subtarefa no Asana.');
    }

    // Busca dados populados da subtarefa criada
    const created = await this.fetchAsana<any>(
      `/tasks/${res.gid}?opt_fields=name,completed,due_on,due_at,assignee.name,assignee.photo`,
      token
    );

    return {
      gid: created.gid,
      name: created.name || data.name,
      completed: Boolean(created.completed),
      dueOn: created.due_on || null,
      dueAt: created.due_at || null,
      assignee: created.assignee
        ? {
            gid: created.assignee.gid,
            name: created.assignee.name,
            photoUrl: created.assignee.photo?.image_60x60 || null,
          }
        : null,
    };
  }

  /**
   * Lista histórico de comentários e atividades (stories) da tarefa.
   */
  async getTaskStories(
    clientId: string,
    organizationId: string,
    taskGid: string
  ): Promise<AsanaStory[]> {
    const { token } = await this.validateTaskBelongsToClient(clientId, organizationId, taskGid);

    try {
      const stories = await this.fetchAsana<any[]>(
        `/tasks/${taskGid}/stories?opt_fields=text,html_text,created_at,created_by.name,created_by.photo,type,resource_subtype`,
        token
      );

      if (!Array.isArray(stories)) return [];

      return stories
        .filter((s) => Boolean(s.text || s.html_text))
        .map((s) => ({
          gid: s.gid,
          text: s.text || '',
          htmlText: s.html_text || null,
          type: s.resource_subtype === 'comment_added' || s.type === 'comment' ? ('comment' as const) : ('system' as const),
          createdAt: s.created_at || new Date().toISOString(),
          createdBy: s.created_by
            ? {
                gid: s.created_by.gid,
                name: s.created_by.name,
                photoUrl: s.created_by.photo?.image_60x60 || null,
              }
            : null,
        }));
    } catch (err: any) {
      if (err instanceof AsanaIntegrationError) throw err;
      console.warn(`[AsanaService] Erro ao buscar stories da tarefa ${taskGid}:`, err);
      return [];
    }
  }

  /**
   * Adiciona um comentário oficial na tarefa do Asana.
   */
  async addTaskComment(
    clientId: string,
    organizationId: string,
    taskGid: string,
    text: string
  ): Promise<AsanaStory> {
    const { token } = await this.validateTaskBelongsToClient(clientId, organizationId, taskGid);

    const res = await this.fetchAsana<any>(`/tasks/${taskGid}/stories`, token, {
      method: 'POST',
      body: JSON.stringify({
        data: {
          text: text.trim(),
        },
      }),
    });

    if (!res || !res.gid) {
      throw new AsanaIntegrationError(500, 'Não foi possível adicionar o comentário no Asana.');
    }

    return {
      gid: res.gid,
      text: res.text || text,
      htmlText: res.html_text || null,
      type: 'comment',
      createdAt: res.created_at || new Date().toISOString(),
      createdBy: res.created_by
        ? {
            gid: res.created_by.gid,
            name: res.created_by.name,
            photoUrl: res.created_by.photo?.image_60x60 || null,
          }
        : null,
    };
  }

  /**
   * Lista anexos vinculados a uma tarefa no Asana Cloud.
   */
  async getTaskAttachments(
    clientId: string,
    organizationId: string,
    taskGid: string
  ): Promise<AsanaAttachment[]> {
    const { token } = await this.validateTaskBelongsToClient(clientId, organizationId, taskGid);

    try {
      const attachments = await this.fetchAsana<any[]>(
        `/tasks/${taskGid}/attachments?opt_fields=name,download_url,view_url,permanent_url,host,size,created_at`,
        token
      );

      if (!Array.isArray(attachments)) return [];

      return attachments.map((att) => ({
        gid: att.gid,
        name: att.name || 'Anexo sem nome',
        downloadUrl: att.download_url || null,
        viewUrl: att.view_url || null,
        permanentUrl: att.permanent_url || null,
        host: att.host || 'asana',
        size: typeof att.size === 'number' ? att.size : null,
        createdAt: att.created_at || new Date().toISOString(),
      }));
    } catch (err: any) {
      if (err instanceof AsanaIntegrationError) throw err;
      console.warn(`[AsanaService] Erro ao buscar anexos da tarefa ${taskGid}:`, err);
      return [];
    }
  }

  /**
   * Envia anexo multipart diretamente ao Asana Cloud (sem retenção em disco na VPS).
   */
  async uploadTaskAttachment(
    clientId: string,
    organizationId: string,
    taskGid: string,
    fileBuffer: Buffer,
    filename: string,
    mimetype: string
  ): Promise<AsanaAttachment> {
    const { token } = await this.validateTaskBelongsToClient(clientId, organizationId, taskGid);

    const formData = new FormData();
    const fileBlob = new Blob([fileBuffer], { type: mimetype || 'application/octet-stream' });
    formData.append('file', fileBlob, filename);

    const response = await fetch(`${this.asanaBaseUrl}/tasks/${taskGid}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[AsanaService] Erro no upload multipart para o Asana (${response.status}):`, errText);
      throw new AsanaIntegrationError(
        response.status,
        `Falha ao enviar arquivo para o Asana Cloud: ${errText}`
      );
    }

    const json = (await response.json()) as any;
    const att = json.data;

    return {
      gid: att.gid,
      name: att.name || filename,
      downloadUrl: att.download_url || null,
      viewUrl: att.view_url || null,
      permanentUrl: att.permanent_url || null,
      host: att.host || 'asana',
      size: typeof att.size === 'number' ? att.size : fileBuffer.length,
      createdAt: att.created_at || new Date().toISOString(),
    };
  }

  /**
   * Retorna os membros do workspace Asana para atribuição de responsável.
   */
  async getWorkspaceUsers(organizationId: string): Promise<AsanaUser[]> {
    const { token, workspaceId: storedWorkspaceId } = await this.getValidToken(organizationId);

    let workspaceId = storedWorkspaceId;
    if (!workspaceId) {
      const workspaces = await this.fetchAsana<any[]>('/workspaces', token);
      workspaceId = workspaces?.[0]?.gid;
    }

    if (!workspaceId) {
      return [];
    }

    try {
      const users = await this.fetchAsana<any[]>(
        `/workspaces/${workspaceId}/users?opt_fields=name,email,photo.image_60x60`,
        token
      );

      if (!Array.isArray(users)) return [];

      return users
        .map((u) => ({
          gid: u.gid,
          name: u.name,
          email: u.email || null,
          photoUrl: u.photo?.image_60x60 || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.warn('[AsanaService] Falha ao obter usuários do workspace:', err);
      return [];
    }
  }

  /**
   * Renovação automática do token OAuth via Refresh Token no backend.
   */
  private async refreshToken(integrationId: string, refreshToken: string): Promise<{ accessToken: string }> {
    const clientId = process.env.ASANA_CLIENT_ID;
    const clientSecret = process.env.ASANA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new AsanaIntegrationError(500, 'Configurações de OAuth do Asana ausentes no servidor.');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch('https://app.asana.com/-/oauth_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new AsanaIntegrationError(response.status, 'Falha ao renovar token do Asana.');
    }

    const data = await response.json();
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;

    await prisma.organizationIntegration.update({
      where: { id: integrationId },
      data: {
        accessToken: encryptToken(data.access_token),
        refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : encryptToken(refreshToken),
        expiresAt,
        updatedAt: new Date(),
      },
    });

    return { accessToken: data.access_token };
  }

  /**
   * Troca o Authorization Code retornado pelo Asana por Access Token e Refresh Token no backend.
   */
  async exchangeOAuthCode(organizationId: string, code: string, redirectUri: string): Promise<void> {
    const clientId = process.env.ASANA_CLIENT_ID;
    const clientSecret = process.env.ASANA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new AsanaIntegrationError(500, 'Credenciais ASANA_CLIENT_ID ou ASANA_CLIENT_SECRET não configuradas no servidor.');
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    const response = await fetch('https://app.asana.com/-/oauth_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new AsanaIntegrationError(response.status, err.error_description || 'Falha ao autenticar com o Asana.');
    }

    const tokenData = await response.json();
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    const workspaceId = tokenData.data?.workspaces?.[0]?.gid || null;

    const encryptedAccessToken = encryptToken(tokenData.access_token);
    const encryptedRefreshToken = tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null;

    await prisma.organizationIntegration.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider: 'ASANA',
        },
      },
      create: {
        organizationId,
        provider: 'ASANA',
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        workspaceId,
        metadata: {
          userGid: tokenData.data?.gid,
          userName: tokenData.data?.name,
          userEmail: tokenData.data?.email,
          connectedAt: new Date().toISOString(),
        },
      },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken || undefined,
        expiresAt,
        workspaceId,
        metadata: {
          userGid: tokenData.data?.gid,
          userName: tokenData.data?.name,
          userEmail: tokenData.data?.email,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Tenta revogar o token OAuth no servidor do Asana (RFC 7009).
   * Falhas de rede ou tokens já revogados são silenciadas para garantir que a desconexão local sempre ocorra.
   */
  private async revokeToken(token: string): Promise<void> {
    try {
      const clientId = process.env.ASANA_CLIENT_ID;
      const clientSecret = process.env.ASANA_CLIENT_SECRET;
      if (!clientId || !clientSecret || !token) return;

      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token,
      });

      await fetch('https://app.asana.com/-/oauth_revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }).catch(() => {});
    } catch {
      // Falha remota não bloqueia o expurgo local seguro
    }
  }

  /**
   * Desconecta completamente o Asana da organização:
   * 1. Revoga o token no Asana (se possível)
   * 2. Remove os vínculos ClientIntegration do provedor ASANA pertencentes aos clientes da organização
   * 3. Exclui o registro OrganizationIntegration do Asana
   * 4. NÃO envia nenhuma deleção para projetos ou tarefas reais no Asana
   */
  async disconnect(organizationId: string): Promise<void> {
    // 1. Localiza a integração da organização
    const orgIntegration = await prisma.organizationIntegration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: 'ASANA',
        },
      },
    });

    if (!orgIntegration) {
      throw new AsanaIntegrationError(404, 'Nenhuma integração Asana ativa encontrada para esta organização.');
    }

    // 2. Remove todos os webhooks remotos e locais da organização
    await this.removeAllWebhooks(organizationId).catch(() => {});

    // 3. Revogação remota segura de tokens (sem expor credenciais em logs)
    try {
      const refreshToken = orgIntegration.refreshToken ? decryptToken(orgIntegration.refreshToken) : null;
      const accessToken = orgIntegration.accessToken ? decryptToken(orgIntegration.accessToken) : null;

      if (refreshToken) {
        await this.revokeToken(refreshToken);
      } else if (accessToken) {
        await this.revokeToken(accessToken);
      }
    } catch {
      // Prossegue mesmo se a chamada remota falhar
    }

    // 4. Remove os vínculos locais de projetos pertencentes a clientes desta organização
    const organizationClients = await prisma.client.findMany({
      where: { organizationId },
      select: { id: true },
    });

    const clientIds = organizationClients.map((c) => c.id);
    if (clientIds.length > 0) {
      await prisma.clientIntegration.deleteMany({
        where: {
          clientId: { in: clientIds },
          provider: 'ASANA',
        },
      });
    }

    // 5. Remove a integração da organização no PostgreSQL
    await prisma.organizationIntegration.delete({
      where: { id: orgIntegration.id },
    });
  }

  /**
   * Retorna a URL base para receber webhooks do Asana.
   */
  getWebhookBaseUrl(): string {
    if (process.env.WEBHOOK_BASE_URL) return process.env.WEBHOOK_BASE_URL.replace(/\/$/, '');
    if (process.env.API_BASE_URL) return process.env.API_BASE_URL.replace(/\/$/, '');
    return 'https://zafira-hub-v2-api.hvrb9d.easypanel.host';
  }

  /**
   * Cria ou assegura assinatura de webhook ativa para o projeto na organização.
   */
  async createProjectWebhook(organizationId: string, projectGid: string) {
    // 1. Verifica se já existe webhook para este projeto na organização
    const existing = await prisma.asanaWebhookSubscription.findUnique({
      where: {
        organizationId_resourceGid: {
          organizationId,
          resourceGid: projectGid,
        },
      },
    });

    if (existing && existing.active) {
      return existing;
    }

    const subscriptionId = existing?.id || crypto.randomUUID();
    const target = `${this.getWebhookBaseUrl()}/integrations/asana/webhooks/${subscriptionId}`;
    const initialSecret = existing?.secret || encryptToken('pending_handshake');

    const subscription = existing
      ? await prisma.asanaWebhookSubscription.update({
          where: { id: existing.id },
          data: { target, updatedAt: new Date() },
        })
      : await prisma.asanaWebhookSubscription.create({
          data: {
            id: subscriptionId,
            organizationId,
            resourceGid: projectGid,
            target,
            secret: initialSecret,
            active: false,
          },
        });

    // 2. Tenta registrar o webhook no Asana via API oficial
    try {
      const { token } = await this.getValidToken(organizationId);
      const res = await this.fetchAsana<any>('/webhooks', token, {
        method: 'POST',
        body: JSON.stringify({
          data: {
            resource: projectGid,
            target,
          },
        }),
      });

      if (res?.gid) {
        await prisma.asanaWebhookSubscription.update({
          where: { id: subscription.id },
          data: { webhookGid: res.gid },
        });
      }
    } catch {
      // Falha no registro remoto (ex: em desenvolvimento sem IP público) não impede fluxo
    }

    return subscription;
  }

  /**
   * Remove o webhook remoto no Asana e localmente se nenhum outro cliente da mesma organização usar o projeto.
   */
  async removeProjectWebhookIfNeeded(organizationId: string, projectGid: string): Promise<void> {
    const orgClients = await prisma.client.findMany({
      where: { organizationId },
      select: { id: true },
    });

    const clientIds = orgClients.map((c) => c.id);
    const remainingCount = await prisma.clientIntegration.count({
      where: {
        clientId: { in: clientIds },
        provider: 'ASANA',
        externalId: projectGid,
      },
    });

    // Se ainda houver vínculo em outro cliente da mesma organização, mantém o webhook
    if (remainingCount > 0) {
      return;
    }

    const sub = await prisma.asanaWebhookSubscription.findUnique({
      where: {
        organizationId_resourceGid: {
          organizationId,
          resourceGid: projectGid,
        },
      },
    });

    if (!sub) return;

    if (sub.webhookGid) {
      try {
        const { token } = await this.getValidToken(organizationId);
        await this.fetchAsana(`/webhooks/${sub.webhookGid}`, token, { method: 'DELETE' }).catch(() => {});
      } catch {}
    }

    await prisma.asanaWebhookSubscription.delete({
      where: { id: sub.id },
    });
  }

  /**
   * Remove todos os webhooks da organização ao desconectar a conta.
   */
  async removeAllWebhooks(organizationId: string): Promise<void> {
    const subs = await prisma.asanaWebhookSubscription.findMany({
      where: { organizationId },
    });

    if (subs.length === 0) return;

    try {
      const { token } = await this.getValidToken(organizationId);
      for (const sub of subs) {
        if (sub.webhookGid) {
          await this.fetchAsana(`/webhooks/${sub.webhookGid}`, token, { method: 'DELETE' }).catch(() => {});
        }
      }
    } catch {}

    await prisma.asanaWebhookSubscription.deleteMany({
      where: { organizationId },
    });
  }

  /**
   * Processa o handshake do Asana salvando o secret criptografado e ativando a subscription.
   */
  async handleWebhookHandshake(subscriptionId: string, xHookSecret: string): Promise<void> {
    const encryptedSecret = encryptToken(xHookSecret);

    const sub = await prisma.asanaWebhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        secret: encryptedSecret,
        active: true,
        updatedAt: new Date(),
      },
    });

    console.log(`[Asana Webhook] handshake recebido subscriptionId=${subscriptionId} resourceGid=${sub.resourceGid} handshake=success`);
  }

  /**
   * Valida a assinatura HMAC-SHA256 e retorna a subscription em uma única consulta ao banco.
   */
  async verifyAndGetSubscription(subscriptionId: string, signature: string, rawBody: string) {
    const sub = await prisma.asanaWebhookSubscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!sub || !sub.secret || !signature) {
      return null;
    }

    try {
      const plainSecret = decryptToken(sub.secret);
      const computedSignature = crypto.createHmac('sha256', plainSecret).update(rawBody).digest('hex');

      const sigBuffer = Buffer.from(signature);
      const computedBuffer = Buffer.from(computedSignature);

      if (sigBuffer.length !== computedBuffer.length) {
        return null;
      }

      if (!crypto.timingSafeEqual(sigBuffer, computedBuffer)) {
        return null;
      }

      return sub;
    } catch {
      return null;
    }
  }

  /**
   * Valida a assinatura HMAC-SHA256 do webhook usando o payload bruto (compatibilidade legada).
   */
  async verifyWebhookSignature(subscriptionId: string, signature: string, rawBody: string): Promise<boolean> {
    const sub = await this.verifyAndGetSubscription(subscriptionId, signature, rawBody);
    return sub !== null;
  }

  /**
   * Processa os eventos e publica via SSE imediatamente, gravando no banco em background para latência zero.
   */
  processWebhookPayloadFast(sub: any, payload: any, tWebhookReceived: number): void {
    // 1. Atualiza lastEventAt no PostgreSQL em background (fire-and-forget, sem bloquear SSE)
    prisma.asanaWebhookSubscription.update({
      where: { id: sub.id },
      data: { lastEventAt: new Date() },
    }).catch((err) => {
      console.warn(`[Asana Webhook] Falha assíncrona ao atualizar lastEventAt:`, err?.message || err);
    });

    const events = Array.isArray(payload?.events) ? payload.events : [];
    const tServerPublished = Date.now();

    for (const event of events) {
      const resType = event.resource?.resource_type || 'task';
      const action = event.action || 'changed';

      const normalized: AsanaNormalizedEvent = {
        type: `asana.${resType}.${action}`,
        organizationId: sub.organizationId,
        projectGid: sub.resourceGid,
        resourceGid: event.resource?.gid,
        resourceType: resType,
        action,
        timestamp: event.created_at || new Date().toISOString(),
        details: event,
        timing: {
          asanaCreatedAt: event.created_at || null,
          serverReceivedAt: tWebhookReceived,
          serverPublishedAt: tServerPublished,
        },
      };

      sseHub.publishToOrganization(sub.organizationId, normalized);
    }
  }

  /**
   * Processa os eventos recebidos pelo webhook (compatibilidade).
   */
  async processWebhookPayload(subscriptionId: string, payload: any): Promise<void> {
    const sub = await prisma.asanaWebhookSubscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!sub) return;
    this.processWebhookPayloadFast(sub, payload, Date.now());
  }

  /**
   * Retorna diagnóstico seguro do pipeline de webhooks e SSE para a organização (ADMIN).
   */
  async getDiagnostics(organizationId: string) {
    let tableExists = false;
    let subscriptions: any[] = [];
    let dbError: string | null = null;

    try {
      const check = await prisma.$queryRaw<any[]>`
        SELECT to_regclass('public.asana_webhook_subscriptions') as table_name;
      `;
      tableExists = check && check[0] && check[0].table_name !== null;

      if (tableExists) {
        subscriptions = await prisma.asanaWebhookSubscription.findMany({
          where: { organizationId },
          select: {
            id: true,
            organizationId: true,
            resourceGid: true,
            webhookGid: true,
            target: true,
            active: true,
            lastEventAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      }
    } catch (err: any) {
      dbError = err?.message || String(err);
    }

    let remoteWebhooks: any = null;
    let remoteError: string | null = null;
    let workspaceId: string | null = null;

    try {
      const auth = await this.getValidToken(organizationId);
      workspaceId = auth.workspaceId || null;
      if (workspaceId) {
        remoteWebhooks = await this.fetchAsana(`/webhooks?workspace=${workspaceId}`, auth.token);
      }
    } catch (err: any) {
      remoteError = err?.message || String(err);
    }

    const linkedProjects = await prisma.clientIntegration.findMany({
      where: {
        client: { organizationId },
        provider: 'ASANA',
      },
      select: {
        id: true,
        clientId: true,
        externalId: true,
        metadata: true,
        createdAt: true,
      },
    });

    const activeSSEConnections = sseHub.getActiveConnectionsCount(organizationId);

    return {
      organizationId,
      workspaceId,
      tableExists,
      dbError,
      subscriptions,
      remoteWebhooks,
      remoteError,
      linkedProjects,
      activeSSEConnections,
    };
  }

  /**
   * Sincroniza e garante webhooks remotos e locais para todos os projetos vinculados da organização.
   */
  async syncWebhooks(organizationId: string) {
    const linkedProjects = await prisma.clientIntegration.findMany({
      where: {
        client: { organizationId },
        provider: 'ASANA',
      },
      select: { externalId: true },
    });

    const uniqueGids = Array.from(new Set(linkedProjects.map((p) => p.externalId)));
    const results: any[] = [];

    for (const gid of uniqueGids) {
      try {
        const sub = await this.createProjectWebhook(organizationId, gid);
        results.push({ projectGid: gid, success: true, subscriptionId: sub?.id, active: sub?.active });
      } catch (err: any) {
        results.push({ projectGid: gid, success: false, error: err?.message || String(err) });
      }
    }

    return { synced: results.length, details: results };
  }
}

