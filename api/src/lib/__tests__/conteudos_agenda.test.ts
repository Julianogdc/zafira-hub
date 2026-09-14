import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { PostizService } from '../../modules/integrations/postiz/postiz.service.js';
import { createPostizRoutes } from '../../modules/integrations/postiz/postiz.routes.js';
import { requireRole } from '../../middleware/auth.js';

test('--- Conteúdos & Agenda (Módulo Operacional Admin) Suite ---', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  async function setupTestApp(serviceMock: any) {
    const app = fastify();
    await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
    await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });
    await app.register(createPostizRoutes(serviceMock));
    await app.ready();
    return app;
  }

  await t.test('1. Usuário não autenticado não acessa o endpoint (401 Unauthorized)', async () => {
    const dummyService: any = {
      getAggregatedContent: async () => ({ posts: [], total: 0 }),
    };
    const app = await setupTestApp(dummyService);

    const res = await app.inject({
      method: 'GET',
      url: '/integrations/postiz/content',
    });

    assert.strictEqual(res.statusCode, 401, 'Endpoint deve exigir autenticação');
    const body = res.json();
    assert.strictEqual(body.error, 'unauthorized');
  });

  await t.test('2. Member/Colaborador recebe bloqueio (403 Forbidden)', async () => {
    const app = fastify();

    // Rota protegida com requireRole(['ADMIN', 'MANAGER']) simulando autenticação de MEMBER
    app.get(
      '/test/conteudos',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_member_01',
              email: 'colaborador@zafira.com.br',
              memberships: [
                {
                  organizationId: 'org_zafira',
                  organizationSlug: 'zafira',
                  role: 'MEMBER',
                },
              ],
            };
          },
          requireRole(['ADMIN', 'MANAGER']),
        ],
      },
      async () => ({ ok: true })
    );

    // Rota simulando autenticação de MANAGER
    app.get(
      '/test/conteudos/manager',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_manager_01',
              email: 'manager@zafira.com.br',
              memberships: [
                {
                  organizationId: 'org_zafira',
                  organizationSlug: 'zafira',
                  role: 'MANAGER',
                },
              ],
            };
          },
          requireRole(['ADMIN', 'MANAGER']),
        ],
      },
      async () => ({ ok: true })
    );

    // Rota simulando autenticação de ADMIN
    app.get(
      '/test/conteudos/admin',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_admin_01',
              email: 'admin@zafira.com.br',
              memberships: [
                {
                  organizationId: 'org_zafira',
                  organizationSlug: 'zafira',
                  role: 'ADMIN',
                },
              ],
            };
          },
          requireRole(['ADMIN', 'MANAGER']),
        ],
      },
      async () => ({ ok: true })
    );

    await app.ready();

    // MEMBER deve ser bloqueado
    const memberRes = await app.inject({
      method: 'GET',
      url: '/test/conteudos',
    });
    assert.strictEqual(memberRes.statusCode, 403, 'Member deve receber 403 Forbidden');
    const memberBody = memberRes.json();
    assert.strictEqual(memberBody.error, 'forbidden');

    // MANAGER deve ser permitido
    const managerRes = await app.inject({
      method: 'GET',
      url: '/test/conteudos/manager',
    });
    assert.strictEqual(managerRes.statusCode, 200, 'Manager deve ter acesso liberado');

    // ADMIN deve ser permitido
    const adminRes = await app.inject({
      method: 'GET',
      url: '/test/conteudos/admin',
    });
    assert.strictEqual(adminRes.statusCode, 200, 'Admin deve ter acesso liberado');
  });

  await t.test('3. Conteúdos de outra organização não aparecem (Isolamento Multi-tenant)', async () => {
    // Mock do prisma com integrações de clientes da Org A
    const mockPrisma: any = {
      clientIntegration: {
        findMany: async (args: any) => {
          if (args?.where?.client?.organizationId === 'org_A') {
            return [
              {
                id: 'link_01',
                clientId: 'cli_A1',
                provider: 'POSTIZ',
                externalId: 'int_org_A_account',
                client: {
                  id: 'cli_A1',
                  name: 'Cliente Org A',
                  organizationId: 'org_A',
                },
                metadata: {
                  name: 'Instagram Org A',
                  providerIdentifier: 'instagram',
                },
              },
            ];
          }
          return [];
        },
      },
    };

    // Mock do Postiz retornando posts de múltiplas organizações
    const mockClient: any = {
      getPosts: async () => ({
        posts: [
          {
            id: 'post_org_A',
            integration: { id: 'int_org_A_account', name: 'Instagram Org A', providerIdentifier: 'instagram' },
            state: 'PUBLISHED',
            content: 'Post legítimo da Organização A',
            publishDate: new Date('2026-09-10T14:00:00Z').toISOString(),
            settings: { post_type: 'post' },
          },
          {
            id: 'post_org_B',
            integration: { id: 'int_org_B_vazado', name: 'Conta Org B', providerIdentifier: 'instagram' },
            state: 'PUBLISHED',
            content: 'Post confidencial da Organização B que NÃO pode aparecer',
            publishDate: new Date('2026-09-10T15:00:00Z').toISOString(),
            settings: { post_type: 'post' },
          },
        ],
      }),
    };

    const service = new PostizService(mockClient, mockPrisma);
    service.clearCache();

    const result = await service.getAggregatedContent({
      organizationId: 'org_A',
    });

    assert.strictEqual(result.posts.length, 1);
    assert.strictEqual(result.posts[0].id, 'post_org_A');
    assert.strictEqual(result.posts[0].clientName, 'Cliente Org A');
    assert.ok(!result.posts.some((p) => p.id === 'post_org_B'), 'Post da Org B jamais pode aparecer');
  });

  await t.test('4. Conteúdo de conta Postiz não vinculada não aparece', async () => {
    const mockPrisma: any = {
      clientIntegration: {
        findMany: async () => [
          {
            id: 'link_valid',
            clientId: 'cli_valid',
            provider: 'POSTIZ',
            externalId: 'int_vinculada',
            client: { id: 'cli_valid', name: 'Cliente Vinculado', organizationId: 'org_1' },
            metadata: { name: 'Conta Vinculada', providerIdentifier: 'instagram' },
          },
        ],
      },
    };

    const mockClient: any = {
      getPosts: async () => ({
        posts: [
          {
            id: 'post_vinculado',
            integration: { id: 'int_vinculada', name: 'Conta Vinculada', providerIdentifier: 'instagram' },
            state: 'PUBLISHED',
            content: 'Post de conta vinculada',
            publishDate: new Date().toISOString(),
          },
          {
            id: 'post_sem_vinculo',
            integration: { id: 'int_fantasma_nao_cadastrada', name: 'Conta Avulsa', providerIdentifier: 'instagram' },
            state: 'PUBLISHED',
            content: 'Post de conta solta no Postiz sem cliente no Hub',
            publishDate: new Date().toISOString(),
          },
        ],
      }),
    };

    const service = new PostizService(mockClient, mockPrisma);
    service.clearCache();

    const result = await service.getAggregatedContent({ organizationId: 'org_1' });

    assert.strictEqual(result.posts.length, 1);
    assert.strictEqual(result.posts[0].id, 'post_vinculado');
    assert.ok(!result.posts.some((p) => p.id === 'post_sem_vinculo'), 'Post de conta avulsa deve ser descartado');
  });

  await t.test('5. Filtro por cliente funciona', async () => {
    const mockPrisma: any = {
      clientIntegration: {
        findMany: async (args: any) => {
          const all = [
            {
              id: 'l1',
              clientId: 'cli_1',
              provider: 'POSTIZ',
              externalId: 'int_cli_1',
              client: { id: 'cli_1', name: 'Cliente Um', organizationId: 'org_1' },
              metadata: { name: 'Insta Um' },
            },
            {
              id: 'l2',
              clientId: 'cli_2',
              provider: 'POSTIZ',
              externalId: 'int_cli_2',
              client: { id: 'cli_2', name: 'Cliente Dois', organizationId: 'org_1' },
              metadata: { name: 'Insta Dois' },
            },
          ];
          if (args?.where?.clientId) {
            return all.filter((i) => i.clientId === args.where.clientId);
          }
          return all;
        },
      },
    };

    const mockClient: any = {
      getPosts: async () => ({
        posts: [
          {
            id: 'post_cli_1',
            integration: { id: 'int_cli_1', name: 'Insta Um' },
            state: 'PUBLISHED',
            content: 'Post Cliente Um',
            publishDate: new Date().toISOString(),
          },
          {
            id: 'post_cli_2',
            integration: { id: 'int_cli_2', name: 'Insta Dois' },
            state: 'PUBLISHED',
            content: 'Post Cliente Dois',
            publishDate: new Date().toISOString(),
          },
        ],
      }),
    };

    const service = new PostizService(mockClient, mockPrisma);
    service.clearCache();

    // Filtra especificamente por cli_1
    const result = await service.getAggregatedContent({
      organizationId: 'org_1',
      clientId: 'cli_1',
    });

    assert.strictEqual(result.posts.length, 1);
    assert.strictEqual(result.posts[0].clientId, 'cli_1');
    assert.strictEqual(result.posts[0].clientName, 'Cliente Um');
  });

  await t.test('6. Filtro por status e formato funciona', async () => {
    const mockPrisma: any = {
      clientIntegration: {
        findMany: async () => [
          {
            id: 'l1',
            clientId: 'cli_1',
            provider: 'POSTIZ',
            externalId: 'int_1',
            client: { id: 'cli_1', name: 'Cliente Um', organizationId: 'org_1' },
          },
        ],
      },
    };

    const mockClient: any = {
      getPosts: async () => ({
        posts: [
          {
            id: 'post_story',
            integration: { id: 'int_1', name: 'Insta' },
            state: 'QUEUE',
            content: 'Story em texto',
            image: [{ path: 'https://postiz.lab.zafiramkt.com.br/uploads/story.mp4', type: 'video' }],
            settings: { post_type: 'story' },
            publishDate: new Date().toISOString(),
          },
          {
            id: 'post_published_reel',
            integration: { id: 'int_1', name: 'Insta' },
            state: 'PUBLISHED',
            content: 'Reel publicado',
            image: [{ path: 'https://postiz.lab.zafiramkt.com.br/uploads/reel.mp4', type: 'video' }],
            settings: { post_type: 'post' },
            publishDate: new Date().toISOString(),
          },
          {
            id: 'post_draft_feed',
            integration: { id: 'int_1', name: 'Insta' },
            state: 'DRAFT',
            content: 'Feed em rascunho',
            image: [{ path: 'https://postiz.lab.zafiramkt.com.br/uploads/feed.jpg', type: 'image' }],
            settings: { post_type: 'post' },
            publishDate: new Date().toISOString(),
          },
        ],
      }),
    };

    const service = new PostizService(mockClient, mockPrisma);
    service.clearCache();

    // Filtro por status QUEUE
    const queueRes = await service.getAggregatedContent({
      organizationId: 'org_1',
      status: 'QUEUE',
    });
    assert.strictEqual(queueRes.posts.length, 1);
    assert.strictEqual(queueRes.posts[0].id, 'post_story');

    // Filtro por formato REEL
    const reelRes = await service.getAggregatedContent({
      organizationId: 'org_1',
      format: 'REEL',
    });
    assert.strictEqual(reelRes.posts.length, 1);
    assert.strictEqual(reelRes.posts[0].id, 'post_published_reel');

    // Filtro por formato STORY
    const storyRes = await service.getAggregatedContent({
      organizationId: 'org_1',
      format: 'STORY',
    });
    assert.strictEqual(storyRes.posts.length, 1);
    assert.strictEqual(storyRes.posts[0].id, 'post_story');
    assert.strictEqual(storyRes.posts[0].isStory, true);
  });

  await t.test('7. Story permanece Story na visão agregada (não classificar vídeo de Story como Reel)', async () => {
    const mockPrisma: any = {
      clientIntegration: {
        findMany: async () => [
          {
            id: 'l1',
            clientId: 'cli_1',
            provider: 'POSTIZ',
            externalId: 'int_1',
            client: { id: 'cli_1', name: 'Cliente Um', organizationId: 'org_1' },
          },
        ],
      },
    };

    const mockClient: any = {
      getPosts: async () => ({
        posts: [
          {
            id: 'real_story_video_id',
            integration: { id: 'int_1', name: 'Instagram', providerIdentifier: 'instagram' },
            state: 'QUEUE',
            content: 'Legenda no Postiz para Story de vídeo',
            image: [{ path: '/uploads/cmu0iex0s0002qv767osni1ml/story.mp4', type: 'video' }],
            settings: JSON.stringify({ post_type: 'story' }),
            publishDate: '2026-09-20T18:30:00.000Z',
          },
        ],
      }),
    };

    const service = new PostizService(mockClient, mockPrisma);
    service.clearCache();

    const result = await service.getAggregatedContent({ organizationId: 'org_1' });

    assert.strictEqual(result.posts.length, 1);
    const storyPost = result.posts[0];
    assert.strictEqual(storyPost.isStory, true, 'isStory deve ser rigorosamente true');
    assert.strictEqual(storyPost.contentType, 'STORY_VIDEO', 'contentType deve ser STORY_VIDEO e não REEL');
  });

  await t.test('8. Resumo de agendados, publicados e falhas usa dados reais normalizados', async () => {
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const mockPrisma: any = {
      clientIntegration: {
        findMany: async () => [
          {
            id: 'l1',
            clientId: 'cli_1',
            provider: 'POSTIZ',
            externalId: 'int_1',
            client: { id: 'cli_1', name: 'Cliente Um', organizationId: 'org_1' },
          },
        ],
      },
    };

    const mockClient: any = {
      getPosts: async () => ({
        posts: [
          {
            id: 'pub_1',
            integration: { id: 'int_1' },
            state: 'PUBLISHED',
            content: 'Publicado 1',
            publishDate: pastDate,
          },
          {
            id: 'pub_2',
            integration: { id: 'int_1' },
            state: 'PUBLISHED',
            content: 'Publicado 2',
            publishDate: pastDate,
          },
          {
            id: 'queue_future',
            integration: { id: 'int_1' },
            state: 'QUEUE',
            content: 'Agendado futuro',
            publishDate: futureDate,
          },
          {
            id: 'err_1',
            integration: { id: 'int_1' },
            state: 'ERROR',
            content: 'Falhou',
            publishDate: pastDate,
          },
          {
            id: 'draft_1',
            integration: { id: 'int_1' },
            state: 'DRAFT',
            content: 'Rascunho',
            publishDate: pastDate,
          },
        ],
      }),
    };

    const service = new PostizService(mockClient, mockPrisma);
    service.clearCache();

    const result = await service.getAggregatedContent({ organizationId: 'org_1' });

    assert.strictEqual(result.summary.publishedCount, 2, 'Total de publicados deve ser 2');
    assert.strictEqual(result.summary.scheduledCount, 1, 'Total de agendados deve ser 1');
    assert.strictEqual(result.summary.errorCount, 1, 'Total de erros deve ser 1');
    assert.strictEqual(result.summary.draftCount, 1, 'Total de rascunhos deve ser 1');
    assert.ok(result.summary.nextPost, 'Deve haver um nextPost identificado');
    assert.strictEqual(result.summary.nextPost?.id, 'queue_future');
  });

  await t.test('9. Regra de clique em agendado direciona para Preview Zafira', () => {
    // Simula a função de clique do frontend
    const postAgendado = {
      id: 'post_123',
      clientId: 'cli_abc',
      status: 'QUEUE',
      releaseUrl: null,
    };

    let openedExternalUrl: string | null = null;
    let navigatedInternalRoute: string | null = null;

    const simulateClick = (post: any) => {
      if (post.status === 'PUBLISHED' && post.releaseUrl && post.releaseUrl.trim() !== '') {
        openedExternalUrl = post.releaseUrl;
      } else {
        navigatedInternalRoute = `/clientes/${post.clientId}/conteudo/${post.id}`;
      }
    };

    simulateClick(postAgendado);

    assert.strictEqual(openedExternalUrl, null, 'Agendado não deve abrir link externo');
    assert.strictEqual(
      navigatedInternalRoute,
      '/clientes/cli_abc/conteudo/post_123',
      'Agendado deve navegar para o Preview Zafira'
    );
  });

  await t.test('10. Regra de clique em publicado com releaseUrl preserva abertura externa', () => {
    const postPublicado = {
      id: 'post_456',
      clientId: 'cli_abc',
      status: 'PUBLISHED',
      releaseUrl: 'https://www.instagram.com/p/DF123456789/',
    };

    let openedExternalUrl: string | null = null;
    let navigatedInternalRoute: string | null = null;

    const simulateClick = (post: any) => {
      if (post.status === 'PUBLISHED' && post.releaseUrl && post.releaseUrl.trim() !== '') {
        openedExternalUrl = post.releaseUrl;
      } else {
        navigatedInternalRoute = `/clientes/${post.clientId}/conteudo/${post.id}`;
      }
    };

    simulateClick(postPublicado);

    assert.strictEqual(
      openedExternalUrl,
      'https://www.instagram.com/p/DF123456789/',
      'Publicado com releaseUrl deve abrir link público em nova aba'
    );
    assert.strictEqual(navigatedInternalRoute, null);
  });

  await t.test('11. Contrato de API preserva compatibilidade com resposta vazia se nenhum cliente possuir vínculo', async () => {
    const mockPrismaVazio: any = {
      clientIntegration: {
        findMany: async () => [],
      },
    };

    const service = new PostizService(null as any, mockPrismaVazio);
    service.clearCache();

    const result = await service.getAggregatedContent({ organizationId: 'org_sem_links' });

    assert.deepStrictEqual(result.posts, []);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.summary.scheduledCount, 0);
    assert.strictEqual(result.summary.publishedCount, 0);
    assert.strictEqual(result.summary.errorCount, 0);
    assert.strictEqual(result.summary.draftCount, 0);
    assert.strictEqual(result.summary.nextPost, null);
  });
});
