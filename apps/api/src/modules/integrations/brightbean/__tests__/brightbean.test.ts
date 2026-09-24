import { describe, it, beforeEach } from 'node:test';
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

function createMockConnectionService(connectionData?: any, secret: string = 'super-secret-synthetic-key-999') {
  let resolveCalled = false;
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
    resolveCredential: async (orgId: string, connId: string) => {
      resolveCalled = true;
      return secret;
    },
    wasResolveCalled: () => resolveCalled,
  } as unknown as IntegrationConnectionService & { wasResolveCalled: () => boolean };
  return service;
}

describe('BrightBean Client & Provider Regression & Alignment Suite (PASSO 2B4B.2)', () => {

  // =========================================================================
  // 4. AUTH & SECURITY
  // =========================================================================
  describe('4. Auth & Security', () => {
    it('should include Authorization Bearer header and NOT leak key in message, detail, code, or error JSON', async () => {
      let capturedAuthHeader: string | null = null;
      const secretKey = 'super-secret-token-abc-123';

      const fetchImpl = createMockFetch((url, init) => {
        const headers = (init?.headers as Record<string, string>) || {};
        capturedAuthHeader = headers['Authorization'] || null;
        return new Response(JSON.stringify({ error: 'INVALID_TOKEN', detail: 'Bad token provided' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = new BrightBeanClient({
        apiBaseUrl: 'https://api.brightbean.test/v1',
        apiKey: secretKey,
        fetchImpl,
      });

      await assert.rejects(
        async () => client.getMe(),
        (err: any) => {
          assert.equal(err instanceof BrightBeanApiError, true);
          assert.equal(err.statusCode, 401);
          assert.equal(err.message.includes(secretKey), false);
          assert.equal(err.detail?.includes(secretKey), false);
          assert.equal(err.code?.includes(secretKey), false);
          assert.equal(JSON.stringify(err).includes(secretKey), false);
          return true;
        }
      );

      assert.equal(capturedAuthHeader, `Bearer ${secretKey}`);
    });
  });

  // =========================================================================
  // 5. WORKSPACE VALIDATION
  // =========================================================================
  describe('5. Workspace Validation', () => {
    it('A) GET /me/ matching externalScopeId -> connected: true', async () => {
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch((url) => {
        if (url.includes('/me/')) {
          return new Response(JSON.stringify({ workspace_id: 'ws-123' }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({
        connectionService: connService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl,
      });

      const res = await provider.getStatus({
        organizationId: 'org-1',
        connectionId: 'conn-1',
      });

      assert.equal(res.connected, true);
      assert.equal(res.provider, 'BRIGHTBEAN');
      assert.equal(res.workspaceId, 'ws-123');
    });

    it('B) GET /me/ mismatching externalScopeId -> FAIL with BRIGHTBEAN_WORKSPACE_CONTEXT_MISMATCH', async () => {
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch((url) => {
        if (url.includes('/me/')) {
          return new Response(JSON.stringify({ workspace_id: 'ws-OTHER' }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({
        connectionService: connService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl,
      });

      await assert.rejects(
        async () => provider.getStatus({ organizationId: 'org-1', connectionId: 'conn-1' }),
        (err: any) => {
          assert.equal(err instanceof BrightBeanProviderError, true);
          assert.equal(err.code, 'BRIGHTBEAN_WORKSPACE_CONTEXT_MISMATCH');
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it('C) ctx.workspaceId != externalScopeId -> FAIL BEFORE HTTP call', async () => {
      let fetchCalled = false;
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch(() => {
        fetchCalled = true;
        return new Response('OK', { status: 200 });
      });

      const provider = new BrightBeanProvider({
        connectionService: connService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl,
      });

      await assert.rejects(
        async () =>
          provider.getStatus({
            organizationId: 'org-1',
            connectionId: 'conn-1',
            workspaceId: 'ws-DIFFERENT',
          }),
        (err: any) => {
          assert.equal(err instanceof BrightBeanProviderError, true);
          assert.equal(err.code, 'BRIGHTBEAN_WORKSPACE_CONTEXT_MISMATCH');
          return true;
        }
      );

      assert.equal(fetchCalled, false, 'Fetch MUST NOT be called when workspace context mismatches before request');
    });
  });

  // =========================================================================
  // 6. UPLOAD MEDIA
  // =========================================================================
  describe('6. Upload Media', () => {
    it('should send multipart FormData with file field, preserve filename/MIME, send Idempotency-Key, and map response', async () => {
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;
      const connService = createMockConnectionService();

      const fetchImpl = createMockFetch((url, init) => {
        if (url.includes('/media/')) {
          capturedHeaders = (init?.headers as Record<string, string>) || {};
          capturedBody = init?.body;
          return new Response(
            JSON.stringify({
              id: 'media-77',
              url: 'https://cdn.brightbean.test/media-77.mp4',
              mime_type: 'video/mp4',
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
          filename: 'intro.mp4',
          mimeType: 'video/mp4',
          buffer: Buffer.from('fake-video-payload'),
          idempotencyKey: 'idem-upload-key-001',
        }
      );

      assert.equal(result.id, 'media-77');
      assert.equal(result.url, 'https://cdn.brightbean.test/media-77.mp4');
      assert.equal(result.mimeType, 'video/mp4');
      assert.equal(capturedHeaders['Idempotency-Key'], 'idem-upload-key-001');
      assert.equal(capturedHeaders['Content-Type'], undefined, 'Content-Type header must NOT be manually set for FormData');
      assert.notEqual(capturedBody, null);
    });
  });

  // =========================================================================
  // 7. CREATE POST ACTIONS & SCHEDULE
  // =========================================================================
  describe('7. Create Post Actions & Schedule', () => {
    it('A) action = draft when scheduledAt absent and isDraft=true/undefined', async () => {
      let capturedBody: any = null;
      const connService = createMockConnectionService();

      const fetchImpl = createMockFetch((url, init) => {
        if (url.includes('/accounts/')) {
          return new Response(JSON.stringify({ accounts: [{ id: 'acc-1', platform: 'instagram', account_name: 'IG' }] }), { status: 200 });
        }
        if (url.includes('/posts/')) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(JSON.stringify({ id: 'p-draft', status: 'draft', caption: 'Draft', created_at: new Date().toISOString() }), { status: 201 });
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({
        connectionService: connService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl,
      });

      await provider.createPost(
        { organizationId: 'org-1', connectionId: 'conn-1' },
        { accountId: 'acc-1', format: 'FEED', content: 'Rascunho', mediaIds: [] }
      );

      assert.equal(capturedBody.action, 'draft');
      assert.equal(capturedBody.scheduled_at, null);
    });

    it('B) action = schedule when scheduledAt present', async () => {
      let capturedBody: any = null;
      const connService = createMockConnectionService();

      const fetchImpl = createMockFetch((url, init) => {
        if (url.includes('/accounts/')) {
          return new Response(JSON.stringify({ accounts: [{ id: 'acc-1', platform: 'instagram', account_name: 'IG' }] }), { status: 200 });
        }
        if (url.includes('/posts/')) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(JSON.stringify({ id: 'p-sched', status: 'scheduled', caption: 'Sched', scheduled_at: '2026-11-01T10:00:00Z', created_at: new Date().toISOString() }), { status: 201 });
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({
        connectionService: connService,
        apiBaseUrl: 'https://api.brightbean.test/v1',
        fetchImpl,
      });

      await provider.createPost(
        { organizationId: 'org-1', connectionId: 'conn-1' },
        { accountId: 'acc-1', format: 'FEED', content: 'Agendado', mediaIds: [], scheduledAt: '2026-11-01T10:00:00Z' }
      );

      assert.equal(capturedBody.action, 'schedule');
      assert.equal(capturedBody.scheduled_at, '2026-11-01T10:00:00Z');
    });

    it('C) isDraft === false without scheduledAt -> FAIL IMMEDIATE_PUBLISH_NOT_SUPPORTED before POST /posts/', async () => {
      let postFetchCalled = false;
      const connService = createMockConnectionService();

      const fetchImpl = createMockFetch((url) => {
        if (url.includes('/accounts/')) {
          return new Response(JSON.stringify({ accounts: [{ id: 'acc-1', platform: 'instagram', account_name: 'IG' }] }), { status: 200 });
        }
        if (url.includes('/posts/')) {
          postFetchCalled = true;
          return new Response(JSON.stringify({}), { status: 201 });
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
          provider.createPost(
            { organizationId: 'org-1', connectionId: 'conn-1' },
            { accountId: 'acc-1', format: 'FEED', content: 'Publicação Imediata', mediaIds: [], isDraft: false }
          ),
        (err: any) => {
          assert.equal(err instanceof BrightBeanProviderError, true);
          assert.equal(err.code, 'IMMEDIATE_PUBLISH_NOT_SUPPORTED');
          return true;
        }
      );

      assert.equal(postFetchCalled, false, 'POST /posts/ must NOT be called for immediate publish request');
    });
  });

  // =========================================================================
  // 8. FORMAT MATRIX
  // =========================================================================
  describe('8. Format Matrix Validation', () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify({
            accounts: [
              { id: 'acc-ig', platform: 'instagram', account_name: 'IG' },
              { id: 'acc-fb', platform: 'facebook', account_name: 'FB' },
              { id: 'acc-li', platform: 'linkedin', account_name: 'LI' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/media/vid-1')) {
        return new Response(JSON.stringify({ id: 'vid-1', url: 'http://cdn/v.mp4', mime_type: 'video/mp4', media_type: 'VIDEO' }), { status: 200 });
      }
      if (url.includes('/media/img-1')) {
        return new Response(JSON.stringify({ id: 'img-1', url: 'http://cdn/i.png', mime_type: 'image/png', media_type: 'IMAGE' }), { status: 200 });
      }
      if (url.includes('/media/img-2')) {
        return new Response(JSON.stringify({ id: 'img-2', url: 'http://cdn/i2.png', mime_type: 'image/png', media_type: 'IMAGE' }), { status: 200 });
      }
      if (url.includes('/posts/')) {
        return new Response(JSON.stringify({ id: 'post-ok', status: 'draft', caption: 'OK', created_at: new Date().toISOString() }), { status: 201 });
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    it('Facebook + STORY_IMAGE -> BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED', async () => {
      await assert.rejects(
        async () => provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-fb', format: 'STORY_IMAGE', content: 'S', mediaIds: ['img-1'] }),
        (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED'
      );
    });

    it('Facebook + STORY_VIDEO -> BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED', async () => {
      await assert.rejects(
        async () => provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-fb', format: 'STORY_VIDEO', content: 'S', mediaIds: ['vid-1'] }),
        (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED'
      );
    });

    it('LinkedIn + REEL -> BRIGHTBEAN_EXPLICIT_REEL_UNSUPPORTED', async () => {
      await assert.rejects(
        async () => provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-li', format: 'REEL', content: 'R', mediaIds: ['vid-1'] }),
        (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_REEL_UNSUPPORTED'
      );
    });

    it('Instagram + REEL + 1 video -> PERMITIDO', async () => {
      const post = await provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-ig', format: 'REEL', content: 'R', mediaIds: ['vid-1'] });
      assert.equal(post.id, 'post-ok');
    });

    it('Instagram + REEL + image -> BRIGHTBEAN_INVALID_REEL_ASSET', async () => {
      await assert.rejects(
        async () => provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-ig', format: 'REEL', content: 'R', mediaIds: ['img-1'] }),
        (err: any) => err.code === 'BRIGHTBEAN_INVALID_REEL_ASSET'
      );
    });

    it('Instagram + FEED + 1 video -> BRIGHTBEAN_FEED_CONVERTED_TO_REEL', async () => {
      await assert.rejects(
        async () => provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-ig', format: 'FEED', content: 'F', mediaIds: ['vid-1'] }),
        (err: any) => err.code === 'BRIGHTBEAN_FEED_CONVERTED_TO_REEL'
      );
    });

    it('Instagram + CAROUSEL + >= 2 media -> PERMITIDO', async () => {
      const post = await provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-ig', format: 'CAROUSEL', content: 'C', mediaIds: ['img-1', 'img-2'] });
      assert.equal(post.id, 'post-ok');
    });

    it('Instagram + CAROUSEL + < 2 media -> BRIGHTBEAN_INVALID_CAROUSEL', async () => {
      await assert.rejects(
        async () => provider.createPost({ organizationId: 'o', connectionId: 'c' }, { accountId: 'acc-ig', format: 'CAROUSEL', content: 'C', mediaIds: ['img-1'] }),
        (err: any) => err.code === 'BRIGHTBEAN_INVALID_CAROUSEL'
      );
    });
  });

  // =========================================================================
  // 8.1. Post Type Wire Format & Passo 2B5A Specifications
  // =========================================================================
  describe('8.1. Post Type Wire Format & Passo 2B5A Specifications', () => {
    let capturedPayload: any = null;
    let postFetchCalled = false;

    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url, init) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify({
            accounts: [
              { id: 'acc-ig', platform: 'instagram', account_name: 'IG' },
              { id: 'acc-fb', platform: 'facebook', account_name: 'FB' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/media/img-1')) {
        return new Response(JSON.stringify({ id: 'img-1', url: 'http://cdn/i.png', mime_type: 'image/png', media_type: 'IMAGE' }), { status: 200 });
      }
      if (url.includes('/media/img-2')) {
        return new Response(JSON.stringify({ id: 'img-2', url: 'http://cdn/i2.png', mime_type: 'image/png', media_type: 'IMAGE' }), { status: 200 });
      }
      if (url.includes('/media/vid-1')) {
        return new Response(JSON.stringify({ id: 'vid-1', url: 'http://cdn/v.mp4', mime_type: 'video/mp4', media_type: 'VIDEO' }), { status: 200 });
      }
      if (url.includes('/posts/')) {
        postFetchCalled = true;
        capturedPayload = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            id: 'post-test',
            status: 'draft',
            caption: 'Test',
            created_at: new Date().toISOString(),
            platform_posts: [
              {
                social_account_id: capturedPayload.social_account_id,
                platform: 'instagram',
                status: 'draft',
              },
            ],
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

    beforeEach(() => {
      capturedPayload = null;
      postFetchCalled = false;
    });

    // A. Instagram Story imagem: passa; POST /posts recebe post_type = "story"
    it('A. Instagram Story imagem -> passa e payload recebe post_type = "story"', async () => {
      const res = await provider.createPost(
        { organizationId: 'o', connectionId: 'c' },
        { accountId: 'acc-ig', format: 'STORY_IMAGE', content: 'Story Image', mediaIds: ['img-1'] }
      );
      assert.equal(res.id, 'post-test');
      assert.equal(capturedPayload.post_type, 'story');
      assert.equal(capturedPayload.social_account_id, 'acc-ig');
    });

    // B. Instagram Story vídeo: passa; payload recebe story
    it('B. Instagram Story vídeo -> passa e payload recebe post_type = "story"', async () => {
      const res = await provider.createPost(
        { organizationId: 'o', connectionId: 'c' },
        { accountId: 'acc-ig', format: 'STORY_VIDEO', content: 'Story Video', mediaIds: ['vid-1'] }
      );
      assert.equal(res.id, 'post-test');
      assert.equal(capturedPayload.post_type, 'story');
    });

    // C. Facebook Story: fail-closed antes de POST /posts
    it('C. Facebook Story -> fail-closed antes de POST /posts', async () => {
      await assert.rejects(
        async () => provider.createPost(
          { organizationId: 'o', connectionId: 'c' },
          { accountId: 'acc-fb', format: 'STORY_IMAGE', content: 'FB Story', mediaIds: ['img-1'] }
        ),
        (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED'
      );
      assert.equal(postFetchCalled, false, 'POST /posts NÃO deve ser chamado para Facebook Story');
    });

    // D. Instagram Reel vídeo: passa; payload recebe post_type = "reel"
    it('D. Instagram Reel vídeo -> passa e payload recebe post_type = "reel"', async () => {
      const res = await provider.createPost(
        { organizationId: 'o', connectionId: 'c' },
        { accountId: 'acc-ig', format: 'REEL', content: 'IG Reel Video', mediaIds: ['vid-1'] }
      );
      assert.equal(res.id, 'post-test');
      assert.equal(capturedPayload.post_type, 'reel');
    });

    // E. Facebook Reel vídeo: passa; payload recebe post_type = "reel"
    it('E. Facebook Reel vídeo -> passa e payload recebe post_type = "reel"', async () => {
      const res = await provider.createPost(
        { organizationId: 'o', connectionId: 'c' },
        { accountId: 'acc-fb', format: 'REEL', content: 'FB Reel Video', mediaIds: ['vid-1'] }
      );
      assert.equal(res.id, 'post-test');
      assert.equal(capturedPayload.post_type, 'reel');
    });

    // F. Reel imagem: falha antes do POST
    it('F. Reel imagem -> falha antes do POST', async () => {
      await assert.rejects(
        async () => provider.createPost(
          { organizationId: 'o', connectionId: 'c' },
          { accountId: 'acc-ig', format: 'REEL', content: 'Reel Image', mediaIds: ['img-1'] }
        ),
        (err: any) => err.code === 'BRIGHTBEAN_INVALID_REEL_ASSET'
      );
      assert.equal(postFetchCalled, false, 'POST /posts NÃO deve ser chamado para Reel com imagem');
    });

    // G. FEED: payload NÃO contém post_type
    it('G. FEED -> payload NÃO contém post_type', async () => {
      const res = await provider.createPost(
        { organizationId: 'o', connectionId: 'c' },
        { accountId: 'acc-ig', format: 'FEED', content: 'Feed Post', mediaIds: ['img-1'] }
      );
      assert.equal(res.id, 'post-test');
      assert.equal(capturedPayload.post_type, undefined);
      assert.equal('post_type' in capturedPayload, false);
    });

    // H. CAROUSEL: payload NÃO contém post_type
    it('H. CAROUSEL -> payload NÃO contém post_type', async () => {
      const res = await provider.createPost(
        { organizationId: 'o', connectionId: 'c' },
        { accountId: 'acc-ig', format: 'CAROUSEL', content: 'Carousel Post', mediaIds: ['img-1', 'img-2'] }
      );
      assert.equal(res.id, 'post-test');
      assert.equal(capturedPayload.post_type, undefined);
      assert.equal('post_type' in capturedPayload, false);
    });
  });

  // =========================================================================
  // 9. STATUS MAPPING
  // =========================================================================
  describe('9. Status Mapping', () => {
    const connService = createMockConnectionService();

    const statusCases = [
      { remote: 'draft', expected: 'DRAFT' },
      { remote: 'pending_review', expected: 'DRAFT' },
      { remote: 'pending_client', expected: 'DRAFT' },
      { remote: 'approved', expected: 'DRAFT' },
      { remote: 'changes_requested', expected: 'DRAFT' },
      { remote: 'rejected', expected: 'DRAFT' },
      { remote: 'scheduled', expected: 'SCHEDULED' },
      { remote: 'publishing', expected: 'PUBLISHING' },
      { remote: 'published', expected: 'PUBLISHED' },
      { remote: 'failed', expected: 'FAILED' },
      { remote: 'partially_published', expected: 'PARTIALLY_PUBLISHED' },
    ];

    for (const sc of statusCases) {
      it(`should map remote status "${sc.remote}" -> "${sc.expected}"`, async () => {
        const fetchImpl = createMockFetch((url) => {
          if (url.includes('/posts/post-st')) {
            return new Response(JSON.stringify({ id: 'post-st', status: sc.remote, caption: 'Cap', created_at: new Date().toISOString() }), { status: 200 });
          }
          return new Response('Not found', { status: 404 });
        });

        const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });
        const post = await provider.getPost({ organizationId: 'o', connectionId: 'c' }, 'post-st');
        assert.equal(post?.status, sc.expected);
      });
    }

    it('unknown status -> FAIL BRIGHTBEAN_UNKNOWN_POST_STATUS and NEVER default to DRAFT', async () => {
      const fetchImpl = createMockFetch((url) => {
        if (url.includes('/posts/post-unknown')) {
          return new Response(JSON.stringify({ id: 'post-unknown', status: 'UNKNOWN_STATE_X', caption: 'Cap', created_at: new Date().toISOString() }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });
      await assert.rejects(
        async () => provider.getPost({ organizationId: 'o', connectionId: 'c' }, 'post-unknown'),
        (err: any) => err.code === 'BRIGHTBEAN_UNKNOWN_POST_STATUS'
      );
    });
  });

  // =========================================================================
  // 10. GET POST
  // =========================================================================
  describe('10. Get Post', () => {
    it('should map GET /posts/{id} with format=null, caption->content, and platform_posts fields; return null on 404', async () => {
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch((url) => {
        if (url.includes('/posts/post-found')) {
          return new Response(
            JSON.stringify({
              id: 'post-found',
              status: 'published',
              caption: 'Conteúdo da publicação',
              created_at: '2026-09-23T10:00:00Z',
              platform_posts: [
                {
                  social_account_id: 'acc-1',
                  platform: 'instagram',
                  status: 'published',
                  platform_post_id: 'ext-ig-123',
                  publish_error: null,
                  scheduled_at: null,
                  published_at: '2026-09-23T10:05:00Z',
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      const post = await provider.getPost({ organizationId: 'o', connectionId: 'c' }, 'post-found');
      assert.notEqual(post, null);
      assert.equal(post?.id, 'post-found');
      assert.equal(post?.format, null, 'format MUST be null on remote read');
      assert.equal(post?.content, 'Conteúdo da publicação');
      assert.equal(post?.platformStates[0].externalPostId, 'ext-ig-123');
      assert.equal(post?.platformStates[0].publishedAt, '2026-09-23T10:05:00Z');

      const notFound = await provider.getPost({ organizationId: 'o', connectionId: 'c' }, 'post-missing');
      assert.equal(notFound, null);
    });
  });

  // =========================================================================
  // 11. SCHEDULE POST
  // =========================================================================
  describe('11. Schedule Post', () => {
    it('should send POST /posts/{id}/schedule with body { scheduled_at } and return SocialPost with format=null', async () => {
      let capturedBody: any = null;
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch((url, init) => {
        if (url.includes('/posts/post-sched/schedule')) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              id: 'post-sched',
              status: 'scheduled',
              caption: 'Agendado',
              scheduled_at: capturedBody.scheduled_at,
              created_at: new Date().toISOString(),
            }),
            { status: 200 }
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      const post = await provider.schedulePost(
        { organizationId: 'o', connectionId: 'c' },
        { postId: 'post-sched', scheduledAt: '2026-12-01T00:00:00Z' }
      );

      assert.equal(capturedBody.scheduled_at, '2026-12-01T00:00:00Z');
      assert.equal(post.id, 'post-sched');
      assert.equal(post.status, 'SCHEDULED');
      assert.equal(post.format, null);
    });
  });

  // =========================================================================
  // 12. CANCEL POST
  // =========================================================================
  describe('12. Cancel Post', () => {
    it('should POST /posts/{id}/cancel and return { success: true } without synthesizing CANCELLED status', async () => {
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch((url) => {
        if (url.includes('/posts/post-cancel/cancel')) {
          return new Response(JSON.stringify({ message: 'Success' }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      const result = await provider.cancelPost({ organizationId: 'o', connectionId: 'c' }, 'post-cancel');
      assert.equal(result.success, true);
    });
  });

  // =========================================================================
  // 13. ERROR MATRIX & 429 RETRY-AFTER
  // =========================================================================
  describe('13. Error Matrix & 429 Retry-After', () => {
    const errorCodes = [401, 403, 404, 409, 413, 415, 422, 500];

    for (const statusCode of errorCodes) {
      it(`should normalize HTTP ${statusCode} to BrightBeanApiError`, async () => {
        const fetchImpl = createMockFetch(() => {
          return new Response(JSON.stringify({ error: `ERR_${statusCode}`, detail: `Detail ${statusCode}` }), {
            status: statusCode,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const client = new BrightBeanClient({ apiBaseUrl: 'https://api.brightbean.test/v1', apiKey: 'k', fetchImpl });

        await assert.rejects(
          async () => client.getMe(),
          (err: any) => {
            assert.equal(err instanceof BrightBeanApiError, true);
            assert.equal(err.statusCode, statusCode);
            assert.equal(err.code, `ERR_${statusCode}`);
            return true;
          }
        );
      });
    }

    it('HTTP 429 with Retry-After: 60 header should set retryAfterSeconds === 60', async () => {
      const fetchImpl = createMockFetch(() => {
        return new Response(JSON.stringify({ error: 'rate_limited', detail: 'Rate limit' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        });
      });

      const client = new BrightBeanClient({ apiBaseUrl: 'https://api.brightbean.test/v1', apiKey: 'k', fetchImpl });

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
  });

  // =========================================================================
  // 14. NETWORK ERROR
  // =========================================================================
  describe('14. Network Error Handling', () => {
    it('fetchImpl throwing network error should produce BrightBeanApiError with statusCode: 0 and code: NETWORK_ERROR', async () => {
      const fetchImpl = createMockFetch(() => {
        throw new TypeError('Failed to fetch (DNS / Connection refused)');
      });

      const client = new BrightBeanClient({ apiBaseUrl: 'https://api.brightbean.test/v1', apiKey: 'k', fetchImpl });

      await assert.rejects(
        async () => client.getMe(),
        (err: any) => {
          assert.equal(err instanceof BrightBeanApiError, true);
          assert.equal(err.statusCode, 0);
          assert.equal(err.code, 'NETWORK_ERROR');
          assert.equal(err.message.includes('k'), false);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 15. CREDENTIAL RESOLUTION & SECURITY
  // =========================================================================
  describe('15. Credential Resolution & Security', () => {
    it('should obtain credential exclusively via resolveCredential and not leak secret in DTO or error', async () => {
      const connService = createMockConnectionService(undefined, 'secret-vault-key-888');

      let capturedAuth: string | null = null;
      const fetchImpl = createMockFetch((url, init) => {
        capturedAuth = ((init?.headers as Record<string, string>) || {})['Authorization'] || null;
        return new Response(JSON.stringify({ workspace_id: 'ws-123' }), { status: 200 });
      });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      const status = await provider.getStatus({ organizationId: 'org-1', connectionId: 'conn-1' });

      assert.equal(connService.wasResolveCalled(), true);
      assert.equal(capturedAuth, 'Bearer secret-vault-key-888');
      assert.equal(JSON.stringify(status).includes('secret-vault-key-888'), false);
    });
  });

  // =========================================================================
  // 16. CONNECTION STATE VALIDATION
  // =========================================================================
  describe('16. Connection State Validation', () => {
    it('provider != BRIGHTBEAN -> FAIL before network', async () => {
      let fetchCalled = false;
      const connService = createMockConnectionService({ id: 'c1', organizationId: 'o1', provider: 'POSTIZ', status: 'ACTIVE', externalScopeId: 'ws' });
      const fetchImpl = createMockFetch(() => { fetchCalled = true; return new Response(''); });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      await assert.rejects(
        async () => provider.getStatus({ organizationId: 'o1', connectionId: 'c1' }),
        (err: any) => err.code === 'BRIGHTBEAN_CONNECTION_INACTIVE'
      );
      assert.equal(fetchCalled, false);
    });

    it('status != ACTIVE -> FAIL before network', async () => {
      let fetchCalled = false;
      const connService = createMockConnectionService({ id: 'c1', organizationId: 'o1', provider: 'BRIGHTBEAN', status: 'DISCONNECTED', externalScopeId: 'ws' });
      const fetchImpl = createMockFetch(() => { fetchCalled = true; return new Response(''); });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      await assert.rejects(
        async () => provider.getStatus({ organizationId: 'o1', connectionId: 'c1' }),
        (err: any) => err.code === 'BRIGHTBEAN_CONNECTION_INACTIVE'
      );
      assert.equal(fetchCalled, false);
    });

    it('externalScopeId missing -> FAIL before network', async () => {
      let fetchCalled = false;
      const connService = createMockConnectionService({ id: 'c1', organizationId: 'o1', provider: 'BRIGHTBEAN', status: 'ACTIVE', externalScopeId: null });
      const fetchImpl = createMockFetch(() => { fetchCalled = true; return new Response(''); });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      await assert.rejects(
        async () => provider.getStatus({ organizationId: 'o1', connectionId: 'c1' }),
        (err: any) => err.code === 'BRIGHTBEAN_MISSING_WORKSPACE_ID'
      );
      assert.equal(fetchCalled, false);
    });

    it('connectionId missing -> FAIL before network', async () => {
      let fetchCalled = false;
      const connService = createMockConnectionService();
      const fetchImpl = createMockFetch(() => { fetchCalled = true; return new Response(''); });

      const provider = new BrightBeanProvider({ connectionService: connService, apiBaseUrl: 'https://api.brightbean.test/v1', fetchImpl });

      await assert.rejects(
        async () => provider.getStatus({ organizationId: 'o1' } as any),
        (err: any) => err.code === 'BRIGHTBEAN_CONNECTION_REQUIRED'
      );
      assert.equal(fetchCalled, false);
    });
  });

  // =========================================================================
  // 17 & 18. PRESERVED 2B4B.1 WIRE FORMAT REAL TESTS
  // =========================================================================
  describe('17 & 18. Preserved 2B4B.1 Wire Format Real Tests', () => {
    it('2B4B.1: 2xx response with invalid JSON body must fail closed with BRIGHTBEAN_INVALID_RESPONSE', async () => {
      const fetchImpl = createMockFetch(() => {
        return new Response('<html>Disguised 200</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      });

      const client = new BrightBeanClient({ apiBaseUrl: 'https://api.brightbean.test/v1', apiKey: 'k', fetchImpl });

      await assert.rejects(
        async () => client.getMe(),
        (err: any) => {
          assert.equal(err instanceof BrightBeanApiError, true);
          assert.equal(err.code, 'BRIGHTBEAN_INVALID_RESPONSE');
          return true;
        }
      );
    });

    it('2B4B.1: BrightBeanProvider without apiBaseUrl must fail immediately on constructor', () => {
      const connService = createMockConnectionService();
      assert.throws(
        () => new BrightBeanProvider({ connectionService: connService, apiBaseUrl: '' }),
        (err: any) => err.code === 'BRIGHTBEAN_CONFIG_ERROR'
      );
    });
  });
});
