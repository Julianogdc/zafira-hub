import test from 'node:test';
import assert from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { dateInTimeZone } from '@zafira/domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { getOrganizationTimeZone } from '../modules/organization-config/organization-config.service.js';
import { PublicationMetricsCollector } from '../modules/content/publication/publication-metrics.collector.js';
import { PublicationSimulator } from '../modules/content/publication/publication-simulator.js';
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * F8-5a/F8-5b (DEC-F8-029) - Metricas organicas: coletor (simulador, nunca o provedor real), historico
 * append-only, ausencia != zero, fetchedAt x capturedAt, API de leitura e contador "Publicados".
 */
test('Integration Gate: Metricas de publicacao (F8-5a/F8-5b) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-pubmetrics-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  delete process.env.PUBLICATION_DISPATCH_ENABLED;
  delete process.env.PUBLICATION_METRICS_ENABLED;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-pubmet-a-${run}`, name: 'CI Pub Metrics A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-pubmet-b-${run}`, name: 'CI Pub Metrics B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-pubmet-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MEMBER'); // sem carteira do cliente
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca Metricas' } });
  for (const m of [managerA, memberA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }
  const IG = 'sim-ig-1';
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', accountName: 'Conta de teste' } } });

  type Who = { user: { id: string } };
  const tokenOf = (who: Who, org: string) => (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org });
  const call = (who: Who, org: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, cookies: { token: tokenOf(who, org) }, payload: payload as any });
  const A = (who: Who, method: 'GET' | 'POST', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);
  const upload = (itemId: string) => {
    const boundary = `----zafira${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const data = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x04, 0x38, 0x03, 1, 1, 1, 1, 1, 1, 1, 1, 1]) /* JPEG minimo com SOF0 1080x1350 (P35) */, randomBytes(96)]);
    return app.inject({
      method: 'POST', url: `/content/items/${itemId}/media`, cookies: { token: tokenOf(adminA, orgA.id) },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  };
  let ip = 1;
  const approvedItem = async (title: string) => {
    const r = await A(adminA, 'POST', '/content/items', { clientId: c1.id, title, format: 'FEED_IMAGE', caption: `Legenda ${title}` });
    assert.strictEqual(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    assert.strictEqual((await upload(id)).statusCode, 201);
    const link = await A(adminA, 'POST', `/content/items/${id}/approval-links`, {});
    assert.strictEqual(link.statusCode, 201, link.body);
    const token = link.json().token as string;
    const addr = `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token }, remoteAddress: addr });
    const d = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: addr,
      payload: { token, decision: 'APPROVED', contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true },
    });
    assert.strictEqual(d.statusCode, 200, d.body);
    return id;
  };
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().replace('Z', '+00:00');

  const sim = new PublicationSimulator();
  const collector = new PublicationMetricsCollector(async () => sim, { PUBLICATION_DISPATCH_ENABLED: 'true', PUBLICATION_METRICS_ENABLED: 'true' });
  const T0 = new Date(Date.now() - 60_000); // publicacao "agora"; os ciclos usam relogio simulado a partir daqui
  const H = (h: number) => new Date(T0.getTime() + h * 3600_000);
  const metricsOf = (publicationId: string) => prisma.contentPublicationMetric.findMany({ where: { publicationId }, orderBy: { capturedAt: 'asc' } });
  const pubRow = (id: string) => prisma.contentPublication.findUniqueOrThrow({ where: { id } });

  /** Publicacao confirmada sem provedor real: o post existe so no simulador e o estado e gravado no banco de teste. */
  const publishedPublication = async (title: string) => {
    const itemId = await approvedItem(title);
    const r = await A(managerA, 'POST', `/content/items/${itemId}/publications`, { socialAccountId: IG, scheduledAt: at(30) });
    assert.strictEqual(r.statusCode, 201, r.body);
    const remote = await sim.createDraft({ socialAccountId: IG, caption: title, mediaIds: [], postType: null, idempotencyKey: `k-${title}-${run}` });
    return { itemId, pubId: r.json().id as string, remoteId: remote.id };
  };
  const markPublished = (pubId: string, remoteId: string, publishedAt: Date) =>
    prisma.contentPublication.update({
      where: { id: pubId },
      data: { state: 'PUBLISHED', externalPostId: remoteId, publishedAt, platformPostId: `ig-${remoteId.slice(-6)}`, permalink: 'https://simulador.invalid/p/x' },
    });

  let P1 = { itemId: '', pubId: '', remoteId: '' };

  /* ------------------------------ F8-5a ------------------------------ */
  await t.test('a1. So publicacao confirmada recebe coleta (gatilho no banco)', async () => {
    P1 = await publishedPublication('Principal');
    await assert.rejects(
      prisma.contentPublicationMetric.create({ data: { organizationId: orgA.id, publicationId: P1.pubId, capturedAt: H(1), fetchedAt: H(1), reach: 1 } }),
      /publication_metrics_requires_published/
    );
    await markPublished(P1.pubId, P1.remoteId, T0);
  });

  await t.test('a2. Padrao desligado: nenhuma consulta ao provedor', async () => {
    const off = new PublicationMetricsCollector(async () => sim, {});
    assert.deepStrictEqual(await off.collectDue({ now: H(2) }), { enabled: false, checked: 0, inserted: 0, outcomes: {} });
    assert.strictEqual(sim.count('getPostMetrics'), 0);
  });

  await t.test('a3. Antes do primeiro ponto (1 h) nao consulta', async () => {
    const r = await collector.collectDue({ now: H(0.5) });
    assert.strictEqual(r.checked, 0);
    assert.strictEqual(sim.count('getPostMetrics'), 0);
  });

  await t.test('a4. Zeros com captured_at nulo: nada gravado, consulta registrada como aguardando', async () => {
    const r = await collector.collectDue({ now: H(1) });
    assert.deepStrictEqual([r.checked, r.inserted, r.outcomes], [1, 0, { AWAITING_COLLECTION: 1 }]);
    assert.strictEqual((await metricsOf(P1.pubId)).length, 0);
    const p = await pubRow(P1.pubId);
    assert.strictEqual(p.metricsCheckedAt?.toISOString(), H(1).toISOString());
    assert.strictEqual(p.metricsLastOutcome, 'AWAITING_COLLECTION');
    assert.strictEqual((await collector.collectDue({ now: H(1.5) })).checked, 0, 'fora dos pontos nao ha consulta extra');
  });

  await t.test('a5. Coleta do provedor: capturedAt (provedor) distinto de fetchedAt (Hub)', async () => {
    sim.collectMetrics(P1.remoteId, H(2), { reach: 120, views: 300, likes: 9, comments: 2, saves: 1, shares: 0, engagement: 3.25 });
    const r = await collector.collectDue({ now: H(3) });
    assert.deepStrictEqual([r.inserted, r.outcomes], [1, { COLLECTED: 1 }]);
    const rows = await metricsOf(P1.pubId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].capturedAt.toISOString(), H(2).toISOString());
    assert.strictEqual(rows[0].fetchedAt.toISOString(), H(3).toISOString());
    assert.deepStrictEqual([rows[0].reach, rows[0].views, rows[0].shares, rows[0].engagementPct], [120, 300, 0, 3.25]);
  });

  await t.test('a6. Consultar de novo sem coleta nova nao duplica; consultas concorrentes viram uma so (reserva)', async () => {
    const before = sim.count('getPostMetrics');
    const [r1, r2] = await Promise.all([collector.collectDue({ now: H(6) }), collector.collectDue({ now: H(6) })]);
    assert.strictEqual(sim.count('getPostMetrics') - before, 1, 'a mesma publicacao nunca e consultada duas vezes ao mesmo tempo');
    assert.strictEqual(r1.checked + r2.checked, 1);
    assert.deepStrictEqual({ ...r1.outcomes, ...r2.outcomes }, { NO_NEW_COLLECTION: 1 });
    assert.strictEqual((await metricsOf(P1.pubId)).length, 1);
  });

  await t.test('a7. P38: erro transitorio nao consome o ponto; repete em 15 min e entao registra', async () => {
    sim.metricsErrorNext = 1;
    const r = await collector.collectDue({ now: H(24) });
    assert.deepStrictEqual(r.outcomes, { ERROR_RETRY_SCHEDULED: 1 });
    let p = await pubRow(P1.pubId);
    assert.strictEqual(p.metricsCheckedAt?.toISOString(), H(6).toISOString(), 'o ponto de 24 h continua descoberto');
    assert.strictEqual(p.metricsRetryAt?.toISOString(), new Date(H(24).getTime() + 15 * 60_000).toISOString());
    assert.deepStrictEqual([p.metricsErrorCount, p.metricsLastOutcome], [1, 'ERROR']);
    assert.match(p.metricsLastReason ?? '', /SERVER/);
    assert.strictEqual((await collector.collectDue({ now: new Date(H(24).getTime() + 10 * 60_000) })).checked, 0, 'antes dos 15 min nao repete');
    const ok = await collector.collectDue({ now: new Date(H(24).getTime() + 15 * 60_000) });
    assert.deepStrictEqual(ok.outcomes, { NO_NEW_COLLECTION: 1 });
    p = await pubRow(P1.pubId);
    assert.deepStrictEqual([p.metricsRetryAt, p.metricsErrorCount, p.metricsLastOutcome], [null, 0, 'NO_NEW_COLLECTION']);
    assert.strictEqual((await metricsOf(P1.pubId)).length, 1, 'nenhum valor fabricado');
  });

  await t.test('a8. Limite do provedor (429): espera o retry_after (piso 60 s) sem consumir o ponto nem contar erro', async () => {
    sim.rateLimitNext = 30;
    const r = await collector.collectDue({ now: H(72) });
    assert.strictEqual(r.stoppedByRateLimit, true);
    assert.strictEqual(r.checked, 0);
    const p = await pubRow(P1.pubId);
    assert.strictEqual(p.metricsCheckedAt?.toISOString(), new Date(H(24).getTime() + 15 * 60_000).toISOString());
    assert.strictEqual(p.metricsRetryAt?.toISOString(), new Date(H(72).getTime() + 60_000).toISOString());
    assert.strictEqual(p.metricsErrorCount, 0);
    assert.strictEqual((await collector.collectDue({ now: new Date(H(72).getTime() + 30_000) })).checked, 0, 'respeita a espera do 429');
    sim.collectMetrics(P1.remoteId, H(70), { reach: 150, views: 340, likes: 11, comments: 2, saves: 1, shares: 1, engagement: 3.5 });
    const r2 = await collector.collectDue({ now: new Date(H(72).getTime() + 2 * 60_000) });
    assert.deepStrictEqual(r2.outcomes, { COLLECTED: 1 });
    assert.strictEqual((await metricsOf(P1.pubId)).length, 2);
  });

  await t.test('a9. Historico append-only: sem UPDATE, sem DELETE, sem duplicar a mesma coleta, sem negativos', async () => {
    const [first] = await metricsOf(P1.pubId);
    await assert.rejects(prisma.contentPublicationMetric.update({ where: { id: first.id }, data: { reach: 999 } }), /publication_metrics_append_only/);
    await assert.rejects(prisma.contentPublicationMetric.delete({ where: { id: first.id } }), /content_history_protected/);
    await assert.rejects(
      prisma.contentPublicationMetric.create({ data: { organizationId: orgA.id, publicationId: P1.pubId, capturedAt: first.capturedAt, fetchedAt: H(80), reach: 1 } }),
      (e: any) => e?.code === 'P2002'
    );
    await assert.rejects(
      prisma.contentPublicationMetric.create({ data: { organizationId: orgA.id, publicationId: P1.pubId, capturedAt: H(90), fetchedAt: H(90), reach: -1 } }),
      /content_publication_metrics_non_negative/
    );
    await assert.rejects(
      prisma.contentPublicationMetric.create({ data: { organizationId: orgB.id, publicationId: P1.pubId, capturedAt: H(91), fetchedAt: H(91), reach: 1 } }),
      'coleta nao pode apontar para publicacao de outra organizacao'
    );
  });

  await t.test('a10. P38: esgotadas as repeticoes (15, 30, 60 min) o ultimo ponto e consumido com o erro; depois nao consulta mais', async () => {
    const at = (min: number) => new Date(H(168).getTime() + min * 60_000);
    sim.metricsErrorNext = 4;
    const outcomes: string[] = [];
    for (const min of [0, 15, 45, 105]) outcomes.push(...Object.keys((await collector.collectDue({ now: at(min) })).outcomes));
    assert.deepStrictEqual(outcomes, ['ERROR_RETRY_SCHEDULED', 'ERROR_RETRY_SCHEDULED', 'ERROR_RETRY_SCHEDULED', 'ERROR']);
    const p = await pubRow(P1.pubId);
    assert.deepStrictEqual([p.metricsCheckedAt?.toISOString(), p.metricsRetryAt, p.metricsErrorCount, p.metricsLastOutcome], [at(105).toISOString(), null, 0, 'ERROR']);
    assert.strictEqual((await metricsOf(P1.pubId)).length, 2, 'coletas anteriores preservadas');
    const calls = sim.count('getPostMetrics');
    const r = await collector.collectDue({ now: H(500) });
    assert.strictEqual(r.checked, 0);
    assert.strictEqual(sim.count('getPostMetrics'), calls);
  });

  /* ------------------------------ F8-5b ------------------------------ */
  const periodNow = dateInTimeZone(new Date(), await getOrganizationTimeZone(orgA.id))!.slice(0, 7);

  await t.test('b1. API de metricas: historico com capturedAt x fetchedAt, sem next_sync_eta', async () => {
    const r = await A(memberA, 'GET', `/content/publications/${P1.pubId}/metrics`);
    assert.strictEqual(r.statusCode, 200, r.body);
    const m = r.json();
    assert.strictEqual(m.status, 'STOPPED', 'janela de 7 dias encerrada, ultima coleta preservada');
    assert.strictEqual(m.latest.capturedAt, H(70).toISOString());
    assert.strictEqual(m.latest.fetchedAt, new Date(H(72).getTime() + 2 * 60_000).toISOString());
    assert.deepStrictEqual(m.history.map((h: any) => h.capturedAt), [H(70).toISOString(), H(2).toISOString()]);
    assert.strictEqual(m.latest.reach, 150);
    assert.ok(!r.body.includes('next_sync') && !r.body.includes('nextSync'), 'estimativa movel do provedor nunca exposta');
    const list = (await A(memberA, 'GET', `/content/items/${P1.itemId}/publications`)).json();
    assert.strictEqual(list[0].metrics.status, 'STOPPED');
    assert.strictEqual(list[0].metrics.lastCapturedAt, H(70).toISOString());
  });

  await t.test('b2. Acesso: carteira, organizacao e permissao (Org B e fora da carteira: 404)', async () => {
    assert.strictEqual((await A(outsiderA, 'GET', `/content/publications/${P1.pubId}/metrics`)).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/content/publications/${P1.pubId}/metrics`)).statusCode, 404);
    assert.strictEqual((await A(memberA, 'GET', `/content/publications/${randomUUID()}/metrics`)).statusCode, 404);
    assert.strictEqual((await app.inject({ method: 'GET', url: `/content/publications/${P1.pubId}/metrics` })).statusCode, 401);
  });

  let P2 = { itemId: '', pubId: '', remoteId: '' };
  await t.test('b3. Publicado sem coleta: aguardando, sem numero; depois indisponivel e erro preservados', async () => {
    P2 = await publishedPublication('Segunda');
    await markPublished(P2.pubId, P2.remoteId, T0);
    let m = (await A(memberA, 'GET', `/content/publications/${P2.pubId}/metrics`)).json();
    assert.deepStrictEqual([m.status, m.latest, m.history, m.lastCheckedAt], ['AWAITING_COLLECTION', null, [], null]);
    sim.metricsUnavailable = 'not_supported';
    await collector.collectDue({ now: H(1) });
    m = (await A(memberA, 'GET', `/content/publications/${P2.pubId}/metrics`)).json();
    assert.deepStrictEqual([m.status, m.latest, m.lastOutcome], ['UNAVAILABLE', null, 'UNAVAILABLE']);
    sim.metricsUnavailable = null;
    sim.metricsErrorNext = 1;
    await collector.collectDue({ now: H(3) });
    m = (await A(memberA, 'GET', `/content/publications/${P2.pubId}/metrics`)).json();
    // P38: o erro nao consome o ponto de 3 h (lastCheckedAt continua o de 1 h); a situacao mostra a falha sem valor
    assert.deepStrictEqual([m.status, m.latest, m.lastCheckedAt], ['ERROR', null, H(1).toISOString()]);
  });

  let P4 = '';
  await t.test('b4. Publicacao nao confirmada: sem metricas', async () => {
    const itemId = await approvedItem('Pendente');
    const r = await A(managerA, 'POST', `/content/items/${itemId}/publications`, { socialAccountId: IG, scheduledAt: at(40) });
    assert.strictEqual(r.statusCode, 201, r.body);
    P4 = r.json().id;
    assert.strictEqual(r.json().metrics.status, 'NOT_PUBLISHED');
    assert.strictEqual((await A(memberA, 'GET', `/content/publications/${P4}/metrics`)).json().status, 'NOT_PUBLISHED');
  });

  await t.test('b5. Contador Publicados: indisponivel com o envio desligado; com envio ativo, so confirmadas', async () => {
    const url = `/clients/${c1.id}/deliverables/content-stages?period=${periodNow}`;
    const off = await A(memberA, 'GET', url);
    assert.strictEqual(off.statusCode, 200, off.body);
    assert.strictEqual(off.json().counts.published, null);
    assert.strictEqual(off.json().counts.publishedSource, 'NOT_INTEGRATED');
    assert.ok(off.json().items.every((i: any) => i.publishedAt === null));
    assert.strictEqual(off.json().counts.approved, 3);
    process.env.PUBLICATION_DISPATCH_ENABLED = 'true'; // so a leitura do contador; o agendador nao roda em testes
    try {
      const on = (await A(memberA, 'GET', url)).json();
      assert.strictEqual(on.counts.publishedSource, 'CONFIRMED_PUBLICATION');
      assert.strictEqual(on.counts.published, 2, 'duas confirmadas; a pendente nao conta');
      assert.strictEqual(on.items.find((i: any) => i.id === P1.itemId).publishedAt, T0.toISOString());
      await prisma.contentPublication.update({ where: { id: P4 }, data: { state: 'AMBIGUOUS' } });
      assert.strictEqual((await A(memberA, 'GET', url)).json().counts.published, 2, 'AMBIGUOUS nunca conta como publicado');
    } finally {
      delete process.env.PUBLICATION_DISPATCH_ENABLED;
    }
    assert.strictEqual((await call(adminB, orgB.id, 'GET', url)).statusCode, 404);
  });
});
