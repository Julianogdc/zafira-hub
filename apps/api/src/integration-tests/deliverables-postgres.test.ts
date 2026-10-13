import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
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
 * F6-IMP.7A — GET /clients/:id/deliverables contra PostgreSQL descartável real.
 *
 * Sem simulação de Prisma: autenticação (JWT + usuário/membro no banco), permissão
 * (RolePermission + override de membro), Client Resource Scope e consultas de Entregas
 * rodam contra o banco com as migrations aplicadas.
 *
 * Prova: (1) isolamento entre organizações (planos, itens, eventos, templates, evidências);
 * (2) Client Resource Scope; (3) estado vazio real; (4) erro explícito em falha do repositório;
 * (5) leitura sem efeito colateral (as escritas da F6-IMP.7B têm teste próprio:
 *     deliverables-operations-postgres.test.ts).
 */
test('Integration Gate: Entregas (F6-IMP.7A) — leitura real em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const SENTINEL_B = `SENTINELA_ORG_B_${run}`;
  const period = '2026-10';

  const app: FastifyInstance = buildApp();
  await app.ready();

  // ---------- Fixtures (todas fictícias, prefixo único por execução) ----------
  const orgA = await prisma.organization.create({ data: { slug: `ci-deliv-a-${run}`, name: 'CI Entregas Org A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-deliv-b-${run}`, name: 'CI Entregas Org B' } });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({
      data: { name: `CI ${label}`, email: `ci-deliv-${label}-${run}@zafira.test` },
    });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };

  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const memberAssigned = await mkUser('member-assigned', orgA.id, 'MEMBER');
  const memberOutside = await mkUser('member-outside', orgA.id, 'MEMBER');
  const memberDenied = await mkUser('member-denied', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');

  const clientA = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente A com plano' } });
  const clientANoPlan = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente A sem plano' } });
  const clientB = await prisma.client.create({ data: { organizationId: orgB.id, name: `CI Cliente B ${SENTINEL_B}` } });

  // Carteira: memberAssigned e memberDenied atendem clientA; memberOutside não atende ninguém.
  await prisma.userClientAssignment.createMany({
    data: [
      { organizationId: orgA.id, organizationMemberId: memberAssigned.member.id, clientId: clientA.id },
      { organizationId: orgA.id, organizationMemberId: memberDenied.member.id, clientId: clientA.id },
    ],
  });
  // memberDenied tem deliverables.view negado explicitamente por override.
  await prisma.organizationMemberPermission.create({
    data: {
      organizationId: orgA.id,
      organizationMemberId: memberDenied.member.id,
      permissionCode: 'deliverables.view',
      allowed: false,
    },
  });

  const mkPlan = async (organizationId: string, clientId: string, tag: string, actorUserId: string) => {
    const plan = await prisma.deliverablePlan.create({
      data: { organizationId, clientId, period, title: `Plano ${tag}`, notes: `Notas ${tag}`, targetCount: 3 },
    });
    const item = await prisma.deliverableItem.create({
      data: { organizationId, planId: plan.id, title: `Item ${tag}`, type: 'POST_FEED', targetQuantity: 3, deliveredQuantity: 1, status: 'IN_PROGRESS' },
    });
    const extra = await prisma.deliverableItem.create({
      data: { organizationId, planId: plan.id, title: `Extra ${tag}`, type: 'REELS', targetQuantity: 1, deliveredQuantity: 1, isExtra: true, status: 'DELIVERED' },
    });
    await prisma.deliverableLink.create({
      data: { organizationId, itemId: item.id, type: 'ASANA_TASK', externalId: '1200000000001', targetUrl: 'https://app.asana.com/0/1/1200000000001', title: `Evidência ${tag}` },
    });
    await prisma.deliverableEvent.createMany({
      data: [
        { organizationId, planId: plan.id, eventType: 'PLAN_CREATED', actorUserId },
        { organizationId, itemId: item.id, eventType: 'TARGET_ADJUSTED', actorUserId, reason: `Justificativa ${tag}`, before: { targetQuantity: 2 }, after: { targetQuantity: 3 } },
      ],
    });
    await prisma.deliverableTemplate.create({
      data: { organizationId, name: `Template ${tag}`, defaultItems: [{ type: 'POST_FEED', targetQuantity: 3, note: tag }] },
    });
    return { plan, item, extra };
  };

  const planA = await mkPlan(orgA.id, clientA.id, 'A', adminA.user.id);
  await mkPlan(orgB.id, clientB.id, SENTINEL_B, adminB.user.id);

  t.after(async () => {
    // Remoção em cascata pela organização (planos, itens, links, eventos, templates, clientes, membros).
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const cookie = (userId: string, activeOrganizationId: string) => ({
    token: (app as any).jwt.sign({ sub: userId, email: 'ci@zafira.test', activeOrganizationId }),
  });
  const get = (userId: string, orgId: string, clientId: string, p = period, prefix = '') =>
    app.inject({
      method: 'GET',
      url: `${prefix}/clients/${clientId}/deliverables?period=${p}`,
      cookies: cookie(userId, orgId),
    });

  // Fotografia das tabelas de Entregas para provar ausência de escrita.
  // Restrita às organizações deste teste: outros arquivos de integração rodam em paralelo no mesmo banco.
  const snapshot = async () => {
    const orgs = [orgA.id, orgB.id];
    const rows = await prisma.$queryRaw<{ t: string; n: bigint; u: Date | null }[]>`
      SELECT 'plans' AS t, COUNT(*) AS n, MAX("updatedAt") AS u FROM deliverable_plans WHERE "organizationId" = ANY(${orgs})
      UNION ALL SELECT 'items', COUNT(*), MAX("updatedAt") FROM deliverable_items WHERE "organizationId" = ANY(${orgs})
      UNION ALL SELECT 'links', COUNT(*), MAX("updatedAt") FROM deliverable_links WHERE "organizationId" = ANY(${orgs})
      UNION ALL SELECT 'events', COUNT(*), MAX("createdAt") FROM deliverable_events WHERE "organizationId" = ANY(${orgs})
      UNION ALL SELECT 'templates', COUNT(*), MAX("updatedAt") FROM deliverable_templates WHERE "organizationId" = ANY(${orgs})
      UNION ALL SELECT 'pieces', COUNT(*), MAX("updatedAt") FROM deliverable_pieces WHERE "organizationId" = ANY(${orgs})`;
    return JSON.stringify(rows.map((r) => [r.t, Number(r.n), r.u ? r.u.toISOString() : null]));
  };
  const before = await snapshot();

  await t.test('Org A lê o próprio plano completo (itens, extras, evidências, eventos com autor)', async () => {
    const res = await get(adminA.user.id, orgA.id, clientA.id);
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.plan.id, planA.plan.id);
    assert.strictEqual(body.plan.organizationId, orgA.id);
    assert.strictEqual(body.plan.description, 'Notas A');
    assert.deepStrictEqual(
      body.plan.items.map((i: any) => [i.title, i.serviceType, i.isExtra]),
      [['Item A', 'POST_FEED', false], ['Extra A', 'REELS', true]]
    );
    assert.strictEqual(body.plan.items[0].links.length, 1);
    assert.strictEqual(body.plan.items[0].links[0].linkType, 'ASANA_TASK');
    assert.strictEqual(body.plan.items[0].links[0].url, 'https://app.asana.com/0/1/1200000000001');
    assert.strictEqual(body.plan.events.length, 2);
    assert.ok(body.plan.events.every((e: any) => e.organizationId === orgA.id));
    assert.ok(body.plan.events.every((e: any) => e.actorName === 'CI admin-a'));
    assert.ok(body.plan.events.some((e: any) => e.reason === 'Justificativa A'));
    // O mesmo resultado no prefixo /api.
    const viaApi = await get(adminA.user.id, orgA.id, clientA.id, period, '/api');
    assert.strictEqual(viaApi.statusCode, 200);
    assert.strictEqual(viaApi.json().plan.id, planA.plan.id);
  });

  await t.test('1. Org A não lê nada da Org B (plano, itens, eventos, templates, evidências)', async () => {
    // Admin A pedindo o cliente da Org B pelo ID.
    const cross = await get(adminA.user.id, orgA.id, clientB.id);
    assert.strictEqual(cross.statusCode, 404);
    assert.ok(!cross.body.includes(SENTINEL_B), 'nenhum dado da Org B pode aparecer na resposta');

    // Admin B forjando organização ativa A no token: não é membro de A.
    const forged = await get(adminB.user.id, orgA.id, clientA.id);
    assert.notStrictEqual(forged.statusCode, 200, `token com organização alheia deve ser recusado (veio ${forged.statusCode})`);
    assert.ok(!forged.body.includes('Plano A'));

    // A resposta legítima de A não contém nenhum dado de B nem templates.
    const own = await get(adminA.user.id, orgA.id, clientA.id);
    assert.ok(!own.body.includes(SENTINEL_B));
    assert.ok(!own.body.includes('Template'), 'a rota não expõe templates');
    assert.ok(!own.body.includes('defaultItems'));

    // E o simétrico: B lê o próprio plano e nada de A.
    const ownB = await get(adminB.user.id, orgB.id, clientB.id);
    assert.strictEqual(ownB.statusCode, 200);
    assert.strictEqual(ownB.json().plan.organizationId, orgB.id);
    assert.ok(!ownB.body.includes('Plano A') && !ownB.body.includes('Justificativa A'));
  });

  await t.test('2. Membro sem o cliente na carteira não lê Entregas; com o cliente na carteira, lê', async () => {
    const outside = await get(memberOutside.user.id, orgA.id, clientA.id);
    assert.strictEqual(outside.statusCode, 404);
    assert.ok(!outside.body.includes('Plano A'));

    const assigned = await get(memberAssigned.user.id, orgA.id, clientA.id);
    assert.strictEqual(assigned.statusCode, 200);
    assert.strictEqual(assigned.json().plan.id, planA.plan.id);

    // Membro com o cliente na carteira mas com deliverables.view negado: 403.
    const denied = await get(memberDenied.user.id, orgA.id, clientA.id);
    assert.strictEqual(denied.statusCode, 403);
    assert.ok(!denied.body.includes('Plano A'));

    // Sem sessão: 401.
    const anon = await app.inject({ method: 'GET', url: `/clients/${clientA.id}/deliverables?period=${period}` });
    assert.strictEqual(anon.statusCode, 401);
  });

  await t.test('3. Cliente sem plano retorna plan: null, sem número inventado', async () => {
    const res = await get(adminA.user.id, orgA.id, clientANoPlan.id);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), { plan: null, period, clientId: clientANoPlan.id });

    // Mês sem plano para um cliente que tem plano em outro mês: idem.
    const otherMonth = await get(adminA.user.id, orgA.id, clientA.id, '2026-09');
    assert.deepStrictEqual(otherMonth.json(), { plan: null, period: '2026-09', clientId: clientA.id });
  });

  await t.test('4. Falha do repositório retorna erro explícito, nunca dados', async () => {
    // Falha injetada só neste processo (o mesmo cliente Prisma usado pela API). Renomear a tabela
    // derrubava os outros arquivos de integração que rodam em paralelo no mesmo banco.
    const original = prisma.deliverablePlan.findFirst;
    (prisma.deliverablePlan as any).findFirst = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Falha simulada do banco', { code: 'P1001', clientVersion: 'ci' });
    };
    try {
      const res = await get(adminA.user.id, orgA.id, clientA.id);
      assert.strictEqual(res.statusCode, 500);
      const body = res.json();
      assert.strictEqual(body.status, 'error');
      assert.strictEqual(body.message, 'Não foi possível carregar o plano de entregas.');
      assert.ok(!('plan' in body), 'erro não pode trazer plano');
    } finally {
      (prisma.deliverablePlan as any).findFirst = original;
    }
    const after = await get(adminA.user.id, orgA.id, clientA.id);
    assert.strictEqual(after.statusCode, 200);
  });

  await t.test('5. Leitura não escreve no banco; PUT/DELETE não existem', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      for (const prefix of ['', '/api']) {
        const res = await app.inject({
          method,
          url: `${prefix}/clients/${clientA.id}/deliverables?period=${period}`,
          cookies: cookie(adminA.user.id, orgA.id),
          payload: method === 'DELETE' ? undefined : { title: 'tentativa', period },
        });
        assert.strictEqual(res.statusCode, 404, `${method} ${prefix}/clients/:id/deliverables não pode existir`);
      }
    }
    const after = await snapshot();
    assert.strictEqual(after, before, 'tabelas de Entregas não podem mudar com leituras');
  });
});
