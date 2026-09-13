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
});
