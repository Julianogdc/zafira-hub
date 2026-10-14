import test from 'node:test';
import assert from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { resolveFileStorage } from '../modules/content/file-storage.js';
import { PublicationDispatcher, publicationDispatcher } from '../modules/content/publication/publication-dispatcher.js';
import { PublicationSimulator } from '../modules/content/publication/publication-simulator.js';

// --- GUARD DE SEGURANCA ---
if (process.env.NODE_ENV === 'production') throw new Error('NAO E PERMITIDO EXECUTAR TESTES DE INTEGRACAO EM PRODUCAO');
if (process.env.ZAFIRA_TEST_DATABASE !== '1') throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatorio para testes de integracao');
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');

/**
 * F8-4a (DEC-F8-023) - Publicacao pela versao aprovada, caixa de saida e despachante, contra PostgreSQL real
 * e o SIMULADOR do BrightBean (nenhuma chamada a instancia real). Piloto: Instagram.
 */
test('Integration Gate: Publicacao pela versao aprovada (F8-4a) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-pub-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  delete process.env.PUBLICATION_DISPATCH_ENABLED; // configuracao padrao: despachante desligado
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-pub-a-${run}`, name: 'CI Publicacao A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-pub-b-${run}`, name: 'CI Publicacao B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-pub-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MANAGER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca Publicacao' } });
  await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Marca B' } });
  for (const m of [managerA, memberA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }
  const IG = `sim-ig-${run}`;
  const FB = `sim-fb-${run}`;
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', charLimit: 2200 } } });
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'BRIGHTBEAN', externalId: FB, metadata: { platform: 'facebook' } } });

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
  const decide = async (itemId: string, decision: 'APPROVED' | 'CHANGES_REQUESTED') => {
    const link = await A(adminA, 'POST', `/content/items/${itemId}/approval-links`, {});
    assert.strictEqual(link.statusCode, 201, link.body);
    const token = link.json().token as string;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token }, remoteAddress: `10.9.${ip}.1` });
    const r = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: `10.9.${ip++}.1`,
      payload: { token, decision, contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true, ...(decision === 'CHANGES_REQUESTED' ? { comment: 'Trocar a foto.' } : {}) },
    });
    assert.strictEqual(r.statusCode, 200, r.body);
  };
  const newItem = async (title: string, opts: { caption?: string; approve?: boolean } = {}) => {
    const r = await A(adminA, 'POST', '/content/items', { clientId: c1.id, title, format: 'FEED_IMAGE', caption: opts.caption ?? `Legenda ${title}` });
    assert.strictEqual(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    assert.strictEqual((await upload(id)).statusCode, 201);
    if (opts.approve !== false) await decide(id, 'APPROVED');
    return id;
  };
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().replace('Z', '+00:00');
  const requestPub = (who: Who, itemId: string, body: Record<string, unknown>) => A(who, 'POST', `/content/items/${itemId}/publications`, body);
  const pubOf = (id: string) => prisma.contentPublication.findUniqueOrThrow({ where: { id } });

  const sim = new PublicationSimulator({ accounts: [{ id: IG, platform: 'instagram_login', connectionStatus: 'connected', charLimit: 2200 }] });
  const enabled = new PublicationDispatcher(async () => sim, () => resolveFileStorage(), { PUBLICATION_DISPATCH_ENABLED: 'true' });

  /* ------------------------------ 1. so versao aprovada ------------------------------ */
  await t.test('1. Somente a versao atual aprovada pelo cliente pode ser agendada (servico e banco)', async () => {
    const notSent = await newItem('Nao enviada', { approve: false });
    const r1 = await requestPub(managerA, notSent, { socialAccountId: IG, scheduledAt: at(30) });
    assert.strictEqual(r1.statusCode, 409);
    assert.strictEqual(r1.json().code, 'VERSION_NOT_APPROVED');
    const changes = await newItem('Alteracao pedida', { approve: false });
    await decide(changes, 'CHANGES_REQUESTED');
    assert.strictEqual((await requestPub(managerA, changes, { socialAccountId: IG, scheduledAt: at(30) })).json().code, 'VERSION_NOT_APPROVED');
    const newer = await newItem('Aprovada e nova versao');
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${newer}/versions`)).statusCode, 201);
    assert.strictEqual((await requestPub(managerA, newer, { socialAccountId: IG, scheduledAt: at(30) })).json().code, 'VERSION_NOT_APPROVED');
    // o banco recusa mesmo sem passar pelo servico
    const v = await prisma.contentVersion.findFirstOrThrow({ where: { itemId: notSent } });
    await assert.rejects(
      prisma.contentPublication.create({ data: { organizationId: orgA.id, clientId: c1.id, itemId: notSent, versionId: v.id, socialAccountId: IG, platform: 'instagram_login', scheduledAt: new Date(Date.now() + 3600_000) } }),
      /publication_requires_approved_version/
    );
    const vOld = await prisma.contentVersion.findFirstOrThrow({ where: { itemId: newer, number: 1 } });
    await assert.rejects(
      prisma.contentPublication.create({ data: { organizationId: orgA.id, clientId: c1.id, itemId: newer, versionId: vOld.id, socialAccountId: IG, platform: 'instagram_login', scheduledAt: new Date(Date.now() + 3600_000) } }),
      /publication_requires_current_version/
    );
  });

  /* ------------------------------ 2. validacoes ------------------------------ */
  let item1 = '';
  await t.test('2. Validacoes: fuso explicito, 5 min, piloto Instagram, conta vinculada, legenda', async () => {
    item1 = await newItem('Principal');
    const tz = await requestPub(managerA, item1, { socialAccountId: IG, scheduledAt: '2026-12-01T10:00:00' });
    assert.strictEqual(tz.statusCode, 422);
    assert.strictEqual(tz.json().code, 'SCHEDULE_TIMEZONE_REQUIRED');
    assert.strictEqual((await requestPub(managerA, item1, { socialAccountId: IG, scheduledAt: at(2) })).json().code, 'SCHEDULE_TOO_SOON');
    assert.strictEqual((await requestPub(managerA, item1, { socialAccountId: IG, scheduledAt: at(-10) })).json().code, 'SCHEDULE_TOO_SOON');
    const fb = await requestPub(managerA, item1, { socialAccountId: FB, scheduledAt: at(30) });
    assert.strictEqual(fb.statusCode, 422);
    assert.strictEqual(fb.json().code, 'PLATFORM_NOT_IN_PILOT');
    assert.strictEqual((await requestPub(managerA, item1, { socialAccountId: 'conta-inexistente', scheduledAt: at(30) })).statusCode, 404);
    const longItem = await newItem('Legenda longa', { caption: 'x'.repeat(2201) });
    const long = await requestPub(managerA, longItem, { socialAccountId: IG, scheduledAt: at(30) });
    assert.strictEqual(long.statusCode, 422);
    assert.strictEqual(long.json().code, 'CAPTION_TOO_LONG');
  });

  /* ------------------------------ 3. permissoes e isolamento ------------------------------ */
  await t.test('3. RBAC (content.schedule), carteira e isolamento entre organizacoes', async () => {
    assert.strictEqual((await requestPub(memberA, item1, { socialAccountId: IG, scheduledAt: at(30) })).statusCode, 403, 'membro nao agenda');
    assert.strictEqual((await requestPub(outsiderA, item1, { socialAccountId: IG, scheduledAt: at(30) })).statusCode, 404, 'fora da carteira');
    assert.strictEqual((await call(adminB, orgB.id, 'POST', `/content/items/${item1}/publications`, { socialAccountId: IG, scheduledAt: at(30) })).statusCode, 404, 'outra organizacao');
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/content/items/${item1}/publications`)).statusCode, 404);
    assert.strictEqual((await A(memberA, 'GET', `/content/items/${item1}/publications`)).statusCode, 200, 'membro acompanha');
    assert.strictEqual((await app.inject({ method: 'GET', url: `/content/items/${item1}/publications` })).statusCode, 401);
  });

  /* ------------------------------ 4. pedido e caixa de saida ------------------------------ */
  let pub1 = '';
  await t.test('4. Pedido grava publicacao + caixa de saida na mesma transacao; uma ativa por versao + conta', async () => {
    const r = await requestPub(managerA, item1, { socialAccountId: IG, scheduledAt: at(30) });
    assert.strictEqual(r.statusCode, 201, r.body);
    pub1 = r.json().id;
    assert.strictEqual(r.json().state, 'PENDING');
    const box = await prisma.publicationOutbox.findMany({ where: { publicationId: pub1 } });
    assert.strictEqual(box.length, 1);
    assert.strictEqual(box[0].kind, 'PUBLISH');
    assert.strictEqual(box[0].status, 'PENDING');
    const dup = await requestPub(adminA, item1, { socialAccountId: IG, scheduledAt: at(40) });
    assert.strictEqual(dup.statusCode, 409);
    assert.strictEqual(dup.json().code, 'PUBLICATION_ALREADY_ACTIVE');
    assert.ok(!JSON.stringify(r.json()).includes('externalPostId'), 'sem ids do provedor na resposta');
  });

  /* ------------------------------ 5. configuracao padrao: nada sai ------------------------------ */
  await t.test('5. Configuracao padrao: despachante desligado, nenhuma chamada ao provedor', async () => {
    assert.strictEqual(process.env.PUBLICATION_DISPATCH_ENABLED, undefined);
    assert.strictEqual(publicationDispatcher.isEnabled(), false);
    const out = await publicationDispatcher.dispatchDue();
    assert.deepStrictEqual(out, { enabled: false, claimed: 0, results: [] });
    assert.deepStrictEqual(await publicationDispatcher.reconcileDue(), { enabled: false, checked: 0 });
    assert.strictEqual(sim.calls.length, 0);
    assert.strictEqual((await pubOf(pub1)).state, 'PENDING');
    assert.strictEqual((await prisma.publicationOutbox.findFirstOrThrow({ where: { publicationId: pub1 } })).status, 'PENDING');
  });

  /* ------------------------------ 6. fluxo feliz com o simulador ------------------------------ */
  await t.test('6. Fluxo com o simulador: upload, rascunho, agendamento, publicacao e reconciliacao', async () => {
    const out = await enabled.dispatchDue();
    assert.deepStrictEqual(out.results, ['PUBLISH:DONE']);
    let p = await pubOf(pub1);
    assert.strictEqual(p.state, 'SCHEDULED');
    assert.ok(p.externalPostId);
    assert.deepStrictEqual([sim.count('uploadMedia'), sim.count('createDraft'), sim.count('schedule')], [1, 1, 1]);
    assert.strictEqual(sim.posts.get(p.externalPostId!)!.scheduledAt, p.scheduledAt.toISOString(), 'horario enviado em UTC');
    const after = new Date(p.scheduledAt.getTime() + 1000);
    sim.advance(after, p.externalPostId);
    await enabled.reconcileDue({ now: after });
    assert.strictEqual((await pubOf(pub1)).state, 'PUBLISHING');
    sim.advance(after, p.externalPostId);
    await enabled.reconcileDue({ now: after });
    p = await pubOf(pub1);
    assert.strictEqual(p.state, 'PUBLISHED');
    assert.ok(p.publishedAt && p.platformPostId && p.permalink);
    assert.strictEqual((await prisma.publicationOutbox.findFirstOrThrow({ where: { publicationId: pub1 } })).status, 'DONE');
  });

  /* ------------------------------ 7. depois de PUBLISHING ------------------------------ */
  await t.test('7. D-F84-3: publicado ou publicando nao reagenda nem cancela', async () => {
    const r1 = await A(managerA, 'POST', `/content/publications/${pub1}/reschedule`, { scheduledAt: at(60) });
    assert.strictEqual(r1.statusCode, 409);
    assert.strictEqual(r1.json().code, 'PUBLICATION_LOCKED');
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pub1}/cancel`)).json().code, 'PUBLICATION_LOCKED');
    const item = await newItem('Publicando');
    const pid = (await requestPub(managerA, item, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    await enabled.dispatchDue();
    const p = await pubOf(pid);
    sim.holdInPublishing = true;
    const after = new Date(p.scheduledAt.getTime() + 1000);
    sim.advance(after, p.externalPostId);
    await enabled.reconcileDue({ now: after });
    assert.strictEqual((await pubOf(pid)).state, 'PUBLISHING');
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pid}/cancel`)).statusCode, 409);
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pid}/reschedule`, { scheduledAt: at(90) })).statusCode, 409);
    sim.holdInPublishing = false;
    sim.advance(after, p.externalPostId);
    await enabled.reconcileDue({ now: after });
    assert.strictEqual((await pubOf(pid)).state, 'PUBLISHED');
  });

  /* ------------------------------ 8. estado ambiguo ------------------------------ */
  await t.test('8. Timeout depois de criar: AMBIGUOUS e replay com a mesma chave, sem duplicar', async () => {
    const item = await newItem('Ambigua');
    const pid = (await requestPub(managerA, item, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    sim.timeoutAfterCreate = 1;
    const postsBefore = sim.posts.size;
    const first = await enabled.dispatchDue();
    assert.deepStrictEqual(first.results, ['PUBLISH:RETRY']);
    assert.strictEqual((await pubOf(pid)).state, 'AMBIGUOUS');
    assert.strictEqual(sim.posts.size, postsBefore + 1, 'o provedor criou o rascunho, mas a resposta se perdeu');
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pid}/cancel`)).statusCode, 409, 'ambiguo so reconcilia');
    const second = await enabled.dispatchDue({ now: new Date(Date.now() + 20_000) });
    assert.deepStrictEqual(second.results, ['PUBLISH:DONE']);
    const p = await pubOf(pid);
    assert.strictEqual(p.state, 'SCHEDULED');
    assert.strictEqual(sim.posts.size, postsBefore + 1, 'replay devolveu o MESMO post: nenhuma duplicidade');
  });

  /* ------------------------------ 9. retentativa e falha do provedor ------------------------------ */
  await t.test('9. Falha transitoria com retentativa do provedor e falha definitiva', async () => {
    const item = await newItem('Retentativa');
    const pid = (await requestPub(managerA, item, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    await enabled.dispatchDue();
    const p = await pubOf(pid);
    sim.transientPublishFailures = 1;
    let now = new Date(p.scheduledAt.getTime() + 1000);
    sim.advance(now, p.externalPostId); // scheduled -> publishing
    sim.advance(now, p.externalPostId); // falha transitoria -> volta a scheduled (+60 s)
    await enabled.reconcileDue({ now });
    assert.strictEqual((await pubOf(pid)).state, 'SCHEDULED');
    await prisma.contentPublication.update({ where: { id: pid }, data: { state: 'PUBLISHING' } }); // simula leitura no meio da tentativa
    await enabled.reconcileDue({ now });
    assert.strictEqual((await pubOf(pid)).state, 'PROVIDER_RETRY', 'retentativa do provedor reconhecida');
    now = new Date(now.getTime() + 61_000);
    sim.advance(now, p.externalPostId);
    sim.advance(now, p.externalPostId);
    await enabled.reconcileDue({ now });
    assert.strictEqual((await pubOf(pid)).state, 'PUBLISHED');

    const item2 = await newItem('Falha definitiva');
    const pid2 = (await requestPub(managerA, item2, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    await enabled.dispatchDue();
    const p2 = await pubOf(pid2);
    sim.permanentPublishFailure = true;
    const now2 = new Date(p2.scheduledAt.getTime() + 1000);
    sim.advance(now2, p2.externalPostId);
    sim.advance(now2, p2.externalPostId);
    sim.permanentPublishFailure = false;
    await enabled.reconcileDue({ now: now2 });
    const f = await pubOf(pid2);
    assert.strictEqual(f.state, 'FAILED');
    assert.strictEqual(f.failureCode, 'PROVIDER_FAILED');
    assert.ok(f.failureMessage && !/[\u0000-\u001f]/.test(f.failureMessage));
  });

  /* ------------------------------ 10. reagendar e cancelar ------------------------------ */
  await t.test('10. Cancelar antes do envio, reagendar e cancelar depois do envio', async () => {
    const itemA = await newItem('Cancelada antes');
    const pa = (await requestPub(managerA, itemA, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    const callsBefore = sim.calls.length;
    const c = await A(managerA, 'POST', `/content/publications/${pa}/cancel`);
    assert.strictEqual(c.statusCode, 200, c.body);
    assert.strictEqual(c.json().state, 'CANCELLED');
    assert.strictEqual((await prisma.publicationOutbox.findFirstOrThrow({ where: { publicationId: pa } })).status, 'DONE');
    await enabled.dispatchDue();
    assert.strictEqual(sim.calls.length, callsBefore, 'nada enviado ao provedor');
    // vaga liberada: pode pedir de novo
    assert.strictEqual((await requestPub(managerA, itemA, { socialAccountId: IG, scheduledAt: at(45) })).statusCode, 201);

    const itemB = await newItem('Reagendada');
    const pb = (await requestPub(managerA, itemB, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    await enabled.dispatchDue();
    const before = await pubOf(pb);
    assert.strictEqual(before.state, 'SCHEDULED');
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pb}/reschedule`, { scheduledAt: at(2) })).json().code, 'SCHEDULE_TOO_SOON');
    const rs = await A(managerA, 'POST', `/content/publications/${pb}/reschedule`, { scheduledAt: at(50) });
    assert.strictEqual(rs.statusCode, 200, rs.body);
    await enabled.dispatchDue();
    const afterRs = await pubOf(pb);
    assert.strictEqual(sim.posts.get(afterRs.externalPostId!)!.scheduledAt, afterRs.scheduledAt.toISOString(), 'novo horario aplicado no provedor');
    assert.strictEqual(afterRs.state, 'SCHEDULED');
    const cc = await A(managerA, 'POST', `/content/publications/${pb}/cancel`);
    assert.strictEqual(cc.statusCode, 200, cc.body);
    await enabled.dispatchDue();
    const cancelled = await pubOf(pb);
    assert.strictEqual(cancelled.state, 'CANCELLED');
    assert.strictEqual(sim.posts.get(cancelled.externalPostId!)!.status, 'draft', 'saiu da fila do provedor');
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pb}/cancel`)).statusCode, 409);
    // os pedidos rodaram em ordem e terminaram
    const kinds = (await prisma.publicationOutbox.findMany({ where: { publicationId: pb }, orderBy: { createdAt: 'asc' } })).map((o) => `${o.kind}:${o.status}`);
    assert.deepStrictEqual(kinds, ['PUBLISH:DONE', 'RESCHEDULE:DONE', 'CANCEL:DONE']);
  });

  /* ------------------------------ 11. permissao do provedor e limite ------------------------------ */
  await t.test('11. Chave sem publish_directly falha fechado; 429 respeita retry_after', async () => {
    const item = await newItem('Sem permissao');
    const pid = (await requestPub(managerA, item, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    sim.permissions = ['create_posts', 'upload_media'];
    const uploadsBefore = sim.count('uploadMedia');
    assert.deepStrictEqual((await enabled.dispatchDue()).results, ['PUBLISH:FAILED']);
    const p = await pubOf(pid);
    assert.strictEqual(p.state, 'FAILED');
    assert.strictEqual(p.failureCode, 'PROVIDER_PERMISSION');
    assert.strictEqual(sim.count('uploadMedia'), uploadsBefore, 'nada enviado sem a permissao');
    sim.permissions = ['create_posts', 'upload_media', 'publish_directly', 'view_analytics'];

    const item2 = await newItem('Limite');
    const pid2 = (await requestPub(managerA, item2, { socialAccountId: IG, scheduledAt: at(30) })).json().id;
    sim.rateLimitNext = 120;
    const now = new Date();
    assert.deepStrictEqual((await enabled.dispatchDue({ now })).results, ['PUBLISH:RETRY']);
    const box = await prisma.publicationOutbox.findFirstOrThrow({ where: { publicationId: pid2 } });
    assert.strictEqual(box.status, 'RETRYING');
    assert.ok(box.nextAttemptAt.getTime() >= now.getTime() + 119_000, 'aguarda o retry_after');
    assert.strictEqual((await pubOf(pid2)).state, 'PENDING');
  });

  /* ------------------------------ 12. rotas legadas ------------------------------ */
  await t.test('12. D-F84-1: rotas legadas de escrita bloqueadas (410), sem chamar o provedor', async () => {
    const token = tokenOf(adminA, orgA.id);
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/clients/${c1.id}/social/content`, cookies: { token }, headers: { 'idempotency-key': 'k1' }, payload: { accountId: IG, format: 'FEED', content: 'x' } });
    assert.strictEqual(r1.statusCode, 410);
    assert.strictEqual(r1.json().code, 'LEGACY_WRITE_DISABLED');
    const r2 = await app.inject({ method: 'PATCH', url: `/api/v1/clients/${c1.id}/social/content/p1/schedule`, cookies: { token }, payload: { scheduledAt: at(30) } });
    assert.strictEqual(r2.statusCode, 410);
    const r3 = await app.inject({ method: 'POST', url: `/api/v1/clients/${c1.id}/social/content/p1/cancel`, cookies: { token } });
    assert.strictEqual(r3.statusCode, 410);
  });

  /* ------------------------------ 13. historico ------------------------------ */
  await t.test('13. Historico: eventos registrados; publicacao e caixa de saida nao sao apagadas', async () => {
    const events = await prisma.contentEvent.findMany({ where: { itemId: item1 }, select: { type: true } });
    const types = new Set(events.map((e) => e.type));
    assert.ok(types.has('PUBLICATION_REQUESTED') && types.has('PUBLICATION_STATE_CHANGED'));
    await assert.rejects(prisma.contentPublication.delete({ where: { id: pub1 } }), /content_history_protected/);
    await assert.rejects(prisma.contentPublication.update({ where: { id: pub1 }, data: { socialAccountId: 'outra' } }), /content_publications_immutable/);
  });
});
