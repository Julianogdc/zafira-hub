/**
 * Cliente HTTP para a API v3 do Asaas (Modo Estritamente Somente Leitura).
 *
 * Responsável por consultar clientes e cobranças existentes no Asaas.
 * É terminantemente proibido o envio de mutações (POST, PUT, PATCH, DELETE)
 * para a API do Asaas nesta etapa.
 */

export class AsaasIntegrationError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 502, code = 'ASAAS_API_ERROR') {
    super(message);
    this.name = 'AsaasIntegrationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AsaasCustomer {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  cpfCnpj?: string | null;
  postalCode?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  deleted?: boolean;
}

export interface AsaasPaymentRaw {
  id: string;
  customer: string;
  dateCreated: string;
  dueDate: string;
  originalDueDate?: string | null;
  value: number;
  netValue?: number | null;
  originalValue?: number | null;
  interestValue?: number | null;
  description?: string | null;
  billingType: string;
  status: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  installmentNumber?: number | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  transactionReceiptUrl?: string | null;
  deleted?: boolean;
}

export interface AsaasListResponse<T> {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export class AsaasClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(apiKey?: string, baseUrl?: string, timeoutMs = 15000) {
    this.apiKey = (apiKey || process.env.ASAAS_API_KEY || '').trim();
    this.baseUrl = (baseUrl || process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  private validateConfig(): void {
    if (!this.apiKey) {
      throw new AsaasIntegrationError(
        'Integração Asaas não configurada: ASAAS_API_KEY ausente',
        500,
        'ASAAS_NOT_CONFIGURED'
      );
    }
  }

  /**
   * Executa requisição HTTP GET contra a API do Asaas.
   * Não expõe tokens nos cabeçalhos ou mensagens de erro.
   */
  private async get<T>(endpoint: string, queryParams?: Record<string, any>): Promise<T> {
    this.validateConfig();

    const query = new URLSearchParams();
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== '') {
          query.set(key, String(value));
        }
      }
    }

    const queryString = query.toString();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${cleanEndpoint}${queryString ? `?${queryString}` : ''}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          access_token: this.apiKey,
          Accept: 'application/json',
          'User-Agent': 'ZafiraHub-Asaas-Integration/2.0',
        },
      });

      if (!response.ok) {
        let errorMessage = `Asaas retornou status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.errors && Array.isArray(body.errors) && body.errors.length > 0) {
            errorMessage = body.errors.map((e: any) => e.description || e.message).join('; ');
          } else if (body?.message) {
            errorMessage = body.message;
          }
        } catch {
          // Ignora falha de parse do erro
        }

        if (response.status === 401 || response.status === 403) {
          throw new AsaasIntegrationError(
            'Chave de autenticação do Asaas inválida ou sem permissão',
            502,
            'ASAAS_UNAUTHORIZED'
          );
        }

        throw new AsaasIntegrationError(
          errorMessage,
          response.status >= 500 ? 502 : response.status,
          'ASAAS_API_ERROR'
        );
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (err instanceof AsaasIntegrationError) {
        throw err;
      }
      if (err?.name === 'AbortError') {
        throw new AsaasIntegrationError('Tempo limite excedido ao comunicar com o Asaas', 504, 'ASAAS_TIMEOUT');
      }
      throw new AsaasIntegrationError(`Falha de comunicação com o Asaas: ${err?.message || 'Erro de rede'}`, 502, 'ASAAS_NETWORK_ERROR');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Valida conectividade simples com a API do Asaas.
   */
  async isConnected(): Promise<{ connected: boolean }> {
    try {
      await this.getCustomers({ limit: 1 });
      return { connected: true };
    } catch {
      return { connected: false };
    }
  }

  /**
   * Consulta clientes no Asaas com paginação ou filtro por CPF/CNPJ.
   */
  async getCustomers(params?: {
    offset?: number;
    limit?: number;
    cpfCnpj?: string;
    name?: string;
  }): Promise<AsaasListResponse<AsaasCustomer>> {
    return this.get<AsaasListResponse<AsaasCustomer>>('/customers', params);
  }

  /**
   * Consulta cobranças no Asaas filtradas por cliente, status ou paginação.
   */
  async getPayments(params?: {
    customer?: string;
    status?: string;
    offset?: number;
    limit?: number;
    dueDateGe?: string;
    dueDateLe?: string;
  }): Promise<AsaasListResponse<AsaasPaymentRaw>> {
    return this.get<AsaasListResponse<AsaasPaymentRaw>>('/payments', params);
  }

  /**
   * Consulta uma cobrança específica pelo seu identificador do Asaas (ex: pay_12345).
   */
  async getPaymentById(id: string): Promise<AsaasPaymentRaw> {
    if (!id || !id.trim()) {
      throw new AsaasIntegrationError('ID da cobrança Asaas é obrigatório', 400, 'INVALID_PAYMENT_ID');
    }
    return this.get<AsaasPaymentRaw>(`/payments/${encodeURIComponent(id.trim())}`);
  }

  /**
   * Consulta todos os clientes existentes no Asaas iterando por todas as páginas.
   */
  async getAllCustomers(batchSize = 100): Promise<AsaasCustomer[]> {
    const allCustomers: AsaasCustomer[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await this.getCustomers({ offset, limit: batchSize });
      const items = res.data || [];
      allCustomers.push(...items);

      if (!res.hasMore || items.length === 0) {
        hasMore = false;
      } else {
        offset += items.length;
      }
    }

    return allCustomers;
  }

  /**
   * Consulta todas as cobranças existentes no Asaas iterando por todas as páginas.
   */
  async getAllPayments(batchSize = 100): Promise<AsaasPaymentRaw[]> {
    const allPayments: AsaasPaymentRaw[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await this.getPayments({ offset, limit: batchSize });
      const items = res.data || [];
      allPayments.push(...items);

      if (!res.hasMore || items.length === 0) {
        hasMore = false;
      } else {
        offset += items.length;
      }
    }

    return allPayments;
  }
}

