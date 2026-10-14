import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * F7-3c - Etapas de onboarding por evento do Google Calendar (DEC-F7-014) contra PostgreSQL real.
 * So eventos e vinculos LOCAIS; nenhuma chamada ao Google. Fixtures de teste removidas ao final.
 */
test('Integration Gate: Onboarding por evento do Calendar (F7-3c) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-onc-a-${run}`, name: 'CI Onb Cal A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-onc-b-${run}`, name: 'CI Onb Cal B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-onc-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER'); // responsavel da etapa
  const otherA = await mkUser('other-a', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Cal 1' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Cal 2' } });
  const cB = await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Cliente Cal B' } });
  for (const m of [managerA, memberA, otherA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }

  type Who = { user: { id: string } };
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      cookies: who ? { token: (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org }) } : undefined,
      payload: payload as any,
    });
  const A = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);
  const S = (key: string, over: Record<string, unknown> = {}) => ({
    stepKey: key,
    title: `CI etapa ${key}`,
    kind: 'MANUAL',
    assigneeMode: 'NONE',
    dueAnchor: 'RELEASED',
    evidenceKind: 'NONE',
    evidenceRequired: false,
    completionCondition: 'CONFIRMATION',
    blocksCompletion: false,
    dependsOn: [] as string[],
    ...over,
  });

  const publish = async (name: string, steps: unknown[]) => {
    const created = (await A(adminA, 'POST', '/onboarding/templates', { name })).json();
    const saved = await A(adminA, 'PUT', `/onboarding/templates/${created.id}/versions/${created.draft.id}`, {
      expectedUpdatedAt: created.draft.updatedAt,
      steps,
    });
    assert.strictEqual(saved.statusCode, 200, saved.body);
    return { created, saved };
  };
  const calStep = (over: Record<string, unknown> = {}) =>
    S('reuniao', { kind: 'CALENDAR_EVENT', completionCondition: 'CALENDAR_EVENT_LINKED', assigneeMode: 'MEMBER', memberId: memberA.member.id, blocksCompletion: true, ...over });

  let templateId = '';
  await t.test('1. Modelo: tipo e condicao do Calendar sao coerentes e publicaveis', async () => {
    const bad = await publish(`CI Cal Incoerente ${run}`, [S('x', { kind: 'CALENDAR_EVENT', completionCondition: 'CONFIRMATION' })]);
    const val = await A(adminA, 'POST', `/onboarding/templates/${bad.created.id}/versions/${bad.created.draft.id}/validate`);
    assert.strictEqual(val.json().publishable, false);
    assert.ok(val.json().problems.some((p: any) => p.code === 'CONDITION_MISMATCH'));
    const ok = await publish(`CI Cal Modelo ${run}`, [calStep(), S('depois', { dependsOn: ['reuniao'], title: 'Depois da reuniao' })]);
    const pub = await A(adminA, 'POST', `/onboarding/templates/${ok.created.id}/versions/${ok.created.draft.id}/publish`, {
      expectedUpdatedAt: ok.saved.json().draft.updatedAt,
      changeNote: 'modelo com etapa de Calendar',
    });
    assert.strictEqual(pub.statusCode, 200, pub.body);
    templateId = ok.created.id;
  });

  let execId = '';
  const view = async (who: Who = managerA) => (await A(who, 'GET', `/onboarding/executions/${execId}`)).json();
  const step = (v: any, key = 'reuniao') => v.steps.find((s: any) => s.stepKey === key);
  const complete = (who: Who, body: unknown) => A(who, 'POST', `/onboarding/executions/${execId}/steps/reuniao/complete`, body);

  await t.test('2. Sem conexao com o Google: condicao indisponivel e conclusao recusada', async () => {
    const s = await A(managerA, 'POST', '/onboarding/executions', { clientId: c1.id, templateId });
    assert.strictEqual(s.statusCode, 201, s.body);
    execId = s.json().id;
    const c = step(s.json()).calendarCondition;
    assert.deepStrictEqual([c.state, c.reason], ['UNAVAILABLE', 'CONNECTION_UNAVAILABLE']);
    const r = await complete(memberA, { calendarEventId: randomUUID() });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.json().code, 'CALENDAR_UNAVAILABLE');
  });

  // conexao ativa + calendario monitorado (dados LOCAIS; sem Google)
  const conn = await prisma.integrationConnection.create({
    data: { organizationId: orgA.id, provider: 'GOOGLE_CALENDAR', authType: 'OAUTH2', externalScopeId: `sub-${run}`, status: 'ACTIVE' },
  });
  const source = await prisma.calendarSource.create({
    data: { organizationId: orgA.id, connectionId: conn.id, googleCalendarId: `cal-${run}`, name: 'Agenda CI', accessRole: 'owner', isMonitored: true },
  });
  const mkEvent = (suffix: string, over: Record<string, unknown> = {}) =>
    prisma.calendarEvent.create({
      data: {
        organizationId: orgA.id,
        sourceId: source.id,
        googleEventId: `ev-${suffix}-${run}`,
        title: `Reuniao ${suffix}`,
        startAt: new Date(Date.now() + 86_400_000),
        endAt: new Date(Date.now() + 90_000_000),
        ...over,
      } as any,
    });
  const link = (who: Who, eventId: string, body: Record<string, unknown>) => A(who, 'PUT', `/calendar/events/${eventId}/link`, { category: 'MEETING', ...body });

  const e1 = await mkEvent('um');
  await t.test('3. Pendente: conectado, mas sem evento vinculado ao cliente; evento solto ou de outro cliente nao vale', async () => {
    assert.deepStrictEqual((({ state, reason }) => ({ state, reason }))(step(await view()).calendarCondition), { state: 'PENDING', reason: 'NO_LINKED_EVENT' });
    const noEvent = await complete(memberA, { confirm: true });
    assert.strictEqual(noEvent.statusCode, 400, 'sem escolher o evento');
    const unlinked = await complete(memberA, { calendarEventId: e1.id });
    assert.strictEqual(unlinked.statusCode, 400);
    assert.strictEqual(unlinked.json().code, 'CALENDAR_EVENT_NOT_LINKED');
    // vinculado a OUTRO cliente: continua nao valendo
    assert.strictEqual((await link(adminA, e1.id, { scope: 'EVENT', clientId: c2.id })).statusCode, 200);
    const other = await complete(memberA, { calendarEventId: e1.id });
    assert.strictEqual(other.json().code, 'CALENDAR_EVENT_NOT_LINKED');
  });

  await t.test('4. Atendida: vinculo ao cliente da execucao atende a condicao, mas NAO conclui a etapa nem a execucao', async () => {
    assert.strictEqual((await link(adminA, e1.id, { scope: 'EVENT', clientId: c1.id })).statusCode, 200);
    const v = await view();
    const c = step(v).calendarCondition;
    assert.strictEqual(c.state, 'MET');
    assert.deepStrictEqual(c.candidates.map((x: any) => x.id), [e1.id]);
    assert.deepStrictEqual([step(v).status, v.status], ['READY', 'ACTIVE'], 'vinculo nao conclui nada');
    const db = await prisma.onboardingStepRun.findFirstOrThrow({ where: { executionId: execId, stepKey: 'reuniao' } });
    assert.strictEqual(db.completedAt, null);
    assert.strictEqual(db.calendarEventId, null);
  });

  await t.test('5. Elegibilidade: cancelado, removido da janela e calendario desmarcado nao servem; mensagem clara', async () => {
    const reasonOf = async () => (step(await view()).calendarCondition.ineligible ?? []).map((x: any) => x.reason).join('|');
    await prisma.calendarEvent.update({ where: { id: e1.id }, data: { status: 'CANCELLED' } });
    let c = step(await view()).calendarCondition;
    assert.deepStrictEqual([c.state, c.candidates.length], ['PENDING', 0]);
    assert.match(await reasonOf(), /cancelado/);
    const r1 = await complete(memberA, { calendarEventId: e1.id });
    assert.deepStrictEqual([r1.statusCode, r1.json().code], [409, 'CALENDAR_EVENT_NOT_ELIGIBLE']);
    await prisma.calendarEvent.update({ where: { id: e1.id }, data: { status: 'CONFIRMED', missingFromSourceAt: new Date() } });
    assert.match(await reasonOf(), /removido|fora da janela/);
    assert.strictEqual((await complete(memberA, { calendarEventId: e1.id })).json().code, 'CALENDAR_EVENT_NOT_ELIGIBLE');
    await prisma.calendarEvent.update({ where: { id: e1.id }, data: { missingFromSourceAt: null } });
    await prisma.calendarSource.update({ where: { id: source.id }, data: { isMonitored: false } });
    c = step(await view()).calendarCondition;
    assert.deepStrictEqual([c.state, c.reason], ['UNAVAILABLE', 'NO_MONITORED_CALENDAR']);
    assert.strictEqual((await complete(memberA, { calendarEventId: e1.id })).json().code, 'CALENDAR_UNAVAILABLE');
    await prisma.calendarSource.update({ where: { id: source.id }, data: { isMonitored: true } });
    assert.strictEqual(step(await view()).calendarCondition.state, 'MET', 'restaurado');
  });

  await t.test('6. Conexao revogada: indisponivel, conclusao recusada; historico e vinculos preservados', async () => {
    await prisma.integrationConnection.update({ where: { id: conn.id }, data: { status: 'ERROR' } });
    const c = step(await view()).calendarCondition;
    assert.deepStrictEqual([c.state, c.reason], ['UNAVAILABLE', 'CONNECTION_UNAVAILABLE']);
    const r = await complete(memberA, { calendarEventId: e1.id });
    assert.deepStrictEqual([r.statusCode, r.json().code], [409, 'CALENDAR_UNAVAILABLE']);
    assert.ok(await prisma.calendarEventLink.findFirst({ where: { eventId: e1.id, clientId: c1.id } }), 'vinculo preservado');
    await prisma.integrationConnection.update({ where: { id: conn.id }, data: { status: 'ACTIVE' } });
  });

  await t.test('7. Privacidade: evento privado aparece mascarado e o instantaneo guardado tambem', async () => {
    const priv = await mkEvent('privado', { visibility: 'private', title: 'Conversa reservada confidencial' });
    assert.strictEqual((await link(adminA, priv.id, { scope: 'EVENT', clientId: c1.id })).statusCode, 200);
    const v = await view(memberA);
    const cand = step(v).calendarCondition.candidates.find((x: any) => x.id === priv.id);
    assert.deepStrictEqual([cand.masked, cand.title], [true, 'Compromisso privado']);
    assert.ok(!JSON.stringify(v).includes('Conversa reservada confidencial'), 'titulo real nao chega ao navegador');
    // prepara a conclusao com o privado em outra execucao depois (teste 9)
  });

  await t.test('8. Quem pode concluir: so o responsavel (ou override); organizacao B nunca', async () => {
    assert.strictEqual((await complete(otherA, { calendarEventId: e1.id })).statusCode, 403, 'nao e o responsavel');
    assert.strictEqual((await call(adminB, orgB.id, 'POST', `/onboarding/executions/${execId}/steps/reuniao/complete`, { calendarEventId: e1.id })).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/onboarding/executions/${execId}`)).statusCode, 404);
    const evB = await prisma.calendarEvent.create({
      data: { organizationId: orgB.id, sourceId: (await prisma.calendarSource.create({ data: { organizationId: orgB.id, connectionId: (await prisma.integrationConnection.create({ data: { organizationId: orgB.id, provider: 'GOOGLE_CALENDAR', authType: 'OAUTH2', externalScopeId: `b-${run}`, status: 'ACTIVE' } })).id, googleCalendarId: `calb-${run}`, name: 'B', accessRole: 'owner', isMonitored: true } })).id, googleEventId: `evb-${run}`, title: 'Evento da B' },
    });
    await prisma.calendarEventLink.create({ data: { organizationId: orgB.id, scope: 'EVENT', eventId: evB.id, clientId: cB.id, category: 'MEETING' } });
    const cross = await complete(memberA, { calendarEventId: evB.id });
    assert.strictEqual(cross.json().code, 'CALENDAR_EVENT_NOT_LINKED', 'evento de outra organizacao nunca vale');
  });

  await t.test('9. Conclusao: pelo responsavel com evento vinculado; instantaneo e auditoria; dependentes liberados; execucao so conclui no fim', async () => {
    const r = await complete(memberA, { calendarEventId: e1.id });
    assert.strictEqual(r.statusCode, 200, r.body);
    const v = r.json();
    assert.strictEqual(step(v).status, 'DONE');
    assert.deepStrictEqual([step(v).calendarEvent.id, step(v).calendarEvent.title], [e1.id, 'Reuniao um']);
    assert.strictEqual(step(v, 'depois').status, 'READY', 'dependente liberado');
    assert.strictEqual(v.status, 'ACTIVE', 'execucao so conclui ao encerrar todas as etapas');
    const ev = await prisma.onboardingExecutionEvent.findFirstOrThrow({ where: { executionId: execId, type: 'STEP_COMPLETED', stepKey: 'reuniao' } });
    assert.strictEqual((ev.after as any).calendarEventId, e1.id);
    assert.strictEqual(ev.actorUserId, memberA.user.id);
    // depois da conclusao, o cancelamento do evento nao altera o historico
    await prisma.calendarEvent.update({ where: { id: e1.id }, data: { status: 'CANCELLED' } });
    const after = await view();
    assert.deepStrictEqual([step(after).status, step(after).calendarEvent.title], ['DONE', 'Reuniao um']);
    await prisma.calendarEvent.update({ where: { id: e1.id }, data: { status: 'CONFIRMED' } });
  });

  await t.test('10. Serie vinculada e instantaneo mascarado do privado em nova execucao', async () => {
    // nova execucao no mesmo modelo exige a anterior encerrada (B2): cancela a primeira
    assert.strictEqual((await A(managerA, 'POST', `/onboarding/executions/${execId}/cancel`, { reason: 'encerrar para novo teste' })).statusCode, 200);
    const s = await A(managerA, 'POST', '/onboarding/executions', { clientId: c1.id, templateId });
    assert.strictEqual(s.statusCode, 201, s.body);
    execId = s.json().id;
    const serie = await mkEvent('serie-1', { recurringEventId: `serie-${run}`, title: 'Alinhamento da serie' });
    const sibling = await mkEvent('serie-2', { recurringEventId: `serie-${run}`, title: 'Alinhamento da serie', startAt: new Date(Date.now() + 8 * 86_400_000) });
    assert.strictEqual((await link(adminA, serie.id, { scope: 'SERIES', clientId: c1.id })).statusCode, 200);
    const cands = step(await view()).calendarCondition.candidates.map((x: any) => x.id);
    assert.ok(cands.includes(serie.id) && cands.includes(sibling.id), 'ocorrencias da serie herdam o vinculo');
    // privado: instantaneo guardado mascarado
    const priv = await prisma.calendarEvent.findFirstOrThrow({ where: { sourceId: source.id, visibility: 'private' } });
    const r = await complete(memberA, { calendarEventId: priv.id });
    assert.strictEqual(r.statusCode, 200, r.body);
    const row = await prisma.onboardingStepRun.findFirstOrThrow({ where: { executionId: execId, stepKey: 'reuniao' } });
    assert.strictEqual(row.calendarEventTitle, 'Compromisso privado');
  });

  await t.test('11. Banco: instantaneo do evento so em etapa concluida; objetos protegidos preservados', async () => {
    await assert.rejects(
      prisma.$executeRawUnsafe(`UPDATE "onboarding_step_runs" SET "calendarEventId" = 'x' WHERE "executionId" = '${execId}' AND "stepKey" = 'depois'`)
    );
    const ck = new Set((await prisma.$queryRawUnsafe<{ conname: string }[]>('SELECT conname FROM pg_constraint')).map((r) => r.conname));
    for (const n of ['onboarding_runs_calendar_event_only_done', 'onboarding_runs_closed_not_blocked', 'calendar_links_scope_shape']) {
      assert.ok(ck.has(n), `CHECK ausente: ${n}`);
    }
    const idx = new Set((await prisma.$queryRawUnsafe<{ indexname: string }[]>('SELECT indexname FROM pg_indexes')).map((r) => r.indexname));
    for (const n of ['onboarding_executions_one_active_per_client_template', 'calendar_links_one_per_event', 'calendar_events_attendee_hashes_gin']) {
      assert.ok(idx.has(n), `indice ausente: ${n}`);
    }
  });
});
