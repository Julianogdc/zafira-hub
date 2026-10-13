import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

// --- GUARD DE SEGURANÇA (mesmo padrão de rbac-postgres.test.ts) ---
if (process.env.NODE_ENV === 'production') {
  throw new Error('NÃO É PERMITIDO EXECUTAR TESTES DE INTEGRAÇÃO EM PRODUÇÃO');
}
if (process.env.ZAFIRA_TEST_DATABASE !== '1') {
  throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatório para testes de integração');
}
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) {
  throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');
}

/**
 * F6-IMP.7B — Operação de Entregas (DEC-F6-002) contra PostgreSQL descartável real.
 * Sem Prisma simulado: sessão, permissões do banco (RBAC bootstrap), carteira, travas e transações reais.
 */
test('Integration Gate: Operação de Entregas (F6-IMP.7B) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const period = '2026-11';

  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-ops-a-${run}`, name: 'CI Operação Org A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-ops-b-${run}`, name: 'CI Operação Org B' } });
  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-ops-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');

  const clientA = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Operação A' } });
  const clientB = await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Cliente Operação B' } });
  await prisma.userClientAssignment.createMany({
    data: [
      { organizationId: orgA.id, organizationMemberId: memberA.member.id, clientId: clientA.id },
      { organizationId: orgA.id, organizationMemberId: managerA.member.id, clientId: clientA.id },
    ],
  });

  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const call = (who: { user: { id: string } }, org: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      cookies: { token: (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org }) },
      payload: payload as any,
    });
  const base = `/clients/${clientA.id}/deliverables`;

  let planId = '';
  let contentItemId = '';
  let adsItemId = '';

  await t.test('Plano: membro não cria (403); gestor cria com pacote de 12 conteúdos + 2 criativos; duplicado = 409', async () => {
    const body = {
      period,
      title: 'Plano de novembro',
      items: [
        { serviceType: 'CONTEUDO_SOCIAL', title: 'Conteúdos para redes', targetQuantity: 12 },
        { serviceType: 'CRIATIVO_ADS', title: 'Criativos para anúncios', targetQuantity: 2 },
      ],
    };
    const denied = await call(memberA, orgA.id, 'POST', base, body);
    assert.strictEqual(denied.statusCode, 403);

    const invalid = await call(managerA, orgA.id, 'POST', base, { ...body, items: [{ serviceType: 'POST_FEED', title: 'x', targetQuantity: 1 }] });
    assert.strictEqual(invalid.statusCode, 400, 'tipo fora da taxonomia');

    const created = await call(managerA, orgA.id, 'POST', base, body);
    assert.strictEqual(created.statusCode, 201, created.body);
    const plan = created.json().plan;
    assert.strictEqual(plan.status, 'ACTIVE');
    assert.strictEqual(plan.items.length, 2);
    planId = plan.id;
    contentItemId = plan.items.find((i: any) => i.serviceType === 'CONTEUDO_SOCIAL').id;
    adsItemId = plan.items.find((i: any) => i.serviceType === 'CRIATIVO_ADS').id;
    const db = await prisma.deliverablePlan.findUniqueOrThrow({ where: { id: planId } });
    assert.strictEqual(db.targetCount, 14);

    const dup = await call(adminA, orgA.id, 'POST', base, body);
    assert.strictEqual(dup.statusCode, 409);
  });

  await t.test('Isolamento: fora da carteira e outra organização recebem 404 e nada é gravado', async () => {
    const before = await prisma.deliverablePiece.count({ where: { organizationId: orgA.id } });
    const piece = { title: 'Tentativa', format: 'FEED' };
    const outsider = await call(outsiderA, orgA.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, piece);
    assert.strictEqual(outsider.statusCode, 404);
    const otherOrg = await call(adminB, orgB.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, piece);
    assert.strictEqual(otherOrg.statusCode, 404);
    // Cliente da Org B na URL com plano da Org A: plano não pertence ao cliente/organização.
    const mixed = await call(adminB, orgB.id, 'POST', `/clients/${clientB.id}/deliverables/${planId}/items/${contentItemId}/pieces`, piece);
    assert.strictEqual(mixed.statusCode, 404);
    const forged = await call(adminB, orgA.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, piece);
    assert.notStrictEqual(forged.statusCode, 201);
    assert.strictEqual(await prisma.deliverablePiece.count({ where: { organizationId: orgA.id } }), before);
  });

  let pieceId = '';
  await t.test('Peça: formato obrigatório no pacote e proibido em criativos; membro registra', async () => {
    const noFormat = await call(memberA, orgA.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, { title: 'Sem formato' });
    assert.strictEqual(noFormat.statusCode, 400);
    const adsWithFormat = await call(memberA, orgA.id, 'POST', `${base}/${planId}/items/${adsItemId}/pieces`, { title: 'Criativo', format: 'FEED' });
    assert.strictEqual(adsWithFormat.statusCode, 400);
    const badUrl = await call(memberA, orgA.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, { title: 'X', format: 'FEED', url: 'javascript:alert(1)' });
    assert.strictEqual(badUrl.statusCode, 400);

    const ok = await call(memberA, orgA.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, { title: 'Reels de lançamento', format: 'REELS' });
    assert.strictEqual(ok.statusCode, 201, ok.body);
    const item = ok.json().plan.items.find((i: any) => i.id === contentItemId);
    assert.strictEqual(item.pieces.length, 1);
    assert.strictEqual(item.pieces[0].stage, 'PRODUCED');
    assert.strictEqual(item.pieces[0].producedByName, 'CI member-a');
    assert.strictEqual(item.deliveredQuantity, 0);
    assert.strictEqual(item.status, 'IN_PROGRESS');
    pieceId = item.pieces[0].id;
  });

  await t.test('Etapas: só conta como entregue depois de aprovada e postada; clique duplo = 409', async () => {
    const url = `${base}/${planId}/pieces/${pieceId}/advance`;
    const [a, b] = await Promise.all([
      call(memberA, orgA.id, 'POST', url, { expectedStage: 'PRODUCED' }),
      call(memberA, orgA.id, 'POST', url, { expectedStage: 'PRODUCED' }),
    ]);
    assert.deepStrictEqual([a.statusCode, b.statusCode].sort(), [200, 409], 'apenas um dos cliques simultâneos avança');
    const approved = await prisma.deliverablePiece.findUniqueOrThrow({ where: { id: pieceId } });
    assert.strictEqual(approved.stage, 'APPROVED');
    assert.strictEqual(approved.approvedByUserId, memberA.user.id);
    let item = await prisma.deliverableItem.findUniqueOrThrow({ where: { id: contentItemId } });
    assert.strictEqual(item.deliveredQuantity, 0, 'aprovada ainda não é entregue');

    const posted = await call(memberA, orgA.id, 'POST', url, { expectedStage: 'APPROVED', url: 'https://instagram.com/p/exemplo' });
    assert.strictEqual(posted.statusCode, 200);
    item = await prisma.deliverableItem.findUniqueOrThrow({ where: { id: contentItemId } });
    assert.strictEqual(item.deliveredQuantity, 1);
    const piece = await prisma.deliverablePiece.findUniqueOrThrow({ where: { id: pieceId } });
    assert.strictEqual(piece.url, 'https://instagram.com/p/exemplo');

    const again = await call(memberA, orgA.id, 'POST', url, {});
    assert.strictEqual(again.statusCode, 409, 'entregue não avança');
  });

  await t.test('Voltar etapa e cancelar exigem justificativa e recalculam a contagem', async () => {
    const revertUrl = `${base}/${planId}/pieces/${pieceId}/revert`;
    assert.strictEqual((await call(memberA, orgA.id, 'POST', revertUrl, { reason: '' })).statusCode, 400);
    const reverted = await call(memberA, orgA.id, 'POST', revertUrl, { reason: 'Post apagado pelo cliente', expectedStage: 'DELIVERED' });
    assert.strictEqual(reverted.statusCode, 200);
    let item = await prisma.deliverableItem.findUniqueOrThrow({ where: { id: contentItemId } });
    assert.strictEqual(item.deliveredQuantity, 0);

    const cancelUrl = `${base}/${planId}/pieces/${pieceId}/cancel`;
    assert.strictEqual((await call(memberA, orgA.id, 'POST', cancelUrl, {})).statusCode, 400);
    const cancelled = await call(memberA, orgA.id, 'POST', cancelUrl, { reason: 'Cliente desistiu do tema' });
    assert.strictEqual(cancelled.statusCode, 200);
    item = await prisma.deliverableItem.findUniqueOrThrow({ where: { id: contentItemId } });
    assert.strictEqual(item.status, 'PENDING');
  });

  await t.test('Excedente: linha com meta 2 e 3 criativos entregues fica com 3 entregues (o 3º é extra na métrica)', async () => {
    for (let i = 1; i <= 3; i++) {
      const created = await call(memberA, orgA.id, 'POST', `${base}/${planId}/items/${adsItemId}/pieces`, { title: `Criativo ${i}` });
      assert.strictEqual(created.statusCode, 201);
      const id = created.json().plan.items.find((x: any) => x.id === adsItemId).pieces.at(-1).id;
      await call(memberA, orgA.id, 'POST', `${base}/${planId}/pieces/${id}/advance`, { expectedStage: 'PRODUCED' });
      const done = await call(memberA, orgA.id, 'POST', `${base}/${planId}/pieces/${id}/advance`, { expectedStage: 'APPROVED' });
      assert.strictEqual(done.statusCode, 200);
    }
    const item = await prisma.deliverableItem.findUniqueOrThrow({ where: { id: adsItemId } });
    assert.strictEqual(item.deliveredQuantity, 3);
    assert.strictEqual(item.status, 'DELIVERED');
  });

  await t.test('Meta: membro não ajusta (403); sem justificativa = 400; com justificativa grava histórico', async () => {
    const url = `${base}/${planId}/items/${contentItemId}/target`;
    assert.strictEqual((await call(memberA, orgA.id, 'PATCH', url, { newTargetQuantity: 8, reason: 'Novo contrato' })).statusCode, 403);
    assert.strictEqual((await call(managerA, orgA.id, 'PATCH', url, { newTargetQuantity: 8 })).statusCode, 400);
    const ok = await call(managerA, orgA.id, 'PATCH', url, { newTargetQuantity: 8, reason: 'Contrato reduzido para 8 conteúdos' });
    assert.strictEqual(ok.statusCode, 200);
    const ev = ok.json().plan.events.find((e: any) => e.eventType === 'TARGET_ADJUSTED');
    assert.strictEqual(ev.reason, 'Contrato reduzido para 8 conteúdos');
    assert.strictEqual(ev.actorName, 'CI manager-a');
    const db = await prisma.deliverablePlan.findUniqueOrThrow({ where: { id: planId } });
    assert.strictEqual(db.targetCount, 10);
  });

  await t.test('Linha extra: gestor acrescenta linha fora do contrato sem mudar a meta contratada', async () => {
    const res = await call(managerA, orgA.id, 'POST', `${base}/${planId}/items`, {
      serviceType: 'CAPTACAO',
      title: 'Captação extra de fotos',
      targetQuantity: 1,
      isExtra: true,
    });
    assert.strictEqual(res.statusCode, 201);
    const db = await prisma.deliverablePlan.findUniqueOrThrow({ where: { id: planId } });
    assert.strictEqual(db.targetCount, 10);
  });

  await t.test('Fechamento: membro não fecha; fechado não aceita peça; reabrir exige justificativa', async () => {
    assert.strictEqual((await call(memberA, orgA.id, 'POST', `${base}/${planId}/close`, {})).statusCode, 403);
    const closed = await call(managerA, orgA.id, 'POST', `${base}/${planId}/close`, {});
    assert.strictEqual(closed.statusCode, 200);
    assert.strictEqual(closed.json().plan.status, 'CLOSED');
    const blocked = await call(memberA, orgA.id, 'POST', `${base}/${planId}/items/${contentItemId}/pieces`, { title: 'Atrasada', format: 'FEED' });
    assert.strictEqual(blocked.statusCode, 409);
    assert.strictEqual((await call(managerA, orgA.id, 'POST', `${base}/${planId}/close`, {})).statusCode, 409);
    assert.strictEqual((await call(memberA, orgA.id, 'POST', `${base}/${planId}/reopen`, { reason: 'Correção' })).statusCode, 403);
    assert.strictEqual((await call(managerA, orgA.id, 'POST', `${base}/${planId}/reopen`, {})).statusCode, 400);
    const reopened = await call(managerA, orgA.id, 'POST', `${base}/${planId}/reopen`, { reason: 'Faltou registrar um post' });
    assert.strictEqual(reopened.statusCode, 200);
    assert.strictEqual(reopened.json().plan.status, 'ACTIVE');
  });

  await t.test('Histórico e auditoria: cada operação gravou evento e AuditLog com autor, só na Org A', async () => {
    const events = await prisma.deliverableEvent.findMany({ where: { organizationId: orgA.id } });
    const types = events.map((e) => e.eventType);
    for (const expected of ['PLAN_CREATED', 'PIECE_ADDED', 'PIECE_ADVANCED', 'PIECE_REVERTED', 'PIECE_CANCELLED', 'TARGET_ADJUSTED', 'ITEM_ADDED', 'PLAN_CLOSED', 'PLAN_REOPENED']) {
      assert.ok(types.includes(expected as any), `evento ${expected}`);
    }
    assert.ok(events.every((e) => e.planId === planId && e.actorUserId));
    const audits = await prisma.auditLog.findMany({ where: { organizationId: orgA.id, action: { startsWith: 'deliverables.' } } });
    assert.strictEqual(audits.length, events.length);
    assert.strictEqual(await prisma.deliverableEvent.count({ where: { organizationId: orgB.id } }), 0);
    assert.strictEqual(await prisma.auditLog.count({ where: { organizationId: orgB.id, action: { startsWith: 'deliverables.' } } }), 0);
  });
});
