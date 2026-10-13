import { IntegrationProvider, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import {
  CommonIntegrationConnector,
  DisconnectResult,
  IntegrationCapabilities,
  IntegrationContext,
  TestConnectionResult,
} from '../common/integration-operations.contract.js';
import { BrightBeanProvider } from './brightbean.provider.js';
import {
  IntegrationConnectionService,
  IntegrationConnectionError,
  integrationConnectionService as defaultConnectionService,
} from '../connections/integration-connection.service.js';

export class BrightBeanIntegrationConnector implements CommonIntegrationConnector {
  public readonly provider: IntegrationProvider = 'BRIGHTBEAN';

  constructor(
    private readonly providerImpl: BrightBeanProvider,
    private readonly connectionService: IntegrationConnectionService = defaultConnectionService,
    private readonly prisma: PrismaClient = defaultPrisma as any
  ) {}

  getCapabilities(): IntegrationCapabilities {
    return {
      canTestConnection: true,
      canSync: false,
      canReconnect: false,
      canDisconnect: true,
    };
  }

  private async resolveConnection(
    ctx: IntegrationContext,
    requireActive: boolean = true
  ): Promise<any> {
    if (ctx.connectionId) {
      const conn = await this.prisma.integrationConnection.findFirst({
        where: {
          id: ctx.connectionId,
          organizationId: ctx.organizationId,
          provider: 'BRIGHTBEAN',
          ...(requireActive ? { status: 'ACTIVE' } : {}),
        },
      });

      if (!conn) {
        throw new IntegrationConnectionError(
          'Conexão BrightBean não encontrada para esta organização ou com status incompatível.',
          404,
          'BRIGHTBEAN_CONNECTION_NOT_FOUND'
        );
      }
      return conn;
    }

    const conns = await this.prisma.integrationConnection.findMany({
      where: {
        organizationId: ctx.organizationId,
        provider: 'BRIGHTBEAN',
        clientId: null,
        ...(requireActive ? { status: 'ACTIVE' } : {}),
      },
    });

    if (conns.length === 0) {
      return null;
    }

    if (conns.length > 1) {
      throw new IntegrationConnectionError(
        'AMBIGUOUS_BRIGHTBEAN_CONNECTION: Múltiplas conexões organizacionais BrightBean ativas encontradas. Especifique connectionId.',
        409,
        'AMBIGUOUS_BRIGHTBEAN_CONNECTION'
      );
    }

    return conns[0];
  }

  async testConnection(ctx: IntegrationContext): Promise<TestConnectionResult> {
    try {
      const conn = await this.resolveConnection(ctx, true);

      if (!conn) {
        return {
          connected: false,
          provider: 'BRIGHTBEAN',
          message: 'Nenhuma conexão ativa da BrightBean configurada para esta organização.',
          checkedAt: new Date(),
        };
      }

      const status = await this.providerImpl.getStatus({
        organizationId: ctx.organizationId,
        connectionId: conn.id,
        workspaceId: conn.externalScopeId || undefined,
      });

      return {
        connected: status.connected,
        provider: 'BRIGHTBEAN',
        externalScopeId: status.workspaceId || conn.externalScopeId || null,
        message: status.connected
          ? 'Conexão com a BrightBean validada com sucesso.'
          : 'A integração com a BrightBean não respondeu com status conectado.',
        checkedAt: new Date(),
      };
    } catch (err: any) {
      return {
        connected: false,
        provider: 'BRIGHTBEAN',
        message: err?.message || 'Falha ao testar conexão com a BrightBean.',
        checkedAt: new Date(),
      };
    }
  }

  async disconnect(ctx: IntegrationContext): Promise<DisconnectResult> {
    const conn = await this.resolveConnection(ctx, false);

    if (conn) {
      await this.connectionService.disconnectConnection(ctx.organizationId, conn.id);
    }

    return {
      disconnected: true,
      message: 'Conexão local com a BrightBean desativada com sucesso.',
    };
  }
}
