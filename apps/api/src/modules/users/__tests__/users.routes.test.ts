import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';

test('Users Routes - HTTP Integration Tests', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindManyMember = prisma.organizationMember.findMany;
  const originalFindManyPerm = (prisma as any).permission.findMany;
  const originalFindManyRolePerm = (prisma as any).rolePermission.findMany;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalCreateUser = prisma.user.create;
  const originalCreateMember = prisma.organizationMember.create;
  const originalUpdateMember = prisma.organizationMember.update;
  const originalDeleteMember = prisma.organizationMember.delete;
  const originalUpsertMemberPerm = (prisma as any).organizationMemberPermission.upsert;
  const originalDeleteManyMemberPerm = (prisma as any).organizationMemberPermission.deleteMany;
  const originalFindManyMemberPerm = (prisma as any).organizationMemberPermission.findMany;
  const originalCreateManyUserClient = (prisma as any).userClientAssignment.createMany;
  const originalDeleteManyUserClient = (prisma as any).userClientAssignment.deleteMany;
  const originalFindManyClient = (prisma as any).client.findMany;
  const originalUpdateManyClient = (prisma as any).client.updateMany;
  const originalCreateAudit = (prisma as any).auditLog.create;
  const originalTransaction = prisma.$transaction;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    prisma.organizationMember.findMany = originalFindManyMember;
    (prisma as any).permission.findMany = originalFindManyPerm;
    (prisma as any).rolePermission.findMany = originalFindManyRolePerm;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    prisma.user.create = originalCreateUser;
    prisma.organizationMember.create = originalCreateMember;
    prisma.organizationMember.update = originalUpdateMember;
    prisma.organizationMember.delete = originalDeleteMember;
    (prisma as any).organizationMemberPermission.upsert = originalUpsertMemberPerm;
    (prisma as any).organizationMemberPermission.deleteMany = originalDeleteManyMemberPerm;
    (prisma as any).organizationMemberPermission.findMany = originalFindManyMemberPerm;
    (prisma as any).userClientAssignment.createMany = originalCreateManyUserClient;
    (prisma as any).userClientAssignment.deleteMany = originalDeleteManyUserClient;
    (prisma as any).client.findMany = originalFindManyClient;
    (prisma as any).client.updateMany = originalUpdateManyClient;
    (prisma as any).auditLog.create = originalCreateAudit;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgId = 'org_alpha';
  const adminUserId = 'usr_admin';
  const memberUserId = 'usr_member';

  function setupAuthMocks() {
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === adminUserId || where.email === 'admin@zafira.test') {
        return {
          id: adminUserId,
          name: 'Admin Test',
          email: 'admin@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_admin',
              role: 'ADMIN',
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-alpha' },
            },
          ],
        };
      }
      if (where.id === memberUserId || where.email === 'member@zafira.test') {
        return {
          id: memberUserId,
          name: 'Member Test',
          email: 'member@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_member',
              role: 'MEMBER',
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-alpha' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const targetOrg = where.organizationId_userId?.organizationId || where.organizationId_id?.organizationId;
      const targetUser = where.organizationId_userId?.userId;
      const targetId = where.organizationId_id?.id || where.id;

      if (targetUser === adminUserId || targetId === 'mem_admin') {
        return {
          id: 'mem_admin',
          organizationId: orgId,
          userId: adminUserId,
          role: 'ADMIN',
          status: 'ACTIVE',
          user: { id: adminUserId, name: 'Admin Test', email: 'admin@zafira.test', status: 'ACTIVE' },
          permissions: [],
          clientAssignments: [],
        };
      }
      if (targetUser === memberUserId || targetId === 'mem_member') {
        return {
          id: 'mem_member',
          organizationId: orgId,
          userId: memberUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { id: memberUserId, name: 'Member Test', email: 'member@zafira.test', status: 'ACTIVE' },
          permissions: [],
          clientAssignments: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      // ADMIN tem todas as permissões concedidas por default
      if (where.role_permissionCode.role === 'ADMIN') {
        return {
          role: 'ADMIN',
          permissionCode: where.role_permissionCode.permissionCode,
        };
      }
      // MEMBER não tem permissões administrativas
      return null;
    }) as any;

    (prisma as any).organizationInvitation = {
      create: async ({ data }: any) => ({
        id: 'inv_mock_1',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
  }

  // 1. GET /users sem auth => 401
  await t.test('1. GET /api/v1/users sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    assert.strictEqual(res.statusCode, 401);
  });

  // 2. GET /users sem users.view => 403
  await t.test('2. GET /api/v1/users sem permissão users.view retorna 403', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.statusCode, 403);
  });

  // 3. GET /users autorizado => 200
  await t.test('3. GET /api/v1/users com users.view retorna 200 e lista membros', async () => {
    setupAuthMocks();
    prisma.organizationMember.findMany = (async () => [
      {
        id: 'mem_admin',
        organizationId: orgId,
        userId: adminUserId,
        role: 'ADMIN',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: adminUserId, name: 'Admin Test', email: 'admin@zafira.test', avatarUrl: null, status: 'ACTIVE' },
        _count: { clientAssignments: 0 },
      },
    ]) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.items.length, 1);
    assert.strictEqual(body.data.items[0].email, 'admin@zafira.test');
  });

  // 4. GET /users/:membershipId cross-org => 404
  await t.test('4. GET /api/v1/users/:membershipId inexistente ou cross-org retorna 404 seguro', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/mem_non_existent',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.statusCode, 404);
  });

  // 5. POST /users/invite sem users.invite => 403
  await t.test('5. POST /api/v1/users/invite sem permissão users.invite retorna 403', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo', email: 'novo@zafira.test' },
    });
    assert.strictEqual(res.statusCode, 403);
  });

  // 6. POST /users/invite autorizado => 201
  await t.test('6. POST /api/v1/users/invite autorizado cria convite e retorna 201', async () => {
    setupAuthMocks();
    prisma.user.create = (async ({ data }: any) => ({
      id: 'usr_new_inv',
      name: data.name,
      email: data.email,
      status: 'INVITED',
      passwordHash: null,
      createdAt: new Date(),
    })) as any;

    prisma.organizationMember.create = (async ({ data }: any) => ({
      id: 'mem_new_inv',
      organizationId: data.organizationId,
      userId: data.userId,
      role: 'MEMBER',
      status: 'INVITED',
      createdAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async ({ data }: any) => ({ id: 'aud_inv', ...data })) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo Convidado', email: 'novo@convite.test' },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.role, 'MEMBER');
    assert.strictEqual(body.data.membershipStatus, 'INVITED');
  });

  // 7 a 11. Endpoints de mutação sem permissão retornam 403
  await t.test('7 a 11. Mutação sem permissão (role, permissions, clients, status, remove) retorna 403', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgId });

    // PATCH role
    const resRole = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/mem_member/role',
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'MANAGER' },
    });
    assert.strictEqual(resRole.statusCode, 403);

    // PATCH permissions
    const resPerm = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/mem_member/permissions',
      headers: { authorization: `Bearer ${token}` },
      payload: { changes: [{ permissionCode: 'users.invite', allowed: true }] },
    });
    assert.strictEqual(resPerm.statusCode, 403);

    // PUT clients
    const resCli = await app.inject({
      method: 'PUT',
      url: '/api/v1/users/mem_member/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: { clientIds: ['cli_1'] },
    });
    assert.strictEqual(resCli.statusCode, 403);

    // PATCH status
    const resStatus = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/mem_member/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'SUSPENDED' },
    });
    assert.strictEqual(resStatus.statusCode, 403);

    // DELETE
    const resDel = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/mem_member',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(resDel.statusCode, 403);
  });

  // 12. API key de máquina => 403 MACHINE_CREDENTIAL_NOT_ALLOWED em rotas administrativas
  await t.test('12. API Key de máquina (x-api-key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const originalKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_test_key_123';

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { 'x-api-key': 'secret_test_key_123' },
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalKey;
    }
  });

  // 13. Tenant injection via query/body é ignorado
  await t.test('13. Injeção de organizationId via query não altera o tenant resolvido pelo RBAC', async () => {
    setupAuthMocks();
    let capturedWhereOrgId: string | null = null;
    prisma.organizationMember.findMany = (async ({ where }: any) => {
      capturedWhereOrgId = where.organizationId;
      return [];
    }) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?organizationId=org_target_malicious',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedWhereOrgId, orgId, 'Deve usar o tenant resolvido pelo RBAC (org_alpha)');
  });
});
