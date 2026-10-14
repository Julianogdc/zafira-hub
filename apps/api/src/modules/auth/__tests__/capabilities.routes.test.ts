import test from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../../app.js';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { CapabilitiesResponseSchema } from '@zafira/contracts';

test('Canonical Capabilities Endpoint Suite — GET /api/v1/auth/capabilities', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalUserFindUnique = prisma.user.findUnique;
  const originalMemberFindUnique = prisma.organizationMember.findUnique;
  const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;

  t.after(async () => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  // Helper para simular usuário padrão
  const mockUserBase = (userId: string, orgId: string, role = 'MEMBER', status = 'ACTIVE') => {
    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: `${userId}@zafira.test`,
          status,
          memberships: [
            {
              id: `mem_${userId}_${orgId}`,
              organizationId: orgId,
              role,
              status: 'ACTIVE',
              organization: {
                id: orgId,
                name: `Org ${orgId}`,
                slug: `slug-${orgId}`,
              },
            },
          ],
        };
      }
      return null;
    }) as any;
  };

  // A. Usuário sem autenticação → 401
  await t.test('A. Usuário sem autenticação retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
    });
    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'unauthorized');
  });

  // B. Credencial de máquina → 403
  await t.test('B. Credencial de máquina (API Key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'test_internal_machine_key_999';

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/capabilities',
        headers: {
          'x-api-key': 'test_internal_machine_key_999',
          'x-organization-id': 'org_test_1',
        },
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });

  // C. Usuário com organização ativa válida
  await t.test('C. Usuário com organização ativa válida retorna 200, Cache-Control: no-store e schema validado', async () => {
    const userId = 'usr_c_valid';
    const orgId = 'org_c_valid';

    mockUserBase(userId, orgId, 'MEMBER');

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      if (where.organizationId_userId?.userId === userId && where.organizationId_userId?.organizationId === orgId) {
        return {
          id: 'mem_c',
          organizationId: orgId,
          userId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      if (where.role_permissionCode?.role === 'MEMBER' && where.role_permissionCode?.permissionCode === 'projects.view') {
        return { role: 'MEMBER', permissionCode: 'projects.view' };
      }
      return null;
    }) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['cache-control'], 'no-store');

    const body = JSON.parse(res.body);
    const parsed = CapabilitiesResponseSchema.parse(body);
    assert.strictEqual(parsed.organizationId, orgId);
    assert.strictEqual(parsed.permissions['projects.view'], true);
    assert.strictEqual(parsed.permissions['deliverables.view'], false);
    assert.strictEqual(parsed.permissions['deliverables.plan'], false);
  });

  // Paridade A — Conflito de organizações: Sessão Org A + Header Org B -> prevalece Org A
  await t.test('Paridade A. Conflito de organizações: Sessão Org A + Header Org B retorna capacidades da Org A', async () => {
    const userId = 'usr_conflict';
    const orgA = 'org_conflict_a';
    const orgB = 'org_conflict_b';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: `${userId}@zafira.test`,
      status: 'ACTIVE',
      memberships: [
        { id: 'mem_conf_a', organizationId: orgA, role: 'MEMBER', status: 'ACTIVE', organization: { id: orgA, slug: 'slug-a' } },
        { id: 'mem_conf_b', organizationId: orgB, role: 'MANAGER', status: 'ACTIVE', organization: { id: orgB, slug: 'slug-b' } },
      ],
    })) as any;

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const targetOrg = where.organizationId_userId?.organizationId;
      if (targetOrg === orgA) {
        return {
          id: 'mem_conf_a',
          organizationId: orgA,
          userId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      if (targetOrg === orgB) {
        return {
          id: 'mem_conf_b',
          organizationId: orgB,
          userId,
          role: 'MANAGER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      // MEMBER em Org A tem apenas 'projects.view'
      if (where.role_permissionCode?.role === 'MEMBER' && where.role_permissionCode?.permissionCode === 'projects.view') {
        return { role: 'MEMBER', permissionCode: 'projects.view' };
      }
      // MANAGER em Org B tem apenas 'deliverables.view'
      if (where.role_permissionCode?.role === 'MANAGER' && where.role_permissionCode?.permissionCode === 'deliverables.view') {
        return { role: 'MANAGER', permissionCode: 'deliverables.view' };
      }
      return null;
    }) as any;

    // Sessão com activeOrganizationId = orgA, mas request com header x-organization-id = orgB
    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': orgB,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const parsed = CapabilitiesResponseSchema.parse(body);

    // Deve resolver estritamente a Org A da sessão, ignorando o header Org B
    assert.strictEqual(parsed.organizationId, orgA);
    assert.strictEqual(parsed.permissions['projects.view'], true);
    assert.strictEqual(parsed.permissions['deliverables.view'], false);
  });

  // Paridade B — Ausência de contexto: Sessão sem org ativa + 1 membership + Sem header -> 400 ORGANIZATION_CONTEXT_REQUIRED
  await t.test('Paridade B. Ausência de contexto com única membership retorna 400 ORGANIZATION_CONTEXT_REQUIRED', async () => {
    const userId = 'usr_single_no_ctx';
    const orgA = 'org_single_a';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: `${userId}@zafira.test`,
      status: 'ACTIVE',
      memberships: [
        { id: 'mem_single', organizationId: orgA, role: 'MEMBER', status: 'ACTIVE', organization: { id: orgA, slug: 'slug-a' } },
      ],
    })) as any;

    // Token sem activeOrganizationId e sem header
    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'ORGANIZATION_CONTEXT_REQUIRED');
  });

  // Paridade C — Header legítimo: Sessão sem org ativa + Header Org autorizada -> 200
  await t.test('Paridade C. Header legítimo quando sessão não tem org ativa retorna 200 e capacidades da org informada', async () => {
    const userId = 'usr_header_legit';
    const orgA = 'org_header_a';

    mockUserBase(userId, orgA, 'MEMBER');

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_legit',
      organizationId: orgA,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      if (where.role_permissionCode?.role === 'MEMBER' && where.role_permissionCode?.permissionCode === 'projects.view') {
        return { role: 'MEMBER', permissionCode: 'projects.view' };
      }
      return null;
    }) as any;

    // Token sem activeOrganizationId, mas com header x-organization-id = orgA
    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': orgA,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const parsed = CapabilitiesResponseSchema.parse(body);
    assert.strictEqual(parsed.organizationId, orgA);
    assert.strictEqual(parsed.permissions['projects.view'], true);
  });

  // Paridade D — Header de organização alheia: Sessão sem org ativa + Header Org não autorizada -> 403
  await t.test('Paridade D. Header de organização alheia quando sessão não tem org ativa retorna 403', async () => {
    const userId = 'usr_header_alien';
    const orgMy = 'org_my_legit';
    const orgAlien = 'org_alien_cross';

    mockUserBase(userId, orgMy, 'MEMBER');

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': orgAlien,
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'forbidden');
  });

  // F. Permissão concedida por RolePermission
  await t.test('F. Permissão concedida por RolePermission retorna true', async () => {
    const userId = 'usr_role_grant';
    const orgId = 'org_role_grant';

    mockUserBase(userId, orgId, 'MANAGER');

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_role',
      organizationId: orgId,
      userId,
      role: 'MANAGER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      // MANAGER possui deliverables.view concedida por RolePermission
      if (where.role_permissionCode?.permissionCode === 'deliverables.view') {
        return { role: 'MANAGER', permissionCode: 'deliverables.view' };
      }
      return null;
    }) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.permissions['deliverables.view'], true);
    assert.strictEqual(body.permissions['projects.view'], false);
  });

  // G. Permissão negada por ausência de concessão (deny by default)
  await t.test('G. Permissão negada por ausência de concessão retorna false', async () => {
    const userId = 'usr_absent_perm';
    const orgId = 'org_absent_perm';

    mockUserBase(userId, orgId, 'MEMBER');

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_absent',
      organizationId: orgId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    // Nenhuma rolePermission
    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.permissions['projects.view'], false);
    assert.strictEqual(body.permissions['deliverables.view'], false);
    assert.strictEqual(body.permissions['deliverables.plan'], false);
  });

  // H. Override individual permitindo acesso (allowed: true)
  await t.test('H. Override individual permitindo acesso retorna true mesmo sem RolePermission', async () => {
    const userId = 'usr_override_allow';
    const orgId = 'org_override_allow';

    mockUserBase(userId, orgId, 'MEMBER');

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const permCode = where.organizationId_userId ? undefined : undefined;
      return {
        id: 'mem_override',
        organizationId: orgId,
        userId,
        role: 'MEMBER',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: [
          {
            permissionCode: 'deliverables.plan',
            allowed: true,
          },
        ],
      };
    }) as any;

    // Nenhuma rolePermission no banco
    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.permissions['deliverables.plan'], true);
  });

  // I. Override individual negando acesso, mesmo diante de concessão por cargo
  await t.test('I. Override individual negando acesso retorna false mesmo se RolePermission permitir', async () => {
    const userId = 'usr_override_deny';
    const orgId = 'org_override_deny';

    mockUserBase(userId, orgId, 'ADMIN');

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_deny',
      organizationId: orgId,
      userId,
      role: 'ADMIN',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [
        {
          permissionCode: 'deliverables.plan',
          allowed: false, // Override negativo explícito
        },
      ],
    })) as any;

    // Se o banco tivesse RolePermission concedida para ADMIN
    (prisma as any).rolePermission.findUnique = (async () => ({
      role: 'ADMIN',
      permissionCode: 'deliverables.plan',
    })) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.permissions['deliverables.plan'], false);
  });

  // F7-1b. Capacidades de onboarding refletem o resolvedor (negação por padrão), sem dar nada por função operacional
  await t.test('K. Capacidades de onboarding: só o que o resolvedor concede', async () => {
    const userId = 'usr_onb_caps';
    const orgId = 'org_onb_caps';
    mockUserBase(userId, orgId, 'MEMBER');
    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_onb',
      organizationId: orgId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;
    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const code = where?.role_permissionCode?.permissionCode;
      return code === 'onboarding.view' || code === 'onboarding.execute' ? { role: 'MEMBER', permissionCode: code } : null;
    }) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/capabilities', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.permissions['onboarding.view'], true);
    assert.strictEqual(body.permissions['onboarding.execute'], true);
    for (const denied of ['manage_templates', 'manage_functions', 'start', 'override', 'cancel']) {
      assert.strictEqual(body.permissions[`onboarding.${denied}`], false, denied);
    }
    CapabilitiesResponseSchema.parse(body);
  });

  // J. Usuário inativo
  await t.test('J. Usuário inativo retorna 401', async () => {
    const userId = 'usr_inactive';
    const orgId = 'org_inactive';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'inactive@zafira.test',
      status: 'INACTIVE', // Usuário desativado
      memberships: [
        { id: 'mem_inact', organizationId: orgId, role: 'MEMBER', status: 'ACTIVE', organization: { id: orgId, slug: 'org-slug' } },
      ],
    })) as any;

    const token = createToken({ sub: userId, email: 'inactive@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 401);
  });

  // K. Membership inativa
  await t.test('K. Membership inativa retorna 403', async () => {
    const userId = 'usr_inactive_mem';
    const orgId = 'org_inactive_mem';

    prisma.user.findUnique = (async () => ({
      id: userId,
      email: 'user_inact_mem@zafira.test',
      status: 'ACTIVE',
      memberships: [
        {
          id: 'mem_inact_1',
          organizationId: orgId,
          role: 'MEMBER',
          status: 'INACTIVE', // Membership inativa
          organization: { id: orgId, slug: 'slug-inact' },
        },
      ],
    })) as any;

    const token = createToken({ sub: userId, email: 'user_inact_mem@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'forbidden');
  });

  // L. Revogação entre duas consultas consecutivas refletida imediatamente
  await t.test('L. Revogação dinâmica refletida imediatamente na segunda requisição consecutiva', async () => {
    const userId = 'usr_dyn_revoke';
    const orgId = 'org_dyn_revoke';

    mockUserBase(userId, orgId, 'MEMBER');

    let permissionGranted = true;

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_dyn',
      organizationId: orgId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      if (permissionGranted && where.role_permissionCode?.permissionCode === 'projects.view') {
        return { role: 'MEMBER', permissionCode: 'projects.view' };
      }
      return null;
    }) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    // 1ª Requisição: com permissão concedida
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res1.statusCode, 200);
    const body1 = JSON.parse(res1.body);
    assert.strictEqual(body1.permissions['projects.view'], true);

    // Revogação imediata (simulando alteração no banco)
    permissionGranted = false;

    // 2ª Requisição consecutiva: reflete imediatamente a revogação
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res2.statusCode, 200);
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.permissions['projects.view'], false);
  });

  // M. Resposta limitada aos códigos autorizados, sem vazamento de dados internos
  await t.test('M. Resposta limitada aos códigos autorizados sem vazamento de segredos, membros ou clients', async () => {
    const userId = 'usr_leak_check';
    const orgId = 'org_leak_check';

    mockUserBase(userId, orgId, 'MEMBER');

    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_leak',
      organizationId: orgId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/capabilities',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);

    const rootKeys = Object.keys(body).sort();
    assert.deepStrictEqual(rootKeys, ['organizationId', 'permissions']);

    const permKeys = Object.keys(body.permissions).sort();
    // F6-IMP.7B (DEC-F6-002): acrescidas as permissões de operação de Entregas usadas pela tela.
    assert.deepStrictEqual(permKeys, [
      'automation.manage',
      'automation.view',
      'calendar.link',
      'calendar.manage_connections',
      'calendar.view',
      'calendar.view_all',
      'content.create',
      'content.schedule',
      'content.send_to_client',
      'content.view',
      'deliverables.adjust_target',
      'deliverables.complete',
      'deliverables.plan',
      'deliverables.register',
      'deliverables.reopen',
      'deliverables.view',
      'onboarding.cancel',
      'onboarding.execute',
      'onboarding.manage_functions',
      'onboarding.manage_templates',
      'onboarding.override',
      'onboarding.start',
      'onboarding.view',
      'projects.sync',
      'projects.view',
    ]);

    // Assegura ausência de vazamento
    assert.strictEqual(body.tokens, undefined);
    assert.strictEqual(body.membershipId, undefined);
    assert.strictEqual(body.userId, undefined);
    assert.strictEqual(body.clients, undefined);
  });

  // N. O comportamento de requirePermission das rotas Asana permanece inalterado
  await t.test('N. Comportamento de requirePermission nas rotas Asana permanece íntegro', async () => {
    const userId = 'usr_asana_check';
    const orgId = 'org_asana_check';
    const clientId = 'cli_asana_1';

    mockUserBase(userId, orgId, 'MEMBER');

    // Usuário sem a permissão 'projects.view'
    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_asana',
      organizationId: orgId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const token = createToken({ sub: userId, email: `${userId}@zafira.test`, activeOrganizationId: orgId });

    // Rota Asana que exige 'projects.view'
    const resForbidden = await app.inject({
      method: 'GET',
      url: `/clients/${clientId}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Deve ser bloqueado com 403 pelo requirePermission
    assert.strictEqual(resForbidden.statusCode, 403);
    const bodyForbidden = JSON.parse(resForbidden.body);
    assert.strictEqual(bodyForbidden.error, 'forbidden');
  });
});
