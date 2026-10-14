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
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * F8-5p.3 (DEC-F8-031, P39) - Barreiras do piloto no pedido e imediatamente antes do envio:
 * politica de organizacoes e formatos (fail closed), vinculo ativo cliente + conta + organizacao,
 * pedidos ja pendentes na caixa de saida, mudanca da politica e cancelamento sempre permitido.
 * O provedor e sempre o simulador; nenhuma barreira bloqueada chega a montar o gateway.
 */
test('Integration Gate: Barreiras do piloto de publicacao (F8-5p.3) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-pilot-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  delete process.env.PUBLICATION_DISPATCH_ENABLED;
  delete process.env.PUBLICATION_PILOT_ORGANIZATION_IDS;
  delete process.env.PUBLICATION_PILOT_FORMATS;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-pilot-a-${run}`, name: 'CI Piloto A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-pilot-b-${run}`, name: 'CI Piloto B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    delete process.env.PUBLICATION_PILOT_ORGANIZATION_IDS;
    delete process.env.PUBLICATION_PILOT_FORMATS;
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const user = await prisma.user.create({ data: { name: 'CI admin', email: `ci-pilot-admin-${run}@zafira.test` } });
  await prisma.organizationMember.create({ data: { organizationId: orgA.id, userId: user.id, role: 'ADMIN' } });
  const client = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca Piloto' } });
  const IG = `sim-ig-pilot-${run}`;
  const link = await prisma.clientIntegration.create({ data: { clientId: client.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', accountName: 'Conta de teste' } } });

  const token = (app as any).jwt.sign({ sub: user.id, email: 'ci@zafira.test', activeOrganizationId: orgA.id });
  const A = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, cookies: { token }, payload: payload as any });
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x04, 0x38, 0x03, 1, 1, 1, 1, 1, 1, 1, 1, 1]), randomBytes(64)]);
  const upload = (itemId: string) => {
    const boundary = `----zafira${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    return app.inject({
      method: 'POST', url: `/content/items/${itemId}/media`, cookies: { token },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, jpeg(), Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  };
  let ip = 1;
  const approvedItem = async (title: string) => {
    const r = await A('POST', '/content/items', { clientId: client.id, title, format: 'FEED_IMAGE', caption: `Legenda ${title}` });
    assert.strictEqual(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    assert.strictEqual((await upload(id)).statusCode, 201);
    const l = await A('POST', `/content/items/${id}/approval-links`, {});
    assert.strictEqual(l.statusCode, 201, l.body);
    const addr = `10.6.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token: l.json().token }, remoteAddress: addr });
    const d = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: addr,
      payload: { token: l.json().token, decision: 'APPROVED', contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true },
    });
    assert.strictEqual(d.statusCode, 200, d.body);
    return id;
  };
  const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace('Z', '+00:00');
  const request = (itemId: string) => A('POST', `/content/items/${itemId}/publications`, { socialAccountId: IG, scheduledAt: at(30) });
  const setPolicy = (orgs?: string, formats?: string) => {
    if (orgs === undefined) delete process.env.PUBLICATION_PILOT_ORGANIZATION_IDS;
    else process.env.PUBLICATION_PILOT_ORGANIZATION_IDS = orgs;
    if (formats === undefined) delete process.env.PUBLICATION_PILOT_FORMATS;
    else process.env.PUBLICATION_PILOT_FORMATS = formats;
  };

  const sim = new PublicationSimulator({ accounts: [{ id: IG, platform: 'instagram_login', connectionStatus: 'connected', charLimit: 2200 }] });
  let gatewayBuilds = 0;
  const dispatcher = (policy: Record<string, string>) =>
    new PublicationDispatcher(
      async () => {
        gatewayBuilds += 1;
        return sim;
      },
      () => resolveFileStorage(),
      { PUBLICATION_DISPATCH_ENABLED: 'true', ...policy }
    );
  const VALID = { PUBLICATION_PILOT_ORGANIZATION_IDS: orgA.id, PUBLICATION_PILOT_FORMATS: 'STORY,FEED_IMAGE' };
  const pub = (id: string) => prisma.contentPublication.findUniqueOrThrow({ where: { id } });
  const outboxOf = (publicationId: string) => prisma.publicationOutbox.findMany({ where: { publicationId }, orderBy: { createdAt: 'asc' } });
  const blockedEvents = (publicationId: string) =>
    prisma.contentEvent.count({ where: { organizationId: orgA.id, type: 'PUBLICATION_BLOCKED', data: { path: ['publicationId'], equals: publicationId } } });

  await t.test('1. Pedido: politica configurada vale ja no pedido (formato, organizacao, vazia); simulacao sem politica segue livre', async () => {
    const i1 = await approvedItem('Formato');
    setPolicy(orgA.id, 'STORY');
    let r = await request(i1);
    assert.strictEqual(r.statusCode, 422, r.body);
    assert.strictEqual(r.json().code, 'PILOT_FORMAT_NOT_AUTHORIZED');
    setPolicy(orgB.id, 'FEED_IMAGE');
    r = await request(i1);
    assert.strictEqual(r.json().code, 'PILOT_ORGANIZATION_NOT_AUTHORIZED');
    const s = (await A('GET', '/content/publication-settings')).json();
    assert.deepStrictEqual(s.pilotPolicy, { enforced: true, valid: true, organizationAuthorized: false, formats: ['FEED_IMAGE'] });
    assert.ok(!JSON.stringify(s).includes(orgB.id), 'nunca expoe organizacoes de terceiros');
    setPolicy('', '');
    r = await request(i1);
    assert.strictEqual(r.json().code, 'PILOT_POLICY_INVALID', 'vazia bloqueia');
    setPolicy(orgA.id, 'STORY,GIF');
    assert.strictEqual((await request(i1)).json().code, 'PILOT_POLICY_INVALID', 'invalida bloqueia');
    setPolicy(orgA.id, 'FEED_IMAGE');
    assert.strictEqual((await request(i1)).statusCode, 201, 'organizacao e formato autorizados');
    setPolicy();
    const i2 = await approvedItem('Simulacao');
    assert.strictEqual((await request(i2)).statusCode, 201, 'simulacao (envio desligado, sem politica): pedido registrado, nada sai do Hub');
  });

  await t.test('2. Envio sem politica (ausente): pedidos pendentes falham sem montar o gateway e ficam auditados', async () => {
    const pending = await prisma.contentPublication.findMany({ where: { organizationId: orgA.id, state: 'PENDING' }, select: { id: true } });
    assert.ok(pending.length >= 2);
    const before = gatewayBuilds;
    await dispatcher({}).dispatchDue();
    assert.strictEqual(gatewayBuilds, before, 'nenhuma chamada ao provedor');
    for (const { id } of pending) {
      const p = await pub(id);
      assert.deepStrictEqual([p.state, p.failureCode], ['FAILED', 'PILOT_POLICY_INVALID']);
      assert.strictEqual((await outboxOf(id))[0].status, 'FAILED');
      assert.strictEqual(await blockedEvents(id), 1, 'bloqueio registrado no historico');
    }
  });

  await t.test('3. Politica mudou depois do pedido: organizacao fora da lista e formato fora da lista bloqueiam o pendente', async () => {
    const i3 = await approvedItem('Mudanca de lista');
    const p3 = (await request(i3)).json().id;
    const before = gatewayBuilds;
    await dispatcher({ PUBLICATION_PILOT_ORGANIZATION_IDS: orgB.id, PUBLICATION_PILOT_FORMATS: 'FEED_IMAGE' }).dispatchDue();
    assert.deepStrictEqual([(await pub(p3)).state, (await pub(p3)).failureCode], ['FAILED', 'PILOT_ORGANIZATION_NOT_AUTHORIZED']);
    const i4 = await approvedItem('Formato retirado');
    const p4 = (await request(i4)).json().id;
    await dispatcher({ PUBLICATION_PILOT_ORGANIZATION_IDS: orgA.id, PUBLICATION_PILOT_FORMATS: 'STORY' }).dispatchDue();
    assert.deepStrictEqual([(await pub(p4)).state, (await pub(p4)).failureCode], ['FAILED', 'PILOT_FORMAT_NOT_AUTHORIZED']);
    assert.strictEqual(gatewayBuilds, before);
  });

  await t.test('4. Conta desvinculada depois do agendamento: bloqueia antes do envio', async () => {
    const i5 = await approvedItem('Desvinculada');
    const p5 = (await request(i5)).json().id;
    await prisma.clientIntegration.delete({ where: { id: link.id } });
    const before = gatewayBuilds;
    await dispatcher(VALID).dispatchDue();
    assert.strictEqual(gatewayBuilds, before);
    const p = await pub(p5);
    assert.deepStrictEqual([p.state, p.failureCode, p.externalPostId], ['FAILED', 'ACCOUNT_UNLINKED', null]);
    await prisma.clientIntegration.create({ data: { clientId: client.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', accountName: 'Conta de teste' } } });
  });

  let p6 = '';
  await t.test('5. Politica valida e vinculo ativo: envio segue (simulador), com idempotencia preservada', async () => {
    const i6 = await approvedItem('Autorizado');
    p6 = (await request(i6)).json().id;
    const before = gatewayBuilds;
    const out = await dispatcher(VALID).dispatchDue();
    assert.ok(out.results.includes('PUBLISH:DONE'), JSON.stringify(out));
    assert.ok(gatewayBuilds > before);
    const p = await pub(p6);
    assert.strictEqual(p.state, 'SCHEDULED');
    assert.ok(p.externalPostId);
    await dispatcher(VALID).dispatchDue();
    assert.strictEqual(sim.count('createDraft'), 1, 'nenhum rascunho repetido');
  });

  await t.test('6. Rascunho/agendado no provedor e politica retirada: reagendar bloqueado sem mudar o estado; cancelar sempre permitido', async () => {
    const r = await A('POST', `/content/publications/${p6}/reschedule`, { scheduledAt: at(60) });
    assert.strictEqual(r.statusCode, 200, r.body);
    const denied = { PUBLICATION_PILOT_ORGANIZATION_IDS: orgB.id, PUBLICATION_PILOT_FORMATS: 'FEED_IMAGE' };
    const reschedules = sim.count('reschedule');
    await dispatcher(denied).dispatchDue();
    let p = await pub(p6);
    assert.deepStrictEqual([p.state, p.failureCode], ['SCHEDULED', 'PILOT_ORGANIZATION_NOT_AUTHORIZED'], 'nada enviado; estado do provedor preservado');
    assert.strictEqual(sim.count('reschedule'), reschedules);
    assert.strictEqual(await blockedEvents(p6), 1);
    const c = await A('POST', `/content/publications/${p6}/cancel`, {});
    assert.strictEqual(c.statusCode, 200, c.body);
    await dispatcher(denied).dispatchDue();
    p = await pub(p6);
    assert.strictEqual(p.state, 'CANCELLED', 'cancelar so reduz exposicao: permitido mesmo fora da politica');
  });

});
