import test from 'node:test';
import assert from 'node:assert';
import argon2 from 'argon2';
import { UsersService, UserAdminError } from '../users.service.js';
import { hashInvitationToken } from '../invitation-token.js';

test('UsersService - Unit Tests', async (t) => {
  const orgA = 'org_alpha';
  const orgB = 'org_beta';
  const actorUserId = 'usr_actor_admin';

  // In-memory mock store
  const organizations = new Map<string, any>();
  const users = new Map<string, any>();
  const memberships = new Map<string, any>();
  const invitations = new Map<string, any>();
  const memberPermissions = new Map<string, any>();
  const clientAssignments = new Map<string, any>();
  const clients = new Map<string, any>();
  const auditLogs: any[] = [];
  const permissionsCatalog = [
    { code: 'clients.view', area: 'clients', description: 'Visualizar clientes' },
    { code: 'users.view', area: 'users', description: 'Visualizar usuários' },
    { code: 'users.invite', area: 'users', description: 'Convidar usuários' },
    { code: 'users.edit_permissions', area: 'users', description: 'Editar permissões' },
    { code: 'admin.configure_organization', area: 'admin', description: 'Configurar organização' },
  ];
  const rolePermissionsCatalog = [
    { role: 'ADMIN', permissionCode: 'clients.view' },
    { role: 'ADMIN', permissionCode: 'users.view' },
    { role: 'ADMIN', permissionCode: 'users.invite' },
    { role: 'ADMIN', permissionCode: 'users.edit_permissions' },
    { role: 'ADMIN', permissionCode: 'admin.configure_organization' },
    { role: 'MANAGER', permissionCode: 'clients.view' },
    { role: 'MANAGER', permissionCode: 'users.view' },
    { role: 'MEMBER', permissionCode: 'clients.view' },
  ];

  function resetStores() {
    organizations.clear();
    users.clear();
    memberships.clear();
    invitations.clear();
    memberPermissions.clear();
    clientAssignments.clear();
    clients.clear();
    auditLogs.length = 0;

    organizations.set(orgA, { id: orgA, name: 'Organization Alpha', slug: 'org-alpha' });
    organizations.set(orgB, { id: orgB, name: 'Organization Beta', slug: 'org-beta' });
  }

  // Mock Prisma Client
  const mockDb: any = {
    organization: {
      findUnique: async ({ where }: any) => {
        return organizations.get(where.id) || null;
      },
    },
    user: {
      findUnique: async ({ where, include }: any) => {
        if (where.email) {
          for (const u of users.values()) {
            if (u.email === where.email) {
              const targetOrg = include?.memberships?.where?.organizationId;
              const mems = Array.from(memberships.values()).filter(
                (m) => m.userId === u.id && (!targetOrg || m.organizationId === targetOrg)
              );
              return { ...u, memberships: mems };
            }
          }
          return null;
        }
        if (where.id) {
          return users.get(where.id) || null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = data.id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const userObj = {
          id,
          name: data.name,
          email: data.email,
          status: data.status || 'ACTIVE',
          passwordHash: data.passwordHash || null,
          avatarUrl: data.avatarUrl || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.set(id, userObj);
        return userObj;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        const u = users.get(where.id);
        if (u) {
          if (!where.status || u.status === where.status) {
            Object.assign(u, data, { updatedAt: new Date() });
            count = 1;
          }
        }
        return { count };
      },
    },
    organizationMember: {
      findMany: async ({ where, orderBy, take }: any) => {
        let list = Array.from(memberships.values()).filter((m) => m.organizationId === where.organizationId);
        if (where.role) list = list.filter((m) => m.role === where.role);
        if (where.status) list = list.filter((m) => m.status === where.status);
        if (where.user?.OR) {
          list = list.filter((m) => {
            const u = users.get(m.userId);
            if (!u) return false;
            const search = where.user.OR[0].name.contains.toLowerCase();
            return u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
          });
        }
        if (where.AND) {
          for (const cond of where.AND) {
            if (cond.OR) {
              const ltDate = cond.OR[0].createdAt.lt;
              const eqDate = cond.OR[1].createdAt;
              const ltId = cond.OR[1].id.lt;
              list = list.filter(
                (m) => m.createdAt < ltDate || (m.createdAt.getTime() === eqDate.getTime() && m.id < ltId)
              );
            }
          }
        }
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id > a.id ? 1 : -1));
        const sliced = typeof take === 'number' ? list.slice(0, take) : list;
        return sliced.map((m) => ({
          ...m,
          user: users.get(m.userId),
          _count: {
            clientAssignments: Array.from(clientAssignments.values()).filter((ca) => ca.organizationMemberId === m.id).length,
          },
        }));
      },
      findUnique: async ({ where, include }: any) => {
        let mem: any = null;
        if (where.id) {
          mem = memberships.get(where.id);
        } else if (where.organizationId_id) {
          mem = Array.from(memberships.values()).find(
            (m) => m.organizationId === where.organizationId_id.organizationId && m.id === where.organizationId_id.id
          );
        } else if (where.organizationId_userId) {
          mem = Array.from(memberships.values()).find(
            (m) => m.organizationId === where.organizationId_userId.organizationId && m.userId === where.organizationId_userId.userId
          );
        }
        if (!mem) return null;

        const u = users.get(mem.userId);
        const ca = Array.from(clientAssignments.values())
          .filter((a) => a.organizationMemberId === mem.id)
          .map((a) => ({ ...a, client: clients.get(a.clientId) }));
        const perms = Array.from(memberPermissions.values()).filter((p) => p.organizationMemberId === mem.id);
        const inv = Array.from(invitations.values()).find((i) => i.organizationMemberId === mem.id) || null;

        return {
          ...mem,
          user: u,
          clientAssignments: ca,
          permissions: perms,
          invitation: inv,
        };
      },
      count: async ({ where }: any) => {
        return Array.from(memberships.values()).filter((m) => {
          if (where.organizationId && m.organizationId !== where.organizationId) return false;
          if (where.role && m.role !== where.role) return false;
          if (where.status && m.status !== where.status) return false;
          if (where.user?.status) {
            const u = users.get(m.userId);
            if (!u || u.status !== where.user.status) return false;
          }
          return true;
        }).length;
      },
      create: async ({ data }: any) => {
        const id = data.id || `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const memObj = {
          id,
          organizationId: data.organizationId,
          userId: data.userId,
          role: data.role || 'MEMBER',
          status: data.status || 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memberships.set(id, memObj);
        return memObj;
      },
      update: async ({ where, data }: any) => {
        const mem = memberships.get(where.id);
        if (!mem) throw new Error('Not found');
        Object.assign(mem, data, { updatedAt: new Date() });
        return mem;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        const mem = memberships.get(where.id);
        if (mem) {
          if (
            (!where.organizationId || mem.organizationId === where.organizationId) &&
            (!where.status || mem.status === where.status)
          ) {
            Object.assign(mem, data, { updatedAt: new Date() });
            count = 1;
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        const mem = memberships.get(where.id);
        if (mem) memberships.delete(where.id);
        return mem;
      },
    },
    organizationInvitation: {
      findUnique: async ({ where, include }: any) => {
        let inv: any = null;
        if (where.tokenHash) {
          inv = Array.from(invitations.values()).find((i) => i.tokenHash === where.tokenHash);
        } else if (where.id) {
          inv = invitations.get(where.id);
        }
        if (!inv) return null;

        const org = organizations.get(inv.organizationId);
        const mem = memberships.get(inv.organizationMemberId);
        const u = mem ? users.get(mem.userId) : null;

        return {
          ...inv,
          organization: org,
          member: mem ? { ...mem, user: u } : null,
        };
      },
      create: async ({ data }: any) => {
        const id = data.id || `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const invObj = {
          id,
          organizationId: data.organizationId,
          organizationMemberId: data.organizationMemberId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          acceptedAt: data.acceptedAt || null,
          createdByUserId: data.createdByUserId || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        invitations.set(id, invObj);
        return invObj;
      },
      update: async ({ where, data }: any) => {
        const inv = invitations.get(where.id);
        if (!inv) throw new Error('Not found');
        Object.assign(inv, data, { updatedAt: new Date() });
        return inv;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        const inv = invitations.get(where.id);
        if (inv) {
          if (where.acceptedAt === null && inv.acceptedAt !== null) {
            return { count: 0 };
          }
          Object.assign(inv, data, { updatedAt: new Date() });
          count = 1;
        }
        return { count };
      },
    },
    organizationMemberPermission: {
      findMany: async ({ where }: any) => {
        return Array.from(memberPermissions.values()).filter((p) => p.organizationMemberId === where.organizationMemberId);
      },
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.organizationMemberId_permissionCode.organizationMemberId}_${where.organizationMemberId_permissionCode.permissionCode}`;
        const existing = memberPermissions.get(key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const newObj = { ...create };
        memberPermissions.set(key, newObj);
        return newObj;
      },
      deleteMany: async ({ where }: any) => {
        for (const [key, p] of memberPermissions.entries()) {
          if (p.organizationMemberId === where.organizationMemberId) {
            if (!where.permissionCode || p.permissionCode === where.permissionCode) {
              memberPermissions.delete(key);
            }
          }
        }
        return { count: 1 };
      },
    },
    userClientAssignment: {
      findMany: async ({ where }: any) => {
        return Array.from(clientAssignments.values()).filter((a) => a.organizationMemberId === where.organizationMemberId);
      },
      createMany: async ({ data }: any) => {
        for (const item of data) {
          const key = `${item.organizationMemberId}_${item.clientId}`;
          clientAssignments.set(key, item);
        }
        return { count: data.length };
      },
      deleteMany: async ({ where }: any) => {
        for (const [key, a] of clientAssignments.entries()) {
          if (a.organizationMemberId === where.organizationMemberId) {
            clientAssignments.delete(key);
          }
        }
        return { count: 1 };
      },
    },
    teamMember: {
      deleteMany: async () => ({ count: 0 }),
    },
    client: {
      findMany: async ({ where }: any) => {
        return Array.from(clients.values()).filter((c) => {
          if (c.organizationId !== where.organizationId) return false;
          if (where.id?.in && !where.id.in.includes(c.id)) return false;
          return true;
        });
      },
      updateMany: async ({ where, data }: any) => {
        for (const c of clients.values()) {
          if (c.organizationId === where.organizationId && c.responsibleUserId === where.responsibleUserId) {
            Object.assign(c, data);
          }
        }
        return { count: 1 };
      },
    },
    permission: {
      findMany: async () => permissionsCatalog,
    },
    rolePermission: {
      findMany: async ({ where }: any) => {
        return rolePermissionsCatalog.filter((rp) => rp.role === where.role);
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const entry = { id: `aud_${Date.now()}`, ...data, createdAt: new Date() };
        auditLogs.push(entry);
        return entry;
      },
    },
    $transaction: async (fn: any) => fn(mockDb),
  };

  const service = new UsersService(mockDb);

  // Helper de setup
  function setupBasicOrg() {
    resetStores();
    // Admin A
    users.set('usr_admin_a', { id: 'usr_admin_a', name: 'Admin A', email: 'admin_a@org.com', status: 'ACTIVE', passwordHash: 'hash_secret', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });
    memberships.set('mem_admin_a', { id: 'mem_admin_a', organizationId: orgA, userId: 'usr_admin_a', role: 'ADMIN', status: 'ACTIVE', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });

    // Member A
    users.set('usr_member_a', { id: 'usr_member_a', name: 'Member A', email: 'member_a@org.com', status: 'ACTIVE', passwordHash: 'hash_secret', createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') });
    memberships.set('mem_member_a', { id: 'mem_member_a', organizationId: orgA, userId: 'usr_member_a', role: 'MEMBER', status: 'ACTIVE', createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') });

    // Client A1
    clients.set('cli_a1', { id: 'cli_a1', organizationId: orgA, name: 'Client A1', responsibleUserId: 'usr_member_a' });
    clients.set('cli_b1', { id: 'cli_b1', organizationId: orgB, name: 'Client B1', responsibleUserId: null });
  }

  // --- 1 a 4. LIST ---
  await t.test('1 a 4. listMembers lista somente tenant atual, respeita filtros, paginação e não vaza passwordHash', async () => {
    setupBasicOrg();

    // Membro de outra org
    users.set('usr_org_b', { id: 'usr_org_b', name: 'User Org B', email: 'user@orgb.com', status: 'ACTIVE', passwordHash: 'hash' });
    memberships.set('mem_org_b', { id: 'mem_org_b', organizationId: orgB, userId: 'usr_org_b', role: 'ADMIN', status: 'ACTIVE', createdAt: new Date() });

    const result = await service.listMembers(orgA, { limit: 10 });
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items.every((i) => i.email !== 'user@orgb.com'), true);
    assert.strictEqual((result.items[0] as any).passwordHash, undefined);

    // Filtro por role
    const filtered = await service.listMembers(orgA, { role: 'ADMIN' });
    assert.strictEqual(filtered.items.length, 1);
    assert.strictEqual(filtered.items[0].role, 'ADMIN');

    // Filtro por search
    const searched = await service.listMembers(orgA, { search: 'member_a' });
    assert.strictEqual(searched.items.length, 1);
    assert.strictEqual(searched.items[0].email, 'member_a@org.com');
  });

  // --- 5 a 12. INVITE ---
  await t.test('5. inviteUser com novo User cria User INVITED, Membership INVITED, OrganizationInvitation e AuditLogs', async () => {
    setupBasicOrg();

    const inv = await service.inviteUser(orgA, actorUserId, { name: 'Novo Convidado', email: 'novo@convidado.com' });
    assert.strictEqual(inv.role, 'MEMBER');
    assert.strictEqual(inv.membershipStatus, 'INVITED');
    assert.ok(inv.invitation);
    assert.ok(inv.invitation.token);
    assert.strictEqual(inv.invitation.acceptPath, `/invite?token=${inv.invitation.token}`);

    const userInDb = users.get(inv.userId);
    assert.strictEqual(userInDb.status, 'INVITED');
    assert.strictEqual(userInDb.passwordHash, null);

    const invInDb = Array.from(invitations.values()).find((i) => i.organizationMemberId === inv.membershipId);
    assert.ok(invInDb);
    assert.strictEqual(invInDb.tokenHash, hashInvitationToken(inv.invitation.token));
    assert.notStrictEqual(invInDb.tokenHash, inv.invitation.token);

    const auditInvited = auditLogs.find((a) => a.action === 'user.invited');
    assert.ok(auditInvited);
    assert.strictEqual(auditInvited.organizationId, orgA);
    assert.strictEqual(auditInvited.actorUserId, actorUserId);

    const auditIssued = auditLogs.find((a) => a.action === 'user.invitation_issued');
    assert.ok(auditIssued);
    // Prova de que o AuditLog NUNCA contém token bruto ou hash
    assert.strictEqual(JSON.stringify(auditIssued).includes(inv.invitation.token), false);
    assert.strictEqual(JSON.stringify(auditIssued).includes(invInDb.tokenHash), false);
  });

  await t.test('6. inviteUser com User ACTIVE existente cria apenas membership INVITED sem sobrescrever user', async () => {
    setupBasicOrg();
    users.set('usr_existing_global', {
      id: 'usr_existing_global',
      name: 'Global User',
      email: 'global@zafira.com',
      status: 'ACTIVE',
      passwordHash: 'hash_original',
    });

    const inv = await service.inviteUser(orgA, actorUserId, { name: 'Ignorado', email: 'global@zafira.com' });
    assert.strictEqual(inv.userId, 'usr_existing_global');
    assert.strictEqual(inv.membershipStatus, 'INVITED');
    assert.ok(inv.invitation.token);

    const userInDb = users.get('usr_existing_global');
    assert.strictEqual(userInDb.name, 'Global User');
    assert.strictEqual(userInDb.passwordHash, 'hash_original');
  });

  await t.test('7 a 10. inviteUser trata conflitos: USER_GLOBALLY_INACTIVE, USER_ALREADY_MEMBER, INVITATION_ALREADY_PENDING, USER_MEMBERSHIP_SUSPENDED', async () => {
    setupBasicOrg();

    // 7. User INACTIVE
    users.set('usr_inactive', { id: 'usr_inactive', name: 'Inativo', email: 'inativo@zafira.com', status: 'INACTIVE' });
    await assert.rejects(
      service.inviteUser(orgA, actorUserId, { name: 'Inativo', email: 'inativo@zafira.com' }),
      (err: any) => err instanceof UserAdminError && err.code === 'USER_GLOBALLY_INACTIVE' && err.statusCode === 409
    );

    // 8. Membership ACTIVE
    await assert.rejects(
      service.inviteUser(orgA, actorUserId, { name: 'Admin A', email: 'admin_a@org.com' }),
      (err: any) => err instanceof UserAdminError && err.code === 'USER_ALREADY_MEMBER' && err.statusCode === 409
    );

    // 9. Membership INVITED
    memberships.set('mem_invited', { id: 'mem_invited', organizationId: orgA, userId: 'usr_inv', status: 'INVITED' });
    users.set('usr_inv', { id: 'usr_inv', name: 'Inv', email: 'invited@org.com', status: 'INVITED' });
    await assert.rejects(
      service.inviteUser(orgA, actorUserId, { name: 'Inv', email: 'invited@org.com' }),
      (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_ALREADY_PENDING' && err.statusCode === 409
    );

    // 10. Membership SUSPENDED
    memberships.set('mem_susp', { id: 'mem_susp', organizationId: orgA, userId: 'usr_susp', status: 'SUSPENDED' });
    users.set('usr_susp', { id: 'usr_susp', name: 'Susp', email: 'susp@org.com', status: 'ACTIVE' });
    await assert.rejects(
      service.inviteUser(orgA, actorUserId, { name: 'Susp', email: 'susp@org.com' }),
      (err: any) => err instanceof UserAdminError && err.code === 'USER_MEMBERSHIP_SUSPENDED' && err.statusCode === 409
    );
  });

  // --- REISSUE & ROTATION ---
  await t.test('11. reissueInvitation rotaciona token, invalida token anterior e renova expiresAt', async () => {
    setupBasicOrg();

    const invInitial = await service.inviteUser(orgA, actorUserId, { name: 'Rotação', email: 'rotacao@zafira.com' });
    const tokenA = invInitial.invitation.token;

    // Reissue
    const reissued = await service.reissueInvitation(orgA, actorUserId, invInitial.membershipId);
    const tokenB = reissued.invitation.token;

    assert.notStrictEqual(tokenA, tokenB);

    // Token A agora é inválido no inspect
    await assert.rejects(
      service.inspectInvitation(tokenA),
      (err: any) => err instanceof UserAdminError && err.code === 'INVALID_INVITATION_TOKEN' && err.statusCode === 400
    );

    // Token B é válido
    const inspectedB = await service.inspectInvitation(tokenB);
    assert.strictEqual(inspectedB.valid, true);
    assert.strictEqual(inspectedB.invitedUser.email, 'rotacao@zafira.com');
  });

  // --- INSPECT & ACCEPT ---
  await t.test('12. inspectInvitation valida token, expiração, já aceito e status do usuário', async () => {
    setupBasicOrg();

    const inv = await service.inviteUser(orgA, actorUserId, { name: 'Inspect Test', email: 'inspect@zafira.com' });
    const token = inv.invitation.token;

    // Sucesso
    const res = await service.inspectInvitation(token);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.organization.name, 'Organization Alpha');
    assert.strictEqual(res.requiresPassword, true);

    // Token expirado
    const invInDb = Array.from(invitations.values()).find((i) => i.organizationMemberId === inv.membershipId);
    invInDb.expiresAt = new Date('2020-01-01');

    await assert.rejects(
      service.inspectInvitation(token),
      (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_EXPIRED' && err.statusCode === 410
    );
  });

  await t.test('13. acceptInvitation para novo User ativa User (ACTIVE) com Argon2, ativa Membership e bloqueia reuso', async () => {
    setupBasicOrg();

    const inv = await service.inviteUser(orgA, actorUserId, { name: 'Novo Ativar', email: 'ativar@zafira.com' });
    const token = inv.invitation.token;

    // Rejeita sem senha
    await assert.rejects(
      service.acceptInvitation(token),
      (err: any) => err instanceof UserAdminError && err.code === 'PASSWORD_REQUIRED' && err.statusCode === 400
    );

    // Aceita com senha válida
    const acceptRes = await service.acceptInvitation(token, 'SenhaSegura123!');
    assert.strictEqual(acceptRes.success, true);

    const userInDb = users.get(inv.userId);
    assert.strictEqual(userInDb.status, 'ACTIVE');
    assert.ok(userInDb.passwordHash);
    const validPassword = await argon2.verify(userInDb.passwordHash, 'SenhaSegura123!');
    assert.strictEqual(validPassword, true);

    const memInDb = memberships.get(inv.membershipId);
    assert.strictEqual(memInDb.status, 'ACTIVE');

    // Segundo uso bloqueado
    await assert.rejects(
      service.acceptInvitation(token, 'SenhaSegura123!'),
      (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_ALREADY_ACCEPTED' && err.statusCode === 409
    );
  });

  await t.test('14. acceptInvitation para User ACTIVE existente proíbe envio de senha e preserva senha anterior', async () => {
    setupBasicOrg();

    users.set('usr_existing_act', {
      id: 'usr_existing_act',
      name: 'Existing Active',
      email: 'act@zafira.com',
      status: 'ACTIVE',
      passwordHash: 'hash_original_intacto',
    });

    const inv = await service.inviteUser(orgA, actorUserId, { name: 'Ignorado', email: 'act@zafira.com' });
    const token = inv.invitation.token;

    // Se tentar passar senha => 400 PASSWORD_NOT_ALLOWED_FOR_EXISTING_USER
    await assert.rejects(
      service.acceptInvitation(token, 'NovaSenhaInvalida123!'),
      (err: any) => err instanceof UserAdminError && err.code === 'PASSWORD_NOT_ALLOWED_FOR_EXISTING_USER' && err.statusCode === 400
    );

    // Aceita sem senha
    const acceptRes = await service.acceptInvitation(token);
    assert.strictEqual(acceptRes.success, true);

    const userInDb = users.get('usr_existing_act');
    assert.strictEqual(userInDb.status, 'ACTIVE');
    assert.strictEqual(userInDb.passwordHash, 'hash_original_intacto'); // PRESERVADO!

    const memInDb = memberships.get(inv.membershipId);
    assert.strictEqual(memInDb.status, 'ACTIVE');
  });

  await t.test('15. Multi-org invitation: User aceita Org A com senha, depois aceita Org B sem senha', async () => {
    setupBasicOrg();

    // 1. Convidar para Org A e Org B
    const invA = await service.inviteUser(orgA, actorUserId, { name: 'Multi Org User', email: 'multiorg@zafira.com' });
    const invB = await service.inviteUser(orgB, actorUserId, { name: 'Multi Org User', email: 'multiorg@zafira.com' });

    // 2. Aceita convite de Org A com senha
    await service.acceptInvitation(invA.invitation.token, 'SenhaOrgA123!');
    assert.strictEqual(users.get(invA.userId).status, 'ACTIVE');
    assert.strictEqual(memberships.get(invA.membershipId).status, 'ACTIVE');
    assert.strictEqual(memberships.get(invB.membershipId).status, 'INVITED');

    // 3. Aceita convite de Org B sem senha (pois o usuário global já está ACTIVE)
    await service.acceptInvitation(invB.invitation.token);
    assert.strictEqual(memberships.get(invB.membershipId).status, 'ACTIVE');
  });

  // --- 16 a 19. ROLE ---
  await t.test('16 a 19. updateRole altera role, protege último admin e rejeita cross-tenant', async () => {
    setupBasicOrg();

    // Alterar MEMBER -> MANAGER
    const res = await service.updateRole(orgA, actorUserId, 'mem_member_a', { role: 'MANAGER' });
    assert.strictEqual(res.role, 'MANAGER');

    // Tentar rebaixar o único ADMIN da org => 409 LAST_ACTIVE_ADMIN
    await assert.rejects(
      service.updateRole(orgA, actorUserId, 'mem_admin_a', { role: 'MEMBER' }),
      (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN' && err.statusCode === 409
    );

    // Cross tenant target => 404
    await assert.rejects(
      service.updateRole(orgB, actorUserId, 'mem_admin_a', { role: 'MEMBER' }),
      (err: any) => err instanceof UserAdminError && err.code === 'USER_NOT_FOUND' && err.statusCode === 404
    );
  });

  // --- 20 a 26. PERMISSIONS & MATRIX ---
  await t.test('20 a 26. updatePermissions e matriz: overrides, validação, proteção de lockout do último admin', async () => {
    setupBasicOrg();

    // 17. Atualizar override
    await service.updatePermissions(orgA, actorUserId, 'mem_member_a', {
      changes: [{ permissionCode: 'users.view', allowed: true }],
    });

    const detail = await service.getMemberDetail(orgA, 'mem_member_a');
    assert.strictEqual(detail.overrides.length, 1);
    assert.strictEqual(detail.overrides[0].permissionCode, 'users.view');
    assert.strictEqual(detail.overrides[0].allowed, true);

    const uv = detail.permissions.find((p) => p.code === 'users.view');
    assert.strictEqual(uv?.roleGranted, false);
    assert.strictEqual(uv?.override, true);
    assert.strictEqual(uv?.effective, true);

    // Validação de ADMIN
    const adminDetail = await service.getMemberDetail(orgA, 'mem_admin_a');
    const adminUv = adminDetail.permissions.find((p) => p.code === 'users.view');
    assert.strictEqual(adminUv?.roleGranted, true);
    assert.strictEqual(adminUv?.override, null);
    assert.strictEqual(adminUv?.effective, true);

    // Lockout do último admin
    await assert.rejects(
      service.updatePermissions(orgA, actorUserId, 'mem_admin_a', {
        changes: [{ permissionCode: 'users.edit_permissions', allowed: false }],
      }),
      (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN_LOCKOUT' && err.statusCode === 409
    );
  });

  // --- 27 a 30. ASSIGN CLIENTS ---
  await t.test('27 a 30. assignClients substitui carteira, rejeita cliente alien e audita', async () => {
    setupBasicOrg();

    // Rejeita cliente alien (cli_b1 de orgB)
    await assert.rejects(
      service.assignClients(orgA, actorUserId, 'mem_member_a', { clientIds: ['cli_b1'] }),
      (err: any) => err instanceof UserAdminError && err.code === 'CLIENT_NOT_IN_ORGANIZATION' && err.statusCode === 400
    );

    // Atribui cli_a1
    await service.assignClients(orgA, actorUserId, 'mem_member_a', { clientIds: ['cli_a1'] });
    const detail = await service.getMemberDetail(orgA, 'mem_member_a');
    assert.strictEqual(detail.assignedClients.length, 1);
    assert.strictEqual(detail.assignedClients[0].id, 'cli_a1');
  });

  // --- 31 a 36. STATUS ---
  await t.test('31 a 36. updateStatus: suspende, reativa, rejeita convite pendente e protege último admin', async () => {
    setupBasicOrg();

    // Suspender membro
    const res = await service.updateStatus(orgA, actorUserId, 'mem_member_a', { status: 'SUSPENDED' });
    assert.strictEqual(res.status, 'SUSPENDED');

    // Reativar membro
    const res2 = await service.updateStatus(orgA, actorUserId, 'mem_member_a', { status: 'ACTIVE' });
    assert.strictEqual(res2.status, 'ACTIVE');

    // Tentar suspender o único admin => 409
    await assert.rejects(
      service.updateStatus(orgA, actorUserId, 'mem_admin_a', { status: 'SUSPENDED' }),
      (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN' && err.statusCode === 409
    );
  });

  // --- 37 a 42. REMOVE ---
  await t.test('37 a 42. removeMember: remove apenas membership do tenant, preserva user global e limpa responsibleUserId', async () => {
    setupBasicOrg();

    const res = await service.removeMember(orgA, actorUserId, 'mem_member_a');
    assert.strictEqual(res.success, true);

    // Membership foi excluída
    assert.strictEqual(memberships.get('mem_member_a'), undefined);

    // User global preservado
    assert.ok(users.get('usr_member_a'));

    // Client.responsibleUserId limpo
    assert.strictEqual(clients.get('cli_a1').responsibleUserId, null);
  });
});
