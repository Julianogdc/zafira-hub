import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { hashInvitationToken } from '../invitation-token.js';

test('Invitations Routes - HTTP Integration Tests', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindUniqueInvitation = (prisma as any).organizationInvitation?.findUnique;
  const originalCreateInvitation = (prisma as any).organizationInvitation?.create;
  const originalUpdateInvitation = (prisma as any).organizationInvitation?.update;
  const originalUpdateManyInvitation = (prisma as any).organizationInvitation?.updateMany;
  const originalUpdateManyMember = prisma.organizationMember.updateMany;
  const originalUpdateManyUser = prisma.user.updateMany;
  const originalCreateUser = prisma.user.create;
  const originalCreateMember = prisma.organizationMember.create;
  const originalCreateAudit = (prisma as any).auditLog.create;
  const originalRolePermFindUnique = (prisma as any).rolePermission.findUnique;
  const originalTransaction = prisma.$transaction;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    if ((prisma as any).organizationInvitation) {
      (prisma as any).organizationInvitation.findUnique = originalFindUniqueInvitation;
      (prisma as any).organizationInvitation.create = originalCreateInvitation;
      (prisma as any).organizationInvitation.update = originalUpdateInvitation;
      (prisma as any).organizationInvitation.updateMany = originalUpdateManyInvitation;
    }
    prisma.organizationMember.updateMany = originalUpdateManyMember;
    prisma.user.updateMany = originalUpdateManyUser;
    prisma.user.create = originalCreateUser;
    prisma.organizationMember.create = originalCreateMember;
    (prisma as any).auditLog.create = originalCreateAudit;
    (prisma as any).rolePermission.findUnique = originalRolePermFindUnique;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgId = 'org_alpha';
  const otherOrgId = 'org_beta';
  const adminUserId = 'usr_admin';

  // In-memory store for invitations routes testing
  const mockUsers = new Map<string, any>();
  const mockMembers = new Map<string, any>();
  const mockInvitations = new Map<string, any>();
  const mockAuditLogs: any[] = [];

  function resetStores() {
    mockUsers.clear();
    mockMembers.clear();
    mockInvitations.clear();
    mockAuditLogs.length = 0;

    mockUsers.set(adminUserId, {
      id: adminUserId,
      name: 'Admin Test',
      email: 'admin@zafira.test',
      status: 'ACTIVE',
      memberships: [{ id: 'mem_admin', organizationId: orgId, role: 'ADMIN', status: 'ACTIVE', organization: { id: orgId, name: 'Org Alpha', slug: 'org-alpha' } }],
    });

    mockMembers.set('mem_admin', {
      id: 'mem_admin',
      organizationId: orgId,
      userId: adminUserId,
      role: 'ADMIN',
      status: 'ACTIVE',
      user: mockUsers.get(adminUserId),
    });
  }

  function setupMocks() {
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.email) {
        for (const u of mockUsers.values()) {
          if (u.email === where.email) return u;
        }
        return null;
      }
      if (where.id) return mockUsers.get(where.id) || null;
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      let m: any = null;
      if (where.organizationId_userId) {
        m = Array.from(mockMembers.values()).find(
          (item) => item.organizationId === where.organizationId_userId.organizationId && item.userId === where.organizationId_userId.userId
        );
      } else if (where.organizationId_id) {
        m = Array.from(mockMembers.values()).find(
          (item) => item.organizationId === where.organizationId_id.organizationId && item.id === where.organizationId_id.id
        );
      } else if (where.id) {
        m = mockMembers.get(where.id);
      }

      if (m) {
        const inv = Array.from(mockInvitations.values()).find((i) => i.organizationMemberId === m.id);
        return { ...m, user: mockUsers.get(m.userId), invitation: inv || null, permissions: [] };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      if (where.role_permissionCode.role === 'ADMIN') {
        return { role: 'ADMIN', permissionCode: where.role_permissionCode.permissionCode };
      }
      return null;
    }) as any;

    (prisma as any).organizationInvitation = {
      findUnique: async ({ where }: any) => {
        if (where.tokenHash) {
          const inv = Array.from(mockInvitations.values()).find((i) => i.tokenHash === where.tokenHash);
          if (!inv) return null;
          const mem = mockMembers.get(inv.organizationMemberId);
          const u = mem ? mockUsers.get(mem.userId) : null;
          return {
            ...inv,
            organization: { id: inv.organizationId, name: 'Org Alpha', slug: 'org-alpha' },
            member: mem ? { ...mem, user: u } : null,
          };
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = `inv_${Date.now()}`;
        const obj = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        mockInvitations.set(id, obj);
        return obj;
      },
      update: async ({ where, data }: any) => {
        const inv = mockInvitations.get(where.id);
        if (inv) Object.assign(inv, data);
        return inv;
      },
      updateMany: async ({ where, data }: any) => {
        const inv = mockInvitations.get(where.id);
        if (inv && (where.acceptedAt === null && inv.acceptedAt === null)) {
          Object.assign(inv, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    };

    prisma.organizationMember.create = (async ({ data }: any) => {
      const id = `mem_${Date.now()}`;
      const obj = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      mockMembers.set(id, obj);
      return obj;
    }) as any;

    prisma.user.create = (async ({ data }: any) => {
      const id = `usr_${Date.now()}`;
      const obj = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      mockUsers.set(id, obj);
      return obj;
    }) as any;

    prisma.organizationMember.updateMany = (async ({ where, data }: any) => {
      const m = mockMembers.get(where.id);
      if (m && m.status === where.status && m.organizationId === where.organizationId) {
        Object.assign(m, data);
        return { count: 1 };
      }
      return { count: 0 };
    }) as any;

    prisma.user.updateMany = (async ({ where, data }: any) => {
      const u = mockUsers.get(where.id);
      if (u && u.status === where.status) {
        Object.assign(u, data);
        return { count: 1 };
      }
      return { count: 0 };
    }) as any;

    (prisma as any).auditLog.create = (async ({ data }: any) => {
      const log = { id: `aud_${Date.now()}`, ...data };
      mockAuditLogs.push(log);
      return log;
    }) as any;
  }

  // 1 & 2. POST /api/v1/users/invite retorna token uma vez e token != hash
  await t.test('1 e 2. POST /api/v1/users/invite retorna token bruto na resposta e grava apenas hash', async () => {
    resetStores();
    setupMocks();

    const jwtToken = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgId });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${jwtToken}` },
      payload: { name: 'Convidado HTTP', email: 'convidado@http.test' },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.status, 'success');
    assert.ok(body.data.invitation.token);
    assert.strictEqual(body.data.invitation.acceptPath, `/invite?token=${body.data.invitation.token}`);

    const storedInv = Array.from(mockInvitations.values())[0];
    assert.ok(storedInv);
    assert.strictEqual(storedInv.tokenHash, hashInvitationToken(body.data.invitation.token));
    assert.notStrictEqual(storedInv.tokenHash, body.data.invitation.token);
  });

  // 3, 4, 5. Reissue de convite
  await t.test('3, 4 e 5. Reissue de convite: sucesso autorizado, 404 cross-tenant e 403 para API key', async () => {
    resetStores();
    setupMocks();

    const jwtToken = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgId });

    // Criar membro INVITED
    mockUsers.set('usr_pending', { id: 'usr_pending', email: 'pending@test.com', status: 'INVITED' });
    mockMembers.set('mem_pending', { id: 'mem_pending', organizationId: orgId, userId: 'usr_pending', role: 'MEMBER', status: 'INVITED' });
    mockInvitations.set('inv_p1', { id: 'inv_p1', organizationId: orgId, organizationMemberId: 'mem_pending', tokenHash: 'hash_old', expiresAt: new Date(), acceptedAt: null });

    // Sucesso
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/mem_pending/invitation',
      headers: { authorization: `Bearer ${jwtToken}` },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.data.invitation.token);

    // Cross-tenant => 404
    mockUsers.get(adminUserId).memberships.push({
      id: 'mem_admin_beta',
      organizationId: otherOrgId,
      role: 'ADMIN',
      status: 'ACTIVE',
      organization: { id: otherOrgId, name: 'Org Beta', slug: 'org-beta' },
    });
    mockMembers.set('mem_admin_beta', {
      id: 'mem_admin_beta',
      organizationId: otherOrgId,
      userId: adminUserId,
      role: 'ADMIN',
      status: 'ACTIVE',
      user: mockUsers.get(adminUserId),
    });

    const jwtOther = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: otherOrgId });
    const resCross = await app.inject({
      method: 'POST',
      url: '/api/v1/users/mem_pending/invitation',
      headers: { authorization: `Bearer ${jwtOther}` },
    });
    assert.strictEqual(resCross.statusCode, 404);

    // API Key => 403 MACHINE_CREDENTIAL_NOT_ALLOWED
    const originalKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_test_key_123';
    try {
      const resApiKey = await app.inject({
        method: 'POST',
        url: '/api/v1/users/mem_pending/invitation',
        headers: { 'x-api-key': 'secret_test_key_123' },
      });
      assert.strictEqual(resApiKey.statusCode, 403);
      const bodyKey = JSON.parse(resApiKey.body);
      assert.strictEqual(bodyKey.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalKey;
    }
  });

  // 6, 7, 8. Inspect público
  await t.test('6, 7 e 8. Inspect público: 200 para válido, 400 para inválido, 410 para expirado', async () => {
    resetStores();
    setupMocks();

    const rawToken = 'raw-test-token-abcdef123456';
    const hash = hashInvitationToken(rawToken);

    mockUsers.set('usr_inspect', { id: 'usr_inspect', name: 'Inspect User', email: 'inspect@http.test', status: 'INVITED' });
    mockMembers.set('mem_inspect', { id: 'mem_inspect', organizationId: orgId, userId: 'usr_inspect', role: 'MEMBER', status: 'INVITED' });
    mockInvitations.set('inv_insp', {
      id: 'inv_insp',
      organizationId: orgId,
      organizationMemberId: 'mem_inspect',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null,
    });

    // 6. Inspect válido => 200
    const resValid = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/inspect',
      payload: { token: rawToken },
    });
    assert.strictEqual(resValid.statusCode, 200);
    const body = JSON.parse(resValid.payload);
    assert.strictEqual(body.data.valid, true);
    assert.strictEqual(body.data.invitedUser.email, 'inspect@http.test');
    assert.strictEqual(body.data.requiresPassword, true);

    // 7. Inspect token inválido => 400
    const resInvalid = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/inspect',
      payload: { token: 'token-inexistente' },
    });
    assert.strictEqual(resInvalid.statusCode, 400);

    // 8. Inspect expirado => 410
    mockInvitations.get('inv_insp').expiresAt = new Date('2020-01-01');
    const resExp = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/inspect',
      payload: { token: rawToken },
    });
    assert.strictEqual(resExp.statusCode, 410);
  });

  // 9, 10, 11. Accept novo usuário
  await t.test('9, 10 e 11. Accept novo User: sem senha => 400, com senha => 200, reuso => 409', async () => {
    resetStores();
    setupMocks();

    const rawToken = 'raw-accept-token-1234567890';
    const hash = hashInvitationToken(rawToken);

    mockUsers.set('usr_acc', { id: 'usr_acc', name: 'Accept User', email: 'accept@http.test', status: 'INVITED' });
    mockMembers.set('mem_acc', { id: 'mem_acc', organizationId: orgId, userId: 'usr_acc', role: 'MEMBER', status: 'INVITED' });
    mockInvitations.set('inv_acc', {
      id: 'inv_acc',
      organizationId: orgId,
      organizationMemberId: 'mem_acc',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null,
    });

    // 9. Sem senha => 400 PASSWORD_REQUIRED
    const resNoPass = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token: rawToken },
    });
    assert.strictEqual(resNoPass.statusCode, 400);

    // 10. Com senha válida => 200
    const resSuccess = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token: rawToken, password: 'MinhaSenhaSegura123!' },
    });
    assert.strictEqual(resSuccess.statusCode, 200);

    // 11. Reuso do token => 409
    const resReuse = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token: rawToken, password: 'MinhaSenhaSegura123!' },
    });
    assert.strictEqual(resReuse.statusCode, 409);
  });

  // 12 e 13. Accept usuário já ativo
  await t.test('12 e 13. Accept User ACTIVE: com senha => 400, sem senha => 200', async () => {
    resetStores();
    setupMocks();

    const rawToken = 'raw-active-user-token-999';
    const hash = hashInvitationToken(rawToken);

    mockUsers.set('usr_act_acc', { id: 'usr_act_acc', name: 'Active User', email: 'active@http.test', status: 'ACTIVE', passwordHash: 'hash_intacto' });
    mockMembers.set('mem_act_acc', { id: 'mem_act_acc', organizationId: orgId, userId: 'usr_act_acc', role: 'MEMBER', status: 'INVITED' });
    mockInvitations.set('inv_act_acc', {
      id: 'inv_act_acc',
      organizationId: orgId,
      organizationMemberId: 'mem_act_acc',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null,
    });

    // 12. Com senha => 400 PASSWORD_NOT_ALLOWED_FOR_EXISTING_USER
    const resWithPass = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token: rawToken, password: 'TentativaDeTrocarSenha' },
    });
    assert.strictEqual(resWithPass.statusCode, 400);

    // 13. Sem senha => 200
    const resNoPass = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token: rawToken },
    });
    assert.strictEqual(resNoPass.statusCode, 200);
  });
});
