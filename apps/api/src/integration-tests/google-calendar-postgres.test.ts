import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { GoogleCalendarClient } from '../modules/integrations/google-calendar/google-calendar.client.js';
import { googleCalendarService } from '../modules/integrations/google-calendar/google-calendar.service.js';
// @ts-ignore - simulador em .mjs (sem tipos)
import { createGoogleCalendarMock } from '../../../../scripts/homologation/google-calendar-mock.mjs';
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * F7-3a - Agenda Google Calendar (DEC-F7-012) contra PostgreSQL real e SIMULADOR do Google.
 * Nenhuma conta real; a API de agenda so recebe GET; participantes so por HMAC.
 * Nomes abaixo sao FIXTURES DE TESTE (removidas ao final).
 */
test('Integration Gate: Agenda Google Calendar (F7-3a) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'ci-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'ci-client-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost/calendar/oauth/callback';
  process.env.GOOGLE_CALENDAR_API_BASE = 'http://google.mock/calendar/v3';
  process.env.GOOGLE_OAUTH_TOKEN_URL = 'http://google.mock/token';
  process.env.CALENDAR_IDENTITY_HMAC_KEY = `ci-hmac-key-${run}-0123456789`;
  process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'ci-integration-encryption-key-0123456789';

  const mock = createGoogleCalendarMock();
  (googleCalendarService as any).client = new GoogleCalendarClient(mock.fetch as typeof fetch, async () => undefined, 3);

  const TABLES = ['calendar_sources', 'calendar_events', 'calendar_event_links', 'calendar_member_identities'];
  const initial: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
    initial[table] = Number(rows[0].n);
  }

  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-cal-a-${run}`, name: 'CI Agenda A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-cal-b-${run}`, name: 'CI Agenda B' } });
  const createdOrgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-cal-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const partA = await mkUser('part-a', orgA.id, 'MEMBER'); // participante dos eventos
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Agenda 1' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Agenda 2' } });
  await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: managerA.member.id, clientId: c1.id } });
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'ASANA', externalId: `cal-proj-${run}` } });

  type Who = { user: { id: string } };
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      cookies: who ? { token: (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org }) } : undefined,
      payload: payload as any,
    });
  const A = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);

  const stateOf = (res: any) => new URL(String(res.json().url)).searchParams.get('state')!;
  const connect = async () => {
    const auth = await A(adminA, 'POST', '/calendar/connection/authorize');
    assert.strictEqual(auth.statusCode, 200, auth.body);
    const cb = await app.inject({ method: 'GET', url: `/calendar/oauth/callback?code=${mock.state.validCode}&state=${encodeURIComponent(stateOf(auth))}` });
    return cb;
  };

  // ---- dados do simulador
  const now = Date.now();
  const iso = (offsetDays: number, hour = 12) => {
    const d = new Date(now + offsetDays * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const ev = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    status: 'confirmed',
    summary: `Evento ${id}`,
    description: 'DESCRICAO CONFIDENCIAL NAO PERSISTIR',
    hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc',
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    start: { dateTime: iso(3), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: iso(3, 13) },
    updated: iso(-1),
    organizer: { email: 'organizador@zafira.invalid' },
    attendees: [{ email: 'participante@zafira.invalid' }, { email: 'outro@zafira.invalid' }],
    ...over,
  });
  mock.state.calendars = [
    { id: 'cal-a', summary: 'Captacoes', accessRole: 'owner', timeZone: 'America/Sao_Paulo', backgroundColor: '#112233' },
    { id: 'cal-b', summary: 'Reunioes', accessRole: 'reader', timeZone: 'America/Sao_Paulo' },
    { id: 'cal-fb', summary: 'Ocupado', accessRole: 'freeBusyReader' },
  ];
  mock.state.events['cal-a'] = [
    ev('e-plain'),
    ev('e-private', { visibility: 'private', summary: 'Conversa reservada', location: 'Sala secreta', start: { dateTime: iso(4) }, end: { dateTime: iso(4, 13) } }),
    ev('e-allday', { start: { date: new Date(now + 5 * 86_400_000).toISOString().slice(0, 10) }, end: { date: new Date(now + 6 * 86_400_000).toISOString().slice(0, 10) } }),
    ev('serie-opaca-1', { recurringEventId: 'serie-xyz', originalStartTime: { dateTime: iso(6), timeZone: 'America/Sao_Paulo' }, start: { dateTime: iso(6) }, end: { dateTime: iso(6, 13) } }),
    ev('serie-opaca-2', { recurringEventId: 'serie-xyz', originalStartTime: { dateTime: iso(13), timeZone: 'America/Sao_Paulo' }, start: { dateTime: iso(13) }, end: { dateTime: iso(13, 13) } }),
    ev('e-cancelled', { status: 'cancelled', start: undefined, end: undefined, summary: undefined, attendees: undefined }),
    ev('e-far', { start: { dateTime: iso(400) }, end: { dateTime: iso(400, 13) } }),
  ];
  mock.state.events['cal-b'] = [ev('b-1', { start: { dateTime: iso(2) }, end: { dateTime: iso(2, 13) } })];

  await t.test('0. Migration sem dados e objetos SQL protegidos (F7-1a, F7-2a e F7-3a)', async () => {
    for (const table of TABLES) assert.strictEqual(initial[table], 0, `${table} deveria estar vazia`);
    const idx = new Set((await prisma.$queryRawUnsafe<{ indexname: string }[]>('SELECT indexname FROM pg_indexes')).map((r) => r.indexname));
    for (const n of [
      'calendar_events_attendee_hashes_gin',
      'calendar_links_one_per_event',
      'calendar_links_one_per_series',
      'onboarding_executions_one_active_per_client_template',
      'onboarding_versions_one_draft_per_template',
    ]) {
      assert.ok(idx.has(n), `indice protegido ausente: ${n}`);
    }
    const trg = new Set((await prisma.$queryRawUnsafe<{ tgname: string }[]>('SELECT tgname FROM pg_trigger WHERE NOT tgisinternal')).map((r) => r.tgname));
    for (const n of ['onboarding_step_runs_guard', 'onboarding_execution_events_guard', 'onboarding_executions_guard_update']) {
      assert.ok(trg.has(n), `gatilho protegido ausente: ${n}`);
    }
    const ck = new Set((await prisma.$queryRawUnsafe<{ conname: string }[]>('SELECT conname FROM pg_constraint')).map((r) => r.conname));
    for (const n of ['calendar_links_scope_shape', 'calendar_links_project_needs_client']) assert.ok(ck.has(n), `CHECK ausente: ${n}`);
  });

  await t.test('1. Permissoes: negacao por padrao, organizacoes e sem sessao', async () => {
    assert.strictEqual((await call(null, orgA.id, 'GET', '/calendar/events')).statusCode, 401);
    assert.strictEqual((await A(memberA, 'GET', '/calendar/connection')).statusCode, 403, 'MEMBER nao administra conexao');
    assert.strictEqual((await A(managerA, 'POST', '/calendar/connection/authorize')).statusCode, 403, 'MANAGER nao administra conexao');
    assert.strictEqual((await A(memberA, 'PUT', `/calendar/events/${randomUUID()}/link`, { category: 'MEETING' })).statusCode, 403, 'MEMBER nao vincula');
    assert.strictEqual((await A(memberA, 'GET', '/calendar/events')).statusCode, 200, 'MEMBER visualiza (com filtro)');
    assert.strictEqual((await A(adminA, 'GET', '/calendar/connection')).statusCode, 200);
    // estado da agenda (so leitura, sem dados de administracao) para quem visualiza
    assert.strictEqual((await call(null, orgA.id, 'GET', '/calendar/status')).statusCode, 401);
    const st = await A(memberA, 'GET', '/calendar/status');
    assert.strictEqual(st.statusCode, 200);
    assert.deepStrictEqual(Object.keys(st.json()).sort(), ['connected', 'hasErrors', 'lastSyncedAt', 'monitoredCalendars', 'neverSynced', 'requiresReconnect', 'stale']);
  });

  await t.test('2. OAuth: PKCE, escopo somente leitura, state de uso unico, credencial cifrada e nunca devolvida', async () => {
    const env = process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    assert.strictEqual((await A(adminA, 'POST', '/calendar/connection/authorize')).statusCode, 503, 'sem configuracao: indisponivel');
    process.env.GOOGLE_OAUTH_CLIENT_ID = env;

    const auth = await A(adminA, 'POST', '/calendar/connection/authorize');
    const url = new URL(auth.json().url);
    assert.strictEqual(url.searchParams.get('scope')?.split(' ').filter((s) => s.includes('calendar')).join(), 'https://www.googleapis.com/auth/calendar.readonly');
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(url.searchParams.get('access_type'), 'offline');

    const bad = await app.inject({ method: 'GET', url: `/calendar/oauth/callback?code=${mock.state.validCode}&state=invalido` });
    assert.match(String(bad.headers.location), /calendar=error/);
    assert.strictEqual(await prisma.integrationConnection.count({ where: { organizationId: orgA.id, provider: 'GOOGLE_CALENDAR' } }), 0);

    const state = stateOf(auth);
    const ok = await app.inject({ method: 'GET', url: `/calendar/oauth/callback?code=${mock.state.validCode}&state=${encodeURIComponent(state)}` });
    assert.match(String(ok.headers.location), /calendar=connected/);
    const replay = await app.inject({ method: 'GET', url: `/calendar/oauth/callback?code=${mock.state.validCode}&state=${encodeURIComponent(state)}` });
    assert.match(String(replay.headers.location), /calendar=error/, 'state e de uso unico');

    const conn = await prisma.integrationConnection.findFirstOrThrow({ where: { organizationId: orgA.id, provider: 'GOOGLE_CALENDAR' } });
    assert.ok(conn.credentialCiphertext && !conn.credentialCiphertext.includes('mock-refresh-token'), 'credencial cifrada');
    const status = await A(adminA, 'GET', '/calendar/connection');
    assert.strictEqual(status.json().connected, true);
    assert.ok(!status.body.includes('mock-refresh-token') && !status.body.includes('credential'), 'segredo nunca e devolvido');
    assert.match(status.json().accountHint, /\*\*\*@/, 'conta so mascarada');
  });

  await t.test('3. Calendarios: descoberta flexivel, selecao, categoria padrao, isolamento', async () => {
    const found = await A(adminA, 'POST', '/calendar/sources/discover');
    assert.strictEqual(found.statusCode, 200, found.body);
    const list = found.json() as Array<{ id: string; name: string; isMonitored: boolean; limitedDetails: boolean }>;
    assert.strictEqual(list.length, 3);
    assert.ok(list.every((s) => s.isMonitored === false), 'nada e monitorado automaticamente');
    assert.strictEqual(list.find((s) => s.name === 'Ocupado')!.limitedDetails, true);
    for (const name of ['Captacoes', 'Reunioes']) {
      const s = list.find((x) => x.name === name)!;
      const r = await A(adminA, 'PATCH', `/calendar/sources/${s.id}`, { isMonitored: true, defaultCategory: name === 'Captacoes' ? 'CAPTURE' : null });
      assert.strictEqual(r.statusCode, 200, r.body);
    }
    const other = list.find((x) => x.name === 'Ocupado')!;
    assert.strictEqual((await call(adminB, orgB.id, 'PATCH', `/calendar/sources/${other.id}`, { isMonitored: true })).statusCode, 404, 'organizacao B nao altera calendario da A');
    assert.strictEqual((await A(adminA, 'PATCH', `/calendar/sources/${other.id}`, { defaultCategory: 'NOPE' })).statusCode, 400);
    assert.deepStrictEqual((await call(adminB, orgB.id, 'GET', '/calendar/sources')).json(), [], 'organizacao B nao ve calendarios da A');
  });

  let sourceA: { id: string };
  await t.test('4. Sincronizacao inicial: janela, paginacao, dados minimos (sem e-mail, descricao, link de reuniao)', async () => {
    mock.state.pageSize = 2;
    mock.state.requests.length = 0;
    sourceA = await prisma.calendarSource.findFirstOrThrow({ where: { organizationId: orgA.id, googleCalendarId: 'cal-a' } });
    const r = await googleCalendarService.syncSource(orgA.id, sourceA.id);
    assert.strictEqual((r as any).ok, true, JSON.stringify(r));
    const calls = mock.state.requests.filter((x: any) => x.path.endsWith('/calendars/cal-a/events'));
    assert.ok(calls.length >= 3, `paginou (${calls.length} paginas)`);
    assert.ok(calls.every((c: any) => !c.query.updatedMin), 'carga inicial sem updatedMin');
    const min = new Date(calls[0].query.timeMin).getTime();
    const max = new Date(calls[0].query.timeMax).getTime();
    assert.ok(Math.abs((Date.now() - min) / 86_400_000 - 30) < 1 && Math.abs((max - Date.now()) / 86_400_000 - 180) < 1, 'janela -30/+180');
    assert.strictEqual(calls[0].query.singleEvents, 'true');
    assert.strictEqual(calls[0].query.showDeleted, 'true');

    const events = await prisma.calendarEvent.findMany({ where: { sourceId: sourceA.id } });
    assert.strictEqual(events.length, 6, 'o evento fora da janela (+400 d) nao veio');
    // minimizacao: nenhum e-mail, descricao ou link de videoconferencia em nenhuma coluna
    const dump = JSON.stringify(events);
    assert.ok(!dump.includes('@zafira.invalid') && !dump.includes('DESCRICAO') && !dump.includes('meet.google.com'), 'dados minimos');
    const plain = events.find((e) => e.googleEventId === 'e-plain')!;
    assert.strictEqual(plain.attendeeHashes.length, 3);
    assert.ok(plain.attendeeHashes.every((h) => /^[0-9a-f]{64}$/.test(h)), 'participantes so como HMAC');
    // recorrencia: IDs reais e originalStartTime preservados
    const inst = events.find((e) => e.googleEventId === 'serie-opaca-1')!;
    assert.strictEqual(inst.recurringEventId, 'serie-xyz');
    assert.ok(inst.originalStartDateTime);
    const allDay = events.find((e) => e.googleEventId === 'e-allday')!;
    assert.deepStrictEqual([allDay.isAllDay, allDay.startAt], [true, null]);
    // somente leitura: a API de agenda so recebeu GET
    assert.deepStrictEqual(mock.calendarApiMethods(), ['GET']);
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceA.id } });
    assert.ok(src.syncCursorAt && src.lastReconciledAt);
    const run1 = await prisma.syncRun.findFirstOrThrow({ where: { organizationId: orgA.id, operation: 'calendar.sync' }, orderBy: { startedAt: 'desc' } });
    assert.strictEqual(run1.status, 'SUCCESS');
  });

  await t.test('5. Idempotencia, execucao concorrente (lease) e vinculos preservados', async () => {
    const e = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-plain' } });
    const linked = await A(adminA, 'PUT', `/calendar/events/${e.id}/link`, { scope: 'EVENT', clientId: c1.id, category: 'MEETING', notes: 'Kickoff' });
    assert.strictEqual(linked.statusCode, 200, linked.body);
    const before = await prisma.calendarEvent.count({ where: { sourceId: sourceA.id } });
    const [r1, r2] = await Promise.all([googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true }), googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true })]);
    const outcomes = [r1, r2].map((r: any) => (r.skipped ? 'skipped' : r.ok ? 'ok' : 'fail')).sort();
    assert.ok(outcomes.includes('ok') && outcomes.includes('skipped'), `concorrencia: ${outcomes}`);
    const again = await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.strictEqual((again as any).ok, true);
    assert.strictEqual(await prisma.calendarEvent.count({ where: { sourceId: sourceA.id } }), before, 'sem duplicacao');
    assert.strictEqual(await prisma.calendarEventLink.count({ where: { eventId: e.id } }), 1, 'vinculo preservado');
  });

  await t.test('6. Incremental (updatedMin): alteracao, novo e cancelado; vinculo do cancelado preservado', async () => {
    const plain = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-plain' } });
    mock.state.events['cal-a'] = mock.state.events['cal-a'].map((x: any) =>
      x.id === 'e-plain' ? { ...x, status: 'cancelled', updated: new Date().toISOString() } : x.id === 'e-private' ? { ...x, summary: 'Reservado (alterado)', updated: new Date().toISOString() } : x
    );
    mock.state.events['cal-a'].push(ev('e-new', { updated: new Date().toISOString(), start: { dateTime: iso(7) }, end: { dateTime: iso(7, 13) } }));
    mock.state.requests.length = 0;
    const r = await googleCalendarService.syncSource(orgA.id, sourceA.id);
    assert.strictEqual((r as any).ok, true, JSON.stringify(r));
    assert.strictEqual((r as any).reconcile, false, 'ciclo incremental');
    const call0 = mock.state.requests.find((x: any) => x.path.endsWith('/calendars/cal-a/events'));
    assert.ok(call0.query.updatedMin, 'usa updatedMin');
    const after = await prisma.calendarEvent.findFirstOrThrow({ where: { id: plain.id } });
    assert.strictEqual(after.status, 'CANCELLED');
    assert.ok(after.title.length > 0 && after.startAt, 'cancelado nao apaga titulo/horario locais');
    assert.strictEqual(await prisma.calendarEventLink.count({ where: { eventId: plain.id } }), 1, 'vinculo do cancelado preservado');
    assert.ok(await prisma.calendarEvent.findFirst({ where: { sourceId: sourceA.id, googleEventId: 'e-new' } }));
    assert.strictEqual((await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-private' } })).title, 'Reservado (alterado)');
    // cancelado nao aparece como compromisso ativo
    const agenda = (await A(adminA, 'GET', '/calendar/events')).json() as Array<{ id: string }>;
    assert.ok(!agenda.some((x) => x.id === plain.id));
  });

  await t.test('7. Reconciliacao: movido para fora da janela some da agenda sem apagar; reaparece e volta', async () => {
    const target = mock.state.events['cal-a'].find((x: any) => x.id === 'e-allday');
    mock.state.events['cal-a'] = mock.state.events['cal-a'].filter((x: any) => x.id !== 'e-allday');
    const link = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-allday' } });
    await prisma.calendarEventLink.create({ data: { organizationId: orgA.id, scope: 'EVENT', eventId: link.id, clientId: c1.id, category: 'OTHER' } });
    const r = await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.strictEqual((r as any).ok, true);
    const gone = await prisma.calendarEvent.findFirstOrThrow({ where: { id: link.id } });
    assert.ok(gone.missingFromSourceAt, 'marcado como ausente');
    assert.strictEqual(await prisma.calendarEventLink.count({ where: { eventId: link.id } }), 1, 'vinculo e historico preservados');
    const visible = (await A(adminA, 'GET', '/calendar/events')).json() as Array<{ id: string }>;
    assert.ok(!visible.some((x) => x.id === link.id), 'nao aparece como compromisso ativo');
    mock.state.events['cal-a'].push(target);
    await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.strictEqual((await prisma.calendarEvent.findFirstOrThrow({ where: { id: link.id } })).missingFromSourceAt, null);
  });

  await t.test('8. Falha parcial: cursor nao avanca, nada duplica; recupera na proxima execucao', async () => {
    const before = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceA.id } });
    const count = await prisma.calendarEvent.count({ where: { sourceId: sourceA.id } });
    mock.state.pageSize = 2;
    mock.state.eventCalls = 0;
    mock.state.failFromCall = 2; // 2a pagina falha nas 3 tentativas
    mock.state.failCount = 3;
    mock.state.failStatus = 503;
    const r = await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.strictEqual((r as any).ok, false);
    const mid = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceA.id } });
    assert.strictEqual(mid.syncCursorAt?.getTime(), before.syncCursorAt?.getTime(), 'cursor preservado');
    assert.ok(mid.lastError);
    assert.strictEqual((await prisma.syncRun.findFirstOrThrow({ where: { organizationId: orgA.id }, orderBy: { startedAt: 'desc' } })).status, 'FAILED');
    mock.state.failFromCall = 0;
    const ok = await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.strictEqual((ok as any).ok, true);
    assert.strictEqual(await prisma.calendarEvent.count({ where: { sourceId: sourceA.id } }), count, 'sem duplicar');
    assert.strictEqual((await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceA.id } })).lastError, null);
  });

  await t.test('9. Limite de cota (429): retenta com backoff; esgotado vira falha controlada', async () => {
    mock.state.failures.push({ status: 429, reason: 'rateLimitExceeded' }, { status: 403, reason: 'userRateLimitExceeded' });
    const ok = await googleCalendarService.syncSource(orgA.id, sourceA.id);
    assert.strictEqual((ok as any).ok, true, 'recuperou apos 2 limites');
    mock.state.failures.push({ status: 429 }, { status: 429 }, { status: 429 });
    const bad = await googleCalendarService.syncSource(orgA.id, sourceA.id);
    assert.strictEqual((bad as any).ok, false);
    assert.strictEqual((bad as any).kind, 'RATE_LIMITED');
    mock.state.failures.length = 0;
  });

  await t.test('10. Acesso e mascaramento: sem cliente nao e da agencia; carteira; participante HMAC; privado', async () => {
    // vincula e-private a c1 (privado + carteira) e e-new sem cliente
    const priv = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-private' } });
    const unlinked = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-new' } });
    assert.strictEqual((await A(managerA, 'PUT', `/calendar/events/${priv.id}/link`, { clientId: c1.id, category: 'MEETING' })).statusCode, 404, 'gestor sem ver o evento nao vincula');
    assert.strictEqual((await A(adminA, 'PUT', `/calendar/events/${priv.id}/link`, { clientId: c1.id, category: 'MEETING' })).statusCode, 200);
    const idsOf = async (who: Who, qs = '') => ((await A(who, 'GET', `/calendar/events${qs}`)).json() as Array<{ id: string; masked: boolean; title: string; location: string | null; htmlLink: string | null }>);

    // sem associacao de identidade: ninguem e participante, mesmo informando e-mail pelo navegador
    const sneaky = await call(partA, orgA.id, 'GET', `/calendar/events?email=participante@zafira.invalid&participant=true`);
    assert.ok(!(sneaky.json() as any[]).some((x) => x.id === unlinked.id), 'dado do navegador nao concede acesso');
    assert.ok(!(await idsOf(memberA)).some((x) => x.id === unlinked.id), 'evento sem cliente nao e visivel a toda a agencia');
    assert.ok(!(await idsOf(managerA)).some((x) => x.id === unlinked.id));
    assert.ok((await idsOf(adminA)).some((x) => x.id === unlinked.id), 'view_all lista');

    // carteira: gestor ve o vinculado a c1, mascarado por ser privado
    const mgr = (await idsOf(managerA)).find((x) => x.id === priv.id)!;
    assert.ok(mgr, 'carteira ve o vinculado');
    assert.deepStrictEqual([mgr.masked, mgr.title, mgr.location, mgr.htmlLink], [true, 'Compromisso privado', null, null]);
    assert.ok(!(await idsOf(memberA)).some((x) => x.id === priv.id), 'membro sem o cliente nao ve');
    // view_all NAO revela o privado
    const adm = (await idsOf(adminA)).find((x) => x.id === priv.id)!;
    assert.deepStrictEqual([adm.masked, adm.title], [true, 'Compromisso privado']);

    // associacao explicita (somente pelo administrador) torna o membro participante
    assert.strictEqual((await A(memberA, 'PUT', '/calendar/identities', { memberId: partA.member.id, email: 'participante@zafira.invalid' })).statusCode, 403, 'membro nao associa identidades');
    const assoc = await A(adminA, 'PUT', '/calendar/identities', { memberId: partA.member.id, email: 'Participante@Zafira.invalid' });
    assert.strictEqual(assoc.statusCode, 200, assoc.body);
    assert.ok(!assoc.body.includes('participante@zafira.invalid'), 'e-mail nao e devolvido');
    const stored = await prisma.calendarMemberIdentity.findMany({ where: { organizationId: orgA.id } });
    assert.ok(stored.length === 1 && /^[0-9a-f]{64}$/.test(stored[0].identityHash) && !JSON.stringify(stored).includes('participante@'));
    const mine = await idsOf(partA);
    assert.ok(mine.some((x) => x.id === unlinked.id), 'participante ve evento sem cliente');
    const p = mine.find((x) => x.id === priv.id)!;
    assert.deepStrictEqual([p.masked, p.title, p.location !== null], [false, 'Reservado (alterado)', true], 'participante ve o privado inteiro');
    // organizacao B nunca ve nem altera
    assert.deepStrictEqual((await call(adminB, orgB.id, 'GET', '/calendar/events')).json(), []);
    assert.strictEqual((await call(adminB, orgB.id, 'PUT', `/calendar/events/${priv.id}/link`, { clientId: cB(), category: 'OTHER' })).statusCode, 404);
    function cB() {
      return randomUUID();
    }
  });

  await t.test('11. Vinculos: carteira, projeto local, serie herdada por novas ocorrencias', async () => {
    const s1 = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'serie-opaca-1' } });
    const s2 = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'serie-opaca-2' } });
    assert.strictEqual((await A(adminA, 'PUT', `/calendar/events/${s1.id}/link`, { clientId: randomUUID(), category: 'OTHER' })).statusCode, 404);
    assert.strictEqual((await A(managerA, 'PUT', `/calendar/events/${s1.id}/link`, { scope: 'SERIES', clientId: c2.id, category: 'OTHER' })).statusCode, 404, 'cliente fora da carteira');
    assert.strictEqual((await A(adminA, 'PUT', `/calendar/events/${s1.id}/link`, { clientId: c1.id, asanaProjectGid: 'nao-vinculado', category: 'OTHER' })).statusCode, 400);
    const plainEvent = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'e-new' } });
    assert.strictEqual((await A(adminA, 'PUT', `/calendar/events/${plainEvent.id}/link`, { scope: 'SERIES', clientId: c1.id, category: 'OTHER' })).statusCode, 400, 'nao e serie');
    const ok = await A(adminA, 'PUT', `/calendar/events/${s1.id}/link`, { scope: 'SERIES', clientId: c1.id, asanaProjectGid: `cal-proj-${run}`, category: 'MEETING' });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    const list = (await A(managerA, 'GET', '/calendar/events')).json() as Array<{ id: string; link: { clientId: string; scope: string } | null }>;
    assert.strictEqual(list.find((x) => x.id === s2.id)?.link?.clientId, c1.id, 'outra ocorrencia herda o vinculo da serie');
    // ocorrencia nova da mesma serie herda sem copiar linhas
    mock.state.events['cal-a'].push(ev('serie-opaca-3', { recurringEventId: 'serie-xyz', updated: new Date().toISOString(), start: { dateTime: iso(20) }, end: { dateTime: iso(20, 13) } }));
    await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    const s3 = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: sourceA.id, googleEventId: 'serie-opaca-3' } });
    const after = (await A(managerA, 'GET', '/calendar/events?to=' + encodeURIComponent(iso(30)))).json() as Array<{ id: string; link: { clientId: string } | null }>;
    assert.strictEqual(after.find((x) => x.id === s3.id)?.link?.clientId, c1.id);
    assert.strictEqual(await prisma.calendarEventLink.count({ where: { organizationId: orgA.id, scope: 'SERIES' } }), 1);
    // remover
    assert.strictEqual((await A(adminA, 'DELETE', `/calendar/events/${s1.id}/link?scope=SERIES`)).statusCode, 200);
    assert.strictEqual(await prisma.calendarEventLink.count({ where: { organizationId: orgA.id, scope: 'SERIES' } }), 0);
  });

  await t.test('12. Revogacao OAuth: pausa, preserva dados, reconecta e reconcilia', async () => {
    mock.state.revoked = true;
    const r = await googleCalendarService.syncSource(orgA.id, sourceA.id);
    assert.deepStrictEqual([(r as any).ok, (r as any).kind], [false, 'AUTH_REVOKED']);
    const st = (await A(adminA, 'GET', '/calendar/connection')).json();
    assert.deepStrictEqual([st.status, st.requiresReconnect], ['ERROR', true]);
    assert.ok((await prisma.calendarEvent.count({ where: { sourceId: sourceA.id } })) > 0, 'dados locais preservados');
    assert.strictEqual((await A(adminA, 'GET', '/calendar/events')).statusCode, 200, 'leitura local continua');
    assert.ok(await prisma.integrationError.findFirst({ where: { organizationId: orgA.id, code: 'AUTH_REVOKED' } }));
    // com a conexao em erro, o agendador nao tenta sincronizar
    assert.deepStrictEqual(await googleCalendarService.syncSource(orgA.id, sourceA.id), { skipped: 'NOT_CONNECTED' });
    mock.state.revoked = false;
    const cb = await connect();
    assert.match(String(cb.headers.location), /calendar=connected/);
    assert.strictEqual((await A(adminA, 'GET', '/calendar/connection')).json().status, 'ACTIVE');
    const back = await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.strictEqual((back as any).ok, true);
  });

  await t.test('13. Desconectar: segredo apagado, calendarios pausados, eventos preservados; janela configuravel', async () => {
    const win = await A(adminA, 'PATCH', '/calendar/settings', { windowPastDays: 10, windowFutureDays: 40 });
    assert.strictEqual(win.statusCode, 200, win.body);
    assert.deepStrictEqual([win.json().windowPastDays, win.json().windowFutureDays], [10, 40]);
    assert.strictEqual((await A(adminA, 'PATCH', '/calendar/settings', { windowPastDays: 9999 })).statusCode, 400);
    mock.state.requests.length = 0;
    await googleCalendarService.syncSource(orgA.id, sourceA.id);
    const call0 = mock.state.requests.find((x: any) => x.path.endsWith('/events'));
    const dMin = (Date.now() - new Date(call0.query.timeMin).getTime()) / 86_400_000;
    const dMax = (new Date(call0.query.timeMax).getTime() - Date.now()) / 86_400_000;
    assert.ok(Math.abs(dMin - 10) < 1 && Math.abs(dMax - 40) < 1, 'usa a janela configurada');

    const total = await prisma.calendarEvent.count({ where: { organizationId: orgA.id } });
    const d = await A(adminA, 'DELETE', '/calendar/connection');
    assert.strictEqual(d.statusCode, 200, d.body);
    const conn = await prisma.integrationConnection.findFirstOrThrow({ where: { organizationId: orgA.id, provider: 'GOOGLE_CALENDAR' } });
    assert.deepStrictEqual([conn.status, conn.credentialCiphertext], ['DISCONNECTED', null]);
    assert.strictEqual(await prisma.calendarEvent.count({ where: { organizationId: orgA.id } }), total, 'nada e apagado');
    assert.strictEqual(await prisma.calendarSource.count({ where: { organizationId: orgA.id, isMonitored: true } }), 0);
    assert.deepStrictEqual((await A(adminA, 'GET', '/calendar/events')).json(), [], 'origem nao monitorada nao aparece');
  });

  await t.test('14. Retencao: nenhuma exclusao automatica de eventos antigos', async () => {
    const old = await prisma.calendarEvent.create({
      data: { organizationId: orgA.id, sourceId: sourceA.id, googleEventId: `old-${run}`, title: 'Evento de 2 anos', startAt: new Date(Date.now() - 730 * 86_400_000), endAt: new Date(Date.now() - 730 * 86_400_000 + 3_600_000) },
    });
    await connect();
    await A(adminA, 'PATCH', `/calendar/sources/${sourceA.id}`, { isMonitored: true });
    await googleCalendarService.syncSource(orgA.id, sourceA.id, { forceFull: true });
    assert.ok(await prisma.calendarEvent.findUnique({ where: { id: old.id } }), 'evento antigo preservado');
  });

  await t.test('15. Somente leitura (codigo e trafego): so GET na API de agenda; remocao da organizacao em cascata', async () => {
    assert.deepStrictEqual(mock.calendarApiMethods(), ['GET']);
    const dir = fileURLToPath(new URL('../modules/integrations/google-calendar/', import.meta.url));
    for (const file of ['google-calendar.client.ts', 'google-calendar.service.ts', 'google-calendar.routes.ts']) {
      const src = readFileSync(dir + file, 'utf8');
      const methods = [...src.matchAll(/method:\s*'(GET|POST|PUT|PATCH|DELETE)'/g)].map((m) => m[1]);
      // unico POST: endpoint de TOKEN do OAuth (client); rotas HTTP do proprio Hub nao sao chamadas ao Google
      if (file.endsWith('client.ts')) assert.deepStrictEqual([...new Set(methods)].sort(), ['GET', 'POST']);
    }
    const clientSrc = readFileSync(dir + 'google-calendar.client.ts', 'utf8');
    assert.strictEqual((clientSrc.match(/method: 'POST'/g) ?? []).length, 1, 'um unico POST (token)');
    assert.ok(!/events\.(insert|patch|update|delete|import|move|quickAdd)/i.test(clientSrc), 'sem operacoes de escrita da API');

    const orgC = await prisma.organization.create({ data: { slug: `ci-cal-c-${run}`, name: 'CI Agenda C' } });
    createdOrgIds.push(orgC.id);
    const admC = await mkUser('admin-c', orgC.id, 'ADMIN');
    await prisma.integrationConnection.create({ data: { organizationId: orgC.id, provider: 'GOOGLE_CALENDAR', authType: 'OAUTH2', externalScopeId: 'c-sub' } });
    const conn = await prisma.integrationConnection.findFirstOrThrow({ where: { organizationId: orgC.id } });
    const src = await prisma.calendarSource.create({ data: { organizationId: orgC.id, connectionId: conn.id, googleCalendarId: 'x', name: 'x', accessRole: 'owner', isMonitored: true } });
    const ev1 = await prisma.calendarEvent.create({ data: { organizationId: orgC.id, sourceId: src.id, googleEventId: 'x1', title: 't' } });
    await prisma.calendarEventLink.create({ data: { organizationId: orgC.id, scope: 'EVENT', eventId: ev1.id, category: 'OTHER' } });
    await prisma.calendarMemberIdentity.create({ data: { organizationId: orgC.id, organizationMemberId: admC.member.id, identityHash: 'a'.repeat(64), displayHint: 'a***@x' } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgC.id } });
    await prisma.organization.delete({ where: { id: orgC.id } });
    assert.strictEqual(await prisma.calendarEvent.count({ where: { organizationId: orgC.id } }), 0);
    assert.strictEqual(await prisma.calendarSource.count({ where: { organizationId: orgC.id } }), 0);
  });
});
