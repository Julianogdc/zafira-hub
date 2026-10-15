import test from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../app.js';
import { prisma } from '../../../../lib/prisma.js';
import { resolveBrightBeanApiUrl, isPublicationOrMetricsEnabled } from '../brightbean.config.js';
import { BrightBeanProvider, BrightBeanProviderError } from '../brightbean.provider.js';
import { BrightBeanIntegrationConnector } from '../brightbean.connector.js';
import {
  SocialPublisherService,
  SocialPublisherServiceError,
} from '../../social-publisher/social-publisher.service.js';
import { publicationDispatchEnabled } from '../../../content/publication/publication-dispatcher.js';
import { publicationMetricsEnabled } from '../../../content/publication/publication-metrics.collector.js';
import { resolveBrightBeanGateway, GatewayError } from '../../../content/publication/publication-gateway.js';
import { integrationConnectionService } from '../../connections/integration-connection.service.js';
import { validateStartupEnvironment, StartupValidationError } from '../../../../lib/startup-validator.js';

/**
 * HM-4b (DEC-HML-007, H6) — Modo Desconectado e Inicialização Resiliente do BrightBean.
 *
 * Garante que a API do Zafira Hub 2.1:
 *  1. Inicializa com segurança em NODE_ENV=production sem BRIGHTBEAN_API_URL, desde que publicação e métricas estejam desligadas;
 *  2. Não utiliza URLs falsas, localhost ou mocks como fallback em produção (Regra B);
 *  3. Preserva o startup-validator da HM-4a e falha fechado se publicação/métricas forem ativadas sem URL (Regra E);
 *  4. Rotas e operações que dependem do BrightBean retornam estados controlados (200 disconnected ou 503 BRIGHTBEAN_DISCONNECTED), NUNCA 500 inesperado (Regra D);
 *  5. Garante zero requisições HTTP para a internet no modo desconectado;
 *  6. Agendadores e despachantes permanecem estritamente desligados por padrão;
 *  7. Preserva o isolamento de organizações, regras de permissão e autenticação (Regra F);
 *  8. Configuração válida com URL preserva integralmente o comportamento anterior sem regressões.
 */

test('HM-4b.1: Resolução de URL no modo desconectado e fail-closed com publicação', () => {
  // A. Em produção com publicação desligada: retorna null (sem fallback para localhost ou URLs falsas)
  const prodDisconnected = resolveBrightBeanApiUrl({
    NODE_ENV: 'production',
    PUBLICATION_DISPATCH_ENABLED: 'false',
    PUBLICATION_METRICS_ENABLED: 'false',
    BRIGHTBEAN_API_URL: '',
  });
  assert.equal(prodDisconnected, null);

  const prodDefault = resolveBrightBeanApiUrl({
    NODE_ENV: 'production',
  });
  assert.equal(prodDefault, null);

  // B. Em produção com PUBLICATION_DISPATCH_ENABLED=true: falha fechado imediatamente
  assert.throws(
    () => resolveBrightBeanApiUrl({
      NODE_ENV: 'production',
      PUBLICATION_DISPATCH_ENABLED: 'true',
      BRIGHTBEAN_API_URL: '',
    }),
    (err: any) => {
      assert.match(err.message, /BRIGHTBEAN_API_URL é obrigatória em ambiente de produção/);
      return true;
    }
  );

  // C. Em produção com PUBLICATION_METRICS_ENABLED=true: falha fechado imediatamente
  assert.throws(
    () => resolveBrightBeanApiUrl({
      NODE_ENV: 'production',
      PUBLICATION_METRICS_ENABLED: 'true',
      BRIGHTBEAN_API_URL: '',
    }),
    (err: any) => {
      assert.match(err.message, /BRIGHTBEAN_API_URL é obrigatória em ambiente de produção/);
      return true;
    }
  );

  // D. Quando options.required=true: falha fechado em qualquer ambiente se ausente
  assert.throws(
    () => resolveBrightBeanApiUrl({ NODE_ENV: 'development' }, { required: true }),
    (err: any) => {
      assert.match(err.message, /BRIGHTBEAN_API_URL é obrigatória quando exigida/);
      return true;
    }
  );

  // E. Em ambiente de teste/dev sem required: localhost é permitido para testes locais
  const devUrl = resolveBrightBeanApiUrl({ NODE_ENV: 'development' });
  assert.equal(devUrl, 'http://localhost:8000/api/v1');

  // F. Configuração válida com URL retorna a URL informada
  const validUrl = resolveBrightBeanApiUrl({
    NODE_ENV: 'production',
    BRIGHTBEAN_API_URL: 'https://brightbean.staging.zafiramkt.internal/api/v1',
  });
  assert.equal(validUrl, 'https://brightbean.staging.zafiramkt.internal/api/v1');
});

test('HM-4b.2: BrightBeanProvider em modo desconectado — zero conexões externas', async () => {
  let externalNetworkAttempted = false;
  const spyFetch: typeof fetch = async () => {
    externalNetworkAttempted = true;
    throw new Error('VIOLAÇÃO: Nenhuma requisição de rede HTTP deve ser disparada no modo desconectado.');
  };

  const mockConnectionService: any = {
    getConnection: async () => ({ id: 'c1', provider: 'BRIGHTBEAN', status: 'ACTIVE', externalScopeId: 'w1' }),
    resolveCredential: async () => 'test-key',
  };

  // Instancia provedor em modo desconectado (apiBaseUrl: null)
  const disconnectedProvider = new BrightBeanProvider({
    connectionService: mockConnectionService,
    apiBaseUrl: null,
    fetchImpl: spyFetch,
  });

  assert.equal(disconnectedProvider.isConfigured(), false);

  // 1. getStatus no modo desconectado retorna connected=false sem consultar rede externa
  const status = await disconnectedProvider.getStatus({
    organizationId: 'org-test',
    workspaceId: 'w1',
  });
  assert.deepEqual(status, {
    connected: false,
    provider: 'BRIGHTBEAN',
    workspaceId: 'w1',
  });
  assert.equal(externalNetworkAttempted, false, 'Nenhuma chamada HTTP deve ter sido feita');

  // 2. Operações ativas falham fechadas com BRIGHTBEAN_DISCONNECTED (503), sem tocar a rede
  await assert.rejects(
    () => disconnectedProvider.listAccounts({ organizationId: 'org-test', connectionId: 'c1' }),
    (err: any) => {
      assert.equal(err instanceof BrightBeanProviderError, true);
      assert.equal(err.code, 'BRIGHTBEAN_DISCONNECTED');
      assert.equal(err.statusCode, 503);
      return true;
    }
  );

  await assert.rejects(
    () => disconnectedProvider.createPost(
      { organizationId: 'org-test', connectionId: 'c1' },
      { accountId: 'acc-1', format: 'FEED', content: 'teste' }
    ),
    (err: any) => {
      assert.equal(err instanceof BrightBeanProviderError, true);
      assert.equal(err.code, 'BRIGHTBEAN_DISCONNECTED');
      assert.equal(err.statusCode, 503);
      return true;
    }
  );

  assert.equal(externalNetworkAttempted, false, 'Rede externa permaneceu 100% isolada');
});

test('HM-4b.3: BrightBeanIntegrationConnector testConnection no modo desconectado', async () => {
  const mockProvider = new BrightBeanProvider({
    connectionService: {} as any,
    apiBaseUrl: null,
  });

  const mockPrisma: any = {
    integrationConnection: {
      findFirst: async () => ({
        id: 'conn-1',
        organizationId: 'org-1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-123',
      }),
      findMany: async () => [{
        id: 'conn-1',
        organizationId: 'org-1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-123',
      }],
    },
  };

  const connector = new BrightBeanIntegrationConnector(mockProvider, {} as any, mockPrisma);

  const res = await connector.testConnection({
    organizationId: 'org-1',
    connectionId: 'conn-1',
  });

  assert.equal(res.connected, false);
  assert.equal(res.provider, 'BRIGHTBEAN');
  assert.match(res.message, /modo desconectado/);
});

test('HM-4b.4: SocialPublisherService e rotas HTTP em modo desconectado retornam estados controlados sem 500', async () => {
  const mockProvider = new BrightBeanProvider({
    connectionService: {} as any,
    apiBaseUrl: null,
  });

  const mockPrisma: any = {
    integrationConnection: {
      findMany: async () => [{
        id: 'conn-1',
        organizationId: 'org-test-1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-test',
      }],
    },
  };

  const service = new SocialPublisherService(mockProvider, {} as any, mockPrisma);

  // 1. getStatus via service retorna connected=false sem erro
  const status = await service.getStatus('org-test-1');
  assert.deepEqual(status, {
    connected: false,
    provider: 'BRIGHTBEAN',
  });

  // 2. Chamadas que dependem de contas geram erro controlado 503 BRIGHTBEAN_DISCONNECTED
  await assert.rejects(
    () => service.getAvailableAccounts({ organizationId: 'org-test-1', membershipId: 'm1', role: 'ADMIN' }),
    (err: any) => {
      assert.equal(err instanceof SocialPublisherServiceError, true);
      assert.equal(err.code, 'BRIGHTBEAN_DISCONNECTED');
      assert.equal(err.statusCode, 503);
      return true;
    }
  );

  // 3. Validação nas rotas HTTP do Fastify com buildApp
  const app: FastifyInstance = buildApp({
    socialPublisherService: service,
  });
  await app.ready();

  const originalUserFindUnique = prisma.user.findUnique;
  const originalMemberFindUnique = prisma.organizationMember.findUnique;

  // Mock de autenticação e organização para o teste unitário isolado sem banco ativo
  (prisma as any).user.findUnique = (async () => ({
    id: 'user-admin',
    email: 'admin@zafira.test',
    status: 'ACTIVE',
    memberships: [
      {
        id: 'mem-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        organizationId: 'org-test-1',
        organization: { id: 'org-test-1', slug: 'zafira' },
      },
    ],
  })) as any;

  (prisma as any).organizationMember.findUnique = (async ({ where }: any) => {
    if (where.organizationId_userId?.organizationId === 'org-test-1') {
      return {
        id: 'mem-1',
        userId: 'user-admin',
        organizationId: 'org-test-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: [{ allowed: true }],
      };
    }
    return null;
  }) as any;

  try {
    const adminToken = (app as any).jwt.sign({
      sub: 'user-admin',
      email: 'admin@zafira.test',
      activeOrganizationId: 'org-test-1',
      role: 'ADMIN',
    });

    // Rota GET /api/v1/social/status retorna 200 com connected: false
    const resStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/social/status',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': 'org-test-1',
      },
    });
    assert.equal(resStatus.statusCode, 200);
    const bodyStatus = JSON.parse(resStatus.payload);
    assert.equal(bodyStatus.connected, false);
    assert.equal(bodyStatus.provider, 'BRIGHTBEAN');

    // Rota GET /api/v1/social/accounts/available retorna 503 controlado (SEM 500!)
    const resAccounts = await app.inject({
      method: 'GET',
      url: '/api/v1/social/accounts/available',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': 'org-test-1',
      },
    });
    assert.equal(resAccounts.statusCode, 503);
    const bodyAccounts = JSON.parse(resAccounts.payload);
    assert.equal(bodyAccounts.status, 'error');
    assert.equal(bodyAccounts.error, 'BRIGHTBEAN_DISCONNECTED');
    assert.match(bodyAccounts.message, /modo desconectado/);

    // Rota sem token deve falhar com 401 (Deny-by-default preservado)
    const resUnauth = await app.inject({
      method: 'GET',
      url: '/api/v1/social/status',
    });
    assert.equal(resUnauth.statusCode, 401);
  } finally {
    (prisma as any).user.findUnique = originalUserFindUnique;
    (prisma as any).organizationMember.findUnique = originalMemberFindUnique;
    await app.close();
  }
});

test('HM-4b.5: Inicialização da API e rotas de saúde em perfil de produção desconectado', async () => {
  // Valida que GET /health e GET /health/database respondem de forma consistente
  const app: FastifyInstance = buildApp();
  await app.ready();

  try {
    const resHealth = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.equal(resHealth.statusCode, 200);
    const bodyHealth = JSON.parse(resHealth.payload);
    assert.equal(bodyHealth.status, 'ok');

    // GET /health/database
    const resDb = await app.inject({
      method: 'GET',
      url: '/health/database',
    });
    assert.ok(resDb.statusCode === 200 || resDb.statusCode === 503, 'Retorna status de saúde controlado do banco');
    const bodyDb = JSON.parse(resDb.payload);
    assert.ok(bodyDb.database !== undefined);
  } finally {
    await app.close();
  }
});

test('HM-4b.6: Despachantes e coletores permanecem estritamente desligados por padrão', () => {
  const envDesconectada: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PUBLICATION_DISPATCH_ENABLED: 'false',
    PUBLICATION_METRICS_ENABLED: 'false',
    GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED: 'false',
    ASANA_MIRROR_SCHEDULE_ENABLED: 'false',
    N8N_DISPATCH_ENABLED: 'false',
  };

  assert.equal(publicationDispatchEnabled(envDesconectada), false);
  assert.equal(publicationMetricsEnabled(envDesconectada), false);
  assert.equal(isPublicationOrMetricsEnabled(envDesconectada), false);
});

test('HM-4b.7: Montagem de Gateway do BrightBean no despachante falha fechado se URL ausente', async () => {
  const originalFindMany = prisma.integrationConnection.findMany;
  const originalResolveCredential = integrationConnectionService.resolveCredential;

  (prisma as any).integrationConnection.findMany = (async () => [{ id: 'mock-conn-1' }]) as any;
  (integrationConnectionService as any).resolveCredential = async () => 'mock-api-key';

  // Garante que BRIGHTBEAN_API_URL está vazia para testar a recusa no despachante
  const previousUrl = process.env.BRIGHTBEAN_API_URL;
  delete process.env.BRIGHTBEAN_API_URL;

  try {
    await assert.rejects(
      () => resolveBrightBeanGateway('org-test'),
      (err: any) => {
        assert.match(err.message, /BRIGHTBEAN_API_URL é obrigatória/);
        return true;
      }
    );
  } finally {
    (prisma as any).integrationConnection.findMany = originalFindMany;
    (integrationConnectionService as any).resolveCredential = originalResolveCredential;
    if (previousUrl !== undefined) {
      process.env.BRIGHTBEAN_API_URL = previousUrl;
    }
  }
});

test('HM-4b.8: Validador de boot (HM-4a) preservado e aprovado com configuração desconectada segura', () => {
  const baseValidProductionEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app_user:c0mpl3x_R4nd0m_P4ssw0rd_987654321@db-host:5432/hub_staging?schema=public',
    JWT_SECRET: 'k9#mP2$vL5*nQ8@xZ1!wR4&yT7^bC0(uJ3)',
    COOKIE_SECRET: 'd8@fG2#hJ5*kL7!mN9^pQ1&rS3(tV6_wY0)',
    INTEGRATION_ENCRYPTION_KEY: 'e1a4c8f3b7d2e6a9f0c5b8d1e4a7f2c9e1a4c8f3b7d2e6a9f0c5b8d1e4a7f2c9',
    APPROVAL_MEDIA_SECRET: 'z3!xC5@vB7#nM9$lK1%jH3^gF5&dD7*sA9)',
    FILE_STORAGE_DRIVER: 's3',
    FILE_STORAGE_S3_BUCKET: 'zafira-hub-staging-bucket',
    FILE_STORAGE_S3_ACCESS_KEY_ID: 'AKIA_VALID_ACCESS_KEY_EXAMPLE_ID',
    FILE_STORAGE_S3_SECRET_ACCESS_KEY: 's3cr3t_4cc3ss_k3y_v4l1d_h1gh_3ntr0py',
    FILE_STORAGE_S3_ENDPOINT: 'https://staging-account.r2.cloudflarestorage.com',
    FILE_STORAGE_S3_REGION: 'auto',
    // Serviços desligados no cenário desconectado
    ASANA_MIRROR_SCHEDULE_ENABLED: 'false',
    GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED: 'false',
    N8N_DISPATCH_ENABLED: 'false',
    PUBLICATION_DISPATCH_ENABLED: 'false',
    PUBLICATION_METRICS_ENABLED: 'false',
    BRIGHTBEAN_API_URL: '', // Desconectado!
  };

  const result = validateStartupEnvironment({ env: baseValidProductionEnv });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);

  // Se PUBLICATION_DISPATCH_ENABLED=true for acionado sem BRIGHTBEAN_API_URL, falha fechado
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...baseValidProductionEnv,
        PUBLICATION_DISPATCH_ENABLED: 'true',
        BRIGHTBEAN_API_URL: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /PUBLICATION_DISPATCH_ENABLED está ativo mas BRIGHTBEAN_API_URL não está configurada/);
      return true;
    }
  );

  // Se PUBLICATION_METRICS_ENABLED=true for acionado sem BRIGHTBEAN_API_URL, falha fechado
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...baseValidProductionEnv,
        PUBLICATION_METRICS_ENABLED: 'true',
        BRIGHTBEAN_API_URL: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /PUBLICATION_METRICS_ENABLED está ativo mas BRIGHTBEAN_API_URL não está configurada/);
      return true;
    }
  );
});
