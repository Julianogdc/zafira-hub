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
 * Cliente HTTP para a API do Banco Inter PJ.
 * Política de segurança de rede e métodos:
 * - Autenticação OAuth2 client_credentials via POST exclusivamente em /oauth/v2/token com mTLS.
 * - Recursos bancários e financeiros operam ESTRITAMENTE em modo de leitura (GET).
 * - Zero operações POST, PUT, PATCH ou DELETE em recursos bancários/financeiros.
 * - Nenhum método de pagamento, Pix, transferência, cobrança, alteração ou exclusão bancária.
 */
export interface InterClientConfig {
  clientId?: string;
  clientSecret?: string;
  crtBase64?: string;
  keyBase64?: string;
  pfxBase64?: string;
  passphrase?: string;
  baseUrl?: string;
  oauthScope?: string;
  timeoutMs?: number;
}

/**
 * Cliente HTTP para a API do Banco Inter PJ.
 * Política de segurança de rede e métodos:
 * - Autenticação OAuth2 client_credentials via POST exclusivamente em /oauth/v2/token com mTLS.
 * - Suporte prioritário a certificado x509 (.crt) e chave privada (.key) decodificados 100% em memória.
 * - Recursos bancários e financeiros operam ESTRITAMENTE em modo de leitura (GET).
 * - Zero operações POST, PUT, PATCH ou DELETE em recursos bancários/financeiros.
 * - Nenhum método de pagamento, Pix, transferência, cobrança, alteração ou exclusão bancária.
 */
export class InterClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly crtBase64: string;
  private readonly keyBase64: string;
  private readonly pfxBase64: string;
  private readonly passphrase?: string;
  private readonly baseUrl: string;
  private readonly oauthScope: string;
  private readonly timeoutMs: number;

  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(
    clientIdOrConfig?: string | InterClientConfig,
    clientSecret?: string,
    crtOrPfxBase64?: string,
    keyOrPassphrase?: string,
    passphrase?: string,
    baseUrl?: string,
    oauthScope?: string,
    timeoutMs = 15000
  ) {
    if (typeof clientIdOrConfig === 'object' && clientIdOrConfig !== null) {
      const config = clientIdOrConfig;
      this.clientId = (config.clientId || process.env.INTER_CLIENT_ID || '').trim();
      this.clientSecret = (config.clientSecret || process.env.INTER_CLIENT_SECRET || '').trim();
      this.crtBase64 = (config.crtBase64 || process.env.INTER_CERTIFICATE_CRT_BASE64 || '').trim();
      this.keyBase64 = (config.keyBase64 || process.env.INTER_PRIVATE_KEY_BASE64 || '').trim();
      this.pfxBase64 = (config.pfxBase64 || process.env.INTER_CERTIFICATE_PFX_BASE64 || '').trim();
      this.passphrase = config.passphrase || process.env.INTER_CERTIFICATE_PASSPHRASE;
      this.baseUrl = (config.baseUrl || process.env.INTER_BASE_URL || 'https://cdpj.partners.bancointer.com.br').replace(/\/+$/, '');
      this.oauthScope = (config.oauthScope || process.env.INTER_OAUTH_SCOPE || 'extrato.read').trim();
      this.timeoutMs = config.timeoutMs ?? timeoutMs;
    } else {
      this.clientId = (clientIdOrConfig || process.env.INTER_CLIENT_ID || '').trim();
      this.clientSecret = (clientSecret || process.env.INTER_CLIENT_SECRET || '').trim();
      this.crtBase64 = (process.env.INTER_CERTIFICATE_CRT_BASE64 || '').trim();
      this.keyBase64 = (process.env.INTER_PRIVATE_KEY_BASE64 || '').trim();
      this.pfxBase64 = (process.env.INTER_CERTIFICATE_PFX_BASE64 || '').trim();
      this.passphrase = passphrase || process.env.INTER_CERTIFICATE_PASSPHRASE;

      // Suporte posicional retrocompatível:
      // Se crtOrPfxBase64 foi passado diretamente
      if (crtOrPfxBase64) {
        if (keyOrPassphrase && passphrase) {
          // 5 argumentos: clientId, clientSecret, crtBase64, keyBase64, passphrase
          this.crtBase64 = crtOrPfxBase64.trim();
          this.keyBase64 = keyOrPassphrase.trim();
          this.passphrase = passphrase;
        } else if (keyOrPassphrase) {
          // 4 argumentos: pode ser (crt, key) ou (pfx, passphrase)
          // Se for formato PEM/chave ou especificado como key
          this.crtBase64 = crtOrPfxBase64.trim();
          this.keyBase64 = keyOrPassphrase.trim();
        } else {
          // 3 argumentos legados: (clientId, clientSecret, pfxBase64)
          this.pfxBase64 = crtOrPfxBase64.trim();
        }
      }

      this.baseUrl = (baseUrl || process.env.INTER_BASE_URL || 'https://cdpj.partners.bancointer.com.br').replace(/\/+$/, '');
      this.oauthScope = (oauthScope || process.env.INTER_OAUTH_SCOPE || 'extrato.read').trim();
      this.timeoutMs = timeoutMs;
    }
  }

  /**
   * Retorna o escopo OAuth configurado (padrão 'extrato.read').
   * Não expõe credenciais, senhas ou certificado.
   */
  getOAuthScope(): string {
    return this.oauthScope;
  }

  /**
   * Retorna a lista de nomes das variáveis de ambiente obrigatórias que estão ausentes.
   * Não expõe valores nem dados sensíveis.
   */
  getMissingConfig(): string[] {
    const missing: string[] = [];
    if (!this.clientId) missing.push('INTER_CLIENT_ID');
    if (!this.clientSecret) missing.push('INTER_CLIENT_SECRET');

    const hasCrtAndKey = Boolean(this.crtBase64 && this.keyBase64);
    const hasPfx = Boolean(this.pfxBase64);

    if (!hasCrtAndKey && !hasPfx) {
      if (!this.crtBase64 && !this.keyBase64) {
        missing.push('INTER_CERTIFICATE_CRT_BASE64', 'INTER_PRIVATE_KEY_BASE64');
      } else if (!this.crtBase64) {
        missing.push('INTER_CERTIFICATE_CRT_BASE64');
      } else if (!this.keyBase64) {
        missing.push('INTER_PRIVATE_KEY_BASE64');
      }
    }

    return missing;
  }

  /**
   * Verifica se a integração está minimamente configurada no ambiente.
   */
  isConfigured(): boolean {
    return this.getMissingConfig().length === 0;
  }

  /**
   * Identifica o modo de autenticação mTLS ativo.
   */
  getMtlsConfigMode(): 'CRT_KEY' | 'PFX' | 'NONE' {
    if (this.crtBase64 && this.keyBase64) return 'CRT_KEY';
    if (this.pfxBase64) return 'PFX';
    return 'NONE';
  }

  private assertConfigured() {
    const missing = this.getMissingConfig();
    if (missing.length > 0) {
      throw new InterIntegrationError(
        `Integração Banco Inter não configurada no ambiente. Variáveis ausentes: ${missing.join(', ')}`,
        400,
        'INTER_NOT_CONFIGURED'
      );
    }
  }

  /**
   * Obtém agente HTTPS com suporte a CRT + KEY ou PFX em memória (mTLS).
   * Decodificação puramente em memória (Buffers), sem gravação de arquivos em disco.
   */
  private getHttpsAgent(): https.Agent {
    this.assertConfigured();

    // Caminho prioritário: CRT + KEY
    if (this.crtBase64 && this.keyBase64) {
      const certBuffer = Buffer.from(this.crtBase64, 'base64');
      const keyBuffer = Buffer.from(this.keyBase64, 'base64');
      return new https.Agent({
        cert: certBuffer,
        key: keyBuffer,
        passphrase: this.passphrase,
        rejectUnauthorized: true,
        keepAlive: true,
      });
    }

    // Fallback de compatibilidade: PFX
    if (this.pfxBase64) {
      const pfxBuffer = Buffer.from(this.pfxBase64, 'base64');
      return new https.Agent({
        pfx: pfxBuffer,
        passphrase: this.passphrase,
        rejectUnauthorized: true,
        keepAlive: true,
      });
    }

    throw new InterIntegrationError(
      'Configuração de mTLS do Banco Inter ausente.',
      400,
      'INTER_NOT_CONFIGURED'
    );
  }

  /**
   * Cria e retorna o agente HTTPS mTLS para validação segura em testes automatizados.
   * Não expõe segredos.
   */
  createHttpsAgentForTesting(): https.Agent {
    return this.getHttpsAgent();
  }

  /**
   * Obtém token OAuth2 (Client Credentials).
   * ÚNICO endpoint que realiza requisição POST externa.
   */
  async getAccessToken(): Promise<string> {
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
      scope: this.oauthScope,
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
        // Whitelist estrita de campos seguros: error, error_description, code, message
        let diagError: string | undefined;
        let diagDescription: string | undefined;
        let diagCode: string | undefined;
        let diagMessage: string | undefined;

        try {
          const rawText = await response.text();
          if (rawText && rawText.trim().startsWith('{')) {
            const body = JSON.parse(rawText);
            const sanitize = (val: unknown) => {
              if (typeof val !== 'string' && typeof val !== 'number') return undefined;
              const s = String(val).trim();
              return s ? s.slice(0, 300) : undefined;
            };
            diagError = sanitize(body?.error);
            diagDescription = sanitize(body?.error_description);
            diagCode = sanitize(body?.code);
            diagMessage = sanitize(body?.message);
          }
        } catch {
          // Corpo não-JSON ou erro de leitura: o corpo bruto NUNCA é registrado
        }

        const logParts: string[] = [`status=${response.status}`];
        if (diagError) logParts.push(`error=${diagError}`);
        if (diagDescription) logParts.push(`description=${diagDescription}`);
        if (diagCode) logParts.push(`code=${diagCode}`);
        if (diagMessage) logParts.push(`message=${diagMessage}`);
        if (!diagError && !diagDescription && !diagCode && !diagMessage) {
          logParts.push('detalhes=resposta_sem_campos_padrao');
        }

        const diagMessageText = logParts.join(', ');
        console.error(`[InterClient] OAuth recusado pelo Inter: ${diagMessageText}`);

        throw new InterIntegrationError(
          `Falha na autenticação OAuth2 do Banco Inter (${diagMessageText})`,
          response.status === 401 ? 401 : (response.status === 400 ? 400 : 502),
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
   * Executa requisição para recurso da API do Banco Inter PJ com guarda de segurança estrita.
   * Política de segurança:
   * - Recursos bancários e financeiros aceitam EXCLUSIVAMENTE o método GET.
   * - Qualquer tentativa de POST, PUT, PATCH ou DELETE em recursos bancários é imediatamente rejeitada.
   * - O método POST é permitido unicamente no endpoint OAuth /oauth/v2/token para autenticação.
   */
  async requestBankingResource<T = any>(
    method: string,
    endpoint: string,
    queryParams?: Record<string, string | number | undefined>
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const upperMethod = method.toUpperCase();

    if (upperMethod !== 'GET') {
      throw new InterIntegrationError(
        `Operação ${upperMethod} não permitida para o recurso bancário ${cleanEndpoint}. Recursos bancários operam estritamente via GET.`,
        405,
        'BANK_WRITE_FORBIDDEN'
      );
    }

    return this.get<T>(cleanEndpoint, queryParams);
  }

  /**
   * Consulta saldo atual da conta corrente PJ (GET /banking/v2/saldo).
   */
  async getBalances(): Promise<InterBalancesResponse> {
    return this.requestBankingResource<InterBalancesResponse>('GET', '/banking/v2/saldo');
  }

  /**
   * Consulta extrato por período (GET /banking/v2/extrato).
   */
  async getStatement(dataInicio: string, dataFim: string): Promise<InterStatementItem[]> {
    const res = await this.requestBankingResource<any>('GET', '/banking/v2/extrato', { dataInicio, dataFim });
    return Array.isArray(res) ? res : res?.transacoes || [];
  }
}

export const interClient = new InterClient();
