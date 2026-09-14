/**
 * Client HTTP seguro para comunicação com a Public API do Postiz Lab.
 * Nunca expõe nem loga a POSTIZ_API_KEY.
 */

export class PostizIntegrationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'POSTIZ_ERROR') {
    super(message);
    this.name = 'PostizIntegrationError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, PostizIntegrationError.prototype);
  }
}

export interface PostizRawAccount {
  id: string;
  name: string;
  identifier: string;
  picture?: string | null;
  disabled?: boolean;
  profile?: string | null;
  customer?: {
    id: string;
    name: string;
  } | null;
}

export interface PostizRawPost {
  id: string;
  content: string;
  publishDate: string | Date;
  releaseURL?: string | null;
  releaseId?: string | null;
  state: string;
  intervalInDays?: number | null;
  group?: string;
  creationMethod?: string;
  settings?: any;
  image?: any;
  media?: any;
  tags?: Array<{ tag: { id: string; name: string } }>;
  integration: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture?: string | null;
  };
}

export interface GetPostsParams {
  startDate?: string;
  endDate?: string;
  customer?: string;
}

export interface PostizClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class PostizClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config?: PostizClientConfig) {
    this.baseUrl = (config?.baseUrl || process.env.POSTIZ_URL || '').replace(/\/+$/, '');
    this.apiKey = config?.apiKey || process.env.POSTIZ_API_KEY || '';
    this.timeoutMs = config?.timeoutMs ?? 10000;
  }

  private validateConfig(): void {
    if (!this.baseUrl || !this.apiKey) {
      throw new PostizIntegrationError(
        'Integração Postiz não configurada: POSTIZ_URL ou POSTIZ_API_KEY ausente',
        500,
        'POSTIZ_NOT_CONFIGURED'
      );
    }
  }

  /**
   * Executa requisição HTTP autenticada contra a Public API do Postiz.
   * Não expõe segredos em erros ou cabeçalhos retornados.
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    this.validateConfig();

    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
          Authorization: this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        let errorMessage = `Postiz retornou status ${response.status}`;
        if (contentType.includes('application/json')) {
          try {
            const errorBody = await response.json();
            if (errorBody?.msg) {
              errorMessage = errorBody.msg;
            } else if (errorBody?.message) {
              errorMessage = errorBody.message;
            }
          } catch {
            // Ignora falha de parse do body de erro
          }
        }

        if (response.status === 401 || response.status === 403) {
          throw new PostizIntegrationError(
            'Chave de autenticação do Postiz inválida ou sem permissão',
            502,
            'POSTIZ_UNAUTHORIZED'
          );
        }

        throw new PostizIntegrationError(
          errorMessage,
          response.status >= 500 ? 502 : response.status,
          'POSTIZ_API_ERROR'
        );
      }

      if (!contentType.includes('application/json')) {
        throw new PostizIntegrationError(
          `Resposta inválida do serviço Postiz: esperado JSON, recebido ${contentType || 'formato desconhecido'} (HTTP ${response.status})`,
          502,
          'POSTIZ_INVALID_RESPONSE'
        );
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (err instanceof PostizIntegrationError) {
        throw err;
      }

      if (err.name === 'AbortError') {
        throw new PostizIntegrationError(
          `Timeout de comunicação com o Postiz (${this.timeoutMs}ms)`,
          504,
          'POSTIZ_TIMEOUT'
        );
      }

      throw new PostizIntegrationError(
        'Falha ao conectar com o serviço Postiz: ' + (err?.message || 'Serviço inacessível'),
        502,
        'POSTIZ_UNREACHABLE'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * GET /api/public/v1/is-connected
   */
  async isConnected(): Promise<{ connected: boolean }> {
    return this.request<{ connected: boolean }>('/api/public/v1/is-connected', {
      method: 'GET',
    });
  }

  /**
   * GET /api/public/v1/integrations
   */
  async getIntegrations(): Promise<PostizRawAccount[]> {
    return this.request<PostizRawAccount[]>('/api/public/v1/integrations', {
      method: 'GET',
    });
  }

  /**
   * GET /api/public/v1/posts
   * O Postiz exige startDate e endDate via validação de data (ISO 8601).
   * Se não informados, definimos uma janela padrão de 90 dias passados até 30 dias futuros.
   */
  async getPosts(params?: GetPostsParams): Promise<{ posts: PostizRawPost[] }> {
    const query = new URLSearchParams();

    const defaultStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const defaultEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    query.set('startDate', params?.startDate || defaultStart);
    query.set('endDate', params?.endDate || defaultEnd);

    if (params?.customer) {
      query.set('customer', params.customer);
    }

    return this.request<{ posts: PostizRawPost[] }>(`/api/public/v1/posts?${query.toString()}`, {
      method: 'GET',
    });
  }
}

