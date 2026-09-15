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
  mapAsaasPaymentStatus,
  parseCalendarDate,
  formatCalendarDate,
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
  // 12. Previsto não é contado como recebido e respeita o período selecionado
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
    
    // No mês atual (default), a cobrança a 2 meses no futuro não deve contaminar o card de previsto
    const overviewCurrent = await service.getFinancialOverview('org_prev');
    assert.strictEqual(overviewCurrent.kpis.receivedMonth, 0);
    assert.strictEqual(overviewCurrent.kpis.pending, 0, 'Cobrança futura não deve contaminar o mês atual');
    const totalRecebidosSeries = overviewCurrent.recebidosTimeSeries.reduce((acc, p) => acc + p.value, 0);
    assert.strictEqual(totalRecebidosSeries, 0, 'Série de recebidos deve ter zero quando há apenas cobranças futuras');

    // Na série móvel dos próximos 6 meses, a projeção futura deve aparecer
    const totalPrevistosSeries = overviewCurrent.previstosTimeSeries.reduce((acc, p) => acc + p.value, 0);
    assert.strictEqual(totalPrevistosSeries, 5000, 'Série de previstos móvel deve conter o valor projetado nos próximos 6 meses');

    // Quando o filtro for 'all' ou 'current-year', a pendência total é contabilizada
    const overviewAll = await service.getFinancialOverview('org_prev', { period: 'all' });
    assert.strictEqual(overviewAll.kpis.pending, 5000, 'Filtro all deve retornar a pendência global');
  });

  // ---------------------------------------------------------------------------
  // 13. Vencidos são calculados corretamente respeitando o período
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

    // No mês atual, cobranças vencidas do mês anterior não devem contaminar o card de vencidos
    const overviewCurrent = await service.getFinancialOverview('org_vencidos');
    assert.strictEqual(overviewCurrent.kpis.overdue, 0, 'Vencidos de meses anteriores não devem contaminar o mês atual');
    assert.strictEqual(overviewCurrent.kpis.overdueCount, 0);
    assert.strictEqual(overviewCurrent.kpis.pending, 0);

    // No mês anterior ('last-month') ou 'all', as cobranças vencidas devem ser totalizadas
    const overviewLastMonth = await service.getFinancialOverview('org_vencidos', { period: 'last-month' });
    assert.strictEqual(overviewLastMonth.kpis.overdue, 2000, 'Total de vencidos no mês anterior deve somar 1200 + 800');
    assert.strictEqual(overviewLastMonth.kpis.overdueCount, 2);
    assert.strictEqual(overviewLastMonth.kpis.pending, 0, 'Cobranças vencidas não devem constar como pendência regular');
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

  // ===========================================================================
  // ETAPA: SINCRONIZAR CARTEIRA COMPLETA DO ASAAS (WALLET SYNC)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 17. Cliente Asaas novo com CNPJ válido cria um único cliente Hub
  // ---------------------------------------------------------------------------
  await t.test('17. Cliente Asaas novo com CNPJ válido cria um único cliente Hub', async () => {
    let createdClientData: any = null;

    const mockClient: any = {
      getAllCustomers: async () => [
        {
          id: 'cus_novo_1',
          name: 'Empresa Alfa Ltda',
          cpfCnpj: '12.345.678/0001-99',
          email: 'contato@alfa.com.br',
          phone: '(11) 98888-7777',
        },
      ],
      getAllPayments: async () => [],
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => [], // Nenhum cliente pré-existente
        create: async ({ data }: any) => {
          createdClientData = data;
          return { id: 'cli_hub_novo_1', ...data };
        },
      },
      clientIntegration: {
        upsert: async () => ({}),
      },
      asaasPayment: {
        upsert: async () => ({}),
      },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const result = await service.syncAllWallet('org_zafira');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.createdClients, 1);
    assert.strictEqual(result.linkedClients, 0);
    assert.ok(createdClientData, 'Cliente deve ter sido criado no Prisma');
    assert.strictEqual(createdClientData.name, 'Empresa Alfa Ltda');
    assert.strictEqual(createdClientData.document, '12345678000199');
    assert.strictEqual(createdClientData.status, 'ACTIVE');
    assert.strictEqual(createdClientData.organizationId, 'org_zafira');
  });

  // ---------------------------------------------------------------------------
  // 18. Segunda sincronização não duplica cliente
  // ---------------------------------------------------------------------------
  await t.test('18. Segunda sincronização não duplica cliente (idempotência)', async () => {
    let createCallCount = 0;
    const existingDbClients = [
      {
        id: 'cli_ja_existe',
        name: 'Empresa Alfa Ltda',
        document: '12345678000199',
        status: 'ACTIVE',
        organizationId: 'org_zafira',
        integrations: [{ provider: 'ASAAS', externalId: 'cus_novo_1' }],
      },
    ];

    const mockClient: any = {
      getAllCustomers: async () => [
        {
          id: 'cus_novo_1',
          name: 'Empresa Alfa Ltda',
          cpfCnpj: '12.345.678/0001-99',
        },
      ],
      getAllPayments: async () => [],
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => existingDbClients,
        create: async () => {
          createCallCount += 1;
          return {};
        },
      },
      clientIntegration: {
        upsert: async () => ({}),
      },
      asaasPayment: {
        upsert: async () => ({}),
      },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const result = await service.syncAllWallet('org_zafira');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.createdClients, 0, 'Não deve criar novo cliente na segunda execução');
    assert.strictEqual(result.linkedClients, 1, 'Deve vincular cliente já existente');
    assert.strictEqual(createCallCount, 0, 'client.create não deve ser invocado');
  });

  // ---------------------------------------------------------------------------
  // 19. Cliente com mesmo CPF/CNPJ já no Hub é vinculado, sem sobrescrever dados manuais
  // ---------------------------------------------------------------------------
  await t.test('19. Cliente com mesmo CPF/CNPJ já no Hub é vinculado, sem sobrescrever dados manuais', async () => {
    let clientUpdateCalled = false;
    let clientIntegrationUpsertData: any = null;

    const existingClient = {
      id: 'cli_manual_1',
      name: 'Nome Customizado Manualmente Pela Zafira',
      document: '98765432000155',
      status: 'LEAD',
      email: 'manual@email.com',
      phone: '11999999999',
      contractValue: 5000,
      integrations: [],
    };

    const mockClient: any = {
      getAllCustomers: async () => [
        {
          id: 'cus_asaas_diff',
          name: 'Razão Social Asaas Divergente',
          cpfCnpj: '98.765.432/0001-55',
          email: 'outro@asaas.com',
        },
      ],
      getAllPayments: async () => [],
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => [existingClient],
        update: async () => {
          clientUpdateCalled = true;
        },
        create: async () => { throw new Error('Não deveria criar'); },
      },
      clientIntegration: {
        upsert: async (args: any) => {
          clientIntegrationUpsertData = args;
          return {};
        },
      },
      asaasPayment: {
        upsert: async () => ({}),
      },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const result = await service.syncAllWallet('org_zafira');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.linkedClients, 1);
    assert.strictEqual(result.createdClients, 0);
    assert.strictEqual(clientUpdateCalled, false, 'Dados manuais do cliente Hub jamais devem ser atualizados');
    assert.strictEqual(existingClient.name, 'Nome Customizado Manualmente Pela Zafira');
    assert.strictEqual(existingClient.status, 'LEAD', 'Status original deve ser mantido');
    assert.ok(clientIntegrationUpsertData, 'Vínculo ClientIntegration deve ser garantido');
    assert.strictEqual(clientIntegrationUpsertData.where.clientId_provider_externalId.clientId, 'cli_manual_1');
  });

  // ---------------------------------------------------------------------------
  // 20. Cliente sem documento válido é ignorado
  // ---------------------------------------------------------------------------
  await t.test('20. Cliente sem documento válido é ignorado e não é criado', async () => {
    let createCalled = false;

    const mockClient: any = {
      getAllCustomers: async () => [
        { id: 'cus_no_doc', name: 'Cliente Sem CPF/CNPJ', cpfCnpj: null },
        { id: 'cus_invalid_doc', name: 'Cliente Doc Incompleto', cpfCnpj: '123.456' },
      ],
      getAllPayments: async () => [],
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => [],
        create: async () => { createCalled = true; return {}; },
      },
      clientIntegration: { upsert: async () => ({}) },
      asaasPayment: { upsert: async () => ({}) },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const result = await service.syncAllWallet('org_zafira');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.ignoredWithoutDoc, 2);
    assert.strictEqual(result.createdClients, 0);
    assert.strictEqual(createCalled, false, 'Nenhum cliente sem documento válido deve ser criado');
  });

  // ---------------------------------------------------------------------------
  // 21. Cliente de outra organização nunca é usado ou alterado
  // ---------------------------------------------------------------------------
  await t.test('21. Cliente de outra organização nunca é usado ou alterado', async () => {
    let capturedOrgIdInQuery: string | null = null;
    let createdWithOrgId: string | null = null;

    const mockClient: any = {
      getAllCustomers: async () => [
        { id: 'cus_1', name: 'Cliente Novo', cpfCnpj: '11222333000144' },
      ],
      getAllPayments: async () => [],
    };

    const mockPrisma: any = {
      client: {
        findMany: async ({ where }: any) => {
          capturedOrgIdInQuery = where.organizationId;
          return [];
        },
        create: async ({ data }: any) => {
          createdWithOrgId = data.organizationId;
          return { id: 'c1', ...data };
        },
      },
      clientIntegration: { upsert: async () => ({}) },
      asaasPayment: { upsert: async () => ({}) },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    await service.syncAllWallet('org_isolada_A');

    assert.strictEqual(capturedOrgIdInQuery, 'org_isolada_A');
    assert.strictEqual(createdWithOrgId, 'org_isolada_A');
  });

  // ---------------------------------------------------------------------------
  // 22. Pagamentos são vinculados ao cliente correto
  // ---------------------------------------------------------------------------
  await t.test('22. Pagamentos são vinculados ao cliente correto correspondente', async () => {
    let upsertedPaymentClientId: string | null = null;

    const mockClient: any = {
      getAllCustomers: async () => [
        { id: 'cus_asaas_x', name: 'Cliente X', cpfCnpj: '55666777000188' },
      ],
      getAllPayments: async () => [
        {
          id: 'pay_x_1',
          customer: 'cus_asaas_x',
          value: 1800,
          status: 'RECEIVED',
          dueDate: '2026-10-10',
        },
      ],
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => [],
        create: async ({ data }: any) => ({ id: 'cli_hub_gerado_x', ...data }),
      },
      clientIntegration: { upsert: async () => ({}) },
      asaasPayment: {
        upsert: async ({ create }: any) => {
          upsertedPaymentClientId = create.clientId;
          return create;
        },
      },
    };

    const service = new AsaasService(mockClient, mockPrisma);
    const res = await service.syncAllWallet('org_1');

    assert.strictEqual(res.syncedPayments, 1);
    assert.strictEqual(upsertedPaymentClientId, 'cli_hub_gerado_x', 'Cobrança deve ser vinculada ao cliente Hub criado');
  });

  // ---------------------------------------------------------------------------
  // 23. Nenhuma chamada de escrita é feita ao Asaas na sincronização de carteira
  // ---------------------------------------------------------------------------
  await t.test('23. Nenhuma chamada de escrita é feita ao Asaas (apenas leitura GET)', async () => {
    const client = new AsaasClient('dummy');
    assert.strictEqual(typeof (client as any).post, 'undefined');
    assert.strictEqual(typeof (client as any).put, 'undefined');
    assert.strictEqual(typeof (client as any).delete, 'undefined');
  });

  // ---------------------------------------------------------------------------
  // 24. MEMBER recebe 403 no endpoint POST /integrations/asaas/sync-all
  // ---------------------------------------------------------------------------
  await t.test('24. Endpoint POST /api/integrations/asaas/sync-all bloqueia MEMBER com 403 Forbidden', async () => {
    const { requireRole } = await import('../../middleware/auth.js');
    const app = fastify();

    app.post(
      '/api/integrations/asaas/sync-all-test',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_member_2',
              email: 'member2@zafira.com.br',
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
      method: 'POST',
      url: '/api/integrations/asaas/sync-all-test',
    });

    assert.strictEqual(res.statusCode, 403, 'Acesso de MEMBER em sync-all deve retornar 403 Forbidden');
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error, 'forbidden');
  });

  // ---------------------------------------------------------------------------
  // 25. Conciliação de KPIs por período: isolamento de cobranças de meses diferentes
  // ---------------------------------------------------------------------------
  await t.test('25. Conciliação de KPIs por período: isolamento de cobranças de meses diferentes', async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const currentMonthDate = new Date(currentYear, currentMonth, 15);
    const pastMonthDate = new Date(currentYear, currentMonth - 1, 10);
    const futureMonthDate = new Date(currentYear, currentMonth + 1, 20);

    const mockPayments = [
      // 1. Recebida no mês atual (R$ 2.697,00)
      {
        id: 'pay_rec_mes',
        value: 2697,
        status: AsaasPaymentStatus.RECEIVED,
        dueDate: currentMonthDate,
        paymentDate: currentMonthDate,
        clientPaymentDate: currentMonthDate,
        updatedAt: currentMonthDate,
        clientId: 'cli_1',
        client: { id: 'cli_1', name: 'Cliente Mês Atual' },
      },
      // 2. Recebida em mês anterior (R$ 1.500,00)
      {
        id: 'pay_rec_ant',
        value: 1500,
        status: AsaasPaymentStatus.RECEIVED,
        dueDate: pastMonthDate,
        paymentDate: pastMonthDate,
        clientPaymentDate: pastMonthDate,
        updatedAt: pastMonthDate,
        clientId: 'cli_2',
        client: { id: 'cli_2', name: 'Cliente Mês Anterior' },
      },
      // 3. Pendente do mês atual (R$ 5,00)
      {
        id: 'pay_pend_mes',
        value: 5,
        status: AsaasPaymentStatus.PENDING,
        dueDate: new Date(currentYear, currentMonth, 25), // futuro dentro do mês atual
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'cli_3',
        client: { id: 'cli_3', name: 'Cliente Teste' },
      },
      // 4. Pendente futura (R$ 4.291,00)
      {
        id: 'pay_pend_fut',
        value: 4291,
        status: AsaasPaymentStatus.PENDING,
        dueDate: futureMonthDate,
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'cli_4',
        client: { id: 'cli_4', name: 'Cliente Futuro' },
      },
      // 5. Vencida de mês anterior (R$ 3.845,00)
      {
        id: 'pay_venc_ant',
        value: 3845,
        status: AsaasPaymentStatus.OVERDUE,
        dueDate: pastMonthDate,
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'cli_5',
        client: { id: 'cli_5', name: 'Cliente Inadimplente Passado' },
      },
    ];

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => mockPayments,
        count: async () => mockPayments.length,
      },
      client: { count: async () => 5 },
    };

    const service = new AsaasService(null as any, mockPrisma);

    // A) Filtro 'current-month':
    // - Recebido: R$ 2.697,00 (1 cobrança)
    // - Em aberto: R$ 5,00 (1 cobrança, R$ 4.291 do mês futuro é excluído)
    // - Vencido: R$ 0,00 (0 cobranças, R$ 3.845 do mês anterior é excluído)
    const resCurrent = await service.getFinancialOverview('org_multi_period', { period: 'current-month' });
    assert.strictEqual(resCurrent.kpis.receivedMonth, 2697, 'Recebido no mês atual deve ser 2697');
    assert.strictEqual(resCurrent.kpis.receivedMonthCount, 1);
    assert.strictEqual(resCurrent.kpis.pending, 5, 'Em aberto no mês atual deve ser estritamente 5 (sem contaminação futura)');
    assert.strictEqual(resCurrent.kpis.pendingCount, 1);
    assert.strictEqual(resCurrent.kpis.overdue, 0, 'Vencido no mês atual deve ser 0 (sem contaminação de meses passados)');
    assert.strictEqual(resCurrent.kpis.overdueCount, 0);

    // B) Filtro 'last-month':
    // - Recebido: R$ 1.500,00 (1 cobrança)
    // - Em aberto: R$ 0,00
    // - Vencido: R$ 3.845,00 (1 cobrança)
    const resLast = await service.getFinancialOverview('org_multi_period', { period: 'last-month' });
    assert.strictEqual(resLast.kpis.receivedMonth, 1500, 'Recebido no mês anterior deve ser 1500');
    assert.strictEqual(resLast.kpis.receivedMonthCount, 1);
    assert.strictEqual(resLast.kpis.pending, 0, 'Em aberto no mês anterior deve ser 0');
    assert.strictEqual(resLast.kpis.overdue, 3845, 'Vencido no mês anterior deve ser 3845');
    assert.strictEqual(resLast.kpis.overdueCount, 1);

    // C) Filtro 'all':
    // - Recebido global: 2697 + 1500 = 4197
    // - Em aberto global: 5 + 4291 = 4296
    // - Vencido global: 3845
    const resAll = await service.getFinancialOverview('org_multi_period', { period: 'all' });
    assert.strictEqual(resAll.kpis.receivedMonth, 4197);
    assert.strictEqual(resAll.kpis.pending, 4296);
    assert.strictEqual(resAll.kpis.overdue, 3845);
  });

  // ---------------------------------------------------------------------------
  // 26. Data de recebimento estrita (paymentDate ?? clientPaymentDate) sem fallback para updatedAt
  // ---------------------------------------------------------------------------
  await t.test('26. Data de recebimento estrita (paymentDate ?? clientPaymentDate) sem fallback para updatedAt', async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const pastMonthDate = new Date(currentYear, currentMonth - 1, 15);

    const mockPayments = [
      // Cobrança 1: Paga no mês anterior, mas sincronizada/atualizada no mês atual (updatedAt = now)
      {
        id: 'pay_past_updated_now',
        value: 3000,
        status: AsaasPaymentStatus.RECEIVED,
        dueDate: pastMonthDate,
        paymentDate: pastMonthDate, // liquidação real no mês passado
        clientPaymentDate: null,
        updatedAt: now, // sincronização no mês atual não deve contaminar o mês atual!
        clientId: 'cli_audit_1',
        client: { id: 'cli_audit_1', name: 'Cliente Audit 1' },
      },
      // Cobrança 2: Status RECEIVED mas sem paymentDate nem clientPaymentDate (dado incompleto)
      {
        id: 'pay_received_no_date',
        value: 1200,
        status: AsaasPaymentStatus.RECEIVED,
        dueDate: pastMonthDate,
        paymentDate: null,
        clientPaymentDate: null,
        updatedAt: now,
        clientId: 'cli_audit_2',
        client: { id: 'cli_audit_2', name: 'Cliente Incompleto' },
      },
    ];

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => mockPayments,
        count: async () => mockPayments.length,
      },
      client: { count: async () => 2 },
    };

    const service = new AsaasService(null as any, mockPrisma);

    // No mês atual ('current-month'):
    // - Cobrança 1 NÃO pode entrar (foi liquidada no mês passado, apesar de updatedAt ser hoje)
    // - Cobrança 2 NÃO pode entrar (não possui paymentDate nem clientPaymentDate)
    const overviewCurrent = await service.getFinancialOverview('org_strict_date', { period: 'current-month' });
    assert.strictEqual(
      overviewCurrent.kpis.receivedMonth,
      0,
      'Pagamento recebido no mês passado com updatedAt no mês atual NÃO pode aparecer como recebido no mês atual'
    );
    assert.strictEqual(overviewCurrent.kpis.receivedMonthCount, 0);
    assert.strictEqual(
      overviewCurrent.kpis.incompletePaymentsCount,
      1,
      'Cobrança com status RECEIVED sem data de liquidação deve ser contabilizada como dado incompleto para auditoria'
    );

    // No mês anterior ('last-month'):
    // - Cobrança 1 entra normalmente pelo paymentDate real
    const overviewPast = await service.getFinancialOverview('org_strict_date', { period: 'last-month' });
    assert.strictEqual(
      overviewPast.kpis.receivedMonth,
      3000,
      'Pagamento recebido no mês anterior deve constar exclusivamente no mês anterior'
    );
    assert.strictEqual(overviewPast.kpis.receivedMonthCount, 1);

    // Série temporal de recebimentos:
    // Apenas a cobrança 1 deve constar no ponto do mês anterior; a cobrança sem data é excluída dos gráficos
    const totalSeries = overviewCurrent.recebidosTimeSeries.reduce((acc, p) => acc + p.value, 0);
    assert.strictEqual(
      totalSeries,
      3000,
      'Apenas cobranças com data de liquidação válida devem compor as séries temporais'
    );
  });

  // ---------------------------------------------------------------------------
  // 27. Auditoria de cobrança residual cancelada/deletada (PNEUTEK R$ 1.594,00)
  // ---------------------------------------------------------------------------
  await t.test('27. Cobrança com deleted: true ou PAYMENT_DELETED (PNEUTEK R$ 1.594,00) é excluída de Pendentes/Em Aberto e não infla os KPIs', async () => {
    const now = new Date();
    const currentMonthDueDate = new Date(now.getFullYear(), now.getMonth(), 20, 12, 0, 0);

    // 1. Validação unitária de mapAsaasPaymentStatus com deleted
    assert.strictEqual(
      mapAsaasPaymentStatus('PENDING', true),
      AsaasPaymentStatus.DELETED,
      'Cobrança com deleted: true deve ser mapeada como DELETED mesmo se status vier como PENDING'
    );
    assert.strictEqual(
      mapAsaasPaymentStatus('PENDING', false, 'PAYMENT_DELETED'),
      AsaasPaymentStatus.DELETED,
      'Webhook com evento PAYMENT_DELETED deve ser mapeado como DELETED'
    );

    // 2. Validação no getFinancialOverview com o cenário real da divergência residual:
    // - Cobrança 1: PNEUTEK R$ 1.594,00 vencimento no mês, com rawPayload.deleted: true (cancelada/deletada)
    // - Cobrança 2: Cliente Teste R$ 5,00 vencimento no mês, pendente ativa (deleted: false)
    const mockPayments = [
      {
        id: 'db_pay_pneutek_1594',
        externalId: 'pay_z9bl8vgevjcb5ty3',
        value: 1594,
        status: AsaasPaymentStatus.PENDING, // mesmo se gravado originalmente como PENDING no banco
        dueDate: currentMonthDueDate,
        paymentDate: null,
        clientPaymentDate: null,
        clientId: 'cli_pneutek',
        rawPayload: {
          id: 'pay_z9bl8vgevjcb5ty3',
          status: 'PENDING',
          value: 1594,
          deleted: true, // Fatura cancelada / removida pelo fornecedor no Asaas
        },
        client: { id: 'cli_pneutek', name: 'PNEUTEK COMÉRCIO DE PNEUS LTDA' },
      },
      {
        id: 'db_pay_teste_5',
        externalId: 'pay_xtm5d9d6kci3avnc',
        value: 5,
        status: AsaasPaymentStatus.PENDING,
        dueDate: currentMonthDueDate,
        paymentDate: null,
        clientPaymentDate: null,
        clientId: 'cli_teste',
        rawPayload: {
          id: 'pay_xtm5d9d6kci3avnc',
          status: 'PENDING',
          value: 5,
          deleted: false,
        },
        client: { id: 'cli_teste', name: 'Cliente Teste Hub 2.0' },
      },
    ];

    const mockPrisma: any = {
      asaasPayment: {
        findMany: async () => mockPayments,
        count: async () => mockPayments.length,
      },
      client: { count: async () => 2 },
    };

    const service = new AsaasService(null as any, mockPrisma);

    const overview = await service.getFinancialOverview('org_pneutek_audit', { period: 'current-month' });

    // O KPI 'pending' (Em Aberto / Previsto) deve refletir EXCLUSIVAMENTE a cobrança ativa de R$ 5,00,
    // conciliando 100% com o painel Asaas ('Aguardando pagamento: R$ 5,00 em 1 cobrança').
    assert.strictEqual(
      overview.kpis.pending,
      5,
      'Em Aberto deve somar apenas cobranças ativas (R$ 5,00), excluindo a cobrança deletada de R$ 1.594,00'
    );
    assert.strictEqual(
      overview.kpis.pendingCount,
      1,
      'Apenas 1 cobrança ativa deve constar como pendente'
    );
    assert.strictEqual(
      overview.kpis.statusCounts.cancelled,
      1,
      'A cobrança de R$ 1.594,00 da PNEUTEK deve ser contabilizada como cancelada'
    );
    assert.strictEqual(
      overview.kpis.overdue,
      0,
      'Vencido deve ser R$ 0,00'
    );

    // Próximo vencimento deve apontar para o Cliente Teste de R$ 5,00 e não para a cobrança cancelada
    assert.strictEqual(
      overview.kpis.nextDueDate?.value,
      5,
      'Próximo vencimento deve considerar apenas cobranças ativas'
    );
    assert.strictEqual(
      overview.kpis.nextDueDate?.clientName,
      'Cliente Teste Hub 2.0'
    );
  });

  // ---------------------------------------------------------------------------
  // 28. Sincronização atualiza registro existente PENDING -> DELETED e expurga dos KPIs
  // ---------------------------------------------------------------------------
  await t.test('28. Sincronização atualiza cobrança existente no banco de PENDING para DELETED via deleted: true', async () => {
    const now = new Date();
    const currentMonthDueDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`;
    const currentMonthDueDate = new Date(now.getFullYear(), now.getMonth(), 20, 12, 0, 0);

    // 1. Registro já existente no banco de dados local com status PENDING
    const localDatabase = new Map<string, any>();
    localDatabase.set('pay_z9bl8vgevjcb5ty3', {
      id: 'db_local_pneutek',
      externalId: 'pay_z9bl8vgevjcb5ty3',
      organizationId: 'org_sync_update_test',
      clientId: 'cli_pneutek_test',
      value: 1594,
      status: AsaasPaymentStatus.PENDING, // Inicialmente PENDING no banco local
      dueDate: currentMonthDueDate,
      paymentDate: null,
      clientPaymentDate: null,
      rawPayload: { id: 'pay_z9bl8vgevjcb5ty3', status: 'PENDING', value: 1594 },
      client: { id: 'cli_pneutek_test', name: 'PNEUTEK COMÉRCIO DE PNEUS LTDA' },
    });

    // 2. Simulação da API do Asaas retornando a cobrança com status: 'PENDING' e deleted: true
    const mockAsaasClient: any = {
      getCustomers: async () => ({ data: [] }),
      getAllCustomers: async () => [
        { id: 'cus_pneutek', name: 'PNEUTEK', cpfCnpj: '27702502000194' },
        { id: 'cus_teste', name: 'Cliente Teste', cpfCnpj: '11122233344' },
      ],
      getAllPayments: async () => [
        {
          id: 'pay_z9bl8vgevjcb5ty3',
          customer: 'cus_pneutek',
          value: 1594,
          status: 'PENDING',
          dueDate: currentMonthDueDateStr,
          deleted: true, // Asaas indica que foi deletada
          billingType: 'PIX',
        },
        {
          id: 'pay_xtm5d9d6kci3avnc',
          customer: 'cus_teste',
          value: 5,
          status: 'PENDING',
          dueDate: currentMonthDueDateStr,
          deleted: false,
          billingType: 'PIX',
        }
      ],
    };

    const mockPrisma: any = {
      client: {
        findMany: async () => [
          { id: 'cli_pneutek_test', document: '27702502000194', name: 'PNEUTEK', integrations: [{ provider: 'ASAAS', externalId: 'cus_pneutek' }] },
          { id: 'cli_teste_test', document: '11122233344', name: 'Cliente Teste', integrations: [{ provider: 'ASAAS', externalId: 'cus_teste' }] },
        ],
        count: async () => 2,
      },
      clientIntegration: {
        upsert: async () => ({}),
      },
      asaasPayment: {
        upsert: async ({ where, create, update }: any) => {
          const externalId = where.externalId;
          const existing = localDatabase.get(externalId);
          if (existing) {
            const updatedRecord = { ...existing, ...update };
            localDatabase.set(externalId, updatedRecord);
            return updatedRecord;
          } else {
            const newRecord = {
              id: `db_${externalId}`,
              externalId,
              ...create,
              client: { id: create.clientId, name: create.clientId === 'cli_pneutek_test' ? 'PNEUTEK' : 'Cliente Teste' },
            };
            localDatabase.set(externalId, newRecord);
            return newRecord;
          }
        },
        findMany: async () => Array.from(localDatabase.values()).map((p) => ({
          ...p,
          client: p.client || { id: p.clientId, name: 'Cliente Teste' },
        })),
        count: async () => localDatabase.size,
        update: async ({ where, data }: any) => {
          for (const [k, v] of localDatabase.entries()) {
            if (v.id === where.id) {
              const updated = { ...v, ...data };
              localDatabase.set(k, updated);
              return updated;
            }
          }
        },
      },
    };

    const service = new AsaasService(mockAsaasClient, mockPrisma);

    // 3. Executa a sincronização da carteira
    const syncRes = await service.syncAllWallet('org_sync_update_test');
    assert.strictEqual(syncRes.success, true);
    assert.strictEqual(syncRes.syncedPayments, 2);

    // 4. Confirma que o registro existente da PNEUTEK foi ATUALIZADO para DELETED no banco
    const pneutekInDb = localDatabase.get('pay_z9bl8vgevjcb5ty3');
    assert.ok(pneutekInDb, 'Registro da PNEUTEK deve existir no banco');
    assert.strictEqual(
      pneutekInDb.status,
      AsaasPaymentStatus.DELETED,
      'O registro existente deve sofrer update para DELETED'
    );

    // 5. Confirma que nos KPIs o resultado é exatamente R$ 5,00 em 1 cobrança
    const overview = await service.getFinancialOverview('org_sync_update_test', { period: 'current-month' });
    assert.strictEqual(overview.kpis.pending, 5, 'Apenas a cobrança ativa de R$ 5,00 deve constar em Aberto');
    assert.strictEqual(overview.kpis.pendingCount, 1);
    assert.strictEqual(overview.kpis.overdue, 0);
    assert.strictEqual(overview.kpis.statusCounts.cancelled, 1);
    assert.strictEqual(overview.kpis.nextDueDate?.value, 5);
  });

  // ---------------------------------------------------------------------------
  // 29. Datas de calendário sem deslocamento de fuso (Off-by-one prevention)
  // ---------------------------------------------------------------------------
  await t.test('29. Datas de vencimento e pagamento tratadas como datas de calendário puras (preservam dia 20/09)', async () => {
    // 1. Validar formatCalendarDate
    const formattedFromDateOnly = formatCalendarDate('2026-09-20');
    assert.strictEqual(
      formattedFromDateOnly,
      '20/09/2026',
      'Data no formato YYYY-MM-DD deve ser formatada como 20/09/2026'
    );

    const formattedFromIsoUtc = formatCalendarDate('2026-09-20T00:00:00.000Z');
    assert.strictEqual(
      formattedFromIsoUtc,
      '20/09/2026',
      'Data ISO UTC deve ser formatada preservando o dia 20/09/2026 sem recuar para 19/09'
    );

    // 2. Validar parseCalendarDate
    const parsed = parseCalendarDate('2026-09-20');
    assert.ok(parsed);
    assert.strictEqual(parsed.getUTCDate(), 20);
    assert.strictEqual(parsed.getUTCMonth(), 8); // 0-indexed: Setembro
    assert.strictEqual(parsed.getUTCFullYear(), 2026);
    // Fixado em 12:00 UTC para imunidade completa a fusos locais
    assert.strictEqual(parsed.getUTCHours(), 12);
  });

  // ---------------------------------------------------------------------------
  // 30. Consulta a financial-overview e resumo de cliente não alteram o banco (GET estritamente leitura)
  // ---------------------------------------------------------------------------
  await t.test('30. getFinancialOverview e getClientFinancialSummary não chamam prisma.asaasPayment.update mesmo com cobrança legada rawPayload.deleted: true', async () => {
    let updateCalled = false;

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({
          id: 'cli_legacy_test',
          organizationId: 'org_readonly_test',
          document: '27702502000194',
          name: 'Cliente Legado',
        }),
        count: async () => 1,
      },
      clientIntegration: {
        findFirst: async () => ({
          clientId: 'cli_legacy_test',
          provider: 'ASAAS',
          externalId: 'cus_legacy_001',
        }),
      },
      asaasPayment: {
        findMany: async () => [
          {
            id: 'db_legacy_deleted_payment',
            externalId: 'pay_legacy_001',
            value: 1594,
            netValue: 1590,
            status: AsaasPaymentStatus.PENDING, // Status ainda como PENDING no banco
            dueDate: new Date(2026, 8, 25),
            paymentDate: null,
            clientPaymentDate: null,
            updatedAt: new Date(),
            clientId: 'cli_legacy_test',
            rawPayload: { id: 'pay_legacy_001', status: 'PENDING', deleted: true }, // Asaas excluiu mas banco ainda não sincronizou
            billingType: 'PIX',
            invoiceUrl: null,
            bankSlipUrl: null,
            description: 'Cobrança legada',
            client: { id: 'cli_legacy_test', name: 'Cliente Legado' },
          },
        ],
        count: async () => 1,
        update: async () => {
          updateCalled = true;
          throw new Error('prisma.asaasPayment.update NÃO deve ser chamado em rotas GET de leitura!');
        },
      },
    };

    const service = new AsaasService(undefined as any, mockPrisma);

    // 1. Testa getFinancialOverview
    const overview = await service.getFinancialOverview('org_readonly_test', { period: 'all' });
    assert.strictEqual(updateCalled, false, 'update do prisma não pode ser invocado em getFinancialOverview');
    assert.strictEqual(overview.kpis.pending, 0, 'Cobrança com rawPayload.deleted: true não deve ser somada em aberto');
    assert.strictEqual(overview.kpis.pendingCount, 0);
    assert.strictEqual(overview.kpis.statusCounts.cancelled, 1, 'Cobrança tratada em memória como cancelada/deletada');
    assert.strictEqual(overview.payments.length, 1);
    assert.strictEqual(overview.payments[0].status, AsaasPaymentStatus.DELETED, 'effectiveStatus deve ser DELETED');

    // 2. Testa getClientFinancialSummary
    const summary = await service.getClientFinancialSummary('cli_legacy_test', 'org_readonly_test');
    assert.strictEqual(updateCalled, false, 'update do prisma não pode ser invocado em getClientFinancialSummary');
    assert.strictEqual(summary.kpis.pending, 0, 'Cobrança com rawPayload.deleted: true não deve ser somada em aberto no resumo');
    assert.strictEqual(summary.payments[0].status, AsaasPaymentStatus.DELETED);
  });
});




