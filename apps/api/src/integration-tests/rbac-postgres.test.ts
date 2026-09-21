import test from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';
import { resolveAuthorizationContext } from '../modules/authorization/resolver.js';
import { ClientsService } from '../modules/clients/clients.service.js';
import { PERMISSIONS, ADMIN_DEFAULTS, MANAGER_DEFAULTS, MEMBER_DEFAULTS } from '@zafira/domain';

// --- GUARD DE SEGURANÇA (ETAPA F) ---
if (process.env.NODE_ENV === 'production') {
  throw new Error('NÃO É PERMITIDO EXECUTAR TESTES DE INTEGRAÇÃO EM PRODUÇÃO');
}

if (process.env.ZAFIRA_TEST_DATABASE !== '1') {
  throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatório para testes de integração');
}

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.includes('/zafira_hub_ci')) {
  throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');
}

const prisma = new PrismaClient();

test('Integration Gate: PostgreSQL RBAC, Constraints e ClientService', async (t) => {

  await t.test('J - Testes Reais de Migration', async () => {
    const migrations = await prisma.$queryRaw<any[]>`SELECT * FROM _prisma_migrations`;
    assert.strictEqual(migrations.length, 10, 'Deve haver exatamente 10 migrations aplicadas');
    for (const mig of migrations) {
      assert.ok(mig.finished_at, `Migration ${mig.migration_name} não foi finalizada`);
    }
  });

  await t.test('K - Testes Reais do Catálogo (Idempotência provada externamente por 2 runs)', async () => {
    // Check Permissions count
    const perms = await prisma.permission.count();
    assert.strictEqual(perms, PERMISSIONS.length, 'Total de permissões no banco deve bater com array canônico');

    // Check RolePermissions count and exactness
    const roles = ['ADMIN', 'MANAGER', 'MEMBER'];
    for (const r of roles) {
      let expectedCount = 0;
      if (r === 'ADMIN') expectedCount = ADMIN_DEFAULTS.length;
      if (r === 'MANAGER') expectedCount = MANAGER_DEFAULTS.length;
      if (r === 'MEMBER') expectedCount = MEMBER_DEFAULTS.length;

      const dbPerms = await prisma.rolePermission.count({ where: { role: r } });
      assert.strictEqual(dbPerms, expectedCount, `Role ${r} deve ter exatamente ${expectedCount} defaults`);
    }
  });

  await t.test('L - Testes de Constraint DB-Level', async () => {
    // Org A
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });

    // Users and Memberships
    const memberAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'member_a@zafira.test' } });
    const memberAMem = await prisma.organizationMember.findUniqueOrThrow({ 
      where: { organizationId_userId: { organizationId: orgA.id, userId: memberAUser.id } } 
    });

    const clientB = await prisma.client.findFirstOrThrow({ where: { organizationId: orgB.id } });

    // 1. UserClientAssignment válido na mesma organização (já feito nos fixtures, confere via try-catch se possível ou ignora)
    
    // 2. Membership Org A -> Client Org B DEVE FALHAR
    await assert.rejects(
      prisma.userClientAssignment.create({
        data: {
          organizationId: orgA.id,
          organizationMemberId: memberAMem.id,
          clientId: clientB.id,
        }
      }),
      /Foreign key constraint/i,
      'Membership Org A -> Client Org B DEVE FALHAR pela constraint composta'
    );
  });

  await t.test('L.I - Teste Team Cross-Org Real', async () => {
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });

    const memberAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'member_a@zafira.test' } });
    const membershipA = await prisma.organizationMember.findUniqueOrThrow({ 
      where: { organizationId_userId: { organizationId: orgA.id, userId: memberAUser.id } } 
    });

    // We need a member from orgB to test failure
    // Using Admin B as our target B membership
    const adminBUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_b@zafira.test' } });
    const membershipB = await prisma.organizationMember.findUniqueOrThrow({ 
      where: { organizationId_userId: { organizationId: orgB.id, userId: adminBUser.id } } 
    });

    const teamA = await prisma.team.create({
      data: {
        organizationId: orgA.id,
        name: 'Team A'
      }
    });

    // 3. TeamMember com Team A + Membership A: SUCESSO.
    await prisma.teamMember.create({
      data: {
        organizationId: orgA.id,
        teamId: teamA.id,
        organizationMemberId: membershipA.id
      }
    });

    // 4. Team A + Membership B: DEVE FALHAR.
    await assert.rejects(
      prisma.teamMember.create({
        data: {
          organizationId: orgA.id,
          teamId: teamA.id,
          organizationMemberId: membershipB.id
        }
      }),
      /Foreign key constraint/i,
      'Team A + Membership B DEVE FALHAR pela constraint composta'
    );

    // cleanup
    await prisma.teamMember.deleteMany({ where: { teamId: teamA.id } });
    await prisma.team.delete({ where: { id: teamA.id } });
  });

  await t.test('M - Policy Resolver com Prisma Real (RolePermission como autoridade persistente)', async () => {
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });
    const managerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manager_a@zafira.test' } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: 'member_a@zafira.test' } });
    const memId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgA.id, userId: memberUser.id } } })).id;
    const mgrMemId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgA.id, userId: managerUser.id } } })).id;

    // 1. ADMIN A recebe clients.view por RolePermission persistida
    let res = await resolveAuthorizationContext({ userId: adminUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.view' });
    assert.ok(res.allowed);
    assert.strictEqual(res.reason, 'GRANTED_BY_ROLE_PERMISSION');

    // 2. MANAGER A recebe clients.edit por RolePermission persistida
    res = await resolveAuthorizationContext({ userId: managerUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.ok(res.allowed);
    assert.strictEqual(res.reason, 'GRANTED_BY_ROLE_PERMISSION');

    // 2.B PROVA PRINCIPAL: Remoção de RolePermission no banco transforma em DENY (sem fallback estático!)
    await prisma.rolePermission.delete({
      where: {
        role_permissionCode: {
          role: 'MANAGER',
          permissionCode: 'clients.edit'
        }
      }
    });

    const resRemoved = await resolveAuthorizationContext({ userId: managerUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.strictEqual(resRemoved.allowed, false, 'Sem RolePermission no banco, o acesso DEVE ser negado (sem fallback estático)');
    assert.strictEqual(resRemoved.reason, 'DENIED_BY_DEFAULT');

    // RESTAURAÇÃO OBRIGATÓRIA da RolePermission
    await prisma.rolePermission.create({
      data: {
        role: 'MANAGER',
        permissionCode: 'clients.edit'
      }
    });

    // Confirmação de restauração
    const resRestored = await resolveAuthorizationContext({ userId: managerUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.ok(resRestored.allowed, 'Após restauração da RolePermission, o acesso deve voltar a ser permitido');
    assert.strictEqual(resRestored.reason, 'GRANTED_BY_ROLE_PERMISSION');

    // 3. MEMBER A recebe clients.view por RolePermission persistida
    res = await resolveAuthorizationContext({ userId: memberUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.view' });
    assert.ok(res.allowed);
    assert.strictEqual(res.reason, 'GRANTED_BY_ROLE_PERMISSION');

    // 4. MEMBER A não recebe clients.edit (sem grant de RolePermission para MEMBER)
    res = await resolveAuthorizationContext({ userId: memberUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'DENIED_BY_DEFAULT');

    // 5. Override allowed=true sem RolePermission concede clients.edit ao MEMBER A
    await prisma.organizationMemberPermission.create({
      data: {
        organizationId: orgA.id,
        organizationMemberId: memId,
        permissionCode: 'clients.edit',
        allowed: true
      }
    });
    res = await resolveAuthorizationContext({ userId: memberUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.ok(res.allowed);
    assert.strictEqual(res.reason, 'GRANTED_BY_OVERRIDE');

    // 6. Override allowed=false bloqueia MEMBER A
    await prisma.organizationMemberPermission.update({
      where: { organizationMemberId_permissionCode: { organizationMemberId: memId, permissionCode: 'clients.edit' } },
      data: { allowed: false }
    });
    res = await resolveAuthorizationContext({ userId: memberUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'DENIED_BY_OVERRIDE');

    // Limpar override do MEMBER
    await prisma.organizationMemberPermission.delete({
      where: { organizationMemberId_permissionCode: { organizationMemberId: memId, permissionCode: 'clients.edit' } }
    });

    // 7. Override allowed=false bloqueia MANAGER mesmo quando RolePermission persistida existe
    await prisma.organizationMemberPermission.create({
      data: {
        organizationId: orgA.id,
        organizationMemberId: mgrMemId,
        permissionCode: 'clients.edit',
        allowed: false
      }
    });
    res = await resolveAuthorizationContext({ userId: managerUser.id, activeOrganizationId: orgA.id, permissionCode: 'clients.edit' });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'DENIED_BY_OVERRIDE');

    // Limpar override do MANAGER
    await prisma.organizationMemberPermission.delete({
      where: { organizationMemberId_permissionCode: { organizationMemberId: mgrMemId, permissionCode: 'clients.edit' } }
    });

    // 8. Membership A não pode ser usada em activeOrganizationId B
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    res = await resolveAuthorizationContext({ userId: memberUser.id, activeOrganizationId: orgB.id, permissionCode: 'clients.view' });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'NO_MEMBERSHIP_IN_ACTIVE_ORGANIZATION');

    // 9. Ausência de membership = deny
    res = await resolveAuthorizationContext({ userId: 'nao-existe', activeOrganizationId: orgA.id, permissionCode: 'clients.view' });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'NO_MEMBERSHIP_IN_ACTIVE_ORGANIZATION');

    // 10. Ausência de permission cadastrada = deny
    res = await resolveAuthorizationContext({ userId: memberUser.id, activeOrganizationId: orgA.id, permissionCode: 'outra.nao.existe' as any });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'DENIED_BY_DEFAULT');
  });

  await t.test('N - ClientService com Postgres Real', async () => {
    const svc = new ClientsService();
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });
    const adminMemId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgA.id, userId: adminUser.id } } })).id;
    const managerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manager_a@zafira.test' } });
    const managerMemId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgA.id, userId: managerUser.id } } })).id;
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: 'member_a@zafira.test' } });
    const memberMemId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgA.id, userId: memberUser.id } } })).id;
    
    const adminBUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_b@zafira.test' } });
    const adminBMemId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgB.id, userId: adminBUser.id } } })).id;

    // 1. Admin A lista apenas Clients A
    let clients = await svc.listClients({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, {});
    assert.ok(clients.length > 0);
    assert.ok(clients.every(c => c.organizationId === orgA.id));

    // 2. Manager A lista apenas Clients A
    clients = await svc.listClients({ organizationId: orgA.id, membershipId: managerMemId, role: 'MANAGER' }, {});
    assert.ok(clients.length > 0);
    assert.ok(clients.every(c => c.organizationId === orgA.id));

    // 3. Admin B lista apenas Client B
    clients = await svc.listClients({ organizationId: orgB.id, membershipId: adminBMemId, role: 'ADMIN' }, {});
    assert.ok(clients.length > 0);
    assert.ok(clients.every(c => c.organizationId === orgB.id));

    // 4. Member A lista somente Client A Assigned
    clients = await svc.listClients({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, {});
    assert.strictEqual(clients.length, 1);
    assert.strictEqual(clients[0].name, 'Client A Assigned');

    // 7. Admin A não lê Client B pelo clientId
    const clientB = await prisma.client.findFirstOrThrow({ where: { organizationId: orgB.id } });
    await assert.rejects(svc.getClientById({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, clientB.id));

    // 8. Manager A não edita Client B pelo clientId
    await assert.rejects(svc.updateClient({ organizationId: orgA.id, membershipId: managerMemId, role: 'MANAGER' }, clientB.id, { name: 'xxx' }));

    // 9. Member A com override clients.edit=true pode editar Client A Assigned
    const clientAAssigned = await prisma.client.findFirstOrThrow({ where: { organizationId: orgA.id, name: 'Client A Assigned' } });
    await svc.updateClient({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, clientAAssigned.id, { name: 'Client A Assigned Edited' });
    
    // 10. O mesmo Member A NÃO pode editar Client A Unassigned
    const clientAUnassigned = await prisma.client.findFirstOrThrow({ where: { organizationId: orgA.id, name: 'Client A Unassigned' } });
    await assert.rejects(svc.updateClient({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, clientAUnassigned.id, { name: 'xxx' }));

    // 11. O mesmo Member A NÃO pode editar Client B
    await assert.rejects(svc.updateClient({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, clientB.id, { name: 'xxx' }));

    // 12. create grava organizationId da organização ativa
    const newClient = await svc.createClient({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, {
      name: 'New Client A',
      document: '111',
      legalName: 'NC A'
    });
    assert.strictEqual(newClient.organizationId, orgA.id);

    // 13. update mantém organizationId
    const updatedClient = await svc.updateClient({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, newClient.id, { name: 'New Client A Updated' });
    assert.strictEqual(updatedClient.organizationId, orgA.id);
  });

  await t.test('O - Teste Direto A -> B (CROSS_ORG_DENY)', async () => {
    // Cenário: CROSS_ORG_DENY
    // User/Member da Organization A tenta acessar recurso da Organization B
    console.log('[SCENARIO] CROSS_ORG_DENY: Validating cross-organization access prevention.');
    
    const svc = new ClientsService();
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });
    const adminMemId = (await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgA.id, userId: adminUser.id } } })).id;
    
    const clientB = await prisma.client.findFirstOrThrow({ where: { organizationId: orgB.id } });

    // Using Admin A's context, try to fetch Client B directly
    let caughtError = false;
    try {
      await svc.getClientById({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, clientB.id);
    } catch (e: any) {
      caughtError = true;
      assert.strictEqual(e.statusCode, 404); // Should be not found instead of leaking existence
    }
    assert.ok(caughtError, 'O acesso de Org A para recurso da Org B deve ser negado (404 seguro)');
  });
});
