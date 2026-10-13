import test from 'node:test';
import assert from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

// --- GUARD DE SEGURANCA ---
if (process.env.NODE_ENV === 'production') throw new Error('NAO E PERMITIDO EXECUTAR TESTES DE INTEGRACAO EM PRODUCAO');
if (process.env.ZAFIRA_TEST_DATABASE !== '1') throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatorio para testes de integracao');
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');

/**
 * F8-1 (DEC-F8-003) - Conteudo: arquivos finais versionados, contra PostgreSQL real.
 * Nada e enviado ao BrightBean nem ao Asana. Arquivos de teste sao bytes aleatorios com assinatura valida.
 */
test('Integration Gate: Conteudo (F8-1) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-content-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-cnt-a-${run}`, name: 'CI Conteudo A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-cnt-b-${run}`, name: 'CI Conteudo B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    // remocao do tenant inteiro: unico caminho em que o banco aceita apagar conteudo
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-cnt-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MEMBER'); // sem carteira
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Cnt 1' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Cnt 2' } });
  const cB = await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Cliente Cnt B' } });
  await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: memberA.member.id, clientId: c1.id } });

  type Who = { user: { id: string } };
  const token = (who: Who, org: string) => (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org });
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, cookies: who ? { token: token(who, org) } : undefined, payload: payload as any });
  const A = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);
  const upload = (who: Who, org: string, itemId: string, data: Buffer, filename = 'arquivo.bin', query = '') => {
    const boundary = `----zafiraBoundary${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return app.inject({
      method: 'POST',
      url: `/content/items/${itemId}/media${query}`,
      cookies: { token: token(who, org) },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, data, tail]),
    });
  };

  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
  const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
  const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), randomBytes(32)]);
  const mp4 = (brand = 'isom') => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.from(brand), randomBytes(48)]);

  const createItem = async (who: Who, body: Record<string, unknown>) => A(who, 'POST', '/content/items', { caption: '', ...body });

  /* ------------------------------ 1. permissoes e carteira ------------------------------ */
  let feedId = '';
  await t.test('1. Criacao com cliente da carteira; fora da carteira, outra organizacao e formato invalido sao recusados', async () => {
    const ok = await createItem(memberA, { clientId: c1.id, title: `Post ${run}`, format: 'FEED_IMAGE', caption: 'Legenda inicial' });
    assert.strictEqual(ok.statusCode, 201, ok.body);
    feedId = ok.json().id;
    assert.strictEqual(ok.json().currentVersionNumber, 1);
    assert.strictEqual(ok.json().editable, true);
    assert.deepStrictEqual(ok.json().problems.map((p: any) => p.code), ['MEDIA_MISSING']);
    assert.strictEqual((await createItem(memberA, { clientId: c2.id, title: 'x', format: 'REEL' })).statusCode, 404, 'cliente fora da carteira');
    assert.strictEqual((await call(adminB, orgB.id, 'POST', '/content/items', { clientId: c1.id, title: 'x', format: 'REEL', caption: '' })).statusCode, 404, 'cliente de outra organizacao');
    assert.strictEqual((await createItem(adminA, { clientId: c1.id, title: 'x', format: 'VIDEO' })).statusCode, 400, 'formato fora do catalogo');
    assert.strictEqual((await createItem(adminA, { clientId: c1.id, title: '   ', format: 'REEL' })).statusCode, 400);
    assert.strictEqual((await call(null, orgA.id, 'GET', '/content/items')).statusCode, 401);
    // lista e detalhe respeitam a carteira
    assert.strictEqual((await A(outsiderA, 'GET', `/content/items/${feedId}`)).statusCode, 404);
    assert.strictEqual((await A(outsiderA, 'GET', '/content/items')).json().length, 0);
    assert.strictEqual((await A(memberA, 'GET', '/content/items')).json().length, 1);
    assert.strictEqual((await A(adminA, 'GET', `/content/items?clientId=${c2.id}`)).json().length, 0);
    const caps = (await A(memberA, 'GET', '/api/v1/auth/capabilities')).json().permissions;
    assert.strictEqual(caps['content.view'], true);
    assert.strictEqual(caps['content.create'], true);
  });

  /* ------------------------------ 2. vinculos ------------------------------ */
  await t.test('2. Vinculo com tarefa do Asana (espelho local) e peca de Entregas, sem duplicidade', async () => {
    const gid = `${Date.now()}`.slice(-12);
    const missing = await createItem(adminA, { clientId: c1.id, title: 'Com tarefa', format: 'STORY', asanaTaskGid: gid });
    assert.strictEqual(missing.statusCode, 400);
    assert.strictEqual(missing.json().code, 'ASANA_TASK_NOT_FOUND');
    await prisma.asanaTaskMirror.create({ data: { organizationId: orgA.id, clientId: c1.id, projectGid: '9001', taskGid: gid, name: 'Tarefa ficticia de teste' } });
    const ok = await createItem(adminA, { clientId: c1.id, title: 'Com tarefa', format: 'STORY', asanaTaskGid: gid });
    assert.strictEqual(ok.statusCode, 201, ok.body);
    assert.strictEqual(ok.json().asanaTaskGid, gid);
    const dup = await createItem(adminA, { clientId: c1.id, title: 'Outra', format: 'STORY', asanaTaskGid: gid });
    assert.strictEqual(dup.statusCode, 409);
    assert.strictEqual(dup.json().code, 'DUPLICATE_ASANA_TASK');
    assert.strictEqual(dup.json().existingId, ok.json().id);
    // tarefa do mesmo gid no espelho de OUTRO cliente nao vale
    const other = await createItem(adminA, { clientId: c2.id, title: 'Outro cliente', format: 'STORY', asanaTaskGid: gid });
    assert.strictEqual(other.statusCode, 400);
    // peca de Entregas: so do mesmo cliente
    const plan = await prisma.deliverablePlan.create({ data: { organizationId: orgA.id, clientId: c1.id, title: 'Plano CI', period: '2026-10' } });
    const item = await prisma.deliverableItem.create({ data: { organizationId: orgA.id, planId: plan.id, title: 'Item CI', type: 'POST_FEED' } });
    const piece = await prisma.deliverablePiece.create({ data: { organizationId: orgA.id, itemId: item.id, title: 'Peca CI', format: 'FEED' } });
    const linked = await createItem(adminA, { clientId: c1.id, title: 'Com peca', format: 'FEED_IMAGE', deliverablePieceId: piece.id });
    assert.strictEqual(linked.statusCode, 201, linked.body);
    const wrongClient = await createItem(adminA, { clientId: c2.id, title: 'Peca de outro cliente', format: 'FEED_IMAGE', deliverablePieceId: piece.id });
    assert.strictEqual(wrongClient.statusCode, 400);
    assert.strictEqual(wrongClient.json().code, 'PIECE_NOT_FOUND');
    // o vinculo nao altera nada em Entregas
    const after = await prisma.deliverablePiece.findUniqueOrThrow({ where: { id: piece.id } });
    assert.strictEqual(after.stage, 'PRODUCED');
    assert.strictEqual(after.approvedAt, null);
  });

  /* ------------------------------ 3. upload ------------------------------ */
  await t.test('3. Upload valida o tipo REAL e o tamanho; formato limita quantidade e tipo', async () => {
    const fake = await upload(memberA, orgA.id, feedId, Buffer.from('<html><script>alert(1)</script></html>'), 'foto.jpg');
    assert.strictEqual(fake.statusCode, 400, 'extensao .jpg com conteudo HTML');
    assert.strictEqual(fake.json().code, 'UNSUPPORTED_FILE_TYPE');
    assert.strictEqual((await upload(memberA, orgA.id, feedId, Buffer.from('GIF89a' + 'x'.repeat(20)), 'a.png')).statusCode, 400);
    assert.strictEqual((await upload(memberA, orgA.id, feedId, mp4(), 'v.mp4')).json().code, 'MEDIA_KIND_NOT_ALLOWED', 'feed so aceita imagem');
    const ok = await upload(memberA, orgA.id, feedId, jpeg(), 'nome-qualquer.txt');
    assert.strictEqual(ok.statusCode, 201, ok.body);
    const body = ok.json();
    const v = body.versions[0];
    assert.strictEqual(v.media.length, 1);
    assert.strictEqual(v.media[0].mimeType, 'image/jpeg');
    assert.strictEqual(v.media[0].kind, 'IMAGE');
    assert.deepStrictEqual(body.problems, []);
    const hash1 = v.contentHash;
    const second = await upload(memberA, orgA.id, feedId, png(), 'b.png');
    assert.strictEqual(second.statusCode, 409);
    assert.strictEqual(second.json().code, 'MEDIA_TOO_MANY');
    // substituir: remove o antigo (historico preservado) e acrescenta o novo
    const mediaId = v.media[0].id;
    const rep = await upload(memberA, orgA.id, feedId, webp(), 'novo.webp', `?replace=${mediaId}`);
    assert.strictEqual(rep.statusCode, 201, rep.body);
    const media = rep.json().versions[0].media;
    assert.strictEqual(media.length, 2, 'historico mantem o arquivo removido');
    assert.ok(media.find((m: any) => m.id === mediaId).removedAt, 'antigo marcado como removido');
    assert.strictEqual(media.filter((m: any) => !m.removedAt)[0].mimeType, 'image/webp');
    assert.notStrictEqual(rep.json().versions[0].contentHash, hash1);
    // arquivo muito grande
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(101 * 1024 * 1024, 1)]);
    const tooBig = await upload(memberA, orgA.id, feedId, big, 'grande.jpg');
    assert.strictEqual(tooBig.statusCode, 413);
  });

  await t.test('4. Formatos: reel (so video), story (1 imagem ou video), carrossel (2 a 10)', async () => {
    const reel = (await createItem(adminA, { clientId: c1.id, title: 'Reel', format: 'REEL' })).json();
    assert.strictEqual((await upload(adminA, orgA.id, reel.id, jpeg())).json().code, 'MEDIA_KIND_NOT_ALLOWED');
    assert.strictEqual((await upload(adminA, orgA.id, reel.id, mp4('mp42'), 'r.mp4')).statusCode, 201);
    const mov = (await createItem(adminA, { clientId: c1.id, title: 'Story MOV', format: 'STORY' })).json();
    const movUp = await upload(adminA, orgA.id, mov.id, mp4('qt  '), 'story.mov');
    assert.strictEqual(movUp.statusCode, 201);
    assert.strictEqual(movUp.json().versions[0].media[0].mimeType, 'video/quicktime');
    const car = (await createItem(adminA, { clientId: c1.id, title: 'Carrossel', format: 'CAROUSEL' })).json();
    const one = await upload(adminA, orgA.id, car.id, jpeg());
    assert.deepStrictEqual(one.json().problems.map((p: any) => p.code), ['MEDIA_TOO_FEW']);
    for (let i = 0; i < 9; i++) assert.strictEqual((await upload(adminA, orgA.id, car.id, i % 2 ? png() : jpeg())).statusCode, 201);
    const eleventh = await upload(adminA, orgA.id, car.id, jpeg());
    assert.strictEqual(eleventh.statusCode, 409);
    const full = (await A(adminA, 'GET', `/content/items/${car.id}`)).json();
    assert.strictEqual(full.versions[0].media.filter((m: any) => !m.removedAt).length, 10);
    assert.deepStrictEqual(full.problems, []);
  });

  /* ------------------------------ 5. edicao ------------------------------ */
  await t.test('5. Edicao: legenda, titulo, formato e conflito otimista', async () => {
    const d = (await A(adminA, 'GET', `/content/items/${feedId}`)).json();
    const stamp = d.versions[0].updatedAt;
    const ok = await A(adminA, 'PATCH', `/content/items/${feedId}`, { caption: 'Legenda nova', title: 'Titulo novo', expectedUpdatedAt: stamp });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(ok.json().versions[0].caption, 'Legenda nova');
    assert.strictEqual(ok.json().title, 'Titulo novo');
    const stale = await A(adminA, 'PATCH', `/content/items/${feedId}`, { caption: 'Outra', expectedUpdatedAt: stamp });
    assert.strictEqual(stale.statusCode, 409);
    assert.strictEqual(stale.json().code, 'CONFLICT');
    const fmt = await A(adminA, 'PATCH', `/content/items/${feedId}`, { format: 'REEL' });
    assert.strictEqual(fmt.statusCode, 409, 'imagem nao cabe em reel');
    const events = (await A(adminA, 'GET', `/content/items/${feedId}`)).json().events.map((e: any) => e.type);
    assert.ok(events.includes('CONTENT_CREATED') && events.includes('MEDIA_ADDED') && events.includes('MEDIA_REPLACED') && events.includes('CONTENT_UPDATED'));
    const rm = await A(adminA, 'DELETE', `/content/items/${feedId}/media/${randomUUID()}`);
    assert.strictEqual(rm.statusCode, 404);
  });

  /* ------------------------------ 6. versao congelada ------------------------------ */
  await t.test('6. Versao enviada para aprovacao e imutavel (API e banco); nova versao preserva a anterior', async () => {
    const item = (await createItem(adminA, { clientId: c1.id, title: 'Congelavel', format: 'FEED_IMAGE', caption: 'v1' })).json();
    await upload(adminA, orgA.id, item.id, jpeg());
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${item.id}/versions`)).statusCode, 409, 'versao editavel nao gera nova');
    const v1 = await prisma.contentVersion.findFirstOrThrow({ where: { itemId: item.id, number: 1 } });
    await prisma.contentVersion.update({ where: { id: v1.id }, data: { sentForApprovalAt: new Date() } });
    for (const res of [
      await A(adminA, 'PATCH', `/content/items/${item.id}`, { caption: 'mudou' }),
      await upload(adminA, orgA.id, item.id, png()),
    ]) {
      assert.strictEqual(res.statusCode, 409);
      assert.strictEqual(res.json().code, 'VERSION_FROZEN');
    }
    const mediaId = (await prisma.contentMedia.findFirstOrThrow({ where: { versionId: v1.id } })).id;
    assert.strictEqual((await A(adminA, 'DELETE', `/content/items/${item.id}/media/${mediaId}`)).json().code, 'VERSION_FROZEN');
    // banco: mesmo por fora da API
    await assert.rejects(prisma.contentVersion.update({ where: { id: v1.id }, data: { caption: 'burla' } }), /content_versions_frozen/);
    await assert.rejects(prisma.contentVersion.update({ where: { id: v1.id }, data: { number: 7 } }), /content_versions_immutable/);
    await assert.rejects(prisma.contentMedia.update({ where: { id: mediaId }, data: { removedAt: new Date() } }), /content_versions_frozen/);
    await assert.rejects(prisma.contentMedia.update({ where: { id: mediaId }, data: { sha256: 'a'.repeat(64) } }), /content_media_immutable/);
    await assert.rejects(
      prisma.contentMedia.create({
        data: { organizationId: orgA.id, itemId: item.id, versionId: v1.id, position: 9, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 10, sha256: 'b'.repeat(64), storageKey: 'x', originalFilename: 'x.jpg' },
      }),
      /content_versions_frozen/
    );
    // nova versao: v1 intacta, v2 editavel com os mesmos arquivos
    const nv = await A(adminA, 'POST', `/content/items/${item.id}/versions`);
    assert.strictEqual(nv.statusCode, 201, nv.body);
    const body = nv.json();
    assert.strictEqual(body.currentVersionNumber, 2);
    assert.strictEqual(body.editable, true);
    assert.strictEqual(body.versions.length, 2);
    assert.strictEqual(body.versions[0].caption, 'v1');
    assert.strictEqual(body.versions[1].media.filter((m: any) => !m.removedAt).length, 1);
    assert.strictEqual(body.versions[1].contentHash, body.versions[0].contentHash);
    const edit = await A(adminA, 'PATCH', `/content/items/${item.id}`, { caption: 'v2 ajustada' });
    assert.strictEqual(edit.statusCode, 200);
    assert.strictEqual(edit.json().versions[0].caption, 'v1', 'versao anterior preservada');
    assert.notStrictEqual(edit.json().versions[1].contentHash, edit.json().versions[0].contentHash);
  });

  /* ------------------------------ 7. nada e apagado ------------------------------ */
  await t.test('7. Historico protegido: sem DELETE, eventos so crescem, cliente com conteudo nao e excluido (D2/P28)', async () => {
    const item = await prisma.contentItem.findFirstOrThrow({ where: { id: feedId } });
    const ver = await prisma.contentVersion.findFirstOrThrow({ where: { itemId: feedId } });
    const med = await prisma.contentMedia.findFirstOrThrow({ where: { versionId: ver.id } });
    const ev = await prisma.contentEvent.findFirstOrThrow({ where: { itemId: feedId } });
    await assert.rejects(prisma.contentItem.delete({ where: { id: item.id } }), /content_history_protected|foreign key|violat/i);
    await assert.rejects(prisma.contentVersion.delete({ where: { id: ver.id } }), /content_history_protected/);
    await assert.rejects(prisma.contentMedia.delete({ where: { id: med.id } }), /content_history_protected/);
    await assert.rejects(prisma.contentEvent.delete({ where: { id: ev.id } }), /content_history_protected/);
    await assert.rejects(prisma.contentEvent.update({ where: { id: ev.id }, data: { type: 'ALTERADO' } }), /content_events_append_only/);
    await assert.rejects(prisma.contentItem.update({ where: { id: item.id }, data: { clientId: c2.id } }), /content_items_immutable/);
    await assert.rejects(prisma.client.delete({ where: { id: c1.id } }), /foreign key|violat|restrict/i);
    // as linhas seguem la
    assert.ok(await prisma.contentItem.findUnique({ where: { id: item.id } }));
    // nao existe rota de exclusao de conteudo
    assert.strictEqual((await A(adminA, 'DELETE', `/content/items/${feedId}`)).statusCode, 404);
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname IN ('content_items_one_per_asana_task','content_media_active_position','automation_outbox_unique_request','calendar_events_attendee_hashes_gin')`;
    assert.strictEqual(idx.length, 4, 'indices do conteudo e os protegidos anteriores presentes');
  });

  /* ------------------------------ 8. arquivo e isolamento ------------------------------ */
  await t.test('8. Arquivo servido so com sessao e carteira; Org B e quem esta fora da carteira nao leem nem gravam', async () => {
    const d = (await A(adminA, 'GET', `/content/items/${feedId}`)).json();
    const active = d.versions[0].media.find((m: any) => !m.removedAt);
    const file = await A(memberA, 'GET', `/content/items/${feedId}/media/${active.id}/file`);
    assert.strictEqual(file.statusCode, 200);
    assert.strictEqual(file.headers['content-type'], 'image/webp');
    assert.strictEqual(file.headers['x-content-type-options'], 'nosniff');
    assert.match(String(file.headers['cache-control']), /no-store/);
    assert.strictEqual(file.rawPayload.length, active.sizeBytes);
    assert.strictEqual((await call(null, orgA.id, 'GET', `/content/items/${feedId}/media/${active.id}/file`)).statusCode, 401);
    assert.strictEqual((await A(outsiderA, 'GET', `/content/items/${feedId}/media/${active.id}/file`)).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/content/items/${feedId}`)).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/content/items/${feedId}/media/${active.id}/file`)).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', '/content/items')).json().length, 0);
    assert.strictEqual((await upload(adminB, orgB.id, feedId, jpeg())).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'PATCH', `/content/items/${feedId}`, { title: 'invasao' })).statusCode, 404);
    const own = await call(adminB, orgB.id, 'POST', '/content/items', { clientId: cB.id, title: 'Da Org B', format: 'STORY', caption: '' });
    assert.strictEqual(own.statusCode, 201);
    // mesmo arquivo, outra organizacao: chaves de storage diferentes (isolamento)
    const sameBytes = jpeg();
    const a = await upload(adminA, orgA.id, (await createItem(adminA, { clientId: c1.id, title: 'Iso A', format: 'STORY' })).json().id, sameBytes);
    const b = await upload(adminB, orgB.id, own.json().id, sameBytes);
    const keyA = (await prisma.contentMedia.findFirstOrThrow({ where: { organizationId: orgA.id, sha256: a.json().versions[0].media[0].sha256 } })).storageKey;
    const keyB = (await prisma.contentMedia.findFirstOrThrow({ where: { organizationId: orgB.id, sha256: b.json().versions[0].media[0].sha256 } })).storageKey;
    assert.notStrictEqual(keyA, keyB);
    assert.ok(keyA.startsWith(`org/${orgA.id}/`) && keyB.startsWith(`org/${orgB.id}/`));
  });

  /* ------------------------------ 9. armazenamento nao configurado ------------------------------ */
  await t.test('9. Sem driver de storage configurado o upload e recusado com 503 (nada gravado)', async () => {
    const prev = process.env.FILE_STORAGE_DRIVER;
    process.env.FILE_STORAGE_DRIVER = 's3';
    try {
      const item = (await createItem(adminA, { clientId: c1.id, title: 'Sem storage', format: 'STORY' })).json();
      const res = await upload(adminA, orgA.id, item.id, jpeg());
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().code, 'STORAGE_NOT_CONFIGURED');
      assert.strictEqual(await prisma.contentMedia.count({ where: { itemId: item.id } }), 0);
    } finally {
      if (prev === undefined) delete process.env.FILE_STORAGE_DRIVER;
      else process.env.FILE_STORAGE_DRIVER = prev;
    }
  });
});
