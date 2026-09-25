import { api } from '@/lib/api';
import type {
  SocialAccount,
  SocialPost,
  AggregatedSocialPost,
  AggregatedSocialContentResponse,
  SocialContentFormat,
  SocialPostStatus,
  SocialMediaAsset,
  SocialPublisherStatus,
  SocialPostAnalytics,
  SocialAccountAnalytics,
  SocialPlatform,
  SocialMediaType,
  AggregatedSocialContentFilters,
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialMediaUploadResult,
} from '@zafira/contracts';

// Re-exporta contratos canônicos para conveniência dos componentes frontend
export type {
  SocialAccount,
  SocialPost,
  AggregatedSocialPost,
  AggregatedSocialContentResponse,
  SocialContentFormat,
  SocialPostStatus,
  SocialMediaAsset,
  SocialPublisherStatus,
  SocialPostAnalytics,
  SocialAccountAnalytics,
  SocialPlatform,
  SocialMediaType,
  AggregatedSocialContentFilters,
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialMediaUploadResult,
};

/**
 * Conta social disponível para vinculação a clientes.
 * Interface exclusiva do frontend estendendo SocialAccount com metadados de vínculo.
 */
export interface AvailableSocialAccount extends SocialAccount {
  isLinked: boolean;
  linkedClientId?: string | null;
  linkedClientName?: string | null;
}

/**
 * Helper de geração de Idempotency-Key estável baseada em UUID v4.
 * A chave representa a OPERAÇÃO no frontend, garantindo que retentativas
 * de upload ou criação não dupliquem registros no backend/provider.
 */
export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Sanitiza e limpa a legenda do post para renderização segura e limpa.
 */
export function cleanSocialContent(rawContent?: string | null): string {
  if (!rawContent) return 'Sem legenda';

  let cleaned = rawContent.replace(/<\/?[^>]+(>|$)/gi, ' ');
  cleaned = cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || 'Sem legenda';
}

/**
 * Traduz códigos técnicos do provider ou da API em mensagens amigáveis de UX em Português do Brasil.
 * Nunca expõe segredos, tokens ou terminologia crua de providers ao usuário comum.
 */
export function getSocialErrorMessage(error: unknown, fallbackMessage: string = 'Erro na operação'): string {
  const err = error as { message?: string; data?: { message?: string; code?: string }; code?: string; status?: number } | null | undefined;
  const rawMessage = err?.message || err?.data?.message || '';
  const code = err?.data?.code || err?.code || '';

  if (
    code.includes('BRIGHTBEAN') ||
    code.includes('PROVIDER') ||
    rawMessage.includes('BrightBean') ||
    rawMessage.includes('credentialCiphertext') ||
    rawMessage.includes('API key') ||
    rawMessage.includes('workspace')
  ) {
    if (code === 'BRIGHTBEAN_POST_NOT_SCHEDULABLE') {
      return 'Esta publicação não pode ser agendada ou alterada no estado atual.';
    }
    if (code === 'BRIGHTBEAN_UNREPRESENTABLE_FORMAT') {
      return 'O formato selecionado é incompatível com as mídias anexadas.';
    }
    if (code === 'BRIGHTBEAN_ACCOUNT_NOT_FOUND') {
      return 'A conta social não foi encontrada ou não está mais ativa.';
    }
    return 'Não foi possível acessar a integração social. Verifique a conexão e tente novamente.';
  }

  if (code === 'ORGANIZATION_CONTEXT_REQUIRED') {
    return 'Contexto de organização não definido. Selecione uma organização ativa.';
  }

  if (error?.status === 403 || code === 'FORBIDDEN') {
    return 'Você não possui permissão para executar esta ação no módulo social.';
  }

  return rawMessage || fallbackMessage;
}

/**
 * Serviço canônico de integração com o módulo Social Publisher do Hub.
 * Utilizado em todas as telas e componentes ativos.
 */
export const socialPublisherService = {
  /**
   * Obtém o status de conexão da integração social da organização.
   */
  async getStatus(): Promise<SocialPublisherStatus> {
    return api.get<SocialPublisherStatus>('/api/v1/social/status');
  },

  /**
   * Lista todas as contas sociais disponíveis no workspace da organização.
   */
  async getAvailableAccounts(): Promise<AvailableSocialAccount[]> {
    return api.get<AvailableSocialAccount[]>('/api/v1/social/accounts/available');
  },

  /**
   * Lista as contas sociais vinculadas especificamente a um cliente.
   */
  async getClientAccounts(clientId: string): Promise<SocialAccount[]> {
    return api.get<SocialAccount[]>(`/api/v1/clients/${clientId}/social/accounts`);
  },

  /**
   * Lista as contas sociais disponíveis e o estado de vínculo em relação a um cliente.
   */
  async getClientAvailableAccounts(clientId: string): Promise<AvailableSocialAccount[]> {
    return api.get<AvailableSocialAccount[]>(`/api/v1/clients/${clientId}/social/accounts/available`);
  },

  /**
   * Vincula uma conta social ao cliente.
   */
  async linkAccount(clientId: string, accountId: string): Promise<{ success: boolean; accountId: string }> {
    return api.post<{ success: boolean; accountId: string }>(
      `/api/v1/clients/${clientId}/social/accounts`,
      { accountId }
    );
  },

  /**
   * Desvincula uma conta social do cliente.
   */
  async unlinkAccount(clientId: string, accountId: string): Promise<{ success: boolean; accountId: string }> {
    return api.delete<{ success: boolean; accountId: string }>(
      `/api/v1/clients/${clientId}/social/accounts/${accountId}`
    );
  },

  /**
   * Consulta a agenda agregada de publicações da organização com filtros e paginação.
   */
  async getAggregatedContent(filters?: AggregatedSocialContentFilters): Promise<AggregatedSocialContentResponse> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.set('startDate', filters.startDate);
    if (filters?.endDate) params.set('endDate', filters.endDate);
    if (filters?.clientId) params.set('clientId', filters.clientId);
    if (filters?.accountId) params.set('accountId', filters.accountId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.format) params.set('format', filters.format);
    if (filters?.search) params.set('search', filters.search);
    if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));
    if (typeof filters?.offset === 'number') params.set('offset', String(filters.offset));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return api.get<AggregatedSocialContentResponse>(`/api/v1/social/content${queryString}`);
  },

  /**
   * Percorre todas as páginas de conteúdo agregado da organização até exaustão.
   * Utilizado pelo calendário mensal para carregar a totalidade das publicações do período.
   * Inclui salvaguarda contra loops infinitos (máximo 50 páginas de 100 itens).
   */
  async getAllAggregatedContent(
    filters?: Omit<AggregatedSocialContentFilters, 'limit' | 'offset'>
  ): Promise<AggregatedSocialPost[]> {
    const pageSize = 100;
    let offset = 0;
    let total = Infinity;
    const allPosts: AggregatedSocialPost[] = [];
    const maxIterations = 50;
    let iteration = 0;

    while (offset < total && iteration < maxIterations) {
      iteration++;
      const response = await this.getAggregatedContent({
        ...filters,
        limit: pageSize,
        offset,
      });

      total = response.total;
      const receivedCount = response.posts.length;

      if (receivedCount === 0) {
        break;
      }

      allPosts.push(...response.posts);
      offset += receivedCount;

      if (receivedCount < pageSize && offset < total) {
        break;
      }
    }

    return allPosts;
  },

  /**
   * Consulta publicações de um cliente específico com paginação.
   */
  async getClientContent(
    clientId: string,
    filters?: { status?: SocialPostStatus; limit?: number; offset?: number }
  ): Promise<{ posts: SocialPost[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));
    if (typeof filters?.offset === 'number') params.set('offset', String(filters.offset));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return api.get<{ posts: SocialPost[]; total: number; limit: number; offset: number }>(
      `/api/v1/clients/${clientId}/social/content${queryString}`
    );
  },

  /**
   * Percorre todas as páginas de publicações de um cliente específico.
   */
  async getAllClientContent(clientId: string, status?: SocialPostStatus): Promise<SocialPost[]> {
    const pageSize = 100;
    let offset = 0;
    let total = Infinity;
    const allPosts: SocialPost[] = [];
    const maxIterations = 50;
    let iteration = 0;

    while (offset < total && iteration < maxIterations) {
      iteration++;
      const response = await this.getClientContent(clientId, {
        status,
        limit: pageSize,
        offset,
      });

      total = response.total;
      const receivedCount = response.posts.length;

      if (receivedCount === 0) {
        break;
      }

      allPosts.push(...response.posts);
      offset += receivedCount;

      if (receivedCount < pageSize && offset < total) {
        break;
      }
    }

    return allPosts;
  },

  /**
   * Obtém detalhes de uma publicação específica de um cliente.
   */
  async getClientPost(clientId: string, postId: string): Promise<SocialPost> {
    return api.get<SocialPost>(`/api/v1/clients/${clientId}/social/content/${postId}`);
  },

  /**
   * Realiza upload multipart de um arquivo de mídia para uso em publicações sociais.
   * Exige Idempotency-Key para proteger contra timeouts e uploads duplicados.
   */
  async uploadMedia(file: File, idempotencyKey: string): Promise<SocialMediaUploadResult> {
    const formData = new FormData();
    formData.append('file', file);

    return api.post<SocialMediaUploadResult>('/api/v1/social/upload', formData, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
  },

  /**
   * Cria uma nova publicação social canônica para um cliente.
   * Exige Idempotency-Key para idempotência estrita da operação.
   */
  async createPost(
    clientId: string,
    payload: Omit<CreateSocialPostInput, 'idempotencyKey'>,
    idempotencyKey: string
  ): Promise<SocialPost> {
    return api.post<SocialPost>(`/api/v1/clients/${clientId}/social/content`, payload, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
  },

  /**
   * Agenda ou retemporiza uma publicação social existente.
   */
  async schedulePost(clientId: string, postId: string, scheduledAt: string): Promise<SocialPost> {
    return api.patch<SocialPost>(`/api/v1/clients/${clientId}/social/content/${postId}/schedule`, {
      scheduledAt,
    });
  },

  /**
   * Cancela o agendamento de uma publicação social.
   */
  async cancelPost(clientId: string, postId: string): Promise<{ success: boolean }> {
    return api.post<{ success: boolean }>(`/api/v1/clients/${clientId}/social/content/${postId}/cancel`);
  },

  /**
   * Obtém métricas de engajamento de uma publicação específica.
   */
  async getPostAnalytics(clientId: string, postId: string): Promise<SocialPostAnalytics | null> {
    return api.get<SocialPostAnalytics | null>(`/api/v1/clients/${clientId}/social/content/${postId}/analytics`);
  },

  /**
   * Obtém métricas consolidadas de uma conta social.
   */
  async getAccountAnalytics(
    clientId: string,
    accountId: string,
    filters?: { startDate?: string; endDate?: string }
  ): Promise<SocialAccountAnalytics | null> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.set('startDate', filters.startDate);
    if (filters?.endDate) params.set('endDate', filters.endDate);
    const queryString = params.toString() ? `?${params.toString()}` : '';

    return api.get<SocialAccountAnalytics | null>(
      `/api/v1/clients/${clientId}/social/accounts/${accountId}/analytics${queryString}`
    );
  },
};
