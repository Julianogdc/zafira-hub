import {
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialAccount,
  SocialAccountAnalytics,
  SocialContentFormat,
  SocialMediaAsset,
  SocialMediaType,
  SocialMediaUploadResult,
  SocialPlatform,
  SocialPlatformPostState,
  SocialPost,
  SocialPostAnalytics,
  SocialPostStatus,
  SocialPublisherStatus,
} from '@zafira/contracts';
import {
  SocialMediaUploadInput,
  SocialPostListFilters,
  SocialPostListResult,
  SocialPublisherContext,
  SocialPublisherProvider,
} from '../social-publisher/social-publisher.provider.js';
import { IntegrationConnectionService } from '../connections/integration-connection.service.js';
import { BrightBeanClient } from './brightbean.client.js';
import {
  BrightBeanAccount,
  BrightBeanCreatePostPayload,
  BrightBeanDerivedMetric,
  BrightBeanMediaSummary,
  BrightBeanPlatformPost,
  BrightBeanPostMetricTile,
  BrightBeanPostResponse,
} from './brightbean.types.js';

export class BrightBeanProviderError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = 'BrightBeanProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface BrightBeanProviderOptions {
  connectionService: IntegrationConnectionService;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

export class BrightBeanProvider implements SocialPublisherProvider {
  private readonly connectionService: IntegrationConnectionService;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: BrightBeanProviderOptions) {
    if (!options.apiBaseUrl) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_CONFIG_ERROR',
        'apiBaseUrl é obrigatório para o BrightBeanProvider',
        500
      );
    }
    this.connectionService = options.connectionService;
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl;
  }

  private async resolveClientAndConnection(ctx: SocialPublisherContext): Promise<{
    client: BrightBeanClient;
    connection: any;
  }> {
    if (!ctx.connectionId) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_CONNECTION_REQUIRED',
        'connectionId é obrigatório para operações com o provedor BrightBean',
        400
      );
    }

    const connection = await this.connectionService.getConnection(
      ctx.organizationId,
      ctx.connectionId
    );

    if (
      connection.provider !== 'BRIGHTBEAN' ||
      connection.status !== 'ACTIVE'
    ) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_CONNECTION_INACTIVE',
        'Conexão BrightBean inexistente ou inativa',
        400
      );
    }

    if (!connection.externalScopeId) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_MISSING_WORKSPACE_ID',
        'Conexão BrightBean não possui externalScopeId (workspace ID)',
        400
      );
    }

    if (ctx.workspaceId && ctx.workspaceId !== connection.externalScopeId) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_WORKSPACE_CONTEXT_MISMATCH',
        `Workspace ID informado no contexto (${ctx.workspaceId}) difere da conexão (${connection.externalScopeId})`,
        403
      );
    }

    const apiKey = await this.connectionService.resolveCredential(
      ctx.organizationId,
      ctx.connectionId
    );

    const client = new BrightBeanClient({
      apiBaseUrl: this.apiBaseUrl,
      apiKey,
      fetchImpl: this.fetchImpl,
    });

    return { client, connection };
  }

  private mapPlatform(platform: string): SocialPlatform {
    const upper = platform.toUpperCase();
    if (upper === 'INSTAGRAM_LOGIN' || upper === 'INSTAGRAM') return 'INSTAGRAM';
    if (upper === 'FACEBOOK') return 'FACEBOOK';
    if (upper === 'LINKEDIN') return 'LINKEDIN';
    if (upper === 'TIKTOK') return 'TIKTOK';
    if (upper === 'YOUTUBE') return 'YOUTUBE';
    if (upper === 'TWITTER' || upper === 'TWITTER_X' || upper === 'X') return 'TWITTER_X';
    return upper;
  }

  private mapStatusToHub(status: string): SocialPostStatus {
    const s = status.toLowerCase();
    switch (s) {
      case 'draft':
      case 'pending_review':
      case 'pending_client':
      case 'approved':
      case 'changes_requested':
      case 'rejected':
        return 'DRAFT';
      case 'scheduled':
        return 'SCHEDULED';
      case 'publishing':
        return 'PUBLISHING';
      case 'published':
        return 'PUBLISHED';
      case 'failed':
        return 'FAILED';
      case 'partially_published':
        return 'PARTIALLY_PUBLISHED';
      default:
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_UNKNOWN_POST_STATUS',
          `Status desconhecido recebido da API BrightBean: ${status}`,
          500
        );
    }
  }

  private async validateFormatCompatibility(
    client: BrightBeanClient,
    account: BrightBeanAccount,
    input: CreateSocialPostInput
  ): Promise<void> {
    const platform = this.mapPlatform(account.platform);
    const format = input.format;
    const mediaIds = input.mediaIds || [];

    if (format === 'STORY_IMAGE' || format === 'STORY_VIDEO' || (format as any) === 'STORY') {
      if (platform !== 'INSTAGRAM') {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED',
          'Story é suportado apenas para Instagram na BrightBean.',
          422
        );
      }
      if (mediaIds.length !== 1) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_INVALID_STORY_ASSET',
          'Story no Instagram exige exatamente 1 mídia.',
          422
        );
      }
      const media = await client.getMedia(mediaIds[0]);
      const isImage =
        media.media_type === 'IMAGE' ||
        (media.mime_type && media.mime_type.startsWith('image/'));
      const isVideo =
        media.media_type === 'VIDEO' ||
        (media.mime_type && media.mime_type.startsWith('video/'));
      if (!isImage && !isVideo) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_INVALID_STORY_ASSET',
          'Story no Instagram exige arquivo de imagem ou vídeo.',
          422
        );
      }
      return;
    }

    if (format === 'REEL') {
      if (platform !== 'INSTAGRAM' && platform !== 'FACEBOOK') {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_EXPLICIT_REEL_UNSUPPORTED',
          'Reel na BrightBean é suportado apenas no Instagram e Facebook.',
          422
        );
      }
      if (mediaIds.length !== 1) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_INVALID_REEL_ASSET',
          `Reel no ${platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'} exige exatamente 1 mídia de vídeo.`,
          422
        );
      }
      const media = await client.getMedia(mediaIds[0]);
      const isVideo =
        media.media_type === 'VIDEO' ||
        (media.mime_type && media.mime_type.startsWith('video/'));
      if (!isVideo) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_INVALID_REEL_ASSET',
          `Reel no ${platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'} exige arquivo de vídeo.`,
          422
        );
      }
      return;
    }

    if (format === 'CAROUSEL') {
      if (mediaIds.length < 2) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_INVALID_CAROUSEL',
          'Carousel exige no mínimo 2 mídias.',
          422
        );
      }
      if (platform !== 'INSTAGRAM' && platform !== 'THREADS') {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_CAROUSEL_UNSUPPORTED',
          'Formato Carousel não é suportado no provider para esta plataforma.',
          422
        );
      }
      return;
    }

    if (format === 'FEED') {
      if (platform === 'INSTAGRAM') {
        if (mediaIds.length === 1) {
          const media = await client.getMedia(mediaIds[0]);
          const isVideo =
            media.media_type === 'VIDEO' ||
            (media.mime_type && media.mime_type.startsWith('video/'));
          if (isVideo) {
            throw new BrightBeanProviderError(
              'BRIGHTBEAN_FEED_CONVERTED_TO_REEL',
              'Instagram com vídeo único seria publicado como Reel pela BrightBean, rejeitando pedido de Feed para evitar conversão indesejada.',
              422
            );
          }
        } else if (mediaIds.length > 1) {
          throw new BrightBeanProviderError(
            'BRIGHTBEAN_FEED_CONVERTED_TO_CAROUSEL',
            'Instagram com múltiplas mídias seria publicado como Carousel pela BrightBean, rejeitando pedido de Feed.',
            422
          );
        }
      }
      return;
    }
  }

  async getStatus(ctx: SocialPublisherContext): Promise<SocialPublisherStatus> {
    try {
      const { client, connection } = await this.resolveClientAndConnection(ctx);
      const me = await client.getMe();

      if (me.workspace_id !== connection.externalScopeId) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_WORKSPACE_CONTEXT_MISMATCH',
          `Workspace retornado pela API (${me.workspace_id}) difere da conexão (${connection.externalScopeId})`,
          403
        );
      }

      return {
        connected: true,
        provider: 'BRIGHTBEAN',
        workspaceId: connection.externalScopeId,
      };
    } catch (err: any) {
      if (err instanceof BrightBeanProviderError) {
        throw err;
      }
      if (err?.statusCode === 401 || err?.statusCode === 403) {
        return {
          connected: false,
          provider: 'BRIGHTBEAN',
        };
      }
      throw err;
    }
  }

  async listAccounts(ctx: SocialPublisherContext): Promise<SocialAccount[]> {
    const { client, connection } = await this.resolveClientAndConnection(ctx);
    const response = await client.listAccounts();
    const accounts = response.accounts || [];

    return accounts.map((acc: BrightBeanAccount) => ({
      id: acc.id,
      platform: this.mapPlatform(acc.platform),
      accountName: acc.account_name,
      accountHandle: acc.account_handle ?? null,
      connectionStatus: acc.connection_status ?? null,
      accountPicture: null,
      profileUrl: null,
      workspaceId: connection.externalScopeId,
      capabilities: {
        charLimit: acc.char_limit ?? null,
        escapedChars: acc.escaped_chars ?? null,
        needsTitle: acc.needs_title ?? null,
        supportsFirstComment: acc.supports_first_comment ?? null,
      },
    }));
  }

  async uploadMedia(
    ctx: SocialPublisherContext,
    input: SocialMediaUploadInput
  ): Promise<SocialMediaUploadResult> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.uploadMedia({
      filename: input.filename,
      mimeType: input.mimeType,
      buffer: input.buffer,
      idempotencyKey: input.idempotencyKey,
    });

    return {
      id: res.id,
      url: res.url,
      mimeType: res.mime_type,
    };
  }

  async createPost(
    ctx: SocialPublisherContext,
    input: CreateSocialPostInput
  ): Promise<SocialPost> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const response = await client.listAccounts();
    const accounts = response.accounts || [];
    const targetAccount = accounts.find((a: BrightBeanAccount) => a.id === input.accountId);

    if (!targetAccount) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_ACCOUNT_NOT_FOUND',
        `Social account ${input.accountId} não pertence ao workspace da conexão`,
        404
      );
    }

    await this.validateFormatCompatibility(client, targetAccount, input);

    let action: 'draft' | 'schedule';
    let scheduled_at: string | null = null;

    if (input.scheduledAt) {
      action = 'schedule';
      scheduled_at = input.scheduledAt;
    } else if (input.isDraft === false) {
      throw new BrightBeanProviderError(
        'IMMEDIATE_PUBLISH_NOT_SUPPORTED',
        'BrightBean v1 REST apenas suporta draft ou schedule, publicação imediata não é suportada sem agendamento',
        422
      );
    } else {
      action = 'draft';
    }

    let post_type: 'story' | 'reel' | undefined;
    if (input.format === 'STORY_IMAGE' || input.format === 'STORY_VIDEO' || (input.format as any) === 'STORY') {
      post_type = 'story';
    } else if (input.format === 'REEL') {
      post_type = 'reel';
    }

    const payload: BrightBeanCreatePostPayload = {
      social_account_id: input.accountId,
      caption: input.content,
      media_asset_ids: input.mediaIds,
      action,
      scheduled_at,
      ...(post_type ? { post_type } : {}),
    };

    const res = await client.createPost(payload, input.idempotencyKey);
    return this.mapCanonicalPost(res, input.format);
  }

  private mapCanonicalPost(
    res: BrightBeanPostResponse,
    fallbackFormat?: SocialContentFormat | null
  ): SocialPost {
    const mediaItems: SocialMediaAsset[] = (res.media_assets || []).map((ma) => {
      let mediaType: SocialMediaType = 'IMAGE';
      if (ma.media_type === 'video' || ma.mime_type.startsWith('video/')) {
        mediaType = 'VIDEO';
      } else if (ma.media_type === 'image' || ma.mime_type.startsWith('image/')) {
        mediaType = 'IMAGE';
      } else {
        mediaType = 'OTHER';
      }
      return {
        id: ma.id,
        url: ma.url,
        mimeType: ma.mime_type,
        mediaType,
      };
    });

    const platformStates: SocialPlatformPostState[] = (
      res.platform_posts || []
    ).map((pp: BrightBeanPlatformPost) => ({
      accountId: pp.social_account_id,
      platform: this.mapPlatform(pp.platform),
      status: this.mapStatusToHub(pp.status),
      externalPostId: pp.platform_post_id ?? null,
      permalink: pp.permalink_url || null,
      error: pp.publish_error ?? null,
      scheduledAt: pp.scheduled_at ?? null,
      publishedAt: pp.published_at ?? null,
    }));

    // Determinação canônica estrita do formato (Passo 2C2.1.1 - Fail-Closed):
    // 1. post_type=story + EXATAMENTE 1 IMAGE -> STORY_IMAGE
    // 2. post_type=story + EXATAMENTE 1 VIDEO -> STORY_VIDEO
    // 3. post_type=story + 0 mídias / >1 mídia / OTHER -> erro BRIGHTBEAN_UNREPRESENTABLE_FORMAT
    // 4. post_type=reel + EXATAMENTE 1 VIDEO -> REEL
    // 5. post_type=reel + qualquer outra combinação -> erro BRIGHTBEAN_UNREPRESENTABLE_FORMAT
    // 6. sem post_type + mediaItems.length >= 2 -> CAROUSEL
    // 7. sem post_type + 0 mídia -> FEED
    // 8. sem post_type + 1 IMAGE -> FEED
    // 9. sem post_type + 1 VIDEO -> erro BRIGHTBEAN_UNREPRESENTABLE_FORMAT
    const postType = res.platform_posts?.find((pp) => pp.post_type)?.post_type;

    let format: SocialContentFormat;

    if (postType === 'story') {
      if (mediaItems.length === 1 && mediaItems[0].mediaType === 'IMAGE') {
        format = 'STORY_IMAGE';
      } else if (mediaItems.length === 1 && mediaItems[0].mediaType === 'VIDEO') {
        format = 'STORY_VIDEO';
      } else {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_UNREPRESENTABLE_FORMAT',
          `Story exige exatamente 1 mídia IMAGE ou VIDEO. Encontrado: ${mediaItems.length} mídia(s).`,
          422
        );
      }
    } else if (postType === 'reel') {
      if (mediaItems.length === 1 && mediaItems[0].mediaType === 'VIDEO') {
        format = 'REEL';
      } else {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_UNREPRESENTABLE_FORMAT',
          `Reel exige exatamente 1 mídia VIDEO. Encontrado: ${mediaItems.length} mídia(s).`,
          422
        );
      }
    } else if (!postType) {
      if (mediaItems.length >= 2) {
        format = 'CAROUSEL';
      } else if (mediaItems.length === 0) {
        format = 'FEED';
      } else if (mediaItems.length === 1) {
        if (mediaItems[0].mediaType === 'IMAGE') {
          format = 'FEED';
        } else {
          throw new BrightBeanProviderError(
            'BRIGHTBEAN_UNREPRESENTABLE_FORMAT',
            'Publicação com 1 vídeo sem post_type não pode ser representada de forma canônica.',
            422
          );
        }
      } else {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_UNREPRESENTABLE_FORMAT',
          'Combinação de mídia inválida sem post_type.',
          422
        );
      }
    } else {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_UNREPRESENTABLE_FORMAT',
        `post_type desconhecido recebido da API BrightBean: ${postType}`,
        422
      );
    }

    return {
      id: res.id,
      status: this.mapStatusToHub(res.status),
      content: res.caption,
      format,
      scheduledAt: res.scheduled_at ?? null,
      publishedAt: res.published_at ?? null,
      createdAt: res.created_at,
      platformStates,
      mediaItems,
    };
  }

  async listPosts(
    ctx: SocialPublisherContext,
    filters?: SocialPostListFilters
  ): Promise<SocialPostListResult> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.listPosts({
      social_account_id: filters?.socialAccountId,
      status: filters?.status,
      limit: filters?.limit,
      offset: filters?.offset,
    });

    const posts = res.items.map((item) => this.mapCanonicalPost(item));

    return {
      posts,
      total: res.total,
      limit: res.limit,
      offset: res.offset,
    };
  }


  async getPost(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<SocialPost | null> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.getPost(postId);
    if (!res) return null;

    return this.mapCanonicalPost(res);
  }

  async schedulePost(
    ctx: SocialPublisherContext,
    input: ScheduleSocialPostInput
  ): Promise<SocialPost> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.schedulePost(input.postId, input.scheduledAt);
    return this.mapCanonicalPost(res);
  }

  async cancelPost(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<{ success: boolean }> {
    const { client } = await this.resolveClientAndConnection(ctx);
    return client.cancelPost(postId);
  }

  async getPostAnalytics(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<SocialPostAnalytics | null> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.getPostAnalytics(postId);

    if (!res || !res.platform_posts || res.platform_posts.length === 0) {
      return null;
    }

    if (res.platform_posts.length > 1) {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_MULTI_ACCOUNT_ANALYTICS_UNREPRESENTABLE',
        'O contrato canônico atual não representa múltiplos platform_posts em analytics.',
        422
      );
    }

    const pp = res.platform_posts[0];
    if (pp.analytics_available === false) {
      return {
        impressions: null,
        reach: null,
        likes: null,
        comments: null,
        shares: null,
        saves: null,
        clicks: null,
        videoViews: null,
        watchTime: null,
        engagementRate: null,
      };
    }

    const tiles = pp.metric_tiles || [];
    const findTile = (key: string): number | null => {
      const tile = tiles.find((t: BrightBeanPostMetricTile) => t.key === key);
      return tile !== undefined && tile !== null ? tile.value : null;
    };

    return {
      impressions: findTile('impressions'),
      reach: findTile('reach'),
      likes: findTile('likes'),
      comments: findTile('comments'),
      shares: findTile('shares'),
      saves: findTile('saves'),
      clicks: findTile('clicks'),
      videoViews: findTile('views'),
      watchTime: findTile('watch_time'),
      engagementRate: findTile('engagement'),
    };
  }

  async getAccountAnalytics(
    ctx: SocialPublisherContext,
    accountId: string,
    period?: { startDate?: string; endDate?: string }
  ): Promise<SocialAccountAnalytics | null> {
    const { client } = await this.resolveClientAndConnection(ctx);

    let days = 30;
    if (period?.startDate && period?.endDate) {
      const start = new Date(period.startDate).getTime();
      const end = new Date(period.endDate).getTime();
      if (!isNaN(start) && !isNaN(end) && end > start) {
        const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        days = Math.min(Math.max(diffDays, 7), 90);
      }
    }

    const res = await client.getAccountAnalytics(accountId, days);
    if (!res) return null;

    if (res.analytics_available === false) {
      return {
        followerCount: null,
        followingCount: null,
        postCount: null,
        profileViews: null,
        websiteClicks: null,
        periodStart: null,
        periodEnd: null,
      };
    }

    const heroMetrics = res.hero_metrics || [];
    const findHero = (key: string): number | null => {
      const metric = heroMetrics.find((m: BrightBeanDerivedMetric) => m.key === key);
      return metric !== undefined && metric !== null ? metric.value : null;
    };

    return {
      followerCount: null, // NÃO mapear follower_growth para followerCount
      followingCount: null,
      postCount: null,
      profileViews: findHero('profile_views'),
      websiteClicks: findHero('website_clicks'),
      periodStart: null,
      periodEnd: null,
    };
  }
}
