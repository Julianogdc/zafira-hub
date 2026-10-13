import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';

/**
 * F6-IMP.7 — GET /clients/:id/deliverables (somente leitura).
 * Prova autenticação, permissão deliverables.view, escopo de cliente, isolamento por
 * organização, validação de período, ausência de plano sem dado inventado e tradução para o contrato.
 */
test('Entregas — leitura do plano por cliente e período (F6-IMP.7)', { concurrency: 1 }, async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = 'org_alpha_111';
  const orgB = 'org_beta_222';
  const adminA = 'usr_admin_a';
  const memberA = 'usr_member_a';
  const noPermA = 'usr_noperm_a';
  const adminB = 'usr_admin_b';
  const clientA = 'cli_alpha_assigned';
  const clientUnassigned = 'cli_alpha_unassigned';
  const SENTINEL = 'PLANO_SENTINELA_NAO_PODE_VAZAR';

  const original = {
    userFindUnique: prisma.user.findUnique,
    memberFindUnique: prisma.organizationMember.findUnique,
    rolePermFindUnique: (prisma as any).rolePermission.findUnique,
    clientFindFirst: prisma.client.findFirst,
    planFindFirst: (prisma as any).deliverablePlan.findFirst,
    eventFindMany: (prisma as any).deliverableEvent.findMany,
  };

  t.after(async () => {
    prisma.user.findUnique = original.userFindUnique;
    prisma.organizationMember.findUnique = original.memberFindUnique;
    (prisma as any).rolePermission.findUnique = original.rolePermFindUnique;
    prisma.client.findFirst = original.clientFindFirst;
    (prisma as any).deliverablePlan.findFirst = original.planFindFirst;
    (prisma as any).deliverableEvent.findMany = original.eventFindMany;
    await app.close();
  });

  const token = (sub: string, activeOrganizationId: string) =>
    (app as any).jwt.sign({ sub, email: `${sub}@zafira.test`, activeOrganizationId });

  const users: Record<string, { role: string; org: string; membershipId: string; denied?: boolean }> = {
    [adminA]: { role: 'ADMIN', org: orgA, membershipId: 'mem_admin_a' },
    [memberA]: { role: 'MEMBER', org: orgA, membershipId: 'mem_member_a' },
    [noPermA]: { role: 'MEMBER', org: orgA, membershipId: 'mem_noperm_a', denied: true },
    [adminB]: { role: 'ADMIN', org: orgB, membershipId: 'mem_admin_b' },
  };

  let planQueries: any[] = [];
  let eventQueries: any[] = [];
  let planToReturn: any = null;

  function setupMocks() {
    planQueries = [];
    eventQueries = [];

    prisma.user.findUnique = (async ({ where }: any) => {
      const u = users[where.id];
      if (!u) return null;
      return {
        id: where.id,
        name: where.id,
        email: `${where.id}@zafira.test`,
        status: 'ACTIVE',
        memberships: [
          { id: u.membershipId, role: u.role, status: 'ACTIVE', organizationId: u.org, organization: { id: u.org, slug: u.org } },
        ],
      };
    }) as any;

    prisma.organizationMember.findUnique = (async ({ where, include }: any) => {
      const { organizationId, userId } = where.organizationId_userId || {};
      const u = users[userId];
      if (!u || u.org !== organizationId) return null;
      const requested = include?.permissions?.where?.permissionCode;
      return {
        id: u.membershipId,
        organizationId,
        userId,
        role: u.role,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: u.denied && requested ? [{ permissionCode: requested, allowed: false }] : [],
      };
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const { role, permissionCode } = where.role_permissionCode || {};
      if (role === 'ADMIN') return { role, permissionCode, granted: true };
      if (role === 'MEMBER' && permissionCode === 'deliverables.view') return { role, permissionCode, granted: true };
      return null;
    }) as any;

    prisma.client.findFirst = (async ({ where }: any) => {
      const scope = where?.AND?.[0];
      const id = where?.AND?.[1]?.id;
      if (!scope || !id) return null;
      if (scope.organizationId !== orgA) return null; // clientes de teste pertencem à org A
      if (!scope.OR) return [clientA, clientUnassigned].includes(id) ? { id, name: id } : null; // ADMIN
      const direct = scope.OR[0]?.assignedMembers?.some?.organizationMemberId;
      if (id === clientA && (direct === 'mem_member_a' || direct === 'mem_noperm_a')) return { id, name: id };
      return null;
    }) as any;

    (prisma as any).deliverablePlan.findFirst = (async (args: any) => {
      planQueries.push(args);
      return planToReturn;
    }) as any;

    (prisma as any).deliverableEvent.findMany = (async (args: any) => {
      eventQueries.push(args);
      return planToReturn
        ? [
            {
              id: 'ev-1',
              organizationId: orgA,
              planId: planToReturn.id,
              itemId: null,
              eventType: 'TARGET_ADJUSTED',
              actorUserId: adminA,
              actorUser: { name: 'Admin A' },
              reason: 'Aditivo contratual assinado',
              before: { targetQuantity: 6 },
              after: { targetQuantity: 8 },
              createdAt: new Date('2026-10-05T12:00:00Z'),
            },
          ]
        : [];
    }) as any;
  }

  const samplePlan = () => ({
    id: 'plan-1',
    organizationId: orgA,
    clientId: clientA,
    period: '2026-10',
    title: SENTINEL,
    notes: 'Plano mensal de conteúdo',
    status: 'ACTIVE',
    targetCount: 8,
    closedAt: null,
    closedByUserId: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-05T12:00:00Z'),
    items: [
      {
        id: 'item-1',
        organizationId: orgA,
        planId: 'plan-1',
        title: 'Posts de feed',
        description: null,
        type: 'POST_FEED',
        targetQuantity: 8,
        deliveredQuantity: 5,
        status: 'IN_PROGRESS',
        isExtra: false,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        updatedAt: new Date('2026-10-05T12:00:00Z'),
        links: [
          {
            id: 'link-1',
            organizationId: orgA,
            itemId: 'item-1',
            type: 'ASANA_TASK',
            title: null,
            externalId: '1200000000001',
            targetUrl: 'https://app.asana.com/0/1/1200000000001',
            metadata: { section: 'Produção' },
            createdAt: new Date('2026-10-02T10:00:00Z'),
          },
        ],
        pieces: [
          {
            id: 'piece-1',
            organizationId: orgA,
            itemId: 'item-1',
            title: 'Carrossel de lançamento',
            format: 'CARROSSEL',
            stage: 'APPROVED',
            url: null,
            producedAt: new Date('2026-10-03T10:00:00Z'),
            producedByUser: { name: 'Member A' },
            approvedAt: new Date('2026-10-04T10:00:00Z'),
            approvedByUser: { name: 'Admin A' },
            deliveredAt: null,
            deliveredByUser: null,
            cancelledAt: null,
            createdAt: new Date('2026-10-03T10:00:00Z'),
            updatedAt: new Date('2026-10-04T10:00:00Z'),
          },
        ],
      },
    ],
  });

  const get = (url: string, sub?: string, org = orgA) =>
    app.inject({ method: 'GET', url, headers: sub ? { authorization: `Bearer ${token(sub, org)}` } : {} });

  await t.test('1. sem autenticação recebe 401 e não consulta entregas', async () => {
    setupMocks();
    planToReturn = samplePlan();
    for (const prefix of ['', '/api']) {
      const res = await get(`${prefix}/clients/${clientA}/deliverables?period=2026-10`);
      assert.strictEqual(res.statusCode, 401);
      assert.ok(!res.body.includes(SENTINEL));
    }
    assert.strictEqual(planQueries.length, 0);
  });

  await t.test('2. usuário sem deliverables.view recebe 403, mesmo com o cliente na carteira', async () => {
    setupMocks();
    planToReturn = samplePlan();
    const res = await get(`/clients/${clientA}/deliverables?period=2026-10`, noPermA);
    assert.strictEqual(res.statusCode, 403);
    assert.ok(!res.body.includes(SENTINEL));
    assert.strictEqual(planQueries.length, 0);
  });

  await t.test('3. MEMBER recebe 404 para cliente fora da carteira, sem consultar entregas', async () => {
    setupMocks();
    planToReturn = samplePlan();
    const res = await get(`/clients/${clientUnassigned}/deliverables?period=2026-10`, memberA);
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!res.body.includes(SENTINEL));
    assert.strictEqual(planQueries.length, 0);
  });

  await t.test('4. ADMIN de outra organização recebe 404 para cliente da organização A', async () => {
    setupMocks();
    planToReturn = samplePlan();
    const res = await get(`/clients/${clientA}/deliverables?period=2026-10`, adminB, orgB);
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!res.body.includes(SENTINEL));
    assert.strictEqual(planQueries.length, 0);
  });

  await t.test('5. período ausente ou inválido recebe 400', async () => {
    setupMocks();
    for (const query of ['', '?period=2026-13', '?period=10-2026', '?period=2026-1']) {
      const res = await get(`/clients/${clientA}/deliverables${query}`, adminA);
      assert.strictEqual(res.statusCode, 400, `query "${query}" deveria ser 400`);
    }
    assert.strictEqual(planQueries.length, 0);
  });

  await t.test('6. mês sem plano devolve plan: null (nunca um plano inventado)', async () => {
    setupMocks();
    planToReturn = null;
    const res = await get(`/clients/${clientA}/deliverables?period=2026-09`, memberA);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { plan: null, period: '2026-09', clientId: clientA });
    assert.strictEqual(eventQueries.length, 0);
  });

  await t.test('7. plano existente é filtrado pela organização da sessão e traduzido para o contrato', async () => {
    setupMocks();
    planToReturn = samplePlan();
    const res = await get(`/api/clients/${clientA}/deliverables?period=2026-10`, memberA);
    assert.strictEqual(res.statusCode, 200);

    // Isolamento: plano, itens, links e eventos consultados com o organizationId da sessão.
    assert.strictEqual(planQueries[0].where.organizationId, orgA);
    assert.strictEqual(planQueries[0].where.clientId, clientA);
    assert.strictEqual(planQueries[0].where.period, '2026-10');
    assert.strictEqual(planQueries[0].include.items.where.organizationId, orgA);
    assert.strictEqual(planQueries[0].include.items.include.links.where.organizationId, orgA);
    assert.strictEqual(planQueries[0].include.items.include.pieces.where.organizationId, orgA);
    assert.strictEqual(eventQueries[0].where.organizationId, orgA);

    const body = JSON.parse(res.body);
    assert.strictEqual(body.period, '2026-10');
    assert.strictEqual(body.plan.description, 'Plano mensal de conteúdo');
    assert.strictEqual(body.plan.items[0].serviceType, 'POST_FEED');
    assert.strictEqual(body.plan.items[0].links[0].linkType, 'ASANA_TASK');
    assert.strictEqual(body.plan.items[0].links[0].url, 'https://app.asana.com/0/1/1200000000001');
    assert.strictEqual(body.plan.items[0].links[0].title, 'Tarefa no Asana');
    assert.strictEqual(body.plan.events[0].actorName, 'Admin A');
    assert.strictEqual(body.plan.events[0].reason, 'Aditivo contratual assinado');
    assert.strictEqual(body.plan.createdAt, '2026-10-01T10:00:00.000Z');
    assert.deepStrictEqual(
      [body.plan.items[0].pieces[0].stage, body.plan.items[0].pieces[0].format, body.plan.items[0].pieces[0].producedByName, body.plan.items[0].pieces[0].approvedByName, body.plan.items[0].pieces[0].deliveredAt],
      ['APPROVED', 'CARROSSEL', 'Member A', 'Admin A', null]
    );
  });

  await t.test('8. não existem PUT/DELETE de Entregas (escritas da F6-IMP.7B são rotas próprias)', async () => {
    setupMocks();
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: `/clients/${clientA}/deliverables`,
        headers: { authorization: `Bearer ${token(adminA, orgA)}` },
        payload: { period: '2026-10', title: 'x' },
      });
      assert.strictEqual(res.statusCode, 404, `${method} não deveria existir`);
    }
  });
});
