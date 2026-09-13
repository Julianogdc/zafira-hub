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

export interface ClientPostizPost {
  id: string;
  integrationId: string;
  platform: string;
  accountName: string;
  accountPicture?: string | null;
  status: string;
  content: string;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  releaseUrl?: string | null;
}

export interface ClientPostizContentResponse {
  clientId: string;
  posts: ClientPostizPost[];
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
   * Consulta quais contas Postiz estão vinculadas a um determinado cliente.
   */
  async getClientAccounts(clientId: string): Promise<ClientPostizAccountsResponse> {
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
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
   * Valida se cliente existe, se a conta existe no Postiz e se já não está vinculada.
   */
  async linkAccountToClient(clientId: string, externalId: string): Promise<ClientLinkedPostizAccount> {
    // 1. Valida se o cliente existe
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
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

    // 3. Impede duplicidade do mesmo vínculo para o cliente
    const existing = await this.prismaClient.clientIntegration.findUnique({
      where: {
        clientId_provider_externalId: {
          clientId,
          provider: 'POSTIZ',
          externalId,
        },
      },
    });

    if (existing) {
      throw new PostizIntegrationError(
        'Esta conta do Postiz já está vinculada a este cliente',
        409,
        'POSTIZ_ALREADY_LINKED'
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
  async unlinkAccountFromClient(clientId: string, externalId: string): Promise<{ unlinked: boolean; externalId: string }> {
    // 1. Valida se o cliente existe
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
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
    options?: { startDate?: string; endDate?: string }
  ): Promise<ClientPostizContentResponse> {
    // 1. Valida se o cliente existe
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
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

    // 6. Normaliza os posts para formato seguro e padronizado
    const posts: ClientPostizPost[] = filteredPosts.map((post) => {
      const isPublished = post.state === 'PUBLISHED';
      const publishDateIso = post.publishDate ? new Date(post.publishDate).toISOString() : null;

      return {
        id: post.id,
        integrationId: post.integration.id,
        platform: post.integration.providerIdentifier || '',
        accountName: post.integration.name || '',
        accountPicture: post.integration.picture || null,
        status: post.state,
        content: post.content || '',
        scheduledAt: !isPublished ? publishDateIso : null,
        publishedAt: isPublished ? publishDateIso : null,
        createdAt: publishDateIso,
        releaseUrl: post.releaseURL || null,
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

