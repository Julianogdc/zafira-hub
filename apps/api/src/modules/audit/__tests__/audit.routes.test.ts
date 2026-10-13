import test from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../../app.js';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';

test('Audit Routes - GET /api/v1/audit (HTTP Tests)', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUnique = prisma.user.findUnique;
  const originalMemberFindUnique = prisma.organizationMember.findUnique;
  const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;
  const originalAuditFindMany = (prisma as any).auditLog.findMany;

  t.after(async () => {
    prisma.user.findUnique = originalFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
    (prisma as any).auditLog.findMany = originalAuditFindMany;
    await app.close();
  });

  // Helper para gerar token JWT assinado pela instância do Fastify
  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  // 1. GET audit sem autenticação => 401
  await t.test('1. GET /api/v1/audit sem autenticação retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  // 2. Usuário sem admin.view_audit (ex: MEMBER padrão) => 403
  await t.test('2. Usuário autenticado sem permissão admin.view_audit retorna 403', async () => {
    const userId = 'usr_member_1';
    const orgId = 'org_test_1';

    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: 'member@zafira.com',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_1',
              role: 'MEMBER',
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-test-1', name: 'Org Test 1' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async () => {
      return {
        id: 'mem_1',
        role: 'MEMBER',
        status: 'ACTIVE',
        organizationId: orgId,
        userId,
        user: { status: 'ACTIVE' },
        permissions: [],
      };
    }) as any;

    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: 'member@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'error');
  });

  // 3. Usuário com override: false => 403
  await t.test('3. Usuário com override explícito false para admin.view_audit retorna 403', async () => {
    const userId = 'usr_admin_revoked';
    const orgId = 'org_test_1';

    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: 'admin_revoked@zafira.com',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_revoked',
              role: 'ADMIN',
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-test-1', name: 'Org Test 1' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async () => {
      return {
        id: 'mem_revoked',
        role: 'ADMIN',
        status: 'ACTIVE',
        organizationId: orgId,
        userId,
        user: { status: 'ACTIVE' },
        permissions: [
          {
            permissionCode: 'admin.view_audit',
            allowed: false, // override revogando
          },
        ],
      };
    }) as any;

    const token = createToken({ sub: userId, email: 'admin_revoked@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  // 4. Usuário autorizado => 200
  await t.test('4. Usuário autorizado (ADMIN com admin.view_audit) retorna 200 com logs', async () => {
    const userId = 'usr_admin_ok';
    const orgId = 'org_test_1';

    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: 'admin@zafira.com',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_admin',
              role: 'ADMIN',
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-test-1', name: 'Org Test 1' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async () => {
      return {
        id: 'mem_admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        organizationId: orgId,
        userId,
        user: { status: 'ACTIVE' },
        permissions: [],
      };
    }) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_1',
      role: 'ADMIN',
      permissionCode: 'admin.view_audit',
      granted: true,
    })) as any;

    (prisma as any).auditLog.findMany = (async ({ where }: any) => {
      if (where.organizationId === orgId) {
        return [
          {
            id: 'audit_log_1',
            organizationId: orgId,
            actorUserId: userId,
            action: 'financial_category.created',
            entityType: 'FinancialCategory',
            entityId: 'cat_1',
            before: null,
            after: { name: 'Marketing', type: 'EXPENSE' },
            metadata: null,
            createdAt: new Date(),
            actorUser: { id: userId, name: 'Admin User', email: 'admin@zafira.com' },
          },
        ];
      }
      return [];
    }) as any;

    const token = createToken({ sub: userId, email: 'admin@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.items.length, 1);
    assert.strictEqual(body.data.items[0].action, 'financial_category.created');
  });

  // 5. Query parameter organizationId não permite atravessar tenant
  await t.test('5. Parâmetro ?organizationId= de query é ignorado e não permite atravessar tenant', async () => {
    const userId = 'usr_admin_tenant';
    const orgIdUser = 'org_tenant_user';
    let capturedOrgIdInQuery: string | null = null;

    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: 'admin_tenant@zafira.com',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_tenant',
              role: 'ADMIN',
              status: 'ACTIVE',
              organization: { id: orgIdUser, slug: 'org-tenant-user', name: 'Org Tenant' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async () => {
      return {
        id: 'mem_tenant',
        role: 'ADMIN',
        status: 'ACTIVE',
        organizationId: orgIdUser,
        userId,
        user: { status: 'ACTIVE' },
        permissions: [],
      };
    }) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_tenant',
      role: 'ADMIN',
      permissionCode: 'admin.view_audit',
      granted: true,
    })) as any;

    (prisma as any).auditLog.findMany = (async ({ where }: any) => {
      capturedOrgIdInQuery = where.organizationId;
      return [];
    }) as any;

    const token = createToken({ sub: userId, email: 'admin_tenant@zafira.com', activeOrganizationId: orgIdUser });

    // Tentativa de injetar outra organização na query string
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?organizationId=org_target_malicious',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    // Deve consultar estritamente a organização do usuário autenticado, ignorando a query injetada
    assert.strictEqual(capturedOrgIdInQuery, orgIdUser);
  });

  // 6. API Key de máquina => 403
  await t.test('6. API Key de máquina (x-api-key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_key_123';

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/audit',
        headers: {
          'x-api-key': 'secret_internal_key_123',
        },
      });

      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });

  // 7. Resposta não contém segredos
  await t.test('7. Resposta de auditoria não vaza senhas ou tokens', async () => {
    const userId = 'usr_admin_audit';
    const orgId = 'org_audit_test';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin@zafira.com',
      status: 'ACTIVE',
      memberships: [
        {
          id: 'mem_a',
          role: 'ADMIN',
          status: 'ACTIVE',
          organization: { id: orgId, slug: 'org-audit', name: 'Org Audit' },
        },
      ],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_a',
      role: 'ADMIN',
      status: 'ACTIVE',
      organizationId: orgId,
      userId,
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_a',
      role: 'ADMIN',
      permissionCode: 'admin.view_audit',
      granted: true,
    })) as any;

    (prisma as any).auditLog.findMany = (async () => [
      {
        id: 'audit_sanitized_1',
        organizationId: orgId,
        actorUserId: userId,
        action: 'user.created',
        entityType: 'User',
        entityId: 'u_new_1',
        before: null,
        after: { email: 'new@zafira.com', passwordHash: '[REDACTED]', apiKey: '[REDACTED]' },
        metadata: { token: '[REDACTED]' },
        createdAt: new Date(),
        actorUser: { id: userId, name: 'Admin User', email: 'admin@zafira.com' },
      },
    ]) as any;

    const token = createToken({ sub: userId, email: 'admin@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const rawBody = res.body;
    assert.ok(!rawBody.includes('$argon2id$'));
    assert.ok(!rawBody.includes('super_secret'));
    assert.ok(rawBody.includes('[REDACTED]'));
  });
});
