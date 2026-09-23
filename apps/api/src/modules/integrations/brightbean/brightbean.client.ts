import {
  BrightBeanAccount,
  BrightBeanAccountAnalyticsResponse,
  BrightBeanCreatePostPayload,
  BrightBeanErrorResponse,
  BrightBeanMediaAsset,
  BrightBeanMeResponse,
  BrightBeanPlatformPost,
  BrightBeanPostAnalyticsResponse,
  BrightBeanPostResponse,
} from './brightbean.types.js';

export class BrightBeanApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly detail?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    statusCode: number;
    code?: string;
    detail?: string;
    message?: string;
    retryAfterSeconds?: number;
  }) {
    const safeMsg =
      params.message ||
      params.detail ||
      `BrightBean API HTTP ${params.statusCode}`;
    super(safeMsg);
    this.name = 'BrightBeanApiError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.detail = params.detail;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

export interface BrightBeanClientOptions {
  apiBaseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface BrightBeanUploadMediaInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  idempotencyKey?: string;
}

export class BrightBeanClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: BrightBeanClientOptions) {
    if (!options.apiBaseUrl) {
      throw new Error('apiBaseUrl is required for BrightBeanClient');
    }
    if (!options.apiKey) {
      throw new Error('apiKey is required for BrightBeanClient');
    }
    // Remove barras finais para garantir caminhos consistentes
    this.baseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetchImpl || globalThis.fetch;

    if (!this.fetcher) {
      throw new Error('No fetch implementation available for BrightBeanClient');
    }
  }

  private getHeaders(
    customHeaders?: Record<string, string>,
    idempotencyKey?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...customHeaders,
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | FormData;
      idempotencyKey?: string;
    } = {}
  ): Promise<T> {
    const method = options.method || 'GET';
    // Garante barra inicial no endpoint
    const formattedEndpoint = endpoint.startsWith('/')
      ? endpoint
      : `/${endpoint}`;
    const url = `${this.baseUrl}${formattedEndpoint}`;

    const headers = this.getHeaders(options.headers, options.idempotencyKey);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers,
        body: options.body,
      });
    } catch (err: any) {
      throw new BrightBeanApiError({
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: err?.message || 'Falha de conexão com a API da BrightBean',
      });
    }

    if (!response.ok) {
      let errorBody: BrightBeanErrorResponse | undefined;
      try {
        errorBody = (await response.json()) as BrightBeanErrorResponse;
      } catch {
        // Ignora falha de parse de JSON de erro
      }

      let retryAfter: number | undefined;
      const retryAfterHeader = response.headers?.get('Retry-After');
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfter = parsed;
        }
      }

      throw new BrightBeanApiError({
        statusCode: response.status,
        code: errorBody?.code || `HTTP_${response.status}`,
        detail: errorBody?.detail || errorBody?.message,
        message:
          errorBody?.message ||
          errorBody?.detail ||
          `Erro HTTP ${response.status} na API BrightBean`,
        retryAfterSeconds: retryAfter,
      });
    }

    // Trata respostas sem conteúdo (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    try {
      const data = await response.json();
      return data as T;
    } catch {
      return {} as T;
    }
  }

  async getMe(): Promise<BrightBeanMeResponse> {
    return this.request<BrightBeanMeResponse>('/me/');
  }

  async listAccounts(): Promise<BrightBeanAccount[]> {
    return this.request<BrightBeanAccount[]>('/accounts/');
  }

  async getMedia(mediaId: string): Promise<BrightBeanMediaAsset> {
    return this.request<BrightBeanMediaAsset>(`/media/${mediaId}`);
  }

  async uploadMedia(
    input: BrightBeanUploadMediaInput
  ): Promise<BrightBeanMediaAsset> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType,
    });
    formData.append('file', blob, input.filename);

    return this.request<BrightBeanMediaAsset>('/media/', {
      method: 'POST',
      body: formData,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async createPost(
    payload: BrightBeanCreatePostPayload,
    idempotencyKey?: string
  ): Promise<BrightBeanPostResponse> {
    return this.request<BrightBeanPostResponse>('/posts/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      idempotencyKey,
    });
  }

  async getPost(postId: string): Promise<BrightBeanPostResponse | null> {
    try {
      return await this.request<BrightBeanPostResponse>(`/posts/${postId}`);
    } catch (err: any) {
      if (err instanceof BrightBeanApiError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async schedulePost(
    postId: string,
    scheduledAt: string
  ): Promise<BrightBeanPostResponse> {
    return this.request<BrightBeanPostResponse>(`/posts/${postId}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_at: scheduledAt }),
    });
  }

  async cancelPost(postId: string): Promise<{ success: boolean }> {
    await this.request<{ success: boolean }>(`/posts/${postId}/cancel`, {
      method: 'POST',
    });
    return { success: true };
  }

  async getAccountAnalytics(
    accountId: string,
    days: number = 30
  ): Promise<BrightBeanAccountAnalyticsResponse | null> {
    const clampedDays = Math.min(Math.max(days, 7), 90);
    try {
      return await this.request<BrightBeanAccountAnalyticsResponse>(
        `/analytics/accounts/${accountId}?days=${clampedDays}`
      );
    } catch (err: any) {
      if (err instanceof BrightBeanApiError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getPostAnalytics(
    postId: string
  ): Promise<BrightBeanPostAnalyticsResponse | null> {
    try {
      return await this.request<BrightBeanPostAnalyticsResponse>(
        `/analytics/posts/${postId}`
      );
    } catch (err: any) {
      if (err instanceof BrightBeanApiError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }
}
