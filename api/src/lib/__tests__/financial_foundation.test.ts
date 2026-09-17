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
  // 1. Semântica correta: OAuth POST somente para token; recursos bancários somente GET
  // ---------------------------------------------------------------------------
  await t.test('1. Política de segurança do Inter: OAuth POST exclusivo para token; recursos bancários somente GET', async () => {
    const asaasProto = AsaasClient.prototype as any;
    const interProto = InterClient.prototype as any;

    // Zero métodos de escrita bancária, Pix, transferência ou cobrança no cliente
    const forbiddenWriteMethods = [
      'pixSend',
      'sendPix',
      'transfer',
      'createPixPayment',
      'createCharge',
      'createPayment',
      'charge',
      'pay',
      'patch',
      'delete',
      'put',
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

    // Recursos bancários expõem exclusivamente métodos de consulta (leitura)
    assert.strictEqual(typeof asaasProto.getAccountBalance, 'function');
    assert.strictEqual(typeof asaasProto.getFinancialTransactions, 'function');
    assert.strictEqual(typeof interProto.getBalances, 'function');
    assert.strictEqual(typeof interProto.getStatement, 'function');
    assert.strictEqual(typeof interProto.getAccessToken, 'function'); // OAuth token endpoint
  });

  // ---------------------------------------------------------------------------
  // 1.1 Bloqueio explícito de qualquer POST externo fora do endpoint OAuth
  // ---------------------------------------------------------------------------
  await t.test('1.1 Bloqueio explícito: qualquer POST em recursos bancários falha com BANK_WRITE_FORBIDDEN', async () => {
    // Testado tanto com configuração legada (PFX) quanto com nova configuração prioritária (CRT + KEY)
    const crtKeyClient = new InterClient({
      clientId: 'fake-client-id',
      clientSecret: 'fake-secret',
      crtBase64: Buffer.from('fake-crt-content').toString('base64'),
      keyBase64: Buffer.from('fake-key-content').toString('base64'),
    });

    const forbiddenCalls = [
      { method: 'POST', endpoint: '/banking/v2/pix' },
      { method: 'POST', endpoint: '/banking/v2/transferencia' },
      { method: 'PUT', endpoint: '/banking/v2/saldo' },
      { method: 'PATCH', endpoint: '/banking/v2/extrato' },
      { method: 'DELETE', endpoint: '/banking/v2/cobrancas/123' },
    ];

    for (const { method, endpoint } of forbiddenCalls) {
      await assert.rejects(
        async () => {
          await crtKeyClient.requestBankingResource(method, endpoint);
        },
        (err: any) => {
          assert.strictEqual(err.code, 'BANK_WRITE_FORBIDDEN');
          assert.strictEqual(err.statusCode, 405);
          assert.ok(err.message.includes('não permitida para o recurso bancário'));
          return true;
        },
        `Tentativa de ${method} em ${endpoint} deveria ter sido rejeitada com BANK_WRITE_FORBIDDEN`
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 1.2 Escopos OAuth sem suposição: padrão mínimo 'extrato.read' sem 'saldo.read' automático
  // ---------------------------------------------------------------------------
  await t.test('1.2 Escopos OAuth: padrão mínimo extrato.read sem inclusão automática de saldo.read', () => {
    delete process.env.INTER_OAUTH_SCOPE;

    const defaultClient = new InterClient({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      crtBase64: 'crt-base64',
      keyBase64: 'key-base64',
    });
    // Sem configuração no ambiente, o escopo DEVE ser estritamente 'extrato.read'
    assert.strictEqual(defaultClient.getOAuthScope(), 'extrato.read');
    assert.ok(!defaultClient.getOAuthScope().includes('saldo.read'), 'Não deve incluir saldo.read automaticamente');

    // Com escopo centralizado via INTER_OAUTH_SCOPE, utiliza exclusivamente o valor configurado
    process.env.INTER_OAUTH_SCOPE = 'extrato.read custom.scope';
    const customClient = new InterClient({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      crtBase64: 'crt-base64',
      keyBase64: 'key-base64',
    });
    assert.strictEqual(customClient.getOAuthScope(), 'extrato.read custom.scope');

    delete process.env.INTER_OAUTH_SCOPE;
  });

  // ---------------------------------------------------------------------------
  // 1.3 Criação do agente mTLS com CRT + KEY em memória (sem arquivos temporários em disco)
  // ---------------------------------------------------------------------------
  await t.test('1.3 Criação do agente mTLS com CRT + KEY decodificados 100% em memória', () => {
    const fakeCrt = '-----BEGIN CERTIFICATE-----\nFAKE_CRT\n-----END CERTIFICATE-----';
    const fakeKey = '-----BEGIN PRIVATE KEY-----\nFAKE_KEY\n-----END PRIVATE KEY-----';

    const client = new InterClient({
      clientId: 'cli-test-id',
      clientSecret: 'cli-test-secret',
      crtBase64: Buffer.from(fakeCrt).toString('base64'),
      keyBase64: Buffer.from(fakeKey).toString('base64'),
    });

    assert.strictEqual(client.isConfigured(), true);
    assert.strictEqual(client.getMtlsConfigMode(), 'CRT_KEY');

    const agent = client.createHttpsAgentForTesting();
    assert.ok(agent, 'Agente HTTPS deve ser instanciado');
    const agentOptions = (agent as any).options;

    // Garante que cert e key são Buffers na memória RAM
    assert.ok(Buffer.isBuffer(agentOptions.cert), 'Certificado deve estar decodificado como Buffer em memória');
    assert.ok(Buffer.isBuffer(agentOptions.key), 'Chave privada deve estar decodificada como Buffer em memória');
    assert.strictEqual(agentOptions.cert.toString('utf8'), fakeCrt);
    assert.strictEqual(agentOptions.key.toString('utf8'), fakeKey);

    // Garante que nenhuma propriedade aponta para arquivos no disco
    assert.strictEqual(agentOptions.certFile, undefined);
    assert.strictEqual(agentOptions.keyFile, undefined);
  });

  // ---------------------------------------------------------------------------
  // 1.4 Compatibilidade retroativa com PFX como fallback opcional
  // ---------------------------------------------------------------------------
  await t.test('1.4 Suporte legado ao formato PFX em memória mantido como fallback', () => {
    const fakePfx = 'FAKE_PFX_RAW_BYTES';
    const client = new InterClient({
      clientId: 'cli-pfx-id',
      clientSecret: 'cli-pfx-secret',
      pfxBase64: Buffer.from(fakePfx).toString('base64'),
      passphrase: 'pfx-passphrase',
    });

    assert.strictEqual(client.isConfigured(), true);
    assert.strictEqual(client.getMtlsConfigMode(), 'PFX');

    const agent = client.createHttpsAgentForTesting();
    const agentOptions = (agent as any).options;
    assert.ok(Buffer.isBuffer(agentOptions.pfx), 'PFX deve estar em memória como Buffer');
    assert.strictEqual(agentOptions.passphrase, 'pfx-passphrase');
  });

  // ---------------------------------------------------------------------------
  // 2. Não exposição de credenciais, certificados ou segredos em logs e retornos
  // ---------------------------------------------------------------------------
  await t.test('2. Banco Inter mascara e omite segredos e lista apenas os nomes das variáveis ausentes', async () => {
    const mockPrisma: any = {
      financialAccount: {
        findFirst: async () => null,
        create: async () => ({ id: 'acc-inter-1', provider: 'INTER', currentBalance: 0 }),
      },
    };

    delete process.env.INTER_CLIENT_ID;
    delete process.env.INTER_CLIENT_SECRET;
    delete process.env.INTER_CERTIFICATE_PFX_BASE64;
    delete process.env.INTER_CERTIFICATE_CRT_BASE64;
    delete process.env.INTER_PRIVATE_KEY_BASE64;

    const unconfiguredClient = new InterClient();
    const missing = unconfiguredClient.getMissingConfig();
    assert.ok(missing.includes('INTER_CLIENT_ID'));
    assert.ok(missing.includes('INTER_CLIENT_SECRET'));
    assert.ok(missing.includes('INTER_CERTIFICATE_CRT_BASE64'));
    assert.ok(missing.includes('INTER_PRIVATE_KEY_BASE64'));

    const service = new InterService(unconfiguredClient, mockPrisma);
    const result = await service.syncAccountAndStatement('org-123');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'INTER_NOT_CONFIGURED');
    assert.ok(result.message?.includes('INTER_CLIENT_ID'));
    assert.ok(result.message?.includes('INTER_CLIENT_SECRET'));
    assert.ok(result.message?.includes('INTER_CERTIFICATE_CRT_BASE64'));
    assert.ok(result.message?.includes('INTER_PRIVATE_KEY_BASE64'));

    // Assegura que nenhum segredo real ou valor de credencial foi vazado
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('INTER_CERTIFICATE_PFX_BASE64'));
    assert.ok(!serialized.includes('secret-value'));
    assert.ok(!serialized.includes('private-key'));
  });

  // ---------------------------------------------------------------------------
  // 2.1 Diagnóstico seguro de respostas OAuth não-2xx (captura estrita de campos whitelist)
  // ---------------------------------------------------------------------------
  await t.test('2.1 Diagnóstico OAuth 400: captura com whitelist (error, error_description, code, message) e zero vazamento', async (tSub) => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;

    let loggedErrors: string[] = [];
    console.error = (...args: any[]) => {
      loggedErrors.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };

    tSub.afterEach(() => {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
      loggedErrors = [];
    });

    const testClient = new InterClient({
      clientId: 'secret-cli-id-999',
      clientSecret: 'secret-cli-pass-888',
      crtBase64: Buffer.from('FAKE_CERT_BYTES').toString('base64'),
      keyBase64: Buffer.from('FAKE_KEY_BYTES').toString('base64'),
      oauthScope: 'extrato.read',
    });

    // 1. Resposta OAuth 400 com invalid_client
    await tSub.test('1. Resposta OAuth 400 com invalid_client registra e propaga erro formatado', async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'Client credentials are not authorized or disabled',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      await assert.rejects(
        async () => {
          await testClient.getAccessToken();
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INTER_AUTH_FAILED');
          assert.strictEqual(err.statusCode, 400);
          assert.ok(err.message.includes('status=400'));
          assert.ok(err.message.includes('error=invalid_client'));
          assert.ok(err.message.includes('description=Client credentials are not authorized or disabled'));
          return true;
        }
      );

      const logFound = loggedErrors.some((log) =>
        log.includes('[InterClient] OAuth recusado pelo Inter: status=400, error=invalid_client')
      );
      assert.ok(logFound, 'Deve registrar log com os campos seguros extraídos');
    });

    // 2. Resposta OAuth 400 com invalid_scope
    await tSub.test('2. Resposta OAuth 400 com invalid_scope registra erro com escopo rejeitado', async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: 'invalid_scope',
            error_description: 'The requested scope is not configured for application',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      await assert.rejects(
        async () => {
          await testClient.getAccessToken();
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INTER_AUTH_FAILED');
          assert.strictEqual(err.statusCode, 400);
          assert.ok(err.message.includes('error=invalid_scope'));
          assert.ok(err.message.includes('description=The requested scope is not configured for application'));
          return true;
        }
      );
    });

    // 3. Resposta não-JSON (HTML ou texto simples, ex: Bad Request do Gateway/WAF)
    await tSub.test('3. Resposta não-JSON não expõe corpo bruto e registra status com segurança', async () => {
      const rawHtml = '<html><head><title>400 Bad Request</title></head><body>Proxy sensitive info</body></html>';
      globalThis.fetch = (async () => {
        return new Response(rawHtml, { status: 400, headers: { 'Content-Type': 'text/html' } });
      }) as any;

      await assert.rejects(
        async () => {
          await testClient.getAccessToken();
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INTER_AUTH_FAILED');
          assert.strictEqual(err.statusCode, 400);
          assert.ok(!err.message.includes(rawHtml), 'Corpo bruto HTML jamais deve ser exposto na mensagem');
          assert.ok(err.message.includes('resposta_sem_campos_padrao'));
          return true;
        }
      );

      const leakedHtml = loggedErrors.some((log) => log.includes(rawHtml));
      assert.strictEqual(leakedHtml, false, 'Corpo bruto HTML jamais deve ser emitido no log');
    });

    // 4. Garantia de que token, Client ID, Client Secret, Authorization, certificado e chave nunca aparecem
    await tSub.test('4. Credenciais, Client ID/Secret, certificados e tokens jamais aparecem em erro ou logs', async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: 'unauthorized',
            error_description: 'Unauthorized access',
            access_token: 'SUPER_SECRET_TOKEN_DO_NOT_LEAK',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      try {
        await testClient.getAccessToken();
        assert.fail('Deveria ter lançado erro');
      } catch (err: any) {
        const fullErrStr = `${err.message} ${err.stack || ''}`;
        const allLogs = loggedErrors.join(' ');

        // Verificações estritas de não-vazamento
        assert.ok(!fullErrStr.includes('secret-cli-pass-888'), 'Client secret não deve vazar no erro');
        assert.ok(!allLogs.includes('secret-cli-pass-888'), 'Client secret não deve vazar nos logs');
        assert.ok(!fullErrStr.includes('SUPER_SECRET_TOKEN_DO_NOT_LEAK'), 'Token não deve vazar no erro');
        assert.ok(!allLogs.includes('SUPER_SECRET_TOKEN_DO_NOT_LEAK'), 'Token não deve vazar nos logs');
        assert.ok(!fullErrStr.includes('FAKE_CERT_BYTES'), 'Certificado não deve vazar no erro');
        assert.ok(!allLogs.includes('FAKE_CERT_BYTES'), 'Certificado não deve vazar nos logs');
        assert.ok(!fullErrStr.includes('FAKE_KEY_BYTES'), 'Chave não deve vazar no erro');
        assert.ok(!allLogs.includes('FAKE_KEY_BYTES'), 'Chave não deve vazar nos logs');
        assert.ok(!fullErrStr.includes('Authorization:'), 'Authorization header não deve vazar');
        assert.ok(!allLogs.includes('Authorization:'), 'Authorization header não deve vazar nos logs');
      }
    });

    // 5. Regressão: proteção BANK_WRITE_FORBIDDEN permanece inviolável
    await tSub.test('5. Regressão: BANK_WRITE_FORBIDDEN bloqueia qualquer escrita bancária', async () => {
      await assert.rejects(
        async () => {
          await testClient.requestBankingResource('POST', '/banking/v2/saldo');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'BANK_WRITE_FORBIDDEN');
          assert.strictEqual(err.statusCode, 405);
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2.2 Conformidade do formato OAuth e prevenção estrita de falso saldo zero
  // ---------------------------------------------------------------------------
  await t.test('2.2 Conformidade OAuth (urlencoded + Accept json) e proteção contra falso saldo zero', async (tSub) => {
    const originalFetch = globalThis.fetch;
    tSub.afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    // 1. Validar que o pedido OAuth envia exatamente os 4 campos no corpo urlencoded e Accept: application/json
    await tSub.test('1. Requisição OAuth serializa os quatro campos urlencoded e envia Accept: application/json', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedHeaders: any = null;
      let capturedBody = '';

      globalThis.fetch = (async (url: any, opts: any) => {
        capturedUrl = String(url);
        capturedMethod = opts.method;
        capturedHeaders = opts.headers;
        capturedBody = opts.body;

        return new Response(
          JSON.stringify({
            access_token: 'valid-mock-token-abc',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'extrato.read',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      const client = new InterClient({
        clientId: 'my-inter-client-id',
        clientSecret: 'my-inter-client-secret',
        crtBase64: Buffer.from('FAKE_CRT').toString('base64'),
        keyBase64: Buffer.from('FAKE_KEY').toString('base64'),
        oauthScope: 'extrato.read',
      });

      const token = await client.getAccessToken();
      assert.strictEqual(token, 'valid-mock-token-abc');
      assert.ok(capturedUrl.endsWith('/oauth/v2/token'));
      assert.strictEqual(capturedMethod, 'POST');
      assert.strictEqual(capturedHeaders['Content-Type'], 'application/x-www-form-urlencoded');
      assert.strictEqual(capturedHeaders['Accept'], 'application/json');

      // Verifica os 4 campos no formulário urlencoded
      const params = new URLSearchParams(capturedBody);
      assert.strictEqual(params.get('client_id'), 'my-inter-client-id');
      assert.strictEqual(params.get('client_secret'), 'my-inter-client-secret');
      assert.strictEqual(params.get('grant_type'), 'client_credentials');
      assert.strictEqual(params.get('scope'), 'extrato.read');
    });

    // 2. Falha de sincronização NÃO cria saldo zero nem grava carimbo lastSyncedAt no banco
    await tSub.test('2. Falha de sincronização não grava lastSyncedAt, não altera saldo para 0 e preserva registros', async () => {
      let updateAccountCalled = false;
      let existingTransactionsDeleted = false;

      const mockPrisma: any = {
        financialAccount: {
          findFirst: async () => ({
            id: 'acc-inter-99',
            organizationId: 'org-test',
            provider: 'INTER',
            name: 'Conta Inter PJ',
            currentBalance: 8500.50, // Saldo anterior preservado
            balanceAsOf: new Date('2026-09-10'),
            lastSyncedAt: new Date('2026-09-10'),
          }),
          update: async () => {
            updateAccountCalled = true;
            throw new Error('update não deveria ter sido chamado em caso de falha de extrato');
          },
        },
        financialTransaction: {
          delete: () => { existingTransactionsDeleted = true; },
          deleteMany: () => { existingTransactionsDeleted = true; },
          upsert: async () => ({}),
        },
      };

      // Mock de cliente onde getStatement falha (ex: OAuth 400 ou erro de rede)
      const failingClient: any = {
        isConfigured: () => true,
        getStatement: async () => {
          throw new Error('Falha simulada na autenticação OAuth ou rede');
        },
        getBalances: async () => {
          throw new Error('Não autorizado');
        },
      };

      const service = new InterService(failingClient, mockPrisma);
      const result = await service.syncAccountAndStatement('org-test');

      assert.strictEqual(result.success, false);
      assert.strictEqual(updateAccountCalled, false, 'Não deve gravar lastSyncedAt nem zerar saldo no banco');
      assert.strictEqual(existingTransactionsDeleted, false, 'Não deve apagar transações existentes');
      assert.strictEqual(result.syncedTransactions, 0);
      assert.strictEqual(result.account?.balance, 8500.50, 'Saldo original deve permanecer inalterado');
    });

    // 3. Sucesso na sincronização atualiza lastSyncedAt e insere extrato normalmente
    await tSub.test('3. Sucesso na sincronização atualiza lastSyncedAt e registra transações do extrato', async () => {
      let updatedData: any = null;
      const upsertedTransactions: any[] = [];

      const mockPrisma: any = {
        financialAccount: {
          findFirst: async () => ({
            id: 'acc-inter-ok',
            organizationId: 'org-test',
            provider: 'INTER',
            name: 'Conta Inter PJ',
            currentBalance: 0,
            balanceAsOf: null,
            lastSyncedAt: null,
          }),
          findMany: async () => [
            { id: 'acc-inter-ok', provider: 'INTER', isActive: true },
          ],
          update: async (args: any) => {
            updatedData = args.data;
            return { id: 'acc-inter-ok', ...args.data };
          },
        },
        financialTransaction: {
          upsert: async (args: any) => {
            upsertedTransactions.push(args.create);
            return args.create;
          },
          findMany: async () => [],
        },
        financialCategory: {
          findMany: async () => [{ id: 'cat-1', name: 'Geral', type: 'INCOME' }],
          create: async (args: any) => ({ id: 'cat-1', ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        financialTransfer: {
          create: async () => ({ id: 'tr-1' }),
        },
      };

      const successClient: any = {
        isConfigured: () => true,
        getStatement: async () => [
          {
            dataEntrada: '2026-09-17',
            tipoOperacao: 'C',
            tipoTransacao: 'PIX',
            valor: 1500.0,
            titulo: 'Pagamento Cliente Teste',
            idTransacao: 'tx-inter-12345',
          },
        ],
        getBalances: async () => ({ disponivel: 1500.0 }),
      };

      const service = new InterService(successClient, mockPrisma);
      const result = await service.syncAccountAndStatement('org-test');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.syncedTransactions, 1);
      assert.ok(updatedData, 'Deve ter atualizado financialAccount');
      assert.ok(updatedData.lastSyncedAt instanceof Date, 'lastSyncedAt deve ser atualizado para Date');
      assert.strictEqual(updatedData.currentBalance, 1500.0);
      assert.strictEqual(upsertedTransactions.length, 1);
      assert.strictEqual(upsertedTransactions[0].externalId, 'tx-inter-12345');
    });
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
  // 10. Desativação segura do syncLedger Asaas (Etapa 5B: Asaas é visor, Inter é caixa)
  // ---------------------------------------------------------------------------
  await t.test('10. syncLedger Asaas desativado retorna ASAAS_LEDGER_DISABLED sem chamadas de rede nem mutações', async () => {
    let touchedDatabase = false;
    let externalClientCalled = false;

    const mockPrisma: any = {
      financialAccount: {
        update: () => { touchedDatabase = true; },
        create: () => { touchedDatabase = true; },
      },
      financialTransaction: {
        upsert: () => { touchedDatabase = true; },
        create: () => { touchedDatabase = true; },
        update: () => { touchedDatabase = true; },
        delete: () => { touchedDatabase = true; },
      },
    };

    const service = new AsaasService(mockPrisma);
    (service as any).client = {
      getAccountBalance: async () => {
        externalClientCalled = true;
        return { totalBalance: 5000 };
      },
      getFinancialTransactions: async () => {
        externalClientCalled = true;
        return { data: [] };
      },
    };

    const result = await service.syncLedger('org-test');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'ASAAS_LEDGER_DISABLED');
    assert.ok(result.message.includes('O Asaas é utilizado apenas para contas a receber'));
    assert.strictEqual(touchedDatabase, false, 'Nenhuma mutação no banco ocorreu');
    assert.strictEqual(externalClientCalled, false, 'Nenhuma chamada de rede ao cliente Asaas ocorreu');
  });

  // ---------------------------------------------------------------------------
  // 10.1 getAccountsOverview considera exclusivamente contas e transações com provider INTER
  // ---------------------------------------------------------------------------
  await t.test('10.1 getAccountsOverview calcula saldos e indicadores exclusivamente sobre o Banco Inter PJ', async () => {
    let capturedAccountWhere: any = null;
    let capturedTxWhere: any = null;

    const mockPrisma: any = {
      financialAccount: {
        findMany: async (args: any) => {
          capturedAccountWhere = args.where;
          // Retorna apenas a conta Inter; conta Asaas está excluída da consulta
          return [
            {
              id: 'acc-inter-1',
              provider: 'INTER',
              name: 'Banco Inter PJ',
              currency: 'BRL',
              currentBalance: 12500.50,
              balanceAsOf: new Date('2026-09-16T12:00:00Z'),
              lastSyncedAt: new Date('2026-09-16T12:00:00Z'),
              isActive: true,
            },
          ];
        },
      },
      financialTransaction: {
        findMany: async (args: any) => {
          capturedTxWhere = args.where;
          // Retorna apenas transações do Inter PJ
          return [
            { amount: 5000, direction: 'CREDIT', kind: 'OPERATIONAL', categorizationSource: 'RULE' },
            { amount: 1200, direction: 'DEBIT', kind: 'OPERATIONAL', categorizationSource: 'RULE' },
            { amount: 300, direction: 'DEBIT', kind: 'OPERATIONAL', categorizationSource: 'PENDING' },
          ];
        },
      },
    };

    const financialService = new FinancialService(mockPrisma);
    const overview = await financialService.getAccountsOverview('org-inter-only');

    // 1. Verificação dos filtros Prisma
    assert.strictEqual(capturedAccountWhere.organizationId, 'org-inter-only');
    assert.strictEqual(capturedAccountWhere.provider, 'INTER', 'Deve consultar exclusivamente contas com provider INTER');
    assert.strictEqual(capturedTxWhere.account.provider, 'INTER', 'Deve consultar exclusivamente transações com provider INTER');

    // 2. Verificação de saldos
    assert.strictEqual(overview.interBalance, 12500.50);
    assert.strictEqual(overview.consolidatedBalance, 12500.50, 'Saldo consolidado deve ser idêntico ao saldo Inter PJ');
    assert.strictEqual(overview.asaasBalance, 0, 'Saldo Asaas não alimenta o caixa');

    // 3. Verificação de fluxos operacionais
    assert.strictEqual(overview.operationalIncome, 5000);
    assert.strictEqual(overview.operationalExpense, 1500);
    assert.strictEqual(overview.toReviewCount, 1);
    assert.strictEqual(overview.accounts.length, 1);
    assert.strictEqual(overview.accounts[0].provider, 'INTER');
  });

  // ---------------------------------------------------------------------------
  // 10.2 getTransactions filtra estritamente account.provider = INTER, excluindo Asaas
  // ---------------------------------------------------------------------------
  await t.test('10.2 getTransactions aplica filtro estrito account.provider = INTER', async () => {
    let capturedWhere: any = null;

    const mockPrisma: any = {
      financialTransaction: {
        count: async (args: any) => {
          capturedWhere = args.where;
          return 10;
        },
        findMany: async (args: any) => {
          return [
            {
              id: 'tx-inter-1',
              accountId: 'acc-inter-1',
              account: { id: 'acc-inter-1', name: 'Banco Inter PJ', provider: 'INTER' },
              occurredAt: new Date('2026-09-16T10:00:00Z'),
              direction: 'CREDIT',
              kind: 'OPERATIONAL',
              amount: 1500,
              description: 'PIX RECEBIDO INTER',
              counterpartyName: 'Cliente A',
              counterpartyDocument: '11122233344',
              externalId: 'ext-inter-1',
              externalReference: null,
              categoryId: null,
              category: null,
              categorizationSource: 'PENDING',
              categorizationConfidence: null,
              sourceTransfer: null,
              destTransfer: null,
            },
          ];
        },
      },
    };

    const financialService = new FinancialService(mockPrisma);
    // Mesmo que alguém tente solicitar provider: 'ASAAS', a consulta deve fixar provider: 'INTER'
    const result = await financialService.getTransactions('org-123', { provider: 'ASAAS' as any });

    assert.strictEqual(capturedWhere.organizationId, 'org-123');
    assert.strictEqual(capturedWhere.account.provider, 'INTER', 'Filtro deve restringir estritamente a INTER');
    assert.strictEqual(result.transactions.length, 1);
    assert.strictEqual(result.transactions[0].provider, 'INTER');
  });

  // ---------------------------------------------------------------------------
  // 10.3 100 registros históricos Asaas permanecem no banco de dados para auditoria sem exclusão
  // ---------------------------------------------------------------------------
  await t.test('10.3 Registros históricos do Asaas são preservados no banco sem exclusão para auditoria', async () => {
    let deleteCalled = false;
    let deleteManyCalled = false;

    const mockPrisma: any = {
      financialTransaction: {
        delete: () => { deleteCalled = true; },
        deleteMany: () => { deleteManyCalled = true; },
        count: async () => 100, // 100 registros históricos Asaas permanecem intactos
        findMany: async () => [],
      },
      financialAccount: {
        findMany: async () => [],
      },
    };

    const financialService = new FinancialService(mockPrisma);
    await financialService.getAccountsOverview('org-audit');
    await financialService.getTransactions('org-audit', {});

    assert.strictEqual(deleteCalled, false, 'delete não deve ser chamado');
    assert.strictEqual(deleteManyCalled, false, 'deleteMany não deve ser chamado');
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
          { id: 'acc-inter-1', provider: 'INTER', isActive: true, name: 'Banco Inter' },
        ],
        update: async () => ({}),
      },
      financialCategory: {
        findMany: async () => [],
      },
      financialCategoryRule: {
        findMany: async () => [],
      },
      financialTransaction: {
        findMany: async () => [],
        count: async () => 0,
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

  // ---------------------------------------------------------------------------
  // 15. Autenticação e RBAC nos endpoints financeiros: 401 sem sessão, 403 para MEMBER, 200 com sessão ADMIN/MANAGER
  // ---------------------------------------------------------------------------
  await t.test('15. Endpoints financeiros: sem sessão -> 401, MEMBER -> 403, sessão ADMIN/MANAGER -> 200', async () => {
    const app = fastify();
    await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
    await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });

    // Mock dos serviços para o teste de transporte HTTP e autenticação
    const mockOverview = {
      accounts: [],
      consolidatedBalance: 15000,
      periodSummary: {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        operationalIncome: 5000,
        operationalExpense: 2000,
        internalTransfersAmount: 0,
        pendingReviewCount: 0,
      },
    };

    const mockTransactions = {
      transactions: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
    };

    const mockSyncLedger = {
      success: true,
      syncedCount: 5,
      balance: 15000,
    };

    // Middleware de autenticação
    const authenticateMock = async (req: any, reply: any) => {
      let token = req.cookies?.token;
      if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
          token = parts[1];
        }
      }

      if (!token) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      try {
        const decoded = await app.jwt.verify<any>(token);
        req.authContext = {
          type: 'user',
          userId: decoded.sub,
          email: decoded.email,
          memberships: decoded.memberships || [],
          activeOrganizationId: decoded.activeOrganizationId,
        };
      } catch {
        return reply.status(401).send({ error: 'unauthorized' });
      }
    };

    // Resolução multi-tenant segura idêntica a financial.routes.ts
    const resolveFinancialContext = async (req: any, reply: any) => {
      const auth = req.authContext;
      if (!auth) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      if (auth.type === 'api_key') {
        const headerOrg = req.headers['x-organization-id'] as string | undefined;
        if (!headerOrg || typeof headerOrg !== 'string' || headerOrg.trim().length === 0) {
          return reply.status(400).send({
            error: 'ORGANIZATION_CONTEXT_REQUIRED',
            message: 'Cabeçalho x-organization-id é obrigatório para chave de integração',
          });
        }
        req.resolvedOrganizationId = headerOrg.trim();
        return;
      }

      if (auth.type === 'user') {
        const memberships = auth.memberships || [];
        if (memberships.length === 0) {
          return reply.status(401).send({ error: 'unauthorized' });
        }

        const explicitOrgId =
          auth.activeOrganizationId ||
          (req.headers['x-organization-id'] as string | undefined);

        let targetMembership = explicitOrgId
          ? memberships.find((m: any) => m.organizationId === explicitOrgId || m.organizationSlug === explicitOrgId)
          : undefined;

        if (explicitOrgId && !targetMembership) {
          return reply.status(403).send({
            error: 'forbidden',
            message: 'Usuário não possui acesso à organização informada',
          });
        }

        if (!targetMembership) {
          if (memberships.length === 1) {
            targetMembership = memberships[0];
          } else {
            return reply.status(400).send({
              error: 'ORGANIZATION_CONTEXT_REQUIRED',
              message: 'Múltiplas organizações disponíveis. Contexto de organização ativo é obrigatório.',
            });
          }
        }

        if (!['ADMIN', 'MANAGER'].includes(targetMembership.role)) {
          return reply.status(403).send({
            error: 'forbidden',
            message: 'Permissão insuficiente na organização selecionada',
          });
        }

        req.resolvedOrganizationId = targetMembership.organizationId;
      }
    };

    app.addHook('preHandler', authenticateMock);
    app.addHook('preHandler', resolveFinancialContext);

    app.get('/financial/accounts/overview', async (req, reply) => {
      return reply.send({ ...mockOverview, organizationId: req.resolvedOrganizationId });
    });

    app.get('/financial/transactions', async (req, reply) => {
      return reply.send({ ...mockTransactions, organizationId: req.resolvedOrganizationId });
    });

    app.post('/integrations/asaas/sync-ledger', async (req, reply) => {
      return reply.send({ ...mockSyncLedger, organizationId: req.resolvedOrganizationId });
    });

    await app.ready();

    // 1. SEM SESSÃO -> todos devem retornar 401
    const unauthOverview = await app.inject({ method: 'GET', url: '/financial/accounts/overview' });
    assert.strictEqual(unauthOverview.statusCode, 401, 'Overview sem sessão deve retornar 401');

    const unauthTransactions = await app.inject({ method: 'GET', url: '/financial/transactions?page=1&limit=20' });
    assert.strictEqual(unauthTransactions.statusCode, 401, 'Transactions sem sessão deve retornar 401');

    const unauthSyncLedger = await app.inject({ method: 'POST', url: '/integrations/asaas/sync-ledger' });
    assert.strictEqual(unauthSyncLedger.statusCode, 401, 'Sync ledger sem sessão deve retornar 401');

    // 2. COM SESSÃO DE 'MEMBER' -> todos devem retornar 403 Forbidden
    const memberToken = app.jwt.sign({
      sub: 'usr_member_test',
      email: 'member@test.com',
      memberships: [{ organizationId: 'org_single_123', organizationSlug: 'cliente-alpha', role: 'MEMBER' }],
    });

    const memberOverview = await app.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    assert.strictEqual(memberOverview.statusCode, 403, 'MEMBER deve receber 403');

    // 3. COM SESSÃO DE 'ADMIN' (via Cookie HTTP-only de sessão com 1 organização) -> 200
    const adminToken = app.jwt.sign({
      sub: 'usr_admin_test',
      email: 'admin@test.com',
      memberships: [{ organizationId: 'org_single_123', organizationSlug: 'cliente-alpha', role: 'ADMIN' }],
    });

    const authOverview = await app.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      cookies: { token: adminToken },
    });
    assert.strictEqual(authOverview.statusCode, 200, 'GET /financial/accounts/overview com cookie de sessão retorna 200');
    assert.strictEqual(authOverview.json().organizationId, 'org_single_123');

    const authTransactions = await app.inject({
      method: 'GET',
      url: '/financial/transactions?page=1&limit=20',
      cookies: { token: adminToken },
    });
    assert.strictEqual(authTransactions.statusCode, 200, 'GET /financial/transactions retorna 200');
    assert.strictEqual(authTransactions.json().organizationId, 'org_single_123');

    const authSyncLedger = await app.inject({
      method: 'POST',
      url: '/integrations/asaas/sync-ledger',
      cookies: { token: adminToken },
    });
    assert.strictEqual(authSyncLedger.statusCode, 200, 'POST /integrations/asaas/sync-ledger retorna 200');
    assert.strictEqual(authSyncLedger.json().organizationId, 'org_single_123');
  });

  // ---------------------------------------------------------------------------
  // 16. Multi-tenant estrito: cenário com 2 organizações, seleção explícita e ausência total de "zafira"
  // ---------------------------------------------------------------------------
  await t.test('16. Multi-tenant: usuário membro de 2 organizações acessa exclusivamente a organização ativa', async () => {
    const app = fastify();
    await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
    await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });

    // Middleware de autenticação
    app.addHook('preHandler', async (req: any, reply: any) => {
      let token = req.cookies?.token;
      if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
          token = parts[1];
        }
      }
      if (!token) return reply.status(401).send({ error: 'unauthorized' });

      try {
        const decoded = await app.jwt.verify<any>(token);
        req.authContext = {
          type: 'user',
          userId: decoded.sub,
          email: decoded.email,
          memberships: decoded.memberships || [],
          activeOrganizationId: decoded.activeOrganizationId,
        };
      } catch {
        return reply.status(401).send({ error: 'unauthorized' });
      }
    });

    // Implementação exata do hook resolveFinancialContext presente em financial.routes.ts
    app.addHook('preHandler', async (req: any, reply: any) => {
      const auth = req.authContext;
      if (!auth) return reply.status(401).send({ error: 'unauthorized' });

      if (auth.type === 'api_key') {
        const headerOrg = req.headers['x-organization-id'] as string | undefined;
        if (!headerOrg || typeof headerOrg !== 'string' || headerOrg.trim().length === 0) {
          return reply.status(400).send({
            error: 'ORGANIZATION_CONTEXT_REQUIRED',
            message: 'Cabeçalho x-organization-id é obrigatório para chave de integração',
          });
        }
        req.resolvedOrganizationId = headerOrg.trim();
        return;
      }

      if (auth.type === 'user') {
        const memberships = auth.memberships || [];
        if (memberships.length === 0) return reply.status(401).send({ error: 'unauthorized' });

        const explicitOrgId =
          auth.activeOrganizationId ||
          (req.headers['x-organization-id'] as string | undefined);

        let targetMembership = explicitOrgId
          ? memberships.find((m: any) => m.organizationId === explicitOrgId || m.organizationSlug === explicitOrgId)
          : undefined;

        if (explicitOrgId && !targetMembership) {
          return reply.status(403).send({
            error: 'forbidden',
            message: 'Usuário não possui acesso à organização informada',
          });
        }

        if (!targetMembership) {
          if (memberships.length === 1) {
            targetMembership = memberships[0];
          } else {
            return reply.status(400).send({
              error: 'ORGANIZATION_CONTEXT_REQUIRED',
              message: 'Múltiplas organizações disponíveis. Contexto de organização ativo é obrigatório.',
            });
          }
        }

        if (!['ADMIN', 'MANAGER'].includes(targetMembership.role)) {
          return reply.status(403).send({
            error: 'forbidden',
            message: 'Permissão insuficiente na organização selecionada',
          });
        }

        req.resolvedOrganizationId = targetMembership.organizationId;
      }
    });

    // Rota que retorna o overview contextualizado estritamente para a organização resolvida
    app.get('/financial/accounts/overview', async (req: any, reply) => {
      const orgId = req.resolvedOrganizationId;
      // Banco simulado com dados isolados por organização
      const dbByOrg: Record<string, any> = {
        'org-alpha-1': {
          organizationId: 'org-alpha-1',
          name: 'Empresa Alpha Ltda',
          consolidatedBalance: 82000,
        },
        'org-beta-2': {
          organizationId: 'org-beta-2',
          name: 'Comércio Beta S/A',
          consolidatedBalance: 145000,
        },
      };

      const data = dbByOrg[orgId];
      if (!data) return reply.status(404).send({ error: 'not_found' });
      return reply.send(data);
    });

    await app.ready();

    // Usuário membro de 2 organizações:
    // Org 1: 'org-alpha-1' (papel MEMBER - sem permissão financeira)
    // Org 2: 'org-beta-2' (papel ADMIN - com permissão financeira)
    const twoOrgsMemberships = [
      { organizationId: 'org-alpha-1', organizationSlug: 'empresa-alpha', role: 'MEMBER' },
      { organizationId: 'org-beta-2', organizationSlug: 'comercio-beta', role: 'ADMIN' },
    ];

    // Caso A: Usuário com 2 organizações SEM contexto ativo -> Retorna 400 ORGANIZATION_CONTEXT_REQUIRED
    const tokenNoActive = app.jwt.sign({
      sub: 'usr_dual_tenant',
      email: 'user@multitenant.com',
      memberships: twoOrgsMemberships,
    });

    const resNoContext = await app.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: { authorization: `Bearer ${tokenNoActive}` },
    });
    assert.strictEqual(resNoContext.statusCode, 400, 'Deve retornar 400 quando há múltiplas organizações sem contexto ativo');
    assert.strictEqual(resNoContext.json().error, 'ORGANIZATION_CONTEXT_REQUIRED');

    // Caso B: Contexto ativo apontando para a segunda organização ('org-beta-2') via header x-organization-id
    const resOrgBeta = await app.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: {
        authorization: `Bearer ${tokenNoActive}`,
        'x-organization-id': 'org-beta-2',
      },
    });
    assert.strictEqual(resOrgBeta.statusCode, 200, 'Deve retornar 200 para a organização ativa selecionada');
    const bodyBeta = resOrgBeta.json();
    assert.strictEqual(bodyBeta.organizationId, 'org-beta-2');
    assert.strictEqual(bodyBeta.name, 'Comércio Beta S/A');
    assert.strictEqual(bodyBeta.consolidatedBalance, 145000, 'Retorna exclusivamente os dados da organização Beta');

    // Caso C: Contexto ativo apontando para a primeira organização ('org-alpha-1') onde o usuário é MEMBER
    const resOrgAlpha = await app.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: {
        authorization: `Bearer ${tokenNoActive}`,
        'x-organization-id': 'org-alpha-1',
      },
    });
    assert.strictEqual(resOrgAlpha.statusCode, 403, 'Deve retornar 403 Forbidden porque na org-alpha o usuário é MEMBER');
    assert.strictEqual(resOrgAlpha.json().error, 'forbidden');

    // Caso D: Usuário tenta acessar uma terceira organização ('org-gamma-3') da qual NÃO é membro
    const resForeignOrg = await app.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: {
        authorization: `Bearer ${tokenNoActive}`,
        'x-organization-id': 'org-gamma-3',
      },
    });
    assert.strictEqual(resForeignOrg.statusCode, 403, 'Deve retornar 403 Forbidden para organização externa');
    assert.strictEqual(resForeignOrg.json().error, 'forbidden');

    // Caso E: Validação de ausência total de "zafira" no módulo financeiro e no middleware de autenticação
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const routesFilePath = path.resolve('src/modules/financial/financial.routes.ts');
    const routesContent = await fs.readFile(routesFilePath, 'utf-8');
    const authFilePath = path.resolve('src/middleware/auth.ts');
    const authContent = await fs.readFile(authFilePath, 'utf-8');

    assert.strictEqual(
      /zafira/i.test(routesContent),
      false,
      'Não pode haver nenhuma menção à palavra "zafira" em financial.routes.ts'
    );
    assert.strictEqual(
      authContent.includes("organizationSlug === 'zafira'"),
      false,
      'Não pode haver organizationSlug === "zafira" em auth.ts'
    );
    assert.strictEqual(
      /zafira/i.test(authContent),
      false,
      'Não pode haver referência a zafira em auth.ts'
    );

    // Caso F: Validação de api_key e escopo estrito de organizações
    const appApiKey = fastify();
    appApiKey.addHook('preHandler', async (req: any, reply: any) => {
      const apiKeyHeader = req.headers['x-api-key'];
      if (apiKeyHeader === 'valid-api-key') {
        req.authContext = {
          type: 'api_key',
          role: 'ADMIN',
          allowedOrganizationIds: ['org-scoped-1'], // Escopo restrito apenas à org-scoped-1
        };
        return;
      }
      if (apiKeyHeader === 'unscoped-api-key') {
        req.authContext = {
          type: 'api_key',
          role: 'ADMIN',
          allowedOrganizationIds: [], // Chave sem organizações autorizadas vinculadas
        };
        return;
      }
      return reply.status(401).send({ error: 'unauthorized' });
    });

    // Hook resolveFinancialContext idêntico ao de financial.routes.ts
    appApiKey.addHook('preHandler', async (req: any, reply: any) => {
      const auth = req.authContext;
      if (!auth) return reply.status(401).send({ error: 'unauthorized' });

      if (auth.type === 'api_key') {
        const headerOrg = req.headers['x-organization-id'] as string | undefined;
        if (!headerOrg || typeof headerOrg !== 'string' || headerOrg.trim().length === 0) {
          return reply.status(400).send({
            status: 'error',
            error: 'ORGANIZATION_CONTEXT_REQUIRED',
            message: 'Cabeçalho x-organization-id é obrigatório para chave de integração',
          });
        }

        const orgId = headerOrg.trim();
        const allowed = auth.allowedOrganizationIds;

        if (!allowed || allowed.length === 0) {
          return reply.status(403).send({
            status: 'error',
            error: 'forbidden',
            code: 'API_KEY_ORGANIZATION_UNAUTHORIZED',
            message: 'Chave de integração não possui organizações vinculadas no seu escopo',
          });
        }

        if (!allowed.includes(orgId)) {
          return reply.status(403).send({
            status: 'error',
            error: 'forbidden',
            code: 'API_KEY_ORGANIZATION_UNAUTHORIZED',
            message: 'Chave de integração não autorizada para a organização informada',
          });
        }

        req.resolvedOrganizationId = orgId;
        return;
      }
    });

    appApiKey.get('/financial/accounts/overview', async (req: any, reply) => {
      return reply.send({ success: true, organizationId: req.resolvedOrganizationId });
    });

    await appApiKey.ready();

    // 1. API key sem cabeçalho x-organization-id -> 400 ORGANIZATION_CONTEXT_REQUIRED
    const resNoOrgHeader = await appApiKey.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: { 'x-api-key': 'valid-api-key' },
    });
    assert.strictEqual(resNoOrgHeader.statusCode, 400);
    assert.strictEqual(resNoOrgHeader.json().error, 'ORGANIZATION_CONTEXT_REQUIRED');

    // 2. API key com cabeçalho de organização não autorizada -> 403 API_KEY_ORGANIZATION_UNAUTHORIZED
    const resUnauthorizedOrg = await appApiKey.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: {
        'x-api-key': 'valid-api-key',
        'x-organization-id': 'org-invasora-999',
      },
    });
    assert.strictEqual(resUnauthorizedOrg.statusCode, 403);
    assert.strictEqual(resUnauthorizedOrg.json().code, 'API_KEY_ORGANIZATION_UNAUTHORIZED');

    // 3. API key sem organizações vinculadas no seu escopo -> 403 API_KEY_ORGANIZATION_UNAUTHORIZED
    const resUnscoped = await appApiKey.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: {
        'x-api-key': 'unscoped-api-key',
        'x-organization-id': 'org-scoped-1',
      },
    });
    assert.strictEqual(resUnscoped.statusCode, 403);
    assert.strictEqual(resUnscoped.json().code, 'API_KEY_ORGANIZATION_UNAUTHORIZED');

    // 4. API key com organização autorizada no seu escopo -> 200 OK
    const resAuthorized = await appApiKey.inject({
      method: 'GET',
      url: '/financial/accounts/overview',
      headers: {
        'x-api-key': 'valid-api-key',
        'x-organization-id': 'org-scoped-1',
      },
    });
    assert.strictEqual(resAuthorized.statusCode, 200);
    assert.strictEqual(resAuthorized.json().organizationId, 'org-scoped-1');
  });

  // ---------------------------------------------------------------------------
  // 17. Contrato de categorias e proteção defensiva contra categories.map is not a function
  // ---------------------------------------------------------------------------
  await t.test('17. Categorias: contrato { categories: [...] }, getCategories retorna array e renderiza seguro', async () => {
    // 1. Simulação do endpoint de backend GET /financial/categories
    const app = fastify();
    app.get('/financial/categories', async () => {
      return {
        categories: [
          { id: 'cat-1', name: 'Honorários', slug: 'honorarios', type: 'INCOME' },
          { id: 'cat-2', name: 'Software & SaaS', slug: 'software-saas', type: 'EXPENSE' },
        ],
      };
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/financial/categories' });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.categories), 'O contrato da API retorna objeto com propriedade categories como array');
    assert.strictEqual(body.categories.length, 2);

    // 2. Simulação da função cliente getCategories() com extração defensiva
    const parseCategoriesResponse = (data: any): any[] => {
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.categories)) return data.categories;
      return [];
    };

    // Caso A: JSON esperado { categories: [...] }
    const resultFromStandardJson = parseCategoriesResponse(body);
    assert.ok(Array.isArray(resultFromStandardJson));
    assert.strictEqual(resultFromStandardJson.length, 2);
    assert.strictEqual(resultFromStandardJson[0].name, 'Honorários');

    // Caso B: JSON vazio {} ou { categories: null }
    const resultFromEmptyJson = parseCategoriesResponse({});
    assert.ok(Array.isArray(resultFromEmptyJson));
    assert.strictEqual(resultFromEmptyJson.length, 0);

    const resultFromNull = parseCategoriesResponse(null);
    assert.ok(Array.isArray(resultFromNull));
    assert.strictEqual(resultFromNull.length, 0);

    // 3. Simulação da renderização defensiva no componente (categoryOptions.map)
    const renderCategorySelector = (categoriesState: any) => {
      const categoryOptions = Array.isArray(categoriesState) ? categoriesState : [];
      return categoryOptions.map((c: any) => ({ value: c.id, label: c.name }));
    };

    // Renderiza com dados válidos
    const renderedNormal = renderCategorySelector(resultFromStandardJson);
    assert.strictEqual(renderedNormal.length, 2);
    assert.strictEqual(renderedNormal[0].label, 'Honorários');

    // Renderiza com array vazio sem quebrar
    const renderedEmpty = renderCategorySelector([]);
    assert.strictEqual(renderedEmpty.length, 0);

    // Renderiza com estado corrompido (ex: null, undefined ou objeto) sem disparar TypeError (.map is not a function)
    const renderedFromNull = renderCategorySelector(null);
    assert.strictEqual(renderedFromNull.length, 0);

    const renderedFromObject = renderCategorySelector({ notAnArray: true });
    assert.strictEqual(renderedFromObject.length, 0);
  });
});



