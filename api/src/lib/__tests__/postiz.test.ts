import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { PostizClient, PostizIntegrationError } from '../../modules/integrations/postiz/postiz.client.js';
import { PostizService } from '../../modules/integrations/postiz/postiz.service.js';
import { createPostizRoutes } from '../../modules/integrations/postiz/postiz.routes.js';

test('--- Postiz Lab Integration Suite ---', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  await t.test('1. PostizClient valida obrigatoriedade de POSTIZ_URL e POSTIZ_API_KEY', async () => {
    delete process.env.POSTIZ_URL;
    delete process.env.POSTIZ_API_KEY;

    const client = new PostizClient({ baseUrl: '', apiKey: '' });

    await assert.rejects(
      async () => client.isConnected(),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 500);
        assert.strictEqual(err.code, 'POSTIZ_NOT_CONFIGURED');
        assert.ok(err.message.includes('POSTIZ_URL ou POSTIZ_API_KEY ausente'));
        return true;
      }
    );
  });

  await t.test('2. PostizClient envia Authorization: <API_KEY> e consome /api/public/v1/is-connected com sucesso', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers as Record<string, string>) || {};

      return new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const client = new PostizClient({
      baseUrl: 'https://postiz.lab.zafiramkt.com.br',
      apiKey: 'test_super_secret_key_123',
    });

    const result = await client.isConnected();

    assert.strictEqual(capturedUrl, 'https://postiz.lab.zafiramkt.com.br/api/public/v1/is-connected');
    assert.strictEqual(capturedHeaders['Authorization'], 'test_super_secret_key_123');
    assert.strictEqual(capturedHeaders['Accept'], 'application/json');
    assert.strictEqual(result.connected, true);
  });

  await t.test('2b. PostizClient consome /api/public/v1/integrations com sucesso', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const client = new PostizClient({
      baseUrl: 'https://postiz.lab.zafiramkt.com.br',
      apiKey: 'test_super_secret_key_123',
    });

    const result = await client.getIntegrations();

    assert.strictEqual(capturedUrl, 'https://postiz.lab.zafiramkt.com.br/api/public/v1/integrations');
    assert.deepStrictEqual(result, []);
  });

  await t.test('3. PostizClient trata erro 401/403 do Postiz sem vazar a API Key', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ msg: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const apiKey = 'super_secret_do_not_leak';
    const client = new PostizClient({
      baseUrl: 'https://postiz.lab.zafiramkt.com.br',
      apiKey,
    });

    await assert.rejects(
      async () => client.isConnected(),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 502);
        assert.strictEqual(err.code, 'POSTIZ_UNAUTHORIZED');
        assert.ok(!err.message.includes(apiKey), 'API Key NUNCA pode vazar na mensagem de erro');
        assert.ok(err.message.includes('inválida ou sem permissão'));
        return true;
      }
    );
  });

  await t.test('4. PostizClient trata timeout de rede com código 504 e mensagem tratada', async () => {
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      // Simula cancelamento por AbortSignal
      const error: any = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }) as any;

    const client = new PostizClient({
      baseUrl: 'https://postiz.lab.zafiramkt.com.br',
      apiKey: 'key123',
      timeoutMs: 50,
    });

    await assert.rejects(
      async () => client.isConnected(),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 504);
        assert.strictEqual(err.code, 'POSTIZ_TIMEOUT');
        assert.ok(err.message.includes('Timeout de comunicação'));
        return true;
      }
    );
  });

  await t.test('5. PostizService normaliza getStatus() para formato { connected: true, provider: "POSTIZ" }', async () => {
    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
    };

    const service = new PostizService(mockClient);
    const status = await service.getStatus();

    assert.deepStrictEqual(status, {
      connected: true,
      provider: 'POSTIZ',
    });
  });

  await t.test('6. PostizService preserva o ID das integrações em getAccounts() para uso como externalId', async () => {
    const mockRawAccounts = [
      {
        id: 'cm6s4uyou0001i2r47pxix6z1',
        name: 'Grupo Lima Oficial',
        identifier: 'instagram',
        picture: 'https://uploads.postiz.com/avatars/perfil.jpg',
        disabled: false,
        profile: '@grupolima',
        customer: {
          id: 'cust_12345',
          name: 'Grupo Lima',
        },
      },
      {
        id: 'cm6s4uyou0002i2r47pxix6z2',
        name: 'Grupo Lima YouTube',
        identifier: 'youtube',
        picture: null,
        disabled: false,
        profile: null,
        customer: null,
      },
    ];

    const mockClient: any = {
      getIntegrations: async () => mockRawAccounts,
    };

    const service = new PostizService(mockClient);
    const result = await service.getAccounts();

    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.accounts[0].id, 'cm6s4uyou0001i2r47pxix6z1', 'O id original do Postiz deve ser preservado estritamente');
    assert.strictEqual(result.accounts[0].name, 'Grupo Lima Oficial');
    assert.strictEqual(result.accounts[0].providerIdentifier, 'instagram');
    assert.strictEqual(result.accounts[0].profile, '@grupolima');
    assert.deepStrictEqual(result.accounts[0].customer, { id: 'cust_12345', name: 'Grupo Lima' });

    assert.strictEqual(result.accounts[1].id, 'cm6s4uyou0002i2r47pxix6z2');
    assert.strictEqual(result.accounts[1].customer, null);
  });

    async function setupTestApp(serviceMock: any) {
      const app = fastify();
      await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
      await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });
      await app.register(createPostizRoutes(serviceMock));
      await app.ready();
      return app;
    }

  await t.test('7. Rotas /integrations/postiz/status exigem autenticação', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';

    const app = await setupTestApp({
      getStatus: async () => ({ connected: true, provider: 'POSTIZ' }),
      getAccounts: async () => ({ accounts: [], total: 0 }),
    });

    // Sem autenticação -> 401
    const unauthResponse = await app.inject({
      method: 'GET',
      url: '/integrations/postiz/status',
    });
    assert.strictEqual(unauthResponse.statusCode, 401);

    // Com x-api-key válida -> 200
    const authResponse = await app.inject({
      method: 'GET',
      url: '/integrations/postiz/status',
      headers: {
        'x-api-key': 'secret_internal_123',
      },
    });
    assert.strictEqual(authResponse.statusCode, 200);
    const body = authResponse.json();
    assert.strictEqual(body.connected, true);
    assert.strictEqual(body.provider, 'POSTIZ');
  });

  await t.test('8. Rotas /integrations/postiz/accounts retornam lista de contas sociais autenticadas', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';

    const expectedAccounts = [
      {
        id: 'postiz_cuid_insta_01',
        name: 'Instagram Empresa',
        providerIdentifier: 'instagram',
        picture: 'https://example.com/pic.png',
        disabled: false,
        profile: '@empresa',
        customer: null,
      },
    ];

    const app = await setupTestApp({
      getStatus: async () => ({ connected: true, provider: 'POSTIZ' }),
      getAccounts: async () => ({ accounts: expectedAccounts, total: 1 }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/integrations/postiz/accounts',
      headers: {
        'x-api-key': 'secret_internal_123',
      },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = response.json();
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.accounts[0].id, 'postiz_cuid_insta_01');
    assert.strictEqual(body.accounts[0].providerIdentifier, 'instagram');
  });

  await t.test('9. Rotas tratam falhas do Postiz sem expor stack trace', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';

    const app = await setupTestApp({
      getStatus: async () => {
        throw new PostizIntegrationError('Postiz retornou status 500', 502, 'POSTIZ_API_ERROR');
      },
      getAccounts: async () => ({ accounts: [], total: 0 }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/integrations/postiz/status',
      headers: {
        'x-api-key': 'secret_internal_123',
      },
    });

    assert.strictEqual(response.statusCode, 502);
    const body = response.json();
    assert.strictEqual(body.status, 'error');
    assert.strictEqual(body.error, 'POSTIZ_API_ERROR');
    assert.strictEqual(body.message, 'Postiz retornou status 500');
    assert.strictEqual(body.stack, undefined, 'Stack trace NUNCA deve ser exposto na resposta HTTP');
  });

  // ==========================================
  // ETAPA 2: Vínculo Postiz <-> Cliente 360
  // ==========================================

  function createMockPrisma() {
    const clients = new Map<string, any>();
    const clientIntegrations: any[] = [];

    return {
      _data: { clients, clientIntegrations },
      client: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          return clients.get(where.id) || null;
        },
      },
      clientIntegration: {
        findMany: async ({ where }: { where: { clientId: string; provider?: string } }) => {
          return clientIntegrations.filter(
            (ci) => ci.clientId === where.clientId && (!where.provider || ci.provider === where.provider)
          );
        },
        findFirst: async ({ where }: { where: { clientId: string; provider?: string; OR?: Array<{ externalId?: string; id?: string }> } }) => {
          return clientIntegrations.find((ci) => {
            if (ci.clientId !== where.clientId) return false;
            if (where.provider && ci.provider !== where.provider) return false;
            if (where.OR) {
              return where.OR.some((cond) => (cond.externalId && ci.externalId === cond.externalId) || (cond.id && ci.id === cond.id));
            }
            return true;
          }) || null;
        },
        findUnique: async ({ where }: { where: { clientId_provider_externalId: { clientId: string; provider: string; externalId: string } } }) => {
          const { clientId, provider, externalId } = where.clientId_provider_externalId;
          return clientIntegrations.find(
            (ci) => ci.clientId === clientId && ci.provider === provider && ci.externalId === externalId
          ) || null;
        },
        create: async ({ data }: { data: any }) => {
          // Checar constraint unique
          const exists = clientIntegrations.find(
            (ci) => ci.clientId === data.clientId && ci.provider === data.provider && ci.externalId === data.externalId
          );
          if (exists) {
            const err: any = new Error('Unique constraint failed on the fields: (`clientId`,`provider`,`externalId`)');
            err.code = 'P2002';
            throw err;
          }
          const record = {
            id: `ci_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          clientIntegrations.push(record);
          return record;
        },
        delete: async ({ where }: { where: { id?: string; clientId_provider_externalId?: { clientId: string; provider: string; externalId: string } } }) => {
          let index = -1;
          if (where.id) {
            index = clientIntegrations.findIndex((ci) => ci.id === where.id);
          } else if (where.clientId_provider_externalId) {
            const { clientId, provider, externalId } = where.clientId_provider_externalId;
            index = clientIntegrations.findIndex(
              (ci) => ci.clientId === clientId && ci.provider === provider && ci.externalId === externalId
            );
          }
          if (index === -1) {
            const err: any = new Error('Record to delete does not exist.');
            err.code = 'P2025';
            throw err;
          }
          const [removed] = clientIntegrations.splice(index, 1);
          return removed;
        },
      },
    };
  }

  await t.test('10. Endpoints de cliente exigem autenticação', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    // GET sem auth -> 401
    const resGet = await app.inject({
      method: 'GET',
      url: '/clients/cli_123/integrations/postiz',
    });
    assert.strictEqual(resGet.statusCode, 401);

    // POST sem auth -> 401
    const resPost = await app.inject({
      method: 'POST',
      url: '/clients/cli_123/integrations/postiz',
      payload: { externalId: 'postiz_int_1' },
    });
    assert.strictEqual(resPost.statusCode, 401);

    // DELETE sem auth -> 401
    const resDelete = await app.inject({
      method: 'DELETE',
      url: '/clients/cli_123/integrations/postiz/postiz_int_1',
    });
    assert.strictEqual(resDelete.statusCode, 401);
  });

  await t.test('11. Rejeita cliente inexistente com 404 CLIENT_NOT_FOUND', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma(); // banco sem nenhum cliente
    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [{ id: 'postiz_int_1', name: 'Instagram', identifier: 'instagram' }],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    // GET cliente inexistente
    const resGet = await app.inject({
      method: 'GET',
      url: '/clients/cli_inexistente/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });
    assert.strictEqual(resGet.statusCode, 404);
    assert.strictEqual(resGet.json().error, 'CLIENT_NOT_FOUND');

    // POST cliente inexistente
    const resPost = await app.inject({
      method: 'POST',
      url: '/clients/cli_inexistente/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
      payload: { externalId: 'postiz_int_1' },
    });
    assert.strictEqual(resPost.statusCode, 404);
    assert.strictEqual(resPost.json().error, 'CLIENT_NOT_FOUND');

    // DELETE cliente inexistente
    const resDelete = await app.inject({
      method: 'DELETE',
      url: '/clients/cli_inexistente/integrations/postiz/postiz_int_1',
      headers: { 'x-api-key': 'secret_internal_123' },
    });
    assert.strictEqual(resDelete.statusCode, 404);
    assert.strictEqual(resDelete.json().error, 'CLIENT_NOT_FOUND');
  });

  await t.test('12. Rejeita externalId inexistente no Postiz com 404 POSTIZ_ACCOUNT_NOT_FOUND', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [
          { id: 'postiz_valida_1', name: 'Instagram Real', identifier: 'instagram' },
        ],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'POST',
      url: '/clients/cli_1/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
      payload: { externalId: 'id_fantasma_inexistente' },
    });

    assert.strictEqual(res.statusCode, 404);
    const body = res.json();
    assert.strictEqual(body.error, 'POSTIZ_ACCOUNT_NOT_FOUND');
    assert.ok(body.message.toLowerCase().includes('não encontrada'));
  });

  await t.test('13. Vincula conta Postiz válida preservando integration.id como externalId', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });

    const postizAccount = {
      id: 'cm6s4uyou0001i2r47pxix6z1',
      name: 'Grupo Lima Instagram',
      identifier: 'instagram',
      picture: 'https://cdn.postiz.com/avatar.jpg',
      disabled: false,
      profile: '@grupolima',
    };

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [postizAccount],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'POST',
      url: '/clients/cli_1/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
      payload: { externalId: 'cm6s4uyou0001i2r47pxix6z1' },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.account.externalId, 'cm6s4uyou0001i2r47pxix6z1', 'externalId DEVE ser exatamente o integration.id do Postiz');
    assert.strictEqual(body.account.provider, 'POSTIZ');
    assert.strictEqual(body.account.name, 'Grupo Lima Instagram');
    assert.strictEqual(body.account.metadata.providerIdentifier, 'instagram');

    // Confirmação no banco in-memory
    assert.strictEqual(mockPrisma._data.clientIntegrations.length, 1);
    const saved = mockPrisma._data.clientIntegrations[0];
    assert.strictEqual(saved.clientId, 'cli_1');
    assert.strictEqual(saved.provider, 'POSTIZ');
    assert.strictEqual(saved.externalId, 'cm6s4uyou0001i2r47pxix6z1');
  });

  await t.test('14. Consulta vínculos do cliente (GET /clients/:clientId/integrations/postiz)', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'cm6s4uyou0001i2r47pxix6z1',
      metadata: { name: 'Instagram', providerIdentifier: 'instagram' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_1/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.clientId, 'cli_1');
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.accounts.length, 1);
    assert.strictEqual(body.accounts[0].externalId, 'cm6s4uyou0001i2r47pxix6z1');
    assert.strictEqual(body.accounts[0].provider, 'POSTIZ');
  });

  await t.test('15. Rejeita vínculo duplicado para o mesmo cliente com 409 POSTIZ_ALREADY_LINKED', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });

    const postizAccount = {
      id: 'cm6s4uyou0001i2r47pxix6z1',
      name: 'Grupo Lima Instagram',
      identifier: 'instagram',
    };

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [postizAccount],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    // Primeiro vínculo -> 201
    const res1 = await app.inject({
      method: 'POST',
      url: '/clients/cli_1/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
      payload: { externalId: 'cm6s4uyou0001i2r47pxix6z1' },
    });
    assert.strictEqual(res1.statusCode, 201);

    // Segundo vínculo com mesmo externalId -> 409
    const res2 = await app.inject({
      method: 'POST',
      url: '/clients/cli_1/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
      payload: { externalId: 'cm6s4uyou0001i2r47pxix6z1' },
    });
    assert.strictEqual(res2.statusCode, 409);
    const body = res2.json();
    assert.strictEqual(body.error, 'POSTIZ_ALREADY_LINKED');
    assert.ok(body.message.includes('já está vinculada a este cliente'));
  });

  await t.test('16. Remove vínculo do cliente (DELETE /clients/:clientId/integrations/postiz/:externalId)', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'cm6s4uyou0001i2r47pxix6z1',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'DELETE',
      url: '/clients/cli_1/integrations/postiz/cm6s4uyou0001i2r47pxix6z1',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.deleted.externalId, 'cm6s4uyou0001i2r47pxix6z1');

    // Confirma que foi removido do banco
    assert.strictEqual(mockPrisma._data.clientIntegrations.length, 0);
  });

  await t.test('17. Rejeita remoção de vínculo inexistente com 404 POSTIZ_LINK_NOT_FOUND', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [],
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'DELETE',
      url: '/clients/cli_1/integrations/postiz/id_inexistente',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 404);
    const body = res.json();
    assert.strictEqual(body.error, 'POSTIZ_LINK_NOT_FOUND');
  });

  await t.test('18. DELETE NUNCA tenta excluir ou desconectar a conta no Postiz (apenas remove vínculo local)', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'cm6s4uyou0001i2r47pxix6z1',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let postizCalls = 0;
    const mockClient: any = {
      isConnected: async () => {
        postizCalls++;
        return { connected: true };
      },
      getIntegrations: async () => {
        postizCalls++;
        return [];
      },
      deleteIntegration: async () => {
        postizCalls++;
        throw new Error('NÃO DEVERIA CHAMAR DELETE NO POSTIZ!');
      },
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'DELETE',
      url: '/clients/cli_1/integrations/postiz/cm6s4uyou0001i2r47pxix6z1',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(postizCalls, 0, 'O Postiz remoto NUNCA deve ser invocado na operação de desvinculação local');
    assert.strictEqual(mockPrisma._data.clientIntegrations.length, 0);
  });

  await t.test('19. Nenhuma rota expõe POSTIZ_API_KEY mesmo em erros ou rejeições', async () => {
    const secretApiKey = 'super_ultra_secret_postiz_key_999';
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    process.env.POSTIZ_API_KEY = secretApiKey;

    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Empresa Teste' });

    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => {
          throw new PostizIntegrationError(`Erro interno envolvendo key=${secretApiKey}`, 502, 'POSTIZ_COMMUNICATION_ERROR');
        },
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'POST',
      url: '/clients/cli_1/integrations/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
      payload: { externalId: 'qualquer_id' },
    });

    const rawResponse = res.body;
    assert.ok(!rawResponse.includes(secretApiKey), 'A API Key do Postiz não pode vazar na resposta HTTP');
  });

  // ==========================================
  // ETAPA 3: Leitura de Conteúdo do Postiz no Client 360
  // ==========================================

  await t.test('20. GET /clients/:clientId/content/postiz exige autenticação', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [],
        getPosts: async () => ({ posts: [] }),
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_123/content/postiz',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('21. GET /clients/:clientId/content/postiz rejeita cliente inexistente com 404 CLIENT_NOT_FOUND', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma(); // sem clientes
    const service = new PostizService(
      {
        isConnected: async () => ({ connected: true }),
        getIntegrations: async () => [],
        getPosts: async () => ({ posts: [] }),
      } as any,
      mockPrisma as any
    );
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_fantasma/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.json().error, 'CLIENT_NOT_FOUND');
  });

  await t.test('22. Cliente sem contas Postiz vinculadas retorna 200 com posts: [], total: 0', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_sem_postiz', { id: 'cli_sem_postiz', name: 'Cliente Novo' });

    let postizCalled = false;
    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
      getIntegrations: async () => [],
      getPosts: async () => {
        postizCalled = true;
        return { posts: [] };
      },
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_sem_postiz/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.clientId, 'cli_sem_postiz');
    assert.deepStrictEqual(body.posts, []);
    assert.strictEqual(body.total, 0);
    assert.strictEqual(postizCalled, false, 'Não deve gastar requisição no Postiz se o cliente não possui contas vinculadas');
  });

  await t.test('23. Cliente com conta vinculada e Postiz sem publicações retorna 200 com posts: [], total: 0', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Cliente 1' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'int_insta_01',
    });

    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
      getIntegrations: async () => [],
      getPosts: async () => ({ posts: [] }),
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_1/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.clientId, 'cli_1');
    assert.deepStrictEqual(body.posts, []);
    assert.strictEqual(body.total, 0);
  });

  await t.test('24. Busca e normaliza posts da conta vinculada ao cliente', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Grupo Lima' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'postiz_int_lima_insta',
    });

    const mockPosts = [
      {
        id: 'post_1',
        content: 'Post sobre lançamento da marca #zafira',
        publishDate: '2026-09-10T12:00:00.000Z',
        releaseURL: 'https://instagram.com/p/abc123',
        releaseId: 'rel_123',
        state: 'PUBLISHED',
        integration: {
          id: 'postiz_int_lima_insta',
          providerIdentifier: 'instagram',
          name: 'Grupo Lima Instagram',
          picture: 'https://cdn.postiz.com/avatar.jpg',
        },
      },
      {
        id: 'post_2',
        content: 'Vídeo institucional programado',
        publishDate: '2026-09-20T18:00:00.000Z',
        releaseURL: null,
        releaseId: null,
        state: 'QUEUE',
        integration: {
          id: 'postiz_int_lima_insta',
          providerIdentifier: 'instagram',
          name: 'Grupo Lima Instagram',
          picture: 'https://cdn.postiz.com/avatar.jpg',
        },
      },
    ];

    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
      getIntegrations: async () => [],
      getPosts: async () => ({ posts: mockPosts }),
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_1/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.clientId, 'cli_1');
    assert.strictEqual(body.total, 2);
    assert.strictEqual(body.posts.length, 2);

    const published = body.posts.find((p: any) => p.id === 'post_1');
    assert.strictEqual(published.status, 'PUBLISHED');
    assert.strictEqual(published.publishedAt, '2026-09-10T12:00:00.000Z');
    assert.strictEqual(published.scheduledAt, null);
    assert.strictEqual(published.platform, 'instagram');
    assert.strictEqual(published.releaseUrl, 'https://instagram.com/p/abc123');

    const scheduled = body.posts.find((p: any) => p.id === 'post_2');
    assert.strictEqual(scheduled.status, 'QUEUE');
    assert.strictEqual(scheduled.scheduledAt, '2026-09-20T18:00:00.000Z');
    assert.strictEqual(scheduled.publishedAt, null);
  });

  await t.test('25. SEGURANÇA DE ESCOPO: Cliente A NUNCA recebe posts da conta do Cliente B', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();

    // Cria Cliente A e Cliente B
    mockPrisma._data.clients.set('cli_A', { id: 'cli_A', name: 'Empresa A' });
    mockPrisma._data.clients.set('cli_B', { id: 'cli_B', name: 'Empresa B' });

    // Vincula integrações distintas
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_A',
      clientId: 'cli_A',
      provider: 'POSTIZ',
      externalId: 'int_cliente_A',
    });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_B',
      clientId: 'cli_B',
      provider: 'POSTIZ',
      externalId: 'int_cliente_B',
    });

    // Postiz retorna posts misturados da organização
    const allOrgPosts = [
      {
        id: 'post_A_1',
        content: 'Conteúdo confidencial Cliente A',
        publishDate: '2026-09-01T10:00:00.000Z',
        state: 'PUBLISHED',
        integration: {
          id: 'int_cliente_A',
          providerIdentifier: 'linkedin',
          name: 'LinkedIn Cliente A',
        },
      },
      {
        id: 'post_B_1',
        content: 'Conteúdo confidencial Cliente B',
        publishDate: '2026-09-02T11:00:00.000Z',
        state: 'PUBLISHED',
        integration: {
          id: 'int_cliente_B',
          providerIdentifier: 'instagram',
          name: 'Instagram Cliente B',
        },
      },
    ];

    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
      getIntegrations: async () => [],
      getPosts: async () => ({ posts: allOrgPosts }),
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    // Consulta Cliente A
    const resA = await app.inject({
      method: 'GET',
      url: '/clients/cli_A/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });
    assert.strictEqual(resA.statusCode, 200);
    const bodyA = resA.json();
    assert.strictEqual(bodyA.total, 1);
    assert.strictEqual(bodyA.posts[0].id, 'post_A_1');
    assert.strictEqual(bodyA.posts[0].integrationId, 'int_cliente_A');
    assert.ok(!JSON.stringify(bodyA).includes('Cliente B'), 'NENHUM dado do Cliente B pode vazar para o Cliente A');

    // Consulta Cliente B
    const resB = await app.inject({
      method: 'GET',
      url: '/clients/cli_B/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });
    assert.strictEqual(resB.statusCode, 200);
    const bodyB = resB.json();
    assert.strictEqual(bodyB.total, 1);
    assert.strictEqual(bodyB.posts[0].id, 'post_B_1');
    assert.strictEqual(bodyB.posts[0].integrationId, 'int_cliente_B');
    assert.ok(!JSON.stringify(bodyB).includes('Cliente A'), 'NENHUM dado do Cliente A pode vazar para o Cliente B');
  });

  await t.test('26. Posts são retornados em ordem cronológica decrescente', async () => {
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Cliente 1' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'int_1',
    });

    const mockPosts = [
      {
        id: 'post_antigo',
        content: 'Post mais antigo',
        publishDate: '2026-08-01T10:00:00.000Z',
        state: 'PUBLISHED',
        integration: { id: 'int_1', providerIdentifier: 'instagram', name: 'Insta' },
      },
      {
        id: 'post_recente',
        content: 'Post mais recente',
        publishDate: '2026-09-12T10:00:00.000Z',
        state: 'PUBLISHED',
        integration: { id: 'int_1', providerIdentifier: 'instagram', name: 'Insta' },
      },
    ];

    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
      getIntegrations: async () => [],
      getPosts: async () => ({ posts: mockPosts }),
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_1/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.posts[0].id, 'post_recente');
    assert.strictEqual(body.posts[1].id, 'post_antigo');
  });

  await t.test('27. Erros remotos do Postiz são tratados de forma segura sem expor POSTIZ_API_KEY', async () => {
    const secretApiKey = 'super_secret_postiz_api_key_xyz';
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_123';
    process.env.POSTIZ_API_KEY = secretApiKey;

    const mockPrisma = createMockPrisma();
    mockPrisma._data.clients.set('cli_1', { id: 'cli_1', name: 'Cliente 1' });
    mockPrisma._data.clientIntegrations.push({
      id: 'ci_1',
      clientId: 'cli_1',
      provider: 'POSTIZ',
      externalId: 'int_1',
    });

    const mockClient: any = {
      isConnected: async () => ({ connected: true }),
      getIntegrations: async () => [],
      getPosts: async () => {
        throw new PostizIntegrationError(`Falha remota com token=${secretApiKey}`, 502, 'POSTIZ_ERROR');
      },
    };

    const service = new PostizService(mockClient, mockPrisma as any);
    const app = await setupTestApp(service);

    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_1/content/postiz',
      headers: { 'x-api-key': 'secret_internal_123' },
    });

    assert.strictEqual(res.statusCode, 502);
    const rawBody = res.body;
    assert.ok(!rawBody.includes(secretApiKey), 'API Key do Postiz JAMAIS deve vazar em erro HTTP');
    assert.ok(rawBody.includes('[REDACTED]'), 'A chave deve ser sanitizada com [REDACTED]');
  });
});


