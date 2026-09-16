import https from 'node:https';

/**
 * Erro customizado para operações da API do Banco Inter PJ.
 */
export class InterIntegrationError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 502, code = 'INTER_API_ERROR') {
    super(message);
    this.name = 'InterIntegrationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface InterBalancesResponse {
  disponivel: number;
  bloqueadoCheque?: number;
  bloqueadoJudicial?: number;
  limite?: number;
}

export interface InterStatementItem {
  dataEntrada: string; // formato YYYY-MM-DD
  tipoOperacao: 'C' | 'D'; // C = Crédito (Entrada), D = Débito (Saída)
  tipoTransacao: string; // ex: PIX, TED, BOLETO, TARIFA, etc.
  valor: number;
  titulo: string;
  descricao?: string;
  idTransacao?: string;
  chavePix?: string;
  contraparte?: {
    nome?: string;
    cpfCnpj?: string;
    banco?: string;
  };
}

/**
 * Cliente HTTP estritamente somente leitura para a API do Banco Inter PJ.
 * Suporta autenticação OAuth2 com mTLS via certificado PFX em memória.
 * Nenhuma operação de escrita, Pix ou transferência é implementada.
 */
export class InterClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly pfxBase64: string;
  private readonly passphrase?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(
    clientId?: string,
    clientSecret?: string,
    pfxBase64?: string,
    passphrase?: string,
    baseUrl?: string,
    timeoutMs = 15000
  ) {
    this.clientId = (clientId || process.env.INTER_CLIENT_ID || '').trim();
    this.clientSecret = (clientSecret || process.env.INTER_CLIENT_SECRET || '').trim();
    this.pfxBase64 = (pfxBase64 || process.env.INTER_CERTIFICATE_PFX_BASE64 || '').trim();
    this.passphrase = passphrase || process.env.INTER_CERTIFICATE_PASSPHRASE;
    this.baseUrl = (baseUrl || process.env.INTER_BASE_URL || 'https://cdpj.partners.bancointer.com.br').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Verifica se a integração está minimamente configurada no ambiente.
   */
  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.pfxBase64);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new InterIntegrationError(
        'Integração Banco Inter não configurada no ambiente.',
        400,
        'INTER_NOT_CONFIGURED'
      );
    }
  }

  /**
   * Obtém agente HTTPS com suporte ao certificado PFX em memória (mTLS).
   */
  private getHttpsAgent(): https.Agent {
    this.assertConfigured();
    const pfxBuffer = Buffer.from(this.pfxBase64, 'base64');
    return new https.Agent({
      pfx: pfxBuffer,
      passphrase: this.passphrase,
      rejectUnauthorized: true,
      keepAlive: true,
    });
  }

  /**
   * Obtém token OAuth2 (Client Credentials) com escopo de leitura de extrato.
   */
  private async getAccessToken(): Promise<string> {
    this.assertConfigured();

    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now + 60000) {
      return this.cachedToken;
    }

    const tokenUrl = `${this.baseUrl}/oauth/v2/token`;
    const agent = this.getHttpsAgent();

    const bodyParams = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
      scope: 'extrato.read',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
        // @ts-ignore - dispatcher/agent no node fetch
        agent,
      });

      if (!response.ok) {
        throw new InterIntegrationError(
          `Falha na autenticação OAuth2 do Banco Inter (status ${response.status})`,
          response.status === 401 ? 401 : 502,
          'INTER_AUTH_FAILED'
        );
      }

      const data = (await response.json()) as any;
      if (!data?.access_token) {
        throw new InterIntegrationError(
          'Token não retornado pela autenticação do Banco Inter',
          502,
          'INTER_INVALID_TOKEN_RESPONSE'
        );
      }

      this.cachedToken = data.access_token;
      const expiresInSeconds = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;

      return this.cachedToken;
    } catch (err: any) {
      if (err instanceof InterIntegrationError) throw err;
      if (err?.name === 'AbortError') {
        throw new InterIntegrationError('Tempo limite excedido na autenticação do Banco Inter', 504, 'INTER_TIMEOUT');
      }
      throw new InterIntegrationError(
        `Erro de conexão mTLS com Banco Inter: ${err?.message || 'Falha de rede'}`,
        502,
        'INTER_CONNECTION_ERROR'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Executa requisição GET autenticada com mTLS.
   */
  private async get<T>(endpoint: string, queryParams?: Record<string, string | number | undefined>): Promise<T> {
    this.assertConfigured();
    const token = await this.getAccessToken();

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
    const agent = this.getHttpsAgent();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'ZafiraHub-Inter-Integration/2.0',
        },
        // @ts-ignore - dispatcher/agent no node fetch
        agent,
      });

      if (!response.ok) {
        let errMsg = `Banco Inter retornou status ${response.status}`;
        try {
          const body = await response.json();
          if (body?.detail || body?.title || body?.message) {
            errMsg = body.detail || body.title || body.message;
          }
        } catch {
          // ignora falha de parse
        }

        throw new InterIntegrationError(errMsg, response.status >= 500 ? 502 : response.status, 'INTER_API_ERROR');
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (err instanceof InterIntegrationError) throw err;
      if (err?.name === 'AbortError') {
        throw new InterIntegrationError('Tempo limite excedido ao consultar Banco Inter', 504, 'INTER_TIMEOUT');
      }
      throw new InterIntegrationError(
        `Erro ao comunicar com Banco Inter: ${err?.message || 'Falha desconhecida'}`,
        502,
        'INTER_NETWORK_ERROR'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Consulta saldo atual da conta corrente PJ (GET /banking/v2/saldo).
   */
  async getBalances(): Promise<InterBalancesResponse> {
    return this.get<InterBalancesResponse>('/banking/v2/saldo');
  }

  /**
   * Consulta extrato por período (GET /banking/v2/extrato).
   */
  async getStatement(dataInicio: string, dataFim: string): Promise<InterStatementItem[]> {
    const res = await this.get<any>('/banking/v2/extrato', { dataInicio, dataFim });
    return Array.isArray(res) ? res : res?.transacoes || [];
  }
}

export const interClient = new InterClient();
