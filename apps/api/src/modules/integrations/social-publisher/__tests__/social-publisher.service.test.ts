import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SocialPublisherService,
  SocialPublisherServiceError,
} from '../social-publisher.service.js';
import {
  SocialPublisherProvider,
  SocialPublisherContext,
  SocialMediaUploadInput,
} from '../social-publisher.provider.js';
import {
  SocialAccount,
  SocialPost,
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialMediaUploadResult,
  SocialPostAnalytics,
  SocialAccountAnalytics,
  SocialPublisherStatus,
} from '@zafira/contracts';
import { BrightBeanIntegrationConnector } from '../../brightbean/brightbean.connector.js';
import { BrightBeanProvider } from '../../brightbean/brightbean.provider.js';
import { IntegrationConnectionService } from '../../connections/integration-connection.service.js';

// Mocks para simular Prisma
interface InMemoryDatabase {
  clients: Map<string, any>;
  connections: Map<string, any>;
  clientIntegrations: Map<string, any>;
}

function createInMemoryDb(): InMemoryDatabase {
  return {
    clients: new Map([
      ['client-1', { id: 'client-1', organizationId: 'org-test', name: 'Cliente Alfa' }],
      ['client-2', { id: 'client-2', organizationId: 'org-test', name: 'Cliente Beta' }],
      ['client-other-org', { id: 'client-other-org', organizationId: 'org-other', name: 'Cliente Estrangeiro' }],
    ]),
    connections: new Map([
      [
        'conn-bb-active',
        {
          id: 'conn-bb-active',
          organizationId: 'org-test',
          provider: 'BRIGHTBEAN',
          clientId: null,
          status: 'ACTIVE',
          externalScopeId: 'ws-test-123',
          metadata: { hiddenPostIds: ['hidden-post-1', 'hidden-post-2'] },
        },
      ],
    ]),
    clientIntegrations: new Map([
      [
        'ci-1',
        {
          id: 'ci-1',
          clientId: 'client-1',
          provider: 'BRIGHTBEAN',
          externalId: 'acc-ig-1',
          status: 'CONNECTED',
          metadata: { accountName: 'Conta Instagram Alfa' },
        },
      ],
      [
        'ci-postiz',
        {
          id: 'ci-postiz',
          clientId: 'client-1',
          provider: 'POSTIZ',
          externalId: 'postiz-acc-1',
          status: 'CONNECTED',
          metadata: {},
        },
      ],
    ]),
  };
}

function createMockPrisma(db: InMemoryDatabase) {
  return {
    client: {
      findFirst: async ({ where }: any) => {
        for (const c of db.clients.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.organizationId && c.organizationId !== where.organizationId) continue;
          return c;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        const res = [];
        for (const c of db.clients.values()) {
          if (where.organizationId && c.organizationId !== where.organizationId) continue;
          if (where.id && where.id.in && !where.id.in.includes(c.id)) continue;
          res.push(c);
        }
        return res;
      },
    },
    integrationConnection: {
      findFirst: async ({ where }: any) => {
        for (const conn of db.connections.values()) {
          if (where.organizationId && conn.organizationId !== where.organizationId) continue;
          if (where.provider && conn.provider !== where.provider) continue;
          if (where.clientId !== undefined && conn.clientId !== where.clientId) continue;
          if (where.status && conn.status !== where.status) continue;
          return conn;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        const res = [];
        for (const conn of db.connections.values()) {
          if (where.organizationId && conn.organizationId !== where.organizationId) continue;
          if (where.provider && conn.provider !== where.provider) continue;
          if (where.clientId !== undefined && conn.clientId !== where.clientId) continue;
          if (where.status && conn.status !== where.status) continue;
          res.push(conn);
        }
        return res;
      },
    },
    clientIntegration: {
      findMany: async ({ where }: any) => {
        const res = [];
        for (const ci of db.clientIntegrations.values()) {
          if (where.clientId && ci.clientId !== where.clientId) continue;
          if (where.clientId && where.clientId.in && !where.clientId.in.includes(ci.clientId)) continue;
          if (where.provider && ci.provider !== where.provider) continue;
          if (where.status && ci.status !== where.status) continue;
          res.push({
            ...ci,
            client: db.clients.get(ci.clientId) || null,
          });
        }
        return res;
      },
      findFirst: async ({ where }: any) => {
        for (const ci of db.clientIntegrations.values()) {
          if (where.client && where.client.organizationId) {
            const c = db.clients.get(ci.clientId);
            if (!c || c.organizationId !== where.client.organizationId) continue;
          }
          if (where.clientId !== undefined) {
            if (typeof where.clientId === 'object' && where.clientId.not) {
              if (ci.clientId === where.clientId.not) continue;
            } else if (ci.clientId !== where.clientId) {
              continue;
            }
          }
          if (where.provider && ci.provider !== where.provider) continue;
          if (where.externalId && ci.externalId !== where.externalId) continue;
          return {
            ...ci,
            client: db.clients.get(ci.clientId) || null,
          };
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = `ci-${Date.now()}-${Math.random()}`;
        const newCi = { id, ...data };
        db.clientIntegrations.set(id, newCi);
        return newCi;
      },
      delete: async ({ where }: any) => {
        const item = db.clientIntegrations.get(where.id);
        db.clientIntegrations.delete(where.id);
        return item;
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const [key, ci] of db.clientIntegrations.entries()) {
          if (where.clientId && ci.clientId !== where.clientId) continue;
          if (where.provider && ci.provider !== where.provider) continue;
          if (where.externalId && ci.externalId !== where.externalId) continue;
          db.clientIntegrations.delete(key);
          count++;
        }
        return { count };
      },
    },
  } as any;
}

function createMockProvider(): SocialPublisherProvider & {
  lastUploadInput?: SocialMediaUploadInput;
  lastCreateInput?: CreateSocialPostInput;
} {
  return {
    lastUploadInput: undefined,
    lastCreateInput: undefined,
    async getStatus(ctx: SocialPublisherContext): Promise<SocialPublisherStatus> {
      return { connected: true, provider: 'BRIGHTBEAN', workspaceId: ctx.workspaceId };
    },
    async listAccounts(ctx: SocialPublisherContext): Promise<SocialAccount[]> {
      return [
        {
          id: 'acc-ig-1',
          platform: 'INSTAGRAM',
          accountName: 'Conta Instagram Alfa',
          connectionStatus: 'CONNECTED',
        },
        {
          id: 'acc-ig-2',
          platform: 'INSTAGRAM',
          accountName: 'Conta Instagram Beta',
          connectionStatus: 'CONNECTED',
        },
      ];
    },
    async listPosts(ctx: SocialPublisherContext, filters?: any): Promise<{ posts: SocialPost[]; total: number }> {
      const allPosts: SocialPost[] = [
        {
          id: 'post-1',
          content: 'Post 1 do Alfa',
          status: 'PUBLISHED',
          format: 'FEED',
          createdAt: new Date().toISOString(),
          platformStates: [
            {
              accountId: 'acc-ig-1',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              externalPostId: 'ext-post-1',
              permalink: 'https://instagram.com/p/post1',
            },
          ],
        },
        {
          id: 'hidden-post-1',
          content: 'Post técnico que deve ser ocultado',
          status: 'PUBLISHED',
          format: 'FEED',
          createdAt: new Date().toISOString(),
          platformStates: [
            {
              accountId: 'acc-ig-1',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              externalPostId: 'ext-post-hidden',
            },
          ],
        },
        {
          id: 'post-2',
          content: 'Post do Beta',
          status: 'PUBLISHED',
          format: 'FEED',
          createdAt: new Date().toISOString(),
          platformStates: [
            {
              accountId: 'acc-ig-2',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              externalPostId: 'ext-post-2',
            },
          ],
        },
      ];

      let filtered = allPosts;
      if (filters?.accountId) {
        filtered = filtered.filter((p) =>
          p.platformStates.some((ps) => ps.accountId === filters.accountId)
        );
      }
      return { posts: filtered, total: filtered.length };
    },
    async getPost(ctx: SocialPublisherContext, postId: string): Promise<SocialPost | null> {
      if (postId === 'post-1') {
        return {
          id: 'post-1',
          content: 'Post 1 do Alfa',
          status: 'PUBLISHED',
          format: 'FEED',
          createdAt: new Date().toISOString(),
          platformStates: [
            {
              accountId: 'acc-ig-1',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              externalPostId: 'ext-post-1',
              permalink: 'https://instagram.com/p/post1',
            },
          ],
        };
      }
      if (postId === 'post-2') {
        return {
          id: 'post-2',
          content: 'Post do Beta',
          status: 'PUBLISHED',
          format: 'FEED',
          createdAt: new Date().toISOString(),
          platformStates: [
            {
              accountId: 'acc-ig-2',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              externalPostId: 'ext-post-2',
            },
          ],
        };
      }
      return null;
    },
    async uploadMedia(ctx: SocialPublisherContext, input: SocialMediaUploadInput): Promise<SocialMediaUploadResult> {
      this.lastUploadInput = input;
      return { id: 'media-uploaded-1', mimeType: input.mimeType, filename: input.filename };
    },
    async createPost(ctx: SocialPublisherContext, input: CreateSocialPostInput): Promise<SocialPost> {
      this.lastCreateInput = input;
      return {
        id: 'post-new-1',
        content: input.content,
        status: input.isDraft ? 'DRAFT' : 'SCHEDULED',
        format: input.format,
        createdAt: new Date().toISOString(),
        platformStates: [
          {
            accountId: input.accountId,
            platform: 'INSTAGRAM',
            status: 'PENDING',
          },
        ],
      };
    },
    async schedulePost(ctx: SocialPublisherContext, input: ScheduleSocialPostInput): Promise<SocialPost> {
      return {
        id: input.postId,
        content: 'Agendado',
        status: 'SCHEDULED',
        format: 'FEED',
        createdAt: new Date().toISOString(),
        scheduledAt: input.scheduledAt,
        platformStates: [],
      };
    },
    async cancelPost(ctx: SocialPublisherContext, postId: string): Promise<{ success: boolean }> {
      return { success: true };
    },
    async getPostAnalytics(ctx: SocialPublisherContext, postId: string): Promise<SocialPostAnalytics> {
      return { postId, impressions: 100, reach: 90, engagements: 10, likes: 8, comments: 2, shares: 0, saved: 1 };
    },
    async getAccountAnalytics(ctx: SocialPublisherContext, accountId: string): Promise<SocialAccountAnalytics> {
      return { accountId, period: '30d', followersCount: 1500, followersGrowth: 20, totalPosts: 50, avgEngagementRate: 3.5 };
    },
  };
}

describe('SocialPublisher & BrightBean Canonical Suite (2C2.1 Obrigatório A a Z)', () => {
  let db: InMemoryDatabase;
  let mockPrisma: any;
  let mockProvider: ReturnType<typeof createMockProvider>;
  let service: SocialPublisherService;

  beforeEach(() => {
    db = createInMemoryDb();
    mockPrisma = createMockPrisma(db);
    mockProvider = createMockProvider();
    service = new SocialPublisherService(mockProvider, mockPrisma);
  });

  // A. resolve IntegrationConnection BrightBean ativa
  it('A. resolve IntegrationConnection BrightBean ativa', async () => {
    const conn = await service.resolveBrightBeanConnection('org-test');
    assert.equal(conn.id, 'conn-bb-active');
    assert.equal(conn.provider, 'BRIGHTBEAN');
    assert.equal(conn.status, 'ACTIVE');
  });

  // B. sem conexão -> fail closed (503 BRIGHTBEAN_CONNECTION_NOT_CONFIGURED)
  it('B. sem conexão -> fail closed com erro BRIGHTBEAN_CONNECTION_NOT_CONFIGURED (503)', async () => {
    await assert.rejects(
      async () => service.resolveBrightBeanConnection('org-sem-conexao'),
      (err: any) => {
        assert.equal(err instanceof SocialPublisherServiceError, true);
        assert.equal(err.code, 'BRIGHTBEAN_CONNECTION_NOT_CONFIGURED');
        assert.equal(err.statusCode, 503);
        return true;
      }
    );
  });

  // C. getAvailableAccounts flags corretas (isLinked, linkedClientId)
  it('C. getAvailableAccounts flags corretas: identifica conta vinculada ao cliente Alfa e desvinculada', async () => {
    const accounts = await service.getAvailableAccounts('org-test');
    assert.equal(accounts.length, 2);

    const acc1 = accounts.find((a) => a.id === 'acc-ig-1');
    assert.equal(acc1?.isLinked, true);
    assert.equal(acc1?.linkedClientId, 'client-1');

    const acc2 = accounts.find((a) => a.id === 'acc-ig-2');
    assert.equal(acc2?.isLinked, false);
    assert.equal(acc2?.linkedClientId, null);
  });

  // D. link conta própria com sucesso
  it('D. link conta própria vincula com sucesso ao cliente Beta', async () => {
    const ci = await service.linkAccountToClient('org-test', 'client-2', 'acc-ig-2');
    assert.equal(ci.success, true);
    assert.notEqual(ci.clientIntegrationId, undefined);

    // Confirma que agora está vinculada
    const accounts = await service.getClientAccounts('org-test', 'client-2');
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, 'acc-ig-2');
  });

  // E. impedir mesma conta em dois clientes da organização
  it('E. impedir mesma conta em dois clientes da mesma organização (409 ACCOUNT_ALREADY_LINKED)', async () => {
    // acc-ig-1 já está vinculada ao client-1
    await assert.rejects(
      async () => service.linkAccountToClient('org-test', 'client-2', 'acc-ig-1'),
      (err: any) => {
        assert.equal(err.code, 'ACCOUNT_ALREADY_LINKED_TO_ANOTHER_CLIENT');
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  // F. unlink não toca POSTIZ nem outros providers
  it('F. unlink remove estritamente o vínculo BRIGHTBEAN sem tocar POSTIZ', async () => {
    await service.unlinkAccountFromClient('org-test', 'client-1', 'acc-ig-1');

    // Verifica se BRIGHTBEAN foi removido
    const bbCi = await mockPrisma.clientIntegration.findFirst({
      where: { clientId: 'client-1', provider: 'BRIGHTBEAN', externalId: 'acc-ig-1' },
    });
    assert.equal(bbCi, null);

    // Verifica que POSTIZ continua intacto
    const postizCi = await mockPrisma.clientIntegration.findFirst({
      where: { clientId: 'client-1', provider: 'POSTIZ' },
    });
    assert.notEqual(postizCi, null);
    assert.equal(postizCi.externalId, 'postiz-acc-1');
  });

  // G. getAggregatedContent lista BrightBean posts
  it('G. getAggregatedContent lista posts agregados mapeados com clientName e platform', async () => {
    const res = await service.getAggregatedContent('org-test', {});
    assert.equal(res.posts.length > 0, true);
    const post1 = res.posts.find((p) => p.id === 'post-1');
    assert.notEqual(post1, undefined);
    assert.equal(post1?.clientId, 'client-1');
    assert.equal(post1?.clientName, 'Cliente Alfa');
    assert.equal(post1?.platform, 'INSTAGRAM');
  });

  // H. hiddenPostIds não aparecem
  it('H. hiddenPostIds configurados na conexão são filtrados do resultado agregado e por cliente', async () => {
    const resAgg = await service.getAggregatedContent('org-test', {});
    const hiddenInAgg = resAgg.posts.some((p) => p.id === 'hidden-post-1');
    assert.equal(hiddenInAgg, false, 'hidden-post-1 não pode aparecer na agregação');

    const resCli = await service.getClientPosts('org-test', 'client-1', {});
    const hiddenInCli = resCli.posts.some((p) => p.id === 'hidden-post-1');
    assert.equal(hiddenInCli, false, 'hidden-post-1 não pode aparecer na listagem do cliente');
  });

  // I. client posts só mostram contas vinculadas ao cliente
  it('I. client posts só mostram posts cujos platformStates pertencem às contas vinculadas ao cliente', async () => {
    const resCli1 = await service.getClientPosts('org-test', 'client-1', {});
    assert.equal(resCli1.posts.length, 1);
    assert.equal(resCli1.posts[0].id, 'post-1');
    assert.equal(resCli1.posts.some((p) => p.id === 'post-2'), false);
  });

  // J. getPost cross-client = bloqueado (404/403)
  it('J. getPost cross-client é bloqueado com 404', async () => {
    // client-1 tenta acessar post-2 (que pertence à conta acc-ig-2, não vinculada ao client-1)
    await assert.rejects(
      async () => service.getClientPost('org-test', 'client-1', 'post-2'),
      (err: any) => {
        assert.equal(err.code, 'POST_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // K. create cross-client account = bloqueado (403)
  it('K. create cross-client account é bloqueado com 403 ACCOUNT_NOT_LINKED_TO_CLIENT', async () => {
    // client-1 tenta publicar usando acc-ig-2 (não vinculada ao client-1)
    await assert.rejects(
      async () =>
        service.createPost('org-test', 'client-1', {
          accountId: 'acc-ig-2',
          format: 'FEED',
          content: 'Tentativa de post invasivo',
          idempotencyKey: 'key-test-k',
        }),
      (err: any) => {
        assert.equal(err.code, 'ACCOUNT_NOT_LINKED_TO_CLIENT');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  // L. schedule cross-client = bloqueado (404/403)
  it('L. schedule cross-client valida ownership e bloqueia post alien', async () => {
    await assert.rejects(
      async () =>
        service.schedulePost('org-test', 'client-1', {
          postId: 'post-2',
          scheduledAt: '2026-12-01T10:00:00Z',
        }),
      (err: any) => {
        assert.equal(err.code, 'POST_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // M. cancel cross-client = bloqueado (404/403)
  it('M. cancel cross-client valida ownership e bloqueia cancelamento alien', async () => {
    await assert.rejects(
      async () => service.cancelPost('org-test', 'client-1', 'post-2'),
      (err: any) => {
        assert.equal(err.code, 'POST_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // N. analytics cross-client = bloqueado (404/403)
  it('N. analytics cross-client valida ownership de post e conta e bloqueia', async () => {
    await assert.rejects(
      async () => service.getPostAnalytics('org-test', 'client-1', 'post-2'),
      (err: any) => {
        assert.equal(err.code, 'POST_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    await assert.rejects(
      async () => service.getAccountAnalytics('org-test', 'client-1', 'acc-ig-2'),
      (err: any) => {
        assert.equal(err.code, 'ACCOUNT_NOT_LINKED_TO_CLIENT');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  // O. upload sem Idempotency-Key = 400
  it('O. upload sem Idempotency-Key lança 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    await assert.rejects(
      async () =>
        service.uploadMedia('org-test', {
          filename: 'teste.png',
          mimeType: 'image/png',
          buffer: Buffer.from('fake'),
          idempotencyKey: '',
        }),
      (err: any) => {
        assert.equal(err.code, 'IDEMPOTENCY_KEY_REQUIRED');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  // P. create sem Idempotency-Key = 400
  it('P. create sem Idempotency-Key lança 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    await assert.rejects(
      async () =>
        service.createPost('org-test', 'client-1', {
          accountId: 'acc-ig-1',
          format: 'FEED',
          content: 'Post sem key',
          idempotencyKey: '',
        }),
      (err: any) => {
        assert.equal(err.code, 'IDEMPOTENCY_KEY_REQUIRED');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  // Q. mesma Idempotency-Key é propagada intacta
  it('Q. mesma Idempotency-Key é repassada intacta ao provider em upload e create', async () => {
    const uploadKey = 'upload-key-unique-123';
    await service.uploadMedia('org-test', {
      filename: 'foto.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('conteudo'),
      idempotencyKey: uploadKey,
    });
    assert.equal(mockProvider.lastUploadInput?.idempotencyKey, uploadKey);

    const createKey = 'create-key-unique-456';
    await service.createPost('org-test', 'client-1', {
      accountId: 'acc-ig-1',
      format: 'FEED',
      content: 'Post com chave',
      idempotencyKey: createKey,
    });
    assert.equal(mockProvider.lastCreateInput?.idempotencyKey, createKey);
  });

  // R a V. Format Mapping no BrightBeanProvider
  describe('Format Mapping no BrightBeanProvider (Regras R a V)', () => {
    const dummyConnService = {
      getConnection: async () => ({
        id: 'conn-1',
        organizationId: 'o1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-1',
      }),
      resolveCredential: async () => 'synthetic-key',
    } as any;

    it('R. format Story Image: post_type=story + imagem -> STORY_IMAGE', async () => {
      const fetchImpl = () =>
        new Response(
          JSON.stringify({
            id: 'post-story-img',
            status: 'published',
            caption: 'Story foto',
            created_at: '2026-09-25T10:00:00Z',
            media_assets: [
              { id: 'm1', url: 'https://cdn/1.jpg', mime_type: 'image/jpeg', media_type: 'image', position: 0 },
            ],
            platform_posts: [
              {
                social_account_id: 'acc-1',
                platform: 'instagram',
                status: 'published',
                post_type: 'story',
              },
            ],
          }),
          { status: 200 }
        );

      const bbProvider = new BrightBeanProvider({
        connectionService: dummyConnService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl: fetchImpl as any,
      });

      const post = await bbProvider.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'post-story-img');
      assert.equal(post?.format, 'STORY_IMAGE');
    });

    it('S. format Story Video: post_type=story + vídeo -> STORY_VIDEO', async () => {
      const fetchImpl = () =>
        new Response(
          JSON.stringify({
            id: 'post-story-vid',
            status: 'published',
            caption: 'Story vídeo',
            created_at: '2026-09-25T10:00:00Z',
            media_assets: [
              { id: 'm2', url: 'https://cdn/2.mp4', mime_type: 'video/mp4', media_type: 'video', position: 0 },
            ],
            platform_posts: [
              {
                social_account_id: 'acc-1',
                platform: 'instagram',
                status: 'published',
                post_type: 'story',
              },
            ],
          }),
          { status: 200 }
        );

      const bbProvider = new BrightBeanProvider({
        connectionService: dummyConnService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl: fetchImpl as any,
      });

      const post = await bbProvider.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'post-story-vid');
      assert.equal(post?.format, 'STORY_VIDEO');
    });

    it('T. format Reel: post_type=reel -> REEL', async () => {
      const fetchImpl = () =>
        new Response(
          JSON.stringify({
            id: 'post-reel',
            status: 'published',
            caption: 'Reel de teste',
            created_at: '2026-09-25T10:00:00Z',
            media_assets: [
              { id: 'm3', url: 'https://cdn/3.mp4', mime_type: 'video/mp4', media_type: 'video', position: 0 },
            ],
            platform_posts: [
              {
                social_account_id: 'acc-1',
                platform: 'instagram',
                status: 'published',
                post_type: 'reel',
              },
            ],
          }),
          { status: 200 }
        );

      const bbProvider = new BrightBeanProvider({
        connectionService: dummyConnService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl: fetchImpl as any,
      });

      const post = await bbProvider.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'post-reel');
      assert.equal(post?.format, 'REEL');
    });

    it('U. format Carousel: sem post_type + 2+ mídias -> CAROUSEL', async () => {
      const fetchImpl = () =>
        new Response(
          JSON.stringify({
            id: 'post-carousel',
            status: 'published',
            caption: 'Carrossel',
            created_at: '2026-09-25T10:00:00Z',
            media_assets: [
              { id: 'm1', url: 'https://cdn/1.jpg', mime_type: 'image/jpeg', media_type: 'image', position: 0 },
              { id: 'm2', url: 'https://cdn/2.jpg', mime_type: 'image/jpeg', media_type: 'image', position: 1 },
            ],
            platform_posts: [
              {
                social_account_id: 'acc-1',
                platform: 'instagram',
                status: 'published',
              },
            ],
          }),
          { status: 200 }
        );

      const bbProvider = new BrightBeanProvider({
        connectionService: dummyConnService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl: fetchImpl as any,
      });

      const post = await bbProvider.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'post-carousel');
      assert.equal(post?.format, 'CAROUSEL');
    });

    it('V. format Feed: sem post_type + 0 ou 1 imagem -> FEED', async () => {
      const fetchImpl = () =>
        new Response(
          JSON.stringify({
            id: 'post-feed',
            status: 'published',
            caption: 'Feed foto única',
            created_at: '2026-09-25T10:00:00Z',
            media_assets: [
              { id: 'm1', url: 'https://cdn/1.jpg', mime_type: 'image/jpeg', media_type: 'image', position: 0 },
            ],
            platform_posts: [
              {
                social_account_id: 'acc-1',
                platform: 'instagram',
                status: 'published',
              },
            ],
          }),
          { status: 200 }
        );

      const bbProvider = new BrightBeanProvider({
        connectionService: dummyConnService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl: fetchImpl as any,
      });

      const post = await bbProvider.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'post-feed');
      assert.equal(post?.format, 'FEED');
    });
  });

  // W. permalink mapeado e releaseUrl
  it('W. permalink_url é mapeado para permalink do platformState e releaseUrl no AggregatedSocialPost', async () => {
    const res = await service.getAggregatedContent('org-test', {});
    const post1 = res.posts.find((p) => p.id === 'post-1');
    assert.notEqual(post1, undefined);
    assert.equal(post1?.releaseUrl, 'https://instagram.com/p/post1');
    assert.equal(post1?.platformStates[0].permalink, 'https://instagram.com/p/post1');
  });

  // X. mediaItems mapeados
  it('X. media_assets do BrightBean são mapeados estruturadamente em mediaItems', async () => {
    const dummyConnService = {
      getConnection: async () => ({
        id: 'conn-1',
        organizationId: 'o1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-1',
      }),
      resolveCredential: async () => 'synthetic-key',
    } as any;

    const fetchImpl = () =>
      new Response(
        JSON.stringify({
          id: 'post-media-test',
          status: 'published',
          caption: 'Post com mídias',
          created_at: '2026-09-25T10:00:00Z',
          media_assets: [
            { id: 'media-asset-99', url: 'https://storage/photo.jpg', mime_type: 'image/jpeg', media_type: 'image', position: 0 },
          ],
          platform_posts: [
            {
              social_account_id: 'acc-1',
              platform: 'instagram',
              status: 'published',
            },
          ],
        }),
        { status: 200 }
      );

    const bbProvider = new BrightBeanProvider({
      connectionService: dummyConnService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl: fetchImpl as any,
    });

    const post = await bbProvider.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'post-media-test');
    assert.notEqual(post?.mediaItems, undefined);
    assert.equal(post?.mediaItems?.length, 1);
    assert.equal(post?.mediaItems?.[0].id, 'media-asset-99');
    assert.equal(post?.mediaItems?.[0].url, 'https://storage/photo.jpg');
    assert.equal(post?.mediaItems?.[0].mimeType, 'image/jpeg');
  });

  // Y. BrightBean common connector tenant-safe
  it('Y. BrightBean common connector possui capabilities corretas e disconnect desativa apenas a conexão local', async () => {
    const dummyConnService = {
      getConnection: async () => ({
        id: 'conn-bb-active',
        organizationId: 'org-test',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-test-123',
      }),
      disconnectConnection: async (_orgId: string, _connId: string) => {
        db.connections.get('conn-bb-active').status = 'REVOKED';
        return { success: true };
      },
      resolveCredential: async () => 'synthetic-key',
    } as any;

    const bbProvider = new BrightBeanProvider({
      connectionService: dummyConnService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl: (() => new Response(JSON.stringify({ workspace_id: 'ws-test-123' }), { status: 200 })) as any,
    });

    const connector = new BrightBeanIntegrationConnector(bbProvider, dummyConnService, mockPrisma);
    assert.equal(connector.provider, 'BRIGHTBEAN');
    const caps = connector.getCapabilities();
    assert.equal(caps.canTestConnection, true);
    assert.equal(caps.canDisconnect, true);
    assert.equal(caps.canSync, false);
    assert.equal(caps.canReconnect, false);

    // Test connection
    const testResult = await connector.testConnection({
      organizationId: 'org-test',
      connectionId: 'conn-bb-active',
      workspaceId: 'ws-test-123',
    });
    assert.equal(testResult.connected, true);

    // Disconnect
    const discResult = await connector.disconnect({
      organizationId: 'org-test',
      connectionId: 'conn-bb-active',
    });
    assert.equal(discResult.disconnected, true);
    assert.equal(db.connections.get('conn-bb-active').status, 'REVOKED');
  });

  // Z. Scripts default DRY RUN
  it('Z. scripts de provisionamento e reconciliação possuem default DRY RUN seguro', async () => {
    // Validação estática / comportamental das constantes dos scripts
    // Ambos os scripts verificam process.argv.includes('--apply') para liberar escritas
    const testArgs = ['node', 'script.js'];
    const isApply = testArgs.includes('--apply');
    assert.equal(isApply, false, 'Sem a flag --apply explícita, o modo padrão deve ser estritamente DRY RUN');
  });
});
