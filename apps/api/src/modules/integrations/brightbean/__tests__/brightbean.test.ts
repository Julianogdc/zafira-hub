import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrightBeanClient, BrightBeanApiError } from '../brightbean.client.js';
import { BrightBeanProvider, BrightBeanProviderError } from '../brightbean.provider.js';
import { IntegrationConnectionService } from '../../connections/integration-connection.service.js';

function createMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString = input.toString();
    return handler(urlString, init);
  }) as typeof fetch;
}

function createMockConnectionService(connectionData?: any, secret: string = 'synthetic-key-123') {
  const service = {
    getConnection: async (orgId: string, connId: string) => {
      if (connectionData) return connectionData;
      return {
        id: connId,
        organizationId: orgId,
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-123',
        hasCredential: true,
      };
    },
    resolveCredential: async (orgId: string, connId: string) => secret,
  } as unknown as IntegrationConnectionService;
  return service;
}

describe('BrightBean Client & Provider (PASSO 2B4B)', () => {
  // A) AUTH
  it('A) should include Authorization Bearer header and NOT leak key in error message', async () => {
    let capturedAuthHeader: string | null = null;
    const fetchImpl = createMockFetch((url, init) => {
      const headers = (init?.headers as Record<string, string>) || {};
      capturedAuthHeader = headers['Authorization'] || null;
      return new Response(JSON.stringify({ code: 'INVALID_TOKEN', detail: 'Secret bad' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new BrightBeanClient({
      apiBaseUrl: 'https://api.brightbean.test/v1',
      apiKey: 'secret-api-key-999',
      fetchImpl,
    });

    await assert.rejects(
      async () => client.getMe(),
      (err: any) => {
        assert.equal(err instanceof BrightBeanApiError, true);
        assert.equal(err.statusCode, 401);
        // Garante que o segredo não vaze na mensagem de erro
        assert.equal(err.message.includes('secret-api-key-999'), false);
        return true;
      }
    );

    assert.equal(capturedAuthHeader, 'Bearer secret-api-key-999');
  });

  // B) WORKSPACE
  it('B) should validate matching workspace_id and reject mismatch', async () => {
    const connService = createMockConnectionService();

    // 1. Mapeamento com workspace correto -> PASS
    const fetchPass = createMockFetch((url) => {
      if (url.includes('/me/')) {
        return new Response(JSON.stringify({ workspace_id: 'ws-123' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const providerPass = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl: fetchPass,
    });

    const statusPass = await providerPass.getStatus({
      organizationId: 'org-1',
      connectionId: 'conn-1',
      workspaceId: 'ws-123',
    });
    assert.equal(statusPass.connected, true);
    assert.equal(statusPass.workspaceId, 'ws-123');

    // 2. Mapeamento com workspace divergente retornado pelo /me/ -> FAIL
    const fetchMismatch = createMockFetch((url) => {
      if (url.includes('/me/')) {
        return new Response(JSON.stringify({ workspace_id: 'ws-OTHER' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const providerMismatch = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl: fetchMismatch,
    });

    await assert.rejects(
      async () =>
        providerMismatch.getStatus({
          organizationId: 'org-1',
          connectionId: 'conn-1',
        }),
      (err: any) => {
        assert.equal(err instanceof BrightBeanProviderError, true);
        assert.equal(err.code, 'BRIGHTBEAN_WORKSPACE_CONTEXT_MISMATCH');
        return true;
      }
    );
  });

  // C) ACCOUNTS
  it('C) should map remote snake_case account fields to canonical camelCase SocialAccount', async () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify([
            {
              id: 'acc-inst-1',
              platform: 'instagram_login',
              account_name: 'Insta Business',
              account_handle: '@instabiz',
              connection_status: 'CONNECTED',
              char_limit: 2200,
              escaped_chars: null,
              needs_title: false,
              supports_first_comment: true,
            },
          ]),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    const accounts = await provider.listAccounts({
      organizationId: 'org-1',
      connectionId: 'conn-1',
    });

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, 'acc-inst-1');
    assert.equal(accounts[0].platform, 'INSTAGRAM');
    assert.equal(accounts[0].accountName, 'Insta Business');
    assert.equal(accounts[0].accountHandle, '@instabiz');
    assert.equal(accounts[0].capabilities?.charLimit, 2200);
    assert.equal(accounts[0].capabilities?.supportsFirstComment, true);
  });

  // D) UPLOAD
  it('D) should send multipart file upload and preserve Idempotency-Key without manual Content-Type', async () => {
    let capturedHeaders: Record<string, string> = {};
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url, init) => {
      if (url.includes('/media/')) {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(
          JSON.stringify({
            id: 'media-99',
            url: 'https://cdn.brightbean.test/media-99.png',
            mime_type: 'image/png',
          }),
          { status: 201 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    const result = await provider.uploadMedia(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      {
        filename: 'banner.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-image-bytes'),
        idempotencyKey: 'idem-upload-777',
      }
    );

    assert.equal(result.id, 'media-99');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(capturedHeaders['Idempotency-Key'], 'idem-upload-777');
    // Garante que o Content-Type não foi sobrescrito manualmente em multipart
    assert.equal(capturedHeaders['Content-Type'], undefined);
  });

  // E) CREATE POST ACTIONS & SCHEDULE
  it('E) should set action=schedule when scheduledAt present, action=draft when absent, and fail if isDraft=false without scheduledAt', async () => {
    let capturedBody: any = null;
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url, init) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify([
            {
              id: 'acc-inst-1',
              platform: 'instagram',
              account_name: 'Insta',
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/posts/')) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            id: 'post-100',
            status: 'draft',
            caption: capturedBody.caption,
            created_at: new Date().toISOString(),
          }),
          { status: 201 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    // 1. isDraft=true / sem scheduledAt -> action = draft
    await provider.createPost(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      {
        accountId: 'acc-inst-1',
        format: 'FEED',
        content: 'Post Rascunho',
        mediaIds: [],
        isDraft: true,
      }
    );
    assert.equal(capturedBody.action, 'draft');

    // 2. scheduledAt presente -> action = schedule
    await provider.createPost(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      {
        accountId: 'acc-inst-1',
        format: 'FEED',
        content: 'Post Agendado',
        mediaIds: [],
        scheduledAt: '2026-10-01T12:00:00Z',
      }
    );
    assert.equal(capturedBody.action, 'schedule');
    assert.equal(capturedBody.scheduled_at, '2026-10-01T12:00:00Z');

    // 3. isDraft=false sem scheduledAt -> FAIL (IMMEDIATE_PUBLISH_NOT_SUPPORTED)
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          {
            accountId: 'acc-inst-1',
            format: 'FEED',
            content: 'Publicar Já',
            mediaIds: [],
            isDraft: false,
          }
        ),
      (err: any) => {
        assert.equal(err instanceof BrightBeanProviderError, true);
        assert.equal(err.code, 'IMMEDIATE_PUBLISH_NOT_SUPPORTED');
        return true;
      }
    );
  });

  // F) FORMAT VALIDATION (FAIL-CLOSED)
  it('F) should enforce fail-closed format validation rules', async () => {
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify([
            { id: 'acc-inst', platform: 'instagram', account_name: 'Insta' },
            { id: 'acc-fb', platform: 'facebook', account_name: 'FB' },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/media/vid-1')) {
        return new Response(
          JSON.stringify({ id: 'vid-1', url: 'http://cdn/vid.mp4', mime_type: 'video/mp4', media_type: 'VIDEO' }),
          { status: 200 }
        );
      }
      if (url.includes('/media/img-1')) {
        return new Response(
          JSON.stringify({ id: 'img-1', url: 'http://cdn/img.png', mime_type: 'image/png', media_type: 'IMAGE' }),
          { status: 200 }
        );
      }
      if (url.includes('/media/img-2')) {
        return new Response(
          JSON.stringify({ id: 'img-2', url: 'http://cdn/img2.png', mime_type: 'image/png', media_type: 'IMAGE' }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    // 1. STORY_IMAGE -> FAIL
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-inst', format: 'STORY_IMAGE', content: 'Story', mediaIds: ['img-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED'
    );

    // 2. STORY_VIDEO -> FAIL
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-inst', format: 'STORY_VIDEO', content: 'Story', mediaIds: ['vid-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED'
    );

    // 3. Facebook + REEL -> FAIL
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-fb', format: 'REEL', content: 'Reel FB', mediaIds: ['vid-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_REEL_UNSUPPORTED'
    );

    // 4. Instagram + REEL com imagem -> FAIL
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-inst', format: 'REEL', content: 'Reel Img', mediaIds: ['img-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_INVALID_REEL_ASSET'
    );

    // 5. Instagram + vídeo único + FEED -> FAIL (para evitar conversão automática em Reel)
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-inst', format: 'FEED', content: 'Feed Vid', mediaIds: ['vid-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_FEED_CONVERTED_TO_REEL'
    );
  });

  // G) STATUS MAPPING
  it('G) should fail on unknown remote status and NEVER default to DRAFT', async () => {
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/posts/post-unknown')) {
        return new Response(
          JSON.stringify({
            id: 'post-unknown',
            status: 'MYSTERY_STATUS',
            caption: 'Test',
            created_at: new Date().toISOString(),
          }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    await assert.rejects(
      async () =>
        provider.getPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          'post-unknown'
        ),
      (err: any) => {
        assert.equal(err instanceof BrightBeanProviderError, true);
        assert.equal(err.code, 'BRIGHTBEAN_UNKNOWN_POST_STATUS');
        return true;
      }
    );
  });

  // H) GET POST
  it('H) should return format=null on getPost and map platformStates correctly', async () => {
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/posts/post-200')) {
        return new Response(
          JSON.stringify({
            id: 'post-200',
            status: 'published',
            caption: 'Post publicado remoto',
            scheduled_at: null,
            published_at: '2026-09-23T15:00:00Z',
            created_at: '2026-09-23T14:00:00Z',
            platform_posts: [
              {
                social_account_id: 'acc-inst-1',
                platform: 'instagram',
                status: 'published',
                platform_post_id: 'ext-ig-999',
                publish_error: null,
                published_at: '2026-09-23T15:00:00Z',
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    const post = await provider.getPost(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      'post-200'
    );

    assert.notEqual(post, null);
    assert.equal(post?.id, 'post-200');
    assert.equal(post?.format, null); // NÃO inferir formato
    assert.equal(post?.status, 'PUBLISHED');
    assert.equal(post?.platformStates.length, 1);
    assert.equal(post?.platformStates[0].externalPostId, 'ext-ig-999');
  });

  // I) CANCEL POST
  it('I) should return { success: true } on cancelPost without artificial CANCELLED post', async () => {
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/posts/post-300/cancel')) {
        return new Response(JSON.stringify({ message: 'Cancelled' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    const res = await provider.cancelPost(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      'post-300'
    );

    assert.equal(res.success, true);
  });

  // J) ERROR HANDLING & 429 RETRY-AFTER
  it('J) should parse 429 Retry-After header into retryAfterSeconds property', async () => {
    const fetchImpl = createMockFetch(() => {
      return new Response(
        JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
        }
      );
    });

    const client = new BrightBeanClient({
      apiBaseUrl: 'https://api.brightbean.test/v1',
      apiKey: 'key-123',
      fetchImpl,
    });

    await assert.rejects(
      async () => client.getMe(),
      (err: any) => {
        assert.equal(err instanceof BrightBeanApiError, true);
        assert.equal(err.statusCode, 429);
        assert.equal(err.retryAfterSeconds, 60);
        return true;
      }
    );
  });

  // K) CREDENTIAL RESOLUTION & SECURITY
  it('K) should resolve credential via IntegrationConnectionService without exposing secret in errors or DTOs', async () => {
    let resolvedSecretCalled = false;
    const connService = {
      getConnection: async () => ({
        id: 'conn-1',
        organizationId: 'org-1',
        provider: 'BRIGHTBEAN',
        status: 'ACTIVE',
        externalScopeId: 'ws-123',
        hasCredential: true,
      }),
      resolveCredential: async () => {
        resolvedSecretCalled = true;
        return 'super-secret-key-xyz';
      },
    } as unknown as IntegrationConnectionService;

    const fetchImpl = createMockFetch((url, init) => {
      const headers = (init?.headers as Record<string, string>) || {};
      assert.equal(headers['Authorization'], 'Bearer super-secret-key-xyz');
      return new Response(JSON.stringify({ workspace_id: 'ws-123' }), { status: 200 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    const status = await provider.getStatus({
      organizationId: 'org-1',
      connectionId: 'conn-1',
    });

    assert.equal(resolvedSecretCalled, true);
    assert.equal(status.connected, true);
    // Garante que o segredo não é vazado na resposta do DTO
    assert.equal(JSON.stringify(status).includes('super-secret-key-xyz'), false);
  });
});
