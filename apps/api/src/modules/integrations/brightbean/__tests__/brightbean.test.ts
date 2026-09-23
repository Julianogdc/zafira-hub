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

describe('BrightBean Client & Provider Wire Format Alignment (PASSO 2B4B.1)', () => {
  // A) ACCOUNTS LIST WRAPPER
  it('A) GET /accounts/ must return wrapper object { accounts: [...] } and provider maps response.accounts correctly', async () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify({
            accounts: [
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
  });

  // B) POST ANALYTICS WITH 1 CHILD METRIC_TILES
  it('B) Post analytics with 1 child should map metric_tiles by key and leave absent metrics null', async () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/analytics/posts/post-analytics-1')) {
        return new Response(
          JSON.stringify({
            post_id: 'post-analytics-1',
            workspace_id: 'ws-123',
            title: 'Post 1',
            caption: 'Caption',
            platform_posts: [
              {
                platform_post_id: 'ext-p-1',
                social_account_id: 'acc-1',
                platform: 'instagram',
                status: 'published',
                analytics_available: true,
                metric_tiles: [
                  { key: 'reach', label: 'Alcance', kind: 'counter', value: 500, series: [], is_primary: true },
                  { key: 'views', label: 'Visualizações', kind: 'counter', value: 1200, series: [], is_primary: false },
                  { key: 'likes', label: 'Curtidas', kind: 'counter', value: 75, series: [], is_primary: false },
                ],
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

    const analytics = await provider.getPostAnalytics(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      'post-analytics-1'
    );

    assert.notEqual(analytics, null);
    assert.equal(analytics?.reach, 500);
    assert.equal(analytics?.videoViews, 1200);
    assert.equal(analytics?.likes, 75);
    assert.equal(analytics?.impressions, null);
    assert.equal(analytics?.comments, null);
  });

  // C) POST ANALYTICS MULTI-CHILD
  it('C) Post analytics with 2 platform_posts should fail with BRIGHTBEAN_MULTI_ACCOUNT_ANALYTICS_UNREPRESENTABLE', async () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/analytics/posts/post-multi')) {
        return new Response(
          JSON.stringify({
            post_id: 'post-multi',
            workspace_id: 'ws-123',
            title: 'Multi',
            caption: 'Multi',
            platform_posts: [
              { platform_post_id: 'ext-1', social_account_id: 'acc-1', platform: 'instagram', status: 'published', analytics_available: true, metric_tiles: [] },
              { platform_post_id: 'ext-2', social_account_id: 'acc-2', platform: 'facebook', status: 'published', analytics_available: true, metric_tiles: [] },
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

    await assert.rejects(
      async () =>
        provider.getPostAnalytics(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          'post-multi'
        ),
      (err: any) => {
        assert.equal(err instanceof BrightBeanProviderError, true);
        assert.equal(err.code, 'BRIGHTBEAN_MULTI_ACCOUNT_ANALYTICS_UNREPRESENTABLE');
        return true;
      }
    );
  });

  // D) ACCOUNT ANALYTICS FOLLOWER GROWTH NOT MAPPED TO FOLLOWER COUNT
  it('D) Account analytics with follower_growth must NOT map to followerCount', async () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/analytics/accounts/acc-growth')) {
        return new Response(
          JSON.stringify({
            account_id: 'acc-growth',
            platform: 'instagram',
            account_name: 'Insta',
            connection_status: 'CONNECTED',
            days: 30,
            analytics_available: true,
            hero_metrics: [
              { key: 'profile_views', label: 'Visitas', kind: 'counter', value: 350, delta: 10, series: [] },
            ],
            follower_growth: {
              key: 'followers',
              label: 'Crescimento',
              kind: 'delta',
              value: 42,
              delta: 5,
              series: [],
            },
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

    const analytics = await provider.getAccountAnalytics(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      'acc-growth'
    );

    assert.notEqual(analytics, null);
    assert.equal(analytics?.followerCount, null); // NÃO deve ser 42!
    assert.equal(analytics?.profileViews, 350);
  });

  // E) ANALYTICS_AVAILABLE = FALSE
  it('E) analytics_available=false should return null metrics without artificial zeroes', async () => {
    const connService = createMockConnectionService();
    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/analytics/accounts/acc-unavailable')) {
        return new Response(
          JSON.stringify({
            account_id: 'acc-unavailable',
            platform: 'instagram',
            account_name: 'Insta',
            connection_status: 'CONNECTED',
            days: 30,
            analytics_available: false,
            unavailable_reason: 'Sync in progress',
            hero_metrics: [],
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

    const analytics = await provider.getAccountAnalytics(
      { organizationId: 'org-1', connectionId: 'conn-1' },
      'acc-unavailable'
    );

    assert.notEqual(analytics, null);
    assert.equal(analytics?.followerCount, null);
    assert.equal(analytics?.profileViews, null);
  });

  // F) ERROR ENVELOPE
  it('F) Error envelope with error property should normalize code correctly', async () => {
    const fetchImpl = createMockFetch(() => {
      return new Response(
        JSON.stringify({ error: 'rate_limited', detail: 'Too many requests' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
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
        assert.equal(err.code, 'rate_limited');
        assert.equal(err.detail, 'Too many requests');
        return true;
      }
    );
  });

  // G) 2XX WITH INVALID JSON -> FAIL-CLOSED
  it('G) 2xx response with invalid JSON body must fail closed with BRIGHTBEAN_INVALID_RESPONSE', async () => {
    const fetchImpl = createMockFetch(() => {
      return new Response('<html>Error page disguised as 200</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
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
        assert.equal(err.code, 'BRIGHTBEAN_INVALID_RESPONSE');
        return true;
      }
    );
  });

  // H) MANDATORY API BASE URL
  it('H) BrightBeanProvider without apiBaseUrl must fail immediately on constructor', () => {
    const connService = createMockConnectionService();
    assert.throws(
      () =>
        new BrightBeanProvider({
          connectionService: connService,
          apiBaseUrl: '',
        }),
      (err: any) => {
        assert.equal(err instanceof BrightBeanProviderError, true);
        assert.equal(err.code, 'BRIGHTBEAN_CONFIG_ERROR');
        return true;
      }
    );
  });

  // PRESERVED TESTS FROM 2B4B
  it('PRESERVED: Auth Bearer header and security', async () => {
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
        assert.equal(err.message.includes('secret-api-key-999'), false);
        return true;
      }
    );

    assert.equal(capturedAuthHeader, 'Bearer secret-api-key-999');
  });

  it('PRESERVED: Format validation rules (Story, FB Reel, IG Reel, Feed Video)', async () => {
    const connService = createMockConnectionService();

    const fetchImpl = createMockFetch((url) => {
      if (url.includes('/accounts/')) {
        return new Response(
          JSON.stringify({
            accounts: [
              { id: 'acc-inst', platform: 'instagram', account_name: 'Insta' },
              { id: 'acc-fb', platform: 'facebook', account_name: 'FB' },
            ],
          }),
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
      return new Response('Not found', { status: 404 });
    });

    const provider = new BrightBeanProvider({
      connectionService: connService,
      apiBaseUrl: 'https://api.brightbean.test/v1',
      fetchImpl,
    });

    // STORY_IMAGE -> FAIL
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-inst', format: 'STORY_IMAGE', content: 'Story', mediaIds: ['img-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED'
    );

    // Facebook + REEL -> FAIL
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-fb', format: 'REEL', content: 'Reel FB', mediaIds: ['vid-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_EXPLICIT_REEL_UNSUPPORTED'
    );

    // Instagram + video feed -> FAIL (convertido em Reel)
    await assert.rejects(
      async () =>
        provider.createPost(
          { organizationId: 'org-1', connectionId: 'conn-1' },
          { accountId: 'acc-inst', format: 'FEED', content: 'Feed Vid', mediaIds: ['vid-1'] }
        ),
      (err: any) => err.code === 'BRIGHTBEAN_FEED_CONVERTED_TO_REEL'
    );
  });
});
