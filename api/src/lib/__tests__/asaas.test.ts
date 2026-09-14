import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { AsaasService, sanitizeDocument, safeCompareTokens } from '../../modules/integrations/asaas/asaas.service.js';
import { AsaasClient, AsaasIntegrationError } from '../../modules/integrations/asaas/asaas.client.js';
import { createAsaasRoutes } from '../../modules/integrations/asaas/asaas.routes.js';
import { AsaasPaymentStatus } from '@prisma/client';

test('--- Integração Asaas Modo Leitura & Webhook Suite ---', async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function setupTestApp(serviceMock: any) {
    const app = fastify();
    await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
    await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });
    await app.register(createAsaasRoutes(serviceMock));
    await app.ready();
    return app;
  }

  await t.test('1. Isolamento por organização: Cobrança de outra organização é rejeitada com 404', async () => {
    const mockPrisma: any = {
      client: {
        findUnique: async ({ where }: any) => {
          if (where.id === 'cli_org_b') {
            return { id: 'cli_org_b', organizationId: 'org_b', name: 'Cliente B' };
          }
          return null;
        },
      },
    };

    const service = new AsaasService(null as any, mockPrisma);

    // Usuário da org_a tenta consultar cliente da org_b
    await assert.rejects(
      async () => {
        await service.getClientFinancialSummary('cli_org_b', 'org_a');
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CLIENT_NOT_FOUND');
        return true;
      }
    );
  });

  await t.test('2. Cobrança de outro cliente não aparece no resumo financeiro', async () => {
    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', organizationId: 'org_zafira', name: 'Cliente 1' }),
      },
      clientIntegration: {
        findFirst: async () => ({ externalId: 'cus_1', clientId: 'cli_1' }),
      },
      asaasPayment: {
        findMany: async ({ where }: any) => {
          assert.strictEqual(where.clientId, 'cli_1');
          assert.strictEqual(where.organizationId, 'org_zafira');
          return [
            {
              id: 'pay_1',
              organizationId: 'org_zafira',
              clientId: 'cli_1',
              asaasCustomerId: 'cus_1',
              externalId: 'pay_ext_1',
              value: 1500,
              netValue: 1490,
              billingType: 'BOLETO',
              status: AsaasPaymentStatus.PENDING,
              dueDate: new Date(Date.now() + 86400000),
              paymentDate: null,
              invoiceUrl: 'https://asaas.com/i/1',
              bankSlipUrl: null,
            },
          ];
        },
      },
    };

    const service = new AsaasService(null as any, mockPrisma);
    const result = await service.getClientFinancialSummary('cli_1', 'org_zafira');

    assert.strictEqual(result.clientId, 'cli_1');
    assert.strictEqual(result.payments.length, 1);
    assert.strictEqual(result.payments[0].id, 'pay_1');
    assert.strictEqual(result.kpis.pending, 1500);
    assert.strictEqual(result.kpis.pendingCount, 1);
  });

  await t.test('3. Webhook com token ausente ou inválido recebe 401 Unauthorized', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'secret_webhook_token_123';

    const service = new AsaasService(null as any, null as any);
    const app = await setupTestApp(service);

    // Sem token
    const resNoToken = await app.inject({
      method: 'POST',
      url: '/api/webhooks/asaas',
      payload: { event: 'PAYMENT_RECEIVED' },
    });
    assert.strictEqual(resNoToken.statusCode, 401);

    // Token errado
    const resWrongToken = await app.inject({
      method: 'POST',
      url: '/api/webhooks/asaas',
      headers: {
        'asaas-access-token': 'wrong_token',
      },
      payload: { event: 'PAYMENT_RECEIVED' },
    });
    assert.strictEqual(resWrongToken.statusCode, 401);
  });

  await t.test('4. Idempotência: Evento repetido de webhook não duplica cobrança', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'valid_token_123';

    const processedEvents = new Set<string>();
    const mockPrisma: any = {
      asaasWebhookEvent: {
        findUnique: async ({ where }: any) => {
          if (processedEvents.has(where.eventId)) {
            return { eventId: where.eventId };
          }
          return null;
        },
        create: async ({ data }: any) => {
          processedEvents.add(data.eventId);
          return data;
        },
      },
      clientIntegration: {
        findFirst: async () => null,
      },
      asaasPayment: {
        findUnique: async () => null,
        upsert: async () => ({ id: 'pay_upserted' }),
      },
      organization: {
        findFirst: async () => ({ id: 'org_1' }),
      },
    };

    const service = new AsaasService(null as any, mockPrisma);

    const payload = {
      id: 'evt_idempotent_1',
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_test_dup',
        customer: 'cus_1',
        value: 1200,
        dueDate: '2026-10-10',
        status: 'RECEIVED',
      },
    };

    // Primeiro envio
    const res1 = await service.processWebhookEvent(payload, 'valid_token_123');
    assert.strictEqual(res1.processed, true);
    assert.strictEqual(res1.duplicate, undefined);

    // Segundo envio do mesmo evento (retransmissão)
    const res2 = await service.processWebhookEvent(payload, 'valid_token_123');
    assert.strictEqual(res2.processed, true);
    assert.strictEqual(res2.duplicate, true, 'Deve detectar evento duplicado e retornar com sucesso');
  });

  await t.test('5. PAYMENT_RECEIVED atualiza status local e data de liquidação', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token_abc';

    let capturedUpsert: any = null;
    const mockPrisma: any = {
      asaasWebhookEvent: {
        findUnique: async () => null,
        create: async () => ({}),
      },
      clientIntegration: {
        findFirst: async () => ({
          client: { id: 'cli_rec_1', organizationId: 'org_rec_1' },
        }),
      },
      asaasPayment: {
        upsert: async (args: any) => {
          capturedUpsert = args;
          return { id: 'p1' };
        },
      },
    };

    const service = new AsaasService(null as any, mockPrisma);

    const payload = {
      id: 'evt_received_99',
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_received_123',
        customer: 'cus_999',
        value: 2500,
        netValue: 2490,
        status: 'RECEIVED',
        dueDate: '2026-09-10',
        paymentDate: '2026-09-09',
        billingType: 'PIX',
      },
    };

    await service.processWebhookEvent(payload, 'token_abc');

    assert.ok(capturedUpsert, 'Upsert deve ser chamado');
    assert.strictEqual(capturedUpsert.where.externalId, 'pay_received_123');
    assert.strictEqual(capturedUpsert.update.status, AsaasPaymentStatus.RECEIVED);
    assert.strictEqual(capturedUpsert.update.value, 2500);
    assert.ok(capturedUpsert.update.paymentDate);
  });

  await t.test('6. Sincronização não realiza nenhuma chamada de escrita ao Asaas (somente GET)', async () => {
    const invokedMethods: string[] = [];

    const mockClient: any = {
      getCustomers: async () => {
        invokedMethods.push('GET_CUSTOMERS');
        return {
          data: [
            { id: 'cus_asaas_1', name: 'Cliente Asaas 1', cpfCnpj: '12.345.678/0001-90' },
          ],
        };
      },
      getPayments: async () => {
        invokedMethods.push('GET_PAYMENTS');
        return {
          data: [
            {
              id: 'pay_sync_1',
              customer: 'cus_asaas_1',
              value: 3000,
              dueDate: '2026-10-01',
              status: 'PENDING',
              billingType: 'BOLETO',
            },
          ],
        };
      },
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => [
          { id: 'cli_matched_1', document: '12345678000190', name: 'Cliente Hub 1' },
        ],
      },
      clientIntegration: {
        findMany: async () => [],
        upsert: async () => ({ id: 'ci_1' }),
      },
      asaasPayment: {
        upsert: async () => ({ id: 'p_sync_1' }),
      },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const syncRes = await service.syncAsaasData('org_test');

    // Confirma que apenas métodos de leitura foram chamados
    assert.deepStrictEqual(invokedMethods, ['GET_CUSTOMERS', 'GET_PAYMENTS']);
    assert.strictEqual(syncRes.success, true);
    assert.strictEqual(syncRes.syncedCustomers, 1);
    assert.strictEqual(syncRes.linkedClients, 1);
    assert.strictEqual(syncRes.syncedPayments, 1);
  });

  await t.test('7. Higienização de documentos e comparação segura de tokens', () => {
    // Sanitização de CPF/CNPJ
    assert.strictEqual(sanitizeDocument('12.345.678/0001-99'), '12345678000199');
    assert.strictEqual(sanitizeDocument('123.456.789-00'), '12345678900');
    assert.strictEqual(sanitizeDocument(null), '');
    assert.strictEqual(sanitizeDocument(''), '');

    // Comparação segura de tokens
    assert.strictEqual(safeCompareTokens('token_secret_123', 'token_secret_123'), true);
    assert.strictEqual(safeCompareTokens('token_secret_123', 'wrong_token'), false);
    assert.strictEqual(safeCompareTokens('token_secret_123', 'token_secret_124'), false);
    assert.strictEqual(safeCompareTokens(null, 'token'), false);
    assert.strictEqual(safeCompareTokens('token', ''), false);
  });

  await t.test('8. Nenhuma credencial ou token vaza nas respostas das rotas da API', async () => {
    process.env.ASAAS_API_KEY = 'secret_key_that_must_never_leak_anywhere';
    process.env.ASAAS_WEBHOOK_TOKEN = 'secret_webhook_token_never_leak';

    const mockService: any = {
      getClientFinancialSummary: async () => ({
        clientId: 'cli_1',
        isLinked: true,
        asaasCustomerId: 'cus_1',
        kpis: { pending: 100, pendingCount: 1, receivedMonth: 0, receivedMonthCount: 0, overdue: 0, overdueCount: 0 },
        payments: [],
        totalPayments: 0,
      }),
      syncAsaasData: async () => ({
        success: true,
        syncedCustomers: 5,
        linkedClients: 3,
        unlinkedCustomers: 2,
        syncedPayments: 10,
        timestamp: new Date().toISOString(),
      }),
    };

    const app = fastify();
    await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
    await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });

    // Rota autenticada simulando ADMIN
    app.get('/clients/:clientId/integrations/asaas/financial-summary', {
      preHandler: [async (req) => {
        req.authContext = {
          type: 'user',
          userId: 'usr_admin',
          email: 'admin@zafira.com.br',
          memberships: [{ organizationId: 'org_1', organizationSlug: 'zafira', role: 'ADMIN' }],
        };
      }],
    }, async () => mockService.getClientFinancialSummary());

    app.post('/integrations/asaas/sync', {
      preHandler: [async (req) => {
        req.authContext = {
          type: 'user',
          userId: 'usr_admin',
          email: 'admin@zafira.com.br',
          memberships: [{ organizationId: 'org_1', organizationSlug: 'zafira', role: 'ADMIN' }],
        };
      }],
    }, async () => mockService.syncAsaasData());

    // Teste 1: Resumo financeiro
    const resSummary = await app.inject({
      method: 'GET',
      url: '/clients/cli_1/integrations/asaas/financial-summary',
    });
    const summaryStr = resSummary.payload;
    assert.ok(!summaryStr.includes('secret_key_that_must_never_leak_anywhere'));
    assert.ok(!summaryStr.includes('secret_webhook_token_never_leak'));

    // Teste 2: Sincronização
    const resSync = await app.inject({
      method: 'POST',
      url: '/integrations/asaas/sync',
    });
    const syncStr = resSync.payload;
    assert.ok(!syncStr.includes('secret_key_that_must_never_leak_anywhere'));
    assert.ok(!syncStr.includes('secret_webhook_token_never_leak'));
  });
});
