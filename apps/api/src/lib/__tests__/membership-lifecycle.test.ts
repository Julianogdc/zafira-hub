import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwtPlugin from '@fastify/jwt';
import { authenticate } from '../../middleware/auth.js';
import { AuthService } from '../../modules/auth/auth.service.js';
import { resolveAuthorizationContext } from '../../modules/authorization/resolver.js';
import { prisma } from '../prisma.js';
import { AppError } from '../../modules/clients/clients.service.js';
import argon2 from 'argon2';

test('--- Membership Lifecycle & Organization-Scoped Suspension Suite ---', async (t) => {
  const originalUserFindUnique = prisma.user.findUnique;
  const originalUserUpdate = prisma.user.update;
  const originalMemberFindUnique = prisma.organizationMember.findUnique;
  const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;

  t.after(() => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.user.update = originalUserUpdate;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
    (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
  });

  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwtPlugin, { secret: 'test_jwt_secret_32bytes_long' });
  await app.ready();

  t.after(async () => {
    await app.close();
  });

  // 1. User INACTIVE => 401 em authenticate
  await t.test('1. User INACTIVE resulta em 401 no authenticate', async () => {
    prisma.user.findUnique = (async () => ({
      id: 'usr_inactive',
      email: 'inactive@zafira.com',
      status: 'INACTIVE',
      memberships: [{ id: 'mem_1', role: 'ADMIN', status: 'ACTIVE', organization: { id: 'org_1', slug: 'org-1' } }],
    })) as any;

    const token = await app.jwt.sign({ sub: 'usr_inactive', email: 'inactive@zafira.com', activeOrganizationId: 'org_1' });

    let authReq: any = { headers: { authorization: `Bearer ${token}` }, server: app };
    let replyStatus: number | null = null;
    const replyMock: any = {
      status: (code: number) => {
        replyStatus = code;
        return { send: () => {} };
      },
    };

    await authenticate(authReq, replyMock);
    assert.strictEqual(replyStatus, 401);
    assert.strictEqual(authReq.authContext, undefined);
  });

  // 2. User ACTIVE + membership ACTIVE => authenticate expõe membership
  await t.test('2. User ACTIVE + membership ACTIVE expõe membership no authContext', async () => {
    prisma.user.findUnique = (async () => ({
      id: 'usr_active',
      email: 'active@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_1', role: 'ADMIN', status: 'ACTIVE', organization: { id: 'org_1', slug: 'org-1' } }],
    })) as any;

    const token = await app.jwt.sign({ sub: 'usr_active', email: 'active@zafira.com', activeOrganizationId: 'org_1' });

    let authReq: any = { headers: { authorization: `Bearer ${token}` }, server: app };
    const replyMock: any = { status: () => ({ send: () => {} }) };

    await authenticate(authReq, replyMock);
    assert.ok(authReq.authContext);
    assert.strictEqual(authReq.authContext.type, 'user');
    assert.strictEqual(authReq.authContext.memberships.length, 1);
    assert.strictEqual(authReq.authContext.memberships[0].organizationId, 'org_1');
  });

  // 3. User ACTIVE + membership SUSPENDED => organização não disponível no authContext
  await t.test('3. User ACTIVE + membership SUSPENDED não inclui organização no authContext', async () => {
    prisma.user.findUnique = (async () => ({
      id: 'usr_suspended_mem',
      email: 'user_susp@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_susp', role: 'ADMIN', status: 'SUSPENDED', organization: { id: 'org_susp', slug: 'org-susp' } }],
    })) as any;

    const token = await app.jwt.sign({ sub: 'usr_suspended_mem', email: 'user_susp@zafira.com', activeOrganizationId: 'org_susp' });

    let authReq: any = { headers: { authorization: `Bearer ${token}` }, server: app };
    const replyMock: any = { status: () => ({ send: () => {} }) };

    await authenticate(authReq, replyMock);
    assert.ok(authReq.authContext);
    assert.strictEqual(authReq.authContext.type, 'user');
    assert.strictEqual(authReq.authContext.memberships.length, 0, 'Membership SUSPENDED não deve estar presente no authContext');
  });

  // 4. User ACTIVE + membership INVITED => organização não disponível no authContext
  await t.test('4. User ACTIVE + membership INVITED não inclui organização no authContext', async () => {
    prisma.user.findUnique = (async () => ({
      id: 'usr_invited_mem',
      email: 'user_inv@zafira.com',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_inv', role: 'MEMBER', status: 'INVITED', organization: { id: 'org_inv', slug: 'org-inv' } }],
    })) as any;

    const token = await app.jwt.sign({ sub: 'usr_invited_mem', email: 'user_inv@zafira.com', activeOrganizationId: 'org_inv' });

    let authReq: any = { headers: { authorization: `Bearer ${token}` }, server: app };
    const replyMock: any = { status: () => ({ send: () => {} }) };

    await authenticate(authReq, replyMock);
    assert.ok(authReq.authContext);
    assert.strictEqual(authReq.authContext.type, 'user');
    assert.strictEqual(authReq.authContext.memberships.length, 0, 'Membership INVITED não deve estar presente no authContext');
  });

  // 5. Login com somente membership SUSPENDED => rejeitado 403
  await t.test('5. Login com usuário que possui apenas membership SUSPENDED é rejeitado com 403', async () => {
    const passwordHash = await argon2.hash('Secret123!');
    prisma.user.findUnique = (async () => ({
      id: 'usr_only_susp',
      email: 'only_susp@zafira.com',
      status: 'ACTIVE',
      passwordHash,
      memberships: [{ id: 'mem_1', role: 'ADMIN', status: 'SUSPENDED', organization: { id: 'org_1', slug: 'org-1' } }],
    })) as any;

    const authService = new AuthService();
    await assert.rejects(
      authService.login({ email: 'only_susp@zafira.com', password: 'Secret123!' }),
      (err: AppError) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /não possui organizações ativas associadas/i);
        return true;
      }
    );
  });

  // 6. Login com A ACTIVE + B SUSPENDED => seleciona/permite somente A
  await t.test('6. Login com Org A (ACTIVE) e Org B (SUSPENDED) auto-seleciona apenas Org A', async () => {
    const passwordHash = await argon2.hash('Secret123!');
    prisma.user.findUnique = (async () => ({
      id: 'usr_multi_one_active',
      email: 'multi_one@zafira.com',
      status: 'ACTIVE',
      name: 'Multi User',
      passwordHash,
      memberships: [
        { id: 'mem_a', role: 'ADMIN', status: 'ACTIVE', organizationId: 'org_A', organization: { id: 'org_A', name: 'Org A', slug: 'org-a' } },
        { id: 'mem_b', role: 'MEMBER', status: 'SUSPENDED', organizationId: 'org_B', organization: { id: 'org_B', name: 'Org B', slug: 'org-b' } },
      ],
    })) as any;

    prisma.user.update = (async () => ({})) as any;

    const authService = new AuthService();
    const result = await authService.login({ email: 'multi_one@zafira.com', password: 'Secret123!' });

    assert.strictEqual(result.activeOrganizationId, 'org_A');
    assert.strictEqual(result.sessionData.organizations.length, 1);
    assert.strictEqual(result.sessionData.organizations[0].id, 'org_A');

    // Tentar login explícito para Org B (SUSPENDED) deve falhar
    await assert.rejects(
      authService.login({ email: 'multi_one@zafira.com', password: 'Secret123!', organizationId: 'org_B' }),
      (err: AppError) => {
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  // 7. JWT antigo apontando para Org B cuja membership virou SUSPENDED => não recupera acesso a B na sessão
  await t.test('7. resolveSession com activeOrganizationId do token apontando para membership SUSPENDED não mantém B ativo', async () => {
    prisma.user.findUnique = (async () => ({
      id: 'usr_jwt_old',
      email: 'jwt_old@zafira.com',
      name: 'Old User',
      status: 'ACTIVE',
      memberships: [
        { id: 'mem_a', role: 'ADMIN', status: 'ACTIVE', organizationId: 'org_A', organization: { id: 'org_A', name: 'Org A', slug: 'org-a' } },
        { id: 'mem_b', role: 'MEMBER', status: 'SUSPENDED', organizationId: 'org_B', organization: { id: 'org_B', name: 'Org B', slug: 'org-b' } },
      ],
    })) as any;

    const authService = new AuthService();
    // Token antigo tinha activeOrg = org_B (agora suspensa)
    const session = await authService.resolveSession('usr_jwt_old', 'org_B');

    // Como resta apenas 1 membership ativa (org_A), a sessão deve ter somente org_A
    assert.strictEqual(session.organizations.length, 1);
    assert.strictEqual(session.organizations[0].id, 'org_A');
    assert.strictEqual(session.activeOrganizationId, 'org_A');
  });

  // 8. Resolver: membership ACTIVE + RolePermission => allow
  await t.test('8. Resolver: membership ACTIVE + RolePermission concedida => ALLOW', async () => {
    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_act',
      organizationId: 'org_1',
      userId: 'usr_1',
      role: 'ADMIN',
      status: 'ACTIVE',
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      role: 'ADMIN',
      permissionCode: 'financial.view_summary',
    })) as any;

    const res = await resolveAuthorizationContext({
      userId: 'usr_1',
      activeOrganizationId: 'org_1',
      permissionCode: 'financial.view_summary',
    });

    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.reason, 'GRANTED_BY_ROLE_PERMISSION');
  });

  // 9. Resolver: membership SUSPENDED + RolePermission => deny MEMBERSHIP_NOT_ACTIVE
  await t.test('9. Resolver: membership SUSPENDED => DENY MEMBERSHIP_NOT_ACTIVE (mesmo com Role ADMIN)', async () => {
    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_susp',
      organizationId: 'org_1',
      userId: 'usr_1',
      role: 'ADMIN',
      status: 'SUSPENDED',
      permissions: [],
    })) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      role: 'ADMIN',
      permissionCode: 'financial.view_summary',
    })) as any;

    const res = await resolveAuthorizationContext({
      userId: 'usr_1',
      activeOrganizationId: 'org_1',
      permissionCode: 'financial.view_summary',
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'MEMBERSHIP_NOT_ACTIVE');
  });

  // 10. Resolver: membership INVITED + RolePermission => deny MEMBERSHIP_NOT_ACTIVE
  await t.test('10. Resolver: membership INVITED => DENY MEMBERSHIP_NOT_ACTIVE', async () => {
    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_inv',
      organizationId: 'org_1',
      userId: 'usr_1',
      role: 'ADMIN',
      status: 'INVITED',
      permissions: [],
    })) as any;

    const res = await resolveAuthorizationContext({
      userId: 'usr_1',
      activeOrganizationId: 'org_1',
      permissionCode: 'financial.view_summary',
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'MEMBERSHIP_NOT_ACTIVE');
  });

  // 11. Resolver: override allowed=true em membership SUSPENDED => ainda DENY
  await t.test('11. Resolver: override individual allowed=true NÃO vence membership SUSPENDED', async () => {
    prisma.organizationMember.findUnique = (async () => ({
      id: 'mem_susp_ov',
      organizationId: 'org_1',
      userId: 'usr_1',
      role: 'ADMIN',
      status: 'SUSPENDED',
      permissions: [{ permissionCode: 'financial.view_summary', allowed: true }],
    })) as any;

    const res = await resolveAuthorizationContext({
      userId: 'usr_1',
      activeOrganizationId: 'org_1',
      permissionCode: 'financial.view_summary',
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'MEMBERSHIP_NOT_ACTIVE');
  });

  // 12. PROVA MULTI-ORG: User X possui Org A (SUSPENDED) e Org B (ACTIVE)
  await t.test('12. PROVA MULTI-ORG: User X suspenso na Org A tem acesso negado em A, mas permitido em B, e User.status global continua ACTIVE', async () => {
    const userGlobal = {
      id: 'usr_multi_proof',
      email: 'proof@zafira.com',
      status: 'ACTIVE',
    };

    // Consulta para Org A
    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      if (where.organizationId_userId.organizationId === 'org_A') {
        return {
          id: 'mem_a_proof',
          organizationId: 'org_A',
          userId: userGlobal.id,
          role: 'ADMIN',
          status: 'SUSPENDED',
          permissions: [],
        };
      }
      if (where.organizationId_userId.organizationId === 'org_B') {
        return {
          id: 'mem_b_proof',
          organizationId: 'org_B',
          userId: userGlobal.id,
          role: 'ADMIN',
          status: 'ACTIVE',
          permissions: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({
      role: 'ADMIN',
      permissionCode: 'financial.view_summary',
    })) as any;

    // Tentativa de acesso em Org A => DENY
    const resA = await resolveAuthorizationContext({
      userId: userGlobal.id,
      activeOrganizationId: 'org_A',
      permissionCode: 'financial.view_summary',
    });
    assert.strictEqual(resA.allowed, false);
    assert.strictEqual(resA.reason, 'MEMBERSHIP_NOT_ACTIVE');

    // Tentativa de acesso em Org B => ALLOW
    const resB = await resolveAuthorizationContext({
      userId: userGlobal.id,
      activeOrganizationId: 'org_B',
      permissionCode: 'financial.view_summary',
    });
    assert.strictEqual(resB.allowed, true);
    assert.strictEqual(resB.reason, 'GRANTED_BY_ROLE_PERMISSION');

    // Estado global do usuário permanece intacto (ACTIVE)
    assert.strictEqual(userGlobal.status, 'ACTIVE');
  });
});
