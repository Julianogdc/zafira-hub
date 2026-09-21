import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { ObservabilityService } from '../observability.service.js';
import { getFastifyLoggerConfig, LOGGER_REDACTION_PATHS } from '../logger-config.js';

test('Módulo de Observabilidade, Métricas, Correlation ID e Healthchecks', async (t) => {
  const previousApiKey = process.env.HUB_INTERNAL_API_KEY;
  const testApiKey = 'zafira-internal-machine-metric-key-secret-123';
  process.env.HUB_INTERNAL_API_KEY = testApiKey;

  const obsService = new ObservabilityService();
  const app: FastifyInstance = buildApp({ observabilityService: obsService });
  await app.ready();

  const originalQueryRaw = prisma.$queryRaw;
  const originalFindUniqueUser = prisma.user.findUnique;

  t.after(async () => {
    process.env.HUB_INTERNAL_API_KEY = previousApiKey;
    prisma.$queryRaw = originalQueryRaw;
    prisma.user.findUnique = originalFindUniqueUser;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  await t.test('1. Correlation ID (x-request-id) em requisições de sucesso e erro', async () => {
    // 1.1 Requisição bem-sucedida em /health
    const res1 = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.strictEqual(res1.statusCode, 200);
    const reqId1 = res1.headers['x-request-id'];
    assert.ok(reqId1, 'x-request-id deve estar presente');
    assert.ok(typeof reqId1 === 'string' && reqId1.length > 0, 'x-request-id não pode ser vazio');

    // 1.2 Segunda requisição com ID distinto
    const res2 = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.strictEqual(res2.statusCode, 200);
    const reqId2 = res2.headers['x-request-id'];
    assert.ok(reqId2, 'x-request-id deve estar presente na segunda requisição');
    assert.notStrictEqual(reqId1, reqId2, 'IDs de requisição devem ser únicos por requisição');

    // 1.3 Requisição com erro 404
    const res404 = await app.inject({
      method: 'GET',
      url: '/rota-inexistente-404',
    });
    assert.strictEqual(res404.statusCode, 404);
    assert.ok(res404.headers['x-request-id'], 'x-request-id deve estar presente em respostas 404');
  });

  await t.test('2. Autenticação Machine-Only no endpoint /metrics', async () => {
    // 2.1 Sem credencial => 401
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    assert.strictEqual(resNoAuth.statusCode, 401);

    // 2.2 API Key inválida => 401
    const resBadKey = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: {
        'x-api-key': 'chave-completamente-incorreta',
      },
    });
    assert.strictEqual(resBadKey.statusCode, 401);

    // 2.3 JWT Humano => 403 MACHINE_CREDENTIAL_REQUIRED
    (prisma.user.findUnique as any) = async () => ({
      id: 'usr_human_tester',
      email: 'human@zafira.test',
      status: 'ACTIVE',
      memberships: [
        {
          organizationId: 'org_test',
          role: 'ADMIN',
          status: 'ACTIVE',
          organization: { id: 'org_test', slug: 'org-test' },
        },
      ],
    });

    const humanToken = createToken({
      sub: 'usr_human_tester',
      email: 'human@zafira.test',
      activeOrganizationId: 'org_test',
    });

    const resHuman = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: {
        authorization: `Bearer ${humanToken}`,
      },
    });
    assert.strictEqual(resHuman.statusCode, 403);
    const humanBody = JSON.parse(resHuman.body);
    assert.strictEqual(humanBody.code, 'MACHINE_CREDENTIAL_REQUIRED');

    // 2.4 API Key válida => 200 OK
    const resOk = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: {
        'x-api-key': testApiKey,
      },
    });
    assert.strictEqual(resOk.statusCode, 200);
    assert.ok(resOk.headers['content-type']?.includes('text/plain'), 'Content-Type deve ser Prometheus text format');
  });

  await t.test('3. Conteúdo das Métricas Prometheus e Proteção de Segredos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: {
        'x-api-key': testApiKey,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.body;

    // Métricas HTTP
    assert.ok(body.includes('zafira_http_requests_total'), 'Deve conter zafira_http_requests_total');
    assert.ok(body.includes('zafira_http_request_duration_seconds'), 'Deve conter zafira_http_request_duration_seconds');

    // Métricas de Processo
    assert.ok(
      body.includes('process_cpu_') || body.includes('process_resident_memory_bytes') || body.includes('nodejs_'),
      'Deve conter métricas default de processo'
    );

    // Proteção de Segredos
    assert.ok(!body.includes(testApiKey), 'A API key secreta NÃO deve aparecer nas métricas');
    assert.ok(!body.includes('password'), 'Senhas não devem aparecer nas métricas');
  });

  await t.test('4. Route Template no HTTP Counter/Histogram (prevenção de cardinalidade infinita)', async () => {
    // Faz uma requisição para rota com path parameter
    const fakeClientId = '123e4567-e89b-12d3-a456-426614174000';
    await app.inject({
      method: 'GET',
      url: `/clients/${fakeClientId}`,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: {
        'x-api-key': testApiKey,
      },
    });

    const body = res.body;
    // Deve conter o template /clients/:id
    assert.ok(
      body.includes('route="/clients/:id"'),
      'Métrica HTTP deve registrar o template da rota Fastify e não o ID dinâmico'
    );
    // NÃO deve conter o ID dinâmico como valor de label de rota
    assert.ok(
      !body.includes(`route="/clients/${fakeClientId}"`),
      'Métrica HTTP não deve conter o ID dinâmico como label de rota'
    );
  });

  await t.test('5. Database Health e métricas correspondentes', async () => {
    // 5.1 Sucesso
    (prisma.$queryRaw as any) = async () => [{ '?column?': 1 }];

    const resOk = await app.inject({
      method: 'GET',
      url: '/health/database',
    });
    assert.strictEqual(resOk.statusCode, 200);
    const bodyOk = JSON.parse(resOk.body);
    assert.strictEqual(bodyOk.status, 'ok');
    assert.strictEqual(bodyOk.database, 'connected');

    const metricsAfterOk = await obsService.getMetrics();
    assert.ok(metricsAfterOk.includes('zafira_database_health 1'), 'zafira_database_health deve ser 1 após sucesso');
    assert.ok(
      metricsAfterOk.includes('zafira_database_healthcheck_duration_seconds'),
      'Histograma de duração do banco deve receber observação'
    );

    // 5.2 Falha
    (prisma.$queryRaw as any) = async () => {
      throw new Error('PostgreSQL connection timeout');
    };

    const resFail = await app.inject({
      method: 'GET',
      url: '/health/database',
    });
    assert.strictEqual(resFail.statusCode, 503);
    const bodyFail = JSON.parse(resFail.body);
    assert.strictEqual(bodyFail.status, 'error');
    assert.strictEqual(bodyFail.database, 'disconnected');

    const metricsAfterFail = await obsService.getMetrics();
    assert.ok(metricsAfterFail.includes('zafira_database_health 0'), 'zafira_database_health deve ser 0 após falha');
  });

  await t.test('6. Logger Config e Redaction de Segredos', async () => {
    // 6.1 getFastifyLoggerConfig
    const testConfig = getFastifyLoggerConfig({ nodeEnv: 'test' });
    assert.strictEqual(testConfig, false);

    const prodConfig: any = getFastifyLoggerConfig({ nodeEnv: 'production', logLevel: 'warn' });
    assert.strictEqual(prodConfig.level, 'warn');
    assert.ok(Array.isArray(prodConfig.redact?.paths));
    assert.strictEqual(prodConfig.redact?.censor, '[REDACTED]');

    // 6.2 Redaction paths obrigatórios
    assert.ok(LOGGER_REDACTION_PATHS.includes('req.headers.authorization'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('req.headers.cookie'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('req.headers["x-api-key"]'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('res.headers["set-cookie"]'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('password'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('token'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('apiKey'));
    assert.ok(LOGGER_REDACTION_PATHS.includes('secret'));
  });
});
