import test from 'node:test';
import assert from 'node:assert';
import { UsersService, UserAdminError } from '../users.service.js';

test('UsersService - Unit Tests', async (t) => {
  const orgA = 'org_alpha';
  const orgB = 'org_beta';
  const actorUserId = 'usr_actor_admin';

  // In-memory mock store
  const users = new Map<string, any>();
  const memberships = new Map<string, any>();
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
    users.clear();
    memberships.clear();
    memberPermissions.clear();
    clientAssignments.clear();
    clients.clear();
    auditLogs.length = 0;
  }

  // Mock Prisma Client
  const mockDb: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.email) {
          for (const u of users.values()) {
            if (u.email === where.email) {
              const mems = Array.from(memberships.values()).filter(
                (m) => m.userId === u.id && (!where.include?.memberships?.where?.organizationId || m.organizationId === where.include.memberships.where.organizationId)
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
      findUnique: async ({ where }: any) => {
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

        return {
          ...mem,
          user: u,
          clientAssignments: ca,
          permissions: perms,
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
      delete: async ({ where }: any) => {
        const mem = memberships.get(where.id);
        if (mem) memberships.delete(where.id);
        return mem;
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
  await t.test('5. inviteUser com novo User cria User INVITED e Membership INVITED com role MEMBER e AuditLog', async () => {
    setupBasicOrg();

    const inv = await service.inviteUser(orgA, actorUserId, { name: 'Novo Convidado', email: 'novo@convidado.com' });
    assert.strictEqual(inv.role, 'MEMBER');
    assert.strictEqual(inv.membershipStatus, 'INVITED');

    const userInDb = users.get(inv.userId);
    assert.strictEqual(userInDb.status, 'INVITED');
    assert.strictEqual(userInDb.passwordHash, null);

    const audit = auditLogs.find((a) => a.action === 'user.invited');
    assert.ok(audit);
    assert.strictEqual(audit.organizationId, orgA);
    assert.strictEqual(audit.actorUserId, actorUserId);
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

  // --- 13 a 16. ROLE ---
  await t.test('13 a 16. updateRole altera role, protege último admin e rejeita cross-tenant', async () => {
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

  // --- 17 a 23. PERMISSIONS & MATRIX ---
  await t.test('17 a 23. updatePermissions e matriz: overrides, validação, proteção de lockout do último admin', async () => {
    setupBasicOrg();

    // 0. ADMIN sem override => roleGranted=true, override=null, effective=true
    const adminDetail = await service.getMemberDetail(orgA, 'mem_admin_a');
    const adminUserView = adminDetail.permissions.find((p) => p.code === 'users.view');
    assert.strictEqual(adminUserView?.roleGranted, true);
    assert.strictEqual(adminUserView?.override, null);
    assert.strictEqual(adminUserView?.effective, true);

    // 0b. MEMBER sem override e sem RolePermission users.view => roleGranted=false, override=null, effective=false
    const memberDetailInitial = await service.getMemberDetail(orgA, 'mem_member_a');
    const memberUserViewInitial = memberDetailInitial.permissions.find((p) => p.code === 'users.view');
    assert.strictEqual(memberUserViewInitial?.roleGranted, false);
    assert.strictEqual(memberUserViewInitial?.override, null);
    assert.strictEqual(memberUserViewInitial?.effective, false);

    // 17 & 18. Override true e false para member
    await service.updatePermissions(orgA, actorUserId, 'mem_member_a', {
      changes: [
        { permissionCode: 'users.invite', allowed: true },
        { permissionCode: 'clients.view', allowed: false },
      ],
    });

    const detail = await service.getMemberDetail(orgA, 'mem_member_a');
    const invPerm = detail.permissions.find((p) => p.code === 'users.invite');
    const viewPerm = detail.permissions.find((p) => p.code === 'clients.view');

    // users.invite: roleGranted=false, override=true, effective=true
    assert.strictEqual(invPerm?.roleGranted, false);
    assert.strictEqual(invPerm?.override, true);
    assert.strictEqual(invPerm?.effective, true);

    // clients.view: roleGranted=true, override=false, effective=false
    assert.strictEqual(viewPerm?.roleGranted, true);
    assert.strictEqual(viewPerm?.override, false);
    assert.strictEqual(viewPerm?.effective, false);

    // 19. Remover override com allowed: null
    await service.updatePermissions(orgA, actorUserId, 'mem_member_a', {
      changes: [{ permissionCode: 'users.invite', allowed: null }],
    });
    const detailAfter = await service.getMemberDetail(orgA, 'mem_member_a');
    const invPermAfter = detailAfter.permissions.find((p) => p.code === 'users.invite');
    assert.strictEqual(invPermAfter?.roleGranted, false);
    assert.strictEqual(invPermAfter?.override, null);
    assert.strictEqual(invPermAfter?.effective, false); // Member não tem users.invite default

    // 20. Permission code inválido
    await assert.rejects(
      service.updatePermissions(orgA, actorUserId, 'mem_member_a', {
        changes: [{ permissionCode: 'invalid.perm.code', allowed: true }],
      }),
      (err: any) => err instanceof UserAdminError && err.code === 'INVALID_PERMISSION_CODE' && err.statusCode === 400
    );

    // 22. Último admin não pode revogar users.edit_permissions de si mesmo
    await assert.rejects(
      service.updatePermissions(orgA, actorUserId, 'mem_admin_a', {
        changes: [{ permissionCode: 'users.edit_permissions', allowed: false }],
      }),
      (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN_LOCKOUT' && err.statusCode === 409
    );
  });

  // --- 24 a 27. CLIENT ASSIGNMENTS ---
  await t.test('24 a 27. assignClients substitui carteira, rejeita cliente alien e audita', async () => {
    setupBasicOrg();

    // Atribuir cliente válido de Org A
    const res = await service.assignClients(orgA, actorUserId, 'mem_member_a', { clientIds: ['cli_a1'] });
    assert.deepStrictEqual(res.clientIds, ['cli_a1']);

    // Tentar atribuir cliente de Org B => 400 CLIENT_NOT_IN_ORGANIZATION
    await assert.rejects(
      service.assignClients(orgA, actorUserId, 'mem_member_a', { clientIds: ['cli_b1'] }),
      (err: any) => err instanceof UserAdminError && err.code === 'CLIENT_NOT_IN_ORGANIZATION' && err.statusCode === 400
    );

    // Cross-tenant target => 404
    await assert.rejects(
      service.assignClients(orgB, actorUserId, 'mem_member_a', { clientIds: ['cli_b1'] }),
      (err: any) => err instanceof UserAdminError && err.code === 'USER_NOT_FOUND' && err.statusCode === 404
    );
  });

  // --- 28 a 33. STATUS (SUSPEND / REACTIVATE) ---
  await t.test('28 a 33. updateStatus: suspende, reativa, rejeita convite pendente e protege último admin', async () => {
    setupBasicOrg();

    // 28. Suspender Member A
    const susp = await service.updateStatus(orgA, actorUserId, 'mem_member_a', { status: 'SUSPENDED' });
    assert.strictEqual(susp.status, 'SUSPENDED');
    assert.strictEqual(users.get('usr_member_a').status, 'ACTIVE'); // status global intacto

    // 29. Reativar Member A
    const react = await service.updateStatus(orgA, actorUserId, 'mem_member_a', { status: 'ACTIVE' });
    assert.strictEqual(react.status, 'ACTIVE');

    // 30. INVITED não pode virar ACTIVE diretamente
    memberships.set('mem_inv', { id: 'mem_inv', organizationId: orgA, userId: 'usr_inv', status: 'INVITED' });
    users.set('usr_inv', { id: 'usr_inv', name: 'Inv', email: 'inv@org.com', status: 'INVITED' });
    await assert.rejects(
      service.updateStatus(orgA, actorUserId, 'mem_inv', { status: 'ACTIVE' }),
      (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_NOT_ACCEPTED' && err.statusCode === 409
    );

    // 31. Proteger último admin contra suspensão
    await assert.rejects(
      service.updateStatus(orgA, actorUserId, 'mem_admin_a', { status: 'SUSPENDED' }),
      (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN' && err.statusCode === 409
    );
  });

  // --- 34 a 39. REMOVE ---
  await t.test('34 a 39. removeMember: remove apenas membership do tenant, preserva user global e limpa responsibleUserId', async () => {
    setupBasicOrg();

    // Member A é responsável pelo Client A1
    assert.strictEqual(clients.get('cli_a1').responsibleUserId, 'usr_member_a');

    // Remover Member A da Org A
    const rem = await service.removeMember(orgA, actorUserId, 'mem_member_a');
    assert.strictEqual(rem.success, true);

    // Membership removida
    assert.strictEqual(memberships.get('mem_member_a'), undefined);

    // User global preservado
    assert.ok(users.get('usr_member_a'));

    // Client.responsibleUserId limpo no tenant
    assert.strictEqual(clients.get('cli_a1').responsibleUserId, null);

    // Último admin não pode ser removido
    await assert.rejects(
      service.removeMember(orgA, actorUserId, 'mem_admin_a'),
      (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN' && err.statusCode === 409
    );
  });
});
