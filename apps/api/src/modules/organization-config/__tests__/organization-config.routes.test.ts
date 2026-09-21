import test from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../../app.js';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';

test('Organization Config & Feature Flags HTTP Routes', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUnique = prisma.user.findUnique;
  const originalMemberFindUnique = prisma.organizationMember.findUnique;
  const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;
  const originalConfigFindUnique = (prisma as any).organizationConfig.findUnique;
  const originalConfigUpsert = (prisma as any).organizationConfig.upsert;
  const originalFlagFindMany = (prisma as any).organizationFeatureFlag.findMany;
  const originalFlagFindUnique = (prisma as any).organizationFeatureFlag.findUnique;
  const originalFlagUpsert = (prisma as any).organizationFeatureFlag.upsert;
  const originalAuditCreate = (prisma as any).auditLog.create;
  const originalTransaction = prisma.$transaction;

  t.after(async () => {
    prisma.user.findUnique = originalFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
    (prisma as any).organizationConfig.findUnique = originalConfigFindUnique;
    (prisma as any).organizationConfig.upsert = originalConfigUpsert;
    (prisma as any).organizationFeatureFlag.findMany = originalFlagFindMany;
    (prisma as any).organizationFeatureFlag.findUnique = originalFlagFindUnique;
    (prisma as any).organizationFeatureFlag.upsert = originalFlagUpsert;
    (prisma as any).auditLog.create = originalAuditCreate;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  // 1. GET config sem auth => 401
  await t.test('1. GET /api/v1/organization/config sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/config',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  // 2. GET config autenticado => 200
  await t.test('2. GET /api/v1/organization/config autenticado retorna 200', async () => {
    const userId = 'usr_cfg_1';
    const orgId = 'org_cfg_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_1', role: 'MEMBER', organization: { id: orgId, slug: 'org-1' } }],
    })) as any;

    (prisma as any).organizationConfig.findUnique = (async () => ({
      organizationId: orgId,
      locale: 'pt-BR',
      timezone: 'UTC',
      currency: 'BRL',
    })) as any;

    const token = createToken({ sub: userId, email: 'user@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/config',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.organizationId, orgId);
    assert.strictEqual(body.data.currency, 'BRL');
  });

  // 3. PATCH config sem permission => 403
  await t.test('3. PATCH /api/v1/organization/config sem admin.configure_organization retorna 403', async () => {
    const userId = 'usr_member_cfg';
    const orgId = 'org_cfg_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'member@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_2', role: 'MEMBER', organization: { id: orgId, slug: 'org-1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_2',
      role: 'MEMBER',
      organizationId: orgId,
      userId,
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: 'member@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'America/Sao_Paulo' },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  // 4. PATCH config com admin.configure_organization => 200
  await t.test('4. PATCH /api/v1/organization/config com permissão atualiza e retorna 200', async () => {
    const userId = 'usr_admin_cfg';
    const orgId = 'org_cfg_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_adm', role: 'ADMIN', organization: { id: orgId, slug: 'org-1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_adm',
      role: 'ADMIN',
      organizationId: orgId,
      userId,
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_cfg',
      role: 'ADMIN',
      permissionCode: 'admin.configure_organization',
      granted: true,
    })) as any;

    (prisma as any).organizationConfig.findUnique = (async () => ({
      organizationId: orgId,
      locale: 'pt-BR',
      timezone: 'UTC',
      currency: 'BRL',
    })) as any;

    (prisma as any).organizationConfig.upsert = (async ({ update }: any) => ({
      organizationId: orgId,
      locale: 'pt-BR',
      timezone: update.timezone || 'UTC',
      currency: 'BRL',
    })) as any;

    (prisma as any).auditLog.create = (async ({ data }: any) => ({ id: 'aud_1', ...data })) as any;
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    const token = createToken({ sub: userId, email: 'admin@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'America/Sao_Paulo' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.timezone, 'America/Sao_Paulo');
  });

  // 5. Query / Body com organizationId não atravessa tenant
  await t.test('5. organizationId injetado na query ou body não altera o tenant resolvido', async () => {
    const userId = 'usr_admin_cfg2';
    const orgIdAuth = 'org_safe_tenant';
    let targetOrgIdModified = '';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin2@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_adm2', role: 'ADMIN', organization: { id: orgIdAuth, slug: 'org-safe' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_adm2',
      role: 'ADMIN',
      organizationId: orgIdAuth,
      userId,
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_cfg2',
      role: 'ADMIN',
      permissionCode: 'admin.configure_organization',
      granted: true,
    })) as any;

    (prisma as any).organizationConfig.findUnique = (async () => null) as any;
    (prisma as any).organizationConfig.upsert = (async ({ where }: any) => {
      targetOrgIdModified = where.organizationId;
      return {
        organizationId: where.organizationId,
        locale: 'pt-BR',
        timezone: 'UTC',
        currency: 'USD',
      };
    }) as any;

    (prisma as any).auditLog.create = (async ({ data }: any) => ({ id: 'aud_2', ...data })) as any;
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    const token = createToken({ sub: userId, email: 'admin2@zafira.com', activeOrganizationId: orgIdAuth });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/config?organizationId=org_target_malicious',
      headers: { authorization: `Bearer ${token}` },
      payload: { currency: 'USD', organizationId: 'org_target_malicious' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(targetOrgIdModified, orgIdAuth, 'Deve atualizar apenas a organização autorizada');
  });

  // 6. Flags sem auth => 401
  await t.test('6. GET /api/v1/organization/feature-flags sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/feature-flags',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  // 7. GET flags autenticado => 200
  await t.test('7. GET /api/v1/organization/feature-flags autenticado retorna 200 com lista completa', async () => {
    const userId = 'usr_flags_1';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user_flags@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_f1', role: 'MEMBER', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    (prisma as any).organizationFeatureFlag.findMany = (async () => [
      { organizationId: orgId, key: 'FINANCIAL', enabled: true },
    ]) as any;

    const token = createToken({ sub: userId, email: 'user_flags@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/feature-flags',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.ok(Array.isArray(body.data));
    const fin = body.data.find((f: any) => f.key === 'FINANCIAL');
    const c360 = body.data.find((f: any) => f.key === 'CLIENT_360');
    assert.strictEqual(fin?.enabled, true);
    assert.strictEqual(c360?.enabled, false);
  });

  // 8. PATCH flag sem permission => 403
  await t.test('8. PATCH /api/v1/organization/feature-flags/:key sem permission retorna 403', async () => {
    const userId = 'usr_member_f2';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'member_f2@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_f2', role: 'MEMBER', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_f2',
      role: 'MEMBER',
      organizationId: orgId,
      userId,
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: 'member_f2@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/feature-flags/FINANCIAL',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  // 9. PATCH flag autorizado => 200
  await t.test('9. PATCH /api/v1/organization/feature-flags/:key com permissão atualiza flag e retorna 200', async () => {
    const userId = 'usr_admin_flag';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin_flag@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_af', role: 'ADMIN', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_af',
      role: 'ADMIN',
      organizationId: orgId,
      userId,
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_ff',
      role: 'ADMIN',
      permissionCode: 'admin.configure_organization',
      granted: true,
    })) as any;

    (prisma as any).organizationFeatureFlag.findUnique = (async () => null) as any;
    (prisma as any).organizationFeatureFlag.upsert = (async () => ({
      organizationId: orgId,
      key: 'FINANCIAL',
      enabled: true,
    })) as any;

    (prisma as any).auditLog.create = (async ({ data }: any) => ({ id: 'aud_ff_1', ...data })) as any;
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    const token = createToken({ sub: userId, email: 'admin_flag@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/feature-flags/FINANCIAL',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.key, 'FINANCIAL');
    assert.strictEqual(body.data.enabled, true);
  });

  // 10. Chave inválida => 400
  await t.test('10. PATCH /api/v1/organization/feature-flags/:key com chave inexistente retorna 400', async () => {
    const userId = 'usr_admin_flag';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin_flag@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_af', role: 'ADMIN', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_af',
      role: 'ADMIN',
      organizationId: orgId,
      userId,
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      id: 'rp_ff',
      role: 'ADMIN',
      permissionCode: 'admin.configure_organization',
      granted: true,
    })) as any;

    const token = createToken({ sub: userId, email: 'admin_flag@zafira.com', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/feature-flags/INVALID_KEY_MODULE',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'INVALID_FEATURE_FLAG_KEY');
  });

  // 11. API key machine => 403 nas alterações administrativas
  await t.test('11. API key de máquina (x-api-key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED em rotas administrativas', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_key_org';

    try {
      // PATCH config
      const resConfig = await app.inject({
        method: 'PATCH',
        url: '/api/v1/organization/config',
        headers: { 'x-api-key': 'secret_internal_key_org' },
        payload: { timezone: 'UTC' },
      });
      assert.strictEqual(resConfig.statusCode, 403);
      assert.strictEqual(JSON.parse(resConfig.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');

      // PATCH feature-flag
      const resFlag = await app.inject({
        method: 'PATCH',
        url: '/api/v1/organization/feature-flags/FINANCIAL',
        headers: { 'x-api-key': 'secret_internal_key_org' },
        payload: { enabled: true },
      });
      assert.strictEqual(resFlag.statusCode, 403);
      assert.strictEqual(JSON.parse(resFlag.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });
});
