import test from 'node:test';
import assert from 'node:assert';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { storageKeyFor } from '@zafira/domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { resolveFileStorage } from '../modules/content/file-storage.js';
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * F8-5p.1 (DEC-F8-031, P35) - Dimensoes das imagens: gravadas no upload, calculadas uma vez para arquivos antigos,
 * imutaveis depois de gravadas; aviso no detalhe antes da aprovacao; agendamento recusado acima de 30 MP ou ilegivel.
 */
test('Integration Gate: Dimensoes de imagem e limite de 30 MP (F8-5p.1) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-dims-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  delete process.env.PUBLICATION_DISPATCH_ENABLED;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const org = await prisma.organization.create({ data: { slug: `ci-dims-${run}`, name: 'CI Dimensoes' } });
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });
  const user = await prisma.user.create({ data: { name: 'CI admin', email: `ci-dims-admin-${run}@zafira.test` } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: 'ADMIN' } });
  const client = await prisma.client.create({ data: { organizationId: org.id, name: 'CI Marca Dimensoes' } });
  const IG = `sim-ig-dims-${run}`;
  await prisma.clientIntegration.create({ data: { clientId: client.id, provider: 'BRIGHTBEAN', externalId: IG, metadata: { platform: 'instagram_login', accountName: 'Conta de teste' } } });

  const token = (app as any).jwt.sign({ sub: user.id, email: 'ci@zafira.test', activeOrganizationId: org.id });
  const A = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, cookies: { token }, payload: payload as any });

  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const jpeg = (w: number, h: number) =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(h), ...be16(w), 0x03, 1, 1, 1, 1, 1, 1, 1, 1, 1]), randomBytes(64)]);
  const png = (w: number, h: number) =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0]), randomBytes(64)]);
  // JPEG sem quadro legivel e deterministico: APP0 de 16 bytes seguido de byte fora de sincronia (nunca vira SOF por acaso)
  const unreadable = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0x00]), randomBytes(64)]);

  const upload = (itemId: string, data: Buffer) => {
    const boundary = `----zafira${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    return app.inject({
      method: 'POST', url: `/content/items/${itemId}/media`, cookies: { token },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  };
  const newItem = async (title: string) => {
    const r = await A('POST', '/content/items', { clientId: client.id, title, format: 'FEED_IMAGE', caption: `Legenda ${title}` });
    assert.strictEqual(r.statusCode, 201, r.body);
    return r.json().id as string;
  };
  let ip = 1;
  const approve = async (itemId: string) => {
    const link = await A('POST', `/content/items/${itemId}/approval-links`, {});
    assert.strictEqual(link.statusCode, 201, link.body);
    const addr = `10.7.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token: link.json().token }, remoteAddress: addr });
    const d = await app.inject({
      method: 'POST', url: '/public/approval/decision', remoteAddress: addr,
      payload: { token: link.json().token, decision: 'APPROVED', contentHash: view.json().contentHash, approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true },
    });
    assert.strictEqual(d.statusCode, 200, d.body);
  };
  const schedule = (itemId: string) =>
    A('POST', `/content/items/${itemId}/publications`, { socialAccountId: IG, scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString().replace('Z', '+00:00') });
  const codes = (detail: any) => detail.problems.map((p: any) => p.code);

  await t.test('1. Upload grava largura e altura lidas do conteudo; sem aviso dentro do limite', async () => {
    const id = await newItem('Valida');
    const r = await upload(id, jpeg(1080, 1350));
    assert.strictEqual(r.statusCode, 201, r.body);
    const m = r.json().versions[0].media[0];
    assert.deepStrictEqual([m.widthPx, m.heightPx], [1080, 1350]);
    assert.deepStrictEqual(codes(r.json()), []);
  });

  await t.test('1b. Nova versao leva as dimensoes do mesmo arquivo', async () => {
    const id = await newItem('Versao');
    assert.strictEqual((await upload(id, jpeg(1200, 1500))).statusCode, 201);
    assert.strictEqual((await A('POST', `/content/items/${id}/approval-links`, {})).statusCode, 201);
    const v2 = await A('POST', `/content/items/${id}/versions`, {});
    assert.strictEqual(v2.statusCode, 201, v2.body);
    const m = v2.json().versions[1].media[0];
    assert.deepStrictEqual([m.widthPx, m.heightPx], [1200, 1500]);
  });

  await t.test('2. Acima de 30 MP: arquivo aceito, aviso ja no upload, agendamento recusado (422)', async () => {
    const id = await newItem('Grande');
    const r = await upload(id, png(6000, 6000));
    assert.strictEqual(r.statusCode, 201, r.body);
    assert.deepStrictEqual(codes(r.json()), ['MEDIA_TOO_MANY_PIXELS'], 'aviso antes da aprovacao');
    await approve(id);
    const s = await schedule(id);
    assert.strictEqual(s.statusCode, 422, s.body);
    assert.strictEqual(s.json().code, 'MEDIA_TOO_MANY_PIXELS');
  });

  await t.test('3. Dimensoes ilegiveis: aviso e agendamento recusado (fail closed)', async () => {
    const id = await newItem('Ilegivel');
    const r = await upload(id, unreadable());
    assert.strictEqual(r.statusCode, 201, r.body);
    assert.deepStrictEqual(codes(r.json()), ['MEDIA_DIMENSIONS_UNKNOWN']);
    await approve(id);
    const s = await schedule(id);
    assert.strictEqual(s.statusCode, 422, s.body);
    assert.strictEqual(s.json().code, 'MEDIA_DIMENSIONS_UNKNOWN');
  });

  await t.test('4. Limite exato (6000x5000 = 30 MP) e aceito', async () => {
    const id = await newItem('Limite');
    assert.strictEqual((await upload(id, png(6000, 5000))).statusCode, 201);
    await approve(id);
    const s = await schedule(id);
    assert.strictEqual(s.statusCode, 201, s.body);
  });

  await t.test('5. Arquivo antigo sem dimensoes: calculado uma vez; depois imutavel', async () => {
    const id = await newItem('Antigo');
    const version = await prisma.contentVersion.findFirstOrThrow({ where: { itemId: id } });
    const data = jpeg(2000, 1500);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const storageKey = storageKeyFor(org.id, sha256);
    await resolveFileStorage().put(storageKey, data);
    const old = await prisma.contentMedia.create({
      data: { organizationId: org.id, itemId: id, versionId: version.id, position: 0, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: data.length, sha256, storageKey, originalFilename: 'antigo.jpg' },
    });
    assert.strictEqual(old.widthPx, null, 'registro no formato anterior a P35');
    const detail = await A('GET', `/content/items/${id}`);
    assert.strictEqual(detail.statusCode, 200, detail.body);
    assert.deepStrictEqual(codes(detail.json()), []);
    const filled = await prisma.contentMedia.findUniqueOrThrow({ where: { id: old.id } });
    assert.deepStrictEqual([filled.widthPx, filled.heightPx], [2000, 1500]);
    await assert.rejects(prisma.contentMedia.update({ where: { id: old.id }, data: { widthPx: 10 } }), /content_media_dimensions_immutable/);
    await assert.rejects(prisma.contentMedia.update({ where: { id: old.id }, data: { widthPx: null, heightPx: null } }), /content_media_dimensions_immutable/);
    await assert.rejects(
      prisma.contentMedia.create({ data: { organizationId: org.id, itemId: id, versionId: version.id, position: 1, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 10, sha256: 'a'.repeat(64), storageKey: storageKeyFor(org.id, 'a'.repeat(64)), originalFilename: 'x.jpg', widthPx: 0, heightPx: 10 } }),
      /content_media_dimensions_positive/
    );
  });
});
