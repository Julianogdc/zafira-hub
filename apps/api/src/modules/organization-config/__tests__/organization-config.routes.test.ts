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

  // 2. GET config com API key válida => 403 MACHINE_CREDENTIAL_NOT_ALLOWED
  await t.test('2. GET /api/v1/organization/config com API key válida retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_key_test';

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/organization/config',
        headers: { 'x-api-key': 'secret_internal_key_test', 'x-organization-id': 'org_1' },
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });

  // 3. GET config autenticado com Org A + active Org A => 200
  await t.test('3. GET /api/v1/organization/config usuário com Org A + active Org A retorna 200', async () => {
    const userId = 'usr_cfg_1';
    const orgId = 'org_cfg_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_1', role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-1' } }],
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

  // 4. GET config usuário com Org A, activeOrganizationId null, x-organization-id Org A => 200 Org A
  await t.test('4. GET /api/v1/organization/config usuário com Org A, activeOrg null, header Org A retorna 200', async () => {
    const userId = 'usr_cfg_hdr';
    const orgId = 'org_cfg_hdr_a';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user_hdr@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_h1', role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-h-a' } }],
    })) as any;

    (prisma as any).organizationConfig.findUnique = (async () => ({
      organizationId: orgId,
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    })) as any;

    const token = createToken({ sub: userId, email: 'user_hdr@zafira.com', activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/config',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': orgId,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.organizationId, orgId);
    assert.strictEqual(body.data.timezone, 'America/Sao_Paulo');
  });

  // 5. GET config usuário com Org A, activeOrganizationId null, x-organization-id Org B => 403 (cross-tenant)
  await t.test('5. GET /api/v1/organization/config com header de organização alheia retorna 403', async () => {
    const userId = 'usr_cfg_cross';
    const userOrgId = 'org_cfg_mine';
    const alienOrgId = 'org_cfg_alien';
    let serviceCalled = false;

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user_cross@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_cross', role: 'MEMBER', status: 'ACTIVE', organization: { id: userOrgId, slug: 'org-mine' } }],
    })) as any;

    (prisma as any).organizationConfig.findUnique = (async () => {
      serviceCalled = true;
      return null;
    }) as any;

    const token = createToken({ sub: userId, email: 'user_cross@zafira.com', activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/config',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': alienOrgId,
      },
    });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(serviceCalled, false, 'ConfigService NÃO deve ser chamado para tenant não autorizado');
  });

  // 6. GET config usuário multi-org sem contexto => 400
  await t.test('6. GET /api/v1/organization/config usuário multi-org sem contexto retorna 400 ORGANIZATION_CONTEXT_REQUIRED', async () => {
    const userId = 'usr_cfg_multi';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'multi@zafira.com',
      status: 'ACTIVE',
      memberships: [
        { id: 'mem_m1', role: 'MEMBER', status: 'ACTIVE', organization: { id: 'org_m1', slug: 'org-m1' } },
        { id: 'mem_m2', role: 'MEMBER', status: 'ACTIVE', organization: { id: 'org_m2', slug: 'org-m2' } },
      ],
    })) as any;

    const token = createToken({ sub: userId, email: 'multi@zafira.com', activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/config',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'ORGANIZATION_CONTEXT_REQUIRED');
  });

  // 7. GET config usuário de uma única org sem contexto explícito => resolve única membership => 200
  await t.test('7. GET /api/v1/organization/config usuário de uma única org sem contexto explícito resolve automaticamente', async () => {
    const userId = 'usr_cfg_single';
    const orgId = 'org_cfg_single_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'single@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_s1', role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-s1' } }],
    })) as any;

    (prisma as any).organizationConfig.findUnique = (async () => ({
      organizationId: orgId,
      locale: 'pt-BR',
      timezone: 'UTC',
      currency: 'BRL',
    })) as any;

    const token = createToken({ sub: userId, email: 'single@zafira.com', activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/config',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.organizationId, orgId);
  });

  // 8. GET flags sem auth => 401
  await t.test('8. GET /api/v1/organization/feature-flags sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/feature-flags',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  // 9. GET flags com API key válida => 403 MACHINE_CREDENTIAL_NOT_ALLOWED
  await t.test('9. GET /api/v1/organization/feature-flags com API key válida retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_key_test';

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/organization/feature-flags',
        headers: { 'x-api-key': 'secret_internal_key_test', 'x-organization-id': 'org_flags_1' },
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });

  // 10. GET flags usuário com Org A, activeOrganizationId null, x-organization-id Org B => 403 (cross-tenant)
  await t.test('10. GET /api/v1/organization/feature-flags com header de organização alheia retorna 403', async () => {
    const userId = 'usr_flag_cross';
    const userOrgId = 'org_flag_mine';
    const alienOrgId = 'org_flag_alien';
    let flagServiceCalled = false;

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user_fcross@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_fcross', role: 'MEMBER', status: 'ACTIVE', organization: { id: userOrgId, slug: 'org-fmine' } }],
    })) as any;

    (prisma as any).organizationFeatureFlag.findMany = (async () => {
      flagServiceCalled = true;
      return [];
    }) as any;

    const token = createToken({ sub: userId, email: 'user_fcross@zafira.com', activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/feature-flags',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': alienOrgId,
      },
    });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(flagServiceCalled, false, 'FeatureFlagService NÃO deve ser chamado para tenant não autorizado');
  });

  // 11. GET flags autenticado => 200 com lista completa
  await t.test('11. GET /api/v1/organization/feature-flags autenticado retorna 200 com lista completa', async () => {
    const userId = 'usr_flags_1';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user_flags@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_f1', role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-f1' } }],
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

  // 12. PATCH config sem permission => 403
  await t.test('12. PATCH /api/v1/organization/config sem admin.configure_organization retorna 403', async () => {
    const userId = 'usr_member_cfg';
    const orgId = 'org_cfg_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'member@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_2', role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_2',
      role: 'MEMBER',
      status: 'ACTIVE',
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

  // 13. PATCH config com admin.configure_organization => 200
  await t.test('13. PATCH /api/v1/organization/config com permissão atualiza e retorna 200', async () => {
    const userId = 'usr_admin_cfg';
    const orgId = 'org_cfg_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_adm', role: 'ADMIN', status: 'ACTIVE', organization: { id: orgId, slug: 'org-1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_adm',
      role: 'ADMIN',
      status: 'ACTIVE',
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

  // 14. Query / Body com organizationId não atravessa tenant
  await t.test('14. organizationId injetado na query ou body não altera o tenant resolvido', async () => {
    const userId = 'usr_admin_cfg2';
    const orgIdAuth = 'org_safe_tenant';
    let targetOrgIdModified = '';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin2@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_adm2', role: 'ADMIN', status: 'ACTIVE', organization: { id: orgIdAuth, slug: 'org-safe' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_adm2',
      role: 'ADMIN',
      status: 'ACTIVE',
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

  // 15. PATCH flag sem permission => 403
  await t.test('15. PATCH /api/v1/organization/feature-flags/:key sem permission retorna 403', async () => {
    const userId = 'usr_member_f2';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'member_f2@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_f2', role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_f2',
      role: 'MEMBER',
      status: 'ACTIVE',
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

  // 16. PATCH flag autorizado => 200
  await t.test('16. PATCH /api/v1/organization/feature-flags/:key com permissão atualiza flag e retorna 200', async () => {
    const userId = 'usr_admin_flag';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin_flag@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_af', role: 'ADMIN', status: 'ACTIVE', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_af',
      role: 'ADMIN',
      status: 'ACTIVE',
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

  // 17. Chave inválida => 400
  await t.test('17. PATCH /api/v1/organization/feature-flags/:key com chave inexistente retorna 400', async () => {
    const userId = 'usr_admin_flag';
    const orgId = 'org_flags_1';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'admin_flag@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_af', role: 'ADMIN', status: 'ACTIVE', organization: { id: orgId, slug: 'org-f1' } }],
    })) as any;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_af',
      role: 'ADMIN',
      status: 'ACTIVE',
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

  // 18. API key machine => 403 em todos os 4 endpoints
  await t.test('18. API key de máquina (x-api-key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED em todos os 4 endpoints', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_key_org';

    try {
      // GET config
      const resGetConfig = await app.inject({
        method: 'GET',
        url: '/api/v1/organization/config',
        headers: { 'x-api-key': 'secret_internal_key_org', 'x-organization-id': 'org_1' },
      });
      assert.strictEqual(resGetConfig.statusCode, 403);
      assert.strictEqual(JSON.parse(resGetConfig.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');

      // PATCH config
      const resPatchConfig = await app.inject({
        method: 'PATCH',
        url: '/api/v1/organization/config',
        headers: { 'x-api-key': 'secret_internal_key_org', 'x-organization-id': 'org_1' },
        payload: { timezone: 'UTC' },
      });
      assert.strictEqual(resPatchConfig.statusCode, 403);
      assert.strictEqual(JSON.parse(resPatchConfig.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');

      // GET feature-flags
      const resGetFlags = await app.inject({
        method: 'GET',
        url: '/api/v1/organization/feature-flags',
        headers: { 'x-api-key': 'secret_internal_key_org', 'x-organization-id': 'org_1' },
      });
      assert.strictEqual(resGetFlags.statusCode, 403);
      assert.strictEqual(JSON.parse(resGetFlags.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');

      // PATCH feature-flag
      const resPatchFlag = await app.inject({
        method: 'PATCH',
        url: '/api/v1/organization/feature-flags/FINANCIAL',
        headers: { 'x-api-key': 'secret_internal_key_org', 'x-organization-id': 'org_1' },
        payload: { enabled: true },
      });
      assert.strictEqual(resPatchFlag.statusCode, 403);
      assert.strictEqual(JSON.parse(resPatchFlag.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });
});
