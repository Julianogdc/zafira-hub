import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { PostizClient, PostizIntegrationError, PostizRawAccount } from './postiz.client.js';

export interface PostizAccount {
  id: string; // cuid do Postiz, preservado obrigatoriamente como externalId
  name: string;
  providerIdentifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
  customer: {
    id: string;
    name: string;
  } | null;
}

export interface PostizStatusResponse {
  connected: boolean;
  provider: 'POSTIZ';
}

export interface PostizAccountsResponse {
  accounts: PostizAccount[];
  total: number;
}

export interface ClientLinkedPostizAccount {
  id: string;
  externalId: string;
  provider: 'POSTIZ';
  name?: string | null;
  metadata?: any;
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export interface ClientPostizAccountsResponse {
  clientId: string;
  accounts: ClientLinkedPostizAccount[];
  total: number;
}

export interface PostizMediaItem {
  url: string;
  type: 'IMAGE' | 'VIDEO' | 'OTHER';
  thumbnailUrl?: string | null;
}

export type PostizContentType =
  | 'STORY_IMAGE'
  | 'STORY_VIDEO'
  | 'REEL'
  | 'FEED_IMAGE'
  | 'CAROUSEL'
  | 'NONE';

export interface NormalizedPostizMedia {
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'NONE';
  mediaThumbnailUrl: string | null;
  mediaCount: number;
  mediaItems: PostizMediaItem[];
}

export interface ClientPostizPost {
  id: string;
  integrationId: string;
  platform: string;
  accountName: string;
  accountPicture?: string | null;
  status: string;
  content: string;
  rawContent?: string;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  releaseUrl?: string | null;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'NONE';
  mediaThumbnailUrl?: string | null;
  mediaCount: number;
  mediaItems?: PostizMediaItem[];
  contentType: PostizContentType;
  isStory: boolean;
  settings?: any;
}

/**
 * Determina o formato exato da publicação com base no payload real do Postiz:
 * - settings.post_type === 'story' -> STORY_VIDEO (se vídeo) ou STORY_IMAGE (se imagem)
 * - mediaCount > 1 -> CAROUSEL
 * - mediaType === 'VIDEO' -> REEL
 * - mediaType === 'IMAGE' -> FEED_IMAGE
 * - sem mídia -> NONE
 */
export function determinePostFormat(
  post: any,
  media: NormalizedPostizMedia
): { contentType: PostizContentType; isStory: boolean } {
  // 1. Sem mídia
  if (media.mediaCount === 0 || media.mediaType === 'NONE') {
    return { contentType: 'NONE', isStory: false };
  }

  // 2. Extrai settings de forma segura (objeto ou string JSON)
  let settingsObj = post?.settings;
  if (typeof settingsObj === 'string') {
    try {
      settingsObj = JSON.parse(settingsObj);
    } catch {
      settingsObj = null;
    }
  }

  const postType = String(settingsObj?.post_type || '').toLowerCase();

  // 3. STORY (imagem ou vídeo)
  if (postType === 'story') {
    const isVideo = media.mediaType === 'VIDEO';
    return {
      contentType: isVideo ? 'STORY_VIDEO' : 'STORY_IMAGE',
      isStory: true,
    };
  }

  // 4. CARROSSEL (múltiplas mídias)
  if (media.mediaCount > 1 || media.mediaType === 'CAROUSEL') {
    return { contentType: 'CAROUSEL', isStory: false };
  }

  // 5. REEL / VÍDEO
  if (media.mediaType === 'VIDEO') {
    return { contentType: 'REEL', isStory: false };
  }

  // 6. FEED COM IMAGEM
  return { contentType: 'FEED_IMAGE', isStory: false };
}

/**
 * Sanitiza e limpa o texto da publicação:

 * - Remove todas as tags HTML (<p>, <br>, etc.)
 * - Converte entidades HTML comuns (&nbsp;, &amp;, etc.)
 * - Normaliza espaços duplos e quebras repetidas
 * - Retorna "Sem legenda" se o resultado for vazio
 */
export function cleanPostContent(rawContent?: string | null): string {
  if (!rawContent) return 'Sem legenda';

  // 1. Remove qualquer tag HTML
  let cleaned = rawContent.replace(/<\/?[^>]+(>|$)/gi, ' ');

  // 2. Decodifica entidades HTML comuns
  cleaned = cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");

  // 3. Normaliza espaços múltiplos
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 4. Fallback caso fique vazio
  if (!cleaned) {
    return 'Sem legenda';
  }

  return cleaned;
}

/**
 * Extrai e normaliza informações de mídia de um post do Postiz:
 * - Suporta post.image (JSON string, array, objeto ou URL simples)
 * - Suporta post.media e post.settings
 * - Converte caminhos relativos (/uploads/...) em URLs absolutas seguras
 * - Detecta vídeo (mp4, mov, webm ou type=video)
 * - Detecta carrossel (> 1 mídia)
 * - Retorna fallback NONE se não houver mídia válida
 */
export function extractPostizMedia(
  post: any,
  baseUrl = process.env.POSTIZ_URL || 'https://postiz.lab.zafiramkt.com.br'
): NormalizedPostizMedia {
  const cleanBaseUrl = (baseUrl || 'https://postiz.lab.zafiramkt.com.br').replace(/\/+$/, '');
  const rawItems: any[] = [];

  let settingsObj: any = post?.settings;
  if (typeof settingsObj === 'string') {
    try {
      settingsObj = JSON.parse(settingsObj);
    } catch {
      settingsObj = null;
    }
  }

  // Helper para adicionar item bruto com segurança
  const pushItem = (item: any) => {
    if (!item) return;
    if (Array.isArray(item)) {
      rawItems.push(...item);
    } else {
      rawItems.push(item);
    }
  };

  // 1. Tenta extrair de post.image
  if (post?.image) {
    if (typeof post.image === 'string') {
      const trimmed = post.image.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          pushItem(parsed);
        } catch {
          rawItems.push({ path: trimmed });
        }
      } else if (trimmed.length > 0) {
        rawItems.push({ path: trimmed });
      }
    } else if (Array.isArray(post.image)) {
      rawItems.push(...post.image);
    } else if (typeof post.image === 'object') {
      rawItems.push(post.image);
    }
  }

  // 2. Tenta extrair de post.media (se houver e rawItems vazio)
  if (post?.media && rawItems.length === 0) {
    if (typeof post.media === 'string') {
      const trimmed = post.media.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          pushItem(parsed);
        } catch {
          rawItems.push({ path: trimmed });
        }
      } else if (trimmed.length > 0) {
        rawItems.push({ path: trimmed });
      }
    } else if (Array.isArray(post.media)) {
      rawItems.push(...post.media);
    } else if (typeof post.media === 'object') {
      rawItems.push(post.media);
    }
  }

  // 3. Tenta extrair de post.settings (se rawItems ainda vazio)
  if (settingsObj && rawItems.length === 0) {
    if (settingsObj.image) {
      pushItem(settingsObj.image);
    } else if (settingsObj.media) {
      pushItem(settingsObj.media);
    } else if (settingsObj.attachments) {
      pushItem(settingsObj.attachments);
    } else if (settingsObj.files) {
      pushItem(settingsObj.files);
    } else if (settingsObj.video) {
      pushItem(typeof settingsObj.video === 'string' ? { path: settingsObj.video, type: 'video' } : settingsObj.video);
    } else if (settingsObj.video_url || settingsObj.videoUrl) {
      pushItem({ path: settingsObj.video_url || settingsObj.videoUrl, type: 'video' });
    } else if (settingsObj.reel && typeof settingsObj.reel === 'object') {
      pushItem(settingsObj.reel);
    } else if (settingsObj.thumbnail) {
      pushItem(typeof settingsObj.thumbnail === 'string' ? { path: settingsObj.thumbnail } : settingsObj.thumbnail);
    }
  }

  // Normalizador de URLs (relativas -> absolutas)
  const normalizeUrl = (urlStr?: string | null): string | null => {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const s = urlStr.trim();
    if (!s) return null;
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) {
      return s;
    }
    const normalizedPath = s.startsWith('/') ? s : `/${s}`;
    return `${cleanBaseUrl}${normalizedPath}`;
  };

  const isVideo = (item: any, finalUrl: string): boolean => {
    const typeStr = String(item?.type || '').toLowerCase();
    if (typeStr.includes('video')) return true;
    const urlLower = finalUrl.toLowerCase();
    if (/\.(mp4|mov|webm|m4v|avi|mkv|ogv)(\?|$)/i.test(urlLower)) return true;
    const postType = String(settingsObj?.post_type || '').toLowerCase();
    if (postType === 'reel' || postType === 'reels') return true;
    if (Boolean(settingsObj?.is_trial_reel)) return true;
    return false;
  };

  const mediaItems: PostizMediaItem[] = [];

  for (const item of rawItems) {
    if (!item) continue;
    const rawPath = item.path || item.url || item.src || (typeof item === 'string' ? item : null);
    const finalUrl = normalizeUrl(rawPath);
    if (!finalUrl) continue;

    const isVid = isVideo(item, finalUrl);
    const rawThumb =
      item.thumbnail ||
      item.thumbnailUrl ||
      item.thumb ||
      item.poster ||
      item.cover ||
      item.coverUrl ||
      settingsObj?.thumbnail ||
      settingsObj?.poster ||
      null;

    const finalThumb = normalizeUrl(typeof rawThumb === 'string' ? rawThumb : rawThumb?.path || rawThumb?.url);

    mediaItems.push({
      url: finalUrl,
      type: isVid ? 'VIDEO' : 'IMAGE',
      // Se for vídeo e houver poster dedicado, usa o poster. Se não houver, preserva a URL do vídeo
      // para que o frontend renderize o elemento <video> sem fallback incorreto.
      thumbnailUrl: isVid ? (finalThumb || finalUrl) : (finalThumb || finalUrl),
    });
  }

  if (mediaItems.length === 0) {
    return {
      mediaType: 'NONE',
      mediaThumbnailUrl: null,
      mediaCount: 0,
      mediaItems: [],
    };
  }

  if (mediaItems.length > 1) {
    return {
      mediaType: 'CAROUSEL',
      mediaThumbnailUrl: mediaItems[0].thumbnailUrl || mediaItems[0].url,
      mediaCount: mediaItems.length,
      mediaItems,
    };
  }

  const single = mediaItems[0];
  return {
    mediaType: single.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    mediaThumbnailUrl: single.thumbnailUrl || single.url,
    mediaCount: 1,
    mediaItems,
  };
}

export interface ClientPostizContentResponse {
  clientId: string;
  posts: ClientPostizPost[];
  total: number;
}

export interface AvailablePostizAccount {
  integrationId: string;
  platform: string;
  accountName: string;
  accountPicture: string | null;
  profile: string | null;
  isLinked: boolean;
  linkedClientId: string | null;
  linkedClientName: string | null;
  isLinkedToCurrentClient: boolean;
}

export interface AvailablePostizAccountsResponse {
  accounts: AvailablePostizAccount[];
  total: number;
}

export class PostizService {
  private readonly client: PostizClient;
  private readonly prismaClient: typeof defaultPrisma;

  constructor(client?: PostizClient, prismaClient?: any) {
    this.client = client || new PostizClient();
    this.prismaClient = prismaClient || defaultPrisma;
  }

  /**
   * Verifica o status de conexão com o Postiz Lab.
   */
  async getStatus(): Promise<PostizStatusResponse> {
    const result = await this.client.isConnected();

    return {
      connected: !!result?.connected,
      provider: 'POSTIZ',
    };
  }

  /**
   * Obtém a lista de contas sociais conectadas no Postiz Lab,
   * preservando o ID de cada integração para vínculos futuros.
   */
  async getAccounts(): Promise<PostizAccountsResponse> {
    const rawAccounts = await this.client.getIntegrations();

    const accounts: PostizAccount[] = (rawAccounts || []).map((item: PostizRawAccount) => ({
      id: item.id,
      name: item.name || '',
      providerIdentifier: item.identifier || '',
      picture: item.picture || null,
      disabled: Boolean(item.disabled),
      profile: item.profile || null,
      customer: item.customer
        ? {
            id: item.customer.id,
            name: item.customer.name,
          }
        : null,
    }));

    return {
      accounts,
      total: accounts.length,
    };
  }

  /**
   * Lista as contas do Postiz Lab enriquecidas com o status de vínculo
   * na organização (indicando se já está vinculada e a qual cliente).
   */
  async getAvailableAccounts(
    organizationId?: string,
    currentClientId?: string
  ): Promise<AvailablePostizAccountsResponse> {
    const postizData = await this.getAccounts();
    const rawAccounts = postizData.accounts || [];

    // Busca todas as integrações POSTIZ no Hub (filtrando por organizationId se informado)
    const linkedIntegrations = await this.prismaClient.clientIntegration.findMany({
      where: {
        provider: 'POSTIZ',
        ...(organizationId
          ? {
              client: {
                organizationId,
              },
            }
          : {}),
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const linkedMap = new Map<string, { clientId: string; clientName: string }>();
    for (const item of linkedIntegrations) {
      linkedMap.set(item.externalId, {
        clientId: item.clientId,
        clientName: item.client?.name || '',
      });
    }

    const accounts: AvailablePostizAccount[] = rawAccounts.map((acc) => {
      const linked = linkedMap.get(acc.id);
      const isLinked = !!linked;
      const linkedClientId = linked ? linked.clientId : null;
      const linkedClientName = linked ? linked.clientName : null;
      const isLinkedToCurrentClient = !!(currentClientId && linkedClientId === currentClientId);

      return {
        integrationId: acc.id,
        platform: acc.providerIdentifier,
        accountName: acc.name,
        accountPicture: acc.picture,
        profile: acc.profile,
        isLinked,
        linkedClientId,
        linkedClientName,
        isLinkedToCurrentClient,
      };
    });

    return {
      accounts,
      total: accounts.length,
    };
  }

  /**
   * Consulta quais contas Postiz estão vinculadas a um determinado cliente.
   */
  async getClientAccounts(
    clientId: string,
    organizationId?: string
  ): Promise<ClientPostizAccountsResponse> {
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, organizationId: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    const integrations = await this.prismaClient.clientIntegration.findMany({
      where: {
        clientId,
        provider: 'POSTIZ',
      },
      orderBy: { createdAt: 'desc' },
    });

    const accounts: ClientLinkedPostizAccount[] = integrations.map((item) => {
      const meta = (item.metadata as any) || {};
      return {
        id: item.id,
        externalId: item.externalId,
        provider: 'POSTIZ',
        name: meta.name || null,
        metadata: item.metadata,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return {
      clientId,
      accounts,
      total: accounts.length,
    };
  }

  /**
   * Vincula uma conta do Postiz a um cliente.
   * Valida se cliente existe, se a conta existe no Postiz e se já não está vinculada na organização.
   */
  async linkAccountToClient(
    clientId: string,
    externalId: string,
    organizationId?: string
  ): Promise<ClientLinkedPostizAccount> {
    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, organizationId: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Consulta o Postiz para confirmar a existência da conta
    const postizData = await this.getAccounts();
    const targetAccount = postizData.accounts.find((acc) => acc.id === externalId);

    if (!targetAccount) {
      throw new PostizIntegrationError(
        'Conta Postiz não encontrada no workspace da organização',
        404,
        'POSTIZ_ACCOUNT_NOT_FOUND'
      );
    }

    // 3. Impede que a mesma conta seja vinculada a múltiplos clientes na mesma organização
    const effectiveOrgId = organizationId || client.organizationId;
    const existingInOrg = await this.prismaClient.clientIntegration.findFirst({
      where: {
        provider: 'POSTIZ',
        externalId,
        ...(effectiveOrgId
          ? {
              client: {
                organizationId: effectiveOrgId,
              },
            }
          : {}),
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    if (existingInOrg) {
      const isSameClient = existingInOrg.clientId === clientId;
      throw new PostizIntegrationError(
        isSameClient
          ? 'Esta conta do Postiz já está vinculada a este cliente'
          : `Esta conta do Postiz já está vinculada ao cliente "${existingInOrg.client?.name || existingInOrg.clientId}" nesta organização`,
        409,
        'POSTIZ_INTEGRATION_ALREADY_LINKED'
      );
    }

    // 4. Cria o registro no Hub preservando externalId = integration.id e salvando metadata informativo
    const created = await this.prismaClient.clientIntegration.create({
      data: {
        clientId,
        provider: 'POSTIZ',
        externalId,
        metadata: {
          name: targetAccount.name,
          providerIdentifier: targetAccount.providerIdentifier,
          picture: targetAccount.picture,
          profile: targetAccount.profile,
          linkedAt: new Date().toISOString(),
        },
      },
    });

    return {
      id: created.id,
      externalId: created.externalId,
      provider: 'POSTIZ',
      name: targetAccount.name,
      metadata: created.metadata,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /**
   * Remove o vínculo de uma conta Postiz de um cliente.
   * Não executa nenhuma exclusão ou alteração no Postiz original.
   */
  async unlinkAccountFromClient(
    clientId: string,
    externalId: string,
    organizationId?: string
  ): Promise<{ unlinked: boolean; externalId: string }> {
    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, organizationId: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Localiza o vínculo pelo externalId da conta Postiz ou pelo id da linha
    const link = await this.prismaClient.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'POSTIZ',
        OR: [
          { externalId },
          { id: externalId },
        ],
      },
    });

    if (!link) {
      throw new PostizIntegrationError(
        'Vínculo de integração da conta Postiz não encontrado para este cliente',
        404,
        'POSTIZ_LINK_NOT_FOUND'
      );
    }

    // 3. Exclui SOMENTE o vínculo local no banco do Hub
    await this.prismaClient.clientIntegration.delete({
      where: { id: link.id },
    });

    return {
      unlinked: true,
      externalId: link.externalId,
    };
  }

  /**
   * Obtém as publicações do Postiz filtrando com isolamento estrito
   * apenas pelas contas associadas ao cliente fornecido.
   */
  async getClientPosts(
    clientId: string,
    options?: { startDate?: string; endDate?: string },
    organizationId?: string
  ): Promise<ClientPostizContentResponse> {
    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, organizationId: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Busca vínculos de integração com provider POSTIZ
    const integrations = await this.prismaClient.clientIntegration.findMany({
      where: {
        clientId,
        provider: 'POSTIZ',
      },
    });

    // Se o cliente não tiver nenhuma conta Postiz vinculada, retorna lista vazia com status 200
    if (integrations.length === 0) {
      return {
        clientId,
        posts: [],
        total: 0,
      };
    }

    // 3. Coleta os externalIds permitidos
    const allowedIntegrationIds = new Set(integrations.map((item) => item.externalId));

    // 4. Consulta os posts no Postiz
    const { posts: rawPosts } = await this.client.getPosts({
      startDate: options?.startDate,
      endDate: options?.endDate,
    });

    // 5. Aplica isolamento estrito por ID da integração vinculada
    const filteredPosts = (rawPosts || []).filter((post) => {
      return post?.integration?.id && allowedIntegrationIds.has(post.integration.id);
    });

    // 5b. Enriquecimento automático de mídias e configurações caso a listagem tenha omitido a coluna image ou settings
    const enrichedPosts = await Promise.all(
      filteredPosts.map(async (post) => {
        const hasMedia =
          (post.image && (typeof post.image === 'string' ? post.image.trim().length > 2 : true)) ||
          (post.media && (typeof post.media === 'string' ? post.media.trim().length > 2 : true));

        let hasPostType = false;
        if (post?.settings) {
          try {
            const s = typeof post.settings === 'string' ? JSON.parse(post.settings) : post.settings;
            if (s && s.post_type) {
              hasPostType = true;
            }
          } catch {
            // Ignora erro de parse
          }
        }

        // Se faltar mídia OU se não contiver post_type explícito em settings, busca detalhes via getPublicPost
        if ((!hasMedia || !hasPostType) && post.id && typeof (this.client as any).getPublicPost === 'function') {
          try {
            const fullPost = await this.client.getPublicPost(post.id);
            if (fullPost) {
              return {
                ...post,
                image: fullPost.image || post.image,
                media: fullPost.media || post.media,
                settings: fullPost.settings || post.settings,
              };
            }
          } catch {
            // Continua com o post original caso falhe
          }
        }
        return post;
      })
    );

    // 6. Normaliza os posts para formato seguro e padronizado
    const baseUrl = (this.client as any)?.baseUrl || process.env.POSTIZ_URL || 'https://postiz.lab.zafiramkt.com.br';

    const posts: ClientPostizPost[] = enrichedPosts.map((post) => {
      const isPublished = post.state === 'PUBLISHED';
      const publishDateIso = post.publishDate ? new Date(post.publishDate).toISOString() : null;

      const media = extractPostizMedia(post, baseUrl);
      const cleanContent = cleanPostContent(post.content);
      const formatInfo = determinePostFormat(post, media);

      return {
        id: post.id,
        integrationId: post.integration.id,
        platform: post.integration.providerIdentifier || '',
        accountName: post.integration.name || '',
        accountPicture: post.integration.picture || null,
        status: post.state,
        content: cleanContent,
        rawContent: post.content || '',
        scheduledAt: !isPublished ? publishDateIso : null,
        publishedAt: isPublished ? publishDateIso : null,
        createdAt: publishDateIso,
        releaseUrl: post.releaseURL || null,
        mediaType: media.mediaType,
        mediaThumbnailUrl: media.mediaThumbnailUrl,
        mediaCount: media.mediaCount,
        mediaItems: media.mediaItems,
        contentType: formatInfo.contentType,
        isStory: formatInfo.isStory,
        settings: post.settings || null,
      };
    });

    // 7. Ordena decrescentemente por data
    posts.sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.scheduledAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.publishedAt || b.scheduledAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    return {
      clientId,
      posts,
      total: posts.length,
    };
  }

  /**
   * Obtém os detalhes de um post específico vinculado a um cliente.
   * Garante isolamento estrito: o post deve pertencer a uma conta Postiz vinculada ao cliente.
   * Prioriza a consulta completa via getPublicPost para assegurar settings, formato e mídias fidedignas.
   */
  async getClientPostById(
    clientId: string,
    postId: string,
    organizationId?: string
  ): Promise<{ post: ClientPostizPost }> {
    if (!clientId || !clientId.trim()) {
      throw new PostizIntegrationError('ID do cliente é obrigatório.', 400, 'POSTIZ_INVALID_CLIENT_ID');
    }
    if (!postId || !postId.trim()) {
      throw new PostizIntegrationError('ID da publicação é obrigatório.', 400, 'POSTIZ_INVALID_POST_ID');
    }

    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, organizationId: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Busca vínculos de integração com provider POSTIZ do cliente para checagem estrita de autorização
    const integrations = await this.prismaClient.clientIntegration.findMany({
      where: {
        clientId,
        provider: 'POSTIZ',
      },
    });

    if (integrations.length === 0) {
      throw new PostizIntegrationError(
        'Publicação não encontrada ou não vinculada a este cliente.',
        404,
        'POSTIZ_POST_NOT_FOUND'
      );
    }

    const allowedIntegrationIds = new Set(integrations.map((item) => item.externalId));
    const baseUrl = (this.client as any)?.baseUrl || process.env.POSTIZ_URL || 'https://postiz.lab.zafiramkt.com.br';

    // 3. PRIORIDADE: Busca os dados completos diretamente pelo ID no Postiz (para obter settings e payload real)
    if (typeof (this.client as any).getPublicPost === 'function') {
      try {
        const fullPost = await this.client.getPublicPost(postId);
        if (fullPost) {
          const postIntegrationId = fullPost.integration?.id || fullPost.integrationId;

          // Se tiver vínculo confirmado com o cliente
          if (postIntegrationId && allowedIntegrationIds.has(postIntegrationId)) {
            const media = extractPostizMedia(fullPost, baseUrl);
            const cleanContent = cleanPostContent(fullPost.content);
            const isPublished = fullPost.state === 'PUBLISHED';
            const publishDateIso = fullPost.publishDate ? new Date(fullPost.publishDate).toISOString() : null;
            const formatInfo = determinePostFormat(fullPost, media);

            const normalizedPost: ClientPostizPost = {
              id: fullPost.id,
              integrationId: fullPost.integration?.id || postIntegrationId,
              platform: fullPost.integration?.providerIdentifier || '',
              accountName: fullPost.integration?.name || '',
              accountPicture: fullPost.integration?.picture || null,
              status: fullPost.state,
              content: cleanContent,
              rawContent: fullPost.content || '',
              scheduledAt: !isPublished ? publishDateIso : null,
              publishedAt: isPublished ? publishDateIso : null,
              createdAt: publishDateIso,
              releaseUrl: fullPost.releaseURL || null,
              mediaType: media.mediaType,
              mediaThumbnailUrl: media.mediaThumbnailUrl,
              mediaCount: media.mediaCount,
              mediaItems: media.mediaItems,
              contentType: formatInfo.contentType,
              isStory: formatInfo.isStory,
              settings: fullPost.settings || null,
            };

            return { post: normalizedPost };
          }
        }
      } catch (err) {
        if (err instanceof PostizIntegrationError) {
          throw err;
        }
      }
    }

    // 4. Fallback caso getPublicPost não esteja disponível: procura na listagem do cliente
    const clientContent = await this.getClientPosts(clientId, undefined, organizationId);
    const existingPost = clientContent.posts.find((p) => p.id === postId);

    if (existingPost) {
      return { post: existingPost };
    }

    throw new PostizIntegrationError(
      'Publicação não encontrada ou não vinculada a este cliente.',
      404,
      'POSTIZ_POST_NOT_FOUND'
    );
  }

  // Cache em memória leve para evitar chamadas excessivas ao Postiz
  private aggregatedCache = new Map<string, { timestamp: number; posts: any[] }>();

  /**
   * Limpa o cache em memória (útil para testes ou refresh forçado)
   */
  clearCache(): void {
    this.aggregatedCache.clear();
  }

  /**
   * Obtém a visão agregada de conteúdos de todos os clientes vinculados da organização.
   * Suporta filtros por cliente, integração, status, formato, busca e paginação.
   */
  async getAggregatedContent(
    options: AggregatedContentOptions
  ): Promise<AggregatedContentResponse> {
    const effectiveOrgId = options.organizationId;

    // 1. Busca todas as contas Postiz vinculadas a clientes da organização no Hub
    const linkedIntegrations = await this.prismaClient.clientIntegration.findMany({
      where: {
        provider: 'POSTIZ',
        ...(effectiveOrgId
          ? {
              client: {
                organizationId: effectiveOrgId,
              },
            }
          : {}),
        ...(options.clientId ? { clientId: options.clientId } : {}),
        ...(options.integrationId ? { externalId: options.integrationId } : {}),
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            organizationId: true,
          },
        },
      },
    });

    // Se nenhuma conta Postiz estiver vinculada, retorna estrutura vazia
    if (linkedIntegrations.length === 0) {
      return {
        posts: [],
        total: 0,
        page: options.page || 1,
        limit: options.limit || 50,
        totalPages: 0,
        summary: {
          scheduledCount: 0,
          publishedCount: 0,
          errorCount: 0,
          draftCount: 0,
          nextPost: null,
        },
        clients: [],
        accounts: [],
      };
    }

    // Mapa de vínculo estrito: externalId -> { clientId, clientName }
    const allowedMap = new Map<string, { clientId: string; clientName: string }>();
    const clientsMap = new Map<string, { id: string; name: string }>();
    const accountsList: { id: string; name: string; platform: string; clientId: string }[] = [];

    for (const item of linkedIntegrations) {
      if (item.client) {
        allowedMap.set(item.externalId, {
          clientId: item.client.id,
          clientName: item.client.name,
        });
        clientsMap.set(item.client.id, {
          id: item.client.id,
          name: item.client.name,
        });
        const meta = (item.metadata as any) || {};
        accountsList.push({
          id: item.externalId,
          name: meta.name || item.externalId,
          platform: meta.providerIdentifier || '',
          clientId: item.client.id,
        });
      }
    }

    // 2. Consulta de posts no Postiz com cache leve (60s)
    const cacheKey = `${effectiveOrgId || 'all'}:${options.startDate || 'default'}:${options.endDate || 'default'}`;
    const cached = this.aggregatedCache.get(cacheKey);
    let rawPosts: any[] = [];

    if (!options.forceRefresh && cached && Date.now() - cached.timestamp < 60000) {
      rawPosts = cached.posts;
    } else {
      const res = await this.client.getPosts({
        startDate: options.startDate,
        endDate: options.endDate,
      });
      rawPosts = res.posts || [];
      this.aggregatedCache.set(cacheKey, {
        timestamp: Date.now(),
        posts: rawPosts,
      });
    }

    // 3. Filtra ESTRITAMENTE pelas integrações permitidas (descarte de contas não vinculadas / outras orgs)
    const orgFilteredPosts = rawPosts.filter((post) => {
      return post?.integration?.id && allowedMap.has(post.integration.id);
    });

    // 4. Enriquecimento transparente de mídias e post_type (settings)
    const enrichedPosts = await Promise.all(
      orgFilteredPosts.map(async (post) => {
        const hasMedia =
          (post.image && (typeof post.image === 'string' ? post.image.trim().length > 2 : true)) ||
          (post.media && (typeof post.media === 'string' ? post.media.trim().length > 2 : true));

        let hasPostType = false;
        if (post?.settings) {
          try {
            const s = typeof post.settings === 'string' ? JSON.parse(post.settings) : post.settings;
            if (s && s.post_type) {
              hasPostType = true;
            }
          } catch {
            // Ignora erro de parse
          }
        }

        if ((!hasMedia || !hasPostType) && post.id && typeof (this.client as any).getPublicPost === 'function') {
          try {
            const fullPost = await this.client.getPublicPost(post.id);
            if (fullPost) {
              return {
                ...post,
                image: fullPost.image || post.image,
                media: fullPost.media || post.media,
                settings: fullPost.settings || post.settings,
              };
            }
          } catch {
            // Continua com o post original
          }
        }
        return post;
      })
    );

    // 5. Normalização para o contrato Hub Zafira
    const baseUrl = (this.client as any)?.baseUrl || process.env.POSTIZ_URL || 'https://postiz.lab.zafiramkt.com.br';

    const normalizedPosts: AggregatedPostizPost[] = enrichedPosts.map((post) => {
      const clientInfo = allowedMap.get(post.integration.id)!;
      const isPublished = post.state === 'PUBLISHED';
      const publishDateIso = post.publishDate ? new Date(post.publishDate).toISOString() : null;

      const media = extractPostizMedia(post, baseUrl);
      const cleanContent = cleanPostContent(post.content);
      const formatInfo = determinePostFormat(post, media);

      return {
        id: post.id,
        clientId: clientInfo.clientId,
        clientName: clientInfo.clientName,
        integrationId: post.integration.id,
        platform: post.integration.providerIdentifier || '',
        accountName: post.integration.name || '',
        accountPicture: post.integration.picture || null,
        status: post.state,
        content: cleanContent,
        rawContent: post.content || '',
        scheduledAt: !isPublished ? publishDateIso : null,
        publishedAt: isPublished ? publishDateIso : null,
        createdAt: publishDateIso,
        releaseUrl: post.releaseURL || null,
        mediaType: media.mediaType,
        mediaThumbnailUrl: media.mediaThumbnailUrl,
        mediaCount: media.mediaCount,
        mediaItems: media.mediaItems,
        contentType: formatInfo.contentType,
        isStory: formatInfo.isStory,
        settings: post.settings || null,
      };
    });

    // 6. Ordena cronologicamente por data decrescente
    normalizedPosts.sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.scheduledAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.publishedAt || b.scheduledAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    // 7. Calcula métricas reais de resumo operacional
    let scheduledCount = 0;
    let publishedCount = 0;
    let errorCount = 0;
    let draftCount = 0;
    let nextPost: AggregatedPostizPost | null = null;
    let minFutureDiff = Infinity;
    const now = Date.now();

    for (const p of normalizedPosts) {
      if (p.status === 'PUBLISHED') {
        publishedCount++;
      } else if (p.status === 'QUEUE' || p.status === 'SCHEDULED') {
        scheduledCount++;
        const postTime = new Date(p.scheduledAt || p.createdAt || 0).getTime();
        if (postTime >= now) {
          const diff = postTime - now;
          if (diff < minFutureDiff) {
            minFutureDiff = diff;
            nextPost = p;
          }
        }
      } else if (p.status === 'ERROR') {
        errorCount++;
      } else if (p.status === 'DRAFT') {
        draftCount++;
      }
    }

    // Se não houver nenhum no futuro estrito, obtém o primeiro da fila agendada ordenado por data crescente
    if (!nextPost) {
      const upcoming = normalizedPosts.filter((p) => p.status === 'QUEUE' || p.status === 'SCHEDULED');
      if (upcoming.length > 0) {
        upcoming.sort((a, b) => {
          const dA = new Date(a.scheduledAt || a.createdAt || 0).getTime();
          const dB = new Date(b.scheduledAt || b.createdAt || 0).getTime();
          return dA - dB;
        });
        nextPost = upcoming[0];
      }
    }

    // 8. Aplica filtros combináveis
    let filtered = [...normalizedPosts];

    // Filtro por status
    if (options.status && options.status !== 'ALL') {
      const s = options.status.toUpperCase();
      if (s === 'QUEUE' || s === 'SCHEDULED') {
        filtered = filtered.filter((p) => p.status === 'QUEUE' || p.status === 'SCHEDULED');
      } else {
        filtered = filtered.filter((p) => p.status.toUpperCase() === s);
      }
    }

    // Filtro por formato
    if (options.format && options.format !== 'ALL') {
      const f = options.format.toUpperCase();
      if (f === 'STORY') {
        filtered = filtered.filter(
          (p) => p.isStory === true || p.contentType === 'STORY_IMAGE' || p.contentType === 'STORY_VIDEO'
        );
      } else if (f === 'REEL') {
        filtered = filtered.filter((p) => !p.isStory && p.contentType === 'REEL');
      } else if (f === 'FEED') {
        filtered = filtered.filter((p) => !p.isStory && p.contentType === 'FEED_IMAGE');
      } else if (f === 'CAROUSEL') {
        filtered = filtered.filter((p) => !p.isStory && p.contentType === 'CAROUSEL');
      }
    }

    // Filtro por busca textual (legenda, nome da conta ou cliente)
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.content.toLowerCase().includes(q) ||
          p.accountName.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q)
      );
    }

    const total = filtered.length;

    // 9. Paginação (caso limit > 0)
    let pagedPosts = filtered;
    const page = Math.max(1, options.page || 1);
    const limit = options.limit !== undefined ? options.limit : 0;
    let totalPages = 1;

    if (limit > 0) {
      totalPages = Math.ceil(total / limit) || 1;
      const offset = (page - 1) * limit;
      pagedPosts = filtered.slice(offset, offset + limit);
    }

    return {
      posts: pagedPosts,
      total,
      page,
      limit,
      totalPages,
      summary: {
        scheduledCount,
        publishedCount,
        errorCount,
        draftCount,
        nextPost,
      },
      clients: Array.from(clientsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      accounts: accountsList.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Realiza upload de mídia via PostizClient sem expor chaves de API.
   */
  async uploadMedia(file: { buffer: Buffer; filename: string; mimetype: string }) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new PostizIntegrationError('Arquivo inválido ou vazio para upload.', 400, 'INVALID_FILE');
    }
    return this.client.uploadMedia(file.buffer, file.filename, file.mimetype);
  }

  /**
   * Cria ou agenda um post no Postiz com isolamento estrito por cliente e organização.
   */
  async createClientPost(
    clientId: string,
    data: CreateClientPostDto,
    organizationId?: string
  ): Promise<{ post: ClientPostizPost }> {
    if (!clientId || !clientId.trim()) {
      throw new PostizIntegrationError('ID do cliente é obrigatório.', 400, 'POSTIZ_INVALID_CLIENT_ID');
    }
    if (!data.integrationId || !data.integrationId.trim()) {
      throw new PostizIntegrationError('Conta social de destino é obrigatória.', 400, 'POSTIZ_INVALID_INTEGRATION_ID');
    }
    if (!data.mediaItems || data.mediaItems.length === 0) {
      throw new PostizIntegrationError('Pelo menos uma mídia deve ser enviada para publicação.', 400, 'POSTIZ_MEDIA_REQUIRED');
    }

    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, organizationId: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new PostizIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Valida se a conta Postiz está vinculada estritamente a este cliente
    const integration = await this.prismaClient.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'POSTIZ',
        externalId: data.integrationId,
      },
    });

    if (!integration) {
      throw new PostizIntegrationError(
        'A conta social informada não está vinculada a este cliente.',
        403,
        'POSTIZ_INTEGRATION_NOT_LINKED'
      );
    }

    // 3. Monta configuração da plataforma e tipo de post
    const meta = (integration.metadata as any) || {};
    const platform = meta.providerIdentifier || 'instagram';
    const isStory = data.format === 'STORY_IMAGE' || data.format === 'STORY_VIDEO';

    const settings: Record<string, any> = {
      __type: platform,
    };

    if (isStory) {
      settings.post_type = 'story';
    } else if (data.format === 'REEL') {
      settings.post_type = 'reel';
      settings.is_reel = true;
    }

    // Story não deve receber/enviar legenda
    const content = isStory ? '' : (data.content || '').trim();

    // Data de publicação
    const isDraft = Boolean(data.isDraft);
    const postType = isDraft ? 'draft' : 'schedule';
    const dateStr = data.scheduledDate
      ? new Date(data.scheduledDate).toISOString()
      : new Date().toISOString();

    // 4. Constrói o payload oficial do Postiz
    const postPayload = {
      type: postType as 'draft' | 'schedule' | 'now',
      date: dateStr,
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: data.integrationId },
          value: [
            {
              content,
              image: data.mediaItems.map((m) => ({ id: m.id, path: m.path })),
            },
          ],
          settings,
        },
      ],
    };

    // 5. Envia ao Postiz
    const postizResponse = await this.client.createPost(postPayload);

    // 6. Invalida cache de agregação para exibição instantânea
    this.clearCache();

    // 7. Extrai o post retornado ou monta resposta normalizada
    const rawPost = Array.isArray(postizResponse) ? postizResponse[0] : postizResponse?.post || postizResponse;
    const postId = rawPost?.id || `gen_${Date.now()}`;
    const baseUrl = (this.client as any)?.baseUrl || process.env.POSTIZ_URL || 'https://postiz.lab.zafiramkt.com.br';

    const postObjForNormalization = {
      id: postId,
      content,
      state: isDraft ? 'DRAFT' : 'QUEUE',
      publishDate: dateStr,
      releaseURL: null,
      settings,
      image: data.mediaItems.map((m) => ({ id: m.id, path: m.path })),
      integration: {
        id: data.integrationId,
        name: meta.name || client.name,
        providerIdentifier: platform,
        picture: meta.picture || null,
      },
    };

    const media = extractPostizMedia(postObjForNormalization, baseUrl);
    const cleanContent = cleanPostContent(content);
    const formatInfo = determinePostFormat(postObjForNormalization, media);

    const normalizedPost: ClientPostizPost = {
      id: postId,
      integrationId: data.integrationId,
      platform,
      accountName: meta.name || client.name,
      accountPicture: meta.picture || null,
      status: isDraft ? 'DRAFT' : 'QUEUE',
      content: cleanContent,
      rawContent: content,
      scheduledAt: !isDraft ? dateStr : null,
      publishedAt: null,
      createdAt: dateStr,
      releaseUrl: null,
      mediaType: media.mediaType,
      mediaThumbnailUrl: media.mediaThumbnailUrl,
      mediaCount: media.mediaCount,
      mediaItems: media.mediaItems,
      contentType: formatInfo.contentType,
      isStory: formatInfo.isStory,
      settings,
    };

    return { post: normalizedPost };
  }

  /**
   * Reagenda uma publicação existente ou agenda um rascunho.
   * Aciona a rotina nativa do Postiz para atualizar a data, cancelar a execução anterior
   * na fila e agendar a nova execução na data e hora especificadas.
   * Preserva integralmente mídia, legenda, formato e conta social vinculada.
   */
  async rescheduleClientPost(
    clientId: string,
    postId: string,
    scheduledAt: string,
    organizationId?: string
  ): Promise<{ post: ClientPostizPost }> {
    // 1. Busca os detalhes do post validando cliente, organização e contas vinculadas
    const { post } = await this.getClientPostById(clientId, postId, organizationId);

    // 2. Validação estrita de status
    const statusUpper = (post.status || '').toUpperCase();
    if (statusUpper === 'PUBLISHED') {
      throw new PostizIntegrationError(
        'Publicações já publicadas não podem ser editadas ou reagendadas.',
        400,
        'POST_ALREADY_PUBLISHED'
      );
    }

    if (statusUpper === 'ERROR') {
      throw new PostizIntegrationError(
        'Publicações com falha não podem ser reagendadas nesta etapa.',
        400,
        'POST_STATUS_NOT_EDITABLE'
      );
    }

    const eligibleStatuses = ['DRAFT', 'QUEUE', 'SCHEDULED'];
    if (!eligibleStatuses.includes(statusUpper)) {
      throw new PostizIntegrationError(
        `Publicações com status ${post.status} não permitem agendamento nesta etapa.`,
        400,
        'POST_STATUS_NOT_EDITABLE'
      );
    }

    // 3. Validação de data futura
    if (!scheduledAt || typeof scheduledAt !== 'string') {
      throw new PostizIntegrationError(
        'Data e horário do agendamento são obrigatórios.',
        400,
        'INVALID_SCHEDULE_DATE'
      );
    }

    const targetDate = new Date(scheduledAt);
    if (isNaN(targetDate.getTime())) {
      throw new PostizIntegrationError(
        'Data e horário fornecidos são inválidos.',
        400,
        'INVALID_SCHEDULE_DATE'
      );
    }

    if (targetDate.getTime() <= Date.now()) {
      throw new PostizIntegrationError(
        'A data e o horário do agendamento devem ser futuros.',
        400,
        'DATE_MUST_BE_FUTURE'
      );
    }

    const targetDateIso = targetDate.toISOString();

    // 4. Mapeamento defensivo das mídias existentes preservadas
    const mediaItems = (post.mediaItems || []).map((m: any, idx: number) => ({
      id: (m as any).id || `media_${idx}`,
      path: m.url || m.path,
    }));

    if (mediaItems.length === 0 && post.mediaThumbnailUrl) {
      mediaItems.push({
        id: 'media_0',
        path: post.mediaThumbnailUrl,
      });
    }

    // 5. Aciona a rotina nativa do Postiz via reschedulePost
    await this.client.reschedulePost({
      postId,
      integrationId: post.integrationId,
      date: targetDateIso,
      content: post.rawContent !== undefined ? post.rawContent : post.content,
      mediaItems,
      settings: post.settings || {},
    });

    // 6. Retorna o post atualizado com nova data de agendamento e status QUEUE
    const updatedPost: ClientPostizPost = {
      ...post,
      status: 'QUEUE',
      scheduledAt: targetDateIso,
    };

    return { post: updatedPost };
  }
}

export interface CreateClientPostDto {
  integrationId: string;
  format: 'FEED' | 'REEL' | 'STORY_IMAGE' | 'STORY_VIDEO' | 'CAROUSEL';
  content?: string;
  mediaItems: Array<{ id: string; path: string }>;
  isDraft?: boolean;
  scheduledDate?: string;
}


export interface AggregatedPostizPost extends ClientPostizPost {
  clientId: string;
  clientName: string;
}

export interface AggregatedContentSummary {
  scheduledCount: number;
  publishedCount: number;
  errorCount: number;
  draftCount: number;
  nextPost: AggregatedPostizPost | null;
}

export interface AggregatedContentOptions {
  organizationId?: string;
  startDate?: string;
  endDate?: string;
  clientId?: string;
  integrationId?: string;
  status?: string;
  format?: string;
  search?: string;
  page?: number;
  limit?: number;
  forceRefresh?: boolean;
}

export interface AggregatedContentResponse {
  posts: AggregatedPostizPost[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: AggregatedContentSummary;
  clients: { id: string; name: string }[];
  accounts: { id: string; name: string; platform: string; clientId: string }[];
}

export const postizService = new PostizService();



