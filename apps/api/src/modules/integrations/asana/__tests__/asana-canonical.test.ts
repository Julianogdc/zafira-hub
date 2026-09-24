import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../app.js';
import { prisma } from '../../../../lib/prisma.js';
import { AsanaService, AsanaIntegrationError } from '../asana.service.js';
import { AsanaIntegrationConnector } from '../asana.connector.js';
import {
  encryptToken,
  decryptToken,
  encryptIntegrationCredential,
  decryptIntegrationCredential,
} from '../../../../lib/crypto.js';
import {
  sanitizeMetadata,
  sanitizeErrorMessage,
} from '../../common/integration-observability.service.js';

describe('Asana Canonical Integration & Hardened Lifecycle Suite (Passo 2C1.2 Real Tests)', () => {
  const testOrgId = 'org-asana-canonical-test-01';
  const otherOrgId = 'org-asana-canonical-test-02';
  const testUserId = 'user-admin-test-01';

  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.INTEGRATION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.ASANA_CLIENT_ID = 'mock-asana-client-id';
    process.env.ASANA_CLIENT_SECRET = 'mock-asana-client-secret';
    process.env.ASANA_REDIRECT_URI = 'https://app.test/oauth/callback';
    process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. DISCONNECT REAL — PRESERVAÇÃO DE CLIENTINTEGRATION E STATUS DISCONNECTED
  // =========================================================================
  describe('1. Disconnect Real (Cenários A e B)', () => {
    it('deve executar AsanaService.disconnect(), marcar IntegrationConnection como DISCONNECTED e PRESERVAR ClientIntegration', async () => {
      let clientIntegrationDeleteCount = 0;
      let remoteRevokeCalled = false;
      let connectionStatus: string | null = null;
      let legacyDeleted = false;

      // Mock de fetch para interceptar chamada de revogação remota no Asana
      globalThis.fetch = async (url: any) => {
        if (String(url).includes('oauth_revoke')) {
          remoteRevokeCalled = true;
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      };

      const canonicalConn = {
        id: 'conn-real-test-1',
        organizationId: testOrgId,
        provider: 'ASANA' as const,
        clientId: null,
        status: 'ACTIVE' as const,
        credentialCiphertext: encryptIntegrationCredential(
          JSON.stringify({
            accessToken: '1/synthetic-access-token-123',
            refreshToken: '1/synthetic-refresh-token-456',
          })
        ),
        externalScopeId: 'ws-123',
        displayName: 'Asana Test Workspace',
        metadata: {},
        lastValidatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindUniqueConn = prisma.integrationConnection.findUnique;
      const originalFindFirstConn = prisma.integrationConnection.findFirst;
      const originalUpdateConn = prisma.integrationConnection.update;
      const originalFindUniqueOrg = prisma.organizationIntegration.findUnique;
      const originalDeleteOrg = prisma.organizationIntegration.delete;
      const originalDeleteManyClient = prisma.clientIntegration.deleteMany;
      const originalFindManySubs = prisma.asanaWebhookSubscription.findMany;
      const originalDeleteManySubs = prisma.asanaWebhookSubscription.deleteMany;
      const originalCreateAudit = prisma.auditLog.create;
      const originalTransaction = prisma.$transaction;

      try {
        prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

        prisma.integrationConnection.findFirst = (async (args: any) => {
          if (args?.where?.organizationId === testOrgId) return canonicalConn;
          return null;
        }) as any;

        prisma.integrationConnection.findUnique = (async (args: any) => {
          if (args?.where?.id === canonicalConn.id) return canonicalConn;
          return null;
        }) as any;

        prisma.integrationConnection.update = (async (args: any) => {
          if (args?.where?.id === canonicalConn.id) {
            connectionStatus = args.data.status;
            return { ...canonicalConn, status: args.data.status };
          }
          return canonicalConn;
        }) as any;

        prisma.organizationIntegration.findUnique = (async () => ({
          id: 'org-int-legacy-1',
          organizationId: testOrgId,
          provider: 'ASANA',
          accessToken: encryptToken('legacy-token'),
        })) as any;

        prisma.organizationIntegration.delete = (async () => {
          legacyDeleted = true;
          return {};
        }) as any;

        // Se o disconnect tentar apagar ClientIntegration, este contador será incrementado
        prisma.clientIntegration.deleteMany = (async () => {
          clientIntegrationDeleteCount++;
          return { count: 1 };
        }) as any;

        prisma.asanaWebhookSubscription.findMany = (async () => []) as any;
        prisma.asanaWebhookSubscription.deleteMany = (async () => ({ count: 1 })) as any;
        prisma.auditLog.create = (async (args: any) => ({ id: 'audit-1', ...args.data })) as any;

        const service = new AsanaService();
        await service.disconnect(testOrgId);

        // Validações obrigatórias
        assert.strictEqual(connectionStatus, 'DISCONNECTED', 'IntegrationConnection deve estar DISCONNECTED');
        assert.strictEqual(clientIntegrationDeleteCount, 0, 'ClientIntegration NÃO pode ser apagado no disconnect');
        assert.strictEqual(remoteRevokeCalled, true, 'Token deve ter sido revogado remotamente');
        assert.strictEqual(legacyDeleted, true, 'Legado residual deve ter sido removido na desconexão');
      } finally {
        prisma.integrationConnection.findUnique = originalFindUniqueConn;
        prisma.integrationConnection.findFirst = originalFindFirstConn;
        prisma.integrationConnection.update = originalUpdateConn;
        prisma.organizationIntegration.findUnique = originalFindUniqueOrg;
        prisma.organizationIntegration.delete = originalDeleteOrg;
        prisma.clientIntegration.deleteMany = originalDeleteManyClient;
        prisma.asanaWebhookSubscription.findMany = originalFindManySubs;
        prisma.asanaWebhookSubscription.deleteMany = originalDeleteManySubs;
        prisma.auditLog.create = originalCreateAudit;
        prisma.$transaction = originalTransaction;
      }
    });
  });

  // =========================================================================
  // 2. PRECEDÊNCIA CANÔNICA: DISCONNECTED E ERROR NÃO PODEM RESSUSCITAR
  // =========================================================================
  describe('2. Precedência e Bloqueio de Ressuscitação (Cenários C, D e E)', () => {
    it('C. getValidToken() com IntegrationConnection DISCONNECTED deve falhar e NUNCA consultar legado', async () => {
      let legacyConsulted = false;

      const originalFindFirst = prisma.integrationConnection.findFirst;
      const originalFindUniqueLegacy = prisma.organizationIntegration.findUnique;

      try {
        prisma.integrationConnection.findFirst = (async () => ({
          id: 'conn-disc-1',
          organizationId: testOrgId,
          provider: 'ASANA',
          status: 'DISCONNECTED',
        })) as any;

        prisma.organizationIntegration.findUnique = (async () => {
          legacyConsulted = true;
          return { id: 'legacy-1', accessToken: encryptToken('legacy-token') };
        }) as any;

        const service = new AsanaService();

        await assert.rejects(
          async () => {
            await service.getValidToken(testOrgId);
          },
          (err: any) => {
            assert.ok(err instanceof AsanaIntegrationError);
            assert.strictEqual(err.statusCode, 400);
            assert.ok(err.message.includes('desconectada'));
            return true;
          }
        );

        assert.strictEqual(legacyConsulted, false, 'OrganizationIntegration legado NÃO pode ser consultado quando DISCONNECTED');
      } finally {
        prisma.integrationConnection.findFirst = originalFindFirst;
        prisma.organizationIntegration.findUnique = originalFindUniqueLegacy;
      }
    });

    it('D. getValidToken() com IntegrationConnection ERROR deve falhar e NUNCA consultar legado', async () => {
      let legacyConsulted = false;

      const originalFindFirst = prisma.integrationConnection.findFirst;
      const originalFindUniqueLegacy = prisma.organizationIntegration.findUnique;

      try {
        prisma.integrationConnection.findFirst = (async () => ({
          id: 'conn-err-1',
          organizationId: testOrgId,
          provider: 'ASANA',
          status: 'ERROR',
        })) as any;

        prisma.organizationIntegration.findUnique = (async () => {
          legacyConsulted = true;
          return { id: 'legacy-1', accessToken: encryptToken('legacy-token') };
        }) as any;

        const service = new AsanaService();

        await assert.rejects(
          async () => {
            await service.getValidToken(testOrgId);
          },
          (err: any) => {
            assert.ok(err instanceof AsanaIntegrationError);
            assert.strictEqual(err.statusCode, 400);
            assert.ok(err.message.includes('estado de erro'));
            return true;
          }
        );

        assert.strictEqual(legacyConsulted, false, 'OrganizationIntegration legado NÃO pode ser consultado quando ERROR');
      } finally {
        prisma.integrationConnection.findFirst = originalFindFirst;
        prisma.organizationIntegration.findUnique = originalFindUniqueLegacy;
      }
    });

    it('E. getValidToken() com IntegrationConnection ACTIVE prevalece sobre legado residual e retorna token canônico', async () => {
      const canonicalToken = '1/canonical-active-token-12345';
      const legacyToken = '1/legacy-residual-token-99999';

      const originalFindFirst = prisma.integrationConnection.findFirst;
      const originalDeleteManyOrg = prisma.organizationIntegration.deleteMany;

      try {
        prisma.integrationConnection.findFirst = (async () => ({
          id: 'conn-active-1',
          organizationId: testOrgId,
          provider: 'ASANA',
          status: 'ACTIVE',
          credentialCiphertext: encryptIntegrationCredential(JSON.stringify({ accessToken: canonicalToken })),
          externalScopeId: 'ws-canonical-1',
        })) as any;

        prisma.organizationIntegration.deleteMany = (async () => ({ count: 1 })) as any;

        const service = new AsanaService();
        const res = await service.getValidToken(testOrgId);

        assert.strictEqual(res.token, canonicalToken, 'Deve retornar o token canônico ACTIVE');
        assert.notStrictEqual(res.token, legacyToken, 'Nunca deve retornar token legado');
        assert.strictEqual(res.source, 'organization');
        assert.strictEqual(res.workspaceId, 'ws-canonical-1');
      } finally {
        prisma.integrationConnection.findFirst = originalFindFirst;
        prisma.organizationIntegration.deleteMany = originalDeleteManyOrg;
      }
    });
  });

  // =========================================================================
  // 3. MIGRAÇÃO ATÔMICA TRANSACIONAL (CENÁRIOS F E G)
  // =========================================================================
  describe('3. Migração Transacional Legacy -> Canônica (Cenários F e G)', () => {
    it('F. migrateLegacyOrganizationIntegration deve criar canônica ACTIVE e deletar legado na mesma transação', async () => {
      const legacyPlainToken = '1/legacy-migration-token-777';
      const legacyEncToken = encryptToken(legacyPlainToken);

      let createdConn: any = null;
      let deletedLegacyId: string | null = null;

      const originalTransaction = prisma.$transaction;

      try {
        prisma.$transaction = (async (callback: any) => {
          const fakeTx = {
            integrationConnection: {
              findFirst: async () => null,
              create: async (args: any) => {
                createdConn = { id: 'conn-migrated-1', ...args.data };
                return createdConn;
              },
            },
            organizationIntegration: {
              findUnique: async () => ({
                id: 'legacy-id-777',
                organizationId: testOrgId,
                provider: 'ASANA',
                accessToken: legacyEncToken,
                refreshToken: null,
                workspaceId: 'ws-legacy-777',
                metadata: { userName: 'Legacy User' },
              }),
              delete: async (args: any) => {
                deletedLegacyId = args.where.id;
                return {};
              },
            },
          };
          return callback(fakeTx);
        }) as any;

        const service = new AsanaService();
        const res = await service.migrateLegacyOrganizationIntegration(testOrgId);

        assert.strictEqual(res.migrated, true);
        assert.strictEqual(res.token, legacyPlainToken);
        assert.ok(createdConn);
        assert.strictEqual(createdConn.organizationId, testOrgId);
        assert.strictEqual(createdConn.provider, 'ASANA');
        assert.strictEqual(createdConn.status, 'ACTIVE');
        assert.strictEqual(deletedLegacyId, 'legacy-id-777');

        // Confirma que a credencial criada é descriptografável
        const decrypted = decryptIntegrationCredential(createdConn.credentialCiphertext);
        const parsed = JSON.parse(decrypted);
        assert.strictEqual(parsed.accessToken, legacyPlainToken);
      } finally {
        prisma.$transaction = originalTransaction;
      }
    });

    it('G. Falha durante criação canônica deve fazer rollback e preservar registro legado', async () => {
      let legacyDeleted = false;
      const originalTransaction = prisma.$transaction;

      try {
        prisma.$transaction = (async (callback: any) => {
          const fakeTx = {
            integrationConnection: {
              findFirst: async () => null,
              create: async () => {
                throw new Error('Falha intencional de persistência canônica para testar rollback');
              },
            },
            organizationIntegration: {
              findUnique: async () => ({
                id: 'legacy-id-999',
                organizationId: testOrgId,
                provider: 'ASANA',
                accessToken: encryptToken('legacy-secret'),
              }),
              delete: async () => {
                legacyDeleted = true;
                return {};
              },
            },
          };
          return callback(fakeTx);
        }) as any;

        const service = new AsanaService();

        await assert.rejects(
          async () => {
            await service.migrateLegacyOrganizationIntegration(testOrgId);
          },
          /Falha intencional de persistência canônica/
        );

        assert.strictEqual(legacyDeleted, false, 'Legado NÃO pode ter sido deletado em caso de erro na criação canônica');
      } finally {
        prisma.$transaction = originalTransaction;
      }
    });
  });

  // =========================================================================
  // 4. REFRESH TOKEN CANÔNICO (CENÁRIO H)
  // =========================================================================
  describe('4. Refresh de Token Canônico (Cenário H)', () => {
    it('H. refreshToken deve atualizar exclusivamente IntegrationConnection e falhar com 404 se não existir', async () => {
      let updatedConnectionData: any = null;
      let legacyWriteAttempted = false;

      globalThis.fetch = async (url: any) => {
        if (String(url).includes('oauth_token')) {
          return new Response(
            JSON.stringify({
              access_token: '1/new-access-token-refreshed',
              refresh_token: '1/new-refresh-token-refreshed',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200 });
      };

      const originalFindUniqueConn = prisma.integrationConnection.findUnique;
      const originalFindFirstConn = prisma.integrationConnection.findFirst;
      const originalUpdateConn = prisma.integrationConnection.update;
      const originalCreateConn = prisma.integrationConnection.create;
      const originalUpdateOrg = prisma.organizationIntegration.update;
      const originalTransaction = prisma.$transaction;
      const originalAudit = prisma.auditLog.create;

      try {
        prisma.$transaction = (async (fn: any) => fn(prisma)) as any;
        prisma.auditLog.create = (async () => ({ id: 'audit-1' })) as any;

        prisma.integrationConnection.findUnique = (async (args: any) => {
          if (args.where.id === 'conn-valid-1') {
            return {
              id: 'conn-valid-1',
              organizationId: testOrgId,
              provider: 'ASANA',
              displayName: 'Asana Refresh Test',
              externalScopeId: 'ws-ref-1',
              metadata: {},
            };
          }
          return null;
        }) as any;

        prisma.integrationConnection.findFirst = (async (args: any) => {
          if (args.where.organizationId === testOrgId) {
            return {
              id: 'conn-valid-1',
              organizationId: testOrgId,
              provider: 'ASANA',
              status: 'ACTIVE',
            };
          }
          return null;
        }) as any;

        prisma.integrationConnection.update = (async (args: any) => {
          updatedConnectionData = args;
          return { id: 'conn-valid-1', ...args.data };
        }) as any;

        prisma.integrationConnection.create = (async (args: any) => {
          updatedConnectionData = args;
          return { id: 'conn-valid-1', ...args.data };
        }) as any;

        prisma.organizationIntegration.update = (async () => {
          legacyWriteAttempted = true;
          return {};
        }) as any;

        const service = new AsanaService();

        // 1. Refresh bem-sucedido na conexão canônica
        const res = await (service as any).refreshToken('conn-valid-1', 'mock-old-refresh-token');
        assert.strictEqual(res.accessToken, '1/new-access-token-refreshed');
        assert.ok(updatedConnectionData);
        assert.strictEqual(legacyWriteAttempted, false, 'OrganizationIntegration não pode ser escrito em refresh');

        // 2. Conexão inexistente => 404 explícito
        await assert.rejects(
          async () => {
            await (service as any).refreshToken('conn-inexistente-999', 'mock-old-refresh-token');
          },
          (err: any) => {
            assert.ok(err instanceof AsanaIntegrationError);
            assert.strictEqual(err.statusCode, 404);
            return true;
          }
        );
      } finally {
        prisma.integrationConnection.findUnique = originalFindUniqueConn;
        prisma.integrationConnection.findFirst = originalFindFirstConn;
        prisma.integrationConnection.update = originalUpdateConn;
        prisma.integrationConnection.create = originalCreateConn;
        prisma.organizationIntegration.update = originalUpdateOrg;
        prisma.$transaction = originalTransaction;
        prisma.auditLog.create = originalAudit;
      }
    });
  });

  // =========================================================================
  // 5. RECONNECT REAL (CENÁRIOS I, J E K)
  // =========================================================================
  describe('5. Reconnect Connector & Rota HTTP (Cenários I, J e K)', () => {
    it('I & J. AsanaIntegrationConnector.reconnect deve criar OAuthState e gerar authUrl oficial com scopes e state', async () => {
      let persistedOAuthState: any = null;

      const mockPrisma = {
        oAuthState: {
          create: async (args: any) => {
            persistedOAuthState = args.data;
            return { id: 'state-id-1', ...args.data };
          },
          deleteMany: async () => ({ count: 0 }),
        },
      };

      const connector = new AsanaIntegrationConnector(undefined, undefined, mockPrisma as any);
      const caps = connector.getCapabilities();
      assert.strictEqual(caps.canReconnect, true, 'canReconnect deve ser true');

      const res = await connector.reconnect({
        organizationId: testOrgId,
        userId: testUserId,
      });

      assert.strictEqual(res.reconnected, true);
      assert.ok(res.authUrl);
      assert.ok(res.authUrl.startsWith('https://app.asana.com/-/oauth_authorize'));
      assert.ok(res.authUrl.includes('client_id=mock-asana-client-id'));
      assert.ok(res.authUrl.includes('response_type=code'));
      assert.ok(res.authUrl.includes('scope='));

      // Valida o state persistido
      assert.ok(persistedOAuthState);
      assert.strictEqual(persistedOAuthState.organizationId, testOrgId);
      assert.strictEqual(persistedOAuthState.userId, testUserId);
      assert.strictEqual(persistedOAuthState.provider, 'ASANA');
    });

    it('K. Rota HTTP POST /api/v1/integrations/ASANA/reconnect deve isolar o tenant da sessão autenticada', async () => {
      const app: FastifyInstance = buildApp();
      await app.ready();

      let createdStateOrgId: string | null = null;

      const originalUserFindUnique = prisma.user.findUnique;
      const originalMemberFindUnique = prisma.organizationMember.findUnique;
      const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;
      const originalStateCreate = prisma.oAuthState.create;
      const originalStateDeleteMany = prisma.oAuthState.deleteMany;

      try {
        prisma.user.findUnique = (async () => ({
          id: testUserId,
          email: 'admin@zafira.com',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem-test-1',
              role: 'ADMIN',
              status: 'ACTIVE',
              organization: { id: testOrgId, slug: 'test-org' },
            },
          ],
        })) as any;

        prisma.organizationMember.findUnique = (async () => ({
          id: 'mem-test-1',
          organizationId: testOrgId,
          userId: testUserId,
          role: 'ADMIN',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [{ permissionCode: 'deliverables.plan', allowed: true }],
        })) as any;

        (prisma as any).rolePermission.findUnique = (async () => ({
          role: 'ADMIN',
          permissionCode: 'deliverables.plan',
        })) as any;

        prisma.oAuthState.deleteMany = (async () => ({ count: 0 })) as any;

        prisma.oAuthState.create = (async (args: any) => {
          createdStateOrgId = args.data.organizationId;
          return { id: 'state-1', ...args.data };
        }) as any;

        const token = (app as any).jwt.sign({
          sub: testUserId,
          email: 'admin@zafira.com',
          activeOrganizationId: testOrgId,
        });

        // Tenta enviar body malicioso querendo forçar outra organização
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/integrations/ASANA/reconnect',
          headers: {
            authorization: `Bearer ${token}`,
          },
          payload: {
            organizationId: 'ORG_MALICIOSA_999',
          },
        });

        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.status, 'ok');
        assert.ok(body.data?.authUrl);

        // O OAuthState gerado DEVE pertencer estritamente à organização autenticada (testOrgId)
        assert.strictEqual(createdStateOrgId, testOrgId, 'Tenant do OAuthState deve vir da sessão autenticada');
        assert.notStrictEqual(createdStateOrgId, 'ORG_MALICIOSA_999');
      } finally {
        prisma.user.findUnique = originalUserFindUnique;
        prisma.organizationMember.findUnique = originalMemberFindUnique;
        (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
        prisma.oAuthState.create = originalStateCreate;
        prisma.oAuthState.deleteMany = originalStateDeleteMany;
        await app.close();
      }
    });
  });

  // =========================================================================
  // 6. WEBHOOKS REAIS — DEDUPLICAÇÃO, MULTI-TENANT E SEGURANÇA (CENÁRIOS L A Q)
  // =========================================================================
  describe('6. Webhooks Reais (Cenários L, M, N, O, P e Q)', () => {
    it('L & O. Webhook válido deve criar WebhookEvent com status PROCESSED e tenant isolation da subscription', async () => {
      const app: FastifyInstance = buildApp();
      await app.ready();

      const webhookSecretPlain = 'mock-webhook-hmac-secret-12345';
      const encryptedSecret = encryptToken(webhookSecretPlain);
      const subId = 'sub-test-valid-01';

      let createdWebhookEvent: any = null;
      let updatedStatus: string | null = null;

      const originalSubFindUnique = prisma.asanaWebhookSubscription.findUnique;
      const originalSubUpdate = prisma.asanaWebhookSubscription.update;
      const originalEventFindUnique = prisma.webhookEvent.findUnique;
      const originalEventCreate = prisma.webhookEvent.create;
      const originalEventUpdate = prisma.webhookEvent.update;

      try {
        prisma.asanaWebhookSubscription.findUnique = (async (args: any) => {
          if (args.where.id === subId) {
            return {
              id: subId,
              organizationId: testOrgId,
              resourceGid: 'proj-123',
              secret: encryptedSecret,
              active: true,
            };
          }
          return null;
        }) as any;

        prisma.asanaWebhookSubscription.update = (async () => ({})) as any;
        prisma.webhookEvent.findUnique = (async () => null) as any;

        prisma.webhookEvent.create = (async (args: any) => {
          createdWebhookEvent = { id: 'ev-1', ...args.data };
          return createdWebhookEvent;
        }) as any;

        prisma.webhookEvent.update = (async (args: any) => {
          updatedStatus = args.data.status;
          return { id: args.where.id, ...args.data };
        }) as any;

        const payloadObj = {
          organizationId: otherOrgId, // tentativa de injeção maliciosa no body
          events: [{ action: 'changed', resource: { gid: 'task-101' } }],
        };
        const rawBody = JSON.stringify(payloadObj);
        const signature = crypto.createHmac('sha256', webhookSecretPlain).update(rawBody).digest('hex');

        const res = await app.inject({
          method: 'POST',
          url: `/integrations/asana/webhooks/${subId}`,
          headers: {
            'content-type': 'application/json',
            'x-hook-signature': signature,
          },
          payload: rawBody,
        });

        assert.strictEqual(res.statusCode, 200);
        assert.ok(createdWebhookEvent);
        assert.strictEqual(createdWebhookEvent.provider, 'ASANA');
        assert.strictEqual(createdWebhookEvent.organizationId, testOrgId, 'Tenant DEVE vir da subscription, rejeitando o body');
        assert.strictEqual(createdWebhookEvent.eventType, 'asana.webhook');

        const expectedHash = crypto.createHash('sha256').update(rawBody).digest('hex');
        assert.strictEqual(createdWebhookEvent.dedupeKey, `ASANA:${subId}:${expectedHash}`);
        assert.strictEqual(updatedStatus, 'PROCESSED');
      } finally {
        prisma.asanaWebhookSubscription.findUnique = originalSubFindUnique;
        prisma.asanaWebhookSubscription.update = originalSubUpdate;
        prisma.webhookEvent.findUnique = originalEventFindUnique;
        prisma.webhookEvent.create = originalEventCreate;
        prisma.webhookEvent.update = originalEventUpdate;
        await app.close();
      }
    });

    it('M. Webhook duplicado deve retornar deduplicated=true e não reprocessar', async () => {
      const app: FastifyInstance = buildApp();
      await app.ready();

      const webhookSecretPlain = 'mock-webhook-hmac-secret-12345';
      const subId = 'sub-test-dedupe-01';
      const rawBody = JSON.stringify({ events: [{ action: 'changed', resource: { gid: 'task-102' } }] });
      const rawHash = crypto.createHash('sha256').update(rawBody).digest('hex');
      const dedupeKey = `ASANA:${subId}:${rawHash}`;

      let updateStatusCalls = 0;

      const originalSubFindUnique = prisma.asanaWebhookSubscription.findUnique;
      const originalSubUpdate = prisma.asanaWebhookSubscription.update;
      const originalEventFindUnique = prisma.webhookEvent.findUnique;
      const originalEventUpdate = prisma.webhookEvent.update;

      try {
        prisma.asanaWebhookSubscription.findUnique = (async () => ({
          id: subId,
          organizationId: testOrgId,
          secret: encryptToken(webhookSecretPlain),
          active: true,
        })) as any;

        prisma.asanaWebhookSubscription.update = (async () => ({})) as any;

        // Simula que o evento já foi registrado anteriormente
        prisma.webhookEvent.findUnique = (async (args: any) => {
          if (args.where.dedupeKey === dedupeKey) {
            return {
              id: 'ev-existing-1',
              dedupeKey,
              organizationId: testOrgId,
              status: 'PROCESSED',
            };
          }
          return null;
        }) as any;

        prisma.webhookEvent.update = (async () => {
          updateStatusCalls++;
          return {};
        }) as any;

        const signature = crypto.createHmac('sha256', webhookSecretPlain).update(rawBody).digest('hex');

        const res = await app.inject({
          method: 'POST',
          url: `/integrations/asana/webhooks/${subId}`,
          headers: {
            'content-type': 'application/json',
            'x-hook-signature': signature,
          },
          payload: rawBody,
        });

        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.deduplicated, true);
        assert.strictEqual(updateStatusCalls, 0, 'Não deve atualizar ou reprocessar evento duplicado');
      } finally {
        prisma.asanaWebhookSubscription.findUnique = originalSubFindUnique;
        prisma.asanaWebhookSubscription.update = originalSubUpdate;
        prisma.webhookEvent.findUnique = originalEventFindUnique;
        prisma.webhookEvent.update = originalEventUpdate;
        await app.close();
      }
    });

    it('N. Assinatura inválida (HMAC errado) deve retornar 401 e não criar WebhookEvent', async () => {
      const app: FastifyInstance = buildApp();
      await app.ready();

      const subId = 'sub-test-invalid-sig';
      let eventCreated = false;

      const originalSubFindUnique = prisma.asanaWebhookSubscription.findUnique;
      const originalEventCreate = prisma.webhookEvent.create;

      try {
        prisma.asanaWebhookSubscription.findUnique = (async () => ({
          id: subId,
          organizationId: testOrgId,
          secret: encryptToken('correct-secret'),
          active: true,
        })) as any;

        prisma.webhookEvent.create = (async () => {
          eventCreated = true;
          return {};
        }) as any;

        const res = await app.inject({
          method: 'POST',
          url: `/integrations/asana/webhooks/${subId}`,
          headers: {
            'content-type': 'application/json',
            'x-hook-signature': 'assinatura_invalida_forjada',
          },
          payload: JSON.stringify({ events: [] }),
        });

        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(eventCreated, false, 'Nenhum WebhookEvent pode ser criado com assinatura inválida');
      } finally {
        prisma.asanaWebhookSubscription.findUnique = originalSubFindUnique;
        prisma.webhookEvent.create = originalEventCreate;
        await app.close();
      }
    });

    it('P. Webhook com payload contendo segredos deve sanitizar campo para [REDACTED] sem persistir plaintext', async () => {
      const app: FastifyInstance = buildApp();
      await app.ready();

      const webhookSecretPlain = 'secret-test-sanitization-123';
      const subId = 'sub-test-sanitize-01';
      const secretTokenValue = 'raw-super-secret-token-abcdef12345';

      let persistedPayload: any = null;

      const originalSubFindUnique = prisma.asanaWebhookSubscription.findUnique;
      const originalSubUpdate = prisma.asanaWebhookSubscription.update;
      const originalEventFindUnique = prisma.webhookEvent.findUnique;
      const originalEventCreate = prisma.webhookEvent.create;
      const originalEventUpdate = prisma.webhookEvent.update;

      try {
        prisma.asanaWebhookSubscription.findUnique = (async () => ({
          id: subId,
          organizationId: testOrgId,
          secret: encryptToken(webhookSecretPlain),
          active: true,
        })) as any;

        prisma.asanaWebhookSubscription.update = (async () => ({})) as any;
        prisma.webhookEvent.findUnique = (async () => null) as any;

        prisma.webhookEvent.create = (async (args: any) => {
          persistedPayload = args.data.payload;
          return { id: 'ev-sanitized-1', ...args.data };
        }) as any;

        prisma.webhookEvent.update = (async () => ({})) as any;

        const payloadObj = {
          token: secretTokenValue,
          client_secret: 'secret-to-redact-999',
          events: [{ action: 'changed', resource: { gid: 'task-sensitive-1' } }],
        };

        const rawBody = JSON.stringify(payloadObj);
        const signature = crypto.createHmac('sha256', webhookSecretPlain).update(rawBody).digest('hex');

        const res = await app.inject({
          method: 'POST',
          url: `/integrations/asana/webhooks/${subId}`,
          headers: {
            'content-type': 'application/json',
            'x-hook-signature': signature,
          },
          payload: rawBody,
        });

        assert.strictEqual(res.statusCode, 200);
        assert.ok(persistedPayload);
        assert.strictEqual(persistedPayload.token, '[REDACTED]', 'Token deve ser redactado');
        assert.strictEqual(persistedPayload.client_secret, '[REDACTED]', 'client_secret deve ser redactado');

        // Prova cabal de que o plaintext secreto NÃO está presente em nenhuma parte do payload persistido
        const stringifiedPersisted = JSON.stringify(persistedPayload);
        assert.ok(!stringifiedPersisted.includes(secretTokenValue), 'Plaintext secreto NÃO pode aparecer no banco');
      } finally {
        prisma.asanaWebhookSubscription.findUnique = originalSubFindUnique;
        prisma.asanaWebhookSubscription.update = originalSubUpdate;
        prisma.webhookEvent.findUnique = originalEventFindUnique;
        prisma.webhookEvent.create = originalEventCreate;
        prisma.webhookEvent.update = originalEventUpdate;
        await app.close();
      }
    });

    it('Q. errorMessage de WebhookEvent deve sanitizar tokens/segredos de exceções', () => {
      const rawErrorMsg = 'Falha de conexão com Asana: Bearer 1/secret-bearer-token-12345 no endpoint /projects';
      const sanitized = sanitizeErrorMessage(rawErrorMsg);

      assert.ok(sanitized);
      assert.ok(!sanitized.includes('1/secret-bearer-token-12345'));
      assert.ok(sanitized.includes('Bearer [REDACTED]'));

      const rawSecretParam = 'Erro no webhook x-hook-secret=my-hook-secret-9999 falhou';
      const sanitizedHook = sanitizeErrorMessage(rawSecretParam);
      assert.ok(sanitizedHook);
      assert.ok(!sanitizedHook.includes('my-hook-secret-9999'));
      assert.ok(sanitizedHook.includes('x-hook-secret=[REDACTED]'));
    });
  });
});
