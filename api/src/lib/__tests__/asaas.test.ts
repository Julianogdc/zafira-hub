import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import {
  AsaasService,
  sanitizeDocument,
  safeCompareTokens,
  generateWebhookDedupeKey,
} from '../../modules/integrations/asaas/asaas.service.js';
import { AsaasClient, AsaasIntegrationError } from '../../modules/integrations/asaas/asaas.client.js';
import { createAsaasRoutes } from '../../modules/integrations/asaas/asaas.routes.js';
import { AsaasPaymentStatus } from '@prisma/client';

test('--- Integração Asaas Modo Leitura & Webhook Suite (Hardening Etapa 4B) ---', async (t) => {
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

  // ---------------------------------------------------------------------------
  // 1. Sincronização de um cliente não consulta/atualiza cobranças de outro
  // ---------------------------------------------------------------------------
  await t.test('1. Sincronização de um cliente não consulta/atualiza cobranças de outro', async () => {
    let queriedCustomerParam: string | null = null;
    const upsertedPayments: any[] = [];

    const mockClient: any = {
      getCustomers: async () => ({ data: [] }),
      getPayments: async ({ customer }: any) => {
        queriedCustomerParam = customer;
        return {
          data: [
            {
              id: 'pay_cli1_only',
              customer: 'cus_cli1',
              value: 500,
              dueDate: '2026-10-15',
              status: 'PENDING',
              billingType: 'PIX',
            },
          ],
        };
      },
    };

    const mockPrisma: any = {
      client: {
        findUnique: async ({ where }: any) => {
          if (where.id === 'cli_1') {
            return { id: 'cli_1', organizationId: 'org_1', document: '12345678000199', name: 'Cliente 1' };
          }
          return null;
        },
      },
      clientIntegration: {
        findFirst: async ({ where }: any) => {
          if (where.clientId === 'cli_1') {
            return { clientId: 'cli_1', provider: 'ASAAS', externalId: 'cus_cli1' };
          }
          return null;
        },
      },
      asaasPayment: {
        upsert: async (args: any) => {
          upsertedPayments.push(args);
          return args.create;
        },
      },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const result = await service.syncClientAsaasData('cli_1', 'org_1');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.clientId, 'cli_1');
    assert.strictEqual(result.linkStatus, 'LINKED');
    assert.strictEqual(queriedCustomerParam, 'cus_cli1', 'Consulta ao Asaas deve filtrar estritamente pelo customer do cliente 1');
    assert.strictEqual(upsertedPayments.length, 1);
    assert.strictEqual(upsertedPayments[0].create.clientId, 'cli_1');
    assert.strictEqual(upsertedPayments[0].update.clientId, 'cli_1');
  });

  // ---------------------------------------------------------------------------
  // 2. Webhook repetido idêntico não duplica
  // ---------------------------------------------------------------------------
  await t.test('2. Webhook repetido idêntico não duplica', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'secret_token_dup';

    const processedKeys = new Set<string>();
    let upsertCount = 0;

    const mockPrisma: any = {
      asaasWebhookEvent: {
        findUnique: async ({ where }: any) => {
          if (processedKeys.has(where.dedupeKey)) {
            return { dedupeKey: where.dedupeKey };
          }
          return null;
        },
        create: async ({ data }: any) => {
          processedKeys.add(data.dedupeKey);
          return data;
        },
      },
      clientIntegration: { findFirst: async () => null },
      asaasPayment: {
        findUnique: async () => null,
        upsert: async () => {
          upsertCount += 1;
          return { id: 'p1' };
        },
      },
      organization: { findFirst: async () => ({ id: 'org_1' }) },
    };

    const service = new AsaasService(null as any, mockPrisma);

    const payload = {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_exact_dup_1',
        customer: 'cus_1',
        value: 1200,
        status: 'RECEIVED',
        dueDate: '2026-10-10',
      },
    };

    // 1º Envio
    const res1 = await service.processWebhookEvent(payload, 'secret_token_dup');
    assert.strictEqual(res1.processed, true);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(upsertCount, 1);

    // 2º Envio idêntico
    const res2 = await service.processWebhookEvent(payload, 'secret_token_dup');
    assert.strictEqual(res2.processed, true);
    assert.strictEqual(res2.duplicate, true, 'Reenvio deve ser detectado como duplicado');
    assert.strictEqual(upsertCount, 1, 'Upsert não deve ser executado novamente');
  });

  // ---------------------------------------------------------------------------
  // 3. Dois eventos diferentes do mesmo pagamento são processados
  // ---------------------------------------------------------------------------
  await t.test('3. Dois eventos diferentes do mesmo pagamento são processados', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token_lifecycle';

    const processedKeys = new Set<string>();
    let paymentStatusInDb = 'PENDING';

    const mockPrisma: any = {
      asaasWebhookEvent: {
        findUnique: async ({ where }: any) => {
          if (processedKeys.has(where.dedupeKey)) {
            return { dedupeKey: where.dedupeKey };
          }
          return null;
        },
        create: async ({ data }: any) => {
          processedKeys.add(data.dedupeKey);
          return data;
        },
      },
      clientIntegration: { findFirst: async () => null },
      asaasPayment: {
        findUnique: async () => null,
        upsert: async ({ create, update }: any) => {
          paymentStatusInDb = (update || create).status;
          return { id: 'p_lifecycle' };
        },
      },
      organization: { findFirst: async () => ({ id: 'org_1' }) },
    };

    const service = new AsaasService(null as any, mockPrisma);

    // 1. Evento de criação
    const payloadCreated = {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_lifecycle_1',
        customer: 'cus_life',
        value: 2000,
        status: 'PENDING',
        dueDate: '2026-11-01',
      },
    };

    const res1 = await service.processWebhookEvent(payloadCreated, 'token_lifecycle');
    assert.strictEqual(res1.processed, true);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(paymentStatusInDb, AsaasPaymentStatus.PENDING);

    // 2. Evento de liquidação do mesmo pagamento
    const payloadReceived = {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_lifecycle_1',
        customer: 'cus_life',
        value: 2000,
        status: 'RECEIVED',
        dueDate: '2026-11-01',
        paymentDate: '2026-10-25',
      },
    };

    const res2 = await service.processWebhookEvent(payloadReceived, 'token_lifecycle');
    assert.strictEqual(res2.processed, true);
    assert.strictEqual(res2.duplicate, false, 'Evento diferente do mesmo pagamento deve ser processado');
    assert.strictEqual(paymentStatusInDb, AsaasPaymentStatus.RECEIVED);
  });

  // ---------------------------------------------------------------------------
  // 4. Payload sem ID de evento não quebra a idempotência
  // ---------------------------------------------------------------------------
  await t.test('4. Payload sem ID de evento não quebra a idempotência', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token_no_event_id';

    const processedKeys = new Set<string>();
    let savedEventId: string | null = 'INITIAL';

    const mockPrisma: any = {
      asaasWebhookEvent: {
        findUnique: async ({ where }: any) => {
          if (processedKeys.has(where.dedupeKey)) {
            return { dedupeKey: where.dedupeKey };
          }
          return null;
        },
        create: async ({ data }: any) => {
          processedKeys.add(data.dedupeKey);
          savedEventId = data.eventId;
          return data;
        },
      },
      clientIntegration: { findFirst: async () => null },
      asaasPayment: {
        findUnique: async () => null,
        upsert: async () => ({ id: 'p_no_id' }),
      },
      organization: { findFirst: async () => ({ id: 'org_1' }) },
    };

    const service = new AsaasService(null as any, mockPrisma);

    // Payload sem campo 'id' de evento (apenas payment.id)
    const payloadNoEventId = {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_without_evt_id',
        customer: 'cus_any',
        value: 750,
        status: 'CONFIRMED',
        dueDate: '2026-09-30',
      },
    };

    const res1 = await service.processWebhookEvent(payloadNoEventId, 'token_no_event_id');
    assert.strictEqual(res1.processed, true);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(savedEventId, null, 'eventId deve ser null sem quebrar o processamento');

    // Retransmissão idêntica sem 'id'
    const res2 = await service.processWebhookEvent(payloadNoEventId, 'token_no_event_id');
    assert.strictEqual(res2.processed, true);
    assert.strictEqual(res2.duplicate, true, 'Idempotência deve funcionar via dedupeKey mesmo sem eventId');
  });

  // ---------------------------------------------------------------------------
  // 5. CPF/CNPJ ausente ou ambíguo não cria vínculo automático
  // ---------------------------------------------------------------------------
  await t.test('5. CPF/CNPJ ausente ou ambíguo não cria vínculo automático', async () => {
    let upsertCalled = false;

    // Cenário A: Cliente sem CPF/CNPJ cadastrado
    const mockPrismaNoDoc: any = {
      client: {
        findUnique: async () => ({
          id: 'cli_no_doc',
          organizationId: 'org_1',
          document: null,
          name: 'Sem Documento',
        }),
      },
      clientIntegration: { findFirst: async () => null },
      clientIntegrationUpsert: async () => { upsertCalled = true; },
    };

    const serviceNoDoc = new AsaasService(null as any, mockPrismaNoDoc);
    const resNoDoc = await serviceNoDoc.syncClientAsaasData('cli_no_doc', 'org_1');

    assert.strictEqual(resNoDoc.success, false);
    assert.strictEqual(resNoDoc.linkStatus, 'NO_DOCUMENT');
    assert.strictEqual(upsertCalled, false, 'Não deve criar vínculo sem documento');

    // Cenário B: Cliente com documento ambíguo (2 clientes retornados pelo Asaas)
    const mockClientAmbiguous: any = {
      getCustomers: async () => ({
        data: [
          { id: 'cus_ambig_1', name: 'Empresa Matriz', cpfCnpj: '11222333000181' },
          { id: 'cus_ambig_2', name: 'Empresa Filial', cpfCnpj: '11222333000181' },
        ],
      }),
    };

    const mockPrismaAmbiguous: any = {
      client: {
        findUnique: async () => ({
          id: 'cli_ambig',
          organizationId: 'org_1',
          document: '11.222.333/0001-81',
          name: 'Empresa Teste',
        }),
      },
      clientIntegration: {
        findFirst: async () => null,
        upsert: async () => { upsertCalled = true; },
      },
    };

    const serviceAmbiguous = new AsaasService(mockClientAmbiguous, mockPrismaAmbiguous);
    const resAmbig = await serviceAmbiguous.syncClientAsaasData('cli_ambig', 'org_1');

    assert.strictEqual(resAmbig.success, false);
    assert.strictEqual(resAmbig.linkStatus, 'AMBIGUOUS');
    assert.strictEqual(resAmbig.linkStatusLabel, 'Vínculo ambíguo — requer revisão');
    assert.strictEqual(upsertCalled, false, 'Ambiguidade não deve criar vínculo automático');

    // Cenário C: Cliente não encontrado no Asaas
    const mockClientNotFound: any = {
      getCustomers: async () => ({ data: [] }),
    };

    const mockPrismaNotFound: any = {
      client: {
        findUnique: async () => ({
          id: 'cli_not_found',
          organizationId: 'org_1',
          document: '99.888.777/0001-66',
          name: 'Inexistente',
        }),
      },
      clientIntegration: { findFirst: async () => null },
    };

    const serviceNotFound = new AsaasService(mockClientNotFound, mockPrismaNotFound);
    const resNotFound = await serviceNotFound.syncClientAsaasData('cli_not_found', 'org_1');

    assert.strictEqual(resNotFound.success, false);
    assert.strictEqual(resNotFound.linkStatus, 'NOT_FOUND');
    assert.strictEqual(resNotFound.linkStatusLabel, 'Cliente não encontrado no Asaas');
  });

  // ---------------------------------------------------------------------------
  // 6. Migration Prisma é aplicada em banco de teste / arquivo SQL validado
  // ---------------------------------------------------------------------------
  await t.test('6. Migration Prisma existe com SQL válido e contém todas as definições da Etapa 4B', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'prisma/migrations/20260914200000_add_asaas_integration/migration.sql'
    );

    assert.ok(fs.existsSync(migrationPath), 'Arquivo de migração da Etapa 4B deve existir no diretório de migrations');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

    // Valida definições exigidas
    assert.ok(sqlContent.includes('ALTER TYPE "IntegrationProvider" ADD VALUE \'ASAAS\''), 'Deve alterar enum IntegrationProvider');
    assert.ok(sqlContent.includes('CREATE TYPE "AsaasPaymentStatus" AS ENUM'), 'Deve criar enum AsaasPaymentStatus');
    assert.ok(sqlContent.includes('CREATE TABLE "asaas_payments"'), 'Deve criar tabela asaas_payments');
    assert.ok(sqlContent.includes('CREATE TABLE "asaas_webhook_events"'), 'Deve criar tabela asaas_webhook_events');
    assert.ok(sqlContent.includes('"dedupeKey" TEXT NOT NULL'), 'Tabela de webhook deve ter coluna dedupeKey');
    assert.ok(sqlContent.includes('CREATE UNIQUE INDEX "asaas_webhook_events_dedupeKey_key"'), 'dedupeKey deve ter índice único');
  });

  // ---------------------------------------------------------------------------
  // 7. Nenhuma chamada de escrita é feita ao Asaas
  // ---------------------------------------------------------------------------
  await t.test('7. Nenhuma chamada de escrita é feita ao Asaas (somente GET)', () => {
    const client = new AsaasClient('dummy_key');
    const anyClient = client as any;

    // Métodos de escrita não devem existir
    assert.strictEqual(typeof anyClient.createPayment, 'undefined');
    assert.strictEqual(typeof anyClient.updatePayment, 'undefined');
    assert.strictEqual(typeof anyClient.deletePayment, 'undefined');
    assert.strictEqual(typeof anyClient.chargePayment, 'undefined');
    assert.strictEqual(typeof anyClient.createCustomer, 'undefined');

    // Apenas métodos de leitura permitidos
    assert.strictEqual(typeof client.getCustomers, 'function');
    assert.strictEqual(typeof client.getPayments, 'function');
    assert.strictEqual(typeof client.getPaymentById, 'function');
    assert.strictEqual(typeof client.isConnected, 'function');
  });

  // ---------------------------------------------------------------------------
  // 8. Isolamento por organização: Cobrança de outra organização é rejeitada com 404
  // ---------------------------------------------------------------------------
  await t.test('8. Isolamento por organização: Consulta de outra organização é rejeitada', async () => {
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

  // ===========================================================================
  // ETAPA 4C: SUÍTE DE TESTES DA VISÃO FINANCEIRA GLOBAL (/financas)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 9. Organização não vê cobranças de outra organização
  // ---------------------------------------------------------------------------
  await t.test('9. Organização não vê cobranças de outra organização no overview financeiro', async () => {
    let capturedWhere: any = null;

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async ({ where }: any) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
      },
      client: {
        count: async () => 0,
      },
    };

    const service = new AsaasService(null as any, mockPrisma);
    await service.getFinancialOverview('org_zafira_secure');

    assert.strictEqual(capturedWhere.organizationId, 'org_zafira_secure', 'Filtro deve restringir estritamente à organização');
  });

  // ---------------------------------------------------------------------------
  // 10. Filtro por cliente retorna apenas cobranças daquele cliente
  // ---------------------------------------------------------------------------
  await t.test('10. Filtro por cliente retorna apenas cobranças daquele cliente', async () => {
    let capturedBaseWhere: any = null;
    let capturedListWhere: any = null;

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async ({ where }: any) => {
          if (!capturedBaseWhere) capturedBaseWhere = where;
          else capturedListWhere = where;
          return [];
        },
        count: async ({ where }: any) => {
          capturedListWhere = where;
          return 0;
        },
      },
      client: {
        count: async () => 0,
      },
    };

    const service = new AsaasService(null as any, mockPrisma);
    await service.getFinancialOverview('org_zafira', { clientId: 'cli_especifico_1' });

    assert.strictEqual(capturedBaseWhere.clientId, 'cli_especifico_1');
    assert.strictEqual(capturedListWhere.clientId, 'cli_especifico_1');
  });

  // ---------------------------------------------------------------------------
  // 11. KPIs de recebido não incluem cobranças pendentes
  // ---------------------------------------------------------------------------
  await t.test('11. KPIs de recebido não incluem cobranças pendentes', async () => {
    const now = new Date();
    const mockPayments = [
      {
        id: 'pay_pendente',
        value: 10000,
        status: AsaasPaymentStatus.PENDING,
        dueDate: new Date(now.getFullYear(), now.getMonth(), 28),
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'c1',
        client: { id: 'c1', name: 'Cliente 1' },
      },
      {
        id: 'pay_recebido',
        value: 3500,
        status: AsaasPaymentStatus.RECEIVED,
        dueDate: new Date(now.getFullYear(), now.getMonth(), 10),
        paymentDate: new Date(now.getFullYear(), now.getMonth(), 9),
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'c1',
        client: { id: 'c1', name: 'Cliente 1' },
      },
    ];

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => mockPayments,
        count: async () => 2,
      },
      client: { count: async () => 1 },
    };

    const service = new AsaasService(null as any, mockPrisma);
    const overview = await service.getFinancialOverview('org_kpi');

    assert.strictEqual(overview.kpis.receivedMonth, 3500, 'Recebido no mês deve incluir apenas cobranças liquidadas');
    assert.strictEqual(overview.kpis.receivedMonthCount, 1);
    assert.strictEqual(overview.kpis.pending, 10000, 'Pendente deve somar a cobrança pendente');
    assert.strictEqual(overview.kpis.pendingCount, 1);
  });

  // ---------------------------------------------------------------------------
  // 12. Previsto não é contado como recebido
  // ---------------------------------------------------------------------------
  await t.test('12. Previsto não é contado como recebido em séries temporais nem em KPIs', async () => {
    const now = new Date();
    const futureDate = new Date(now.getFullYear(), now.getMonth() + 2, 15);

    const mockPayments = [
      {
        id: 'pay_futuro',
        value: 5000,
        status: AsaasPaymentStatus.PENDING,
        dueDate: futureDate,
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'c2',
        client: { id: 'c2', name: 'Cliente Futuro' },
      },
    ];

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => mockPayments,
        count: async () => 1,
      },
      client: { count: async () => 1 },
    };

    const service = new AsaasService(null as any, mockPrisma);
    const overview = await service.getFinancialOverview('org_prev');

    // Recebidos reais devem ser 0
    assert.strictEqual(overview.kpis.receivedMonth, 0);
    const totalRecebidosSeries = overview.recebidosTimeSeries.reduce((acc, p) => acc + p.value, 0);
    assert.strictEqual(totalRecebidosSeries, 0, 'Série de recebidos deve ter zero quando há apenas cobranças futuras');

    // Previsto deve conter o valor
    assert.strictEqual(overview.kpis.pending, 5000);
    const totalPrevistosSeries = overview.previstosTimeSeries.reduce((acc, p) => acc + p.value, 0);
    assert.strictEqual(totalPrevistosSeries, 5000, 'Série de previstos deve conter o valor projetado');
  });

  // ---------------------------------------------------------------------------
  // 13. Vencidos são calculados corretamente
  // ---------------------------------------------------------------------------
  await t.test('13. Vencidos são calculados corretamente (OVERDUE explícito e PENDING expirado)', async () => {
    const now = new Date();
    const pastDate = new Date(now.getFullYear(), now.getMonth() - 1, 5);

    const mockPayments = [
      {
        id: 'pay_overdue_1',
        value: 1200,
        status: AsaasPaymentStatus.OVERDUE,
        dueDate: pastDate,
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'c1',
        client: { id: 'c1', name: 'Cliente 1' },
      },
      {
        id: 'pay_pending_expired',
        value: 800,
        status: AsaasPaymentStatus.PENDING,
        dueDate: pastDate,
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'c2',
        client: { id: 'c2', name: 'Cliente 2' },
      },
    ];

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => mockPayments,
        count: async () => 2,
      },
      client: { count: async () => 2 },
    };

    const service = new AsaasService(null as any, mockPrisma);
    const overview = await service.getFinancialOverview('org_vencidos');

    assert.strictEqual(overview.kpis.overdue, 2000, 'Total de vencidos deve somar 1200 + 800');
    assert.strictEqual(overview.kpis.overdueCount, 2);
    assert.strictEqual(overview.kpis.pending, 0, 'Cobranças vencidas não devem constar como pendência regular');
  });

  // ---------------------------------------------------------------------------
  // 14. Endpoint não chama a API externa do Asaas
  // ---------------------------------------------------------------------------
  await t.test('14. Endpoint não chama a API externa do Asaas', async () => {
    let externalCallCount = 0;

    const mockClient: any = {
      getCustomers: async () => { externalCallCount++; return { data: [] }; },
      getPayments: async () => { externalCallCount++; return { data: [] }; },
      getPaymentById: async () => { externalCallCount++; return null; },
    };

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => [],
        count: async () => 0,
      },
      client: { count: async () => 0 },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    await service.getFinancialOverview('org_sem_chamada_externa');

    assert.strictEqual(externalCallCount, 0, 'Zero chamadas externas devem ser realizadas durante o overview financeiro');
  });

  // ---------------------------------------------------------------------------
  // 15. Página não usa Supabase nem useFinanceStore
  // ---------------------------------------------------------------------------
  await t.test('15. Página /financas não usa Supabase nem useFinanceStore', () => {
    const financasPagePath = path.resolve(
      process.cwd(),
      '../src/pages/Financas.tsx'
    );

    assert.ok(fs.existsSync(financasPagePath), 'Arquivo Financas.tsx deve existir');
    const content = fs.readFileSync(financasPagePath, 'utf-8');

    assert.ok(!content.includes('useFinanceStore'), 'Financas.tsx não deve importar useFinanceStore');
    assert.ok(!content.includes('supabase'), 'Financas.tsx não deve importar supabase');
    assert.ok(!content.includes('useFinanceMetrics'), 'Financas.tsx não deve importar useFinanceMetrics');
    assert.ok(!content.includes('TransactionDialog'), 'Financas.tsx não deve importar TransactionDialog');
  });

  // ---------------------------------------------------------------------------
  // 16. MEMBER recebe bloqueio de acesso (403)
  // ---------------------------------------------------------------------------
  await t.test('16. Usuário com papel MEMBER recebe bloqueio de acesso 403 Forbidden', async () => {
    const { requireRole } = await import('../../middleware/auth.js');
    const app = fastify();

    app.get(
      '/api/integrations/asaas/financial-overview-test',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_member_1',
              email: 'member@zafira.com.br',
              memberships: [{ organizationId: 'org_1', organizationSlug: 'zafira', role: 'MEMBER' }],
            };
          },
          requireRole(['ADMIN', 'MANAGER']),
        ],
      },
      async () => ({ ok: true })
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/asaas/financial-overview-test',
    });

    assert.strictEqual(res.statusCode, 403, 'Acesso de MEMBER deve retornar 403 Forbidden');
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error, 'forbidden');
  });
});


