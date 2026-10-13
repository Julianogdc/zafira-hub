import test from 'node:test';
import assert from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { currentPeriodInTimeZone } from '@zafira/domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

// --- GUARD DE SEGURANCA ---
if (process.env.NODE_ENV === 'production') throw new Error('NAO E PERMITIDO EXECUTAR TESTES DE INTEGRACAO EM PRODUCAO');
if (process.env.ZAFIRA_TEST_DATABASE !== '1') throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatorio para testes de integracao');
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');

/**
 * F8-3 (DEC-F8-007) - Contador de Entregas por estagio contra PostgreSQL real.
 * Contagem derivada dos registros da F8-1/F8-2; nenhuma escrita em Entregas; publicados = null.
 * D3: uma peca por conteudo e peca da mesma organizacao e cliente (servico e banco).
 */
test('Integration Gate: Contador de Entregas por estagio (F8-3) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.FILE_STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'zafira-stages-test-'));
  delete process.env.FILE_STORAGE_DRIVER;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-stg-a-${run}`, name: 'CI Estagios A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-stg-b-${run}`, name: 'CI Estagios B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-stg-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const noContentA = await mkUser('nocontent-a', orgA.id, 'MANAGER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MANAGER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Marca Estagios' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Outra Marca' } });
  const cB = await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Marca B' } });
  for (const m of [managerA, noContentA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }
  // sem content.view (excecao individual): ve Entregas, mas nao os contadores de conteudo
  await prisma.organizationMemberPermission.create({
    data: { organizationId: orgA.id, organizationMemberId: noContentA.member.id, permissionCode: 'content.view', allowed: false },
  });

  // Entregas: plano de c1 em 2026-09 (meta 5) com duas pecas; plano de c2 com uma peca
  const planPeriod = '2026-09';
  const plan1 = await prisma.deliverablePlan.create({
    data: { organizationId: orgA.id, clientId: c1.id, period: planPeriod, title: 'Plano CI', targetCount: 5 },
  });
  const line1 = await prisma.deliverableItem.create({
    data: { organizationId: orgA.id, planId: plan1.id, title: 'Posts', type: 'POST_FEED', targetQuantity: 5 },
  });
  const piece1 = await prisma.deliverablePiece.create({ data: { organizationId: orgA.id, itemId: line1.id, title: 'Peca 1' } });
  const piece2 = await prisma.deliverablePiece.create({ data: { organizationId: orgA.id, itemId: line1.id, title: 'Peca 2' } });
  const plan2 = await prisma.deliverablePlan.create({
    data: { organizationId: orgA.id, clientId: c2.id, period: planPeriod, title: 'Plano CI 2', targetCount: 1 },
  });
  const line2 = await prisma.deliverableItem.create({
    data: { organizationId: orgA.id, planId: plan2.id, title: 'Posts', type: 'POST_FEED', targetQuantity: 1 },
  });
  const pieceOther = await prisma.deliverablePiece.create({ data: { organizationId: orgA.id, itemId: line2.id, title: 'Peca outro cliente' } });

  type Who = { user: { id: string } };
  const tokenOf = (who: Who, org: string) => (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org });
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, cookies: who ? { token: tokenOf(who, org) } : undefined, payload: payload as any });
  const A = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);
  const upload = (itemId: string) => {
    const boundary = `----zafira${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const data = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
    return app.inject({
      method: 'POST',
      url: `/content/items/${itemId}/media`,
      cookies: { token: tokenOf(adminA, orgA.id) },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  };
  const person = { approverName: 'Maria da Marca', approverContact: 'maria@marca.test', authorityDeclared: true };
  const newItem = async (title: string, extra: Record<string, unknown> = {}) => {
    const r = await A(adminA, 'POST', '/content/items', { clientId: c1.id, title, format: 'FEED_IMAGE', caption: `Legenda ${run}`, ...extra });
    assert.strictEqual(r.statusCode, 201, r.body);
    return r.json().id as string;
  };
  const withFile = async (id: string) => {
    const r = await upload(id);
    assert.strictEqual(r.statusCode, 201, r.body);
    return r.json();
  };
  const sendLink = async (id: string) => {
    const r = await A(adminA, 'POST', `/content/items/${id}/approval-links`, {});
    assert.strictEqual(r.statusCode, 201, r.body);
    return r.json() as { token: string; link: { id: string } };
  };
  const decide = async (token: string, decision: 'APPROVED' | 'CHANGES_REQUESTED') => {
    const view = await app.inject({ method: 'POST', url: '/public/approval/view', payload: { token } });
    const body = { token, decision, contentHash: view.json().contentHash, ...person, ...(decision === 'CHANGES_REQUESTED' ? { comment: 'Trocar a foto.' } : {}) };
    const r = await app.inject({ method: 'POST', url: '/public/approval/decision', payload: body });
    assert.strictEqual(r.statusCode, 200, r.body);
  };
  const stages = (who: Who, org: string, clientId: string, period: string) =>
    call(who, org, 'GET', `/clients/${clientId}/deliverables/content-stages?period=${period}`);
  const deliverablesSnapshot = async () => ({
    plans: await prisma.deliverablePlan.findMany({ where: { organizationId: orgA.id }, select: { id: true, targetCount: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    items: await prisma.deliverableItem.findMany({ where: { organizationId: orgA.id }, select: { id: true, targetQuantity: true, deliveredQuantity: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    pieces: await prisma.deliverablePiece.findMany({ where: { organizationId: orgA.id }, select: { id: true, stage: true, approvedAt: true, deliveredAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    events: await prisma.deliverableEvent.count({ where: { organizationId: orgA.id } }),
  });
  const before = await deliverablesSnapshot();

  /* ------------------------------ 1. D3: vinculo ------------------------------ */
  let linkedId = '';
  await t.test('1. D3: uma peca por conteudo; peca da mesma organizacao e cliente (servico e banco)', async () => {
    linkedId = await newItem('Peca vinculada', { deliverablePieceId: piece1.id });
    const dup = await A(adminA, 'POST', '/content/items', { clientId: c1.id, title: 'Duplicada', format: 'FEED_IMAGE', deliverablePieceId: piece1.id });
    assert.strictEqual(dup.statusCode, 409, dup.body);
    assert.strictEqual(dup.json().code, 'PIECE_ALREADY_LINKED');
    const otherClient = await A(adminA, 'POST', '/content/items', { clientId: c1.id, title: 'Outro cliente', format: 'FEED_IMAGE', deliverablePieceId: pieceOther.id });
    assert.strictEqual(otherClient.statusCode, 400);
    assert.strictEqual(otherClient.json().code, 'PIECE_NOT_FOUND');
    // atualizacao: vincular a peca ja usada e recusado; trocar para peca livre e aceito; manter a propria e aceito
    const free = await newItem('Sem vinculo ainda');
    const taken = await A(adminA, 'PATCH', `/content/items/${free}`, { deliverablePieceId: piece1.id });
    assert.strictEqual(taken.statusCode, 409, taken.body);
    assert.strictEqual(taken.json().code, 'PIECE_ALREADY_LINKED');
    const okFree = await A(adminA, 'PATCH', `/content/items/${free}`, { deliverablePieceId: piece2.id });
    assert.strictEqual(okFree.statusCode, 200, okFree.body);
    const unlink = await A(adminA, 'PATCH', `/content/items/${free}`, { deliverablePieceId: null });
    assert.strictEqual(unlink.statusCode, 200, unlink.body);
    const wrongScope = await A(adminA, 'PATCH', `/content/items/${free}`, { deliverablePieceId: pieceOther.id });
    assert.strictEqual(wrongScope.statusCode, 400);
    // o banco garante o mesmo, mesmo sem passar pelo servico
    await assert.rejects(prisma.contentItem.update({ where: { id: free }, data: { deliverablePieceId: piece1.id } }));
    await assert.rejects(prisma.contentItem.update({ where: { id: free }, data: { deliverablePieceId: pieceOther.id } }), /content_piece_scope/);
    await assert.rejects(
      prisma.contentItem.create({ data: { organizationId: orgA.id, clientId: c1.id, title: 'Direto', format: 'FEED_IMAGE', deliverablePieceId: pieceOther.id } }),
      /content_piece_scope/
    );
  });

  /* ------------------------------ 2. contagem ------------------------------ */
  await t.test('2. Contagem cumulativa por estagio; versoes, reenvios, revogacao e arquivo removido sem duplicidade', async () => {
    // vinculado (competencia do plano): v1 com pedido de alteracao, v2 aprovada
    await withFile(linkedId);
    const s1 = await sendLink(linkedId);
    await decide(s1.token, 'CHANGES_REQUESTED');
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${linkedId}/versions`)).statusCode, 201);
    const s2 = await sendLink(linkedId);
    await decide(s2.token, 'APPROVED');

    // sem vinculo (competencia = mes do primeiro arquivo no fuso da organizacao)
    const received = await newItem('So recebido');
    const media = await withFile(received);
    const mediaId = media.versions[0].media[0].id as string;
    assert.strictEqual((await A(adminA, 'DELETE', `/content/items/${received}/media/${mediaId}`)).statusCode, 200);
    await newItem('Sem arquivo'); // nao conta em nenhum estagio
    const resent = await newItem('Reenviado e revogado');
    await withFile(resent);
    await sendLink(resent);
    const reissued = await sendLink(resent); // reemissao revoga o anterior
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${resent}/approval-links/${reissued.link.id}/revoke`, {})).statusCode, 200);
    const approvedThenNew = await newItem('Aprovado e nova versao');
    await withFile(approvedThenNew);
    await decide((await sendLink(approvedThenNew)).token, 'APPROVED');
    assert.strictEqual((await A(adminA, 'POST', `/content/items/${approvedThenNew}/versions`)).statusCode, 201);

    const current = currentPeriodInTimeZone('America/Sao_Paulo');
    const res = await stages(managerA, orgA.id, c1.id, current);
    assert.strictEqual(res.statusCode, 200, res.body);
    const out = res.json();
    assert.strictEqual(out.timeZone, 'America/Sao_Paulo');
    assert.deepStrictEqual(out.counts, { received: 3, sent: 2, approved: 1, published: null, publishedSource: 'NOT_INTEGRATED' });
    const byTitle = new Map(out.items.map((i: any) => [i.title, i]));
    assert.strictEqual((byTitle.get('So recebido') as any).stage, 'RECEIVED', 'arquivo removido continua recebido');
    assert.strictEqual((byTitle.get('Reenviado e revogado') as any).stage, 'SENT');
    assert.strictEqual((byTitle.get('Reenviado e revogado') as any).currentStatus, 'LINK_REVOKED');
    assert.strictEqual((byTitle.get('Aprovado e nova versao') as any).stage, 'APPROVED');
    assert.strictEqual((byTitle.get('Aprovado e nova versao') as any).currentStatus, 'NOT_SENT', 'nova versao em preparacao');
    assert.ok(!byTitle.has('Sem arquivo'));
    assert.ok(!byTitle.has('Peca vinculada'), 'vinculado conta na competencia do plano');
    for (const i of out.items) assert.strictEqual(i.periodSource, 'FIRST_FILE');

    const linked = (await stages(adminA, orgA.id, c1.id, planPeriod)).json();
    assert.deepStrictEqual(linked.counts, { received: 1, sent: 1, approved: 1, published: null, publishedSource: 'NOT_INTEGRATED' });
    assert.strictEqual(linked.items[0].periodSource, 'PLAN');
    assert.strictEqual(linked.items.length, 1, 'duas versoes e dois links: uma unica peca');

    // nada de midia, storage ou dados do aprovador na resposta
    const raw = res.body + JSON.stringify(linked);
    for (const forbidden of ['storageKey', 'approverName', 'approverContact', 'maria@marca.test', 'tokenHash', 'sha256']) {
      assert.ok(!raw.includes(forbidden), `resposta nao expoe ${forbidden}`);
    }
  });

  /* ------------------------------ 3. permissoes e isolamento ------------------------------ */
  await t.test('3. RBAC, carteira e isolamento entre organizacoes', async () => {
    const current = currentPeriodInTimeZone('America/Sao_Paulo');
    assert.strictEqual((await app.inject({ method: 'GET', url: `/clients/${c1.id}/deliverables/content-stages?period=${current}` })).statusCode, 401);
    assert.strictEqual((await stages(noContentA, orgA.id, c1.id, current)).statusCode, 403, 'sem content.view');
    assert.strictEqual((await stages(outsiderA, orgA.id, c1.id, current)).statusCode, 404, 'fora da carteira');
    const cross = await stages(adminB, orgB.id, c1.id, current);
    assert.strictEqual(cross.statusCode, 404, 'outra organizacao');
    const own = await stages(adminB, orgB.id, cB.id, current);
    assert.strictEqual(own.statusCode, 200);
    assert.deepStrictEqual(own.json().counts, { received: 0, sent: 0, approved: 0, published: null, publishedSource: 'NOT_INTEGRATED' });
    assert.strictEqual((await stages(adminA, orgA.id, c1.id, '2026-13')).statusCode, 400);
    assert.strictEqual((await stages(adminA, orgA.id, c1.id, 'outubro')).statusCode, 400);
    // tambem pelo prefixo /api
    assert.strictEqual((await A(adminA, 'GET', `/api/clients/${c1.id}/deliverables/content-stages?period=${current}`)).statusCode, 200);
  });

  /* ------------------------------ 4. Entregas intactas ------------------------------ */
  await t.test('4. Meta contratual, pecas e etapas manuais de Entregas intactas', async () => {
    assert.deepStrictEqual(await deliverablesSnapshot(), before);
  });
});
