import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { dashboardService, calculateDashboardDateRange } from '../dashboard.service.js';
import { MrrMetricSchema } from '@zafira/contracts';

test('Dashboard Admin Routes - Foundation, Resource Scope & Period Tests (F4.2A.1)', { concurrency: 1 }, async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalClientCount = prisma.client.count;
  const originalClientGroupBy = (prisma.client as any).groupBy;
  const originalClientFindMany = prisma.client.findMany;
  const originalClientFindFirst = prisma.client.findFirst;
  const originalAsaasPaymentFindMany = prisma.asaasPayment.findMany;
  const originalAsaasPaymentCount = prisma.asaasPayment.count;
  const originalOrganizationCount = prisma.organization.count;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    prisma.client.count = originalClientCount;
    (prisma.client as any).groupBy = originalClientGroupBy;
    prisma.client.findMany = originalClientFindMany;
    prisma.client.findFirst = originalClientFindFirst;
    prisma.asaasPayment.findMany = originalAsaasPaymentFindMany;
    prisma.asaasPayment.count = originalAsaasPaymentCount;
    prisma.organization.count = originalOrganizationCount;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgA = 'org_alpha_111';
  const orgB = 'org_beta_222';
  const adminUserId = 'usr_admin_owner';
  const managerUserId = 'usr_manager_scoped';
  const memberUserId = 'usr_regular_member';

  function setupAuthMocks() {
    // 1. Mock de User
    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === adminUserId || where.email === 'admin@zafira.test') {
        return {
          id: adminUserId,
          name: 'Admin User',
          email: 'admin@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_admin_alpha',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
            {
              id: 'mem_admin_beta',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: orgB,
              organization: { id: orgB, slug: 'org-beta' },
            },
          ],
        };
      }

      if (where.id === managerUserId || where.email === 'manager@zafira.test') {
        return {
          id: managerUserId,
          name: 'Manager User',
          email: 'manager@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_manager_alpha',
              role: 'MANAGER',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
          ],
        };
      }

      if (where.id === memberUserId || where.email === 'member@zafira.test') {
        return {
          id: memberUserId,
          name: 'Member User',
          email: 'member@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_regular',
              role: 'MEMBER',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
          ],
        };
      }

      return null;
    }) as any;

    // 2. Mock de OrganizationMember para resolver de autorização
    prisma.organizationMember.findUnique = (async ({ where, include }: any) => {
      const { organizationId_userId } = where;
      if (!organizationId_userId) return null;

      const { organizationId, userId } = organizationId_userId;
      const requestedPerm = include?.permissions?.where?.permissionCode;

      if (userId === adminUserId && (organizationId === orgA || organizationId === orgB)) {
        return {
          id: `mem_admin_${organizationId}`,
          organizationId,
          userId: adminUserId,
          role: 'ADMIN',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [], // herda defaults de ADMIN
        };
      }

      if (userId === managerUserId && organizationId === orgA) {
        const perms = [
          { permissionCode: 'admin.configure_metrics', allowed: true },
          { permissionCode: 'financial.view_summary', allowed: true },
        ];
        return {
          id: 'mem_manager_alpha',
          organizationId: orgA,
          userId: managerUserId,
          role: 'MANAGER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          // MANAGER com override de admin.configure_metrics e financial.view_summary
          permissions: requestedPerm ? perms.filter((p) => p.permissionCode === requestedPerm) : perms,
        };
      }

      if (userId === memberUserId && organizationId === orgA) {
        return {
          id: 'mem_regular_alpha',
          organizationId: orgA,
          userId: memberUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [], // sem overrides
        };
      }

      return null;
    }) as any;

    // 3. Mock de RolePermission (RBAC canônico padrão)
    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const { role_permissionCode } = where;
      if (!role_permissionCode) return null;
      const { role, permissionCode } = role_permissionCode;

      if (role === 'ADMIN') {
        if (
          permissionCode === 'admin.configure_metrics' ||
          permissionCode === 'financial.view_summary'
        ) {
          return { role, permissionCode, granted: true };
        }
      }

      return null;
    }) as any;
  }

  await t.test('A. ADMIN/contexto autorizado recebe 200 com payload estruturado', async () => {
    setupAuthMocks();

    prisma.client.count = (async ({ where }: any) => {
      if (where?.status === 'ACTIVE') {
        const orgInWhere = where.AND?.[0]?.organizationId || where.organizationId;
        assert.strictEqual(orgInWhere, orgA);
        return 3;
      }
      return 3;
    }) as any;

    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 3 } },
      { status: 'PAUSED', _count: { id: 1 } },
      { status: 'INACTIVE', _count: { id: 0 } },
      { status: 'LEAD', _count: { id: 2 } },
    ]) as any;

    prisma.client.findMany = (async () => [
      { contractValue: 5000 },
      { contractValue: 12000 },
      { contractValue: 3000 },
    ]) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary?period=30d',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.status, 'success');
    assert.ok(json.data);
    assert.strictEqual(json.data.activeClients.count, 3);
    assert.strictEqual(json.data.activeClients.source, 'HUB_REGISTERED');
    assert.strictEqual(json.data.mrr.available, true);
    assert.strictEqual(json.data.mrr.knownValue, 20000);
    assert.strictEqual(json.data.mrr.activeClientsCount, 3);
    assert.strictEqual(json.data.mrr.missingContractValueCount, 0);
    assert.strictEqual(json.data.mrr.isComplete, true);
    assert.strictEqual(json.data.mrr.source, 'HUB_CALCULATED');
    assert.strictEqual(json.data.clientsByStatus.active, 3);
    assert.strictEqual(json.data.clientsByStatus.paused, 1);
    assert.strictEqual(json.data.clientsByStatus.lead, 2);
    assert.strictEqual(json.data.clientsByStatus.total, 6);
    assert.strictEqual(json.data.financial.available, true);
    assert.strictEqual(typeof json.data.financial.receivedInPeriod, 'number');
    assert.strictEqual(json.data.financial.source, 'PROVIDER_DIRECT');
    assert.strictEqual(json.data.meta.organizationId, orgA);
    assert.strictEqual(json.data.meta.period, '30d');
  });

  await t.test('B. Usuário sem permissão administrativa (MEMBER) recebe 403', async () => {
    setupAuthMocks();

    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.error, 'forbidden');
  });

  await t.test('C. Credencial de máquina (x-api-key) não satisfaz permission humana e retorna 403', async () => {
    setupAuthMocks();
    process.env.HUB_INTERNAL_API_KEY = 'test_internal_key_machine';

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        'x-api-key': 'test_internal_key_machine',
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
  });

  await t.test('D. Usuário multi-org sem contexto explícito retorna 400 ORGANIZATION_CONTEXT_REQUIRED', async () => {
    setupAuthMocks();

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 400);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.error, 'ORGANIZATION_CONTEXT_REQUIRED');
  });

  await t.test('E e G. organizationId A nunca enxerga clientes da B (Tenant Isolation)', async () => {
    setupAuthMocks();

    let queriedOrgId: string | null = null;
    prisma.client.count = (async ({ where }: any) => {
      if (where?.status === 'ACTIVE') {
        queriedOrgId = where.AND?.[0]?.organizationId || where.organizationId;
        return queriedOrgId === orgB ? 42 : 1;
      }
      return 1;
    }) as any;

    (prisma.client as any).groupBy = (async () => []) as any;
    prisma.client.findMany = (async () => []) as any;
    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const tokenB = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgB });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queriedOrgId, orgB);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.activeClients.count, 42);
    assert.strictEqual(json.data.meta.organizationId, orgB);
  });

  await t.test('F. clientId cross-tenant falha fechado com 404 seguro', async () => {
    setupAuthMocks();

    prisma.client.findFirst = (async () => null) as any;

    const tokenA = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary?clientId=cli_alien_from_org_b',
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    assert.strictEqual(res.statusCode, 404);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 'CLIENT_NOT_FOUND');
  });

  await t.test('H, I e J. MRR: contractValue null NÃO vira zero silenciosamente e calcula missing count', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 3) as any;
    (prisma.client as any).groupBy = (async () => []) as any;

    prisma.client.findMany = (async () => [
      { contractValue: 8000 },
      { contractValue: null },
      { contractValue: 4000 },
    ]) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.mrr.available, true);
    assert.strictEqual(json.data.mrr.knownValue, 12000);
    assert.strictEqual(json.data.mrr.activeClientsCount, 3);
    assert.strictEqual(json.data.mrr.missingContractValueCount, 1);
    assert.strictEqual(json.data.mrr.isComplete, false);
  });

  await t.test('K. Zero real continua zero real (não se confunde com null)', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => []) as any;

    prisma.client.findMany = (async () => [
      { contractValue: 0 },
    ]) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.mrr.available, true);
    assert.strictEqual(json.data.mrr.knownValue, 0);
    assert.strictEqual(json.data.mrr.activeClientsCount, 1);
    assert.strictEqual(json.data.mrr.missingContractValueCount, 0);
    assert.strictEqual(json.data.mrr.isComplete, true);
  });

  await t.test('L. Distribuição real de clientes ACTIVE / PAUSED / INACTIVE / LEAD', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 10) as any;
    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 10 } },
      { status: 'PAUSED', _count: { id: 3 } },
      { status: 'INACTIVE', _count: { id: 5 } },
      { status: 'LEAD', _count: { id: 7 } },
    ]) as any;

    prisma.client.findMany = (async () => []) as any;
    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.clientsByStatus.active, 10);
    assert.strictEqual(json.data.clientsByStatus.paused, 3);
    assert.strictEqual(json.data.clientsByStatus.inactive, 5);
    assert.strictEqual(json.data.clientsByStatus.lead, 7);
    assert.strictEqual(json.data.clientsByStatus.total, 25);
    assert.strictEqual(json.data.clientsByStatus.source, 'HUB_CALCULATED');
  });

  await t.test('M. Dados financeiros não vazam quando usuário não possui financial.view_summary', async () => {
    setupAuthMocks();

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const { role_permissionCode } = where;
      if (role_permissionCode?.permissionCode === 'admin.configure_metrics') {
        return { role: 'ADMIN', permissionCode: 'admin.configure_metrics', granted: true };
      }
      return null;
    }) as any;

    prisma.client.count = (async () => 0) as any;
    (prisma.client as any).groupBy = (async () => []) as any;
    prisma.client.findMany = (async () => []) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.financial.available, false);
    assert.strictEqual(json.data.financial.receivedInPeriod, null);
    assert.strictEqual(json.data.financial.pending, null);
    assert.strictEqual(json.data.financial.overdue, null);
    assert.strictEqual(json.data.financial.overdueCount, null);
    assert.strictEqual(json.data.financial.reason, 'INSUFFICIENT_PERMISSIONS');
  });

  await t.test('N. Nenhum mock do protótipo aparece no payload', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 0) as any;
    (prisma.client as any).groupBy = (async () => []) as any;
    prisma.client.findMany = (async () => []) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const rawBody = res.body;
    assert.ok(!rawBody.includes('TechCorp'), 'Não deve conter TechCorp');
    assert.ok(!rawBody.includes('Mega Retail'), 'Não deve conter Mega Retail');
    assert.ok(!rawBody.includes('Startup XYZ'), 'Não deve conter Startup XYZ');
    assert.ok(!rawBody.includes('Global Industries'), 'Não deve conter Global Industries');
    assert.ok(!rawBody.includes('DATA_30D_ALL'), 'Não deve conter DATA_30D_ALL');
  });

  // =========================================================================
  // NOVOS TESTES OBRIGATÓRIOS DO PASSO F4.2A.1 (O, P, Q, R, S, T)
  // =========================================================================

  await t.test('O. MANAGER com override admin.configure_metrics passa pelo gate, mas aplica Resource Scope', async () => {
    setupAuthMocks();

    // Na Org A existem Cliente A1 (no scope do Manager) e Cliente A2 (fora do scope)
    // O Prisma groupBy e count devem receber a cláusula AND com o scopeWhere
    let capturedWhere: any = null;
    prisma.client.count = (async ({ where }: any) => {
      if (where?.status === 'ACTIVE') {
        capturedWhere = where;
        // Simula contagem no escopo restrito (apenas A1 ativo)
        return 1;
      }
      return 1;
    }) as any;

    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 1 } },
    ]) as any;

    prisma.client.findMany = (async () => [
      { contractValue: 1000 },
    ]) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(capturedWhere, 'Deve capturar a query');
    // Verifica se a query contém a estrutura de OR do buildClientResourceScopeWhere (assignedMembers / teamAssignments)
    assert.ok(capturedWhere.AND[0].OR, 'Cláusula AND[0] deve conter o resource scope com OR de assignments');
    assert.strictEqual(capturedWhere.AND[0].organizationId, orgA);

    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.activeClients.count, 1);
  });

  await t.test('P. Cliente da mesma organização porém fora do scope informado como clientId: 404 genérico', async () => {
    setupAuthMocks();

    // Mock: Cliente A2 existe na Org A, mas NÃO está no escopo do Manager
    prisma.client.findFirst = (async ({ where }: any) => {
      // where tem AND: [scopeWhere, { id: 'cli_a2_out_of_scope' }]
      // Como A2 não está no escopo do membro, findFirst retorna null
      return null;
    }) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary?clientId=cli_a2_out_of_scope',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 404);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 'CLIENT_NOT_FOUND');
    assert.strictEqual(json.message, 'Cliente não encontrado na organização');
  });

  await t.test('Q. MRR não inclui contractValue de cliente da mesma organização fora do scope', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => []) as any;

    // Simula que a busca de clientes ativos com contractValue filtrou pelo scope:
    // Retorna APENAS o Cliente A1 (contractValue 1000). Cliente A2 (5000) não entra!
    prisma.client.findMany = (async () => [
      { contractValue: 1000 },
    ]) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.mrr.available, true);
    assert.strictEqual(json.data.mrr.knownValue, 1000, 'MRR deve ser 1000 e NÃO 6000');
    assert.strictEqual(json.data.mrr.activeClientsCount, 1);
  });

  await t.test('R. clientsByStatus não inclui cliente fora do scope', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 1) as any;
    // Agregação retorna apenas 1 ativo no escopo
    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 1 } },
    ]) as any;

    prisma.client.findMany = (async () => []) as any;
    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.clientsByStatus.total, 1, 'Total de status deve conter apenas clientes do escopo');
    assert.strictEqual(json.data.clientsByStatus.active, 1);
  });

  await t.test('S. financial.view_summary=true não amplia resource scope financeiro', async () => {
    setupAuthMocks();

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => []) as any;

    // findMany retorna clientes do scope do Manager: apenas 'cli_a1'
    prisma.client.findMany = (async () => [
      { id: 'cli_a1', contractValue: 1000 },
    ]) as any;

    // AsaasPayment: deve receber query filtrando por clientId: { in: ['cli_a1'] }
    let capturedAsaasWhere: any = null;
    prisma.asaasPayment.findMany = (async ({ where }: any) => {
      capturedAsaasWhere = where;
      return [];
    }) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(capturedAsaasWhere, 'Deve capturar where do AsaasPayment');
    assert.deepStrictEqual(capturedAsaasWhere.clientId, { in: ['cli_a1'] }, 'Asaas deve ser restrito a cli_a1');
  });

  await t.test('T. financial.view_summary=false: getFinancialOverview NÃO é chamado', async () => {
    setupAuthMocks();

    // Revoga financial.view_summary para o Manager
    prisma.organizationMember.findUnique = (async ({ include }: any) => {
      const requestedPerm = include?.permissions?.where?.permissionCode;
      const perms = [
        { permissionCode: 'admin.configure_metrics', allowed: true },
        { permissionCode: 'financial.view_summary', allowed: false },
      ];
      return {
        id: 'mem_manager_no_fin',
        organizationId: orgA,
        userId: managerUserId,
        role: 'MANAGER',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: requestedPerm ? perms.filter((p) => p.permissionCode === requestedPerm) : perms,
      };
    }) as any;

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => []) as any;
    prisma.client.findMany = (async () => []) as any;

    let asaasCalled = false;
    prisma.asaasPayment.findMany = (async () => {
      asaasCalled = true;
      return [];
    }) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(asaasCalled, false, 'AsaasPayment.findMany NUNCA deve ser chamado quando financial.view_summary=false');
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.financial.available, false);
    assert.strictEqual(json.data.financial.reason, 'INSUFFICIENT_PERMISSIONS');
    assert.strictEqual(json.data.mrr.available, false, 'mrr.available deve ser false quando sem financial.view_summary');
    assert.strictEqual(json.data.mrr.knownValue, null);
    assert.strictEqual(json.data.mrr.reason, 'INSUFFICIENT_PERMISSIONS');
  });

  await t.test('U. Testes de Período Determinísticos (7d, 30d, 90d - Semântica de datas civis)', () => {
    const fixedNow = new Date('2026-10-15T12:00:00.000Z');

    const range7d = calculateDashboardDateRange('7d', fixedNow);
    const diffDays7d = Math.round((range7d.end.getTime() - range7d.start.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays7d, 6, '7 datas civis equivalem a 6 intervalos de dia');
    assert.strictEqual(range7d.start.toISOString().split('T')[0], '2026-10-09');
    assert.strictEqual(range7d.end.toISOString().split('T')[0], '2026-10-15');

    const range30d = calculateDashboardDateRange('30d', fixedNow);
    const diffDays30d = Math.round((range30d.end.getTime() - range30d.start.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays30d, 29, '30 datas civis equivalem a 29 intervalos de dia');
    assert.strictEqual(range30d.start.toISOString().split('T')[0], '2026-09-16');
    assert.strictEqual(range30d.end.toISOString().split('T')[0], '2026-10-15');

    const range90d = calculateDashboardDateRange('90d', fixedNow);
    const diffDays90d = Math.round((range90d.end.getTime() - range90d.start.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays90d, 89, '90 datas civis equivalem a 89 intervalos de dia');
    assert.strictEqual(range90d.start.toISOString().split('T')[0], '2026-07-18');
    assert.strictEqual(range90d.end.toISOString().split('T')[0], '2026-10-15');
  });

  await t.test('V. MANAGER com override porém com Resource Scope VAZIO retorna dados zerados fail-closed', async () => {
    setupAuthMocks();

    prisma.client.count = (async ({ where }: any) => {
      if (where?.status === 'ACTIVE') return 0;
      return 0;
    }) as any;

    (prisma.client as any).groupBy = (async () => []) as any;
    prisma.client.findMany = (async () => []) as any;

    let asaasCapturedWhere: any = null;
    prisma.asaasPayment.findMany = (async ({ where }: any) => {
      asaasCapturedWhere = where;
      return [];
    }) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);

    assert.strictEqual(json.data.activeClients.count, 0);
    assert.strictEqual(json.data.mrr.available, true);
    assert.strictEqual(json.data.mrr.knownValue, null);
    assert.strictEqual(json.data.mrr.activeClientsCount, 0);
    assert.strictEqual(json.data.clientsByStatus.total, 0);

    assert.strictEqual(json.data.financial.available, true);
    assert.strictEqual(json.data.financial.receivedInPeriod, 0);
    assert.strictEqual(json.data.financial.pending, 0);
    assert.strictEqual(json.data.financial.overdue, 0);
    assert.strictEqual(json.data.financial.overdueCount, 0);

    assert.ok(asaasCapturedWhere, 'Asaas deve ter sido consultado');
    assert.deepStrictEqual(asaasCapturedWhere.clientId, { in: [] }, 'clientId deve ser { in: [] } para escopo vazio');
  });

  await t.test('W. MANAGER com scope [A1] e query clientId=A1: interseção segura consulta somente A1', async () => {
    setupAuthMocks();

    prisma.client.findFirst = (async () => ({ id: 'cli_a1' })) as any;
    prisma.client.findMany = (async ({ select }: any) => {
      if (select?.contractValue) return [{ contractValue: 1500 }];
      return [{ id: 'cli_a1' }];
    }) as any;

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => [{ status: 'ACTIVE', _count: { id: 1 } }]) as any;

    let asaasCapturedWhere: any = null;
    prisma.asaasPayment.findMany = (async ({ where }: any) => {
      asaasCapturedWhere = where;
      return [
        {
          id: 'pay_a1_1',
          externalId: 'ext_1',
          value: 1500,
          netValue: 1450,
          status: 'RECEIVED',
          dueDate: new Date(),
          paymentDate: new Date(),
          clientPaymentDate: new Date(),
          clientId: 'cli_a1',
          client: { id: 'cli_a1', name: 'Cliente A1' },
        },
      ];
    }) as any;
    prisma.asaasPayment.count = (async () => 1) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary?clientId=cli_a1',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.data.financial.available, true);
    assert.strictEqual(json.data.financial.receivedInPeriod, 1500);

    assert.ok(asaasCapturedWhere);
    assert.strictEqual(asaasCapturedWhere.clientId, 'cli_a1');
  });

  await t.test('X. Semântica oficial 7d em 2026-10-04: HOJE + 6 dias anteriores (7 datas civis)', () => {
    const ref = new Date('2026-10-04T12:00:00.000Z');
    const { start, end } = calculateDashboardDateRange('7d', ref);

    assert.strictEqual(start.toISOString().split('T')[0], '2026-09-28');
    assert.strictEqual(end.toISOString().split('T')[0], '2026-10-04');

    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 6);
  });

  await t.test('Y. Semântica oficial 30d em 2026-10-04: HOJE + 29 dias anteriores (30 datas civis)', () => {
    const ref = new Date('2026-10-04T12:00:00.000Z');
    const { start, end } = calculateDashboardDateRange('30d', ref);

    assert.strictEqual(start.toISOString().split('T')[0], '2026-09-05');
    assert.strictEqual(end.toISOString().split('T')[0], '2026-10-04');

    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 29);
  });

  await t.test('Z. Semântica oficial 90d em 2026-10-04: HOJE + 89 dias anteriores (90 datas civis)', () => {
    const ref = new Date('2026-10-04T12:00:00.000Z');
    const { start, end } = calculateDashboardDateRange('90d', ref);

    assert.strictEqual(start.toISOString().split('T')[0], '2026-07-07');
    assert.strictEqual(end.toISOString().split('T')[0], '2026-10-04');

    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 89);
  });

  await t.test('AA. HARDENING F4.2A.3: MANAGER sem financial.view_summary NÃO deve receber MRR nem vazar contractValue', async () => {
    setupAuthMocks();

    // Revoga financial.view_summary para o Manager mantendo admin.configure_metrics=true
    prisma.organizationMember.findUnique = (async ({ include }: any) => {
      const requestedPerm = include?.permissions?.where?.permissionCode;
      const perms = [
        { permissionCode: 'admin.configure_metrics', allowed: true },
        { permissionCode: 'financial.view_summary', allowed: false },
      ];
      return {
        id: 'mem_manager_no_fin',
        organizationId: orgA,
        userId: managerUserId,
        role: 'MANAGER',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: requestedPerm ? perms.filter((p) => p.permissionCode === requestedPerm) : perms,
      };
    }) as any;

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 1 } },
    ]) as any;

    let contractValueQueried = false;
    prisma.client.findMany = (async ({ select }: any) => {
      if (select?.contractValue) {
        contractValueQueried = true;
        return [{ contractValue: 987654.32 }];
      }
      return [];
    }) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);

    // Assertivas de privacidade financeira rigorosas
    assert.strictEqual(contractValueQueried, false, 'Prisma Client NÃO deve ser consultado com select contractValue sem permissão financeira');
    assert.strictEqual(json.data.mrr.available, false, 'mrr.available deve ser false');
    assert.strictEqual(json.data.mrr.knownValue, null, 'mrr.knownValue deve ser estritamente null');
    assert.strictEqual(json.data.mrr.activeClientsCount, null, 'mrr.activeClientsCount deve ser null');
    assert.strictEqual(json.data.mrr.missingContractValueCount, null, 'mrr.missingContractValueCount deve ser null');
    assert.strictEqual(json.data.mrr.isComplete, null, 'mrr.isComplete deve ser null');
    assert.strictEqual(json.data.mrr.reason, 'INSUFFICIENT_PERMISSIONS', 'mrr.reason deve ser INSUFFICIENT_PERMISSIONS');
    assert.strictEqual(json.data.mrr.source, 'HUB_CALCULATED');
    assert.strictEqual(res.body.includes('987654.32'), false, 'Valor sentinela 987654.32 de contrato NUNCA deve aparecer no payload bruto');

    // Valida preservação das métricas não-financeiras e suas fontes canônicas
    assert.strictEqual(json.data.activeClients.count, 1, 'activeClients.count deve continuar disponível');
    assert.strictEqual(json.data.activeClients.source, 'HUB_REGISTERED', 'activeClients.source canônica deve ser estritamente HUB_REGISTERED');
    assert.strictEqual(json.data.clientsByStatus.active, 1, 'clientsByStatus deve continuar disponível');
    assert.strictEqual(json.data.financial.available, false, 'financial.available deve continuar false');
  });

  await t.test('AB. RECERTIFICAÇÃO F4.2A.3R: MrrMetricSchema rejeita estritamente sources que não sejam HUB_CALCULATED', () => {
    // 1. MrrMetricAvailable com source inválida
    const invalidAvailable1 = MrrMetricSchema.safeParse({
      available: true,
      knownValue: 1000,
      activeClientsCount: 1,
      missingContractValueCount: 0,
      isComplete: true,
      source: 'PROVIDER_DIRECT',
    });
    assert.strictEqual(invalidAvailable1.success, false, 'MrrMetricAvailable com PROVIDER_DIRECT deve ser rejeitado');

    const invalidAvailable2 = MrrMetricSchema.safeParse({
      available: true,
      knownValue: 1000,
      activeClientsCount: 1,
      missingContractValueCount: 0,
      isComplete: true,
      source: 'HUB_REGISTERED',
    });
    assert.strictEqual(invalidAvailable2.success, false, 'MrrMetricAvailable com HUB_REGISTERED deve ser rejeitado');

    // 2. MrrMetricUnavailable com source inválida
    const invalidUnavailable = MrrMetricSchema.safeParse({
      available: false,
      knownValue: null,
      activeClientsCount: null,
      missingContractValueCount: null,
      isComplete: null,
      reason: 'INSUFFICIENT_PERMISSIONS',
      source: 'PROVIDER_DIRECT',
    });
    assert.strictEqual(invalidUnavailable.success, false, 'MrrMetricUnavailable com PROVIDER_DIRECT deve ser rejeitado');

    // 3. Válidos com HUB_CALCULATED
    const validAvailable = MrrMetricSchema.safeParse({
      available: true,
      knownValue: 1000,
      activeClientsCount: 1,
      missingContractValueCount: 0,
      isComplete: true,
      source: 'HUB_CALCULATED',
    });
    assert.strictEqual(validAvailable.success, true, 'MrrMetricAvailable com HUB_CALCULATED deve ser aceito');

    const validUnavailable = MrrMetricSchema.safeParse({
      available: false,
      knownValue: null,
      activeClientsCount: null,
      missingContractValueCount: null,
      isComplete: null,
      reason: 'INSUFFICIENT_PERMISSIONS',
      source: 'HUB_CALCULATED',
    });
    assert.strictEqual(validUnavailable.success, true, 'MrrMetricUnavailable com HUB_CALCULATED deve ser aceito');
  });

  await t.test('AC. RECERTIFICAÇÃO F4.2A.3R: query.clientId é compulsoriamente aplicado ao where da consulta do MRR', async () => {
    setupAuthMocks();

    const allowedClientIds = ['cli_a1', 'cli_a2'];
    prisma.organizationMember.findUnique = (async ({ include }: any) => {
      const requestedPerm = include?.permissions?.where?.permissionCode;
      const perms = [
        { permissionCode: 'admin.configure_metrics', allowed: true },
        { permissionCode: 'financial.view_summary', allowed: true },
      ];
      return {
        id: 'mem_admin_fin',
        organizationId: orgA,
        userId: adminUserId,
        role: 'ADMIN',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: requestedPerm ? perms.filter((p) => p.permissionCode === requestedPerm) : perms,
      };
    }) as any;

    // findFirst valida se cli_a1 pertence ao scope
    prisma.client.findFirst = (async ({ where }: any) => {
      // Confirma que where contém cli_a1
      const isCliA1 = JSON.stringify(where).includes('cli_a1');
      if (isCliA1) {
        return { id: 'cli_a1' };
      }
      return null;
    }) as any;

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 1 } },
    ]) as any;

    let capturedContractQueryArgs: any = null;
    prisma.client.findMany = (async (args: any) => {
      if (args?.select?.contractValue) {
        capturedContractQueryArgs = args;
        // Simula banco aplicando o where rigorosamente: se o where pede cli_a1, só retorna cli_a1 (1500)
        // Se o where falhar e não filtrar, poderia retornar cli_a2 (999999)
        const whereStr = JSON.stringify(args.where);
        if (whereStr.includes('cli_a1')) {
          return [{ contractValue: 1500 }];
        }
        return [
          { contractValue: 1500 },
          { contractValue: 999999 },
        ];
      }
      return [];
    }) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary?clientId=cli_a1',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);

    // 1. Prova que a consulta de contractValue foi capturada e contém a restrição de cli_a1 no where
    assert.ok(capturedContractQueryArgs, 'A consulta com select: { contractValue: true } deve ter sido executada');
    assert.strictEqual(capturedContractQueryArgs.select.contractValue, true);
    assert.strictEqual(capturedContractQueryArgs.where.status, 'ACTIVE');

    // O where construído pelo serviço é { AND: [ scopeWhere, { id: 'cli_a1' } ], status: 'ACTIVE' }
    const andArray = capturedContractQueryArgs.where.AND;
    assert.ok(Array.isArray(andArray), 'where deve conter AND com clauses de escopo e clientId');
    const clientIdCondition = andArray.find((clause: any) => clause.id === 'cli_a1');
    assert.deepStrictEqual(clientIdCondition, { id: 'cli_a1' }, 'where deve conter cláusula { id: "cli_a1" }');

    // 2. Prova que cli_a2 (999999) NÃO entrou no cálculo e o MRR reflete somente cli_a1 (1500)
    assert.strictEqual(json.data.mrr.available, true);
    assert.strictEqual(json.data.mrr.knownValue, 1500, 'MRR deve ser 1500 (apenas cli_a1)');
    assert.strictEqual(json.data.mrr.activeClientsCount, 1);
    assert.strictEqual(json.data.mrr.isComplete, true);
    assert.strictEqual(json.data.mrr.source, 'HUB_CALCULATED');
    assert.strictEqual(res.body.includes('999999'), false, 'Valor 999999 do cliente cli_a2 fora do filtro NUNCA deve aparecer no payload');

    // 3. Prova metadados e activeClients
    assert.strictEqual(json.data.meta.clientId, 'cli_a1');
    assert.strictEqual(json.data.activeClients.source, 'HUB_REGISTERED');
  });

  await t.test('AD. F4.4A: clientOptions retorna apenas id e name, sem dados financeiros, respeita Resource Scope e preserva lista com query.clientId', async () => {
    setupAuthMocks();

    let capturedClientOptionsQueryArgs: any = null;

    // findFirst para validar existência de cliente no scope
    prisma.client.findFirst = (async ({ where }: any) => {
      const whereStr = JSON.stringify(where);
      if (whereStr.includes('cli_alpha')) {
        return { id: 'cli_alpha' };
      }
      return null;
    }) as any;

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => [
      { status: 'ACTIVE', _count: { id: 1 } },
    ]) as any;

    prisma.client.findMany = (async (args: any) => {
      // Captura a consulta de clientOptions (que seleciona id e name)
      if (args?.select?.id && args?.select?.name && !args?.select?.contractValue) {
        capturedClientOptionsQueryArgs = args;
        return [
          { id: 'cli_alpha', name: 'Alpha Corp' },
          { id: 'cli_beta', name: 'Beta Ltd' },
        ];
      }
      if (args?.select?.contractValue) {
        return [{ contractValue: 2000 }];
      }
      return [];
    }) as any;

    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    // Requisição filtrando por clientId=cli_alpha
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary?clientId=cli_alpha',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);

    // A & E) clientOptions contém opções mesmo com query.clientId ativo (não reduz para apenas cli_alpha)
    assert.ok(Array.isArray(json.data.clientOptions), 'clientOptions deve ser um array');
    assert.strictEqual(json.data.clientOptions.length, 2, 'clientOptions deve conter todos os clientes permitidos no Resource Scope');
    assert.deepStrictEqual(json.data.clientOptions, [
      { id: 'cli_alpha', name: 'Alpha Corp' },
      { id: 'cli_beta', name: 'Beta Ltd' },
    ]);

    // C & D) Nenhum clientOption contém contractValue ou campos confidenciais
    for (const opt of json.data.clientOptions) {
      assert.strictEqual(Object.keys(opt).sort().join(','), 'id,name', 'clientOption deve conter ESTRITAMENTE id e name');
      assert.strictEqual((opt as any).contractValue, undefined);
      assert.strictEqual((opt as any).document, undefined);
      assert.strictEqual((opt as any).email, undefined);
    }
    assert.strictEqual(capturedClientOptionsQueryArgs.select.contractValue, undefined);
    assert.deepStrictEqual(capturedClientOptionsQueryArgs.select, { id: true, name: true });
    assert.deepStrictEqual(capturedClientOptionsQueryArgs.orderBy, { name: 'asc' });

    // E) A consulta de clientOptions usa scopeWhere diretamente sem filtrar por query.clientId e sem deletedAt
    const whereClientOptions = capturedClientOptionsQueryArgs.where;
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(whereClientOptions, 'deletedAt'),
      false,
      'A cláusula where de clientOptions NÃO deve incluir a propriedade deletedAt'
    );
    assert.strictEqual(whereClientOptions.deletedAt, undefined);
    assert.deepStrictEqual(whereClientOptions, { organizationId: orgA }, 'where de clientOptions deve corresponder estritamente ao Resource Scope');
    const whereClientOptionsStr = JSON.stringify(whereClientOptions);
    assert.ok(!whereClientOptionsStr.includes('cli_alpha'), 'A consulta de clientOptions NÃO deve conter restrição de query.clientId');

    // F) query.clientId continua filtrando as métricas (meta reflete cli_alpha)
    assert.strictEqual(json.data.meta.clientId, 'cli_alpha');
  });

  await t.test('AE. F4.4A: MANAGER com escopo limitado recebe apenas clientes do seu scope em clientOptions; escopo vazio retorna []', async () => {
    setupAuthMocks();

    // 1. Manager com carteira [cli_m1]
    prisma.organizationMember.findUnique = (async ({ include }: any) => {
      const perms = [
        { permissionCode: 'admin.configure_metrics', allowed: true },
        { permissionCode: 'financial.view_summary', allowed: false },
      ];
      return {
        id: 'mem_manager_1',
        organizationId: orgA,
        userId: managerUserId,
        role: 'MANAGER',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: perms,
      };
    }) as any;

    // assignments do usuário
    (prisma as any).userClientAssignment = {
      findMany: async () => [{ clientId: 'cli_m1' }],
    };
    (prisma as any).teamMember = {
      findMany: async () => [],
    };
    (prisma as any).teamClientAssignment = {
      findMany: async () => [],
    };

    let scopeWhereCaptured: any = null;
    prisma.client.findMany = (async (args: any) => {
      if (args?.select?.id && args?.select?.name) {
        scopeWhereCaptured = args.where;
        // Simula retorno respeitando o where de escopo
        return [{ id: 'cli_m1', name: 'Manager Client Only' }];
      }
      return [];
    }) as any;

    prisma.client.count = (async () => 1) as any;
    (prisma.client as any).groupBy = (async () => [{ status: 'ACTIVE', _count: { id: 1 } }]) as any;
    prisma.asaasPayment.findMany = (async () => []) as any;
    prisma.asaasPayment.count = (async () => 0) as any;
    prisma.organization.count = (async () => 1) as any;

    const token = createToken({ sub: managerUserId, email: 'mgr@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const json = JSON.parse(res.body);

    assert.strictEqual(json.data.clientOptions.length, 1);
    assert.strictEqual(json.data.clientOptions[0].id, 'cli_m1');
    assert.strictEqual(json.data.clientOptions[0].name, 'Manager Client Only');

    // 2. Escopo vazio: manager sem nenhum cliente associado
    prisma.client.findMany = (async (args: any) => {
      return [];
    }) as any;
    prisma.client.count = (async () => 0) as any;
    (prisma.client as any).groupBy = (async () => []) as any;

    const resEmpty = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/admin/summary',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(resEmpty.statusCode, 200);
    const jsonEmpty = JSON.parse(resEmpty.body);
    assert.deepStrictEqual(jsonEmpty.data.clientOptions, []);
    assert.strictEqual(jsonEmpty.data.activeClients.count, 0);
  });
});
