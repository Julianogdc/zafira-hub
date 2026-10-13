import test from 'node:test';
import assert from 'node:assert';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
 * F8-2 (DEC-F8-004) - Aprovacao do cliente por link seguro contra PostgreSQL real.
 * Arquivos de teste: bytes aleatorios com assinatura valida. Nada de BrightBean/Asana.
 */
test('Integration Gate: Aprovacao do cliente por link (F8-2) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-approval-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-apr-a-${run}`, name: 'CI Aprovacao A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-apr-b-${run}`, name: 'CI Aprovacao B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-apr-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MANAGER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca Aprovacao' } });
  await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Marca B' } });
  for (const m of [managerA, memberA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }

  type Who = { user: { id: string } };
  const tokenOf = (who: Who, org: string) => (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org });
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, cookies: who ? { token: tokenOf(who, org) } : undefined, payload: payload as any });
  const A = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);
  const upload = (who: Who, itemId: string, data: Buffer) => {
    const boundary = `----zafira${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    return app.inject({
      method: 'POST',
      url: `/content/items/${itemId}/media`,
      cookies: { token: tokenOf(who, orgA.id) },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  };
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
  const publicView = (token: string) => app.inject({ method: 'POST', url: '/public/approval/view', payload: { token } });
  const publicDecide = (token: string, body: Record<string, unknown>, remoteAddress?: string) =>
    app.inject({ method: 'POST', url: '/public/approval/decision', payload: { token, ...body }, remoteAddress });
  const person = { approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true };

  const newItem = async (title: string, withFile = true) => {
    const created = await A(adminA, 'POST', '/content/items', { clientId: c1.id, title, format: 'FEED_IMAGE', caption: `Legenda publica ${run}` });
    assert.strictEqual(created.statusCode, 201, created.body);
    const id = created.json().id as string;
    if (withFile) assert.strictEqual((await upload(adminA, id, jpeg())).statusCode, 201);
    return id;
  };
  const sendLink = async (id: string, body: Record<string, unknown> = {}) => {
    const r = await A(adminA, 'POST', `/content/items/${id}/approval-links`, body);
    assert.strictEqual(r.statusCode, 201, r.body);
    return r.json() as { token: string; path: string; reissued: boolean; link: { id: string; expiresAt: string } };
  };

  /* ------------------------------ 1. envio ------------------------------ */
  let itemId = '';
  let token1 = '';
  await t.test('1. Envio: so quem tem content.send_to_client; conteudo completo; token so em hash; versao congela', async () => {
    itemId = await newItem('Peca principal', false);
    // incompleto
    const incomplete = await A(adminA, 'POST', `/content/items/${itemId}/approval-links`, {});
    assert.strictEqual(incomplete.statusCode, 409);
    assert.strictEqual(incomplete.json().code, 'CONTENT_INCOMPLETE');
    assert.strictEqual((await upload(adminA, itemId, jpeg())).statusCode, 201);
    // permissoes e carteira
    assert.strictEqual((await A(memberA, 'POST', `/content/items/${itemId}/approval-links`, {})).statusCode, 403, 'membro nao envia ao cliente');
    assert.strictEqual((await A(outsiderA, 'POST', `/content/items/${itemId}/approval-links`, {})).statusCode, 404, 'fora da carteira');
    assert.strictEqual((await call(adminB, orgB.id, 'POST', `/content/items/${itemId}/approval-links`, {})).statusCode, 404, 'outra organizacao');
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${itemId}/approval-links`, { expiresInDays: 90 })).statusCode, 400, 'validade acima de 30 dias');
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${itemId}/approval-links`, { channel: 'SMS' })).statusCode, 400);

    const sent = await A(managerA, 'POST', `/content/items/${itemId}/approval-links`, { recipientLabel: 'Maria (WhatsApp)', channel: 'WHATSAPP' });
    assert.strictEqual(sent.statusCode, 201, sent.body);
    const out = sent.json();
    token1 = out.token;
    assert.ok(token1.length >= 43, 'token com 256 bits');
    assert.strictEqual(out.path, `/aprovacao#${token1}`);
    assert.strictEqual(out.reissued, false);
    const days = (new Date(out.link.expiresAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7.01, `validade padrao de 7 dias (${days})`);
    // so o hash fica no banco
    const row = await prisma.approvalLink.findUniqueOrThrow({ where: { id: out.link.id } });
    assert.strictEqual(row.tokenHash, createHash('sha256').update(token1).digest('hex'));
    assert.ok(!JSON.stringify(row).includes(token1));
    // a consulta interna nunca devolve o token
    const status = await A(adminA, 'GET', `/content/items/${itemId}/approval`);
    assert.strictEqual(status.json().status, 'AWAITING_CLIENT');
    assert.ok(!status.body.includes(token1));
    assert.match(status.json().identificationNotice, /Não é identidade autenticada/);
    // a versao enviada nao pode mais mudar
    const edit = await A(adminA, 'PATCH', `/content/items/${itemId}`, { caption: 'mudou' });
    assert.strictEqual(edit.json().code, 'VERSION_FROZEN');
    assert.strictEqual((await upload(adminA, itemId, jpeg())).json().code, 'VERSION_FROZEN');
    const list = (await A(adminA, 'GET', '/content/items')).json().find((i: any) => i.id === itemId);
    assert.strictEqual(list.approvalStatus, 'AWAITING_CLIENT');
  });

  /* ------------------------------ 2. pagina publica ------------------------------ */
  let contentHash = '';
  await t.test('2. Pagina publica: sem sessao, so a versao autorizada, cabecalhos e midia assinada', async () => {
    const res = await publicView(token1);
    assert.strictEqual(res.statusCode, 200, res.body);
    const v = res.json();
    contentHash = v.contentHash;
    assert.strictEqual(v.status, 'PENDING');
    assert.strictEqual(v.brandName, 'CI Marca Aprovacao');
    assert.strictEqual(v.format, 'FEED_IMAGE');
    assert.strictEqual(v.caption, `Legenda publica ${run}`);
    assert.strictEqual(v.media.length, 1);
    // nada interno vaza
    for (const forbidden of ['Peca principal', itemId, orgA.id, c1.id, 'storageKey', 'sha256', 'asanaTaskGid', 'org/']) {
      assert.ok(!res.body.includes(forbidden), `nao deve expor ${forbidden}`);
    }
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.match(String(res.headers['x-robots-tag']), /noindex/);
    assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
    // midia: URL curta assinada
    const media = await app.inject({ method: 'GET', url: v.media[0].path });
    assert.strictEqual(media.statusCode, 200);
    assert.strictEqual(media.headers['content-type'], 'image/jpeg');
    assert.strictEqual(media.headers['cache-control'], 'no-store');
    assert.ok(media.rawPayload.length > 60);
    const tampered = v.media[0].path.slice(0, -2) + (v.media[0].path.endsWith('ab') ? 'cd' : 'ab');
    assert.strictEqual((await app.inject({ method: 'GET', url: tampered })).statusCode, 404);
    assert.strictEqual((await app.inject({ method: 'GET', url: '/public/approval/media?t=qualquer.coisa' })).statusCode, 404);
    assert.strictEqual((await app.inject({ method: 'GET', url: '/public/approval/media' })).statusCode, 404);
    // o endpoint interno de arquivo continua exigindo sessao
    assert.strictEqual((await app.inject({ method: 'GET', url: `/content/items/${itemId}/media/${randomUUID()}/file` })).statusCode, 401);
  });

  /* ------------------------------ 3. links indisponiveis ------------------------------ */
  await t.test('3. Link invalido, expirado e revogado respondem de forma IDENTICA', async () => {
    const unknown = await publicView(randomBytes(32).toString('base64url'));
    assert.strictEqual(unknown.statusCode, 404);
    const idB = await newItem('Para expirar');
    const exp = await sendLink(idB);
    await prisma.approvalLink.update({ where: { id: exp.link.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await publicView(exp.token);
    const idC = await newItem('Para revogar');
    const rev = await sendLink(idC);
    const revoked = await A(adminA, 'POST', `/content/items/${idC}/approval-links/${rev.link.id}/revoke`, { reason: 'enviado ao cliente errado' });
    assert.strictEqual(revoked.statusCode, 200, revoked.body);
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${idC}/approval-links/${rev.link.id}/revoke`, {})).statusCode, 409);
    const revokedView = await publicView(rev.token);
    for (const r of [expired, revokedView]) {
      assert.strictEqual(r.statusCode, unknown.statusCode);
      assert.strictEqual(r.body, unknown.body, 'mesma resposta, sem distinguir o motivo');
      assert.strictEqual(r.headers['cache-control'], 'no-store');
    }
    // nem decisao nem midia passam
    for (const tk of [exp.token, rev.token]) {
      const d = await publicDecide(tk, { decision: 'APPROVED', contentHash, ...person });
      assert.strictEqual(d.statusCode, 404);
      assert.strictEqual(d.body, unknown.body);
    }
    assert.strictEqual(await prisma.approvalDecision.count({ where: { itemId: { in: [idB, idC] } } }), 0);
    // o status interno distingue
    assert.strictEqual((await A(adminA, 'GET', `/content/items/${idB}/approval`)).json().status, 'LINK_EXPIRED');
    assert.strictEqual((await A(adminA, 'GET', `/content/items/${idC}/approval`)).json().status, 'LINK_REVOKED');
    // a validade nao pode ser estendida no banco
    await assert.rejects(prisma.approvalLink.update({ where: { id: exp.link.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } }), /approval_links_immutable/);
    await assert.rejects(prisma.approvalLink.update({ where: { id: rev.link.id }, data: { revokedAt: null } }), /approval_links_revoked/);
  });

  /* ------------------------------ 4. decisao ------------------------------ */
  await t.test('4. Decisao: validacoes, integridade, unica por versao e registro imutavel', async () => {
    const base = { contentHash };
    const noAuthority = await publicDecide(token1, { ...base, decision: 'APPROVED', ...person, authorityDeclared: false });
    assert.strictEqual(noAuthority.statusCode, 400);
    const noComment = await publicDecide(token1, { ...base, decision: 'CHANGES_REQUESTED', ...person });
    assert.strictEqual(noComment.statusCode, 400);
    assert.strictEqual(noComment.json().field, 'comment');
    const noName = await publicDecide(token1, { ...base, decision: 'APPROVED', ...person, approverName: ' ' });
    assert.strictEqual(noName.statusCode, 400);
    const wrongHash = await publicDecide(token1, { decision: 'APPROVED', contentHash: 'a'.repeat(64), ...person });
    assert.strictEqual(wrongHash.statusCode, 409);
    assert.strictEqual(wrongHash.json().code, 'INTEGRITY_MISMATCH');
    assert.strictEqual(await prisma.approvalDecision.count({ where: { itemId } }), 0, 'nenhuma decisao gravada pelas tentativas invalidas');

    const ok = await publicDecide(token1, { ...base, decision: 'CHANGES_REQUESTED', comment: 'Trocar a cor do fundo e revisar a legenda.', ...person });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(ok.json().status, 'CHANGES_REQUESTED');
    assert.strictEqual(ok.json().decision.approverName, 'Maria da Marca');
    const again = await publicDecide(token1, { ...base, decision: 'APPROVED', ...person });
    assert.strictEqual(again.statusCode, 409);
    assert.strictEqual(again.json().code, 'ALREADY_DECIDED');
    // a visualizacao mostra a resposta ja registrada
    assert.strictEqual((await publicView(token1)).json().status, 'CHANGES_REQUESTED');

    const st = (await A(adminA, 'GET', `/content/items/${itemId}/approval`)).json();
    assert.strictEqual(st.status, 'CHANGES_REQUESTED');
    assert.strictEqual(st.decisions.length, 1);
    assert.strictEqual(st.decisions[0].identificationLevel, 'N1');
    assert.strictEqual(st.decisions[0].authorityDeclared, true);
    assert.strictEqual(st.decisions[0].comment, 'Trocar a cor do fundo e revisar a legenda.');
    const events = (await A(adminA, 'GET', `/content/items/${itemId}`)).json().events.map((e: any) => e.type);
    assert.ok(events.includes('APPROVAL_LINK_CREATED') && events.includes('CLIENT_CHANGES_REQUESTED'));
    const dec = await prisma.approvalDecision.findFirstOrThrow({ where: { itemId } });
    assert.ok(dec.ipHash, 'evidencia tecnica minimizada (hash)');
    assert.ok(!JSON.stringify(dec).includes('127.0.0.1'));
    // banco: decisao imutavel, sem exclusao, unica por versao
    await assert.rejects(prisma.approvalDecision.update({ where: { id: dec.id }, data: { decision: 'APPROVED' } }), /approval_decisions_immutable/);
    await assert.rejects(prisma.approvalDecision.delete({ where: { id: dec.id } }), /content_history_protected/);
    await assert.rejects(
      prisma.approvalDecision.create({
        data: {
          organizationId: orgA.id, itemId, versionId: dec.versionId, linkId: dec.linkId, decision: 'APPROVED', approverName: 'Outra Pessoa',
          approverContact: 'x@y.test', authorityDeclared: true, channel: 'OTHER', identificationLevel: 'N1', contentHashAtDecision: contentHash,
        },
      }),
      /Unique constraint|approval_decisions_versionId_key|unique/i
    );
  });

  /* ------------------------------ 5. nova versao ------------------------------ */
  await t.test('5. Alteracao solicitada: nova versao, novo envio e nova aprovacao; versao anterior preservada', async () => {
    const resend = await A(adminA, 'POST', `/content/items/${itemId}/approval-links`, {});
    assert.strictEqual(resend.json().code, 'ALREADY_DECIDED', 'a versao decidida nao e reenviada');
    const nv = await A(adminA, 'POST', `/content/items/${itemId}/versions`);
    assert.strictEqual(nv.statusCode, 201, nv.body);
    assert.strictEqual(nv.json().currentVersionNumber, 2);
    assert.strictEqual((await A(adminA, 'GET', `/content/items/${itemId}/approval`)).json().status, 'NOT_SENT');
    const patched = await A(adminA, 'PATCH', `/content/items/${itemId}`, { caption: 'Legenda revisada v2' });
    assert.strictEqual(patched.statusCode, 200, patched.body);
    const sent = await sendLink(itemId, { expiresInDays: 30 });
    const view = (await publicView(sent.token)).json();
    assert.strictEqual(view.versionNumber, 2);
    assert.strictEqual(view.caption, 'Legenda revisada v2');
    assert.notStrictEqual(view.contentHash, contentHash);
    // o link antigo continua mostrando a v1 ja respondida (sem acesso a v2)
    const old = (await publicView(token1)).json();
    assert.strictEqual(old.versionNumber, 1);
    assert.strictEqual(old.status, 'CHANGES_REQUESTED');
    assert.notStrictEqual((await publicDecide(token1, { decision: 'APPROVED', contentHash: view.contentHash, ...person })).statusCode, 200);
    const ok = await publicDecide(sent.token, { decision: 'APPROVED', contentHash: view.contentHash, comment: 'Ok!', ...person });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(ok.json().status, 'APPROVED');
    const st = (await A(adminA, 'GET', `/content/items/${itemId}/approval`)).json();
    assert.strictEqual(st.status, 'APPROVED');
    assert.strictEqual(st.decisions.length, 2);
    assert.deepStrictEqual(st.decisions.map((d: any) => d.versionNumber).sort(), [1, 2]);
  });

  /* ------------------------------ 6. reemissao e concorrencia ------------------------------ */
  await t.test('6. Reemissao revoga o link anterior; decisoes concorrentes gravam so uma', async () => {
    const id = await newItem('Reemitido');
    const first = await sendLink(id);
    const second = await sendLink(id, { recipientLabel: 'Outra pessoa' });
    assert.strictEqual(second.reissued, true);
    assert.strictEqual((await publicView(first.token)).statusCode, 404, 'link anterior indisponivel');
    const active = await prisma.approvalLink.count({ where: { itemId: id, revokedAt: null } });
    assert.strictEqual(active, 1, 'um unico link ativo por versao (indice parcial)');
    const hash = (await publicView(second.token)).json().contentHash;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        publicDecide(second.token, { decision: i % 2 ? 'APPROVED' : 'CHANGES_REQUESTED', comment: 'comentario valido', contentHash: hash, ...person }, `10.0.0.${i + 10}`)
      )
    );
    assert.strictEqual(results.filter((r) => r.statusCode === 200).length, 1, results.map((r) => r.statusCode).join(','));
    assert.ok(results.filter((r) => r.statusCode !== 200).every((r) => r.statusCode === 409));
    assert.strictEqual(await prisma.approvalDecision.count({ where: { itemId: id } }), 1);
  });

  /* ------------------------------ 7. protecao no banco ------------------------------ */
  await t.test('7. Banco recusa decisao em link revogado/expirado e quando o conteudo mudou', async () => {
    const id = await newItem('Banco');
    const sent = await sendLink(id);
    const link = await prisma.approvalLink.findUniqueOrThrow({ where: { id: sent.link.id } });
    const data = {
      organizationId: orgA.id, itemId: id, versionId: link.versionId, linkId: link.id, decision: 'APPROVED' as const, approverName: 'Pessoa',
      approverContact: 'p@q.test', authorityDeclared: true, channel: 'OTHER' as const, identificationLevel: 'N1',
    };
    await assert.rejects(prisma.approvalDecision.create({ data: { ...data, contentHashAtDecision: 'f'.repeat(64) } }), /approval_integrity/);
    await assert.rejects(prisma.approvalDecision.create({ data: { ...data, authorityDeclared: false, contentHashAtDecision: link.contentHashAtSend } }), /approval_decisions_authority/);
    await assert.rejects(
      prisma.approvalDecision.create({ data: { ...data, decision: 'CHANGES_REQUESTED', comment: ' ', contentHashAtDecision: link.contentHashAtSend } }),
      /approval_decisions_comment_required/
    );
    await prisma.approvalLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(prisma.approvalDecision.create({ data: { ...data, contentHashAtDecision: link.contentHashAtSend } }), /approval_link_expired/);
    const id2 = await newItem('Banco 2');
    const s2 = await sendLink(id2);
    await A(adminA, 'POST', `/content/items/${id2}/approval-links/${s2.link.id}/revoke`, {});
    const l2 = await prisma.approvalLink.findUniqueOrThrow({ where: { id: s2.link.id } });
    await assert.rejects(
      prisma.approvalDecision.create({ data: { ...data, itemId: id2, versionId: l2.versionId, linkId: l2.id, contentHashAtDecision: l2.contentHashAtSend } }),
      /approval_link_revoked/
    );
    // link nao pode apontar para outra versao
    await assert.rejects(
      prisma.approvalDecision.create({ data: { ...data, itemId: id2, versionId: l2.versionId, linkId: link.id, contentHashAtDecision: l2.contentHashAtSend } }),
      /approval_link_mismatch/
    );
    await assert.rejects(prisma.approvalLink.update({ where: { id: l2.id }, data: { tokenHash: 'b'.repeat(64) } }), /approval_links_immutable/);
    await assert.rejects(prisma.approvalLink.delete({ where: { id: l2.id } }), /content_history_protected/);
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname IN ('approval_links_one_active_per_version','approval_links_tokenHash_key','content_media_active_position')`;
    assert.strictEqual(idx.length, 3);
  });

  /* ------------------------------ 8. isolamento ------------------------------ */
  await t.test('8. Isolamento: outra organizacao e fora da carteira nao veem nem revogam', async () => {
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/content/items/${itemId}/approval`)).statusCode, 404);
    const links = (await A(adminA, 'GET', `/content/items/${itemId}/approval`)).json().links;
    assert.strictEqual((await call(adminB, orgB.id, 'POST', `/content/items/${itemId}/approval-links/${links[0].id}/revoke`, {})).statusCode, 404);
    assert.strictEqual((await A(outsiderA, 'GET', `/content/items/${itemId}/approval`)).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', '/content/items')).json().length, 0);
    assert.strictEqual((await call(null, orgA.id, 'GET', `/content/items/${itemId}/approval`)).statusCode, 401);
  });

  /* ------------------------------ 9. limite de taxa ------------------------------ */
  await t.test('9. Limite de taxa nas rotas publicas', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 80; i++) statuses.push((await publicView(randomBytes(32).toString('base64url'))).statusCode);
    assert.ok(statuses.includes(429), 'excesso de tentativas deve ser limitado (429)');
    assert.ok(statuses.slice(0, 5).every((s) => s === 404));
  });
});
