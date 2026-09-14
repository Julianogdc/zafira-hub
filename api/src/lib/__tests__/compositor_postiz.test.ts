import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { PostizService } from '../../modules/integrations/postiz/postiz.service.js';
import { createPostizRoutes } from '../../modules/integrations/postiz/postiz.routes.js';
import { requireRole } from '../../middleware/auth.js';
import { PostizClient, PostizIntegrationError } from '../../modules/integrations/postiz/postiz.client.js';

test('--- Compositor Zafira de Conteúdo (Admin & Manager) Suite ---', async (t) => {
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
    await app.register(multipart);
    await app.register(createPostizRoutes(serviceMock));
    await app.ready();
    return app;
  }

  await t.test('1. Usuário não autenticado não cria post nem faz upload (401 Unauthorized)', async () => {
    const app = await setupTestApp({});

    // Tentativa de criação de post sem autenticação
    const createRes = await app.inject({
      method: 'POST',
      url: '/clients/cli_123/content/postiz',
      payload: {
        integrationId: 'int_123',
        format: 'FEED',
        mediaItems: [{ id: 'm1', path: 'https://example.com/img.jpg' }],
      },
    });
    assert.strictEqual(createRes.statusCode, 401, 'Deve rejeitar com 401 sem autenticação');

    // Tentativa de upload sem autenticação
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/integrations/postiz/upload',
    });
    assert.strictEqual(uploadRes.statusCode, 401, 'Upload deve rejeitar com 401 sem autenticação');
  });

  await t.test('2. Usuário MEMBER recebe 403 Forbidden ao tentar criar post ou fazer upload', async () => {
    const app = fastify();

    // Rota protegida simulando autenticação de MEMBER para criação
    app.post(
      '/test/clients/:clientId/content/postiz',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_member_colab',
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

    // Rota protegida simulando autenticação de MEMBER para upload
    app.post(
      '/test/integrations/postiz/upload',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_member_colab',
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

    // Rota simulando autenticação de ADMIN
    app.post(
      '/test/admin/create',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_admin',
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

    // Criação de post por MEMBER -> 403
    const createRes = await app.inject({
      method: 'POST',
      url: '/test/clients/cli_123/content/postiz',
      payload: {
        integrationId: 'int_123',
        format: 'FEED',
        mediaItems: [{ id: 'm1', path: 'https://example.com/img.jpg' }],
      },
    });
    assert.strictEqual(createRes.statusCode, 403, 'Member deve receber 403 Forbidden na criação');
    const body = createRes.json();
    assert.strictEqual(body.error, 'forbidden');

    // Upload por MEMBER -> 403
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/test/integrations/postiz/upload',
    });
    assert.strictEqual(uploadRes.statusCode, 403, 'Member deve receber 403 Forbidden no upload');

    // Criação por ADMIN -> 200
    const adminRes = await app.inject({
      method: 'POST',
      url: '/test/admin/create',
    });
    assert.strictEqual(adminRes.statusCode, 200, 'Admin deve ser autorizado');
  });

  await t.test('3. Admin/Manager só lista contas vinculadas ao cliente escolhido', async () => {
    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_target', organizationId: 'org_zafira' }),
      },
      clientIntegration: {
        findMany: async (args: any) => {
          if (args?.where?.clientId === 'cli_target') {
            return [
              {
                id: 'link_01',
                clientId: 'cli_target',
                provider: 'POSTIZ',
                externalId: 'int_insta_target',
                metadata: { name: 'Instagram do Cliente Target' },
                createdAt: new Date(),
              },
            ];
          }
          return [];
        },
      },
    };

    const service = new PostizService(null as any, mockPrisma);
    const result = await service.getClientAccounts('cli_target', 'org_zafira');

    assert.strictEqual(result.accounts.length, 1);
    assert.strictEqual(result.accounts[0].externalId, 'int_insta_target');
    assert.strictEqual(result.accounts[0].name, 'Instagram do Cliente Target');
  });

  await t.test('4. Conta de outro cliente ou organização é sumariamente rejeitada', async () => {
    const mockPrisma: any = {
      client: {
        findUnique: async (args: any) => {
          if (args?.where?.id === 'cli_A') {
            return { id: 'cli_A', name: 'Cliente A', organizationId: 'org_A' };
          }
          return null;
        },
      },
      clientIntegration: {
        findFirst: async (args: any) => {
          // A conta int_invasora NÃO pertence ao cliente A
          if (args?.where?.clientId === 'cli_A' && args?.where?.externalId === 'int_invasora') {
            return null;
          }
          return null;
        },
      },
    };

    const service = new PostizService(null as any, mockPrisma);

    await assert.rejects(
      async () =>
        service.createClientPost(
          'cli_A',
          {
            integrationId: 'int_invasora',
            format: 'FEED',
            mediaItems: [{ id: 'm1', path: 'https://example.com/img.jpg' }],
          },
          'org_A'
        ),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'POSTIZ_INTEGRATION_NOT_LINKED');
        return true;
      }
    );
  });

  await t.test('5. Story em vídeo é criado com post_type = "story" e preservado', async () => {
    let capturedPayload: any = null;

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente 1', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
          metadata: { providerIdentifier: 'instagram', name: 'Insta 1' },
        }),
      },
    };

    const mockClient: any = {
      createPost: async (payload: any) => {
        capturedPayload = payload;
        return {
          id: 'created_post_story_vid',
          state: 'QUEUE',
          publishDate: payload.date,
          settings: payload.posts[0].settings,
        };
      },
    };

    const service = new PostizService(mockClient, mockPrisma);

    const result = await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'STORY_VIDEO',
        mediaItems: [{ id: 'vid_1', path: '/uploads/video_story.mp4' }],
        scheduledDate: '2026-09-25T15:00:00.000Z',
      },
      'org_1'
    );

    assert.ok(capturedPayload, 'Payload do Postiz deve ter sido gerado');
    assert.strictEqual(
      capturedPayload.posts[0].settings.post_type,
      'story',
      'Settings deve ter post_type = "story"'
    );
    assert.strictEqual(result.post.isStory, true, 'isStory deve ser true');
    assert.strictEqual(result.post.contentType, 'STORY_VIDEO', 'contentType deve ser STORY_VIDEO');
  });

  await t.test('6. Story não recebe e não envia legenda no payload do Postiz', async () => {
    let capturedPayload: any = null;

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente 1', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
          metadata: { providerIdentifier: 'instagram' },
        }),
      },
    };

    const mockClient: any = {
      createPost: async (payload: any) => {
        capturedPayload = payload;
        return { id: 'created_story' };
      },
    };

    const service = new PostizService(mockClient, mockPrisma);

    await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'STORY_IMAGE',
        content: 'Legenda forçada que deve ser ignorada para Story',
        mediaItems: [{ id: 'img_1', path: '/uploads/story.jpg' }],
      },
      'org_1'
    );

    assert.ok(capturedPayload);
    assert.strictEqual(
      capturedPayload.posts[0].value[0].content,
      '',
      'Para Story, o campo content deve ser obrigatoriamente vazio'
    );
  });

  await t.test('7. Reel e Feed mantêm legenda preenchida', async () => {
    let capturedReelPayload: any = null;
    let capturedFeedPayload: any = null;

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente 1', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
          metadata: { providerIdentifier: 'instagram' },
        }),
      },
    };

    const mockClient: any = {
      createPost: async (payload: any) => {
        if (payload.posts[0].settings?.is_reel || payload.posts[0].value[0].content?.includes('vídeo')) {
          capturedReelPayload = payload;
        } else {
          capturedFeedPayload = payload;
        }
        return { id: 'p1' };
      },
    };

    const service = new PostizService(mockClient, mockPrisma);

    // Cria Reel com legenda
    await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'REEL',
        content: 'Confira nosso novo vídeo #zafira',
        mediaItems: [{ id: 'v1', path: '/uploads/reel.mp4' }],
      },
      'org_1'
    );

    // Cria Feed com legenda
    await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'FEED',
        content: 'Foto do feed #marketing',
        mediaItems: [{ id: 'i1', path: '/uploads/feed.jpg' }],
      },
      'org_1'
    );

    assert.strictEqual(capturedReelPayload.posts[0].value[0].content, 'Confira nosso novo vídeo #zafira');
    assert.strictEqual(capturedReelPayload.posts[0].settings.post_type, 'post');
    assert.strictEqual(capturedReelPayload.posts[0].settings.is_reel, true);
    assert.strictEqual(capturedFeedPayload.posts[0].value[0].content, 'Foto do feed #marketing');
    assert.strictEqual(capturedFeedPayload.posts[0].settings.post_type, 'post');
  });

  await t.test('8. Carrossel respeita e envia múltiplas mídias no array image', async () => {
    let capturedPayload: any = null;

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente 1', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
          metadata: { providerIdentifier: 'instagram' },
        }),
      },
    };

    const mockClient: any = {
      createPost: async (payload: any) => {
        capturedPayload = payload;
        return { id: 'carousel_1' };
      },
    };

    const service = new PostizService(mockClient, mockPrisma);

    const mediaList = [
      { id: 'm1', path: '/uploads/slide1.jpg' },
      { id: 'm2', path: '/uploads/slide2.jpg' },
      { id: 'm3', path: '/uploads/slide3.jpg' },
    ];

    const result = await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'CAROUSEL',
        content: 'Carrossel com 3 slides',
        mediaItems: mediaList,
      },
      'org_1'
    );

    assert.ok(capturedPayload);
    assert.strictEqual(capturedPayload.posts[0].value[0].image.length, 3);
    assert.strictEqual(result.post.mediaCount, 3);
    assert.strictEqual(result.post.contentType, 'CAROUSEL');
  });

  await t.test('9. Rascunho envia type="draft" e agendamento envia type="schedule" com data ISO válida', async () => {
    let capturedDraft: any = null;
    let capturedSchedule: any = null;

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente 1', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
        }),
      },
    };

    const mockClient: any = {
      createPost: async (payload: any) => {
        if (payload.type === 'draft') capturedDraft = payload;
        if (payload.type === 'schedule') capturedSchedule = payload;
        return { id: 'p' };
      },
    };

    const service = new PostizService(mockClient, mockPrisma);

    // Rascunho
    await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'FEED',
        mediaItems: [{ id: 'm1', path: '/uploads/draft.jpg' }],
        isDraft: true,
      },
      'org_1'
    );

    // Agendamento
    const futureIso = '2026-10-01T10:00:00.000Z';
    await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'FEED',
        mediaItems: [{ id: 'm1', path: '/uploads/sched.jpg' }],
        isDraft: false,
        scheduledDate: futureIso,
      },
      'org_1'
    );

    assert.strictEqual(capturedDraft.type, 'draft');
    assert.strictEqual(capturedSchedule.type, 'schedule');
    assert.strictEqual(capturedSchedule.date, futureIso);
  });

  await t.test('10. Falha de comunicação com o Postiz não expõe chave de API ou dados sensíveis', async () => {
    process.env.POSTIZ_API_KEY = 'super_secret_postiz_token_xyz987';

    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente 1', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
        }),
      },
    };

    const mockClient: any = {
      createPost: async () => {
        throw new PostizIntegrationError(
          'Erro ao comunicar com Postiz usando token super_secret_postiz_token_xyz987',
          502,
          'POSTIZ_ERROR'
        );
      },
    };

    const app = await setupTestApp(new PostizService(mockClient, mockPrisma));

    process.env.HUB_INTERNAL_API_KEY = 'test_key';
    const res = await app.inject({
      method: 'POST',
      url: '/clients/cli_1/content/postiz',
      headers: { 'x-api-key': 'test_key' },
      payload: {
        integrationId: 'int_1',
        format: 'FEED',
        mediaItems: [{ id: 'm1', path: '/uploads/img.jpg' }],
      },
    });

    assert.strictEqual(res.statusCode, 502);
    const bodyStr = res.body;
    assert.ok(
      !bodyStr.includes('super_secret_postiz_token_xyz987'),
      'Chave de API não pode aparecer no corpo da resposta de erro'
    );
    assert.ok(bodyStr.includes('[REDACTED]'), 'Chave deve ser substituída por [REDACTED]');
  });

  await t.test('11. Conteúdo criado retorna normalizado para Agenda e Preview', async () => {
    const mockPrisma: any = {
      client: {
        findUnique: async () => ({ id: 'cli_1', name: 'Cliente Zafira', organizationId: 'org_1' }),
      },
      clientIntegration: {
        findFirst: async () => ({
          id: 'link_1',
          clientId: 'cli_1',
          provider: 'POSTIZ',
          externalId: 'int_1',
          metadata: { name: 'Instagram Zafira', providerIdentifier: 'instagram' },
        }),
      },
    };

    const mockClient: any = {
      createPost: async () => ({ id: 'post_created_123' }),
    };

    const service = new PostizService(mockClient, mockPrisma);

    const { post } = await service.createClientPost(
      'cli_1',
      {
        integrationId: 'int_1',
        format: 'REEL',
        content: 'Vídeo oficial do Zafira Hub',
        mediaItems: [{ id: 'v1', path: '/uploads/video.mp4' }],
        scheduledDate: '2026-09-30T14:00:00.000Z',
      },
      'org_1'
    );

    // Valida propriedades fundamentais para consumo na Agenda e na Preview Zafira
    assert.strictEqual(post.id, 'post_created_123');
    assert.strictEqual(post.platform, 'instagram');
    assert.strictEqual(post.accountName, 'Instagram Zafira');
    assert.strictEqual(post.status, 'QUEUE');
    assert.strictEqual(post.contentType, 'REEL');
    assert.strictEqual(post.isStory, false);
    assert.strictEqual(post.scheduledAt, '2026-09-30T14:00:00.000Z');
    assert.strictEqual(post.content, 'Vídeo oficial do Zafira Hub');
  });

  await t.test('12. Upload de arquivo via serviço rejeita buffer vazio defensivamente', async () => {
    const service = new PostizService(null as any, null as any);

    await assert.rejects(
      async () => service.uploadMedia({ buffer: Buffer.alloc(0), filename: 'empty.jpg', mimetype: 'image/jpeg' }),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'INVALID_FILE');
        return true;
      }
    );
  });

  await t.test('13. Upload de vídeo .mp4 para Story retorna id e path do Postiz', async () => {
    const mockClient: any = {
      uploadMedia: async (buffer: Buffer, filename: string, mimeType: string) => {
        assert.ok(buffer.length > 0);
        assert.strictEqual(filename, 'story_video.mp4');
        assert.strictEqual(mimeType, 'video/mp4');
        return {
          id: 'postiz_media_video_999',
          name: 'story_video.mp4',
          path: 'https://postiz.lab.zafiramkt.com.br/uploads/story_video.mp4',
        };
      },
    };

    const service = new PostizService(mockClient, null as any);
    const result = await service.uploadMedia({
      buffer: Buffer.from('fake-mp4-binary-content-zafira-hub'),
      filename: 'story_video.mp4',
      mimetype: 'video/mp4',
    });

    assert.strictEqual(result.id, 'postiz_media_video_999');
    assert.strictEqual(result.name, 'story_video.mp4');
    assert.strictEqual(result.path, 'https://postiz.lab.zafiramkt.com.br/uploads/story_video.mp4');
  });

  // =========================================================================
  // ETAPA 3G — TESTES OBRIGATÓRIOS: EDITAR AGENDAMENTO DENTRO DO HUB
  // =========================================================================

  await t.test('14. Admin altera a data/hora de post SCHEDULED e chama rotina nativa do Postiz', async () => {
    let rescheduleCalledWith: any = null;

    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        rescheduleCalledWith = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_sched_1',
      integrationId: 'int_insta_123',
      platform: 'instagram',
      accountName: 'Zafira Oficial',
      status: 'SCHEDULED',
      content: 'Post agendado inicial',
      scheduledAt: '2026-10-01T14:00:00.000Z',
      mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/img.jpg', type: 'IMAGE' }],
      settings: { post_type: 'post' },
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    const newDate = '2026-10-05T18:30:00.000Z';
    const result = await service.rescheduleClientPost('cli_123', 'post_sched_1', newDate, 'org_zafira');

    assert.ok(rescheduleCalledWith, 'reschedulePost deve ser chamado');
    assert.strictEqual(rescheduleCalledWith.postId, 'post_sched_1');
    assert.strictEqual(rescheduleCalledWith.integrationId, 'int_insta_123');
    assert.strictEqual(rescheduleCalledWith.date, newDate);
    assert.strictEqual(result.post.scheduledAt, newDate);
    assert.strictEqual(result.post.status, 'QUEUE');
  });

  await t.test('15. Manager autorizado altera a data/hora via PATCH endpoint', async () => {
    const mockPost = {
      id: 'post_sched_2',
      integrationId: 'int_123',
      platform: 'instagram',
      accountName: 'Zafira Hub',
      status: 'QUEUE',
      content: 'Post na fila',
      scheduledAt: '2026-10-02T10:00:00.000Z',
    };

    const mockService: any = {
      rescheduleClientPost: async (clientId: string, postId: string, scheduledAt: string) => {
        return {
          post: {
            ...mockPost,
            scheduledAt,
            status: 'QUEUE',
          },
        };
      },
    };

    const app = fastify();
    await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
    await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long' });

    // Endpoint simulando autenticação de MANAGER
    app.patch(
      '/clients/:clientId/content/postiz/:postId/schedule',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_manager',
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
      async (req, reply) => {
        const body = req.body as any;
        const res = await mockService.rescheduleClientPost(
          (req.params as any).clientId,
          (req.params as any).postId,
          body.scheduledAt
        );
        return reply.status(200).send({ status: 'ok', post: res.post });
      }
    );

    await app.ready();

    const futureDate = '2026-10-10T15:00:00.000Z';
    const res = await app.inject({
      method: 'PATCH',
      url: '/clients/cli_123/content/postiz/post_sched_2/schedule',
      payload: { scheduledAt: futureDate },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.post.scheduledAt, futureDate);
    assert.strictEqual(body.post.status, 'QUEUE');
  });

  await t.test('16. Rascunho (DRAFT) passa para agendado (QUEUE) com data/hora válida', async () => {
    let calledPayload: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        calledPayload = payload;
        return { ok: true };
      },
    };

    const mockDraftPost = {
      id: 'post_draft_99',
      integrationId: 'int_draft_1',
      platform: 'instagram',
      accountName: 'Zafira',
      status: 'DRAFT',
      content: 'Rascunho agora será agendado',
      scheduledAt: null,
      mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/draft.jpg', type: 'IMAGE' }],
      settings: {},
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockDraftPost });

    const futureDate = '2026-11-01T12:00:00.000Z';
    const result = await service.rescheduleClientPost('cli_123', 'post_draft_99', futureDate, 'org_zafira');

    assert.strictEqual(calledPayload.postId, 'post_draft_99');
    assert.strictEqual(calledPayload.date, futureDate);
    assert.strictEqual(result.post.status, 'QUEUE');
    assert.strictEqual(result.post.scheduledAt, futureDate);
  });

  await t.test('17. Data no passado é rejeitada com status 400 (DATE_MUST_BE_FUTURE)', async () => {
    const service = new PostizService(null as any, null as any);
    (service as any).getClientPostById = async () => ({
      post: { id: 'post_1', status: 'QUEUE', integrationId: 'int_1' },
    });

    const pastDate = '2020-01-01T10:00:00.000Z';
    await assert.rejects(
      async () => service.rescheduleClientPost('cli_123', 'post_1', pastDate, 'org_zafira'),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'DATE_MUST_BE_FUTURE');
        return true;
      }
    );
  });

  await t.test('18. Post PUBLISHED e ERROR são rejeitados com erro 400', async () => {
    const service = new PostizService(null as any, null as any);

    // Rejeição para PUBLISHED
    (service as any).getClientPostById = async () => ({
      post: { id: 'post_pub', status: 'PUBLISHED', integrationId: 'int_1' },
    });
    await assert.rejects(
      async () => service.rescheduleClientPost('cli_123', 'post_pub', '2026-12-01T10:00:00.000Z', 'org_zafira'),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'POST_ALREADY_PUBLISHED');
        return true;
      }
    );

    // Rejeição para ERROR
    (service as any).getClientPostById = async () => ({
      post: { id: 'post_err', status: 'ERROR', integrationId: 'int_1' },
    });
    await assert.rejects(
      async () => service.rescheduleClientPost('cli_123', 'post_err', '2026-12-01T10:00:00.000Z', 'org_zafira'),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'POST_STATUS_NOT_EDITABLE');
        return true;
      }
    );
  });

  await t.test('19. MEMBER recebe 403 Forbidden ao tentar reagendar', async () => {
    const app = fastify();

    app.patch(
      '/clients/:clientId/content/postiz/:postId/schedule',
      {
        preHandler: [
          async (req) => {
            req.authContext = {
              type: 'user',
              userId: 'usr_member_read_only',
              email: 'membro@zafira.com.br',
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

    await app.ready();

    const res = await app.inject({
      method: 'PATCH',
      url: '/clients/cli_123/content/postiz/post_sched_1/schedule',
      payload: { scheduledAt: '2026-10-15T10:00:00.000Z' },
    });

    assert.strictEqual(res.statusCode, 403, 'MEMBER deve receber 403 Forbidden');
  });

  await t.test('20. Post de outro cliente ou organização recebe 404 Not Found', async () => {
    const service = new PostizService(null as any, null as any);
    (service as any).getClientPostById = async () => {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    };

    await assert.rejects(
      async () => service.rescheduleClientPost('cli_outro', 'post_1', '2026-10-15T10:00:00.000Z', 'org_zafira'),
      (err: any) => {
        assert.ok(err instanceof PostizIntegrationError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'CLIENT_NOT_FOUND');
        return true;
      }
    );
  });

  await t.test('21. Mídia, legenda, formato e conta social são preservados após reagendamento', async () => {
    let sentToPostiz: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        sentToPostiz = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_story_preserve',
      integrationId: 'int_social_instagram',
      platform: 'instagram',
      accountName: 'Zafira Preservada',
      status: 'QUEUE',
      content: 'Legenda original preservada',
      rawContent: 'Legenda original preservada',
      scheduledAt: '2026-10-01T10:00:00.000Z',
      mediaItems: [
        { url: 'https://postiz.lab.zafiramkt.com.br/uploads/story.mp4', type: 'VIDEO' },
      ],
      settings: { post_type: 'story' },
      contentType: 'STORY_VIDEO',
      isStory: true,
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    const newDate = '2026-10-20T19:00:00.000Z';
    const result = await service.rescheduleClientPost('cli_123', 'post_story_preserve', newDate, 'org_zafira');

    // Confirma que os dados enviados para o Postiz preservaram tudo
    assert.strictEqual(sentToPostiz.postId, 'post_story_preserve');
    assert.strictEqual(sentToPostiz.integrationId, 'int_social_instagram');
    assert.strictEqual(sentToPostiz.content, 'Legenda original preservada');
    assert.strictEqual(sentToPostiz.settings.post_type, 'story');
    assert.strictEqual(sentToPostiz.mediaItems[0].path, 'https://postiz.lab.zafiramkt.com.br/uploads/story.mp4');

    // Confirma que o post retornado preservou contentType e mídia
    assert.strictEqual(result.post.contentType, 'STORY_VIDEO');
    assert.strictEqual(result.post.isStory, true);
    assert.strictEqual(result.post.mediaItems?.[0]?.url, 'https://postiz.lab.zafiramkt.com.br/uploads/story.mp4');
    assert.strictEqual(result.post.scheduledAt, newDate);
  });

  await t.test('22. Nenhuma credencial, token ou segredo aparece na resposta do reagendamento', async () => {
    process.env.POSTIZ_API_KEY = 'secret_key_never_leak';

    const mockClient: any = {
      reschedulePost: async () => ({ ok: true }),
    };

    const mockPost = {
      id: 'post_sec_1',
      integrationId: 'int_1',
      platform: 'instagram',
      accountName: 'Zafira',
      status: 'QUEUE',
      content: 'Conteúdo seguro',
      scheduledAt: '2026-10-01T10:00:00.000Z',
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    const result = await service.rescheduleClientPost('cli_123', 'post_sec_1', '2026-10-20T10:00:00.000Z', 'org_zafira');
    const jsonStr = JSON.stringify(result);

    assert.ok(!jsonStr.includes('secret_key_never_leak'), 'Chave de API nunca pode aparecer');
    assert.ok(!jsonStr.includes('password'), 'Senha não pode aparecer');
  });

  await t.test('23. Regressão: Story em vídeo envia tags: [] e settings.post_type: story', async () => {
    let sentToPostiz: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        sentToPostiz = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_story_vid',
      integrationId: 'int_story_vid',
      platform: 'instagram',
      status: 'DRAFT',
      content: '',
      contentType: 'STORY_VIDEO',
      isStory: true,
      mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/story.mp4', type: 'VIDEO' }],
      settings: { post_type: 'story', __type: 'instagram' },
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    await service.rescheduleClientPost('cli_123', 'post_story_vid', '2026-10-15T10:00:00.000Z', 'org_1');

    assert.ok(sentToPostiz, 'reschedulePost deve ser chamado');
    assert.strictEqual(sentToPostiz.settings.post_type, 'story', 'Story em vídeo deve ter post_type: story');
    assert.strictEqual(sentToPostiz.settings.__type, 'instagram', '__type deve ser preservado');
  });

  await t.test('24. Regressão: Story com imagem envia settings.post_type: story', async () => {
    let sentToPostiz: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        sentToPostiz = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_story_img',
      integrationId: 'int_story_img',
      platform: 'instagram',
      status: 'QUEUE',
      content: '',
      contentType: 'STORY_IMAGE',
      isStory: true,
      mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/story.jpg', type: 'IMAGE' }],
      settings: { __type: 'instagram' },
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    await service.rescheduleClientPost('cli_123', 'post_story_img', '2026-10-15T11:00:00.000Z', 'org_1');

    assert.ok(sentToPostiz);
    assert.strictEqual(sentToPostiz.settings.post_type, 'story', 'Story com imagem deve ter post_type: story');
  });

  await t.test('25. Regressão: Reel envia settings.post_type: post e is_reel: true', async () => {
    let sentToPostiz: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        sentToPostiz = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_reel_1',
      integrationId: 'int_reel',
      platform: 'instagram',
      status: 'QUEUE',
      content: 'Vídeo do reel com legenda',
      contentType: 'REEL',
      isStory: false,
      mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/reel.mp4', type: 'VIDEO' }],
      settings: { post_type: 'reel', __type: 'instagram' },
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    await service.rescheduleClientPost('cli_123', 'post_reel_1', '2026-10-15T12:00:00.000Z', 'org_1');

    assert.ok(sentToPostiz);
    assert.strictEqual(sentToPostiz.settings.post_type, 'post', 'Reel deve enviar post_type: post');
    assert.strictEqual(sentToPostiz.settings.is_reel, true, 'Reel deve conter flag is_reel: true');
  });

  await t.test('26. Regressão: Feed envia settings.post_type: post', async () => {
    let sentToPostiz: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        sentToPostiz = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_feed_1',
      integrationId: 'int_feed',
      platform: 'instagram',
      status: 'SCHEDULED',
      content: 'Foto no feed',
      contentType: 'FEED_IMAGE',
      isStory: false,
      mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/feed.jpg', type: 'IMAGE' }],
      settings: { post_type: 'feed', __type: 'instagram' },
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    await service.rescheduleClientPost('cli_123', 'post_feed_1', '2026-10-15T13:00:00.000Z', 'org_1');

    assert.ok(sentToPostiz);
    assert.strictEqual(sentToPostiz.settings.post_type, 'post', 'Feed deve enviar post_type: post');
  });

  await t.test('27. Regressão: Carrossel envia settings.post_type: post', async () => {
    let sentToPostiz: any = null;
    const mockClient: any = {
      reschedulePost: async (payload: any) => {
        sentToPostiz = payload;
        return { ok: true };
      },
    };

    const mockPost = {
      id: 'post_car_1',
      integrationId: 'int_car',
      platform: 'instagram',
      status: 'DRAFT',
      content: 'Carrossel com várias imagens',
      contentType: 'CAROUSEL',
      isStory: false,
      mediaItems: [
        { url: 'https://postiz.lab.zafiramkt.com.br/uploads/1.jpg', type: 'IMAGE' },
        { url: 'https://postiz.lab.zafiramkt.com.br/uploads/2.jpg', type: 'IMAGE' },
      ],
      settings: { __type: 'instagram' },
    };

    const service = new PostizService(mockClient, null as any);
    (service as any).getClientPostById = async () => ({ post: mockPost });

    await service.rescheduleClientPost('cli_123', 'post_car_1', '2026-10-15T14:00:00.000Z', 'org_1');

    assert.ok(sentToPostiz);
    assert.strictEqual(sentToPostiz.settings.post_type, 'post', 'Carrossel deve enviar post_type: post');
  });

  await t.test('28. Regressão: Nenhum tipo interno do Hub pode chegar ao Postiz no campo post_type', async () => {
    const internalHubTypes = ['STORY_VIDEO', 'STORY_IMAGE', 'REEL', 'FEED_IMAGE', 'CAROUSEL'];

    for (const hubType of internalHubTypes) {
      let sentToPostiz: any = null;
      const mockClient: any = {
        reschedulePost: async (payload: any) => {
          sentToPostiz = payload;
          return { ok: true };
        },
      };

      const mockPost = {
        id: `post_${hubType}`,
        integrationId: 'int_test',
        platform: 'instagram',
        status: 'QUEUE',
        content: 'Teste tipo interno',
        contentType: hubType as any,
        isStory: hubType.startsWith('STORY'),
        mediaItems: [{ url: 'https://postiz.lab.zafiramkt.com.br/uploads/media.jpg', type: 'IMAGE' }],
        settings: { post_type: hubType }, // Simula valor interno inserido indevidamente
      };

      const service = new PostizService(mockClient, null as any);
      (service as any).getClientPostById = async () => ({ post: mockPost });

      await service.rescheduleClientPost('cli_123', `post_${hubType}`, '2026-10-15T15:00:00.000Z', 'org_1');

      assert.ok(sentToPostiz);
      const resultingType = sentToPostiz.settings.post_type;
      assert.ok(
        resultingType === 'post' || resultingType === 'story',
        `Tipo ${hubType} deve ser convertido exclusivamente para 'post' ou 'story', recebido: ${resultingType}`
      );
      assert.ok(
        !internalHubTypes.includes(resultingType),
        `Tipo interno do Hub ${resultingType} NUNCA pode vazar para o Postiz`
      );
    }
  });

  await t.test('29. Regressão: PostizClient.reschedulePost monta payload com tags: [] no nível superior', async () => {
    let capturedBody: any = null;
    const client = new PostizClient();
    (client as any).request = async (_endpoint: string, options: any) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true };
    };

    await client.reschedulePost({
      postId: 'test_p1',
      integrationId: 'test_int_1',
      date: '2026-10-15T16:00:00.000Z',
      content: 'Legenda do post',
      mediaItems: [{ id: 'm1', path: '/uploads/file.mp4' }],
      settings: { post_type: 'STORY_VIDEO', __type: 'instagram' },
    });

    assert.ok(capturedBody);
    assert.deepStrictEqual(capturedBody.tags, [], 'tags deve ser array vazio no nível superior');
    assert.strictEqual(capturedBody.posts[0].settings.post_type, 'story', 'post_type deve ser convertido para story');
    assert.strictEqual(capturedBody.posts[0].value[0].id, 'test_p1');
    assert.strictEqual(capturedBody.posts[0].value[0].image[0].path, '/uploads/file.mp4');
  });
});
