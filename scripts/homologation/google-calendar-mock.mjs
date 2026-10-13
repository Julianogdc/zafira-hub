// ==============================================================================
// Simulador do Google Calendar (API v3, SOMENTE LEITURA) + endpoint de token OAuth.
// Usado em testes e ensaios: NENHUMA conta real, nenhum acesso ao Google.
//  - importavel: createGoogleCalendarMock() devolve um `fetch` em memoria;
//  - executavel: `node google-calendar-mock.mjs` sobe um servidor HTTP local (PORT, padrao 8091).
// Registra toda requisicao (metodo + caminho) para provar que a API de agenda so recebe GET.
// ==============================================================================
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function createGoogleCalendarMock() {
  const state = {
    calendars: [],
    /** calendarId -> eventos no formato da API (com `updated`) */
    events: {},
    /** falhas consumidas, uma por requisicao de eventos: { status, reason? } */
    failures: [],
    revoked: false,
    pageSize: 250,
    requests: [],
    eventCalls: 0,
    /** falha em chamadas consecutivas de eventos: a partir da chamada `failFromCall`, `failCount` vezes */
    failFromCall: 0,
    failCount: 0,
    failStatus: 500,
    failReason: 'backendError',
    account: { sub: 'mock-sub-1', email: 'agenda@zafira.invalid' },
    validCode: 'mock-code-ok',
  };

  const startOf = (e) => new Date(e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`).getTime();

  function listEvents(calendarId, q) {
    state.eventCalls += 1;
    let fail = state.failures.shift();
    if (!fail && state.failFromCall > 0 && state.eventCalls >= state.failFromCall && state.eventCalls < state.failFromCall + state.failCount) {
      fail = { status: state.failStatus, reason: state.failReason };
    }
    if (fail) return json(fail.status, { error: { code: fail.status, errors: [{ reason: fail.reason ?? 'backendError' }] } });
    const all = state.events[calendarId];
    if (!all) return json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
    const timeMin = q.get('timeMin') ? new Date(q.get('timeMin')).getTime() : -Infinity;
    const timeMax = q.get('timeMax') ? new Date(q.get('timeMax')).getTime() : Infinity;
    const updatedMin = q.get('updatedMin') ? new Date(q.get('updatedMin')).getTime() : null;
    const showDeleted = q.get('showDeleted') === 'true';
    let items = all.filter((e) => {
      const cancelled = e.status === 'cancelled';
      if (cancelled && !showDeleted && updatedMin === null) return false;
      if (updatedMin !== null && new Date(e.updated ?? 0).getTime() < updatedMin) return false;
      // cancelados sem horario entram sempre (como no Google com updatedMin)
      if (cancelled && !e.start) return true;
      const s = startOf(e);
      return s >= timeMin && s <= timeMax;
    });
    items = items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const size = Math.min(Number(q.get('maxResults')) || state.pageSize, state.pageSize);
    const offset = q.get('pageToken') ? Number(Buffer.from(q.get('pageToken'), 'base64url').toString()) : 0;
    const page = items.slice(offset, offset + size);
    const next = offset + size < items.length ? Buffer.from(String(offset + size)).toString('base64url') : undefined;
    return json(200, { kind: 'calendar#events', items: page, ...(next ? { nextPageToken: next } : {}) });
  }

  async function mockFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.href ?? input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    state.requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams) });

    // ---- endpoint de token (POST) - nao e a API de agenda
    if (url.pathname.endsWith('/token')) {
      const body = new URLSearchParams(String(init.body ?? ''));
      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') !== state.validCode || !body.get('code_verifier')) return json(400, { error: 'invalid_grant' });
        return json(200, {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          id_token: `x.${b64({ sub: state.account.sub, email: state.account.email })}.y`,
        });
      }
      if (body.get('grant_type') === 'refresh_token') {
        if (state.revoked || body.get('refresh_token') !== 'mock-refresh-token') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'mock-access-token', expires_in: 3600 });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }

    // ---- API de agenda: SOMENTE GET
    if (method !== 'GET') return json(405, { error: { code: 405, message: 'Somente leitura' } });
    const auth = new Headers(init.headers ?? {}).get('authorization');
    if (auth !== 'Bearer mock-access-token') return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });

    if (url.pathname.endsWith('/users/me/calendarList')) {
      const size = Math.min(Number(url.searchParams.get('maxResults')) || 250, 250);
      const offset = url.searchParams.get('pageToken') ? Number(Buffer.from(url.searchParams.get('pageToken'), 'base64url').toString()) : 0;
      const page = state.calendars.slice(offset, offset + size);
      const next = offset + size < state.calendars.length ? Buffer.from(String(offset + size)).toString('base64url') : undefined;
      return json(200, { items: page, ...(next ? { nextPageToken: next } : {}) });
    }
    const m = url.pathname.match(/\/calendars\/([^/]+)\/events$/);
    if (m) return listEvents(decodeURIComponent(m[1]), url.searchParams);
    return json(404, { error: { code: 404 } });
  }

  return {
    state,
    fetch: mockFetch,
    /** Quantidade de requisicoes por metodo na API de agenda (exclui o endpoint de token). */
    calendarApiMethods() {
      return [...new Set(state.requests.filter((r) => !r.path.endsWith('/token')).map((r) => r.method))];
    },
  };
}

// ---- modo servidor HTTP (ensaio manual / Browser Gate futuro)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mock = createGoogleCalendarMock();
  mock.state.calendars = [{ id: 'primary', summary: 'Agenda principal', accessRole: 'owner', primary: true, timeZone: 'America/Sao_Paulo' }];
  mock.state.events.primary = [];
  const port = Number(process.env.PORT) || 8091;
  createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/__control' && req.method === 'POST') {
      const data = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (data.calendars) mock.state.calendars = data.calendars;
      if (data.events) mock.state.events = data.events;
      if (data.revoked !== undefined) mock.state.revoked = Boolean(data.revoked);
      res.writeHead(204).end();
      return;
    }
    if (url.pathname.endsWith('/o/oauth2/v2/auth') && req.method === 'GET') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? '/');
      back.searchParams.set('code', mock.state.validCode);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { Location: back.toString() }).end();
      return;
    }
    if (url.pathname === '/__requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ methods: mock.calendarApiMethods(), count: mock.state.requests.length }));
      return;
    }
    const r = await mock.fetch(url.href, { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(await r.text());
  }).listen(port, '0.0.0.0', () => console.log(`[google-calendar-mock] ouvindo em ${port}`));
}
