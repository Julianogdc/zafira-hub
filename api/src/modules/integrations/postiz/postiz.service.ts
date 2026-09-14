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

    // 5b. Enriquecimento automático de mídias caso a listagem tenha omitido a coluna image
    const enrichedPosts = await Promise.all(
      filteredPosts.map(async (post) => {
        const hasMedia =
          (post.image && (typeof post.image === 'string' ? post.image.trim().length > 2 : true)) ||
          (post.media && (typeof post.media === 'string' ? post.media.trim().length > 2 : true));

        if (!hasMedia && post.id && typeof (this.client as any).getPublicPost === 'function') {
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
}

export const postizService = new PostizService();

