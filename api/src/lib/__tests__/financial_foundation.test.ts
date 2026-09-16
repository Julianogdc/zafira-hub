import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { FinancialService } from '../../modules/financial/financial.service.js';
import { FinancialCategoryService } from '../../modules/financial/financial-category.service.js';
import { FinancialReconciliationService } from '../../modules/financial/financial-reconciliation.service.js';
import { AsaasClient } from '../../modules/integrations/asaas/asaas.client.js';
import { AsaasService } from '../../modules/integrations/asaas/asaas.service.js';
import { InterClient } from '../../modules/integrations/inter/inter.client.js';
import { InterService } from '../../modules/integrations/inter/inter.service.js';
import { requireRole } from '../../middleware/auth.js';

test('--- Etapa 5A — Fundação Financeira Unificada: Asaas + Banco Inter PJ ---', async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------------
  // 1. Clientes HTTP de Asaas e Inter contêm estritamente operações GET (Leitura)
  // ---------------------------------------------------------------------------
  await t.test('1. Clientes HTTP Asaas e Inter possuem estritamente operações GET e nenhuma de escrita', () => {
    const asaasProto = AsaasClient.prototype as any;
    const interProto = InterClient.prototype as any;

    const forbiddenWriteMethods = [
      'post',
      'put',
      'patch',
      'delete',
      'pixSend',
      'sendPix',
      'transfer',
      'createPixPayment',
      'createCharge',
      'createPayment',
      'charge',
      'pay',
    ];

    for (const method of forbiddenWriteMethods) {
      assert.strictEqual(
        asaasProto[method],
        undefined,
        `AsaasClient não deve possuir o método de escrita: ${method}`
      );
      assert.strictEqual(
        interProto[method],
        undefined,
        `InterClient não deve possuir o método de escrita: ${method}`
      );
    }

    assert.strictEqual(typeof asaasProto.getAccountBalance, 'function');
    assert.strictEqual(typeof asaasProto.getFinancialTransactions, 'function');
    assert.strictEqual(typeof interProto.getBalances, 'function');
    assert.strictEqual(typeof interProto.getStatement, 'function');
  });

  // ---------------------------------------------------------------------------
  // 2. Não exposição de credenciais, certificados PFX ou segredos em logs e retornos
  // ---------------------------------------------------------------------------
  await t.test('2. Banco Inter mascara ou omite credenciais e certificados no serviço e retornos', async () => {
    const mockPrisma: any = {
      financialAccount: {
        findFirst: async () => null,
        create: async () => ({ id: 'acc-inter-1', provider: 'INTER', currentBalance: 0 }),
      },
    };

    const service = new InterService(mockPrisma);
    delete process.env.INTER_CLIENT_ID;
    delete process.env.INTER_CLIENT_SECRET;
    delete process.env.INTER_CERTIFICATE_PFX_BASE64;

    const result = await service.syncAccountAndStatement('org-123');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'INTER_NOT_CONFIGURED');
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('INTER_CERTIFICATE_PFX_BASE64'));
    assert.ok(!serialized.includes('INTER_CLIENT_SECRET'));
  });

  // ---------------------------------------------------------------------------
  // 3. Isolamento multitenant estrito por organizationId no FinancialService
  // ---------------------------------------------------------------------------
  await t.test('3. FinancialService filtra estritamente por organizationId', async () => {
    let capturedOverviewOrg = '';
    let capturedTxOrg = '';

    const mockPrisma: any = {
      financialAccount: {
        findMany: async (args: any) => {
          capturedOverviewOrg = args.where.organizationId;
          return [
            { id: 'acc-1', provider: 'ASAAS', name: 'Conta Asaas', currentBalance: 1000, lastSyncedAt: null, isActive: true },
            { id: 'acc-2', provider: 'INTER', name: 'Banco Inter', currentBalance: 500, lastSyncedAt: null, isActive: true },
          ];
        },
      },
      financialTransaction: {
        findMany: async (args: any) => {
          capturedTxOrg = args.where.organizationId;
          return [];
        },
        count: async (args: any) => {
          assert.strictEqual(args.where.organizationId, 'org-tenant-alpha');
          return 0;
        },
      },
    };

    const service = new FinancialService(mockPrisma);
    const overview = await service.getAccountsOverview('org-tenant-alpha');

    assert.strictEqual(capturedOverviewOrg, 'org-tenant-alpha');
    assert.strictEqual(overview.consolidatedBalance, 1500);

    await service.getTransactions('org-tenant-alpha', { page: 1, limit: 10 });
    assert.strictEqual(capturedTxOrg, 'org-tenant-alpha');
  });

  // ---------------------------------------------------------------------------
  // 4. Categorização: Criação de categorias padrão idempotente
  // ---------------------------------------------------------------------------
  await t.test('4. FinancialCategoryService inicializa 10 categorias padrão sem duplicar', async () => {
    const created: any[] = [];
    const mockPrisma: any = {
      financialCategory: {
        findMany: async (args: any) => {
          return created.filter((c) => c.organizationId === args.where.organizationId);
        },
        create: async (args: any) => {
          const record = {
            id: `cat-${args.data.name}`,
            ...args.data,
          };
          created.push(record);
          return record;
        },
      },
    };

    const catService = new FinancialCategoryService(mockPrisma);
    const firstRun = await catService.ensureDefaultCategories('org-test');
    assert.strictEqual(firstRun.size, 10);
    assert.strictEqual(created.length, 10);

    const secondRun = await catService.ensureDefaultCategories('org-test');
    assert.strictEqual(secondRun.size, 10);
    assert.strictEqual(created.length, 10);
  });

  // ---------------------------------------------------------------------------
  // 5. Categorização por regras: Prioridade e identificação de contraparte
  // ---------------------------------------------------------------------------
  await t.test('5. Classifica transação por regra de contraparte ou descrição', async () => {
    const rules = [
      {
        id: 'rule-1',
        organizationId: 'org-test',
        categoryId: 'cat-software',
        matchField: 'DESCRIPTION',
        matchType: 'CONTAINS',
        matchValueNormalized: 'GOOGLE',
        priority: 10,
        isActive: true,
      },
      {
        id: 'rule-2',
        organizationId: 'org-test',
        categoryId: 'cat-servicos-prestados',
        matchField: 'COUNTERPARTY_NAME',
        matchType: 'CONTAINS',
        matchValueNormalized: 'PNEUTEK',
        priority: 20,
        isActive: true,
      },
    ];

    const mockPrisma: any = {
      financialCategory: {
        findMany: async () => [
          { id: 'cat-servicos-prestados', name: 'Serviços Prestados', type: 'INCOME' },
          { id: 'cat-software', name: 'Software & SaaS', type: 'EXPENSE' },
        ],
        create: async (args: any) => ({ id: args.data.name, ...args.data }),
      },
      financialCategoryRule: {
        findMany: async () => rules,
      },
    };

    const catService = new FinancialCategoryService(mockPrisma);

    const match1 = await catService.categorizeTransaction('org-test', {
      description: 'Pagamento recebido',
      counterpartyName: 'PNEUTEK COMERCIO DE PNEUS LTDA',
    });
    assert.strictEqual(match1.categoryId, 'cat-servicos-prestados');
    assert.strictEqual(match1.categorizationSource, 'AUTO_RULE');

    const match2 = await catService.categorizeTransaction('org-test', {
      description: 'Compra avulsa papelaria',
      counterpartyName: 'LIVRARIA XYZ',
    });
    assert.strictEqual(match2.categorizationSource, 'PENDING');
    assert.ok(match2.categoryId); // Recebe o id da categoria padrão 'Para revisar'
  });

  // ---------------------------------------------------------------------------
  // 6. Conciliação de Transferência Interna Asaas -> Inter: AUTO_MATCHED com identificador
  // ---------------------------------------------------------------------------
  await t.test('6. Concilia transferência Asaas -> Inter como AUTO_MATCHED quando há identificador', async () => {
    const transactionsInDb = [
      {
        id: 'tx-asaas-1',
        organizationId: 'org-test',
        accountId: 'acc-asaas',
        direction: 'DEBIT',
        amount: 2500.0,
        occurredAt: new Date('2026-09-10T10:00:00Z'),
        description: 'Transferência Pix para Banco Inter TED 987654',
        externalId: 'ext-tx-asaas-1',
        counterpartyName: 'ZAFIRA COMUNICACAO',
        counterpartyDocument: '12345678000199',
        sourceTransfer: null,
        account: { provider: 'ASAAS' },
      },
      {
        id: 'tx-inter-1',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        direction: 'CREDIT',
        amount: 2500.0,
        occurredAt: new Date('2026-09-10T10:05:00Z'),
        description: 'Pix Recebido ext-tx-asaas-1 Asaas Gestao Financeira',
        externalId: 'ext-tx-inter-1',
        counterpartyName: 'ASAAS GESTAO FINANCEIRA',
        counterpartyDocument: null,
        destTransfer: null,
        account: { provider: 'INTER' },
      },
    ];

    let createdTransfer: any = null;
    const updatedTxs: any[] = [];

    const mockPrisma: any = {
      financialAccount: {
        findMany: async () => [
          { id: 'acc-asaas', provider: 'ASAAS', isActive: true },
          { id: 'acc-inter', provider: 'INTER', isActive: true },
        ],
      },
      financialTransaction: {
        findMany: async (args: any) => {
          if (args.where.direction === 'DEBIT') {
            return [transactionsInDb[0]];
          }
          return [transactionsInDb[1]];
        },
        update: async (args: any) => {
          updatedTxs.push(args);
          return { id: args.where.id, ...args.data };
        },
      },
      financialTransfer: {
        create: async (args: any) => {
          createdTransfer = { id: 'transfer-123', ...args.data };
          return createdTransfer;
        },
      },
    };

    const reconciliation = new FinancialReconciliationService(mockPrisma);
    const res = await reconciliation.reconcileTransfers('org-test');

    assert.strictEqual(res.autoMatched, 1);
    assert.strictEqual(res.reviewCount, 0);
    assert.ok(createdTransfer);
    assert.strictEqual(createdTransfer.status, 'AUTO_MATCHED');
    assert.strictEqual(createdTransfer.amount, 2500.0);

    assert.strictEqual(updatedTxs.length, 2);
    for (const update of updatedTxs) {
      assert.strictEqual(update.data.kind, 'TRANSFER_INTERNAL');
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Conciliação de Transferência Interna: REVIEW sem identificador
  // ---------------------------------------------------------------------------
  await t.test('7. Transferência pareada sem identificador de documento é criada com status REVIEW', async () => {
    const transactionsInDb = [
      {
        id: 'tx-asaas-2',
        organizationId: 'org-test',
        accountId: 'acc-asaas',
        direction: 'DEBIT',
        amount: 800.0,
        occurredAt: new Date('2026-09-12T14:00:00Z'),
        description: 'Transferência Pix genérica',
        externalId: 'ext-asaas-2',
        counterpartyName: null,
        counterpartyDocument: null,
        sourceTransfer: null,
        account: { provider: 'ASAAS' },
      },
      {
        id: 'tx-inter-2',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        direction: 'CREDIT',
        amount: 800.0,
        occurredAt: new Date('2026-09-13T09:00:00Z'),
        description: 'Pix Recebido avulso',
        externalId: 'ext-inter-2',
        counterpartyName: null,
        counterpartyDocument: null,
        destTransfer: null,
        account: { provider: 'INTER' },
      },
    ];

    let createdTransfer: any = null;
    const mockPrisma: any = {
      financialAccount: {
        findMany: async () => [
          { id: 'acc-asaas', provider: 'ASAAS', isActive: true },
          { id: 'acc-inter', provider: 'INTER', isActive: true },
        ],
      },
      financialTransaction: {
        findMany: async (args: any) => {
          if (args.where.direction === 'DEBIT') {
            return [transactionsInDb[0]];
          }
          return [transactionsInDb[1]];
        },
        update: async () => ({}),
      },
      financialTransfer: {
        create: async (args: any) => {
          createdTransfer = { id: 'transfer-rev-1', ...args.data };
          return createdTransfer;
        },
      },
    };

    const reconciliation = new FinancialReconciliationService(mockPrisma);
    const res = await reconciliation.reconcileTransfers('org-test');

    assert.strictEqual(res.autoMatched, 0);
    assert.strictEqual(res.reviewCount, 1);
    assert.ok(createdTransfer);
    assert.strictEqual(createdTransfer.status, 'REVIEW');
    assert.strictEqual(createdTransfer.amount, 800.0);
  });

  // ---------------------------------------------------------------------------
  // 8. Isolamento de Transferências Internas: Não entra em Receita nem Despesa
  // ---------------------------------------------------------------------------
  await t.test('8. Transferências internas com kind TRANSFER_INTERNAL não afetam receitas e despesas operacionais', async () => {
    const transactions = [
      {
        id: 'tx-1',
        organizationId: 'org-test',
        direction: 'CREDIT',
        kind: 'OPERATIONAL',
        amount: 5000.0,
        occurredAt: new Date('2026-09-05'),
        categoryId: 'cat-1',
      },
      {
        id: 'tx-2',
        organizationId: 'org-test',
        direction: 'DEBIT',
        kind: 'OPERATIONAL',
        amount: 1200.0,
        occurredAt: new Date('2026-09-06'),
        categoryId: 'cat-2',
      },
      {
        id: 'tx-3',
        organizationId: 'org-test',
        direction: 'DEBIT',
        kind: 'TRANSFER_INTERNAL',
        amount: 3000.0,
        occurredAt: new Date('2026-09-07'),
        categoryId: 'cat-transfer',
      },
      {
        id: 'tx-4',
        organizationId: 'org-test',
        direction: 'CREDIT',
        kind: 'TRANSFER_INTERNAL',
        amount: 3000.0,
        occurredAt: new Date('2026-09-07'),
        categoryId: 'cat-transfer',
      },
    ];

    const mockPrisma: any = {
      financialAccount: {
        findMany: async () => [
          { id: 'acc-1', provider: 'ASAAS', currentBalance: 2000, lastSyncedAt: null, isActive: true },
          { id: 'acc-2', provider: 'INTER', currentBalance: 3000, lastSyncedAt: null, isActive: true },
        ],
      },
      financialTransaction: {
        findMany: async () => transactions,
      },
    };

    const service = new FinancialService(mockPrisma);
    const overview = await service.getAccountsOverview('org-test');

    assert.strictEqual(overview.periodSummary.operationalIncome, 5000.0);
    assert.strictEqual(overview.periodSummary.operationalExpense, 1200.0);
    assert.strictEqual(overview.periodSummary.internalTransfersAmount, 3000.0);
    assert.strictEqual(overview.consolidatedBalance, 5000.0);
  });

  // ---------------------------------------------------------------------------
  // 9. Não conciliar transferência por cliente: Asaas -> Inter é entre contas próprias
  // ---------------------------------------------------------------------------
  await t.test('9. Reconciliação não exige e não vincula clientId a transferência de contas próprias', async () => {
    const transactionsInDb = [
      {
        id: 'tx-asaas-3',
        organizationId: 'org-test',
        accountId: 'acc-asaas',
        direction: 'DEBIT',
        amount: 1500.0,
        occurredAt: new Date('2026-09-14T10:00:00Z'),
        description: 'Saque Asaas para Banco Inter',
        counterpartyName: 'BANCO INTER PJ',
        counterpartyDocument: null,
        sourceTransfer: null,
        account: { provider: 'ASAAS' },
      },
      {
        id: 'tx-inter-3',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        direction: 'CREDIT',
        amount: 1500.0,
        occurredAt: new Date('2026-09-14T10:02:00Z'),
        description: 'Pix recebido de Asaas',
        counterpartyName: 'ASAAS',
        counterpartyDocument: null,
        destTransfer: null,
        account: { provider: 'INTER' },
      },
    ];

    let createdTransferData: any = null;
    const mockPrisma: any = {
      financialAccount: {
        findMany: async () => [
          { id: 'acc-asaas', provider: 'ASAAS', isActive: true },
          { id: 'acc-inter', provider: 'INTER', isActive: true },
        ],
      },
      financialTransaction: {
        findMany: async (args: any) => {
          if (args.where.direction === 'DEBIT') return [transactionsInDb[0]];
          return [transactionsInDb[1]];
        },
        update: async () => ({}),
      },
      financialTransfer: {
        create: async (args: any) => {
          createdTransferData = args.data;
          return { id: 'tr-99', ...args.data };
        },
      },
    };

    const reconciliation = new FinancialReconciliationService(mockPrisma);
    await reconciliation.reconcileTransfers('org-test');

    assert.ok(createdTransferData);
    assert.strictEqual(createdTransferData.sourceAccountId, 'acc-asaas');
    assert.strictEqual(createdTransferData.destinationAccountId, 'acc-inter');
    assert.strictEqual(createdTransferData.clientId, undefined);
  });

  // ---------------------------------------------------------------------------
  // 10. Idempotência do Ledger Asaas
  // ---------------------------------------------------------------------------
  await t.test('10. syncLedger Asaas é idempotente por accountId + externalId', async () => {
    const upsertedTransactions: any[] = [];
    const mockPrisma: any = {
      financialAccount: {
        findFirst: async () => ({ id: 'acc-asaas-1', provider: 'ASAAS', isActive: true, name: 'Conta Asaas' }),
        findMany: async () => [
          { id: 'acc-asaas-1', provider: 'ASAAS', isActive: true, name: 'Conta Asaas' },
          { id: 'acc-inter-1', provider: 'INTER', isActive: true, name: 'Banco Inter' },
        ],
        update: async () => ({}),
      },
      financialCategory: {
        findMany: async () => [],
        create: async (args: any) => ({ id: 'cat-1', ...args.data }),
      },
      financialCategoryRule: {
        findMany: async () => [],
      },
      financialTransaction: {
        upsert: async (args: any) => {
          upsertedTransactions.push(args);
          return { id: 'tx-db-1', ...args.create };
        },
        findMany: async () => [],
        update: async () => ({}),
      },
      financialTransfer: {
        create: async () => ({ id: 'tr-1' }),
      },
    };

    const service = new AsaasService(mockPrisma);
    (service as any).client = {
      getAccountBalance: async () => ({ balance: 3500.0 }),
      getFinancialTransactions: async () => ({
        data: [
          {
            id: 'raw-tx-1',
            value: 200,
            balance: 3500,
            type: 'PAYMENT_RECEIVED',
            date: '2026-09-15',
            description: 'Recebimento de mensalidade',
          },
          {
            id: 'raw-tx-2',
            value: -50,
            balance: 3450,
            type: 'TRANSFER',
            date: '2026-09-15',
            description: 'Tarifa bancária',
          },
        ],
        hasMore: false,
        totalCount: 2,
      }),
    };

    const result = await service.syncLedger('org-test');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.syncedCount, 2);
    assert.strictEqual(upsertedTransactions.length, 2);

    assert.strictEqual(upsertedTransactions[0].where.accountId_externalId.externalId, 'raw-tx-1');
    assert.strictEqual(upsertedTransactions[1].where.accountId_externalId.externalId, 'raw-tx-2');
  });

  // ---------------------------------------------------------------------------
  // 11. Preservação estrita das cobranças Asaas (AsaasPayment PNEUTEK)
  // ---------------------------------------------------------------------------
  await t.test('11. Sincronização e consultas do extrato não alteram nem removem AsaasPayment', async () => {
    let paymentTouched = false;
    const mockPrisma: any = {
      financialAccount: {
        findFirst: async () => ({ id: 'acc-asaas-1', provider: 'ASAAS', isActive: true, name: 'Conta Asaas' }),
        findMany: async () => [
          { id: 'acc-asaas-1', provider: 'ASAAS', isActive: true, name: 'Conta Asaas' },
          { id: 'acc-inter-1', provider: 'INTER', isActive: true, name: 'Banco Inter' },
        ],
        update: async () => ({}),
      },
      financialCategory: {
        findMany: async () => [],
        create: async (args: any) => ({ id: 'cat-1', ...args.data }),
      },
      financialCategoryRule: {
        findMany: async () => [],
      },
      financialTransaction: {
        upsert: async () => ({ id: 'tx-1' }),
        findMany: async () => [],
        update: async () => ({}),
      },
      financialTransfer: {
        create: async () => ({ id: 'tr-1' }),
      },
      asaasPayment: {
        update: () => {
          paymentTouched = true;
          throw new Error('AsaasPayment nunca deve ser alterado pelo módulo de extrato/ledger');
        },
        delete: () => {
          paymentTouched = true;
          throw new Error('AsaasPayment nunca deve ser excluído pelo módulo de extrato/ledger');
        },
      },
    };

    const service = new AsaasService(mockPrisma);
    (service as any).client = {
      getAccountBalance: async () => ({ balance: 100 }),
      getFinancialTransactions: async () => ({ data: [], hasMore: false, totalCount: 0 }),
    };

    await service.syncLedger('org-test');
    assert.strictEqual(paymentTouched, false, 'AsaasPayment permaneceu intacto');
  });

  // ---------------------------------------------------------------------------
  // 12. Regras de RBAC: ADMIN e MANAGER permitidos; MEMBER bloqueado com 403
  // ---------------------------------------------------------------------------
  await t.test('12. Rotas financeiras retornam 403 para usuários com role MEMBER', async () => {
    const app = fastify();

    app.get(
      '/api/financial/overview-rbac-test',
      {
        preHandler: [
          async (req) => {
            (req as any).authContext = {
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
      url: '/api/financial/overview-rbac-test',
    });

    assert.strictEqual(res.statusCode, 403, 'Acesso de MEMBER deve retornar 403 Forbidden');
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error, 'forbidden');
  });

  // ---------------------------------------------------------------------------
  // 13. Endpoints GET são estritamente idempotentes e somente leitura (não mutam dados)
  // ---------------------------------------------------------------------------
  await t.test('13. GET /financial/accounts/overview e GET /financial/transactions não executam writes', async () => {
    let writeCalled = false;
    const mockPrisma: any = {
      financialAccount: {
        findMany: async () => [],
        create: () => { writeCalled = true; },
        update: () => { writeCalled = true; },
      },
      financialTransaction: {
        findMany: async () => [],
        count: async () => 0,
        create: () => { writeCalled = true; },
        update: () => { writeCalled = true; },
      },
    };

    const service = new FinancialService(mockPrisma);
    await service.getAccountsOverview('org-read-only');
    await service.getTransactions('org-read-only', { page: 1, limit: 10 });

    assert.strictEqual(writeCalled, false, 'Nenhuma mutação foi efetuada nos endpoints de leitura');
  });

  // ---------------------------------------------------------------------------
  // 14. Confirmação manual de transferência em status REVIEW
  // ---------------------------------------------------------------------------
  await t.test('14. Confirmação manual de transferência atualiza status para CONFIRMED', async () => {
    let updatedTransfer: any = null;

    const mockPrisma: any = {
      financialTransfer: {
        findUnique: async () => ({
          id: 'tr-review-123',
          organizationId: 'org-test',
          status: 'REVIEW',
          sourceTransactionId: 'tx-src-1',
          destinationTransactionId: 'tx-tgt-1',
        }),
        findFirst: async () => ({
          id: 'tr-review-123',
          organizationId: 'org-test',
          status: 'REVIEW',
          sourceTransactionId: 'tx-src-1',
          destinationTransactionId: 'tx-tgt-1',
        }),
        update: async (args: any) => {
          updatedTransfer = args.data;
          return { id: 'tr-review-123', ...args.data };
        },
      },
    };

    const reconciliation = new FinancialReconciliationService(mockPrisma);
    const confirmed = await reconciliation.confirmTransfer('org-test', 'tr-review-123');

    assert.strictEqual(confirmed.status, 'CONFIRMED');
    assert.strictEqual(updatedTransfer.status, 'CONFIRMED');
  });
});
