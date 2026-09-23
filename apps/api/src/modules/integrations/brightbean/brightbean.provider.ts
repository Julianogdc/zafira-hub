import {
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialAccount,
  SocialAccountAnalytics,
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
  SocialPublisherContext,
  SocialPublisherProvider,
} from '../social-publisher/social-publisher.provider.js';
import { IntegrationConnectionService } from '../connections/integration-connection.service.js';
import { BrightBeanClient } from './brightbean.client.js';
import { BrightBeanAccount, BrightBeanMediaAsset, BrightBeanPlatformPost } from './brightbean.types.js';

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
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class BrightBeanProvider implements SocialPublisherProvider {
  private readonly connectionService: IntegrationConnectionService;
  private readonly defaultApiBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: BrightBeanProviderOptions) {
    this.connectionService = options.connectionService;
    this.defaultApiBaseUrl =
      options.apiBaseUrl || 'https://brightbean.example/api/v1';
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
      apiBaseUrl: this.defaultApiBaseUrl,
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

    if (format === 'STORY_IMAGE' || format === 'STORY_VIDEO') {
      throw new BrightBeanProviderError(
        'BRIGHTBEAN_EXPLICIT_STORY_UNSUPPORTED',
        'REST v1 não expõe post_type/platform_extra necessário para solicitar Story explicitamente.',
        422
      );
    }

    if (format === 'REEL') {
      if (platform !== 'INSTAGRAM') {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_EXPLICIT_REEL_UNSUPPORTED',
          'Facebook Reel não suportado sem hint explícito platform_extra.post_type=reel na REST v1.',
          422
        );
      }
      if (mediaIds.length !== 1) {
        throw new BrightBeanProviderError(
          'BRIGHTBEAN_INVALID_REEL_ASSET',
          'Reel no Instagram exige exatamente 1 mídia de vídeo.',
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
          'Reel no Instagram exige arquivo de vídeo.',
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
      // Se for erro de autenticação (401/403 de credencial), retorna connected: false
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
    const accounts = await client.listAccounts();

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
    const accounts = await client.listAccounts();
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

    const payload = {
      social_account_id: input.accountId,
      caption: input.content,
      media_asset_ids: input.mediaIds,
      action,
      scheduled_at,
    };

    const res = await client.createPost(payload, input.idempotencyKey);

    const platformStates: SocialPlatformPostState[] = (
      res.platform_posts || []
    ).map((pp: BrightBeanPlatformPost) => ({
      accountId: pp.social_account_id,
      platform: this.mapPlatform(pp.platform),
      status: this.mapStatusToHub(pp.status),
      externalPostId: pp.platform_post_id ?? null,
      error: pp.publish_error ?? null,
      scheduledAt: pp.scheduled_at ?? null,
      publishedAt: pp.published_at ?? null,
    }));

    return {
      id: res.id,
      status: this.mapStatusToHub(res.status),
      content: res.caption,
      format: input.format,
      scheduledAt: res.scheduled_at ?? null,
      publishedAt: res.published_at ?? null,
      createdAt: res.created_at,
      platformStates,
    };
  }

  async getPost(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<SocialPost | null> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.getPost(postId);
    if (!res) return null;

    const platformStates: SocialPlatformPostState[] = (
      res.platform_posts || []
    ).map((pp: BrightBeanPlatformPost) => ({
      accountId: pp.social_account_id,
      platform: this.mapPlatform(pp.platform),
      status: this.mapStatusToHub(pp.status),
      externalPostId: pp.platform_post_id ?? null,
      error: pp.publish_error ?? null,
      scheduledAt: pp.scheduled_at ?? null,
      publishedAt: pp.published_at ?? null,
    }));

    return {
      id: res.id,
      status: this.mapStatusToHub(res.status),
      content: res.caption,
      format: null, // NÃO inferir formato na leitura remota
      scheduledAt: res.scheduled_at ?? null,
      publishedAt: res.published_at ?? null,
      createdAt: res.created_at,
      platformStates,
    };
  }

  async schedulePost(
    ctx: SocialPublisherContext,
    input: ScheduleSocialPostInput
  ): Promise<SocialPost> {
    const { client } = await this.resolveClientAndConnection(ctx);
    const res = await client.schedulePost(input.postId, input.scheduledAt);

    const platformStates: SocialPlatformPostState[] = (
      res.platform_posts || []
    ).map((pp: BrightBeanPlatformPost) => ({
      accountId: pp.social_account_id,
      platform: this.mapPlatform(pp.platform),
      status: this.mapStatusToHub(pp.status),
      externalPostId: pp.platform_post_id ?? null,
      error: pp.publish_error ?? null,
      scheduledAt: pp.scheduled_at ?? null,
      publishedAt: pp.published_at ?? null,
    }));

    return {
      id: res.id,
      status: this.mapStatusToHub(res.status),
      content: res.caption,
      format: null,
      scheduledAt: res.scheduled_at ?? null,
      publishedAt: res.published_at ?? null,
      createdAt: res.created_at,
      platformStates,
    };
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
    if (!res) return null;

    return {
      impressions: res.impressions ?? null,
      reach: res.reach ?? null,
      likes: res.likes ?? null,
      comments: res.comments ?? null,
      shares: res.shares ?? null,
      saves: res.saves ?? null,
      clicks: res.clicks ?? null,
      videoViews: res.views ?? null,
      watchTime: res.watch_time ?? null,
      engagementRate: res.engagement ?? null,
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

    return {
      profileViews: res.profile_views ?? null,
      websiteClicks: res.website_clicks ?? null,
      periodStart: res.period_start ?? null,
      periodEnd: res.period_end ?? null,
    };
  }
}
