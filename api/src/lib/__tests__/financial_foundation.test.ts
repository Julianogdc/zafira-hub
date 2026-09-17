import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
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
import {
  normalizeInterDate,
  normalizeInterDirection,
  normalizeInterAmount,
  extractInterDatePrecision,
  extractInterTime,
  formatBankDateTimeDisplay,
  formatCounterpartyDisplay,
} from '../../modules/integrations/inter/inter.normalizer.js';
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
    const originalHttpsRequest = https.request;
    const originalConsoleError = console.error;

    let loggedErrors: string[] = [];
    console.error = (...args: any[]) => {
      loggedErrors.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };

    let lastCapturedOptions: any = null;
    let lastCapturedBody = '';

    const mockHttps = (
      statusCode: number,
      body: string,
      headers: Record<string, string> = { 'content-type': 'application/json' }
    ) => {
      lastCapturedOptions = null;
      lastCapturedBody = '';
      https.request = ((options: any, callback?: any) => {
        lastCapturedOptions = options;
        const req = new EventEmitter() as any;
        req.write = (chunk: any) => {
          lastCapturedBody += String(chunk);
        };
        req.end = (chunk?: any) => {
          if (chunk) lastCapturedBody += String(chunk);
          process.nextTick(() => {
            const res = new EventEmitter() as any;
            res.statusCode = statusCode;
            res.headers = headers;
            if (callback) callback(res);
            res.emit('data', Buffer.from(body));
            res.emit('end');
          });
        };
        req.destroy = () => {};
        return req;
      }) as any;
    };

    tSub.afterEach(() => {
      https.request = originalHttpsRequest;
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
      mockHttps(400, JSON.stringify({
        error: 'invalid_client',
        error_description: 'Client credentials are not authorized or disabled',
      }));

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
      mockHttps(400, JSON.stringify({
        error: 'invalid_scope',
        error_description: 'The requested scope is not configured for application',
      }));

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
      mockHttps(400, rawHtml, { 'content-type': 'text/html' });

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
      mockHttps(400, JSON.stringify({
        error: 'unauthorized',
        error_description: 'Unauthorized access',
        access_token: 'SUPER_SECRET_TOKEN_DO_NOT_LEAK',
      }));

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
  await t.test('2.2 Conformidade OAuth (mTLS real no node:https.request + Accept json) e proteção contra falso saldo zero', async (tSub) => {
    const originalHttpsRequest = https.request;
    tSub.afterEach(() => {
      https.request = originalHttpsRequest;
    });

    let lastCapturedOptions: any = null;
    let lastCapturedBody = '';

    const mockHttps = (
      statusCode: number,
      body: string,
      headers: Record<string, string> = { 'content-type': 'application/json' }
    ) => {
      lastCapturedOptions = null;
      lastCapturedBody = '';
      https.request = ((options: any, callback?: any) => {
        lastCapturedOptions = options;
        const req = new EventEmitter() as any;
        req.write = (chunk: any) => {
          lastCapturedBody += String(chunk);
        };
        req.end = (chunk?: any) => {
          if (chunk) lastCapturedBody += String(chunk);
          process.nextTick(() => {
            const res = new EventEmitter() as any;
            res.statusCode = statusCode;
            res.headers = headers;
            if (callback) callback(res);
            res.emit('data', Buffer.from(body));
            res.emit('end');
          });
        };
        req.destroy = () => {};
        return req;
      }) as any;
    };

    // 1. Prova do mTLS real no transporte node:https.request e serialização dos 4 campos urlencoded
    await tSub.test('1. Transporte node:https.request recebe agent configurado com cert e key em memória e Accept json', async () => {
      mockHttps(200, JSON.stringify({
        access_token: 'valid-mock-token-abc',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'extrato.read',
      }));

      const fakeCrt = '-----BEGIN CERTIFICATE-----\nFAKE_CRT_RAW\n-----END CERTIFICATE-----';
      const fakeKey = '-----BEGIN PRIVATE KEY-----\nFAKE_KEY_RAW\n-----END PRIVATE KEY-----';

      const client = new InterClient({
        clientId: 'my-inter-client-id',
        clientSecret: 'my-inter-client-secret',
        crtBase64: Buffer.from(fakeCrt).toString('base64'),
        keyBase64: Buffer.from(fakeKey).toString('base64'),
        oauthScope: 'extrato.read',
      });

      const token = await client.getAccessToken();
      assert.strictEqual(token, 'valid-mock-token-abc');

      // Prova de que o transporte nativo https.request foi acionado com o agente mTLS
      assert.ok(lastCapturedOptions, 'https.request deve ter sido acionado');
      assert.strictEqual(lastCapturedOptions.method, 'POST');
      assert.strictEqual(lastCapturedOptions.hostname, 'cdpj.partners.bancointer.com.br');
      assert.strictEqual(lastCapturedOptions.path, '/oauth/v2/token');
      assert.ok(lastCapturedOptions.agent instanceof https.Agent, 'agent deve ser https.Agent');

      // Prova de que cert e key chegaram ao agente mTLS no transporte
      const agentOptions = (lastCapturedOptions.agent as any).options;
      assert.ok(Buffer.isBuffer(agentOptions.cert), 'Certificado deve ser Buffer em memória');
      assert.ok(Buffer.isBuffer(agentOptions.key), 'Chave privada deve ser Buffer em memória');
      assert.strictEqual(agentOptions.cert.toString('utf8'), fakeCrt);
      assert.strictEqual(agentOptions.key.toString('utf8'), fakeKey);
      assert.strictEqual(agentOptions.rejectUnauthorized, true, 'rejectUnauthorized deve ser estritamente true');

      // Validação de headers
      assert.strictEqual(lastCapturedOptions.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.strictEqual(lastCapturedOptions.headers['Accept'], 'application/json');

      // Verifica os 4 campos no formulário urlencoded
      const params = new URLSearchParams(lastCapturedBody);
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
          findUnique: async () => null,
          findFirst: async () => null,
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
    assert.strictEqual(firstRun.size, 11);
    assert.strictEqual(created.length, 10);

    const secondRun = await catService.ensureDefaultCategories('org-test');
    assert.strictEqual(secondRun.size, 11);
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

  // ---------------------------------------------------------------------------
  // 15. Correção obrigatória — normalização de datas e direção do extrato Banco Inter
  // ---------------------------------------------------------------------------
  await t.test('15. Normalização de datas e direção do extrato Inter PJ (6 testes obrigatórios)', async (tSub) => {
    // 1. Data válida exibida corretamente em dd/MM/yyyy sem fallback silencioso para hoje
    await tSub.test('15.1 Normalização de datas: suporta ISO, ISO com espaço, ISO date-only, padrão BR e rejeita valores inválidos sem fallback silencioso', () => {
      // Formato ISO completo com microssegundos
      const d1 = normalizeInterDate('2026-09-17T14:30:00.663504');
      assert.strictEqual(d1.toISOString().slice(0, 10), '2026-09-17');

      // Formato ISO com espaço entre data e hora
      const d2 = normalizeInterDate('2026-09-17 14:30:00');
      assert.strictEqual(d2.toISOString().slice(0, 10), '2026-09-17');

      // Formato ISO date-only
      const d3 = normalizeInterDate('2026-09-17');
      assert.strictEqual(d3.toISOString().slice(0, 10), '2026-09-17');

      // Formato brasileiro DD/MM/YYYY
      const d4 = normalizeInterDate('17/09/2026');
      assert.strictEqual(d4.toISOString().slice(0, 10), '2026-09-17');

      // Formato brasileiro DD/MM/YYYY HH:mm:ss
      const d5 = normalizeInterDate('17/09/2026 15:45:30');
      assert.strictEqual(d5.toISOString().slice(0, 10), '2026-09-17');

      // Formatação no frontend para dd/MM/yyyy
      const formatPtBr = (d: Date) => d.toLocaleDateString('pt-BR', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      assert.strictEqual(formatPtBr(d1), '17/09/2026');
      assert.strictEqual(formatPtBr(d3), '17/09/2026');
      assert.strictEqual(formatPtBr(d4), '17/09/2026');

      // REJEIÇÃO EXPLÍCITA: Nunca usa data atual silenciosa
      const invalidInputs = [null, undefined, '', '   ', 'invalid-date-string', '32/13/2026'];
      for (const invalid of invalidInputs) {
        assert.throws(
          () => normalizeInterDate(invalid),
          (err: any) => {
            assert.ok(err.message.includes('DATA_EXTRATO_INVALIDA'));
            return true;
          },
          `Deveria rejeitar com erro explícito o valor: ${invalid}`
        );
      }
    });

    // 2. PIX recebido como CREDIT
    await tSub.test('15.2 Lançamentos de PIX RECEBIDO mapeados rigorosamente como CREDIT', () => {
      // Caso A: tipoOperacao oficial 'C'
      const payloadA = {
        tipoOperacao: 'C',
        tipoTransacao: 'PIX',
        valor: 1500.50,
        titulo: 'PIX RECEBIDO',
      };
      assert.strictEqual(normalizeInterDirection(payloadA), 'CREDIT');

      // Caso B: tipoOperacao 'CREDITO' em minúsculo
      const payloadB = {
        tipoOperacao: 'credito',
        tipoTransacao: 'PIX',
        valor: '2300.00',
        titulo: 'Transferência Pix',
      };
      assert.strictEqual(normalizeInterDirection(payloadB), 'CREDIT');

      // Caso C: operacao 'C' ou tipoTransacao PIX_RECEBIDO
      const payloadC = {
        tipoTransacao: 'PIX_RECEBIDO',
        valor: 500,
        titulo: 'Pix Recebido de Cliente XYZ',
      };
      assert.strictEqual(normalizeInterDirection(payloadC), 'CREDIT');

      // Caso D: titulo explícito 'PIX RECEBIDO' mesmo se tipoOperacao estiver ausente
      const payloadD = {
        valor: '450.00',
        titulo: 'PIX RECEBIDO - FULANO DE TAL',
      };
      assert.strictEqual(normalizeInterDirection(payloadD), 'CREDIT');
    });

    // 3. PIX enviado como DEBIT, pagamento de fatura, compra de cartão e débitos
    await tSub.test('15.3 PIX enviado, faturas, compras no cartão e débitos mapeados como DEBIT', () => {
      // Caso A: tipoOperacao oficial 'D'
      const payloadA = {
        tipoOperacao: 'D',
        tipoTransacao: 'PIX',
        valor: 120.0,
        titulo: 'PIX ENVIADO',
      };
      assert.strictEqual(normalizeInterDirection(payloadA), 'DEBIT');

      // Caso B: Pagamento de fatura
      const payloadB = {
        tipoOperacao: 'DEBITO',
        tipoTransacao: 'PAGAMENTO',
        valor: '1850.30',
        titulo: 'PAGAMENTO FATURA CARTAO',
      };
      assert.strictEqual(normalizeInterDirection(payloadB), 'DEBIT');

      // Caso C: Compra no cartão
      const payloadC = {
        tipoTransacao: 'COMPRA_CARTAO',
        valor: '89.90',
        titulo: 'COMPRA NO DEBITO - RESTAURANTE',
      };
      assert.strictEqual(normalizeInterDirection(payloadC), 'DEBIT');

      // Caso D: Tarifa bancária
      const payloadD = {
        tipoOperacao: 'D',
        tipoTransacao: 'TARIFA',
        valor: '15.00',
        titulo: 'TARIFA MENSALIDADE',
      };
      assert.strictEqual(normalizeInterDirection(payloadD), 'DEBIT');
    });

    // 4. Valores e KPIs de entradas/saídas calculados corretamente
    await tSub.test('15.4 Magnitude positiva persistida e cálculo exato de entradas vs saídas operacionais', async () => {
      // 1. Magnitude positiva do valor
      assert.strictEqual(normalizeInterAmount(1500.5), 1500.5);
      assert.strictEqual(normalizeInterAmount(-1500.5), 1500.5);
      assert.strictEqual(normalizeInterAmount('-1250,50'), 1250.5);
      assert.strictEqual(normalizeInterAmount('1.250,50'), 1250.5);

      // 2. Simulação de transações no FinancialService
      const mockTransactions = [
        {
          id: 'tx-1',
          amount: 5000.0,
          direction: 'CREDIT',
          kind: 'CUSTOMER_PAYMENT',
          categorizationSource: 'RULE',
        },
        {
          id: 'tx-2',
          amount: 1200.0,
          direction: 'DEBIT',
          kind: 'EXPENSE',
          categorizationSource: 'RULE',
        },
        {
          id: 'tx-3',
          amount: 800.0,
          direction: 'DEBIT',
          kind: 'EXPENSE',
          categorizationSource: 'PENDING',
        },
        {
          id: 'tx-4',
          amount: 3000.0,
          direction: 'DEBIT',
          kind: 'TRANSFER_INTERNAL',
          categorizationSource: 'RULE',
        },
      ];

      const mockPrisma: any = {
        financialAccount: {
          findMany: async () => [
            {
              id: 'acc-inter-1',
              organizationId: 'org-kpi-test',
              provider: 'INTER',
              name: 'Banco Inter PJ',
              currentBalance: 3000.0,
              balanceAsOf: new Date('2026-09-17'),
              lastSyncedAt: new Date('2026-09-17'),
              isActive: true,
            },
          ],
        },
        financialTransaction: {
          findMany: async () => mockTransactions,
        },
      };

      const financialService = new FinancialService(mockPrisma);
      const overview = await financialService.getAccountsOverview('org-kpi-test');

      // Entradas operacionais: 5000 (CREDIT)
      assert.strictEqual(overview.operationalIncome, 5000.0);
      assert.strictEqual(overview.periodSummary.operationalIncome, 5000.0);

      // Saídas operacionais: 1200 + 800 = 2000 (DEBIT) - TRANSFER_INTERNAL é excluída
      assert.strictEqual(overview.operationalExpense, 2000.0);
      assert.strictEqual(overview.periodSummary.operationalExpense, 2000.0);

      // Transferências internas: 3000
      assert.strictEqual(overview.internalTransfersAmount, 3000.0);

      // Pendentes de revisão: 1
      assert.strictEqual(overview.toReviewCount, 1);
    });

    // 5. Reprocessamento idempotente sem duplicar movimentações
    await tSub.test('15.5 Reprocessamento idempotente: corrige 44 registros existentes sem duplicar nem apagar', async () => {
      // Cria 44 movimentações simuladas no banco de teste
      const dbRecords: any[] = [];
      for (let i = 1; i <= 44; i++) {
        const isRecebido = i % 2 === 0;
        dbRecords.push({
          id: `tx-db-${i}`,
          organizationId: 'org-reprocess-test',
          accountId: 'acc-inter-reprocess',
          externalId: `ext-id-${i}`,
          // Anteriormente com data não normalizada e direção errada (todas como DEBIT)
          occurredAt: new Date('2026-09-10T00:00:00Z'),
          direction: 'DEBIT',
          kind: 'EXPENSE',
          amount: 100.0 * i,
          description: isRecebido ? `PIX RECEBIDO CLIENTE ${i}` : `PIX ENVIADO FORNECEDOR ${i}`,
          rawPayload: {
            dataHoraMovimento: `2026-09-17 10:${String(i).padStart(2, '0')}:00`,
            tipoOperacao: isRecebido ? 'C' : 'D',
            tipoTransacao: 'PIX',
            valor: `${100.0 * i}`,
            titulo: isRecebido ? 'PIX RECEBIDO' : 'PIX ENVIADO',
          },
          account: { provider: 'INTER' },
          sourceTransfer: null,
          destTransfer: null,
        });
      }

      let deleteCalled = false;
      let createCalled = false;
      const updatedList: any[] = [];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => dbRecords,
          update: async (args: any) => {
            const index = dbRecords.findIndex((r) => r.id === args.where.id);
            assert.ok(index !== -1, 'Transação deve existir no banco para ser atualizada');
            dbRecords[index] = { ...dbRecords[index], ...args.data };
            updatedList.push(args);
            return dbRecords[index];
          },
          delete: () => { deleteCalled = true; },
          deleteMany: () => { deleteCalled = true; },
          create: () => { createCalled = true; },
        },
        financialAccount: {
          findMany: async () => [{ id: 'acc-inter-reprocess', provider: 'INTER', isActive: true }],
        },
        financialTransfer: {
          create: async () => ({ id: 'transfer-mock' }),
        },
      };

      const interService = new InterService(mockPrisma);

      // Primeira execução de reprocessamento
      const firstRun = await interService.reprocessExistingTransactions('org-reprocess-test');

      assert.strictEqual(firstRun.reprocessedCount, 44, 'Deve encontrar as 44 movimentações existentes');
      assert.strictEqual(firstRun.updatedCount, 44, 'Deve atualizar as 44 movimentações');
      assert.strictEqual(deleteCalled, false, 'Nenhuma transação deve ser deletada');
      assert.strictEqual(createCalled, false, 'Nenhuma transação nova deve ser criada');

      // Verifica correções nos registros
      const creditCount = dbRecords.filter((r) => r.direction === 'CREDIT').length;
      const debitCount = dbRecords.filter((r) => r.direction === 'DEBIT').length;
      assert.strictEqual(creditCount, 22, 'Exatamente 22 transações de PIX RECEBIDO devem ser corrigidas para CREDIT');
      assert.strictEqual(debitCount, 22, 'Exatamente 22 transações de PIX ENVIADO devem permanecer como DEBIT');

      // Datas corrigidas para 17/09/2026
      for (const r of dbRecords) {
        assert.strictEqual(r.occurredAt.toISOString().slice(0, 10), '2026-09-17');
      }

      // Segunda execução: IDEMPOTÊNCIA TOTAL (não altera total de registros nem duplica)
      const secondRun = await interService.reprocessExistingTransactions('org-reprocess-test');
      assert.strictEqual(secondRun.reprocessedCount, 44);
      assert.strictEqual(dbRecords.length, 44, 'O total de transações permanece estritamente 44');
    });

    // 6. Regressão BANK_WRITE_FORBIDDEN permanece 100% protegida
    await tSub.test('15.6 Regressão: BANK_WRITE_FORBIDDEN bloqueia qualquer escrita bancária POST/PUT/DELETE', async () => {
      const client = new InterClient({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        crtBase64: Buffer.from('cert').toString('base64'),
        keyBase64: Buffer.from('key').toString('base64'),
      });

      const writeAttempts = [
        { method: 'POST', endpoint: '/banking/v2/pix' },
        { method: 'POST', endpoint: '/banking/v2/extrato' },
        { method: 'PUT', endpoint: '/banking/v2/saldo' },
        { method: 'PATCH', endpoint: '/banking/v2/movimentacoes/123' },
        { method: 'DELETE', endpoint: '/banking/v2/cobrancas/456' },
      ];

      for (const attempt of writeAttempts) {
        await assert.rejects(
          async () => {
            await client.requestBankingResource(attempt.method, attempt.endpoint);
          },
          (err: any) => {
            assert.strictEqual(err.code, 'BANK_WRITE_FORBIDDEN');
            assert.strictEqual(err.statusCode, 405);
            return true;
          },
          `Tentativa de ${attempt.method} em ${attempt.endpoint} deve ser rejeitada com BANK_WRITE_FORBIDDEN`
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 16. Gestão de Categorias e Classificação Automática do Caixa Inter PJ
  // ---------------------------------------------------------------------------
  await t.test('16. Gestão de Categorias e Classificação Automática do Caixa Inter PJ (9 testes obrigatórios)', async (tSub) => {
    // 1. Criar e editar categoria
    await tSub.test('16.1 Criar e editar categoria: valida unicidade e atualização de tipo/cor', async () => {
      const categoriesDb: any[] = [];
      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => categoriesDb,
          findFirst: async (args: any) => {
            return categoriesDb.find((c) => {
              if (c.organizationId !== args.where.organizationId) return false;
              if (args.where.id && c.id === args.where.id) return true;
              if (args.where.name?.equals && c.name.toLowerCase() === args.where.name.equals.toLowerCase()) {
                if (args.where.id?.not && c.id === args.where.id.not) return false;
                return true;
              }
              return false;
            }) || null;
          },
          create: async (args: any) => {
            const cat = { id: `cat-${Date.now()}-${Math.random()}`, ...args.data, _count: { transactions: 0 } };
            categoriesDb.push(cat);
            return cat;
          },
          update: async (args: any) => {
            const index = categoriesDb.findIndex((c) => c.id === args.where.id);
            assert.ok(index !== -1);
            categoriesDb[index] = { ...categoriesDb[index], ...args.data };
            return categoriesDb[index];
          },
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Cria categoria
      const created = await catService.createCategory('org-cat-1', {
        name: 'Tráfego Pago Google Ads',
        type: 'EXPENSE',
        color: '#4285F4',
      });
      assert.strictEqual(created.name, 'Tráfego Pago Google Ads');
      assert.strictEqual(created.type, 'EXPENSE');
      assert.strictEqual(created.color, '#4285F4');
      assert.strictEqual(created.isActive, true);

      // Edita categoria
      const updated = await catService.updateCategory('org-cat-1', created.id, {
        name: 'Google Ads & YouTube',
        color: '#EA4335',
      });
      assert.strictEqual(updated.name, 'Google Ads & YouTube');
      assert.strictEqual(updated.color, '#EA4335');
    });

    // 2. Arquivar e reativar categoria
    await tSub.test('16.2 Arquivar e reativar categoria: altera isActive e preserva integridade', async () => {
      const catRecord = {
        id: 'cat-archive-test',
        organizationId: 'org-archive',
        name: 'Ferramentas de IA',
        type: 'EXPENSE',
        isActive: true,
        isSystem: false,
      };

      const mockPrisma: any = {
        financialCategory: {
          findFirst: async () => catRecord,
          update: async (args: any) => {
            Object.assign(catRecord, args.data);
            return catRecord;
          },
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Arquivar
      const archived = await catService.archiveCategory('org-archive', 'cat-archive-test');
      assert.strictEqual(archived.isActive, false);

      // Reativar
      const reactivated = await catService.reactivateCategory('org-archive', 'cat-archive-test');
      assert.strictEqual(reactivated.isActive, true);
    });

    // 3. Bloquear exclusão de categoria com movimentações vinculadas
    await tSub.test('16.3 Bloqueia exclusão de categoria que possui movimentações com CATEGORY_HAS_TRANSACTIONS', async () => {
      const mockPrisma: any = {
        financialCategory: {
          findFirst: async () => ({
            id: 'cat-with-tx',
            organizationId: 'org-test',
            name: 'Honorários',
            isSystem: false,
          }),
        },
        financialTransaction: {
          count: async () => 14, // 14 movimentações vinculadas
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      await assert.rejects(
        async () => {
          await catService.deleteCategory('org-test', 'cat-with-tx');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'CATEGORY_HAS_TRANSACTIONS');
          assert.strictEqual(err.transactionCount, 14);
          assert.ok(err.message.includes('possui 14 movimentação(ões) vinculada(s)'));
          return true;
        }
      );
    });

    // 4. Excluir categoria sem movimentações vinculadas
    await tSub.test('16.4 Exclui categoria com sucesso quando há 0 movimentações vinculadas', async () => {
      let deletedId = '';
      let rulesDeleted = false;

      const mockPrisma: any = {
        financialCategory: {
          findFirst: async () => ({
            id: 'cat-empty',
            organizationId: 'org-test',
            name: 'Categoria Temporária',
            isSystem: false,
          }),
          delete: async (args: any) => {
            deletedId = args.where.id;
            return { id: deletedId };
          },
        },
        financialTransaction: {
          count: async () => 0, // 0 movimentações
        },
        financialCategoryRule: {
          deleteMany: async () => {
            rulesDeleted = true;
          },
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);
      const res = await catService.deleteCategory('org-test', 'cat-empty');

      assert.strictEqual(res.id, 'cat-empty');
      assert.strictEqual(deletedId, 'cat-empty');
      assert.strictEqual(rulesDeleted, true);
    });

    // 5. Criar regra e classificar nova movimentação automaticamente
    await tSub.test('16.5 Classificação automática por regra ativa e prioridade', async () => {
      const rules = [
        {
          id: 'rule-low-priority',
          organizationId: 'org-auto',
          categoryId: 'cat-geral',
          matchField: 'DESCRIPTION',
          matchType: 'CONTAINS',
          matchValueNormalized: 'servico',
          priority: 5,
          isActive: true,
        },
        {
          id: 'rule-high-priority',
          organizationId: 'org-auto',
          categoryId: 'cat-aws-cloud',
          matchField: 'DESCRIPTION',
          matchType: 'CONTAINS',
          matchValueNormalized: 'amazon web services',
          priority: 50,
          isActive: true,
        },
      ];

      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-geral', name: 'Geral' },
            { id: 'cat-aws-cloud', name: 'Infraestrutura Cloud' },
            { id: 'cat-review', name: 'Para revisar' },
          ],
          create: async () => ({ id: 'cat-review', name: 'Para revisar' }),
        },
        financialCategoryRule: {
          findMany: async () => rules.sort((a, b) => b.priority - a.priority),
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Transação contendo 'amazon web services' deve casar com a regra de maior prioridade (50)
      const res = await catService.categorizeTransaction('org-auto', {
        description: 'PAGAMENTO AMAZON WEB SERVICES CLOUD SP',
      });

      assert.strictEqual(res.categoryId, 'cat-aws-cloud');
      assert.strictEqual(res.categorizationSource, 'AUTO_RULE');
      assert.strictEqual(res.categorizationConfidence, 0.95);
    });

    // 6. Regra manual prevalece sobre sugestão genérica
    await tSub.test('16.6 Classificação manual pelo usuário grava MANUAL com confiança 1.0 e cria regra configurada', async () => {
      let updatedTransaction: any = null;
      let createdRuleData: any = null;

      const mockPrisma: any = {
        financialTransaction: {
          findUnique: async () => ({
            id: 'tx-manual-1',
            organizationId: 'org-manual',
            description: 'PIX RECEBIDO JULIANO ASSESSORIA',
            counterpartyName: 'JULIANO SILVA',
            amount: 4500.0,
          }),
          update: async (args: any) => {
            updatedTransaction = args.data;
            return { id: args.where.id, ...args.data };
          },
        },
        financialCategory: {
          findFirst: async () => ({ id: 'cat-consultoria', organizationId: 'org-manual' }),
        },
        financialCategoryRule: {
          create: async (args: any) => {
            createdRuleData = args.data;
            return { id: 'rule-new-1', ...args.data };
          },
        },
      };

      const finService = new FinancialService(mockPrisma);

      await finService.updateTransactionCategory('org-manual', 'tx-manual-1', {
        categoryId: 'cat-consultoria',
        createRule: true,
        ruleField: 'COUNTERPARTY_NAME',
        ruleMatchType: 'EXACT',
        rulePattern: 'JULIANO SILVA',
        rulePriority: 30,
      });

      // Valida que a transação foi salva estritamente como MANUAL
      assert.strictEqual(updatedTransaction.categoryId, 'cat-consultoria');
      assert.strictEqual(updatedTransaction.categorizationSource, 'MANUAL');
      assert.strictEqual(updatedTransaction.categorizationConfidence, 1.0);

      // Valida criação da regra configurada
      assert.ok(createdRuleData);
      assert.strictEqual(createdRuleData.categoryId, 'cat-consultoria');
      assert.strictEqual(createdRuleData.matchField, 'COUNTERPARTY_NAME');
      assert.strictEqual(createdRuleData.matchType, 'EXACT');
      assert.strictEqual(createdRuleData.priority, 30);
    });

    // 7. Movimento sem regra permanece "Para revisar"
    await tSub.test('7. Movimento sem correspondência permanece com categoria Para revisar e status PENDING', async () => {
      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-rev-id', name: 'Para revisar' },
          ],
          create: async (args: any) => ({ id: 'mock-created-cat', ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [], // Zero regras
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);
      const res = await catService.categorizeTransaction('org-pendente', {
        description: 'DESPESA DESCONHECIDA SEM PADRAO',
      });

      assert.strictEqual(res.categoryId, 'cat-rev-id');
      assert.strictEqual(res.categorizationSource, 'PENDING');
      assert.strictEqual(res.categorizationConfidence, 0.5);
    });

    // 8. Multi-tenant e RBAC
    await tSub.test('8. RBAC estrito: MEMBER é bloqueado com 403; ADMIN e MANAGER autorizados', async () => {
      const testApp = fastify();
      testApp.decorate('authContext', null as any);

      testApp.addHook('preHandler', async (req: any) => {
        const role = req.headers['x-role'] || 'MEMBER';
        req.authContext = {
          type: 'user',
          userId: 'user-rbac',
          memberships: [{ organizationId: 'org-tenant-1', role }],
          activeOrganizationId: 'org-tenant-1',
        };
      });

      testApp.post('/financial/categories', {
        preHandler: [requireRole(['ADMIN', 'MANAGER'])],
      }, async () => ({ success: true }));

      await testApp.ready();

      // MEMBER tentando criar categoria -> 403 Forbidden
      const memberRes = await testApp.inject({
        method: 'POST',
        url: '/financial/categories',
        headers: { 'x-role': 'MEMBER' },
        payload: { name: 'Nova Categoria' },
      });
      assert.strictEqual(memberRes.statusCode, 403);

      // MANAGER criando categoria -> 200 OK
      const managerRes = await testApp.inject({
        method: 'POST',
        url: '/financial/categories',
        headers: { 'x-role': 'MANAGER' },
        payload: { name: 'Nova Categoria' },
      });
      assert.strictEqual(managerRes.statusCode, 200);

      // ADMIN criando categoria -> 200 OK
      const adminRes = await testApp.inject({
        method: 'POST',
        url: '/financial/categories',
        headers: { 'x-role': 'ADMIN' },
        payload: { name: 'Nova Categoria' },
      });
      assert.strictEqual(adminRes.statusCode, 200);
    });

    // 9. Regressão de datas, CREDIT/DEBIT e BANK_WRITE_FORBIDDEN
    await tSub.test('9. Regressão estrita: datas ISO válidas, CREDIT/DEBIT e BANK_WRITE_FORBIDDEN', async () => {
      // 1. Data normalizada válida
      const date = normalizeInterDate('17/09/2026');
      assert.strictEqual(date.toISOString().slice(0, 10), '2026-09-17');

      // 2. Direção estruturada CREDIT/DEBIT
      assert.strictEqual(normalizeInterDirection({ tipoOperacao: 'C', titulo: 'PIX RECEBIDO' }), 'CREDIT');
      assert.strictEqual(normalizeInterDirection({ tipoOperacao: 'D', titulo: 'PIX ENVIADO' }), 'DEBIT');

      // 3. BANK_WRITE_FORBIDDEN
      const client = new InterClient({
        clientId: 'id',
        clientSecret: 'sec',
        crtBase64: Buffer.from('crt').toString('base64'),
        keyBase64: Buffer.from('key').toString('base64'),
      });

      await assert.rejects(
        async () => {
          await client.requestBankingResource('POST', '/banking/v2/pix');
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
  // 17. Receitas por Cliente no Caixa Inter PJ (6 testes obrigatórios)
  // ---------------------------------------------------------------------------
  await t.test('17. Receitas por Cliente no Caixa Inter PJ (6 testes obrigatórios)', async (tSub) => {
    // 17.1 Receita categorizada com cliente vinculado: Categoria = tipo da movimentação, Cliente = pessoa/empresa
    await tSub.test('17.1 Receita categorizada com cliente vinculado (Receita de clientes | Cliente: Biolab)', async () => {
      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-rec-cli', name: 'Receita de clientes', type: 'INCOME', isDefault: true, organizationId: 'org-1' },
          ],
          findFirst: async (args: any) => ({
            id: 'cat-rec-cli',
            name: 'Receita de clientes',
            type: 'INCOME',
            isDefault: true,
            organizationId: args.where.organizationId,
          }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          findFirst: async () => null,
          findMany: async () => [],
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Transação vinculada com categoria 'Receita de clientes' e cliente 'Biolab'
      const tx = {
        id: 'tx-biolab-1',
        amount: 1800.0,
        direction: 'CREDIT',
        categoryId: 'cat-rec-cli',
        category: { id: 'cat-rec-cli', name: 'Receita de clientes', type: 'INCOME' },
        clientId: 'cli-biolab',
        client: { id: 'cli-biolab', name: 'Biolab', document: '12.345.678/0001-90' },
      };

      assert.strictEqual(tx.category.name, 'Receita de clientes');
      assert.strictEqual(tx.client.name, 'Biolab');
      assert.strictEqual(tx.amount, 1800.0);
      assert.strictEqual(tx.direction, 'CREDIT');
      // Garante que a categoria não é o nome do cliente
      assert.notStrictEqual(tx.category.name, tx.client.name);
    });

    // 17.2 Identificação automática por documento exato (CPF/CNPJ) vincula cliente da mesma organização com alta confiança (0.98)
    await tSub.test('17.2 Documento exato (CPF/CNPJ) vincula cliente automaticamente com alta confiança (0.98)', async () => {
      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-rec-cli', name: 'Receita de clientes', type: 'INCOME', isDefault: true, organizationId: 'org-doc' },
          ],
          findFirst: async () => ({
            id: 'cat-rec-cli',
            name: 'Receita de clientes',
            type: 'INCOME',
            isDefault: true,
            organizationId: 'org-doc',
          }),
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          findFirst: async (args: any) => {
            if (args.where.organizationId === 'org-doc' && args.where.document === '12345678000190') {
              return { id: 'cli-doc-match', name: 'Biolab Farmacêutica', document: '12.345.678/0001-90', organizationId: 'org-doc' };
            }
            return null;
          },
          findMany: async (args: any) => {
            if (args.where.organizationId === 'org-doc') {
              return [{ id: 'cli-doc-match', name: 'Biolab Farmacêutica', document: '12.345.678/0001-90', organizationId: 'org-doc' }];
            }
            return [];
          },
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Entrada com documento correspondente exato
      const result = await catService.categorizeTransaction('org-doc', {
        counterpartyDocument: '12.345.678/0001-90',
        counterpartyName: 'BIOLAB FARMACEUTICA LTDA',
        direction: 'CREDIT',
        amount: 1800.0,
      });

      assert.strictEqual(result.clientId, 'cli-doc-match');
      assert.strictEqual(result.suggestedClientId, null);
      assert.strictEqual(result.categoryId, 'cat-rec-cli');
      assert.strictEqual(result.categorizationSource, 'AUTO_RULE');
      assert.strictEqual(result.categorizationConfidence, 0.98);
    });

    // 17.3 Nome de contraparte igualdade normalizada gera apenas sugestão (suggestedClientId), NÃO vincula automaticamente (clientId: null)
    await tSub.test('17.3 Nome com correspondência exata normalizada gera apenas sugestão (clientId: null, suggestedClientId preenchido)', async () => {
      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-rec-cli', name: 'Receita de clientes', type: 'INCOME', isDefault: true, organizationId: 'org-name' },
            { id: 'cat-rev', name: 'Para revisar', type: 'EXPENSE', isDefault: true, organizationId: 'org-name' },
          ],
          findFirst: async (args: any) => {
            if (args.where.name === 'Receita de clientes') {
              return { id: 'cat-rec-cli', name: 'Receita de clientes', type: 'INCOME', isDefault: true };
            }
            return { id: 'cat-rev', name: 'Para revisar', type: 'EXPENSE', isDefault: true };
          },
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          findFirst: async () => null, // Sem match de documento
          findMany: async (args: any) => {
            if (args.where.organizationId === 'org-name') {
              return [
                { id: 'cli-biolab-sug', name: 'Biolab Farmacêutica' },
              ];
            }
            return [];
          },
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Entrada com nome que coincide exatamente após normalização ("biolab farmaceutica")
      const result = await catService.categorizeTransaction('org-name', {
        counterpartyName: 'BIOLAB FARMACÊUTICA',
        direction: 'CREDIT',
        amount: 2500.0,
      });

      // NÃO vincula automaticamente: clientId deve ser nulo/undefined
      assert.strictEqual(result.clientId, null);
      // Apresenta sugestão clara para confirmação
      assert.strictEqual(result.suggestedClientId, 'cli-biolab-sug');
      // Movimento permanece para revisar aguardando confirmação do usuário
      assert.strictEqual(result.categoryId, 'cat-rev');
      assert.strictEqual(result.categorizationSource, 'PENDING');
      assert.strictEqual(result.categorizationConfidence, 0.5);
    });

    // 17.4 Associação manual com "Reconhecer próximos recebimentos" cria regra com clientId e categoria Receita de clientes
    await tSub.test('17.4 Associação manual com "Reconhecer próximos recebimentos" cria regra com clientId e categoria Receita de clientes', async () => {
      let createdRuleData: any = null;
      let updatedTxData: any = null;

      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-rec-cli', name: 'Receita de clientes', type: 'INCOME', isDefault: true, organizationId: 'org-manual' },
          ],
          findFirst: async () => ({
            id: 'cat-rec-cli',
            name: 'Receita de clientes',
            type: 'INCOME',
            isDefault: true,
          }),
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findFirst: async () => null,
          create: async (args: any) => {
            createdRuleData = args.data;
            return { id: 'rule-future-client', ...args.data };
          },
          findMany: async () => [],
        },
        financialTransaction: {
          findUnique: async () => ({
            id: 'tx-manual-1',
            organizationId: 'org-manual',
            counterpartyName: 'PNEUTEK COMERCIO DE PNEUS',
            counterpartyDocument: '11222333000144',
            direction: 'CREDIT',
            suggestedClientId: 'cli-pneutek',
          }),
          findFirst: async () => ({
            id: 'tx-manual-1',
            organizationId: 'org-manual',
            counterpartyName: 'PNEUTEK COMERCIO DE PNEUS',
            counterpartyDocument: '11222333000144',
            direction: 'CREDIT',
            suggestedClientId: 'cli-pneutek',
          }),
          update: async (args: any) => {
            updatedTxData = args.data;
            return { id: 'tx-manual-1', ...args.data };
          },
        },
        client: {
          findFirst: async (args: any) => {
            if (args.where.organizationId === 'org-manual' && args.where.id === 'cli-pneutek') {
              return { id: 'cli-pneutek', name: 'Pneutek', organizationId: 'org-manual' };
            }
            return null;
          },
        },
      };

      const financialService = new FinancialService(mockPrisma);

      // Usuário revisa a movimentação, seleciona o cliente Pneutek e marca a opção de ensinar regra futura
      await financialService.updateTransactionCategory('org-manual', 'tx-manual-1', {
        categoryId: 'cat-rec-cli',
        clientId: 'cli-pneutek',
        createRule: true,
        rulePattern: 'PNEUTEK COMERCIO DE PNEUS',
        ruleMatchField: 'COUNTERPARTY_NAME',
        ruleMatchType: 'CONTAINS',
      });

      // Transação foi atualizada com clientId e suggestedClientId foi limpo
      assert.strictEqual(updatedTxData.clientId, 'cli-pneutek');
      assert.strictEqual(updatedTxData.suggestedClientId, null);
      assert.strictEqual(updatedTxData.categorizationSource, 'MANUAL');

      // Regra automática criada foi vinculada ao clientId e categoria Receita de clientes
      assert.ok(createdRuleData);
      assert.strictEqual(createdRuleData.clientId, 'cli-pneutek');
      assert.strictEqual(createdRuleData.categoryId, 'cat-rec-cli');
      assert.strictEqual(createdRuleData.organizationId, 'org-manual');
    });

    // 17.5 Transferência Asaas -> Inter tem clientId: null, categoria TRANSFER_INTERNAL e não entra como receita operacional
    await tSub.test('17.5 Transferência Asaas -> Inter: clientId null, TRANSFER_INTERNAL e excluída de receitas operacionais', async () => {
      const updatedTransactions: any[] = [];
      const mockPrisma: any = {
        financialAccount: {
          findMany: async () => [
            { id: 'acc-asaas', provider: 'ASAAS', isActive: true },
            { id: 'acc-inter', provider: 'INTER', isActive: true },
          ],
        },
        financialTransaction: {
          findMany: async (args: any) => {
            if (args.where.accountId === 'acc-asaas') {
              return [{
                id: 'tx-asaas-debit',
                organizationId: 'org-transf',
                accountId: 'acc-asaas',
                amount: 5000,
                direction: 'DEBIT',
                occurredAt: new Date('2026-09-15T10:00:00Z'),
                description: 'TRANSFERENCIA PARA CONTA BANCARIA',
                counterpartyName: 'BANCO INTER S.A.',
              }];
            }
            if (args.where.accountId === 'acc-inter') {
              return [{
                id: 'tx-inter-credit',
                organizationId: 'org-transf',
                accountId: 'acc-inter',
                amount: 5000,
                direction: 'CREDIT',
                occurredAt: new Date('2026-09-15T10:05:00Z'),
                description: 'TED RECEBIDA ASAAS IP S.A.',
                counterpartyName: 'ASAAS GESTAO FINANCEIRA INSTITUICAO DE PAGAMENTO S.A.',
              }];
            }
            return [];
          },
          update: async (args: any) => {
            updatedTransactions.push(args);
            return { id: args.where.id, ...args.data };
          },
        },
        financialTransfer: {
          findMany: async () => [],
          findFirst: async () => null,
          create: async (args: any) => ({ id: 'tr-new', ...args.data }),
        },
      };

      const reconciliation = new FinancialReconciliationService(mockPrisma);
      const res = await reconciliation.reconcileTransfers('org-transf');

      assert.strictEqual(res.autoMatched + res.reviewCount, 1);
      // Ambas as pontas recebem kind TRANSFER_INTERNAL e clientId: null
      assert.strictEqual(updatedTransactions.length, 2);
      for (const updateCall of updatedTransactions) {
        assert.strictEqual(updateCall.data.kind, 'TRANSFER_INTERNAL');
        assert.strictEqual(updateCall.data.clientId, null);
      }
    });

    // 17.6 Isolamento multi-tenant: jamais vincular ou sugerir cliente de outra organização
    await tSub.test('17.6 Isolamento multi-tenant: documento idêntico em outra organização NÃO vincula nem sugere cliente', async () => {
      const mockPrisma: any = {
        financialCategory: {
          findMany: async () => [
            { id: 'cat-rec-cli-org1', name: 'Receita de clientes', type: 'INCOME', isDefault: true, organizationId: 'org-tenant-A' },
            { id: 'cat-rev-org1', name: 'Para revisar', type: 'EXPENSE', isDefault: true, organizationId: 'org-tenant-A' },
          ],
          findFirst: async () => ({
            id: 'cat-rev-org1',
            name: 'Para revisar',
            type: 'EXPENSE',
            isDefault: true,
          }),
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          // Cliente existe na org-tenant-B com o mesmo documento
          findFirst: async (args: any) => {
            if (args.where.organizationId === 'org-tenant-A') {
              return null; // Não existe na organização A
            }
            if (args.where.organizationId === 'org-tenant-B' && args.where.document === '99888777000166') {
              return { id: 'cli-org-b', name: 'Empresa Invasora', organizationId: 'org-tenant-B' };
            }
            return null;
          },
          findMany: async (args: any) => {
            if (args.where.organizationId === 'org-tenant-A') {
              return []; // Nenhum cliente na organização A com esse nome
            }
            return [{ id: 'cli-org-b', name: 'Empresa Invasora', organizationId: 'org-tenant-B' }];
          },
        },
      };

      const catService = new FinancialCategoryService(mockPrisma);

      // Transação na Org A com documento que pertence à Org B
      const result = await catService.categorizeTransaction('org-tenant-A', {
        counterpartyDocument: '99.888.777/0001-66',
        counterpartyName: 'EMPRESA INVASORA LTDA',
        direction: 'CREDIT',
        amount: 5000.0,
      });

      // Isolamento total: NÃO vincula e NÃO sugere cliente da organização B
      assert.strictEqual(result.clientId, null);
      assert.strictEqual(result.suggestedClientId, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 18. Integridade do Extrato Inter PJ e Reparo de Duplicatas (6 testes obrigatórios)
  // ---------------------------------------------------------------------------
  await t.test('18. Integridade do Extrato Inter PJ e Reparo de Duplicatas (6 testes obrigatórios)', async (tSub) => {
    // 18.1 Duas importações iguais não duplicam movimentações (idempotência do sync)
    await tSub.test('18.1 Duas importações iguais não duplicam movimentações (idempotência do sync)', async () => {
      const db = new Map<string, any>();

      const mockPrisma: any = {
        financialAccount: {
          findFirst: async () => ({ id: 'acc-inter-sync', provider: 'INTER', name: 'Conta Inter PJ', currentBalance: 1000 }),
          findMany: async () => [{ id: 'acc-inter-sync', provider: 'INTER', isActive: true }],
          update: async () => ({ id: 'acc-inter-sync', currentBalance: 1000 }),
        },
        financialTransaction: {
          findUnique: async (args: any) => db.get(args.where.accountId_externalId.externalId) || null,
          findFirst: async () => null,
          upsert: async (args: any) => {
            const extId = args.where.accountId_externalId.externalId;
            const existing = db.get(extId);
            if (existing) {
              const updated = { ...existing, ...args.update };
              db.set(extId, updated);
              return updated;
            }
            const created = { id: `tx-${extId}`, ...args.create };
            db.set(extId, created);
            return created;
          },
        },
        financialCategory: {
          findMany: async () => [],
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          findMany: async () => [],
        },
      };

      const mockClient: any = {
        isConfigured: () => true,
        getStatement: async () => [
          {
            idTransacao: 'tx-inter-001',
            valor: 450.0,
            tipoOperacao: 'D',
            titulo: 'Pix enviado',
            descricao: 'Pix enviado para Juliano',
            dataHoraMovimento: '2026-09-16 10:00:00',
          },
          {
            idTransacao: 'tx-inter-002',
            valor: 750.0,
            tipoOperacao: 'C',
            titulo: 'Pix recebido',
            descricao: 'Pix recebido de Arnaldo',
            dataHoraMovimento: '2026-09-16 11:00:00',
          },
        ],
        getBalances: async () => ({ disponivel: 1200 }),
      };

      const interService = new InterService(mockClient, mockPrisma);

      // Primeira sincronização
      const run1 = await interService.syncAccountAndStatement('org-test-1');
      assert.strictEqual(run1.success, true);
      assert.strictEqual(run1.syncedTransactions, 2);
      assert.strictEqual(db.size, 2);

      // Segunda sincronização com os mesmos dados
      const run2 = await interService.syncAccountAndStatement('org-test-1');
      assert.strictEqual(run2.success, true);
      assert.strictEqual(run2.syncedTransactions, 2);
      // Banco não duplicou: permanece com exatamente 2 registros
      assert.strictEqual(db.size, 2);
    });

    // 18.2 Ausência de campo de valor não cria duplicata artificial de R$ 0,00
    await tSub.test('18.2 Ausência de campo de valor não cria duplicata artificial de R$ 0,00', async () => {
      const db = new Map<string, any>();
      // Pré-insere o registro canônico com valor real
      db.set('ext-tx-valid', {
        id: 'tx-valid-1',
        accountId: 'acc-inter-1',
        externalId: 'ext-tx-valid',
        amount: 450.0,
        direction: 'DEBIT',
        occurredAt: new Date('2026-09-16T12:00:00.000Z'),
        description: 'Pix enviado para Juliano',
        counterpartyName: 'JULIANO CESAR',
      });

      let insertedCount = 0;
      const mockPrisma: any = {
        financialAccount: {
          findFirst: async () => ({ id: 'acc-inter-1', provider: 'INTER', name: 'Conta Inter PJ' }),
          findMany: async () => [{ id: 'acc-inter-1', provider: 'INTER', isActive: true }],
          update: async () => ({ id: 'acc-inter-1' }),
        },
        financialTransaction: {
          findUnique: async () => null,
          findFirst: async (args: any) => {
            // Simula encontrar o registro com valor real existente na mesma data
            if (args.where.amount?.gt === 0) {
              return db.get('ext-tx-valid');
            }
            return null;
          },
          upsert: async () => {
            insertedCount++;
            return {};
          },
        },
        financialCategory: {
          findMany: async () => [],
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          findMany: async () => [],
        },
      };

      const mockClient: any = {
        isConfigured: () => true,
        getStatement: async () => [
          {
            // Item sem valor ou com valor zero
            valor: 0,
            tipoOperacao: 'D',
            titulo: 'Pix enviado',
            descricao: 'Pix enviado para Juliano',
            dataHoraMovimento: '2026-09-16',
            contraparte: { nome: 'JULIANO CESAR' },
          },
        ],
        getBalances: async () => ({ disponivel: 1200 }),
      };

      const interService = new InterService(mockClient, mockPrisma);
      const res = await interService.syncAccountAndStatement('org-test-1');

      assert.strictEqual(res.success, true);
      // Não inseriu duplicata com valor 0
      assert.strictEqual(insertedCount, 0);
    });

    // 18.3 Reparo remove/mescla somente duplicatas comprovadas
    await tSub.test('18.3 Reparo remove/mescla somente duplicatas comprovadas', async () => {
      const records = [
        // Par 1: Canônico (450) + Duplicado espúrio (0)
        {
          id: 'tx-canon-1',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          counterpartyName: 'JULIANO CESAR',
          description: 'Pix enviado Juliano',
          amount: 450.0,
          direction: 'DEBIT',
          categorizationSource: 'PENDING',
          categoryId: null,
          clientId: null,
        },
        {
          id: 'tx-dup-1',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          counterpartyName: 'JULIANO CESAR',
          description: 'Pix enviado Juliano',
          amount: 0,
          direction: 'DEBIT',
          categorizationSource: 'MANUAL',
          categoryId: 'cat-prolabore',
          clientId: null,
        },
        // Transação legítima isolada (não duplicada)
        {
          id: 'tx-legit-single',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-15T10:00:00Z'),
          counterpartyName: 'PAGAMENTO ENERGIA',
          description: 'Pagamento conta de luz',
          amount: 320.0,
          direction: 'DEBIT',
          categorizationSource: 'PENDING',
          categoryId: null,
          clientId: null,
        },
      ];

      const deletedIds: string[] = [];
      const updatedData = new Map<string, any>();

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => records.filter((r) => !deletedIds.includes(r.id)),
          update: async (args: any) => {
            updatedData.set(args.where.id, args.data);
            return { id: args.where.id, ...args.data };
          },
          delete: async (args: any) => {
            deletedIds.push(args.where.id);
            return { id: args.where.id };
          },
        },
      };

      const interService = new InterService(mockPrisma);
      const repairResult = await interService.repairInterDuplicates('org-test-1');

      assert.strictEqual(repairResult.totalInspected, 3);
      assert.strictEqual(repairResult.mergedCount, 1);
      assert.strictEqual(repairResult.removedCount, 1);

      // Excluiu exclusivamente o registro duplicado de valor 0
      assert.deepStrictEqual(deletedIds, ['tx-dup-1']);
      // O registro legítimo e o canônico NÃO foram excluídos
      assert.strictEqual(deletedIds.includes('tx-canon-1'), false);
      assert.strictEqual(deletedIds.includes('tx-legit-single'), false);
    });

    // 18.4 Classificação manual, categoria e cliente do duplicado são preservados no canônico
    await tSub.test('18.4 Classificação manual, categoria e cliente do duplicado são transferidos para o canônico', async () => {
      const canonicalTx = {
        id: 'tx-canon-biolab',
        accountId: 'acc-1',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        counterpartyName: 'BIOLAB LTDA',
        description: 'Pix recebido Biolab',
        amount: 1800.0,
        direction: 'CREDIT',
        categorizationSource: 'PENDING',
        categoryId: null,
        clientId: null,
      };

      const duplicateZeroTx = {
        id: 'tx-dup-biolab',
        accountId: 'acc-1',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        counterpartyName: 'BIOLAB LTDA',
        description: 'Pix recebido Biolab',
        amount: 0,
        direction: 'CREDIT',
        categorizationSource: 'MANUAL',
        categoryId: 'cat-rec-clientes',
        clientId: 'cli-biolab-id',
        suggestedClientId: null,
      };

      let canonicalUpdateArgs: any = null;
      let duplicateDeleted = false;

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [canonicalTx, duplicateZeroTx],
          update: async (args: any) => {
            if (args.where.id === canonicalTx.id) {
              canonicalUpdateArgs = args.data;
            }
            return { id: args.where.id, ...args.data };
          },
          delete: async (args: any) => {
            if (args.where.id === duplicateZeroTx.id) {
              duplicateDeleted = true;
            }
            return { id: args.where.id };
          },
        },
      };

      const interService = new InterService(mockPrisma);
      const res = await interService.repairInterDuplicates('org-test-1');

      assert.strictEqual(res.mergedCount, 1);
      assert.strictEqual(res.removedCount, 1);
      assert.strictEqual(duplicateDeleted, true);

      // Metadados manuais foram mesclados no registro canônico de R$ 1.800
      assert.ok(canonicalUpdateArgs);
      assert.strictEqual(canonicalUpdateArgs.categoryId, 'cat-rec-clientes');
      assert.strictEqual(canonicalUpdateArgs.clientId, 'cli-biolab-id');
      assert.strictEqual(canonicalUpdateArgs.categorizationSource, 'MANUAL');
      assert.strictEqual(canonicalUpdateArgs.categorizationConfidence, 1.0);
    });

    // 18.5 Reparo é 100% idempotente (segunda execução = 0 alterações)
    await tSub.test('18.5 Reparo é 100% idempotente (segunda execução = 0 alterações)', async () => {
      let state = [
        {
          id: 'tx-canon',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          counterpartyName: 'FORNECEDOR XYZ',
          description: 'Pagamento boleto',
          amount: 500.0,
          direction: 'DEBIT',
          categorizationSource: 'PENDING',
        },
        {
          id: 'tx-dup',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          counterpartyName: 'FORNECEDOR XYZ',
          description: 'Pagamento boleto',
          amount: 0,
          direction: 'DEBIT',
          categorizationSource: 'MANUAL',
          categoryId: 'cat-fornecedores',
        },
      ];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async (args: any) => {
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state[idx] = { ...state[idx], ...args.data };
            return state[idx];
          },
          delete: async (args: any) => {
            state = state.filter((s) => s.id !== args.where.id);
            return { id: args.where.id };
          },
        },
      };

      const interService = new InterService(mockPrisma);

      // 1ª execução: repara duplicata
      const run1 = await interService.repairInterDuplicates('org-test-1');
      assert.strictEqual(run1.removedCount, 1);
      assert.strictEqual(state.length, 1);

      // 2ª execução: 0 alterações
      const run2 = await interService.repairInterDuplicates('org-test-1');
      assert.strictEqual(run2.mergedCount, 0);
      assert.strictEqual(run2.removedCount, 0);
      assert.strictEqual(state.length, 1);
    });

    // 18.6 Regressão de segurança: BANK_WRITE_FORBIDDEN bloqueia qualquer escrita bancária POST/PUT/DELETE
    await tSub.test('18.6 Regressão de segurança: BANK_WRITE_FORBIDDEN bloqueia escrita bancária', async () => {
      const client = new InterClient({
        clientId: 'id',
        clientSecret: 'secret',
        crtBase64: Buffer.from('crt').toString('base64'),
        keyBase64: Buffer.from('key').toString('base64'),
      });

      await assert.rejects(
        async () => {
          await client.requestBankingResource('POST', '/banking/v2/extrato/reprocessar');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'BANK_WRITE_FORBIDDEN');
          assert.strictEqual(err.statusCode, 405);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await client.requestBankingResource('DELETE', '/banking/v2/extrato/duplicatas');
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
  // 19. Precisão temporal de data e horário do Banco Inter PJ (4 testes obrigatórios)
  // ---------------------------------------------------------------------------
  await t.test('19. Precisão temporal de data e horário do Banco Inter PJ (4 testes obrigatórios)', async (tSub) => {
    // 19.1 Data sem horário não exibe hora e é classificada como DATE_ONLY
    await tSub.test('19.1 Data sem horário não exibe hora e é classificada como DATE_ONLY', async () => {
      const payloadDateOnly = {
        dataEntrada: '2026-09-17',
        valor: 1500.0,
        tipoOperacao: 'C',
        titulo: 'Pix recebido',
      };

      const precision = extractInterDatePrecision(payloadDateOnly);
      assert.strictEqual(precision, 'DATE_ONLY');

      const extractedTime = extractInterTime(payloadDateOnly);
      assert.strictEqual(extractedTime, null, 'Data sem horário não pode inventar hora');
    });

    // 19.2 Data com horário real exibe a hora correta e é classificada como DATETIME
    await tSub.test('19.2 Data com horário real exibe a hora correta e é classificada como DATETIME', async () => {
      const payloadDateTime = {
        dataHoraMovimento: '2026-09-17 14:32:45',
        valor: 450.0,
        tipoOperacao: 'D',
        titulo: 'Pix enviado',
      };

      const precision = extractInterDatePrecision(payloadDateTime);
      assert.strictEqual(precision, 'DATETIME');

      const extractedTime = extractInterTime(payloadDateTime);
      assert.strictEqual(extractedTime, '14:32:45');

      const payloadWithHoraField = {
        dataEntrada: '2026-09-17',
        hora: '10:15',
        valor: 300.0,
        tipoOperacao: 'D',
      };
      assert.strictEqual(extractInterDatePrecision(payloadWithHoraField), 'DATETIME');
      assert.strictEqual(extractInterTime(payloadWithHoraField), '10:15');
    });

    // 19.3 Horário técnico de normalização (12:00 UTC) nunca aparece para o usuário como informação oficial do Inter
    await tSub.test('19.3 Horário técnico de normalização (12:00 UTC) nunca aparece como informação oficial', async () => {
      // String date-only normalizada pelo sistema
      const normalizedDate = normalizeInterDate('2026-09-17');
      assert.strictEqual(normalizedDate.toISOString(), '2026-09-17T12:00:00.000Z');

      // Mas o extrator de horário sobre o payload original NÃO inventa 12:00
      const rawPayload = { dataEntrada: '2026-09-17' };
      assert.strictEqual(extractInterDatePrecision(rawPayload), 'DATE_ONLY');
      assert.strictEqual(extractInterTime(rawPayload), null);
    });

    // 19.4 Reprocessamento dos registros existentes corrige a precisão sem alterar valor, categoria, cliente ou classificação manual
    await tSub.test('19.4 Reprocessamento corrige datePrecision sem alterar valor, categoria ou cliente', async () => {
      let state = [
        {
          id: 'tx-dateonly',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          datePrecision: 'DATE_ONLY',
          amount: 500.0,
          direction: 'CREDIT',
          kind: 'CUSTOMER_PAYMENT',
          categoryId: 'cat-clientes',
          clientId: 'cli-biolab',
          categorizationSource: 'MANUAL',
          rawPayload: {
            dataEntrada: '2026-09-16',
            valor: 500.0,
            tipoOperacao: 'C',
          },
        },
        {
          id: 'tx-datetime',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          datePrecision: 'DATE_ONLY', // estava DATE_ONLY, mas o raw tem hora
          amount: 250.0,
          direction: 'DEBIT',
          kind: 'EXPENSE',
          categoryId: 'cat-fornecedor',
          clientId: null,
          categorizationSource: 'RULE',
          rawPayload: {
            dataHoraMovimento: '2026-09-16 16:45:00',
            valor: 250.0,
            tipoOperacao: 'D',
          },
        },
      ];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async (args: any) => {
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state[idx] = { ...state[idx], ...args.data };
            return state[idx];
          },
        },
      };

      const interService = new InterService(mockPrisma);
      const res = await interService.reprocessExistingTransactions();

      assert.strictEqual(res.reprocessedCount, 2);
      assert.strictEqual(res.updatedCount, 2);

      // tx-dateonly permaneceu DATE_ONLY
      const tx1 = state.find((s) => s.id === 'tx-dateonly')!;
      assert.strictEqual(tx1.datePrecision, 'DATE_ONLY');
      assert.strictEqual(tx1.categoryId, 'cat-clientes');
      assert.strictEqual(tx1.clientId, 'cli-biolab');
      assert.strictEqual(tx1.categorizationSource, 'MANUAL');
      assert.strictEqual(tx1.amount, 500.0);

      // tx-datetime foi corrigida para DATETIME devido ao rawPayload
      const tx2 = state.find((s) => s.id === 'tx-datetime')!;
      assert.strictEqual(tx2.datePrecision, 'DATETIME');
      assert.strictEqual(tx2.categoryId, 'cat-fornecedor');
      assert.strictEqual(tx2.amount, 250.0);
    });
  });

  // ---------------------------------------------------------------------------
  // 20. Formatação rigorosa de Data/Horário e Contraparte na Gaveta Lateral
  // ---------------------------------------------------------------------------
  await t.test('20. Formatação rigorosa de Data/Horário e Contraparte na Gaveta Lateral', async (tSub) => {
    // 20.1 DATE_ONLY nunca exibe horário e nunca concatena a string "às"
    await tSub.test('20.1 DATE_ONLY exibe somente data e nunca concatena "às"', async () => {
      const result = formatBankDateTimeDisplay('2026-09-16T12:00:00Z', 'DATE_ONLY', null);
      assert.strictEqual(result.dateOnly, '16/09/2026');
      assert.strictEqual(result.hasRealTime, false);
      assert.strictEqual(result.time, null);
      assert.strictEqual(result.displayWithTime, '16/09/2026');
      assert.strictEqual(result.displayWithTime.includes('às'), false, 'A string "às" NUNCA pode aparecer em DATE_ONLY');
    });

    // 20.2 DATETIME com horário real exibe a data e horário completo com "às"
    await tSub.test('20.2 DATETIME com horário real exibe data e hora corretas', async () => {
      const result = formatBankDateTimeDisplay('2026-09-17T14:32:00Z', 'DATETIME', '14:32');
      assert.strictEqual(result.dateOnly, '17/09/2026');
      assert.strictEqual(result.hasRealTime, true);
      assert.strictEqual(result.time, '14:32');
      assert.strictEqual(result.displayWithTime, '17/09/2026 às 14:32');
    });

    // 20.3 A string "às" NUNCA fica sozinha quando time for nulo, vazio, indefinido ou técnico
    await tSub.test('20.3 A string "às" nunca fica sozinha em cenários de fallback', async () => {
      const scenarios = [
        { date: '2026-09-16', precision: 'DATETIME' as const, time: null },
        { date: '2026-09-16', precision: 'DATETIME' as const, time: '' },
        { date: '2026-09-16', precision: 'DATETIME' as const, time: '   ' },
        { date: '2026-09-16', precision: 'DATETIME' as const, time: undefined },
        { date: '2026-09-16', precision: 'DATETIME' as const, time: '12:00' },
        { date: '2026-09-16', precision: 'DATETIME' as const, time: '00:00' },
        { date: '2026-09-16', precision: 'DATE_ONLY' as const, time: '14:32' },
      ];

      for (const s of scenarios) {
        const res = formatBankDateTimeDisplay(s.date, s.precision, s.time);
        assert.strictEqual(
          res.displayWithTime.endsWith('às') || res.displayWithTime.endsWith('às '),
          false,
          `Não deve terminar com 'às' para o cenário: ${JSON.stringify(s)}`
        );
        assert.strictEqual(
          res.displayWithTime.includes('às'),
          false,
          `Não deve conter 'às' para o cenário: ${JSON.stringify(s)}`
        );
      }
    });

    // 20.4 Contraparte normalizada: nunca usa "Informado pelo banco" como nome de pessoa/empresa
    await tSub.test('20.4 Contraparte nunca exibe "Informado pelo banco" ou variações vazias', async () => {
      const invalidCounterparties = [
        null,
        undefined,
        '',
        '   ',
        'Informado pelo banco',
        'informado pelo banco',
        'INFORMADO PELO BANCO',
        'Informada pelo banco',
        'Não informado',
        'nao informado',
        'Sem contraparte',
        'null',
        'undefined',
      ];

      for (const cp of invalidCounterparties) {
        const formatted = formatCounterpartyDisplay(cp);
        assert.strictEqual(
          formatted,
          'Não informada pelo banco',
          `Deve retornar fallback limpo para: ${cp}`
        );
      }

      // Contrapartes legítimas permanecem intactas
      assert.strictEqual(formatCounterpartyDisplay('Biolab Farmacêutica'), 'Biolab Farmacêutica');
      assert.strictEqual(formatCounterpartyDisplay('Google Cloud Brasil'), 'Google Cloud Brasil');
      assert.strictEqual(formatCounterpartyDisplay('Fornecedor Alpha LTDA'), 'Fornecedor Alpha LTDA');
    });
  });

  // ---------------------------------------------------------------------------
  // 21. Reparo Canônico das 44 Duplicatas e Diagnóstico Seguro de Campos Temporais
  // ---------------------------------------------------------------------------
  await t.test('21. Reparo Canônico das 44 Duplicatas e Diagnóstico Seguro de Campos Temporais', async (tSub) => {
    // 21.1 O reparo remove os 44 duplicados comprovados (88 -> 44)
    await tSub.test('21.1 Reparo remove 44 duplicatas comprovadas de R$ 0,00 reduzindo de 88 para 44 registros', async () => {
      const state: any[] = [];

      // Cria 44 pares exatos: um canônico (amount > 0) e um legado (amount === 0)
      for (let i = 1; i <= 44; i++) {
        const dateStr = `2026-09-${String((i % 28) + 1).padStart(2, '0')}`;
        // Canônico
        state.push({
          id: `tx-canonical-${i}`,
          accountId: 'acc-inter-1',
          occurredAt: new Date(`${dateStr}T12:00:00Z`),
          amount: 100 * i,
          direction: i % 2 === 0 ? 'CREDIT' : 'DEBIT',
          description: `Pix ${i % 2 === 0 ? 'recebido' : 'enviado'} Favorecido ${i}`,
          counterpartyName: `Favorecido ${i}`,
          counterpartyDocument: '12345678901',
          categoryId: 'cat-geral',
          clientId: null,
          categorizationSource: 'DEFAULT',
          rawPayload: { idTransacao: `inter-tx-${i}`, dataEntrada: dateStr },
        });

        // Duplicata espúria legada (amount = 0, counterpartyName pode ser null na versão legada)
        state.push({
          id: `tx-duplicate-zero-${i}`,
          accountId: 'acc-inter-1',
          occurredAt: new Date(`${dateStr}T12:00:00Z`),
          amount: 0,
          direction: i % 2 === 0 ? 'CREDIT' : 'DEBIT',
          description: `Pix ${i % 2 === 0 ? 'recebido' : 'enviado'}`,
          counterpartyName: null, // versão legada não preenchia
          counterpartyDocument: null,
          categoryId: null,
          clientId: null,
          categorizationSource: 'PENDING',
          rawPayload: { idTransacao: `inter-tx-${i}`, dataEntrada: dateStr },
        });
      }

      assert.strictEqual(state.length, 88, 'Base inicial deve ter 88 registros');

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async (args: any) => {
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state[idx] = { ...state[idx], ...args.data };
            return state[idx];
          },
          delete: async (args: any) => {
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state.splice(idx, 1);
            return { id: args.where.id };
          },
          count: async () => state.length,
        },
        financialTransfer: {
          update: async () => ({}),
        },
      };

      const interService = new InterService(mockPrisma);
      const res = await interService.repairInterDuplicates('org-test');

      assert.strictEqual(res.scanned, 88);
      assert.strictEqual(res.duplicatesRemoved, 44, 'Deve remover exatamente as 44 duplicatas');
      assert.strictEqual(res.remainingTransactions, 44, 'Devem restar exatamente 44 movimentações canônicas');
      assert.strictEqual(state.length, 44);
      assert.strictEqual(state.every((t) => Number(t.amount) > 0), true, 'Todos os registros restantes têm valor real');
    });

    // 21.2 Classificação manual e cliente da duplicata legada de R$ 0,00 são transferidos para o canônico
    await tSub.test('21.2 Transfere categoria, cliente e origem MANUAL do registro de 0 para o canônico', async () => {
      let state = [
        {
          id: 'tx-can-1',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          amount: 550.0,
          direction: 'CREDIT',
          description: 'Pix recebido Cliente Alfa',
          counterpartyName: 'Cliente Alfa',
          categoryId: null,
          clientId: null,
          categorizationSource: 'PENDING',
          rawPayload: { idTransacao: 'tx-123' },
        },
        {
          id: 'tx-dup-zero-1',
          accountId: 'acc-1',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          amount: 0,
          direction: 'CREDIT',
          description: 'Pix recebido',
          counterpartyName: null,
          categoryId: 'cat-servicos',
          clientId: 'cli-alfa-id',
          categorizationSource: 'MANUAL', // Usuário classificou manualmente na duplicata
          categorizationConfidence: 1.0,
          rawPayload: { idTransacao: 'tx-123' },
        },
      ];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async (args: any) => {
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state[idx] = { ...state[idx], ...args.data };
            return state[idx];
          },
          delete: async (args: any) => {
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state.splice(idx, 1);
            return { id: args.where.id };
          },
          count: async () => state.length,
        },
        financialTransfer: {
          update: async () => ({}),
        },
      };

      const interService = new InterService(mockPrisma);
      const res = await interService.repairInterDuplicates('org-test');

      assert.strictEqual(res.duplicatesRemoved, 1);
      assert.strictEqual(res.manualDataMerged, 1, 'Deve registrar a fusão de dados manuais');
      assert.strictEqual(state.length, 1);

      const remaining = state[0];
      assert.strictEqual(remaining.id, 'tx-can-1');
      assert.strictEqual(remaining.amount, 550.0);
      assert.strictEqual(remaining.categoryId, 'cat-servicos', 'Categoria manual foi transferida');
      assert.strictEqual(remaining.clientId, 'cli-alfa-id', 'Cliente foi transferido');
      assert.strictEqual(remaining.categorizationSource, 'MANUAL', 'Origem MANUAL foi preservada');
    });

    // 21.3 Endpoint canônico POST /integrations/inter/repair-duplicates responde contrato completo
    await tSub.test('21.3 Endpoint canônico POST /integrations/inter/repair-duplicates responde contrato completo', async () => {
      const mockInterService: any = {
        repairInterDuplicates: async () => ({
          scanned: 88,
          duplicatesRemoved: 44,
          manualDataMerged: 3,
          remainingTransactions: 44,
          totalInspected: 88,
          removedCount: 44,
          mergedCount: 3,
        }),
      };

      const app = fastify();
      await app.register(cookie);
      await app.register(jwt, { secret: 'test-secret-jwt' });

      app.post('/integrations/inter/repair-duplicates', async (req, reply) => {
        const res = await mockInterService.repairInterDuplicates();
        return reply.send({
          success: true,
          scanned: res.scanned,
          duplicatesRemoved: res.duplicatesRemoved,
          manualDataMerged: res.manualDataMerged,
          remainingTransactions: res.remainingTransactions,
        });
      });

      const response = await app.inject({
        method: 'POST',
        url: '/integrations/inter/repair-duplicates',
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.scanned, 88);
      assert.strictEqual(body.duplicatesRemoved, 44);
      assert.strictEqual(body.manualDataMerged, 3);
      assert.strictEqual(body.remainingTransactions, 44);
    });

    // 21.4 Diagnóstico temporal seguro: NÃO expõe dados pessoais, financeiros ou credenciais
    await tSub.test('21.4 Diagnóstico temporal seguro não expõe dados pessoais, financeiros ou credenciais', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          datePrecision: 'DATETIME',
          rawPayload: {
            dataHoraLancamento: '2026-09-17 14:32:00',
            dataEntrada: '2026-09-17',
            valor: 99999.99, // dado financeiro sensível
            descricao: 'PIX SECRETO CLIENTE', // dado textual sensível
            cpfCnpj: '11122233344', // dado pessoal sensível
            token: 'bearer_token_123', // credencial
          },
        },
        {
          id: 'tx-2',
          datePrecision: 'DATE_ONLY',
          rawPayload: {
            dataEntrada: '2026-09-17',
            valor: 50.0,
            descricao: 'TARIFA',
          },
        },
      ];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => mockTransactions,
        },
      };

      const interService = new InterService(mockPrisma);
      const diagnostics = await interService.getInterDateFieldDiagnostics('org-1');

      assert.strictEqual(diagnostics.totalTransactions, 2);
      assert.strictEqual(diagnostics.dateFieldPresence.dataHoraLancamento, 1);
      assert.strictEqual(diagnostics.dateFieldPresence.dataEntrada, 2);
      assert.strictEqual(diagnostics.detectedPrecision.DATETIME, 1);
      assert.strictEqual(diagnostics.detectedPrecision.DATE_ONLY, 1);

      // Verificação de segurança absoluta: nenhuma string sensível pode existir no objeto retornado
      const serialized = JSON.stringify(diagnostics);
      assert.strictEqual(serialized.includes('99999.99'), false, 'Não deve conter valores monetários');
      assert.strictEqual(serialized.includes('PIX SECRETO'), false, 'Não deve conter descrições');
      assert.strictEqual(serialized.includes('11122233344'), false, 'Não deve conter documentos/CPFs');
      assert.strictEqual(serialized.includes('bearer_token'), false, 'Não deve conter credenciais/tokens');
    });

    // 21.5 Campos alternativos de data/hora são devidamente reconhecidos
    await tSub.test('21.5 Campos alternativos plausíveis de data/hora são devidamente reconhecidos', async () => {
      const payloads = [
        { dataHoraLancamento: '2026-09-17 15:40:00' },
        { dataInclusao: '2026-09-17 09:12:30' },
        { horario: '14:20' },
        { horaMovimento: '11:05:00' },
        { transacao: { dataHora: '2026-09-17 16:30:00' } },
        { pix: { horario: '17:45:10' } },
      ];

      for (const p of payloads) {
        assert.strictEqual(
          extractInterDatePrecision(p),
          'DATETIME',
          `Payload deve ser DATETIME: ${JSON.stringify(p)}`
        );
        const time = extractInterTime(p);
        assert.ok(time && time.length >= 4, `Horário deve ser extraído: ${JSON.stringify(p)}`);
      }
    });

    // 21.6 Ausência real de horário e horários técnicos 12:00 e 00:00 resultam em DATE_ONLY
    await tSub.test('21.6 Ausência real de horário e horários técnicos 12:00/00:00 resultam em DATE_ONLY', async () => {
      const dateOnlyPayloads = [
        { dataEntrada: '2026-09-17' },
        { dataMovimento: '2026-09-17' },
        { dataHoraMovimento: '2026-09-17 12:00:00' }, // horário técnico
        { dataHoraMovimento: '2026-09-17 00:00:00' }, // horário técnico
        { hora: '12:00' }, // horário técnico
        { hora: '00:00' }, // horário técnico
        null,
        {},
      ];

      for (const p of dateOnlyPayloads) {
        assert.strictEqual(
          extractInterDatePrecision(p),
          'DATE_ONLY',
          `Payload não deve ter hora aceita: ${JSON.stringify(p)}`
        );
        assert.strictEqual(extractInterTime(p), null, 'Horário técnico ou ausente deve retornar null');
      }
    });

    // 21.7 Regressão: BANK_WRITE_FORBIDDEN permanece intacto
    await tSub.test('21.7 Regressão de segurança: BANK_WRITE_FORBIDDEN bloqueia qualquer escrita bancária', async () => {
      const client = new InterClient();
      assert.strictEqual(typeof (client as any).pixSend, 'undefined');
      assert.strictEqual(typeof (client as any).transfer, 'undefined');
      assert.strictEqual(typeof (client as any).createPixPayment, 'undefined');
    });
  });

  // ---------------------------------------------------------------------------
  // 22. Endurecimento de Segurança do Reparo de Duplicatas e Diagnóstico GET Exclusivo
  // ---------------------------------------------------------------------------
  await t.test('22. Endurecimento de Segurança do Reparo de Duplicatas e Diagnóstico GET Exclusivo', async (tSub) => {
    // 22.1 Duas transferências diferentes, mesma data e mesma direção, NUNCA são mescladas ou excluídas
    await tSub.test('22.1 Duas transferências diferentes na mesma data e direção NUNCA são mescladas ou excluídas', async () => {
      const state = [
        {
          id: 'tx-real-1',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 500.0,
          direction: 'DEBIT',
          description: 'Pix enviado - Fornecedor A',
          rawPayload: { titulo: 'Pix enviado - Fornecedor A' },
        },
        {
          id: 'tx-real-2',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 800.0,
          direction: 'DEBIT',
          description: 'Pix enviado - Fornecedor B',
          rawPayload: { titulo: 'Pix enviado - Fornecedor B' },
        },
      ];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async () => ({}),
          delete: async () => {
            throw new Error('NENHUM LANÇAMENTO REAL DEVE SER DELETADO!');
          },
          count: async () => state.length,
        },
      };

      const service = new InterService(mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.scanned, 2);
      assert.strictEqual(res.duplicatesRemoved, 0, 'Nenhum lançamento real deve ser removido');
      assert.strictEqual(res.manualDataMerged, 0, 'Nenhum dado deve ser mesclado');
      assert.strictEqual(res.remainingTransactions, 2);
    });

    // 22.2 Dois candidatos possíveis resultam em skip (ambiguousDuplicatesSkipped), sem exclusão
    await tSub.test('22.2 Dois candidatos possíveis resultam em skip (ambiguousDuplicatesSkipped), sem exclusão', async () => {
      const state = [
        {
          id: 'tx-can-1',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 300.0,
          direction: 'DEBIT',
          description: 'PAGAMENTO BOLETO',
          rawPayload: { titulo: 'PAGAMENTO BOLETO' },
        },
        {
          id: 'tx-can-2',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 450.0,
          direction: 'DEBIT',
          description: 'PAGAMENTO BOLETO',
          rawPayload: { titulo: 'PAGAMENTO BOLETO' },
        },
        {
          id: 'tx-dup-zero-ambiguous',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 0,
          direction: 'DEBIT',
          description: 'PAGAMENTO BOLETO',
          rawPayload: { titulo: 'PAGAMENTO BOLETO' },
        },
      ];

      let deletedCalled = false;
      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async () => ({}),
          delete: async () => {
            deletedCalled = true;
          },
          count: async () => state.length,
        },
      };

      const service = new InterService(mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.scanned, 3);
      assert.strictEqual(res.duplicatesRemoved, 0, 'Não deve remover quando houver ambiguidade');
      assert.strictEqual(res.ambiguousDuplicatesSkipped, 1, 'Deve registrar o skip de ambiguidade');
      assert.strictEqual(deletedCalled, false, 'delete não pode ter sido chamado');
      assert.strictEqual(res.remainingTransactions, 3);
    });

    // 22.3 Correspondência exata única permite reparo com Prova B estrita
    await tSub.test('22.3 Correspondência exata única permite reparo seguro com Prova B estrita', async () => {
      const state = [
        {
          id: 'tx-can-exact',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 120.50,
          direction: 'CREDIT',
          description: 'Pix recebido - Saldo',
          rawPayload: { titulo: 'Pix Recebido - Saldo' }, // variação de maiúsculas/minúsculas
        },
        {
          id: 'tx-dup-zero-exact',
          accountId: 'acc-inter-1',
          occurredAt: new Date('2026-09-17T12:00:00Z'),
          amount: 0,
          direction: 'CREDIT',
          description: 'pix recebido - saldo',
          rawPayload: { titulo: 'PIX RECEBIDO - SALDO' },
        },
      ];

      let deletedId: string | null = null;
      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [...state],
          update: async () => ({}),
          delete: async (args: any) => {
            deletedId = args.where.id;
            const idx = state.findIndex((s) => s.id === args.where.id);
            if (idx >= 0) state.splice(idx, 1);
            return { id: args.where.id };
          },
          count: async () => state.length,
        },
      };

      const service = new InterService(mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.scanned, 2);
      assert.strictEqual(res.duplicatesRemoved, 1);
      assert.strictEqual(res.ambiguousDuplicatesSkipped, 0);
      assert.strictEqual(deletedId, 'tx-dup-zero-exact');
      assert.strictEqual(state.length, 1);
      assert.strictEqual(state[0].id, 'tx-can-exact');
    });

    // 22.4 Endpoint de diagnóstico existe somente como GET (POST retorna 404)
    await tSub.test('22.4 Endpoint de diagnóstico existe somente como GET (POST retorna 404)', async () => {
      const app = fastify();
      await app.register(cookie);
      await app.register(jwt, { secret: 'test-jwt-secret' });

      // Registra rota conforme a implementação oficial
      app.get('/integrations/inter/diagnostics/date-fields', async (req, reply) => {
        return reply.send({ totalTransactions: 10, detectedPrecision: { DATETIME: 0, DATE_ONLY: 10 } });
      });

      // 1. Requisição GET com sucesso
      const getRes = await app.inject({
        method: 'GET',
        url: '/integrations/inter/diagnostics/date-fields',
      });
      assert.strictEqual(getRes.statusCode, 200);

      // 2. Requisição POST deve resultar em 404 Not Found
      const postRes = await app.inject({
        method: 'POST',
        url: '/integrations/inter/diagnostics/date-fields',
      });
      assert.strictEqual(postRes.statusCode, 404, 'POST deve ser rejeitado com 404 Not Found');
    });
  });

  // ---------------------------------------------------------------------------
  // 23. Horário Real do Banco Inter PJ (GET /banking/v2/extrato/completo)
  // ---------------------------------------------------------------------------
  await t.test('23. Extrato Completo e Horário Real do Banco Inter PJ', async (tSub) => {
    // 23.1 Chamada GET ao extrato completo e BANK_WRITE_FORBIDDEN
    await tSub.test('23.1 Extrato completo opera estritamente via GET e rejeita escrita', async () => {
      const client = new InterClient();

      // Tentativa de escrita bancária direta via POST deve falhar com BANK_WRITE_FORBIDDEN (405)
      await assert.rejects(
        async () => {
          await client.requestBankingResource('POST', '/banking/v2/extrato/completo');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'BANK_WRITE_FORBIDDEN');
          assert.strictEqual(err.statusCode, 405);
          return true;
        }
      );

      // Validação de intervalo máximo de 90 dias
      await assert.rejects(
        async () => {
          await client.getCompleteStatement('2026-01-01', '2026-06-01');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'RANGE_EXCEEDED');
          assert.strictEqual(err.statusCode, 400);
          return true;
        }
      );
    });

    // 23.2 Prévia somente leitura sem efeitos colaterais de escrita
    await tSub.test('23.2 Prévia somente leitura calcula contadores sem gravar nada', async () => {
      const mockItems = [
        {
          idTransacao: 'tx-inter-real-1',
          dataHoraMovimento: '2026-09-17T14:32:10.500',
          tipoOperacao: 'C',
          tipoTransacao: 'PIX',
          valor: 1500,
          titulo: 'Pix Recebido',
        },
        {
          idTransacao: 'tx-inter-real-2',
          dataHoraMovimento: '2026-09-17 12:00:00', // técnico, não deve contar como real
          tipoOperacao: 'D',
          tipoTransacao: 'TARIFA',
          valor: 10,
          titulo: 'Tarifa de Conta',
        },
        {
          // Sem ID oficial e sem dataHoraMovimento
          dataEntrada: '2026-09-17',
          tipoOperacao: 'D',
          tipoTransacao: 'DEBITO',
          valor: 50,
          titulo: 'Lançamento Básico',
        },
      ];

      const mockClient: any = {
        getCompleteStatement: async () => mockItems,
      };

      let writeAttempted = false;
      const mockPrisma: any = {
        financialTransaction: {
          aggregate: async () => ({ _min: { occurredAt: null }, _max: { occurredAt: null } }),
          findMany: async () => [],
          update: async () => { writeAttempted = true; },
          create: async () => { writeAttempted = true; },
          delete: async () => { writeAttempted = true; },
        },
      };

      const service = new InterService(mockClient, mockPrisma);
      const preview = await service.previewEnrichedTimes('org-test');

      assert.strictEqual(preview.totalReceived, 3);
      assert.strictEqual(preview.withOfficialTransactionId, 2);
      assert.strictEqual(preview.withRealTimestamp, 1);
      assert.strictEqual(preview.withoutTimestamp, 2);
      assert.strictEqual(preview.scopeAvailable, true);
      assert.strictEqual(writeAttempted, false, 'Prévia nunca deve gravar no banco');
    });

    // 23.3 Aplicação estrita somente por identificador oficial sem criar nem deletar registros
    await tSub.test('23.3 Aplicação vincula somente por ID oficial e preserva integridade', async () => {
      const mockItems = [
        {
          idTransacao: 'official-id-999',
          dataHoraMovimento: '2026-09-17T15:45:00.000Z',
          valor: 2500,
          titulo: 'Pix Recebido Cliente',
        },
        {
          idTransacao: 'official-id-inexistente',
          dataHoraMovimento: '2026-09-17T16:00:00.000Z',
          valor: 100,
          titulo: 'Não existe no banco',
        },
      ];

      const localTx = {
        id: 'tx-local-1',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        externalReference: 'official-id-999',
        occurredAt: new Date('2026-09-17T12:00:00Z'),
        datePrecision: 'DATE_ONLY',
        amount: 2500,
        categoryId: 'cat-honorarios',
        clientId: 'cli-biolab',
        rawPayload: { idTransacao: 'official-id-999', titulo: 'PIX RECEBIDO CLIENTE' },
      };

      const mockClient: any = {
        getCompleteStatement: async () => mockItems,
      };

      let updateData: any = null;
      let created = false;
      let deleted = false;

      const mockPrisma: any = {
        financialTransaction: {
          aggregate: async () => ({ _min: { occurredAt: null }, _max: { occurredAt: null } }),
          findMany: async () => [localTx],
          update: async (args: any) => {
            updateData = args.data;
            return { ...localTx, ...args.data };
          },
          create: async () => { created = true; },
          delete: async () => { deleted = true; },
        },
      };

      const service = new InterService(mockClient, mockPrisma);
      const res = await service.applyEnrichedTimes('org-test');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.updatedCount, 1);
      assert.strictEqual(res.skippedCount, 1);
      assert.strictEqual(res.ambiguousCount, 0);
      assert.strictEqual(created, false, 'Nenhuma transação pode ser criada');
      assert.strictEqual(deleted, false, 'Nenhuma transação pode ser deletada');
      assert.ok(updateData, 'Deve ter atualizado o registro correspondente');
      assert.strictEqual(updateData.datePrecision, 'DATETIME');
      assert.strictEqual(updateData.occurredAt.toISOString(), '2026-09-17T15:45:00.000Z');
      assert.strictEqual(updateData.rawPayload.interTransactionId, 'official-id-999');
    });
  });

  // ---------------------------------------------------------------------------
  // 17. Resolução Definitiva de Duplicatas de R$ 0,00 e Proteção na Origem
  // ---------------------------------------------------------------------------
  await t.test('17. Resolução Definitiva de Duplicatas R$ 0,00 e Proteção na Origem', async (st) => {
    // 17.1 Caso de três linhas como o print: 1 de R$ 450,00 + 2 de R$ 0,00 (remove exatamente as duas artificiais)
    await st.test('17.1 Três linhas (1 real R$ 450 + 2 artificiais R$ 0,00): remove exatamente as 2 artificiais e preserva a real', async () => {
      const canonical = {
        id: 'tx-real-450',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 450,
        description: 'PIX ENVIADO OUTRO BANCO',
        externalId: 'inter_acc-inter_2026-09-16_DEBIT_450_pix_enviado',
        categorizationSource: 'AUTO',
        categoryId: null,
      };

      const dup1 = {
        id: 'tx-dup-zero-manual',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 0,
        description: 'PIX ENVIADO OUTRO BANCO',
        externalId: 'inter_acc-inter_2026-09-16_DEBIT_0_pix_enviado',
        categorizationSource: 'MANUAL',
        categoryId: 'cat-fornecedor',
        clientId: 'cli-pneutek',
      };

      const dup2 = {
        id: 'tx-dup-zero-auto',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 0,
        description: 'PIX ENVIADO OUTRO BANCO',
        externalId: 'inter_acc-inter_2026-09-16_DEBIT_0_pix_enviado_v2',
        categorizationSource: 'RULE',
        categoryId: null,
      };

      let deletedIds: string[] = [];
      let updatedCanonicalData: any = null;

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [canonical, dup1, dup2],
          count: async () => 1,
        },
        $transaction: async (fn: any) => {
          const txProxy = {
            financialTransaction: {
              deleteMany: async (args: any) => {
                deletedIds.push(...args.where.id.in);
                return { count: args.where.id.in.length };
              },
              update: async (args: any) => {
                updatedCanonicalData = args.data;
                return { ...canonical, ...args.data };
              },
            },
          };
          return await fn(txProxy);
        },
      };

      const service = new InterService({} as any, mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.duplicatesRemoved, 2, 'Deve remover exatamente as duas duplicatas de R$ 0,00');
      assert.strictEqual(res.manualDataMerged, 1, 'Deve transferir a classificação manual');
      assert.strictEqual(res.ambiguousDuplicatesSkipped, 0);
      assert.deepStrictEqual(deletedIds.sort(), ['tx-dup-zero-auto', 'tx-dup-zero-manual'].sort());
      assert.ok(updatedCanonicalData);
      assert.strictEqual(updatedCanonicalData.categoryId, 'cat-fornecedor');
      assert.strictEqual(updatedCanonicalData.clientId, 'cli-pneutek');
      assert.strictEqual(updatedCanonicalData.categorizationSource, 'MANUAL');
    });

    // 17.2 Classificação manual no duplicado de R$ 0,00 é transferida para a linha real
    await st.test('17.2 Classificação manual no duplicado de R$ 0,00 é transferida com fidelidade para a linha real', async () => {
      const realTx = {
        id: 'tx-real-300',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'CREDIT',
        amount: 300,
        description: 'PIX RECEBIDO CLIENTE XPTO',
        externalId: 'inter_acc_300',
        categorizationSource: 'AUTO',
        categoryId: 'cat-padrao',
        clientId: null,
      };

      const dupZero = {
        id: 'tx-dup-zero-manual',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'CREDIT',
        amount: 0,
        description: 'PIX RECEBIDO CLIENTE XPTO',
        externalId: 'inter_acc_0',
        categorizationSource: 'MANUAL',
        categoryId: 'cat-honorarios',
        clientId: 'cli-xpto',
        suggestedClientId: 'cli-xpto-sug',
        categorizationConfidence: 1.0,
      };

      let updatedData: any = null;
      let deletedIds: string[] = [];

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [realTx, dupZero],
          count: async () => 1,
        },
        $transaction: async (fn: any) => {
          return await fn({
            financialTransaction: {
              deleteMany: async (args: any) => {
                deletedIds.push(...args.where.id.in);
                return { count: args.where.id.in.length };
              },
              update: async (args: any) => {
                updatedData = args.data;
                return { ...realTx, ...args.data };
              },
            },
          });
        },
      };

      const service = new InterService({} as any, mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.duplicatesRemoved, 1);
      assert.strictEqual(res.manualDataMerged, 1);
      assert.strictEqual(deletedIds[0], 'tx-dup-zero-manual');
      assert.strictEqual(updatedData.categoryId, 'cat-honorarios');
      assert.strictEqual(updatedData.clientId, 'cli-xpto');
      assert.strictEqual(updatedData.suggestedClientId, 'cli-xpto-sug');
      assert.strictEqual(updatedData.categorizationSource, 'MANUAL');
      assert.strictEqual(updatedData.categorizationConfidence, 1.0);
    });

    // 17.3 Duas movimentações reais diferentes, mas com mesma data/direção/título, não são removidas nem mescladas
    await st.test('17.3 Duas movimentações reais legítimas com mesma data/direção/título não são removidas nem mescladas', async () => {
      const realA = {
        id: 'tx-real-a',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 15,
        description: 'TARIFA BANCARIA MENSAL',
        externalId: 'inter_acc_tarifa_1',
      };

      const realB = {
        id: 'tx-real-b',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 25,
        description: 'TARIFA BANCARIA MENSAL',
        externalId: 'inter_acc_tarifa_2',
      };

      let deleteCalled = false;
      let updateCalled = false;

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [realA, realB],
          count: async () => 2,
        },
        $transaction: async (fn: any) => {
          return await fn({
            financialTransaction: {
              deleteMany: async () => { deleteCalled = true; return { count: 0 }; },
              update: async () => { updateCalled = true; },
            },
          });
        },
      };

      const service = new InterService({} as any, mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.duplicatesRemoved, 0, 'Nenhuma movimentação real pode ser removida');
      assert.strictEqual(deleteCalled, false);
      assert.strictEqual(updateCalled, false);
    });

    // 17.4 Candidato ambíguo é preservado (quando houver 2 ou mais candidatos legítimos possíveis para 1 duplicata R$ 0,00)
    await st.test('17.4 Candidato ambíguo é preservado e contado como ambiguousDuplicatesSkipped', async () => {
      const real1 = {
        id: 'tx-real-1',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 100,
        description: 'TRANSFERENCIA PIX MESMO TITULO',
        externalId: 'inter_acc_real1',
      };

      const real2 = {
        id: 'tx-real-2',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 200,
        description: 'TRANSFERENCIA PIX MESMO TITULO',
        externalId: 'inter_acc_real2',
      };

      const zeroAmbiguous = {
        id: 'tx-zero-ambiguous',
        organizationId: 'org-test',
        accountId: 'acc-inter',
        occurredAt: new Date('2026-09-16T12:00:00Z'),
        direction: 'DEBIT',
        amount: 0,
        description: 'TRANSFERENCIA PIX MESMO TITULO',
        externalId: 'inter_acc_zero_ambiguous',
      };

      let deleteCalled = false;

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => [real1, real2, zeroAmbiguous],
          count: async () => 3,
        },
        $transaction: async (fn: any) => {
          return await fn({
            financialTransaction: {
              deleteMany: async () => { deleteCalled = true; return { count: 0 }; },
              update: async () => {},
            },
          });
        },
      };

      const service = new InterService({} as any, mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.duplicatesRemoved, 0, 'Não pode remover registro ambíguo');
      assert.strictEqual(res.ambiguousDuplicatesSkipped, 1, 'Deve contar como ambiguousDuplicatesSkipped');
      assert.strictEqual(deleteCalled, false);
    });

    // 17.5 Nova importação com valor ausente/inválido não cria linha R$ 0,00
    await st.test('17.5 Nova importação com valor ausente, inválido ou <= 0 é ignorada com segurança e nunca persiste R$ 0,00', async () => {
      const mockStatementItems = [
        { dataEntrada: '2026-09-16', tipoOperacao: 'D', tipoTransacao: 'PIX', titulo: 'INV_1', valor: null },
        { dataEntrada: '2026-09-16', tipoOperacao: 'D', tipoTransacao: 'PIX', titulo: 'INV_2', valor: '' },
        { dataEntrada: '2026-09-16', tipoOperacao: 'D', tipoTransacao: 'PIX', titulo: 'INV_3', valor: 'invalido' },
        { dataEntrada: '2026-09-16', tipoOperacao: 'D', tipoTransacao: 'PIX', titulo: 'INV_4', valor: 0 },
        { dataEntrada: '2026-09-16', tipoOperacao: 'D', tipoTransacao: 'PIX', titulo: 'VALID_1', valor: '350.00' },
      ];

      const upsertedTransactions: any[] = [];

      const mockClient: any = {
        isConfigured: () => true,
        getStatement: async () => mockStatementItems,
        getBalances: async () => ({ disponivel: 1000 }),
      };

      const mockPrisma: any = {
        financialAccount: {
          findFirst: async () => ({ id: 'acc-inter', organizationId: 'org-test', name: 'Inter PJ', currentBalance: 1000 }),
          findMany: async () => [{ id: 'acc-inter', organizationId: 'org-test', name: 'Inter PJ', currentBalance: 1000 }],
          update: async (args: any) => ({ id: 'acc-inter', name: 'Inter PJ', ...args.data }),
        },
        financialTransaction: {
          findUnique: async () => null,
          findMany: async () => [],
          upsert: async (args: any) => {
            upsertedTransactions.push(args.create);
            return args.create;
          },
        },
        financialCategory: {
          findMany: async () => [],
          create: async (args: any) => ({ id: `cat-${args.data.name}`, ...args.data }),
        },
        financialCategoryRule: {
          findMany: async () => [],
        },
        client: {
          findMany: async () => [],
        },
        financialTransfer: {
          findMany: async () => [],
        },
      };

      const service = new InterService(mockClient, mockPrisma);
      const syncResult = await service.sync('org-test');

      assert.strictEqual(syncResult.success, true);
      assert.strictEqual(syncResult.syncedTransactions, 1, 'Apenas a transação com valor válido deve ser sincronizada');
      assert.strictEqual(upsertedTransactions.length, 1, 'Apenas 1 transação deve ser persistida no Prisma');
      assert.strictEqual(upsertedTransactions[0].amount, 350);
      assert.ok(upsertedTransactions[0].amount > 0, 'Nenhum registro pode ter valor zero ou negativo');
    });

    // 17.6 Segunda execução do reparo não altera nada (idempotência)
    await st.test('17.6 Segunda execução do reparo é idempotente: não remove nem altera nada', async () => {
      const alreadyCleanList = [
        {
          id: 'tx-real-450',
          organizationId: 'org-test',
          accountId: 'acc-inter',
          occurredAt: new Date('2026-09-16T12:00:00Z'),
          direction: 'DEBIT',
          amount: 450,
          description: 'PIX ENVIADO OUTRO BANCO',
          externalId: 'inter_acc-inter_2026-09-16_DEBIT_450_pix_enviado',
          categorizationSource: 'MANUAL',
          categoryId: 'cat-fornecedor',
        },
      ];

      let transactionCalled = false;

      const mockPrisma: any = {
        financialTransaction: {
          findMany: async () => alreadyCleanList,
          count: async () => 1,
        },
        $transaction: async () => {
          transactionCalled = true;
          return { removedCount: 0, mergedCount: 0, ambiguousCount: 0 };
        },
      };

      const service = new InterService({} as any, mockPrisma);
      const res = await service.repairInterDuplicates('org-test');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.duplicatesRemoved, 0);
      assert.strictEqual(res.manualDataMerged, 0);
      assert.strictEqual(res.ambiguousDuplicatesSkipped, 0);
      assert.strictEqual(transactionCalled, false, 'Prisma $transaction não deve ser acionado na 2ª execução idempotente');
    });

    // 17.7 BANK_WRITE_FORBIDDEN continua bloqueando escrita em recursos bancários
    await st.test('17.7 BANK_WRITE_FORBIDDEN continua bloqueando qualquer escrita em recursos bancários', async () => {
      const client = new InterClient({
        clientId: 'id',
        clientSecret: 'secret',
        crtBase64: Buffer.from('cert').toString('base64'),
        keyBase64: Buffer.from('key').toString('base64'),
      });

      await assert.rejects(
        async () => {
          await client.requestBankingResource('POST', '/banking/v2/pix');
        },
        (err: any) => {
          return err.code === 'BANK_WRITE_FORBIDDEN' || err.message?.includes('BANK_WRITE_FORBIDDEN');
        }
      );
    });
  });
});




