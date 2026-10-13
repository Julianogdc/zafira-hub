import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { IntegrationProvider } from '@prisma/client';
import { buildApp } from '../../../../app.js';
import { prisma } from '../../../../lib/prisma.js';
import {
  IntegrationRegistryService,
  IntegrationRegistryError,
} from '../integration-registry.service.js';
import {
  CommonIntegrationConnector,
  IntegrationCapabilities,
  IntegrationContext,
  TestConnectionResult,
  SyncResult,
  ReconnectResult,
  DisconnectResult,
} from '../integration-operations.contract.js';

describe('Tenant Guard para connectionId na Camada Comum de Integrações (Passo 2C1.4)', () => {
  let mockPrisma: any;
  let mockObservability: any;
  let mockConnectionService: any;
  let registry: IntegrationRegistryService;
  let connections: any[];
  let syncRuns: any[];
  let recordedErrors: any[];
  let lastValidatedUpdates: any[];

  // Conector Mock de Teste
  let mockConnector: CommonIntegrationConnector;
  let testConnectionCalls: IntegrationContext[];
  let syncCalls: { ctx: IntegrationContext; options?: any }[];
  let reconnectCalls: { ctx: IntegrationContext; payload?: any }[];
  let disconnectCalls: IntegrationContext[];

  beforeEach(() => {
    connections = [
      {
        id: 'conn-org-a-asana',
        organizationId: 'org-a',
        provider: IntegrationProvider.ASANA,
        status: 'ACTIVE',
        displayName: 'Asana Org A',
        lastValidatedAt: null,
      },
      {
        id: 'conn-org-b-asana',
        organizationId: 'org-b',
        provider: IntegrationProvider.ASANA,
        status: 'ACTIVE',
        displayName: 'Asana Org B',
        lastValidatedAt: null,
      },
      {
        id: 'conn-org-a-brightbean',
        organizationId: 'org-a',
        provider: IntegrationProvider.BRIGHTBEAN,
        status: 'ACTIVE',
        displayName: 'BrightBean Org A',
        lastValidatedAt: null,
      },
    ];

    syncRuns = [];
    recordedErrors = [];
    lastValidatedUpdates = [];
    testConnectionCalls = [];
    syncCalls = [];
    reconnectCalls = [];
    disconnectCalls = [];

    mockPrisma = {
      integrationConnection: {
        findFirst: async (args: any) => {
          const { id, organizationId, provider, clientId } = args.where || {};
          return (
            connections.find((c) => {
              if (id && c.id !== id) return false;
              if (organizationId && c.organizationId !== organizationId) return false;
              if (provider && c.provider !== provider) return false;
              if (clientId === null && c.clientId !== undefined && c.clientId !== null) return false;
              return true;
            }) || null
          );
        },
        findMany: async (args: any) => {
          const { organizationId } = args.where || {};
          return connections.filter((c) => c.organizationId === organizationId);
        },
        update: async (args: any) => {
          lastValidatedUpdates.push(args);
          const conn = connections.find((c) => c.id === args.where.id);
          if (conn) Object.assign(conn, args.data);
          return conn;
        },
      },
      syncRun: {
        findFirst: async () => null,
      },
      integrationError: {
        count: async () => 0,
      },
    };

    mockObservability = {
      recordError: async (err: any) => {
        recordedErrors.push(err);
      },
    };

    mockConnectionService = {
      disconnectConnection: async (organizationId: string, connectionId: string) => {
        disconnectCalls.push({ organizationId, connectionId });
      },
      listConnections: async (orgId: string) => connections.filter((c) => c.organizationId === orgId),
    };

    mockConnector = {
      provider: IntegrationProvider.ASANA,
      getCapabilities(): IntegrationCapabilities {
        return {
          canTestConnection: true,
          canSync: true,
          canReconnect: true,
          canDisconnect: true,
        };
      },
      async testConnection(ctx: IntegrationContext): Promise<TestConnectionResult> {
        testConnectionCalls.push(ctx);
        return { connected: true, message: 'Conectado com sucesso' };
      },
      async sync(ctx: IntegrationContext, options?: any): Promise<SyncResult> {
        syncCalls.push({ ctx, options });
        return { success: true, itemsProcessed: 5, itemsFailed: 0, errors: [] };
      },
      async reconnect(ctx: IntegrationContext, payload?: any): Promise<ReconnectResult> {
        reconnectCalls.push({ ctx, payload });
        return { authorizationUrl: 'https://auth.example.com', state: 'state-123' };
      },
      async disconnect(ctx: IntegrationContext): Promise<DisconnectResult> {
        disconnectCalls.push(ctx);
        return { disconnected: true, message: 'Desconectado com sucesso' };
      },
    };

    registry = new IntegrationRegistryService(
      mockPrisma as any,
      mockObservability as any,
      mockConnectionService as any
    );
    registry.registerConnector(mockConnector);
  });

  // A. testConnection com conexão da própria organização/provider
  it('A. testConnection com conexão da própria organização e provider -> executa connector e atualiza lastValidatedAt', async () => {
    const result = await registry.testConnection('org-a', IntegrationProvider.ASANA, 'conn-org-a-asana');

    assert.strictEqual(result.connected, true);
    assert.strictEqual(testConnectionCalls.length, 1);
    assert.strictEqual(testConnectionCalls[0].organizationId, 'org-a');
    assert.strictEqual(testConnectionCalls[0].connectionId, 'conn-org-a-asana');
    assert.strictEqual(lastValidatedUpdates.length, 1);
    assert.strictEqual(lastValidatedUpdates[0].where.id, 'conn-org-a-asana');
  });

  // B. testConnection com connectionId de outra organização
  it('B. testConnection com connectionId de outra organização -> bloqueia com 404 sem chamar connector nem gravar erros no tenant alheio', async () => {
    await assert.rejects(
      async () => {
        await registry.testConnection('org-a', IntegrationProvider.ASANA, 'conn-org-b-asana');
      },
      (err: any) => {
        assert(err instanceof IntegrationRegistryError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CONNECTION_NOT_FOUND');
        assert.strictEqual(err.message, 'Conexão de integração não encontrada.');
        return true;
      }
    );

    assert.strictEqual(testConnectionCalls.length, 0);
    assert.strictEqual(lastValidatedUpdates.length, 0);
    assert.strictEqual(recordedErrors.length, 0);
  });

  // C. testConnection com ID da mesma organização, mas provider diferente
  it('C. testConnection com connectionId da mesma organização mas provider diferente -> bloqueia com 404', async () => {
    await assert.rejects(
      async () => {
        // conn-org-a-brightbean pertence a org-a, mas seu provider é BRIGHTBEAN, não ASANA
        await registry.testConnection('org-a', IntegrationProvider.ASANA, 'conn-org-a-brightbean');
      },
      (err: any) => {
        assert(err instanceof IntegrationRegistryError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CONNECTION_NOT_FOUND');
        return true;
      }
    );

    assert.strictEqual(testConnectionCalls.length, 0);
    assert.strictEqual(lastValidatedUpdates.length, 0);
  });

  // D. triggerSync com conexão própria
  it('D. triggerSync com conexão própria -> repassa ctx.connectionId validado para o conector', async () => {
    const result = await registry.triggerSync('org-a', IntegrationProvider.ASANA, 'conn-org-a-asana', { dryRun: true });

    assert.strictEqual(result.success, true);
    assert.strictEqual(syncCalls.length, 1);
    assert.strictEqual(syncCalls[0].ctx.organizationId, 'org-a');
    assert.strictEqual(syncCalls[0].ctx.connectionId, 'conn-org-a-asana');
    assert.strictEqual(syncCalls[0].options.dryRun, true);
  });

  // E. triggerSync com conexão de outra organização
  it('E. triggerSync com conexão de outra organização -> bloqueia com 404 sem acionar conector', async () => {
    await assert.rejects(
      async () => {
        await registry.triggerSync('org-a', IntegrationProvider.ASANA, 'conn-org-b-asana');
      },
      (err: any) => {
        assert(err instanceof IntegrationRegistryError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CONNECTION_NOT_FOUND');
        return true;
      }
    );

    assert.strictEqual(syncCalls.length, 0);
  });

  // F. disconnect com connectionId estrangeiro
  it('F. disconnect com connectionId estrangeiro -> bloqueia com 404 sem chamar conector de desconexão', async () => {
    await assert.rejects(
      async () => {
        await registry.disconnect('org-a', IntegrationProvider.ASANA, 'conn-org-b-asana');
      },
      (err: any) => {
        assert(err instanceof IntegrationRegistryError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CONNECTION_NOT_FOUND');
        return true;
      }
    );

    assert.strictEqual(disconnectCalls.length, 0);
  });

  // G. reconnect com connectionId estrangeiro
  it('G. reconnect com connectionId estrangeiro -> bloqueia com 404 sem acionar conector', async () => {
    await assert.rejects(
      async () => {
        await registry.reconnect('org-a', IntegrationProvider.ASANA, 'conn-org-b-asana', 'user-1');
      },
      (err: any) => {
        assert(err instanceof IntegrationRegistryError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CONNECTION_NOT_FOUND');
        return true;
      }
    );

    assert.strictEqual(reconnectCalls.length, 0);
  });

  // H. connectionId omitido
  it('H. connectionId omitido -> aceita e executa fluxo organizacional normal em todas as operações', async () => {
    // 1. testConnection sem connectionId
    const testRes = await registry.testConnection('org-a', IntegrationProvider.ASANA);
    assert.strictEqual(testRes.connected, true);
    assert.strictEqual(testConnectionCalls.length, 1);
    assert.strictEqual(testConnectionCalls[0].connectionId, undefined);

    // 2. triggerSync sem connectionId
    const syncRes = await registry.triggerSync('org-a', IntegrationProvider.ASANA);
    assert.strictEqual(syncRes.success, true);
    assert.strictEqual(syncCalls.length, 1);
    assert.strictEqual(syncCalls[0].ctx.connectionId, undefined);

    // 3. reconnect sem connectionId
    const recRes = await registry.reconnect('org-a', IntegrationProvider.ASANA, undefined, 'user-1');
    assert.strictEqual(recRes.state, 'state-123');
    assert.strictEqual(reconnectCalls.length, 1);
    assert.strictEqual(reconnectCalls[0].ctx.connectionId, undefined);

    // 4. disconnect sem connectionId
    const discRes = await registry.disconnect('org-a', IntegrationProvider.ASANA);
    assert.strictEqual(discRes.disconnected, true);
    assert.strictEqual(disconnectCalls.length, 1);
    assert.strictEqual(disconnectCalls[0].connectionId, undefined);
  });
});

test('HTTP Route Tenant Isolation & Body Validation (Passo 2C1.4)', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalUserFindUnique = prisma.user.findUnique;
  const originalMemberFindUnique = prisma.organizationMember.findUnique;
  const originalConnFindFirst = prisma.integrationConnection.findFirst;
  const originalConnUpdate = prisma.integrationConnection.update;

  const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;

  const orgAId = 'org-tenant-a';
  const orgBId = 'org-tenant-b';
  const userIdA = 'user-tenant-a';

  const mockDbConnections = [
    {
      id: 'conn-tenant-a-asana',
      organizationId: orgAId,
      provider: IntegrationProvider.ASANA,
      status: 'ACTIVE',
      displayName: 'Asana Tenant A',
      lastValidatedAt: null,
    },
    {
      id: 'conn-tenant-b-asana',
      organizationId: orgBId,
      provider: IntegrationProvider.ASANA,
      status: 'ACTIVE',
      displayName: 'Asana Tenant B',
      lastValidatedAt: null,
    },
  ];

  let dbUpdates: any[] = [];

  prisma.user.findUnique = (async (args: any) => {
    if (args.where.id === userIdA) {
      return {
        id: userIdA,
        name: 'User A',
        email: 'user-a@zafira.test',
        status: 'ACTIVE',
        memberships: [
          {
            id: 'mem-a',
            organizationId: orgAId,
            role: 'ADMIN',
            status: 'ACTIVE',
            organization: { id: orgAId, name: 'Org A', slug: 'zafira' },
          },
        ],
      };
    }
    return null;
  }) as any;

  prisma.organizationMember.findUnique = (async (args: any) => {
    if (args.where.organizationId_userId?.organizationId === orgAId) {
      return {
        id: 'mem-a',
        organizationId: orgAId,
        userId: userIdA,
        role: 'ADMIN',
        status: 'ACTIVE',
        organization: { id: orgAId, name: 'Org A', slug: 'zafira' },
        user: { status: 'ACTIVE' },
        permissions: [
          { permissionCode: 'integrations.view', allowed: true },
          { permissionCode: 'deliverables.plan', allowed: true },
          { permissionCode: 'integrations.remove', allowed: true },
        ],
      };
    }
    return null;
  }) as any;

  (prisma as any).rolePermission.findUnique = (async () => {
    return { role: 'ADMIN', permissionCode: 'integrations.view' };
  }) as any;

  prisma.integrationConnection.findFirst = (async (args: any) => {
    const { id, organizationId, provider } = args.where || {};
    return (
      mockDbConnections.find((c) => {
        if (id && c.id !== id) return false;
        if (organizationId && c.organizationId !== organizationId) return false;
        if (provider && c.provider !== provider) return false;
        return true;
      }) || null
    );
  }) as any;

  prisma.integrationConnection.update = (async (args: any) => {
    dbUpdates.push(args);
    const conn = mockDbConnections.find((c) => c.id === args.where.id);
    if (conn) Object.assign(conn, args.data);
    return conn;
  }) as any;

  t.after(async () => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
    prisma.integrationConnection.findFirst = originalConnFindFirst;
    prisma.integrationConnection.update = originalConnUpdate;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const tokenUserA = createToken({
    sub: userIdA,
    email: 'user-a@zafira.test',
    activeOrganizationId: orgAId,
  });

  // I. HTTP route tenant isolation: usuário ORG_A com body.connectionId de ORG_B retorna 404
  await t.test('I. POST /api/v1/integrations/ASANA/test com connectionId de ORG_B retorna 404 sem mutações', async () => {
    dbUpdates = [];
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ASANA/test',
      headers: {
        authorization: `Bearer ${tokenUserA}`,
      },
      payload: {
        connectionId: 'conn-tenant-b-asana', // Pertence à ORG_B
      },
    });

    assert.strictEqual(response.statusCode, 404);
    const json = JSON.parse(response.body);
    assert.strictEqual(json.status, 'error');
    assert.strictEqual(json.code, 'CONNECTION_NOT_FOUND');
    assert.strictEqual(dbUpdates.length, 0);
  });

  // J. Body validation: tipos inválidos retornam 400
  await t.test('J. Body validation: connectionId inválido (número, vazio, objeto) retorna 400', async () => {
    // 1. Número
    const resNum = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ASANA/test',
      headers: { authorization: `Bearer ${tokenUserA}` },
      payload: { connectionId: 12345 },
    });
    assert.strictEqual(resNum.statusCode, 400);

    // 2. String vazia
    const resEmpty = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ASANA/test',
      headers: { authorization: `Bearer ${tokenUserA}` },
      payload: { connectionId: '' },
    });
    assert.strictEqual(resEmpty.statusCode, 400);

    // 3. Objeto
    const resObj = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/ASANA/test',
      headers: { authorization: `Bearer ${tokenUserA}` },
      payload: { connectionId: { id: 'test' } },
    });
    assert.strictEqual(resObj.statusCode, 400);
  });
});
