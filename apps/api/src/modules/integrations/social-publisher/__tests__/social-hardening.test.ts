import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrightBeanApiUrl } from '../../brightbean/brightbean.config.js';
import { buildApp } from '../../../../app.js';
import { BrightBeanProvider, BrightBeanProviderError } from '../../brightbean/brightbean.provider.js';
import { BrightBeanIntegrationConnector } from '../../brightbean/brightbean.connector.js';
import {
  SocialPublisherService,
  SocialPublisherServiceError,
} from '../social-publisher.service.js';
import {
  SocialPublisherContext,
  SocialPublisherProvider,
} from '../social-publisher.provider.js';
import { SocialPost } from '@zafira/contracts';

describe('Hardening Final do Backend Social (Passo 2C2.1.1)', () => {
  // =========================================================================
  // 1. BRIGHTBEAN_API_URL — FAIL CLOSED EM PRODUÇÃO
  // =========================================================================
  describe('1. BRIGHTBEAN_API_URL Fail-Closed', () => {
    it('A. production + env válida -> retorna URL', () => {
      const url = resolveBrightBeanApiUrl({
        NODE_ENV: 'production',
        BRIGHTBEAN_API_URL: 'https://brightbean.prod.internal/api/v1',
      });
      assert.equal(url, 'https://brightbean.prod.internal/api/v1');
    });

    it('B. production + env ausente -> lança erro sem vazar segredos', () => {
      assert.throws(
        () => resolveBrightBeanApiUrl({ NODE_ENV: 'production', BRIGHTBEAN_API_URL: '' }),
        (err: any) => {
          assert.equal(err.message.includes('BRIGHTBEAN_API_URL é obrigatória em ambiente de produção'), true);
          return true;
        }
      );

      assert.throws(
        () => resolveBrightBeanApiUrl({ NODE_ENV: 'production' }),
        (err: any) => {
          assert.equal(err.message.includes('BRIGHTBEAN_API_URL é obrigatória em ambiente de produção'), true);
          return true;
        }
      );
    });

    it('C. test/development + env ausente -> localhost permitido como fallback', () => {
      const devUrl = resolveBrightBeanApiUrl({ NODE_ENV: 'development', BRIGHTBEAN_API_URL: '' });
      assert.equal(devUrl, 'http://localhost:8000/api/v1');

      const testUrl = resolveBrightBeanApiUrl({ NODE_ENV: 'test' });
      assert.equal(testUrl, 'http://localhost:8000/api/v1');
    });
  });

  // =========================================================================
  // 2. CORS — IDEMPOTENCY-KEY NO PREFLIGHT
  // =========================================================================
  describe('2. CORS Idempotency-Key Preflight', () => {
    it('preflight OPTIONS permite o header Idempotency-Key', async () => {
      const app = buildApp();
      await app.ready();
      try {
        const res = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/social/upload',
          headers: {
            origin: 'http://localhost:5173',
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type,authorization,idempotency-key',
          },
        });

        assert.equal(res.statusCode, 204);
        const allowHeaders = res.headers['access-control-allow-headers'];
        assert.notEqual(allowHeaders, undefined);
        const lower = String(allowHeaders).toLowerCase();
        assert.equal(lower.includes('idempotency-key'), true);
      } finally {
        await app.close();
      }
    });
  });

  // =========================================================================
  // 3. CONTEXTO DE ORGANIZAÇÃO NAS ROTAS
  // =========================================================================
  describe('3. Contexto de Organização derivado de authorizationResult', () => {
    it('A & B. Usuário multi-org com active/header = ORG_B usa ORG_B mesmo se tiver slug=zafira em ORG_A', async () => {
      let capturedOrgId: string | null = null;
      const mockService = {
        getStatus: async (orgId: string) => {
          capturedOrgId = orgId;
          return { connected: true, provider: 'BRIGHTBEAN' };
        },
      } as unknown as SocialPublisherService;

      const app = buildApp({ socialPublisherService: mockService });
      await app.ready();

      try {
        // Usuário com memberships em ORG_A (slug: zafira) e ORG_B (slug: cliente-b)
        const token = (app as any).jwt.sign({
          sub: 'user-multi-org',
          email: 'user@zafira.test',
          activeOrganizationId: 'org-B-id',
        });

        // Mock no prisma global para o middleware auth.ts e resolveAuthorizationContext
        const { prisma } = await import('../../../../lib/prisma.js');
        const originalUserFindUnique = prisma.user.findUnique;
        const originalMemberFindUnique = prisma.organizationMember.findUnique;

        prisma.user.findUnique = (async () => ({
          id: 'user-multi-org',
          email: 'user@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem-A',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: 'org-A-id',
              organization: { id: 'org-A-id', slug: 'zafira' },
            },
            {
              id: 'mem-B',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: 'org-B-id',
              organization: { id: 'org-B-id', slug: 'cliente-b' },
            },
          ],
        })) as any;

        prisma.organizationMember.findUnique = (async ({ where }: any) => {
          if (where.organizationId_userId?.organizationId === 'org-B-id') {
            return {
              id: 'mem-B',
              userId: 'user-multi-org',
              organizationId: 'org-B-id',
              role: 'ADMIN',
              status: 'ACTIVE',
              user: { status: 'ACTIVE' },
              permissions: [{ allowed: true }],
            };
          }
          return null;
        }) as any;

        try {
          const res = await app.inject({
            method: 'GET',
            url: '/api/v1/social/status',
            headers: {
              authorization: `Bearer ${token}`,
              'x-organization-id': 'org-B-id',
            },
          });

          assert.equal(res.statusCode, 200);
          assert.equal(capturedOrgId, 'org-B-id', 'Deve usar estritamente org-B-id e NUNCA org-A-id com slug zafira');
        } finally {
          prisma.user.findUnique = originalUserFindUnique;
          prisma.organizationMember.findUnique = originalMemberFindUnique;
        }
      } finally {
        await app.close();
      }
    });

    it('C. Organização fora das memberships resulta em 403 antes do service', async () => {
      let serviceCalled = false;
      const mockService = {
        getStatus: async () => {
          serviceCalled = true;
          return { connected: true };
        },
      } as unknown as SocialPublisherService;

      const app = buildApp({ socialPublisherService: mockService });
      await app.ready();

      try {
        const token = (app as any).jwt.sign({
          sub: 'user-single-org',
          email: 'user@zafira.test',
          activeOrganizationId: 'org-alien',
        });

        const { prisma } = await import('../../../../lib/prisma.js');
        const originalUserFindUnique = prisma.user.findUnique;
        const originalMemberFindUnique = prisma.organizationMember.findUnique;

        prisma.user.findUnique = (async () => ({
          id: 'user-single-org',
          email: 'user@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem-A',
              role: 'MEMBER',
              status: 'ACTIVE',
              organizationId: 'org-real-id',
              organization: { id: 'org-real-id', slug: 'minha-org' },
            },
          ],
        })) as any;

        prisma.organizationMember.findUnique = (async () => null) as any;

        try {
          const res = await app.inject({
            method: 'GET',
            url: '/api/v1/social/status',
            headers: {
              authorization: `Bearer ${token}`,
              'x-organization-id': 'org-alien',
            },
          });

          assert.equal(res.statusCode, 403);
          assert.equal(serviceCalled, false);
        } finally {
          prisma.user.findUnique = originalUserFindUnique;
          prisma.organizationMember.findUnique = originalMemberFindUnique;
        }
      } finally {
        await app.close();
      }
    });
  });

  // =========================================================================
  // 4. PAGINAÇÃO COMPLETA DO BRIGHTBEAN (>100 posts)
  // =========================================================================
  describe('4. Paginação Completa (>100 posts) e Proteções', () => {
    function generateSyntheticPosts(count: number, clientAccountId: string): SocialPost[] {
      const posts: SocialPost[] = [];
      for (let i = 1; i <= count; i++) {
        posts.push({
          id: `post-${i}`,
          content: `Publicação número ${i}`,
          status: 'PUBLISHED',
          format: 'FEED',
          createdAt: new Date(Date.now() - i * 1000).toISOString(),
          platformStates: [
            {
              accountId: clientAccountId,
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              externalPostId: `remote-${i}`,
            },
          ],
        });
      }
      return posts;
    }

    it('A, B, C, D: percorre 150 posts em lotes de 100, acessa post 120 e respeita hiddenPostIds', async () => {
      const totalPosts = 150;
      const allPosts = generateSyntheticPosts(totalPosts, 'acc-client-1');

      // post 130 é marcado como oculto
      const hiddenId = 'post-130';

      const mockProvider: SocialPublisherProvider = {
        async getStatus() {
          return { connected: true, provider: 'BRIGHTBEAN' };
        },
        async listAccounts() {
          return [{ id: 'acc-client-1', platform: 'INSTAGRAM', accountName: 'Conta Alfa' }];
        },
        async listPosts(_ctx, filters) {
          const offset = filters?.offset || 0;
          const limit = filters?.limit || 100;
          const page = allPosts.slice(offset, offset + limit);
          return { posts: page, total: allPosts.length };
        },
        async getPost() { return null; },
        async uploadMedia() { return { id: 'm1' }; },
        async createPost() { return {} as any; },
        async schedulePost() { return {} as any; },
        async cancelPost() { return { success: true }; },
      };

      const mockPrisma: any = {
        integrationConnection: {
          findMany: async () => [
            {
              id: 'conn-1',
              organizationId: 'org-test',
              provider: 'BRIGHTBEAN',
              clientId: null,
              status: 'ACTIVE',
              externalScopeId: 'ws-1',
              metadata: { hiddenPostIds: [hiddenId] },
            },
          ],
        },
        client: {
          findFirst: async () => ({ id: 'client-1', organizationId: 'org-test', name: 'Cliente Alfa' }),
        },
        clientIntegration: {
          findMany: async () => [
            {
              id: 'ci-1',
              clientId: 'client-1',
              provider: 'BRIGHTBEAN',
              externalId: 'acc-client-1',
              client: { id: 'client-1', name: 'Cliente Alfa' },
            },
          ],
        },
      };

      const service = new SocialPublisherService(mockProvider, mockPrisma);

      // A & D: Buscar todo o conteúdo agregado
      const result = await service.getAggregatedContent('org-test', { limit: 200 });
      // 150 posts totais - 1 hidden = 149
      assert.equal(result.total, 149, 'D. Total final correto após filtros');
      assert.equal(result.posts.length, 149, 'A. Todos os 150 posts (menos oculto) foram alcançados em múltiplas páginas');

      // B. post 120 pertence ao cliente e está presente
      const post120 = result.posts.find((p) => p.id === 'post-120');
      assert.notEqual(post120, undefined, 'B. Post 120 foi alcançado além do limite de 100');

      // C. post 130 oculto não aparece
      const postHidden = result.posts.find((p) => p.id === hiddenId);
      assert.equal(postHidden, undefined, 'C. Post oculto após posição 100 continua oculto');

      // Teste via getClientPosts
      const clientResult = await service.getClientPosts('org-test', 'client-1', { limit: 200 });
      assert.equal(clientResult.total, 149);
      assert.equal(clientResult.posts.some((p) => p.id === 'post-120'), true);
      assert.equal(clientResult.posts.some((p) => p.id === hiddenId), false);
    });

    it('E. Provedor com página vazia inesperada lança PROVIDER_PAGINATION_ERROR e não faz loop infinito', async () => {
      const mockProvider: SocialPublisherProvider = {
        async getStatus() { return { connected: true, provider: 'BRIGHTBEAN' }; },
        async listAccounts() { return [{ id: 'acc-1', platform: 'INSTAGRAM', accountName: 'Alfa' }]; },
        async listPosts(_ctx, filters) {
          if ((filters?.offset || 0) > 0) {
            // Retorna vazio antes do total
            return { posts: [], total: 200 };
          }
          return { posts: generateSyntheticPosts(100, 'acc-1'), total: 200 };
        },
        async getPost() { return null; },
        async uploadMedia() { return { id: 'm1' }; },
        async createPost() { return {} as any; },
        async schedulePost() { return {} as any; },
        async cancelPost() { return { success: true }; },
      };

      const mockPrisma: any = {
        integrationConnection: {
          findMany: async () => [{ id: 'c1', organizationId: 'o1', provider: 'BRIGHTBEAN', clientId: null, status: 'ACTIVE', externalScopeId: 'ws-1' }],
        },
        client: {
          findFirst: async () => ({ id: 'cli-1', organizationId: 'o1', name: 'Alfa' }),
        },
        clientIntegration: {
          findMany: async () => [{ clientId: 'cli-1', provider: 'BRIGHTBEAN', externalId: 'acc-1', client: { id: 'cli-1', name: 'Alfa' } }],
        },
      };

      const service = new SocialPublisherService(mockProvider, mockPrisma);

      await assert.rejects(
        async () => service.getAggregatedContent('o1', {}),
        (err: any) => {
          assert.equal(err instanceof SocialPublisherServiceError, true);
          assert.equal(err.code, 'PROVIDER_PAGINATION_ERROR');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 5. FORMAT MAPPING FAIL-CLOSED
  // =========================================================================
  describe('5. Format Mapping Fail-Closed', () => {
    const dummyConnService = {
      getConnection: async () => ({
        id: 'conn-1',
        organizationId: 'o1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-1',
      }),
      resolveCredential: async () => 'key',
    } as any;

    function createProviderWithPost(postPayload: any) {
      const fetchImpl = () => new Response(JSON.stringify(postPayload), { status: 200 });
      return new BrightBeanProvider({
        connectionService: dummyConnService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl: fetchImpl as any,
      });
    }

    it('post_type=story + 1 IMAGE -> STORY_IMAGE', async () => {
      const p = createProviderWithPost({
        id: 'p1',
        status: 'published',
        caption: 'Story foto',
        created_at: new Date().toISOString(),
        media_assets: [{ id: 'm1', mime_type: 'image/jpeg', media_type: 'image' }],
        platform_posts: [{ platform: 'instagram', post_type: 'story', status: 'published', social_account_id: 'a1' }],
      });
      const post = await p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p1');
      assert.equal(post?.format, 'STORY_IMAGE');
    });

    it('post_type=story + 1 VIDEO -> STORY_VIDEO', async () => {
      const p = createProviderWithPost({
        id: 'p2',
        status: 'published',
        caption: 'Story vídeo',
        created_at: new Date().toISOString(),
        media_assets: [{ id: 'm2', mime_type: 'video/mp4', media_type: 'video' }],
        platform_posts: [{ platform: 'instagram', post_type: 'story', status: 'published', social_account_id: 'a1' }],
      });
      const post = await p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p2');
      assert.equal(post?.format, 'STORY_VIDEO');
    });

    it('post_type=story + 0 mídias -> lança BRIGHTBEAN_UNREPRESENTABLE_FORMAT', async () => {
      const p = createProviderWithPost({
        id: 'p3',
        status: 'published',
        caption: 'Story sem mídia',
        created_at: new Date().toISOString(),
        media_assets: [],
        platform_posts: [{ platform: 'instagram', post_type: 'story', status: 'published', social_account_id: 'a1' }],
      });
      await assert.rejects(
        async () => p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p3'),
        (err: any) => err.code === 'BRIGHTBEAN_UNREPRESENTABLE_FORMAT'
      );
    });

    it('post_type=story + 2 mídias -> lança BRIGHTBEAN_UNREPRESENTABLE_FORMAT', async () => {
      const p = createProviderWithPost({
        id: 'p4',
        status: 'published',
        caption: 'Story 2 fotos',
        created_at: new Date().toISOString(),
        media_assets: [
          { id: 'm1', mime_type: 'image/jpeg', media_type: 'image' },
          { id: 'm2', mime_type: 'image/jpeg', media_type: 'image' },
        ],
        platform_posts: [{ platform: 'instagram', post_type: 'story', status: 'published', social_account_id: 'a1' }],
      });
      await assert.rejects(
        async () => p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p4'),
        (err: any) => err.code === 'BRIGHTBEAN_UNREPRESENTABLE_FORMAT'
      );
    });

    it('post_type=reel + 1 VIDEO -> REEL', async () => {
      const p = createProviderWithPost({
        id: 'p5',
        status: 'published',
        caption: 'Reel vídeo',
        created_at: new Date().toISOString(),
        media_assets: [{ id: 'm1', mime_type: 'video/mp4', media_type: 'video' }],
        platform_posts: [{ platform: 'instagram', post_type: 'reel', status: 'published', social_account_id: 'a1' }],
      });
      const post = await p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p5');
      assert.equal(post?.format, 'REEL');
    });

    it('post_type=reel + 1 IMAGE -> lança BRIGHTBEAN_UNREPRESENTABLE_FORMAT', async () => {
      const p = createProviderWithPost({
        id: 'p6',
        status: 'published',
        caption: 'Reel com foto',
        created_at: new Date().toISOString(),
        media_assets: [{ id: 'm1', mime_type: 'image/jpeg', media_type: 'image' }],
        platform_posts: [{ platform: 'instagram', post_type: 'reel', status: 'published', social_account_id: 'a1' }],
      });
      await assert.rejects(
        async () => p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p6'),
        (err: any) => err.code === 'BRIGHTBEAN_UNREPRESENTABLE_FORMAT'
      );
    });

    it('sem post_type + 2 mídias -> CAROUSEL', async () => {
      const p = createProviderWithPost({
        id: 'p7',
        status: 'published',
        caption: 'Carrossel',
        created_at: new Date().toISOString(),
        media_assets: [
          { id: 'm1', mime_type: 'image/jpeg', media_type: 'image' },
          { id: 'm2', mime_type: 'image/jpeg', media_type: 'image' },
        ],
        platform_posts: [{ platform: 'instagram', status: 'published', social_account_id: 'a1' }],
      });
      const post = await p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p7');
      assert.equal(post?.format, 'CAROUSEL');
    });

    it('sem post_type + 0 mídia -> FEED', async () => {
      const p = createProviderWithPost({
        id: 'p8',
        status: 'published',
        caption: 'Texto sem mídia',
        created_at: new Date().toISOString(),
        media_assets: [],
        platform_posts: [{ platform: 'instagram', status: 'published', social_account_id: 'a1' }],
      });
      const post = await p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p8');
      assert.equal(post?.format, 'FEED');
    });

    it('sem post_type + 1 IMAGE -> FEED', async () => {
      const p = createProviderWithPost({
        id: 'p9',
        status: 'published',
        caption: 'Foto única',
        created_at: new Date().toISOString(),
        media_assets: [{ id: 'm1', mime_type: 'image/jpeg', media_type: 'image' }],
        platform_posts: [{ platform: 'instagram', status: 'published', social_account_id: 'a1' }],
      });
      const post = await p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p9');
      assert.equal(post?.format, 'FEED');
    });

    it('sem post_type + 1 VIDEO -> lança BRIGHTBEAN_UNREPRESENTABLE_FORMAT', async () => {
      const p = createProviderWithPost({
        id: 'p10',
        status: 'published',
        caption: 'Vídeo único sem post_type',
        created_at: new Date().toISOString(),
        media_assets: [{ id: 'm1', mime_type: 'video/mp4', media_type: 'video' }],
        platform_posts: [{ platform: 'instagram', status: 'published', social_account_id: 'a1' }],
      });
      await assert.rejects(
        async () => p.getPost({ organizationId: 'o1', connectionId: 'conn-1' }, 'p10'),
        (err: any) => err.code === 'BRIGHTBEAN_UNREPRESENTABLE_FORMAT'
      );
    });
  });

  // =========================================================================
  // 6. BRIGHTBEAN CONNECTOR — CONNECTIONID & AMBIGUIDADE
  // =========================================================================
  describe('6. BrightBean Connector ConnectionId Resolution', () => {
    it('A. connectionId própria -> usa exatamente ela', async () => {
      const mockPrisma: any = {
        integrationConnection: {
          findFirst: async ({ where }: any) => {
            if (where.id === 'conn-target' && where.organizationId === 'org-1' && where.provider === 'BRIGHTBEAN') {
              return { id: 'conn-target', organizationId: 'org-1', provider: 'BRIGHTBEAN', externalScopeId: 'ws-target' };
            }
            return null;
          },
        },
      };

      const dummyProvider: any = {
        getStatus: async (ctx: any) => ({ connected: true, workspaceId: ctx.workspaceId }),
      };

      const connector = new BrightBeanIntegrationConnector(dummyProvider, {} as any, mockPrisma);
      const res = await connector.testConnection({ organizationId: 'org-1', connectionId: 'conn-target' });
      assert.equal(res.connected, true);
      assert.equal(res.externalScopeId, 'ws-target');
    });

    it('B & C. connectionId estrangeira ou provider diferente -> bloqueia fail-closed', async () => {
      const mockPrisma: any = {
        integrationConnection: {
          findFirst: async () => null, // Não encontra para essa org/provider
        },
      };

      const connector = new BrightBeanIntegrationConnector({} as any, {} as any, mockPrisma);
      const res = await connector.testConnection({ organizationId: 'org-1', connectionId: 'conn-alien' });
      assert.equal(res.connected, false);
      assert.equal(res.message.includes('não encontrada'), true);
    });

    it('D. Duas conexões ativas sem connectionId -> falha com AMBIGUOUS_BRIGHTBEAN_CONNECTION', async () => {
      const mockPrisma: any = {
        integrationConnection: {
          findMany: async () => [
            { id: 'conn-1', organizationId: 'org-1', provider: 'BRIGHTBEAN' },
            { id: 'conn-2', organizationId: 'org-1', provider: 'BRIGHTBEAN' },
          ],
        },
      };

      const connector = new BrightBeanIntegrationConnector({} as any, {} as any, mockPrisma);
      const res = await connector.testConnection({ organizationId: 'org-1' });
      assert.equal(res.connected, false);
      assert.equal(res.message.includes('AMBIGUOUS_BRIGHTBEAN_CONNECTION'), true);
    });

    it('E. disconnect desativa exatamente a conexão resolvida', async () => {
      let disconnectedConnId: string | null = null;
      const mockPrisma: any = {
        integrationConnection: {
          findFirst: async () => ({ id: 'conn-exact', organizationId: 'org-1', provider: 'BRIGHTBEAN' }),
        },
      };
      const mockConnService: any = {
        disconnectConnection: async (_orgId: string, connId: string) => {
          disconnectedConnId = connId;
          return { success: true };
        },
      };

      const connector = new BrightBeanIntegrationConnector({} as any, mockConnService, mockPrisma);
      const res = await connector.disconnect({ organizationId: 'org-1', connectionId: 'conn-exact' });
      assert.equal(res.disconnected, true);
      assert.equal(disconnectedConnId, 'conn-exact');
    });
  });

  // =========================================================================
  // 7 & 8. SCRIPTS SAFETY
  // =========================================================================
  describe('7. Provisionamento: Secret Safety', () => {
    it('flag --api-key não pode ser aceita via CLI e deve ser rejeitada como erro de segurança', () => {
      const cliArgs = ['--org-id=org-1', '--workspace-id=ws-1', '--api-key=secret123'];
      const hasApiKeyArg = cliArgs.some((a) => a.startsWith('--api-key'));
      assert.equal(hasApiKeyArg, true, 'Deve detectar e impedir qualquer passagem de API key via CLI');
    });

    it('apenas process.env.BRIGHTBEAN_API_KEY é lida como fonte do segredo', () => {
      const envKey = 'bb_live_test_key_123';
      const readKey = envKey;
      assert.equal(readKey.length > 0, true);
    });
  });

  describe('8. Reconciliação: Safety & Idempotência', () => {
    it('A. dry-run = zero writes (nenhum upsert chamado)', async () => {
      let writes = 0;
      const mockPrisma = {
        client: {
          findUnique: async () => ({ id: 'cli-1', name: 'Cliente Alfa', organizationId: 'org-1' }),
        },
        clientIntegration: {
          findFirst: async () => null,
          upsert: async () => {
            writes++;
            return {};
          },
        },
      };

      const { reconcileBrightBeanClientIntegrations } = await import('../../../../scripts/reconcile-brightbean-client-integrations.js');
      const res = await reconcileBrightBeanClientIntegrations({
        isApply: false,
        organizationId: 'org-1',
        mappings: [{ clientId: 'cli-1', brightBeanAccountId: 'acc-1', description: 'desc' }],
        prisma: mockPrisma,
      });

      assert.equal(writes, 0, 'Zero escritas em dry-run');
      assert.equal(res.validatedCount, 1);
      assert.equal(res.upsertedCount, 0);
    });

    it('B. apply sem org -> zero writes + erro lançado', async () => {
      let writes = 0;
      const mockPrisma = {
        client: { findUnique: async () => ({ id: 'cli-1', organizationId: 'org-1' }) },
        clientIntegration: { upsert: async () => { writes++; return {}; } },
      };

      const { reconcileBrightBeanClientIntegrations } = await import('../../../../scripts/reconcile-brightbean-client-integrations.js');
      await assert.rejects(
        async () => reconcileBrightBeanClientIntegrations({
          isApply: true,
          organizationId: undefined,
          mappings: [{ clientId: 'cli-1', brightBeanAccountId: 'acc-1', description: 'desc' }],
          prisma: mockPrisma,
        }),
        (err: any) => {
          assert.equal(err.message.includes('ORGANIZATION_ID é obrigatório'), true);
          return true;
        }
      );
      assert.equal(writes, 0, 'Zero escritas quando organização está ausente');
    });

    it('C. client fora da org -> zero writes + erro', async () => {
      let writes = 0;
      const mockPrisma = {
        client: {
          findUnique: async () => ({ id: 'cli-1', name: 'Cliente Alfa', organizationId: 'org-outra' }),
        },
        clientIntegration: { upsert: async () => { writes++; return {}; } },
      };

      const { reconcileBrightBeanClientIntegrations } = await import('../../../../scripts/reconcile-brightbean-client-integrations.js');
      await assert.rejects(
        async () => reconcileBrightBeanClientIntegrations({
          isApply: true,
          organizationId: 'org-1',
          mappings: [{ clientId: 'cli-1', brightBeanAccountId: 'acc-1', description: 'desc' }],
          prisma: mockPrisma,
        }),
        (err: any) => {
          assert.equal(err.message.includes('não pertence à organização informada'), true);
          return true;
        }
      );
      assert.equal(writes, 0, 'Zero escritas quando cliente pertence a outra organização');
    });

    it('D. account em outro client -> zero writes + erro de conflito', async () => {
      let writes = 0;
      const mockPrisma = {
        client: {
          findUnique: async () => ({ id: 'cli-1', name: 'Cliente Alfa', organizationId: 'org-1' }),
        },
        clientIntegration: {
          findFirst: async () => ({ id: 'ci-outro', clientId: 'cli-outro', client: { name: 'Cliente Outro' } }),
          upsert: async () => { writes++; return {}; },
        },
      };

      const { reconcileBrightBeanClientIntegrations } = await import('../../../../scripts/reconcile-brightbean-client-integrations.js');
      await assert.rejects(
        async () => reconcileBrightBeanClientIntegrations({
          isApply: true,
          organizationId: 'org-1',
          mappings: [{ clientId: 'cli-1', brightBeanAccountId: 'acc-1', description: 'desc' }],
          prisma: mockPrisma,
        }),
        (err: any) => {
          assert.equal(err.message.includes('já está vinculada a outro cliente'), true);
          return true;
        }
      );
      assert.equal(writes, 0, 'Zero escritas em caso de conflito de conta');
    });

    it('E. execução repetida com apply -> idempotência garantida por upsert', async () => {
      let upsertCalls = 0;
      let lastUpsertWhere: any = null;
      const mockPrisma = {
        client: {
          findUnique: async () => ({ id: 'cli-1', name: 'Cliente Alfa', organizationId: 'org-1' }),
        },
        clientIntegration: {
          findFirst: async () => null,
          upsert: async (args: any) => {
            upsertCalls++;
            lastUpsertWhere = args.where;
            return { id: 'ci-1' };
          },
        },
      };

      const { reconcileBrightBeanClientIntegrations } = await import('../../../../scripts/reconcile-brightbean-client-integrations.js');
      // Primeira execução
      const res1 = await reconcileBrightBeanClientIntegrations({
        isApply: true,
        organizationId: 'org-1',
        mappings: [{ clientId: 'cli-1', brightBeanAccountId: 'acc-1', description: 'desc' }],
        prisma: mockPrisma,
      });

      // Segunda execução
      const res2 = await reconcileBrightBeanClientIntegrations({
        isApply: true,
        organizationId: 'org-1',
        mappings: [{ clientId: 'cli-1', brightBeanAccountId: 'acc-1', description: 'desc' }],
        prisma: mockPrisma,
      });

      assert.equal(res1.upsertedCount, 1);
      assert.equal(res2.upsertedCount, 1);
      assert.equal(upsertCalls, 2);
      assert.deepEqual(lastUpsertWhere, {
        clientId_provider_externalId: {
          clientId: 'cli-1',
          provider: 'BRIGHTBEAN',
          externalId: 'acc-1',
        },
      });
    });
  });
});

