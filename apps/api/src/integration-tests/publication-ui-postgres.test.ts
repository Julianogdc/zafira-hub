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
import { PublicationDispatcher } from '../modules/content/publication/publication-dispatcher.js';
import { PublicationSimulator } from '../modules/content/publication/publication-simulator.js';

// --- GUARD DE SEGURANCA ---
if (process.env.NODE_ENV === 'production') throw new Error('NAO E PERMITIDO EXECUTAR TESTES DE INTEGRACAO EM PRODUCAO');
if (process.env.ZAFIRA_TEST_DATABASE !== '1') throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatorio para testes de integracao');
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');

/**
 * F8-4b.1 (DEC-F8-027) - Leituras para a tela (contas elegiveis, situacao do envio, acoes por estado),
 * cancelamento x novo pedido x unicidade, bloqueio em retentativa do provedor e P36 (teto de 25/24 h).
 * Simulador do BrightBean so onde indicado; despachante padrao desligado.
 */
test('Integration Gate: Leituras e regras da tela de publicacao (F8-4b.1) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-pubui-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  delete process.env.PUBLICATION_DISPATCH_ENABLED;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-pubui-a-${run}`, name: 'CI Pub UI A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-pubui-b-${run}`, name: 'CI Pub UI B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-pubui-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca UI' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Outra Marca UI' } });
  for (const m of [managerA, memberA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }
  const IG = `sim-ig-ui-${run}`;
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', accountName: 'Conta de teste', charLimit: 2200 } } });
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'BRIGHTBEAN', externalId: `sim-fb-ui-${run}`, metadata: { platform: 'facebook' } } });
  await prisma.clientIntegration.create({ data: { clientId: c2.id, provider: 'BRIGHTBEAN', externalId: `sim-ig-outro-${run}`, metadata: { platform: 'instagram_login' } } });

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
    const addr = `10.8.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token }, remoteAddress: addr });
    const d = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: addr,
      payload: { token, decision: 'APPROVED', contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true },
    });
    assert.strictEqual(d.statusCode, 200, d.body);
    return id;
  };
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().replace('Z', '+00:00');
  const requestPub = (itemId: string, minutes: number) => A(managerA, 'POST', `/content/items/${itemId}/publications`, { socialAccountId: IG, scheduledAt: at(minutes) });

  /* ------------------------------ 1. contas elegiveis e situacao do envio ------------------------------ */
  let item1 = '';
  await t.test('1. Contas elegiveis: so Instagram vinculado ao cliente do conteudo; situacao do envio desligada', async () => {
    item1 = await approvedItem('Principal');
    const r = await A(memberA, 'GET', `/content/items/${item1}/publication-targets`);
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(r.json(), [{ socialAccountId: IG, platform: 'instagram_login', label: 'Conta de teste', charLimit: 2200 }]);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/content/items/${item1}/publication-targets`)).statusCode, 404);
    const s = await A(memberA, 'GET', '/content/publication-settings');
    assert.strictEqual(s.statusCode, 200);
    assert.deepStrictEqual(s.json(), { dispatchEnabled: false, minLeadMinutes: 5, pilot: 'instagram', dailyCap: 25 });
  });

  /* ------------------------------ 2. visao com versao, envio e acoes ------------------------------ */
  await t.test('2. Visao da publicacao: versao, "registrado no Hub" x "enviado" e acoes por estado', async () => {
    const r = await requestPub(item1, 30);
    assert.strictEqual(r.statusCode, 201, r.body);
    const v = r.json();
    assert.strictEqual(v.versionNumber, 1);
    assert.strictEqual(v.sentToProvider, false, 'registrado no Hub, ainda nao enviado ao Instagram');
    assert.deepStrictEqual(v.actions, { reschedule: true, cancel: true });
    const list = (await A(memberA, 'GET', `/content/items/${item1}/publications`)).json();
    assert.strictEqual(list[0].versionNumber, 1);
  });

  /* ------------------------------ 3. cancelar x novo pedido x unicidade ------------------------------ */
  await t.test('3. Cancelar antes do envio libera a vaga; cancelamento solicitado de agendado ainda ocupa', async () => {
    const pubs = (await A(managerA, 'GET', `/content/items/${item1}/publications`)).json();
    const c = await A(managerA, 'POST', `/content/publications/${pubs[0].id}/cancel`);
    assert.strictEqual(c.json().state, 'CANCELLED');
    assert.deepStrictEqual(c.json().actions, { reschedule: false, cancel: false });
    const again = await requestPub(item1, 40);
    assert.strictEqual(again.statusCode, 201, 'vaga liberada pelo cancelamento confirmado');

    // agendado no provedor (simulador): o cancelamento fica "solicitado" ate o despachante confirmar
    const sim = new PublicationSimulator({ accounts: [{ id: IG, platform: 'instagram_login', connectionStatus: 'connected', charLimit: 2200 }] });
    const on = new PublicationDispatcher(async () => sim, () => resolveFileStorage(), { PUBLICATION_DISPATCH_ENABLED: 'true' });
    await on.dispatchDue();
    const pid = again.json().id;
    const scheduled = await prisma.contentPublication.findUniqueOrThrow({ where: { id: pid } });
    assert.strictEqual(scheduled.state, 'SCHEDULED');
    const cr = await A(managerA, 'POST', `/content/publications/${pid}/cancel`);
    assert.strictEqual(cr.statusCode, 200, cr.body);
    assert.strictEqual(cr.json().state, 'SCHEDULED');
    assert.ok(cr.json().cancelRequestedAt);
    assert.deepStrictEqual(cr.json().actions, { reschedule: false, cancel: false }, 'nada mais ate a confirmacao');
    const blocked = await requestPub(item1, 50);
    assert.strictEqual(blocked.statusCode, 409);
    assert.strictEqual(blocked.json().code, 'PUBLICATION_ALREADY_ACTIVE', 'a unicidade do banco segura o novo pedido');
    await on.dispatchDue();
    assert.strictEqual((await prisma.contentPublication.findUniqueOrThrow({ where: { id: pid } })).state, 'CANCELLED');
    assert.strictEqual((await requestPub(item1, 60)).statusCode, 201, 'confirmado o cancelamento, a vaga volta');
  });

  /* ------------------------------ 4. retentativa do provedor bloqueia ------------------------------ */
  await t.test('4. Retentativa automatica do provedor e estado ambiguo bloqueiam reagendar e cancelar', async () => {
    const item = await approvedItem('Retentativa');
    const pid = (await requestPub(item, 30)).json().id;
    for (const state of ['PROVIDER_RETRY', 'AMBIGUOUS', 'PUBLISHING'] as const) {
      await prisma.contentPublication.update({ where: { id: pid }, data: { state } });
      const view = (await A(managerA, 'GET', `/content/items/${item}/publications`)).json()[0];
      assert.deepStrictEqual(view.actions, { reschedule: false, cancel: false }, state);
      assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pid}/reschedule`, { scheduledAt: at(90) })).json().code, 'PUBLICATION_LOCKED', state);
      assert.strictEqual((await A(managerA, 'POST', `/content/publications/${pid}/cancel`)).json().code, 'PUBLICATION_LOCKED', state);
    }
  });

  /* ------------------------------ 5. P36: teto de 25 por conta em 24 h ------------------------------ */
  await t.test('5. P36: 25 publicacoes por conta em 24 h; a 26a e recusada; cancelada nao conta; fora da janela passa', async () => {
    // a conta ja tem publicacoes ativas dos cenarios anteriores: completa ate 25 dentro da mesma janela
    const ativas = () => prisma.contentPublication.count({ where: { organizationId: orgA.id, socialAccountId: IG, state: { notIn: ['CANCELLED', 'FAILED'] } } });
    const criadas: string[] = [];
    let minuto = 100;
    while ((await ativas()) < 25) {
      const item = await approvedItem(`Teto ${minuto}`);
      const r = await requestPub(item, minuto++);
      assert.strictEqual(r.statusCode, 201, r.body);
      criadas.push(r.json().id);
    }
    assert.strictEqual(await ativas(), 25);
    const extra = await approvedItem('Vigesima sexta');
    const over = await requestPub(extra, 200);
    assert.strictEqual(over.statusCode, 422);
    assert.strictEqual(over.json().code, 'DAILY_CAP_REACHED');
    // fora da janela de 24 h (em torno do horario pedido), a mesma conta aceita
    assert.strictEqual((await requestPub(extra, 30 * 60)).statusCode, 201, 'fora da janela');
    // cancelar uma dentro da janela libera a vaga
    const extra2 = await approvedItem('Depois do cancelamento');
    assert.strictEqual((await A(managerA, 'POST', `/content/publications/${criadas[0]}/cancel`)).json().state, 'CANCELLED');
    assert.strictEqual((await requestPub(extra2, 210)).statusCode, 201, 'cancelada nao conta no teto');
  });
});
