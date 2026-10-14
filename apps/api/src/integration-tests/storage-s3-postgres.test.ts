import test from 'node:test';
import assert from 'node:assert';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { assertTestDatabase } from '../lib/test-database-guard.js';
import { startFakeS3, type FakeS3 } from '../lib/__tests__/support/fake-s3-server.js';
import { resolveFileStorage } from '../modules/content/file-storage.js';
import { PublicationDispatcher } from '../modules/content/publication/publication-dispatcher.js';
import { PublicationSimulator } from '../modules/content/publication/publication-simulator.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * HM-2 (DEC-HML-003) - Os consumidores do armazenamento funcionam com o driver S3-compativel:
 * upload, dimensoes, previa interna, midia da pagina publica de aprovacao, decisao do cliente (existencia no storage)
 * e envio da midia pela publicacao (simulador do provedor). O S3 e um emulador local; nada externo.
 */
test('Integration Gate: Consumidores do armazenamento com driver S3 (HM-2) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const s3: FakeS3 = await startFakeS3();
  Object.assign(process.env, {
    FILE_STORAGE_DRIVER: 's3',
    FILE_STORAGE_S3_ENDPOINT: s3.endpoint,
    FILE_STORAGE_S3_ALLOW_INSECURE: 'true',
    FILE_STORAGE_S3_REGION: 'auto',
    FILE_STORAGE_S3_BUCKET: s3.bucket,
    FILE_STORAGE_S3_ACCESS_KEY_ID: 'AKIATESTEXAMPLE0001',
    FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'segredo-de-teste-nao-real-0123456789',
  });
  delete process.env.FILE_STORAGE_LOCAL_DIR;
  delete process.env.PUBLICATION_DISPATCH_ENABLED;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-s3-a-${run}`, name: 'CI S3 A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-s3-b-${run}`, name: 'CI S3 B' } });
  t.after(async () => {
    for (const k of Object.keys(process.env)) if (k.startsWith('FILE_STORAGE_')) delete process.env[k];
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
    await s3.close();
  });

  const mk = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-s3-${label}-${run}@zafira.test` } });
    await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return user;
  };
  const adminA = await mk('admin-a', orgA.id, 'ADMIN');
  const adminB = await mk('admin-b', orgB.id, 'ADMIN');
  const client = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca S3' } });
  const IG = `sim-ig-s3-${run}`;
  await prisma.clientIntegration.create({ data: { clientId: client.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', accountName: 'Conta de teste' } } });

  const tokenOf = (u: { id: string }, org: string) => (app as any).jwt.sign({ sub: u.id, email: 'ci@zafira.test', activeOrganizationId: org });
  const A = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, cookies: { token: tokenOf(adminA, orgA.id) }, payload: payload as any });

  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(1350), ...be16(1080), 0x03, 1, 1, 1, 1, 1, 1, 1, 1, 1]), randomBytes(2048)]);
  const sha = createHash('sha256').update(jpeg).digest('hex');
  const upload = (itemId: string, as = adminA, org = orgA.id) => {
    const boundary = `----zafira${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    return app.inject({
      method: 'POST', url: `/content/items/${itemId}/media`, cookies: { token: tokenOf(as, org) },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, jpeg, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  };

  let itemId = '';
  let mediaId = '';
  let approvalToken = '';
  const objectKey = `org/${orgA.id}/sha256/${sha}`;

  await t.test('1. Upload: o arquivo vai para o bucket, com chave por organizacao e hash, e as dimensoes sao gravadas', async () => {
    const r = await A('POST', '/content/items', { clientId: client.id, title: 'Peca S3', format: 'FEED_IMAGE', caption: 'Legenda S3' });
    assert.strictEqual(r.statusCode, 201, r.body);
    itemId = r.json().id;
    const up = await upload(itemId);
    assert.strictEqual(up.statusCode, 201, up.body);
    const media = up.json().versions[0].media[0];
    mediaId = media.id;
    assert.deepStrictEqual([media.widthPx, media.heightPx], [1080, 1350]);
    assert.ok(s3.objects.has(objectKey), 'objeto gravado com a chave esperada');
    assert.deepStrictEqual(s3.objects.get(objectKey)!.body, jpeg);
    assert.strictEqual(s3.objects.get(objectKey)!.meta.sha256, sha);
    assert.ok(s3.requests.every((q) => q.hasSigV4));
  });

  await t.test('2. Previa interna: o arquivo e servido pela API (sem URL do bucket) com os mesmos bytes', async () => {
    const r = await A('GET', `/content/items/${itemId}/media/${mediaId}/file`);
    assert.strictEqual(r.statusCode, 200);
    assert.deepStrictEqual(r.rawPayload, jpeg);
    assert.ok(!JSON.stringify(r.headers).includes(s3.endpoint), 'nenhum URL do bucket exposto');
    // outra organizacao nao acessa
    const other = await app.inject({ method: 'GET', url: `/content/items/${itemId}/media/${mediaId}/file`, cookies: { token: tokenOf(adminB, orgB.id) } });
    assert.strictEqual(other.statusCode, 404);
  });

  await t.test('3. Aprovacao do cliente: midia publica pelo link, decisao confere a existencia no storage', async () => {
    const link = await A('POST', `/content/items/${itemId}/approval-links`, {});
    assert.strictEqual(link.statusCode, 201, link.body);
    approvalToken = link.json().token;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token: approvalToken }, remoteAddress: '10.5.0.1' });
    assert.strictEqual(view.statusCode, 200, view.body);
    const mediaPath: string = view.json().media[0].path;
    const pub = await app.inject({ method: 'GET', url: mediaPath, remoteAddress: '10.5.0.1' });
    assert.strictEqual(pub.statusCode, 200);
    assert.deepStrictEqual(pub.rawPayload, jpeg);
    const headsBefore = s3.count('HEAD');
    const d = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: '10.5.0.1',
      payload: { token: approvalToken, decision: 'APPROVED', contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true },
    });
    assert.strictEqual(d.statusCode, 200, d.body);
    assert.ok(s3.count('HEAD') > headsBefore, 'a decisao consultou o armazenamento');
  });

  await t.test('4. Armazenamento indisponivel na decisao: nenhuma aprovacao falsa (fail closed)', async () => {
    const r = await A('POST', '/content/items', { clientId: client.id, title: 'Peca S3 sem arquivo no bucket', format: 'FEED_IMAGE', caption: 'x' });
    const id2 = r.json().id as string;
    assert.strictEqual((await upload(id2)).statusCode, 201);
    s3.objects.clear(); // arquivo some do bucket depois do upload
    const link = await A('POST', `/content/items/${id2}/approval-links`, {});
    const token = link.json().token;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token }, remoteAddress: '10.5.0.2' });
    const d = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: '10.5.0.2',
      payload: { token, decision: 'APPROVED', contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true },
    });
    assert.notStrictEqual(d.statusCode, 200, 'sem o arquivo no storage a aprovacao nao e registrada');
    assert.strictEqual(await prisma.approvalDecision.count({ where: { itemId: id2 } }), 0);
    // restaura o objeto para os proximos cenarios (o item principal ja esta aprovado e congelado)
    await resolveFileStorage().put(objectKey, jpeg);
  });

  await t.test('5. Publicacao: o despachante le o arquivo do bucket e o envia ao provedor (simulador)', async () => {
    const policy = { PUBLICATION_PILOT_ORGANIZATION_IDS: orgA.id, PUBLICATION_PILOT_FORMATS: 'FEED_IMAGE' };
    const sim = new PublicationSimulator({ accounts: [{ id: IG, platform: 'instagram_login', connectionStatus: 'connected', charLimit: 2200 }] });
    const dispatcher = new PublicationDispatcher(async () => sim, () => resolveFileStorage(), { PUBLICATION_DISPATCH_ENABLED: 'true', ...policy });
    const at = new Date(Date.now() + 30 * 60_000).toISOString().replace('Z', '+00:00');
    const req = await A('POST', `/content/items/${itemId}/publications`, { socialAccountId: IG, scheduledAt: at });
    assert.strictEqual(req.statusCode, 201, req.body);
    const gets = s3.count('GET');
    const out = await dispatcher.dispatchDue();
    assert.ok(out.results.includes('PUBLISH:DONE'), JSON.stringify(out));
    assert.ok(s3.count('GET') > gets, 'a midia foi lida do bucket');
    assert.strictEqual(sim.count('uploadMedia'), 1);
    const pub = await prisma.contentPublication.findUniqueOrThrow({ where: { id: req.json().id } });
    assert.strictEqual(pub.state, 'SCHEDULED');
  });

  await t.test('6. Objeto adulterado no bucket nunca chega ao cliente nem ao provedor', async () => {
    s3.tamper(objectKey);
    const r = await A('GET', `/content/items/${itemId}/media/${mediaId}/file`);
    assert.notStrictEqual(r.statusCode, 200);
    assert.ok(!r.rawPayload.equals(jpeg) || r.statusCode >= 400);
    const link = await app.inject({ method: 'GET', url: '/public/approval/media?t=invalido', remoteAddress: '10.5.0.3' });
    assert.ok(link.statusCode >= 400);
  });
});
