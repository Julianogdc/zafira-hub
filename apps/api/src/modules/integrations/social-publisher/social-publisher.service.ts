import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import {
  AggregatedSocialContentFilters,
  AggregatedSocialContentResponse,
  AggregatedSocialPost,
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialAccount,
  SocialAccountAnalytics,
  SocialMediaUploadResult,
  SocialPost,
  SocialPostAnalytics,
  SocialPublisherStatus,
} from '@zafira/contracts';
import {
  SocialMediaUploadInput,
  SocialPublisherContext,
  SocialPublisherProvider,
} from './social-publisher.provider.js';

export class SocialPublisherServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = 'SocialPublisherServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AvailableSocialAccount extends SocialAccount {
  isLinked: boolean;
  linkedClientId?: string | null;
}

export interface ClientSocialPostsFilters {
  status?: string;
  limit?: number;
  offset?: number;
}

export class SocialPublisherService {
  constructor(
    private readonly provider: SocialPublisherProvider,
    private readonly prisma: PrismaClient = defaultPrisma as any
  ) {}

  /**
   * Resolução da conexão organizacional BrightBean ativa.
   * Regra 13:
   * provider = BRIGHTBEAN, clientId = null, status = ACTIVE.
   * Esperado: exatamente 1 conexão.
   * Se nenhuma: BRIGHTBEAN_CONNECTION_NOT_CONFIGURED (503).
   * Se ambígua (>1): fail-closed (409).
   */
  async resolveBrightBeanConnection(organizationId: string): Promise<any> {
    const connections = await this.prisma.integrationConnection.findMany({
      where: {
        organizationId,
        provider: 'BRIGHTBEAN',
        clientId: null,
        status: 'ACTIVE',
      },
    });

    if (connections.length === 0) {
      throw new SocialPublisherServiceError(
        'BRIGHTBEAN_CONNECTION_NOT_CONFIGURED',
        'Nenhuma conexão organizacional ativa da BrightBean configurada para esta organização.',
        503
      );
    }

    if (connections.length > 1) {
      throw new SocialPublisherServiceError(
        'AMBIGUOUS_BRIGHTBEAN_CONNECTION',
        'Mais de uma conexão organizacional ativa da BrightBean encontrada para a organização. Operação bloqueada por segurança.',
        409
      );
    }

    return connections[0];
  }

  private async getProviderContext(organizationId: string): Promise<{
    ctx: SocialPublisherContext;
    connection: any;
  }> {
    const connection = await this.resolveBrightBeanConnection(organizationId);
    return {
      ctx: {
        organizationId,
        connectionId: connection.id,
        workspaceId: connection.externalScopeId || undefined,
      },
      connection,
    };
  }

  private async validateClient(organizationId: string, clientId: string): Promise<{ id: string; name: string }> {
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!client) {
      throw new SocialPublisherServiceError(
        'CLIENT_NOT_FOUND',
        `Cliente ${clientId} não encontrado na organização.`,
        404
      );
    }

    return client;
  }

  /**
   * Obtém status da integração BrightBean.
   */
  async getStatus(organizationId: string): Promise<SocialPublisherStatus> {
    const { ctx } = await this.getProviderContext(organizationId);
    return this.provider.getStatus(ctx);
  }

  /**
   * Lista contas disponíveis no workspace com flag de vínculo a clientes do Hub.
   */
  async getAvailableAccounts(organizationId: string): Promise<AvailableSocialAccount[]> {
    const { ctx } = await this.getProviderContext(organizationId);
    const accounts = await this.provider.listAccounts(ctx);

    const linkedIntegrations = await this.prisma.clientIntegration.findMany({
      where: {
        client: { organizationId },
        provider: 'BRIGHTBEAN',
      },
      select: {
        clientId: true,
        externalId: true,
      },
    });

    const linkMap = new Map<string, string>();
    for (const item of linkedIntegrations) {
      linkMap.set(item.externalId, item.clientId);
    }

    return accounts.map((acc) => ({
      ...acc,
      isLinked: linkMap.has(acc.id),
      linkedClientId: linkMap.get(acc.id) || null,
    }));
  }

  /**
   * Lista as contas sociais vinculadas a um cliente específico.
   */
  async getClientAccounts(organizationId: string, clientId: string): Promise<SocialAccount[]> {
    await this.validateClient(organizationId, clientId);
    const { ctx } = await this.getProviderContext(organizationId);
    const allAccounts = await this.provider.listAccounts(ctx);

    const clientIntegrations = await this.prisma.clientIntegration.findMany({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
      },
      select: { externalId: true },
    });

    const allowedIds = new Set(clientIntegrations.map((ci) => ci.externalId));
    return allAccounts.filter((acc) => allowedIds.has(acc.id));
  }

  /**
   * Vincula uma conta da BrightBean a um cliente.
   * Regra 15:
   * - listar contas da BrightBean;
   * - confirmar que accountId existe e pertence ao workspace da conexão;
   * - impedir que a mesma conta seja vinculada a 2 clientes da mesma organização;
   * - criar ClientIntegration provider=BRIGHTBEAN.
   */
  async linkAccountToClient(
    organizationId: string,
    clientId: string,
    accountId: string
  ): Promise<{ success: boolean; clientIntegrationId: string }> {
    await this.validateClient(organizationId, clientId);
    const { ctx } = await this.getProviderContext(organizationId);

    const accounts = await this.provider.listAccounts(ctx);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      throw new SocialPublisherServiceError(
        'ACCOUNT_NOT_FOUND',
        `Conta social ${accountId} não encontrada no workspace da BrightBean.`,
        404
      );
    }

    // Valida se a conta já está vinculada a outro cliente na MESMA organização
    const existingOtherClientLink = await this.prisma.clientIntegration.findFirst({
      where: {
        provider: 'BRIGHTBEAN',
        externalId: accountId,
        client: { organizationId },
        clientId: { not: clientId },
      },
      include: { client: { select: { id: true, name: true } } },
    });

    if (existingOtherClientLink) {
      throw new SocialPublisherServiceError(
        'ACCOUNT_ALREADY_LINKED_TO_ANOTHER_CLIENT',
        `A conta social ${accountId} já está vinculada ao cliente ${existingOtherClientLink.client.name} nesta organização.`,
        409
      );
    }

    const existingSameClient = await this.prisma.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
        externalId: accountId,
      },
    });

    if (existingSameClient) {
      return { success: true, clientIntegrationId: existingSameClient.id };
    }

    const created = await this.prisma.clientIntegration.create({
      data: {
        clientId,
        provider: 'BRIGHTBEAN',
        externalId: accountId,
        metadata: {
          platform: account.platform,
          accountName: account.accountName,
          linkedAt: new Date().toISOString(),
        },
      },
    });

    return { success: true, clientIntegrationId: created.id };
  }

  /**
   * Desvincula uma conta de um cliente.
   * Regra 15: remove SOMENTE o ClientIntegration BRIGHTBEAN solicitado.
   * NUNCA remove POSTIZ, ASANA ou outro provider.
   */
  async unlinkAccountFromClient(
    organizationId: string,
    clientId: string,
    accountId: string
  ): Promise<{ success: boolean }> {
    await this.validateClient(organizationId, clientId);

    const integration = await this.prisma.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
        externalId: accountId,
      },
    });

    if (!integration) {
      throw new SocialPublisherServiceError(
        'CLIENT_INTEGRATION_NOT_FOUND',
        `Vínculo da conta ${accountId} não encontrado para o cliente ${clientId}.`,
        404
      );
    }

    await this.prisma.clientIntegration.delete({
      where: { id: integration.id },
    });

    return { success: true };
  }

  /**
   * Listagem agregada de publicações para a Agenda/Feed consolidado do Hub.
   * Regra 16: filtra IDs de hiddenPostIds configurados em IntegrationConnection.metadata.
   * Regra 11: releaseUrl deve usar o permalink da plataforma quando houver exatamente um destino.
   */
  async getAggregatedContent(
    organizationId: string,
    filters?: AggregatedSocialContentFilters
  ): Promise<AggregatedSocialContentResponse> {
    const { ctx, connection } = await this.getProviderContext(organizationId);

    // Mapeamento de contas vinculadas -> clientes da organização
    const clientIntegrations = await this.prisma.clientIntegration.findMany({
      where: {
        client: { organizationId },
        provider: 'BRIGHTBEAN',
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    });

    const accountToClientMap = new Map<string, { clientId: string; clientName: string }>();
    for (const ci of clientIntegrations) {
      accountToClientMap.set(ci.externalId, {
        clientId: (ci as any).client?.id ?? ci.clientId,
        clientName: (ci as any).client?.name ?? 'Cliente',
      });
    }

    // Buscar contas disponíveis para resolver nomes
    const accounts = await this.provider.listAccounts(ctx);
    const accountMap = new Map<string, SocialAccount>();
    for (const acc of accounts) {
      accountMap.set(acc.id, acc);
    }

    // Chamada paginada completa à listagem da BrightBean
    const providerPosts = await this.fetchAllProviderPosts(ctx, {
      accountId: filters?.accountId,
      status: filters?.status,
    });

    // Filtro dos IDs técnicos da metadata da conexão
    const hiddenPostIds = new Set<string>(
      Array.isArray(connection.metadata?.hiddenPostIds)
        ? connection.metadata.hiddenPostIds.map(String)
        : []
    );

    let allAggregated: AggregatedSocialPost[] = [];

    for (const p of providerPosts) {
      if (hiddenPostIds.has(p.id)) {
        continue;
      }

      // Um post pode ter múltiplos platformStates; consideramos os targets
      const firstState = p.platformStates[0];
      const accountId = firstState?.accountId || '';
      const clientInfo = accountToClientMap.get(accountId);

      // Se a conta do post não estiver vinculada a nenhum cliente da organização, ignoramos
      if (!clientInfo) {
        continue;
      }

      // Filtro por clientId se solicitado
      if (filters?.clientId && clientInfo.clientId !== filters.clientId) {
        continue;
      }

      // Filtro por accountId se solicitado
      if (filters?.accountId && accountId !== filters.accountId) {
        continue;
      }

      // Filtro por format se solicitado
      if (filters?.format && p.format !== filters.format) {
        continue;
      }

      // Filtro por status se solicitado
      if (filters?.status && p.status !== filters.status) {
        continue;
      }

      // Filtro por startDate / endDate
      const postDate = p.scheduledAt || p.publishedAt || p.createdAt;
      if (filters?.startDate && postDate < filters.startDate) {
        continue;
      }
      if (filters?.endDate && postDate > filters.endDate) {
        continue;
      }

      // Filtro por search na legenda/conteúdo
      if (filters?.search && !p.content.toLowerCase().includes(filters.search.toLowerCase())) {
        continue;
      }

      const accountObj = accountMap.get(accountId);
      const accountName = accountObj?.accountName || 'Social Account';
      const platform = firstState?.platform || 'INSTAGRAM';

      // Release URL: permalink da plataforma quando houver exatamente um destino com permalink
      let releaseUrl: string | null = null;
      if (p.platformStates.length === 1 && p.platformStates[0].permalink) {
        releaseUrl = p.platformStates[0].permalink;
      }

      const externalPostId = p.platformStates.length === 1 ? p.platformStates[0].externalPostId ?? null : null;

      allAggregated.push({
        id: p.id,
        clientId: clientInfo.clientId,
        clientName: clientInfo.clientName,
        accountId,
        accountName,
        platform,
        format: p.format || 'FEED',
        status: p.status,
        content: p.content,
        mediaItems: p.mediaItems || [],
        scheduledAt: p.scheduledAt ?? null,
        publishedAt: p.publishedAt ?? null,
        createdAt: p.createdAt,
        externalPostId,
        releaseUrl,
        platformStates: p.platformStates,
      });
    }

    const limit = typeof filters?.limit === 'number' && filters.limit > 0 ? filters.limit : 50;
    const offset = typeof filters?.offset === 'number' && filters.offset >= 0 ? filters.offset : 0;
    const total = allAggregated.length;
    const paginated = allAggregated.slice(offset, offset + limit);

    return {
      posts: paginated,
      total,
      limit,
      offset,
    };
  }

  /**
   * Listagem de posts de um cliente específico.
   * Regra 14: somente exibe posts cujas contas pertençam ao cliente.
   * Regra 16: filtra hiddenPostIds.
   */
  async getClientPosts(
    organizationId: string,
    clientId: string,
    filters?: ClientSocialPostsFilters
  ): Promise<{ posts: SocialPost[]; total: number; limit: number; offset: number }> {
    await this.validateClient(organizationId, clientId);
    const { ctx, connection } = await this.getProviderContext(organizationId);

    const clientIntegrations = await this.prisma.clientIntegration.findMany({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
      },
      select: { externalId: true },
    });

    const clientAccountIds = new Set(clientIntegrations.map((ci) => ci.externalId));
    if (clientAccountIds.size === 0) {
      return {
        posts: [],
        total: 0,
        limit: filters?.limit || 50,
        offset: filters?.offset || 0,
      };
    }

    const hiddenPostIds = new Set<string>(
      Array.isArray(connection.metadata?.hiddenPostIds)
        ? connection.metadata.hiddenPostIds.map(String)
        : []
    );

    // Chamada paginada completa à listagem da BrightBean
    const providerPosts = await this.fetchAllProviderPosts(ctx, {
      status: filters?.status,
    });

    const clientPosts: SocialPost[] = [];

    for (const post of providerPosts) {
      if (hiddenPostIds.has(post.id)) {
        continue;
      }

      // Todos os platformStates devem pertencer às contas vinculadas a este cliente
      const allChildrenBelongToClient =
        post.platformStates.length > 0 &&
        post.platformStates.every((ps) => clientAccountIds.has(ps.accountId));

      if (allChildrenBelongToClient) {
        clientPosts.push(post);
      }
    }

    const limit = typeof filters?.limit === 'number' && filters.limit > 0 ? filters.limit : 50;
    const offset = typeof filters?.offset === 'number' && filters.offset >= 0 ? filters.offset : 0;
    const total = clientPosts.length;
    const paginated = clientPosts.slice(offset, offset + limit);

    return {
      posts: paginated,
      total,
      limit,
      offset,
    };
  }

  /**
   * Obtém um post específico de um cliente com validação estrita de ownership.
   * Regra 14: fail-closed se o post pertencer a conta de outro cliente.
   */
  async getClientPost(
    organizationId: string,
    clientId: string,
    postId: string
  ): Promise<SocialPost> {
    await this.validateClient(organizationId, clientId);
    const { ctx } = await this.getProviderContext(organizationId);

    const clientIntegrations = await this.prisma.clientIntegration.findMany({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
      },
      select: { externalId: true },
    });

    const clientAccountIds = new Set(clientIntegrations.map((ci) => ci.externalId));

    const post = await this.provider.getPost(ctx, postId);
    if (!post) {
      throw new SocialPublisherServiceError('POST_NOT_FOUND', 'Publicação não encontrada.', 404);
    }

    const allChildrenBelongToClient =
      post.platformStates.length > 0 &&
      post.platformStates.every((ps) => clientAccountIds.has(ps.accountId));

    if (!allChildrenBelongToClient) {
      // Bloqueio de leitura cross-client sem revelar existência
      throw new SocialPublisherServiceError('POST_NOT_FOUND', 'Publicação não encontrada.', 404);
    }

    return post;
  }

  /**
   * Upload de mídia para a BrightBean com idempotência obrigatória.
   * Regra 17: exige Idempotency-Key não vazia.
   */
  async uploadMedia(
    organizationId: string,
    input: SocialMediaUploadInput
  ): Promise<SocialMediaUploadResult> {
    if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
      throw new SocialPublisherServiceError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'O header Idempotency-Key é obrigatório para operações de upload.',
        400
      );
    }

    const { ctx } = await this.getProviderContext(organizationId);
    return this.provider.uploadMedia(ctx, input);
  }

  /**
   * Cria uma publicação para o cliente com idempotência obrigatória e validação de vínculo da conta.
   * Regra 14 e 17.
   */
  async createPost(
    organizationId: string,
    clientId: string,
    input: CreateSocialPostInput
  ): Promise<SocialPost> {
    if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
      throw new SocialPublisherServiceError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'O header Idempotency-Key é obrigatório para criação de publicações.',
        400
      );
    }

    await this.validateClient(organizationId, clientId);

    // Valida que a conta informada pertence a este cliente
    const isLinked = await this.prisma.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
        externalId: input.accountId,
      },
    });

    if (!isLinked) {
      throw new SocialPublisherServiceError(
        'ACCOUNT_NOT_LINKED_TO_CLIENT',
        `A conta social ${input.accountId} não está vinculada a este cliente.`,
        403
      );
    }

    const { ctx } = await this.getProviderContext(organizationId);
    return this.provider.createPost(ctx, input);
  }

  /**
   * Reagenda uma publicação validando ownership prévia.
   * Regra 14.
   */
  async schedulePost(
    organizationId: string,
    clientId: string,
    input: ScheduleSocialPostInput
  ): Promise<SocialPost> {
    // Valida ownership chamando getClientPost
    await this.getClientPost(organizationId, clientId, input.postId);

    const { ctx } = await this.getProviderContext(organizationId);
    return this.provider.schedulePost(ctx, input);
  }

  /**
   * Cancela uma publicação validando ownership prévia.
   * Regra 14.
   */
  async cancelPost(
    organizationId: string,
    clientId: string,
    postId: string
  ): Promise<{ success: boolean }> {
    // Valida ownership chamando getClientPost
    await this.getClientPost(organizationId, clientId, postId);

    const { ctx } = await this.getProviderContext(organizationId);
    return this.provider.cancelPost(ctx, postId);
  }

  /**
   * Obtém métricas de uma publicação validando ownership.
   * Regra 14.
   */
  async getPostAnalytics(
    organizationId: string,
    clientId: string,
    postId: string
  ): Promise<SocialPostAnalytics | null> {
    await this.getClientPost(organizationId, clientId, postId);

    const { ctx } = await this.getProviderContext(organizationId);
    if (!this.provider.getPostAnalytics) {
      return null;
    }
    return this.provider.getPostAnalytics(ctx, postId);
  }

  /**
   * Obtém métricas de uma conta validando que a conta pertence ao cliente.
   * Regra 14.
   */
  async getAccountAnalytics(
    organizationId: string,
    clientId: string,
    accountId: string,
    period?: { startDate?: string; endDate?: string }
  ): Promise<SocialAccountAnalytics | null> {
    await this.validateClient(organizationId, clientId);

    const isLinked = await this.prisma.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'BRIGHTBEAN',
        externalId: accountId,
      },
    });

    if (!isLinked) {
      throw new SocialPublisherServiceError(
        'ACCOUNT_NOT_LINKED_TO_CLIENT',
        `A conta social ${accountId} não está vinculada a este cliente.`,
        403
      );
    }

    const { ctx } = await this.getProviderContext(organizationId);
    if (!this.provider.getAccountAnalytics) {
      return null;
    }
    return this.provider.getAccountAnalytics(ctx, accountId, period);
  }

  /**
   * Helper que percorre todas as páginas do provedor BrightBean até offset >= total.
   * Proteções:
   * - Lança erro seguro se o provedor retornar página vazia antes de atingir o total;
   * - Protege contra loop infinito (máx 500 iterações);
   * - Respeita filtros provider-side (accountId, status).
   */
  private async fetchAllProviderPosts(
    ctx: SocialPublisherContext,
    filters?: { accountId?: string; status?: string }
  ): Promise<SocialPost[]> {
    const allPosts: SocialPost[] = [];
    const pageSize = 100;
    let offset = 0;
    let total = Infinity;
    const maxIterations = 500;
    let iterations = 0;

    while (offset < total && iterations < maxIterations) {
      iterations++;
      const result = await this.provider.listPosts(ctx, {
        socialAccountId: filters?.accountId,
        status: filters?.status,
        limit: pageSize,
        offset,
      });

      total = result.total;

      if (!result.posts || result.posts.length === 0) {
        if (offset < total) {
          throw new SocialPublisherServiceError(
            'PROVIDER_PAGINATION_ERROR',
            `O provedor retornou página vazia no offset ${offset} antes de atingir o total esperado de ${total} posts.`,
            502
          );
        }
        break;
      }

      allPosts.push(...result.posts);
      offset += result.posts.length;

      // Se a página retornou menos itens que o pageSize e ainda não chegou ao total informado,
      // interrompemos para evitar loop quando o provedor não preenche total com precisão.
      if (result.posts.length < pageSize && offset < total) {
        break;
      }
    }

    if (iterations >= maxIterations) {
      throw new SocialPublisherServiceError(
        'PAGINATION_LIMIT_EXCEEDED',
        'Limite de iterações de paginação excedido ao consultar o provedor.',
        500
      );
    }

    return allPosts;
  }
}
