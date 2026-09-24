import { IntegrationProvider } from '@prisma/client';
import {
  CommonIntegrationConnector,
  IntegrationCapabilities,
  IntegrationContext,
  TestConnectionResult,
  SyncResult,
  SyncOptions,
  ReconnectResult,
  DisconnectResult,
} from '../common/integration-operations.contract.js';
import { AsanaService, asanaService as defaultAsanaService, AsanaIntegrationError } from './asana.service.js';
import {
  IntegrationObservabilityService,
  integrationObservabilityService as defaultObservability,
} from '../common/integration-observability.service.js';
import { createAndPersistOAuthState } from '../../../lib/oauthState.js';
import { prisma } from '../../../lib/prisma.js';
import { buildAsanaAuthorizeUrl, ASANA_OAUTH_SCOPES } from './asana.routes.js';

export class AsanaIntegrationConnector implements CommonIntegrationConnector {
  public readonly provider: IntegrationProvider = 'ASANA';

  constructor(
    private readonly asanaService: AsanaService = defaultAsanaService,
    private readonly observability: IntegrationObservabilityService = defaultObservability,
    private readonly prismaClient: any = prisma
  ) {}

  getCapabilities(): IntegrationCapabilities {
    return {
      canTestConnection: true,
      canSync: true,
      canReconnect: true,
      canDisconnect: true,
    };
  }

  async testConnection(ctx: IntegrationContext): Promise<TestConnectionResult> {
    const status = await this.asanaService.getStatus(ctx.organizationId);
    if (!status.connected) {
      return {
        connected: false,
        provider: 'ASANA',
        message: 'A integração com o Asana não está conectada ou o token é inválido.',
        checkedAt: new Date(),
      };
    }

    return {
      connected: true,
      provider: 'ASANA',
      accountName: status.user?.name || status.workspaceName || null,
      externalScopeId: status.workspaceId || null,
      message: 'Conexão com o Asana validada com sucesso.',
      checkedAt: new Date(),
      details: {
        userGid: status.user?.gid,
        email: status.user?.email,
        workspaceName: status.workspaceName,
      },
    };
  }

  async sync(ctx: IntegrationContext, options?: SyncOptions): Promise<SyncResult> {
    const syncRun = await this.observability.startSyncRun({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      provider: 'ASANA',
      operation: 'sync_projects_and_webhooks',
      metadata: options?.metadata,
    });

    try {
      // 1. Sincroniza webhooks dos projetos vinculados
      const webhookSync = await this.asanaService.syncWebhooks(ctx.organizationId);

      // 2. Valida projetos do workspace
      const projects = await this.asanaService.getWorkspaceProjects(ctx.organizationId);

      const itemsProcessed = projects.length + (webhookSync.synced || 0);
      const itemsSucceeded = itemsProcessed;

      await this.observability.finishSyncRun(syncRun.id, {
        status: 'SUCCESS',
        itemsProcessed,
        itemsSucceeded,
        itemsFailed: 0,
      });

      return {
        syncRunId: syncRun.id,
        status: 'SUCCESS',
        itemsProcessed,
        itemsSucceeded,
        itemsFailed: 0,
        finishedAt: new Date(),
      };
    } catch (err: any) {
      await this.observability.finishSyncRun(syncRun.id, {
        status: 'FAILED',
        itemsProcessed: 0,
        itemsSucceeded: 0,
        itemsFailed: 1,
        errorSummary: err.message || 'Falha ao sincronizar recursos do Asana.',
      });

      await this.observability.recordError({
        organizationId: ctx.organizationId,
        connectionId: ctx.connectionId,
        provider: 'ASANA',
        operation: 'sync',
        code: err.code || 'ASANA_SYNC_ERROR',
        message: err.message || 'Erro durante a sincronização do Asana.',
        retryable: true,
      });

      throw err;
    }
  }

  /**
   * Operação real de reconexão/autorização OAuth gerando state assinado de uso único e URL oficial.
   */
  async reconnect(ctx: IntegrationContext): Promise<ReconnectResult> {
    const clientId = process.env.ASANA_CLIENT_ID;
    if (!clientId) {
      throw new AsanaIntegrationError(500, 'ASANA_CLIENT_ID não configurado no servidor.');
    }

    const redirectUri = process.env.ASANA_REDIRECT_URI || 'https://zafira-hub-v2-api.hvrb9d.easypanel.host/integrations/asana/oauth/callback';
    const userId = ctx.userId || 'system';

    const { stateParam } = await createAndPersistOAuthState(this.prismaClient, ctx.organizationId, userId, 'ASANA');

    const authUrl = buildAsanaAuthorizeUrl({
      clientId,
      redirectUri,
      state: stateParam,
      scopes: ASANA_OAUTH_SCOPES,
    });

    return {
      reconnected: true,
      authUrl,
      message: 'URL de autorização OAuth do Asana gerada com sucesso.',
    };
  }

  async disconnect(ctx: IntegrationContext): Promise<DisconnectResult> {
    await this.asanaService.disconnect(ctx.organizationId);
    return {
      disconnected: true,
      message: 'Integração Asana desconectada e vínculos limpos com sucesso.',
    };
  }
}

export const asanaIntegrationConnector = new AsanaIntegrationConnector();

