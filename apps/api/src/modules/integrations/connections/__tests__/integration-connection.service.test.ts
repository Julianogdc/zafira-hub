import test from 'node:test';
import assert from 'node:assert';
import { IntegrationConnectionService, IntegrationConnectionError } from '../integration-connection.service.ts';

test('IntegrationConnectionService - Unit & Security Suite', async (t) => {
  const testKey = 'test_key_32_bytes_long_exact_val_1';
  process.env.INTEGRATION_ENCRYPTION_KEY = testKey;

  // Mock do PrismaClient com controle de estado em memória
  const createMockPrisma = () => {
    const clients = new Map<string, any>([
      ['client_org_a', { id: 'client_org_a', organizationId: 'org_A' }],
      ['client_org_b', { id: 'client_org_b', organizationId: 'org_B' }],
    ]);

    const connections = new Map<string, any>();

    const mockTx = {
      integrationConnection: {
        create: async ({ data }: any) => {
          const conn = {
            id: `conn_${Date.now()}_${Math.random()}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          connections.set(conn.id, conn);
          return conn;
        },
        update: async ({ where, data }: any) => {
          const conn = connections.get(where.id);
          if (!conn) throw new Error('Not found');
          Object.assign(conn, data);
          return conn;
        },
      },
      auditLog: {
        create: async () => ({ id: 'audit_123' }),
      },
    };

    return {
      client: {
        findUnique: async ({ where }: any) => clients.get(where.id) || null,
      },
      integrationConnection: {
        findFirst: async ({ where }: any) => {
          for (const conn of connections.values()) {
            if (where.id && conn.id !== where.id) continue;
            if (where.organizationId && conn.organizationId !== where.organizationId) continue;
            if (where.clientId && conn.clientId !== where.clientId) continue;
            if (where.provider && conn.provider !== where.provider) continue;
            if (where.externalScopeId && conn.externalScopeId !== where.externalScopeId) continue;
            if (where.status && conn.status !== where.status) continue;
            return conn;
          }
          return null;
        },
        findMany: async ({ where }: any) => {
          const results = [];
          for (const conn of connections.values()) {
            if (where.organizationId && conn.organizationId !== where.organizationId) continue;
            if (where.clientId && conn.clientId !== where.clientId) continue;
            if (where.provider && conn.provider !== where.provider) continue;
            if (where.status && conn.status !== where.status) continue;
            results.push(conn);
          }
          return results;
        },
      },
      $transaction: async (cb: any) => cb(mockTx),
    };
  };

  await t.test('1. Conexão criada com sucesso não retorna credential ou credentialCiphertext no DTO', async () => {
    const prisma = createMockPrisma() as any;
    const service = new IntegrationConnectionService(prisma);

    const dto = await service.createClientConnection({
      organizationId: 'org_A',
      clientId: 'client_org_a',
      provider: 'BRIGHTBEAN',
      authType: 'API_KEY',
      externalScopeId: 'ws_brightbean_123',
      displayName: 'Workspace BrightBean Org A',
      credential: 'secret_api_key_plain_text',
    });

    assert.strictEqual(dto.organizationId, 'org_A');
    assert.strictEqual(dto.clientId, 'client_org_a');
    assert.strictEqual(dto.provider, 'BRIGHTBEAN');
    assert.strictEqual(dto.externalScopeId, 'ws_brightbean_123');
    assert.strictEqual(dto.hasCredential, true);
    assert.strictEqual((dto as any).credential, undefined);
    assert.strictEqual((dto as any).credentialCiphertext, undefined);
  });

  await t.test('2. Bloqueio de Segredos em Metadata (Rejeita com 400)', async () => {
    const prisma = createMockPrisma() as any;
    const service = new IntegrationConnectionService(prisma);

    await assert.rejects(
      async () => {
        await service.createClientConnection({
          organizationId: 'org_A',
          clientId: 'client_org_a',
          provider: 'BRIGHTBEAN',
          authType: 'API_KEY',
          externalScopeId: 'ws_scope_2',
          credential: 'secret_plain',
          metadata: {
            apiKey: 'secret_inside_metadata',
          },
        });
      },
      (err: any) => err instanceof IntegrationConnectionError && err.code === 'PROHIBITED_METADATA_KEY'
    );
  });

  await t.test('3. Isolamento Multi-Tenant: Org A tentando vincular cliente da Org B é rejeitada (404)', async () => {
    const prisma = createMockPrisma() as any;
    const service = new IntegrationConnectionService(prisma);

    await assert.rejects(
      async () => {
        await service.createClientConnection({
          organizationId: 'org_A',
          clientId: 'client_org_b', // Cliente pertence à Org B!
          provider: 'BRIGHTBEAN',
          authType: 'API_KEY',
          externalScopeId: 'ws_cross_tenant',
          credential: 'secret_plain',
        });
      },
      (err: any) => err instanceof IntegrationConnectionError && err.code === 'CLIENT_NOT_FOUND'
    );
  });

  await t.test('4. Resolução Estrita de Credencial (resolveCredential): Descriptografa internamente sem expor', async () => {
    const prisma = createMockPrisma() as any;
    const service = new IntegrationConnectionService(prisma);

    const dto = await service.createClientConnection({
      organizationId: 'org_A',
      clientId: 'client_org_a',
      provider: 'BRIGHTBEAN',
      authType: 'API_KEY',
      externalScopeId: 'ws_resolve_test',
      credential: 'my_super_secret_brightbean_key',
    });

    const decryptedSecret = await service.resolveCredential('org_A', dto.id);
    assert.strictEqual(decryptedSecret, 'my_super_secret_brightbean_key');

    // Tentativa cross-tenant de ler o segredo da Org A pela Org B falha
    await assert.rejects(
      async () => {
        await service.resolveCredential('org_B', dto.id);
      },
      (err: any) => err instanceof IntegrationConnectionError && err.code === 'CONNECTION_NOT_FOUND'
    );
  });

  await t.test('5. Rotação de Credencial (rotateCredential) recriptografa segredo', async () => {
    const prisma = createMockPrisma() as any;
    const service = new IntegrationConnectionService(prisma);

    const dto = await service.createClientConnection({
      organizationId: 'org_A',
      clientId: 'client_org_a',
      provider: 'BRIGHTBEAN',
      authType: 'API_KEY',
      externalScopeId: 'ws_rotate_test',
      credential: 'old_secret_key',
    });

    const rotated = await service.rotateCredential('org_A', dto.id, 'new_rotated_secret_key');
    assert.strictEqual(rotated.hasCredential, true);

    const resolvedNew = await service.resolveCredential('org_A', dto.id);
    assert.strictEqual(resolvedNew, 'new_rotated_secret_key');
  });

  await t.test('6. Desconexão (disconnectConnection) altera status para DISCONNECTED', async () => {
    const prisma = createMockPrisma() as any;
    const service = new IntegrationConnectionService(prisma);

    const dto = await service.createClientConnection({
      organizationId: 'org_A',
      clientId: 'client_org_a',
      provider: 'BRIGHTBEAN',
      authType: 'API_KEY',
      externalScopeId: 'ws_disconnect_test',
      credential: 'secret_key',
    });

    const disconnected = await service.disconnectConnection('org_A', dto.id);
    assert.strictEqual(disconnected.status, 'DISCONNECTED');
  });
});
