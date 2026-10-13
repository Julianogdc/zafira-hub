import { backoffDelayMs, type GoogleEventRaw } from '@zafira/domain';

/**
 * F7-3a - Cliente HTTP do Google Calendar, SOMENTE LEITURA (DEC-F7-011/012).
 *
 * Garantias:
 *  - A API de agenda so e acessada por GET (nao ha metodo de escrita neste modulo);
 *  - o unico POST e o do endpoint de TOKEN do OAuth (troca de codigo / renovacao), que nao e a API de agenda;
 *  - bases configuraveis por ambiente: em CI aponta para o simulador, nunca para o Google;
 *  - segredos nunca entram em mensagens de erro.
 */

export type GoogleErrorKind = 'RATE_LIMITED' | 'AUTH_REVOKED' | 'FORBIDDEN' | 'TRANSIENT' | 'INVALID' | 'NOT_CONFIGURED';

export class GoogleCalendarError extends Error {
  constructor(
    public readonly kind: GoogleErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const googleConfig = {
  apiBase: () => (process.env.GOOGLE_CALENDAR_API_BASE || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, ''),
  tokenUrl: () => process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  authUrl: () => process.env.GOOGLE_OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  oauth(): GoogleOAuthConfig | null {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
    return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
  },
};

/** Escopos minimos: leitura de agendas e identificacao basica da conta. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'];

export interface CalendarListEntry {
  id: string;
  summary: string;
  accessRole: string;
  timeZone?: string;
  backgroundColor?: string;
  primary?: boolean;
}

export interface EventsPage {
  items: GoogleEventRaw[];
  nextPageToken?: string;
}

type FetchLike = typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GoogleCalendarClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly wait: (ms: number) => Promise<unknown> = sleep,
    private readonly maxAttempts = 3
  ) {}

  /* ------------------------------ OAuth (endpoint de token) ------------------------------ */

  private async tokenRequest(params: Record<string, string>): Promise<Record<string, any>> {
    const cfg = googleConfig.oauth();
    if (!cfg) throw new GoogleCalendarError('NOT_CONFIGURED', 'Integracao Google nao configurada neste ambiente.');
    const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
    let res: Response;
    try {
      res = await this.fetchImpl(googleConfig.tokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new GoogleCalendarError('TRANSIENT', 'Falha de rede ao falar com o Google.');
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      if (data.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
        throw new GoogleCalendarError('AUTH_REVOKED', 'Autorizacao do Google revogada ou expirada. Reconecte a conta.', res.status);
      }
      throw new GoogleCalendarError(res.status === 429 ? 'RATE_LIMITED' : 'TRANSIENT', 'Falha ao renovar a autorizacao do Google.', res.status);
    }
    return data;
  }

  async exchangeCode(code: string, codeVerifier: string) {
    const cfg = googleConfig.oauth();
    if (!cfg) throw new GoogleCalendarError('NOT_CONFIGURED', 'Integracao Google nao configurada neste ambiente.');
    const data = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: codeVerifier,
    });
    if (!data.refresh_token || !data.access_token) {
      throw new GoogleCalendarError('INVALID', 'O Google nao devolveu autorizacao offline. Refaca a conexao.');
    }
    return {
      refreshToken: String(data.refresh_token),
      accessToken: String(data.access_token),
      idToken: typeof data.id_token === 'string' ? data.id_token : null,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    const data = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (!data.access_token) throw new GoogleCalendarError('AUTH_REVOKED', 'Autorizacao do Google invalida. Reconecte a conta.');
    return String(data.access_token);
  }

  /* ------------------------------ API de agenda: SOMENTE GET ------------------------------ */

  private async get(path: string, accessToken: string, query: Record<string, string | undefined> = {}): Promise<any> {
    const url = new URL(`${googleConfig.apiBase()}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
    let lastError: GoogleCalendarError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) await this.wait(backoffDelayMs(attempt - 1));
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      } catch {
        lastError = new GoogleCalendarError('TRANSIENT', 'Falha de rede ao consultar o Google Calendar.');
        continue;
      }
      if (res.ok) return res.json();
      const data = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[]; status?: string } };
      const reason = data?.error?.errors?.[0]?.reason ?? '';
      if (res.status === 401) throw new GoogleCalendarError('AUTH_REVOKED', 'Autorizacao do Google invalida. Reconecte a conta.', 401);
      if (res.status === 429 || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason))) {
        lastError = new GoogleCalendarError('RATE_LIMITED', 'Limite de uso da API do Google atingido.', res.status);
        continue;
      }
      if (res.status >= 500) {
        lastError = new GoogleCalendarError('TRANSIENT', 'Google Calendar indisponivel no momento.', res.status);
        continue;
      }
      if (res.status === 403 || res.status === 404) throw new GoogleCalendarError('FORBIDDEN', 'A conta conectada nao tem acesso a este calendario.', res.status);
      throw new GoogleCalendarError('INVALID', `Resposta inesperada do Google Calendar (${res.status}).`, res.status);
    }
    throw lastError ?? new GoogleCalendarError('TRANSIENT', 'Falha ao consultar o Google Calendar.');
  }

  async listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
    const out: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get('/users/me/calendarList', accessToken, { maxResults: '250', pageToken });
      out.push(...((page.items ?? []) as CalendarListEntry[]));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Uma pagina de eventos. O chamador pagina e so avanca o cursor ao concluir TODAS as paginas. */
  async listEventsPage(
    accessToken: string,
    calendarId: string,
    q: { timeMin: Date; timeMax: Date; updatedMin?: Date | null; pageToken?: string }
  ): Promise<EventsPage> {
    const page = await this.get(`/calendars/${encodeURIComponent(calendarId)}/events`, accessToken, {
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
      timeMin: q.timeMin.toISOString(),
      timeMax: q.timeMax.toISOString(),
      updatedMin: q.updatedMin ? q.updatedMin.toISOString() : undefined,
      pageToken: q.pageToken,
    });
    return { items: (page.items ?? []) as GoogleEventRaw[], nextPageToken: page.nextPageToken };
  }
}
