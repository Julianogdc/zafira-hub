import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { PrismaClient, IntegrationProvider } from '@prisma/client';
import {
  CommonIntegrationConnector,
  IntegrationCapabilities,
  IntegrationContext,
  TestConnectionResult,
  SyncResult,
  SyncOptions,
  ReconnectResult,
  DisconnectResult,
} from './integration-operations.contract.js';
import {
  IntegrationObservabilityService,
  integrationObservabilityService as defaultObservability,
} from './integration-observability.service.js';
import {
  IntegrationConnectionService,
} from '../connections/integration-connection.service.js';

export class IntegrationRegistryError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'REGISTRY_ERROR') {
    super(message);
    this.name = 'IntegrationRegistryError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, IntegrationRegistryError.prototype);
  }
}

export interface ProviderOverviewItem {
  provider: IntegrationProvider;
  name: string;
  hasConnection: boolean;
  connectionId?: string | null;
  status?: string | null;
  displayName?: string | null;
  externalScopeId?: string | null;
  lastValidatedAt?: Date | string | null;
  capabilities: IntegrationCapabilities;
  lastSync?: {
    id: string;
    status: string;
    operation: string;
    finishedAt?: Date | string | null;
    itemsProcessed: number;
    itemsFailed: number;
  } | null;
  unresolvedErrorsCount: number;
}

const PROVIDER_METADATA_MAP: Record<IntegrationProvider, { name: string }> = {
  ASANA: { name: 'Asana' },
  BRIGHTBEAN: { name: 'BrightBean Studio' },
  ASAAS: { name: 'Asaas' },
  TWENTY: { name: 'Twenty CRM' },
  POSTIZ: { name: 'Postiz (Legado)' },
  META: { name: 'Meta Ads' },
  GOOGLE_ADS: { name: 'Google Ads' },
};

export class IntegrationRegistryService {
  private readonly connectors = new Map<IntegrationProvider, CommonIntegrationConnector>();

  constructor(
    private readonly prisma: PrismaClient = defaultPrisma as any,
    private readonly observability: IntegrationObservabilityService = defaultObservability,
    private readonly connectionService: IntegrationConnectionService = new IntegrationConnectionService(defaultPrisma as any)
  ) {}

  /**
   * Registra um conector para determinado provedor.
   */
  registerConnector(connector: CommonIntegrationConnector): void {
    this.connectors.set(connector.provider, connector);
  }

  /**
   * Obtém o conector registrado para um provider.
   */
  getConnector(provider: IntegrationProvider): CommonIntegrationConnector | undefined {
    return this.connectors.get(provider);
  }

  /**
   * Retorna todos os conectores registrados no momento.
   */
  getAllConnectors(): CommonIntegrationConnector[] {
    return Array.from(this.connectors.values());
  }

  /**
   * Lista visão geral completa de integrações da organização (Central de Integrações).
   */
  async getIntegrationOverview(organizationId: string): Promise<ProviderOverviewItem[]> {
    if (!organizationId) {
      throw new IntegrationRegistryError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }

    // Busca conexões organizacionais ativas/existentes
    const connections = await this.prisma.integrationConnection.findMany({
      where: {
        organizationId,
        clientId: null,
      },
    });

    const connMap = new Map<IntegrationProvider, (typeof connections)[0]>();
    for (const c of connections) {
      connMap.set(c.provider, c);
    }

    const providers = Object.values(IntegrationProvider);
    const overview: ProviderOverviewItem[] = [];

    for (const p of providers) {
      const conn = connMap.get(p);
      const connector = this.connectors.get(p);
      const meta = PROVIDER_METADATA_MAP[p] || { name: p };

      const capabilities: IntegrationCapabilities = connector
        ? connector.getCapabilities()
        : {
            canTestConnection: false,
            canSync: false,
            canReconnect: false,
            canDisconnect: Boolean(conn),
          };

      // Busca último sync run
      const lastSync = await this.prisma.syncRun.findFirst({
        where: { organizationId, provider: p },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          status: true,
          operation: true,
          finishedAt: true,
          itemsProcessed: true,
          itemsFailed: true,
        },
      });

      // Busca contagem de erros não resolvidos
      const unresolvedErrorsCount = await this.prisma.integrationError.count({
        where: { organizationId, provider: p, resolvedAt: null },
      });

      overview.push({
        provider: p,
        name: meta.name,
        hasConnection: Boolean(conn),
        connectionId: conn?.id || null,
        status: conn?.status || 'DISCONNECTED',
        displayName: conn?.displayName || null,
        externalScopeId: conn?.externalScopeId || null,
        lastValidatedAt: conn?.lastValidatedAt || null,
        capabilities,
        lastSync: lastSync
          ? {
              id: lastSync.id,
              status: lastSync.status,
              operation: lastSync.operation,
              finishedAt: lastSync.finishedAt,
              itemsProcessed: lastSync.itemsProcessed,
              itemsFailed: lastSync.itemsFailed,
            }
          : null,
        unresolvedErrorsCount,
      });
    }

    return overview;
  }

  /**
   * Valida se a connectionId fornecida pertence à organização e ao provedor solicitados (Tenant Guard Fail-Closed).
   * Retorna a conexão validada ou null se connectionId não foi informado.
   * Lança 404 CONNECTION_NOT_FOUND se não pertencer à organização/provedor ou não existir.
   */
  private async resolveOwnedConnection(
    organizationId: string,
    provider: IntegrationProvider,
    connectionId?: string | null
  ): Promise<any | null> {
    if (!connectionId) {
      return null;
    }

    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        organizationId,
        provider,
      },
    });

    if (!connection) {
      throw new IntegrationRegistryError(
        'Conexão de integração não encontrada.',
        404,
        'CONNECTION_NOT_FOUND'
      );
    }

    return connection;
  }

  /**
   * Executa teste de conexão canônico para um provedor.
   */
  async testConnection(
    organizationId: string,
    provider: IntegrationProvider,
    connectionId?: string
  ): Promise<TestConnectionResult> {
    const validatedConnection = await this.resolveOwnedConnection(organizationId, provider, connectionId);
    const effectiveConnectionId = validatedConnection?.id;

    const connector = this.connectors.get(provider);
    if (!connector || !connector.testConnection) {
      throw new IntegrationRegistryError(
        `O provedor ${provider} não suporta teste de conexão direto.`,
        400,
        'UNSUPPORTED_OPERATION'
      );
    }

    const ctx: IntegrationContext = {
      organizationId,
      connectionId: effectiveConnectionId,
    };

    try {
      const result = await connector.testConnection(ctx);
      if (result.connected && effectiveConnectionId) {
        await this.prisma.integrationConnection.update({
          where: { id: effectiveConnectionId },
          data: { lastValidatedAt: new Date() },
        });
      }
      return result;
    } catch (err: any) {
      await this.observability.recordError({
        organizationId,
        connectionId: effectiveConnectionId,
        provider,
        operation: 'testConnection',
        code: err.code || 'TEST_CONNECTION_FAILED',
        message: err.message || 'Falha ao testar conexão com o provedor.',
        retryable: true,
      });
      throw err;
    }
  }

  /**
   * Dispara sincronização para um provedor via conector registrado.
   */
  async triggerSync(
    organizationId: string,
    provider: IntegrationProvider,
    connectionId?: string,
    options?: SyncOptions
  ): Promise<SyncResult> {
    const validatedConnection = await this.resolveOwnedConnection(organizationId, provider, connectionId);
    const effectiveConnectionId = validatedConnection?.id;

    const connector = this.connectors.get(provider);
    if (!connector || !connector.sync) {
      throw new IntegrationRegistryError(
        `O provedor ${provider} não suporta operação de sincronização.`,
        400,
        'UNSUPPORTED_OPERATION'
      );
    }

    const ctx: IntegrationContext = {
      organizationId,
      connectionId: effectiveConnectionId,
    };

    return connector.sync(ctx, options);
  }

  /**
   * Desconecta um provedor.
   */
  async disconnect(
    organizationId: string,
    provider: IntegrationProvider,
    connectionId?: string
  ): Promise<DisconnectResult> {
    const validatedConnection = await this.resolveOwnedConnection(organizationId, provider, connectionId);
    const effectiveConnectionId = validatedConnection?.id;

    const connector = this.connectors.get(provider);
    if (connector?.disconnect) {
      const ctx: IntegrationContext = {
        organizationId,
        connectionId: effectiveConnectionId,
      };
      return connector.disconnect(ctx);
    }

    // Fallback padrão se não houver lógica customizada de disconnect no conector
    if (effectiveConnectionId) {
      await this.connectionService.disconnectConnection(organizationId, effectiveConnectionId);
      return { disconnected: true, message: 'Conexão desconectada com sucesso.' };
    }

    const existing = await this.prisma.integrationConnection.findFirst({
      where: { organizationId, provider, clientId: null },
    });

    if (existing) {
      await this.connectionService.disconnectConnection(organizationId, existing.id);
      return { disconnected: true, message: 'Conexão organizacional desconectada.' };
    }

    return { disconnected: true, message: 'Nenhuma conexão ativa encontrada para desconectar.' };
  }

  /**
   * Executa operação de reconexão/autorização para um provedor via conector registrado.
   */
  async reconnect(
    organizationId: string,
    provider: IntegrationProvider,
    connectionId?: string,
    userId?: string | null,
    payload?: any
  ): Promise<ReconnectResult> {
    const validatedConnection = await this.resolveOwnedConnection(organizationId, provider, connectionId);
    const effectiveConnectionId = validatedConnection?.id;

    const connector = this.connectors.get(provider);
    if (!connector || !connector.reconnect) {
      throw new IntegrationRegistryError(
        `O provedor ${provider} não suporta operação de reconexão.`,
        400,
        'UNSUPPORTED_OPERATION'
      );
    }

    const ctx: IntegrationContext = {
      organizationId,
      userId,
      connectionId: effectiveConnectionId,
    };

    return connector.reconnect(ctx, payload);
  }
}

export const integrationRegistryService = new IntegrationRegistryService();

