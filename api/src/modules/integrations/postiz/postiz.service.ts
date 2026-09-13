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

export class PostizService {
  private readonly client: PostizClient;

  constructor(client?: PostizClient) {
    this.client = client || new PostizClient();
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
}

export const postizService = new PostizService();
