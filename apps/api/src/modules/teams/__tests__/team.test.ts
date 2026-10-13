import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { teamService, TeamError, TeamService } from '../team.service.js';

test('Módulo de Equipes (Teams) - Testes de Unidade e HTTP', async (t) => {
  const previousApiKey = process.env.HUB_INTERNAL_API_KEY;
  process.env.HUB_INTERNAL_API_KEY = 'test-teams-internal-api-key';

  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalFindManyTeam = (prisma as any).team.findMany;
  const originalFindFirstTeam = (prisma as any).team.findFirst;
  const originalCreateTeam = (prisma as any).team.create;
  const originalUpdateTeam = (prisma as any).team.update;
  const originalDeleteManyTeamMember = (prisma as any).teamMember.deleteMany;
  const originalCreateManyTeamMember = (prisma as any).teamMember.createMany;
  const originalFindManyOrgMember = (prisma as any).organizationMember.findMany;
  const originalDeleteManyTeamClient = (prisma as any).teamClientAssignment.deleteMany;
  const originalCreateManyTeamClient = (prisma as any).teamClientAssignment.createMany;
  const originalFindManyClient = (prisma as any).client.findMany;
  const originalFindFirstClient = (prisma as any).client.findFirst;
  const originalCreateAudit = (prisma as any).auditLog.create;
  const originalTransaction = prisma.$transaction;

  const capturedAudits: any[] = [];

  t.after(async () => {
    process.env.HUB_INTERNAL_API_KEY = previousApiKey;
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    (prisma as any).team.findMany = originalFindManyTeam;
    (prisma as any).team.findFirst = originalFindFirstTeam;
    (prisma as any).team.create = originalCreateTeam;
    (prisma as any).team.update = originalUpdateTeam;
    (prisma as any).teamMember.deleteMany = originalDeleteManyTeamMember;
    (prisma as any).teamMember.createMany = originalCreateManyTeamMember;
    (prisma as any).organizationMember.findMany = originalFindManyOrgMember;
    (prisma as any).teamClientAssignment.deleteMany = originalDeleteManyTeamClient;
    (prisma as any).teamClientAssignment.createMany = originalCreateManyTeamClient;
    (prisma as any).client.findMany = originalFindManyClient;
    (prisma as any).client.findFirst = originalFindFirstClient;
    (prisma as any).auditLog.create = originalCreateAudit;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgId = 'org_teams_test';
  const adminUserId = 'usr_admin_teams';
  const managerUserId = 'usr_manager_teams';
  const memberUserId = 'usr_member_teams';

  const adminToken = createToken({ sub: adminUserId, email: 'admin@teams.test', activeOrganizationId: orgId });
  const managerToken = createToken({ sub: managerUserId, email: 'manager@teams.test', activeOrganizationId: orgId });
  const memberToken = createToken({ sub: memberUserId, email: 'member@teams.test', activeOrganizationId: orgId });

  // Setup basic mock resolver
  prisma.user.findUnique = (async ({ where }: any) => {
    if (where.id === adminUserId) {
      return {
        id: adminUserId,
        name: 'Admin Test',
        email: 'admin@teams.test',
        status: 'ACTIVE',
        memberships: [{ id: 'mem_admin', organizationId: orgId, role: 'ADMIN', status: 'ACTIVE', organization: { id: orgId, slug: 'org-teams' } }],
      };
    }
    if (where.id === managerUserId) {
      return {
        id: managerUserId,
        name: 'Manager Test',
        email: 'manager@teams.test',
        status: 'ACTIVE',
        memberships: [{ id: 'mem_manager', organizationId: orgId, role: 'MANAGER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-teams' } }],
      };
    }
    if (where.id === memberUserId) {
      return {
        id: memberUserId,
        name: 'Member Test',
        email: 'member@teams.test',
        status: 'ACTIVE',
        memberships: [{ id: 'mem_member', organizationId: orgId, role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-teams' } }],
      };
    }
    return null;
  }) as any;

  prisma.organizationMember.findUnique = (async ({ where }: any) => {
    const uid = where.organizationId_userId?.userId || where.id;
    if (uid === adminUserId || uid === 'mem_admin') {
      return {
        id: 'mem_admin',
        organizationId: orgId,
        userId: adminUserId,
        role: 'ADMIN',
        status: 'ACTIVE',
        organization: { id: orgId, slug: 'org-teams' },
        user: { id: adminUserId, name: 'Admin Test', email: 'admin@teams.test', status: 'ACTIVE' },
        permissions: [],
        clientAssignments: [],
      };
    }
    if (uid === managerUserId || uid === 'mem_manager') {
      return {
        id: 'mem_manager',
        organizationId: orgId,
        userId: managerUserId,
        role: 'MANAGER',
        status: 'ACTIVE',
        organization: { id: orgId, slug: 'org-teams' },
        user: { id: managerUserId, name: 'Manager Test', email: 'manager@teams.test', status: 'ACTIVE' },
        permissions: [],
        clientAssignments: [],
      };
    }
    if (uid === memberUserId || uid === 'mem_member') {
      return {
        id: 'mem_member',
        organizationId: orgId,
        userId: memberUserId,
        role: 'MEMBER',
        status: 'ACTIVE',
        organization: { id: orgId, slug: 'org-teams' },
        user: { id: memberUserId, name: 'Member Test', email: 'member@teams.test', status: 'ACTIVE' },
        permissions: [],
        clientAssignments: [],
      };
    }
    return null;
  }) as any;

  (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
    const role = where.role_permissionCode?.role;
    const perm = where.role_permissionCode?.permissionCode;
    if (role === 'ADMIN') {
      return { role: 'ADMIN', permissionCode: perm };
    }
    if (role === 'MANAGER' && perm === 'teams.view') {
      return { role: 'MANAGER', permissionCode: 'teams.view' };
    }
    if (role === 'MEMBER' && perm === 'clients.view') {
      return { role: 'MEMBER', permissionCode: 'clients.view' };
    }
    return null;
  }) as any;

  prisma.$transaction = (async (fn: any) => fn(prisma)) as any;
  (prisma as any).auditLog.create = (async (args: any) => {
    capturedAudits.push(args);
    return { id: `aud_${capturedAudits.length}` };
  }) as any;

  await t.test('1. GET /api/v1/teams sem autenticação retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/teams',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('2. API Key de máquina (x-api-key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/teams',
      headers: {
        'x-api-key': 'test-teams-internal-api-key',
        'x-organization-id': orgId,
      },
    });
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
  });

  await t.test('3. MEMBER sem teams.view retorna 403 FORBIDDEN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/teams',
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
    });
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'forbidden');
  });

  await t.test('4. MANAGER com teams.view retorna 200 e lista equipes', async () => {
    (prisma as any).team.findMany = (async () => [
      {
        id: 'team_1',
        name: 'Squad Alpha',
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        _count: { members: 2, clientAssignments: 3 },
      },
    ]) as any;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/teams',
      headers: {
        authorization: `Bearer ${managerToken}`,
      },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.length, 1);
    assert.strictEqual(body.data[0].name, 'Squad Alpha');
    assert.strictEqual(body.data[0].memberCount, 2);
    assert.strictEqual(body.data[0].clientCount, 3);
  });

  await t.test('5. MANAGER sem teams.manage tentando POST /api/v1/teams retorna 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: {
        authorization: `Bearer ${managerToken}`,
      },
      payload: {
        name: 'Squad Proibido',
      },
    });
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'forbidden');
  });

  await t.test('6. ADMIN com teams.manage cria equipe (POST /api/v1/teams) retorna 201 e grava AuditLog com actorUserId', async () => {
    capturedAudits.length = 0;
    (prisma as any).team.create = (async () => ({
      id: 'team_created_1',
      name: 'Squad Growth',
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      _count: { members: 0, clientAssignments: 0 },
    })) as any;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: 'Squad Growth',
      },
    });
    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.name, 'Squad Growth');

    // Asserção do AuditLog
    assert.strictEqual(capturedAudits.length, 1);
    const audit = capturedAudits[0].data;
    assert.strictEqual(audit.organizationId, orgId);
    assert.strictEqual(audit.actorUserId, adminUserId, 'actorUserId deve ser exatamente o id do usuário autenticado');
    assert.notStrictEqual(audit.actorUserId, null);
    assert.strictEqual(audit.action, 'team.created');
    assert.strictEqual(audit.entityType, 'Team');
  });

  await t.test('7. POST /api/v1/teams com payload inválido retorna 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: '   ',
      },
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.code, 'VALIDATION_ERROR');
  });

  await t.test('8. PUT /api/v1/teams/:teamId/members atualiza membros e grava AuditLog com actorUserId', async () => {
    capturedAudits.length = 0;
    (prisma as any).team.findFirst = (async () => ({ id: 'team_1', organizationId: orgId })) as any;
    (prisma as any).organizationMember.findMany = (async () => [{ id: 'mem_admin' }, { id: 'mem_manager' }]) as any;
    (prisma as any).teamMember.deleteMany = (async () => ({ count: 1 })) as any;
    (prisma as any).teamMember.createMany = (async () => ({ count: 2 })) as any;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/team_1/members',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        membershipIds: ['mem_admin', 'mem_manager'],
      },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');

    assert.strictEqual(capturedAudits.length, 1);
    const audit = capturedAudits[0].data;
    assert.strictEqual(audit.organizationId, orgId);
    assert.strictEqual(audit.actorUserId, adminUserId, 'actorUserId deve ser preenchido');
    assert.strictEqual(audit.action, 'team.members_changed');
  });

  await t.test('9. PUT /api/v1/teams/:teamId/clients atualiza clientes e grava AuditLog com actorUserId', async () => {
    capturedAudits.length = 0;
    (prisma as any).team.findFirst = (async () => ({ id: 'team_1', organizationId: orgId })) as any;
    (prisma as any).client.findMany = (async () => [{ id: 'cli_1' }, { id: 'cli_2' }]) as any;
    (prisma as any).teamClientAssignment.deleteMany = (async () => ({ count: 1 })) as any;
    (prisma as any).teamClientAssignment.createMany = (async () => ({ count: 2 })) as any;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/team_1/clients',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        clientIds: ['cli_1', 'cli_2'],
      },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');

    assert.strictEqual(capturedAudits.length, 1);
    const audit = capturedAudits[0].data;
    assert.strictEqual(audit.organizationId, orgId);
    assert.strictEqual(audit.actorUserId, adminUserId, 'actorUserId deve ser preenchido');
    assert.strictEqual(audit.action, 'team.clients_changed');
  });

  await t.test('10. PATCH /api/v1/teams/:teamId atualiza equipe e grava AuditLog com actorUserId', async () => {
    capturedAudits.length = 0;
    (prisma as any).team.findFirst = (async () => ({ id: 'team_1', name: 'Old Name', isActive: true, organizationId: orgId, _count: { members: 0, clientAssignments: 0 } })) as any;
    (prisma as any).team.update = (async () => ({ id: 'team_1', name: 'New Name', isActive: false, createdAt: new Date(), updatedAt: new Date(), _count: { members: 0, clientAssignments: 0 } })) as any;

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/teams/team_1',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: 'New Name',
        isActive: false,
      },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');

    assert.strictEqual(capturedAudits.length, 1);
    const audit = capturedAudits[0].data;
    assert.strictEqual(audit.organizationId, orgId);
    assert.strictEqual(audit.actorUserId, adminUserId);
    assert.strictEqual(audit.action, 'team.updated');
  });

  await t.test('11. Team NÃO concede permission via HTTP: MEMBER em Team com Client X, mas com override clients.view=false, recebe 403 ao fazer GET /clients/:id', async () => {
    // Configura override individual clients.view = false para o membro
    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const uid = where.organizationId_userId?.userId || where.id;
      if (uid === memberUserId || uid === 'mem_member') {
        return {
          id: 'mem_member',
          organizationId: orgId,
          userId: memberUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          organization: { id: orgId, slug: 'org-teams' },
          user: { id: memberUserId, name: 'Member Test', email: 'member@teams.test', status: 'ACTIVE' },
          permissions: [
            {
              permissionCode: 'clients.view',
              allowed: false, // Override individual explícito de negação
            },
          ],
          clientAssignments: [],
        };
      }
      return null;
    }) as any;

    // Executa GET /clients/cli_team_x
    const res = await app.inject({
      method: 'GET',
      url: '/clients/cli_team_x',
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
    });

    // Deve ser bloqueado pelo middleware requirePermission('clients.view') com 403 FORBIDDEN
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'forbidden');
    assert.strictEqual(body.message, 'Permissao insuficiente para executar esta acao');
  });
});
