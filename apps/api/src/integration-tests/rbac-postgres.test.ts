import test from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';
import { resolveAuthorizationContext } from '../modules/authorization/resolver.js';
import { ClientsService } from '../modules/clients/clients.service.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { OrganizationConfigService } from '../modules/organization-config/organization-config.service.js';
import { FeatureFlagService } from '../modules/organization-config/feature-flag.service.js';
import { UsersService, UserAdminError } from '../modules/users/users.service.js';
import argon2 from 'argon2';
import { hashInvitationToken } from '../modules/users/invitation-token.js';
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
    assert.strictEqual(migrations.length, 13, 'Deve haver exatamente 13 migrations aplicadas');
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

    let newClient: any = null;
    let clientAAssigned: any = null;

    try {
      // 9. Member A com override clients.edit=true pode editar Client A Assigned
      clientAAssigned = await prisma.client.findFirstOrThrow({ where: { organizationId: orgA.id, name: 'Client A Assigned' } });
      await svc.updateClient({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, clientAAssigned.id, { name: 'Client A Assigned Edited' });
      // 10. O mesmo Member A NÃO pode editar Client A Unassigned
      const clientAUnassigned = await prisma.client.findFirstOrThrow({ where: { organizationId: orgA.id, name: 'Client A Unassigned' } });
      await assert.rejects(svc.updateClient({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, clientAUnassigned.id, { name: 'xxx' }));

      // 11. O mesmo Member A NÃO pode editar Client B
      await assert.rejects(svc.updateClient({ organizationId: orgA.id, membershipId: memberMemId, role: 'MEMBER' }, clientB.id, { name: 'xxx' }));

      // 12. create grava organizationId da organização ativa
      newClient = await svc.createClient({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, {
        name: 'New Client A',
        document: '111',
        legalName: 'NC A'
      });
      assert.strictEqual(newClient.organizationId, orgA.id);

      // 13. update mantém organizationId
      const updatedClient = await svc.updateClient({ organizationId: orgA.id, membershipId: adminMemId, role: 'ADMIN' }, newClient.id, { name: 'New Client A Updated' });
      assert.strictEqual(updatedClient.organizationId, orgA.id);
    } finally {
      // Restaura o nome de Client A Assigned para não poluir outros testes
      if (clientAAssigned) {
        await prisma.client.update({
          where: { id: clientAAssigned.id },
          data: { name: 'Client A Assigned' },
        });
      }
      // Remove o cliente temporário criado no teste N
      if (newClient) {
        await prisma.client.deleteMany({ where: { id: newClient.id } });
      }
    }
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

  await t.test('P - AuditLog com PostgreSQL Real e Isolamento Multi-tenant', async () => {
    const auditService = new AuditService(prisma);
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    const adminAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });
    const adminBUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_b@zafira.test' } });

    // 1. Criar AuditLog para Org A com dados sensíveis e não-sensíveis
    const logA1 = await auditService.record({
      organizationId: orgA.id,
      actorUserId: adminAUser.id,
      action: 'financial_category.created',
      entityType: 'FinancialCategory',
      entityId: 'cat_ci_a1',
      before: null,
      after: { name: 'Marketing Org A', passwordHash: 'secret_hash_a', apiKey: 'secret_key_a' },
      metadata: { ip: '127.0.0.1', token: 'bearer_token_a' },
    });

    const logA2 = await auditService.record({
      organizationId: orgA.id,
      actorUserId: adminAUser.id,
      action: 'user.suspended',
      entityType: 'User',
      entityId: 'usr_ci_a2',
      after: { status: 'SUSPENDED' },
    });

    // 2. Criar AuditLog para Org B
    const logB1 = await auditService.record({
      organizationId: orgB.id,
      actorUserId: adminBUser.id,
      action: 'financial_category.created',
      entityType: 'FinancialCategory',
      entityId: 'cat_ci_b1',
      after: { name: 'TI Org B', clientSecret: 'cs_secret_b' },
    });

    try {
      // 3. list Org A retorna SOMENTE registros de Org A
      const listA = await auditService.list({ organizationId: orgA.id });
      assert.ok(listA.items.length >= 2, 'Org A deve conter ao menos os 2 logs criados');
      const allOrgA = listA.items.every((item: any) => item.organizationId === orgA.id);
      assert.strictEqual(allOrgA, true, 'Todos os itens retornados para Org A devem pertencer a Org A');
      const hasLogBInA = listA.items.some((item: any) => item.id === logB1.id);
      assert.strictEqual(hasLogBInA, false, 'Org A NUNCA deve ver logs de Org B');

      // 4. list Org B retorna SOMENTE registros de Org B
      const listB = await auditService.list({ organizationId: orgB.id });
      assert.ok(listB.items.length >= 1, 'Org B deve conter ao menos o log criado');
      const allOrgB = listB.items.every((item: any) => item.organizationId === orgB.id);
      assert.strictEqual(allOrgB, true, 'Todos os itens retornados para Org B devem pertencer a Org B');
      const hasLogAInB = listB.items.some((item: any) => item.id === logA1.id || item.id === logA2.id);
      assert.strictEqual(hasLogAInB, false, 'Org B NUNCA deve ver logs de Org A');

      // 5. Filtro por action funciona
      const listAFiltered = await auditService.list({
        organizationId: orgA.id,
        action: 'user.suspended',
      });
      assert.strictEqual(listAFiltered.items.length, 1);
      assert.strictEqual(listAFiltered.items[0].id, logA2.id);

      // 6. Ator e entidade persistem corretamente
      const fetchedA1 = listA.items.find((item: any) => item.id === logA1.id);
      assert.ok(fetchedA1);
      assert.strictEqual(fetchedA1.actorUserId, adminAUser.id);
      assert.strictEqual(fetchedA1.entityType, 'FinancialCategory');
      assert.strictEqual(fetchedA1.entityId, 'cat_ci_a1');
      assert.strictEqual(fetchedA1.actorUser?.email, 'admin_a@zafira.test');

      // 7. Payload sanitizado no banco não contém segredos originais
      const afterPayload = fetchedA1.after as any;
      const metadataPayload = fetchedA1.metadata as any;
      assert.strictEqual(afterPayload.name, 'Marketing Org A');
      assert.strictEqual(afterPayload.passwordHash, '[REDACTED]');
      assert.strictEqual(afterPayload.apiKey, '[REDACTED]');
      assert.strictEqual(metadataPayload.token, '[REDACTED]');
      assert.strictEqual(metadataPayload.ip, '127.0.0.1');
    } finally {
      // Cleanup de registros criados
      await prisma.auditLog.deleteMany({
        where: { id: { in: [logA1.id, logA2.id, logB1.id] } },
      });
    }
  });

  await t.test('Q - OrganizationConfig e FeatureFlags com PostgreSQL Real', async () => {
    const configService = new OrganizationConfigService(prisma);
    const flagService = new FeatureFlagService(prisma);
    const auditService = new AuditService(prisma);

    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    const adminAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });
    const adminBUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_b@zafira.test' } });

    // 1. Config Org A criada com defaults
    const configA = await configService.getConfig(orgA.id);
    assert.strictEqual(configA.organizationId, orgA.id);
    assert.strictEqual(configA.locale, 'pt-BR');
    assert.strictEqual(configA.timezone, 'UTC');
    assert.strictEqual(configA.currency, 'BRL');

    // 2. Config Org B criada com defaults
    const configB = await configService.getConfig(orgB.id);
    assert.strictEqual(configB.organizationId, orgB.id);
    assert.strictEqual(configB.timezone, 'UTC');

    // 3. Alterar Config A não altera Config B
    const updatedA = await configService.updateConfig(orgA.id, adminAUser.id, {
      timezone: 'America/Sao_Paulo',
      currency: 'USD',
    });
    assert.strictEqual(updatedA.timezone, 'America/Sao_Paulo');
    assert.strictEqual(updatedA.currency, 'USD');

    const checkConfigB = await configService.getConfig(orgB.id);
    assert.strictEqual(checkConfigB.timezone, 'UTC', 'Config de Org B NÃO deve ser alterada por mutação em Org A');
    assert.strictEqual(checkConfigB.currency, 'BRL');

    // 4. Flag FINANCIAL = true em Org A
    const flagA = await flagService.setFlag(orgA.id, adminAUser.id, 'FINANCIAL', true);
    assert.strictEqual(flagA.key, 'FINANCIAL');
    assert.strictEqual(flagA.enabled, true);

    // 5. Mesma flag permanece false/ausente em Org B
    const isFinBEnabled = await flagService.isEnabled(orgB.id, 'FINANCIAL');
    assert.strictEqual(isFinBEnabled, false, 'Flag FINANCIAL em Org B deve permanecer false');

    // 6. setFlag false funciona
    const flagADisabled = await flagService.setFlag(orgA.id, adminAUser.id, 'FINANCIAL', false);
    assert.strictEqual(flagADisabled.enabled, false);

    // 7 & 8. AuditLogs de config e flags pertencem a Org A
    const listAuditA = await auditService.list({ organizationId: orgA.id });
    const configAuditA = listAuditA.items.find((item: any) => item.action === 'organization.config_changed');
    const flagAuditA = listAuditA.items.find((item: any) => item.action === 'feature_flag.changed');

    assert.ok(configAuditA, 'Deve existir AuditLog de alteração de configuração para Org A');
    assert.strictEqual(configAuditA.actorUserId, adminAUser.id);
    assert.strictEqual(configAuditA.entityType, 'OrganizationConfig');

    assert.ok(flagAuditA, 'Deve existir AuditLog de alteração de feature flag para Org A');
    assert.strictEqual(flagAuditA.actorUserId, adminAUser.id);
    assert.strictEqual(flagAuditA.entityType, 'OrganizationFeatureFlag');

    // 9. Org B não recebe os AuditLogs de Org A
    const listAuditB = await auditService.list({ organizationId: orgB.id });
    const hasAuditAInB = listAuditB.items.some(
      (item: any) => item.id === configAuditA.id || item.id === flagAuditA.id
    );
    assert.strictEqual(hasAuditAInB, false, 'Org B NUNCA deve receber AuditLogs pertencentes a Org A');

    // Cleanup
    await prisma.organizationFeatureFlag.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
  });

  await t.test('R - Membership Lifecycle e Suspensão Organization-Scoped com PostgreSQL Real', async () => {
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });

    // 0. Criar usuário com User.status = 'INACTIVE' e Membership.status = 'ACTIVE'
    const inactiveUser = await prisma.user.create({
      data: {
        name: 'Inactive User Real DB',
        email: 'inactive_real_db@zafira.test',
        status: 'INACTIVE',
        memberships: {
          create: [
            { organizationId: orgA.id, role: 'ADMIN', status: 'ACTIVE' },
          ],
        },
      },
    });

    // Criar usuário dedicado com 2 memberships no banco real
    const multiUser = await prisma.user.create({
      data: {
        name: 'Multi Lifecycle User',
        email: 'multi_lifecycle@zafira.test',
        status: 'ACTIVE',
        memberships: {
          create: [
            { organizationId: orgA.id, role: 'ADMIN', status: 'SUSPENDED' },
            { organizationId: orgB.id, role: 'ADMIN', status: 'ACTIVE' },
          ],
        },
      },
      include: {
        memberships: true,
      },
    });

    try {
      // 0. Resolver para User INACTIVE com Membership ACTIVE => DENY USER_NOT_ACTIVE
      const resInactive = await resolveAuthorizationContext({
        userId: inactiveUser.id,
        activeOrganizationId: orgA.id,
        permissionCode: 'clients.view',
      });
      assert.strictEqual(resInactive.allowed, false, 'User globalmente INACTIVE deve ser negado mesmo com membership ACTIVE');
      assert.strictEqual(resInactive.reason, 'USER_NOT_ACTIVE');

      // 1. Resolver acesso na Org A (membership SUSPENDED) => DENY MEMBERSHIP_NOT_ACTIVE
      const resA = await resolveAuthorizationContext({
        userId: multiUser.id,
        activeOrganizationId: orgA.id,
        permissionCode: 'clients.view',
      });
      assert.strictEqual(resA.allowed, false, 'Acesso à Org A com membership SUSPENDED deve ser negado');
      assert.strictEqual(resA.reason, 'MEMBERSHIP_NOT_ACTIVE');

      // 2. Resolver acesso na Org B (membership ACTIVE) => ALLOW por RolePermission
      const resB = await resolveAuthorizationContext({
        userId: multiUser.id,
        activeOrganizationId: orgB.id,
        permissionCode: 'clients.view',
      });
      assert.strictEqual(resB.allowed, true, 'Acesso à Org B com membership ACTIVE deve ser permitido');
      assert.strictEqual(resB.reason, 'GRANTED_BY_ROLE_PERMISSION');

      // 3. Confirmar que no banco o status global do User PERMANECEU ACTIVE
      const userInDb = await prisma.user.findUniqueOrThrow({ where: { id: multiUser.id } });
      assert.strictEqual(userInDb.status, 'ACTIVE', 'User.status global deve permanecer ACTIVE mesmo com membership suspensa em Org A');

      // 4. Testar membership com status INVITED
      await prisma.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgA.id, userId: multiUser.id } },
        data: { status: 'INVITED' },
      });

      const resAInvited = await resolveAuthorizationContext({
        userId: multiUser.id,
        activeOrganizationId: orgA.id,
        permissionCode: 'clients.view',
      });
      assert.strictEqual(resAInvited.allowed, false, 'Acesso à Org A com membership INVITED deve ser negado');
      assert.strictEqual(resAInvited.reason, 'MEMBERSHIP_NOT_ACTIVE');
    } finally {
      // Cleanup dos usuários de teste
      await prisma.organizationMember.deleteMany({ where: { userId: { in: [multiUser.id, inactiveUser.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [multiUser.id, inactiveUser.id] } } });
    }
  });

  await t.test('S - Gestão Administrativa de Usuários da Organização com PostgreSQL Real', async () => {
    const usersService = new UsersService(prisma);
    const auditService = new AuditService(prisma);

    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    const adminAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });
    const managerAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manager_a@zafira.test' } });

    // Fixtures de Client isoladas para o subteste S
    const clientSOrgA = await prisma.client.create({
      data: {
        organizationId: orgA.id,
        document: '99911122201',
        name: 'CI User Admin S Client A',
        legalName: 'CI User Admin S Client A LTDA',
      },
    });
    const clientSOrgB = await prisma.client.create({
      data: {
        organizationId: orgB.id,
        document: '99911122202',
        name: 'CI User Admin S Client B',
        legalName: 'CI User Admin S Client B LTDA',
      },
    });

    // 1 & 2. Permissions users.view e users.edit_permissions persistidas
    const permView = await prisma.permission.findUnique({ where: { code: 'users.view' } });
    const permEditPerms = await prisma.permission.findUnique({ where: { code: 'users.edit_permissions' } });
    assert.ok(permView, 'Permission users.view deve existir persistida');
    assert.ok(permEditPerms, 'Permission users.edit_permissions deve existir persistida');

    // 3, 4, 5. RolePermissions defaults (checagem de existência no PostgreSQL)
    const adminView = await prisma.rolePermission.findUnique({
      where: { role_permissionCode: { role: 'ADMIN', permissionCode: 'users.view' } },
    });
    const adminEditPerms = await prisma.rolePermission.findUnique({
      where: { role_permissionCode: { role: 'ADMIN', permissionCode: 'users.edit_permissions' } },
    });
    const managerView = await prisma.rolePermission.findUnique({
      where: { role_permissionCode: { role: 'MANAGER', permissionCode: 'users.view' } },
    });
    const memberView = await prisma.rolePermission.findUnique({
      where: { role_permissionCode: { role: 'MEMBER', permissionCode: 'users.view' } },
    });

    assert.ok(adminView, 'ADMIN deve possuir RolePermission users.view');
    assert.ok(adminEditPerms, 'ADMIN deve possuir RolePermission users.edit_permissions');
    assert.ok(managerView, 'MANAGER deve possuir RolePermission users.view');
    assert.strictEqual(memberView, null, 'MEMBER NÃO deve possuir RolePermission users.view');

    // Validação da Matriz de Permissões contra PostgreSQL Real
    const adminMem = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgA.id, userId: adminAUser.id } },
    });
    const managerMem = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgA.id, userId: managerAUser.id } },
    });

    const adminDetail = await usersService.getMemberDetail(orgA.id, adminMem.id);
    const admView = adminDetail.permissions.find((p) => p.code === 'users.view');
    const admEdit = adminDetail.permissions.find((p) => p.code === 'users.edit_permissions');
    assert.strictEqual(admView?.roleGranted, true, 'ADMIN: users.view deve ter roleGranted true');
    assert.strictEqual(admView?.effective, true, 'ADMIN: users.view deve ter effective true');
    assert.strictEqual(admEdit?.roleGranted, true, 'ADMIN: users.edit_permissions deve ter roleGranted true');
    assert.strictEqual(admEdit?.effective, true, 'ADMIN: users.edit_permissions deve ter effective true');

    const managerDetail = await usersService.getMemberDetail(orgA.id, managerMem.id);
    const mgrView = managerDetail.permissions.find((p) => p.code === 'users.view');
    const mgrEdit = managerDetail.permissions.find((p) => p.code === 'users.edit_permissions');
    assert.strictEqual(mgrView?.roleGranted, true, 'MANAGER: users.view deve ter roleGranted true');
    assert.strictEqual(mgrView?.effective, true, 'MANAGER: users.view deve ter effective true');
    assert.strictEqual(mgrEdit?.roleGranted, false, 'MANAGER: users.edit_permissions deve ter roleGranted false');
    assert.strictEqual(mgrEdit?.effective, false, 'MANAGER: users.edit_permissions deve ter effective false');

    // 6, 7, 8. Invite pending em Org A cria User global INVITED e Membership A INVITED
    const inviteRes = await usersService.inviteUser(orgA.id, adminAUser.id, {
      name: 'Real DB Invited User',
      email: 'real_db_invited@zafira.test',
    });
    assert.strictEqual(inviteRes.role, 'MEMBER');
    assert.strictEqual(inviteRes.membershipStatus, 'INVITED');

    const createdUserDb = await prisma.user.findUniqueOrThrow({ where: { id: inviteRes.userId } });
    assert.strictEqual(createdUserDb.status, 'INVITED');
    assert.strictEqual(createdUserDb.passwordHash, null);

    const createdMemDb = await prisma.organizationMember.findUniqueOrThrow({ where: { id: inviteRes.membershipId } });
    assert.strictEqual(createdMemDb.status, 'INVITED');
    assert.strictEqual(createdMemDb.role, 'MEMBER');

    try {
      // 9. Role alterável sem ativar convite
      const updatedRole = await usersService.updateRole(orgA.id, adminAUser.id, inviteRes.membershipId, {
        role: 'MANAGER',
      });
      assert.strictEqual(updatedRole.role, 'MANAGER');
      const memAfterRole = await prisma.organizationMember.findUniqueOrThrow({ where: { id: inviteRes.membershipId } });
      assert.strictEqual(memAfterRole.status, 'INVITED', 'Status deve permanecer INVITED');
      assert.strictEqual(memAfterRole.role, 'MANAGER');

      // 10 & 11. Assignment aceita Client A e rejeita Client B (alien)
      const assignRes = await usersService.assignClients(orgA.id, adminAUser.id, inviteRes.membershipId, {
        clientIds: [clientSOrgA.id],
      });
      assert.deepStrictEqual(assignRes.clientIds, [clientSOrgA.id]);

      await assert.rejects(
        usersService.assignClients(orgA.id, adminAUser.id, inviteRes.membershipId, {
          clientIds: [clientSOrgB.id],
        }),
        (err: any) => err instanceof UserAdminError && err.code === 'CLIENT_NOT_IN_ORGANIZATION'
      );

      // 12, 13, 14. Membership ACTIVE pode ser suspensa e User.status global permanece ACTIVE
      const multiMemUser = await prisma.user.create({
        data: {
          name: 'Multi Active User',
          email: 'multi_active_user@zafira.test',
          status: 'ACTIVE',
          memberships: {
            create: [
              { organizationId: orgA.id, role: 'MEMBER', status: 'ACTIVE' },
              { organizationId: orgB.id, role: 'MEMBER', status: 'ACTIVE' },
            ],
          },
        },
        include: { memberships: true },
      });

      const memA = multiMemUser.memberships.find((m) => m.organizationId === orgA.id)!;
      const memB = multiMemUser.memberships.find((m) => m.organizationId === orgB.id)!;

      // Suspender membership A
      await usersService.updateStatus(orgA.id, adminAUser.id, memA.id, { status: 'SUSPENDED' });
      const memAAfterSusp = await prisma.organizationMember.findUniqueOrThrow({ where: { id: memA.id } });
      assert.strictEqual(memAAfterSusp.status, 'SUSPENDED');

      // User.status permanece ACTIVE
      const userGlobalCheck = await prisma.user.findUniqueOrThrow({ where: { id: multiMemUser.id } });
      assert.strictEqual(userGlobalCheck.status, 'ACTIVE');

      // Membership B ativa continua funcionando em B
      const resOrgB = await resolveAuthorizationContext({
        userId: multiMemUser.id,
        activeOrganizationId: orgB.id,
        permissionCode: 'clients.view',
      });
      assert.strictEqual(resOrgB.allowed, true);

      // 15. Remoção de A não remove B
      await usersService.removeMember(orgA.id, adminAUser.id, memA.id);
      const memACheck = await prisma.organizationMember.findUnique({ where: { id: memA.id } });
      assert.strictEqual(memACheck, null);

      const memBCheck = await prisma.organizationMember.findUnique({ where: { id: memB.id } });
      assert.ok(memBCheck, 'Membership B deve continuar existindo');

      // 16. AuditLogs pertencem somente à Org A
      const logsA = await auditService.list({ organizationId: orgA.id });
      const hasInviteLog = logsA.items.some((l: any) => l.action === 'user.invited');
      const hasRoleLog = logsA.items.some((l: any) => l.action === 'user.role_changed');
      assert.strictEqual(hasInviteLog, true);
      assert.strictEqual(hasRoleLog, true);

      const logsB = await auditService.list({ organizationId: orgB.id });
      const hasALogInB = logsB.items.some((l: any) => l.entityId === inviteRes.membershipId);
      assert.strictEqual(hasALogInB, false, 'Org B NUNCA deve conter logs de Org A');

      // 17. Last active admin é protegido
      const adminAMem = await prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgA.id, userId: adminAUser.id } },
      });

      await assert.rejects(
        usersService.updateRole(orgA.id, adminAUser.id, adminAMem.id, { role: 'MEMBER' }),
        (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN'
      );

      await assert.rejects(
        usersService.updateStatus(orgA.id, adminAUser.id, adminAMem.id, { status: 'SUSPENDED' }),
        (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN'
      );

      await assert.rejects(
        usersService.removeMember(orgA.id, adminAUser.id, adminAMem.id),
        (err: any) => err instanceof UserAdminError && err.code === 'LAST_ACTIVE_ADMIN'
      );

      // Cleanup multiMemUser
      await prisma.organizationMember.deleteMany({ where: { userId: multiMemUser.id } });
      await prisma.user.delete({ where: { id: multiMemUser.id } });
    } finally {
      // Cleanup do usuário convidado e das fixtures de Client do teste S
      await prisma.userClientAssignment.deleteMany({ where: { organizationMemberId: inviteRes.membershipId } });
      await prisma.organizationMember.deleteMany({ where: { id: inviteRes.membershipId } });
      await prisma.user.deleteMany({ where: { id: inviteRes.userId } });
      await prisma.client.deleteMany({ where: { id: { in: [clientSOrgA.id, clientSOrgB.id] } } });
    }
  });

  await t.test('T - Convites Seguros e Ativação com PostgreSQL Real', async () => {
    const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-a' } });
    const orgB = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ci-org-b' } });
    const adminAUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin_a@zafira.test' } });

    const usersService = new UsersService(prisma);
    const auditService = new AuditService(prisma);

    const createdUserIds: string[] = [];
    const createdMemberIds: string[] = [];

    try {
      // 1 a 11. Fluxo completo de Novo Usuário (INVITED -> ACTIVE)
      const inviteNew = await usersService.inviteUser(orgA.id, adminAUser.id, {
        name: 'CI New User T',
        email: 'ci_new_user_t@zafira.test',
      });
      createdUserIds.push(inviteNew.userId);
      createdMemberIds.push(inviteNew.membershipId);

      const rawTokenNew = inviteNew.invitation.token;
      assert.ok(rawTokenNew, 'Invite deve retornar token bruto');
      assert.strictEqual(inviteNew.invitation.acceptPath, `/invite?token=${rawTokenNew}`);

      // Prova de armazenamento seguro: banco armazena apenas SHA-256 hash
      const tokenHashNew = hashInvitationToken(rawTokenNew);
      const storedInv = await prisma.organizationInvitation.findUniqueOrThrow({
        where: { tokenHash: tokenHashNew },
      });
      assert.strictEqual(storedInv.organizationMemberId, inviteNew.membershipId);
      assert.strictEqual(storedInv.acceptedAt, null);
      assert.notStrictEqual(storedInv.tokenHash, rawTokenNew);

      // Inspect público
      const inspectRes = await usersService.inspectInvitation(rawTokenNew);
      assert.strictEqual(inspectRes.valid, true);
      assert.strictEqual(inspectRes.requiresPassword, true);
      assert.strictEqual(inspectRes.invitedUser.email, 'ci_new_user_t@zafira.test');

      // Tentativa de aceitar sem senha => falha 400
      await assert.rejects(
        usersService.acceptInvitation(rawTokenNew),
        (err: any) => err instanceof UserAdminError && err.code === 'PASSWORD_REQUIRED' && err.statusCode === 400
      );

      // Aceite com senha válida
      const acceptRes = await usersService.acceptInvitation(rawTokenNew, 'SenhaSegura123!');
      assert.strictEqual(acceptRes.success, true);

      // Prova de ativação do User global e validação do hash Argon2
      const userAfterAccept = await prisma.user.findUniqueOrThrow({ where: { id: inviteNew.userId } });
      assert.strictEqual(userAfterAccept.status, 'ACTIVE');
      assert.ok(userAfterAccept.passwordHash);
      const validPass = await argon2.verify(userAfterAccept.passwordHash, 'SenhaSegura123!');
      assert.strictEqual(validPass, true, 'Senha Argon2 deve ser verificável');

      // Prova de ativação da Membership
      const memAfterAccept = await prisma.organizationMember.findUniqueOrThrow({ where: { id: inviteNew.membershipId } });
      assert.strictEqual(memAfterAccept.status, 'ACTIVE');

      // Prova de acceptedAt preenchido
      const invAfterAccept = await prisma.organizationInvitation.findUniqueOrThrow({ where: { tokenHash: tokenHashNew } });
      assert.ok(invAfterAccept.acceptedAt, 'acceptedAt deve ser preenchido');

      // Prova de uso único: segunda tentativa => 409
      await assert.rejects(
        usersService.acceptInvitation(rawTokenNew, 'SenhaSegura123!'),
        (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_ALREADY_ACCEPTED' && err.statusCode === 409
      );

      // 12. Usuário ACTIVE existente preserva passwordHash e proíbe senha no aceite
      const originalPasswordHash = await argon2.hash('SenhaOriginalIntacta123!');
      const existingActiveUser = await prisma.user.create({
        data: {
          name: 'CI Existing Active T',
          email: 'ci_existing_active_t@zafira.test',
          status: 'ACTIVE',
          passwordHash: originalPasswordHash,
        },
      });
      createdUserIds.push(existingActiveUser.id);

      const inviteExisting = await usersService.inviteUser(orgA.id, adminAUser.id, {
        name: 'Ignorado',
        email: 'ci_existing_active_t@zafira.test',
      });
      createdMemberIds.push(inviteExisting.membershipId);

      const rawTokenExisting = inviteExisting.invitation.token;

      // Inspect indica que não requer senha
      const inspectExisting = await usersService.inspectInvitation(rawTokenExisting);
      assert.strictEqual(inspectExisting.requiresPassword, false);

      // Proíbe senha no aceite
      await assert.rejects(
        usersService.acceptInvitation(rawTokenExisting, 'TentativaMudarSenha123!'),
        (err: any) => err instanceof UserAdminError && err.code === 'PASSWORD_NOT_ALLOWED_FOR_EXISTING_USER' && err.statusCode === 400
      );

      // Aceita sem senha
      await usersService.acceptInvitation(rawTokenExisting);
      const userExistingCheck = await prisma.user.findUniqueOrThrow({ where: { id: existingActiveUser.id } });
      assert.strictEqual(userExistingCheck.status, 'ACTIVE');
      assert.strictEqual(userExistingCheck.passwordHash, originalPasswordHash, 'passwordHash DEVE ser preservado intacto');

      const memExistingCheck = await prisma.organizationMember.findUniqueOrThrow({ where: { id: inviteExisting.membershipId } });
      assert.strictEqual(memExistingCheck.status, 'ACTIVE');

      // 13. Multi-org: User aceita Org A com senha, depois aceita Org B sem senha
      const multiInviteUser = await usersService.inviteUser(orgA.id, adminAUser.id, {
        name: 'CI Multi Org T',
        email: 'ci_multi_org_t@zafira.test',
      });
      createdUserIds.push(multiInviteUser.userId);
      createdMemberIds.push(multiInviteUser.membershipId);

      const multiInviteOrgB = await usersService.inviteUser(orgB.id, adminAUser.id, {
        name: 'CI Multi Org T',
        email: 'ci_multi_org_t@zafira.test',
      });
      createdMemberIds.push(multiInviteOrgB.membershipId);

      // Aceita Org A com senha
      await usersService.acceptInvitation(multiInviteUser.invitation.token, 'SenhaMultiOrg123!');
      const memACheck = await prisma.organizationMember.findUniqueOrThrow({ where: { id: multiInviteUser.membershipId } });
      const memBCheck = await prisma.organizationMember.findUniqueOrThrow({ where: { id: multiInviteOrgB.membershipId } });
      assert.strictEqual(memACheck.status, 'ACTIVE');
      assert.strictEqual(memBCheck.status, 'INVITED', 'Membership B deve permanecer INVITED');

      // Aceita Org B sem senha (usuário agora é ACTIVE)
      await usersService.acceptInvitation(multiInviteOrgB.invitation.token);
      const memBAfter = await prisma.organizationMember.findUniqueOrThrow({ where: { id: multiInviteOrgB.membershipId } });
      assert.strictEqual(memBAfter.status, 'ACTIVE');

      // 14. Rotação invalida token anterior e renova expiry
      const inviteRot = await usersService.inviteUser(orgA.id, adminAUser.id, {
        name: 'CI Rotation T',
        email: 'ci_rotation_t@zafira.test',
      });
      createdUserIds.push(inviteRot.userId);
      createdMemberIds.push(inviteRot.membershipId);

      const tokenRotA = inviteRot.invitation.token;
      const reissueRes = await usersService.reissueInvitation(orgA.id, adminAUser.id, inviteRot.membershipId);
      const tokenRotB = reissueRes.invitation.token;

      assert.notStrictEqual(tokenRotA, tokenRotB);

      // Token A falha
      await assert.rejects(
        usersService.inspectInvitation(tokenRotA),
        (err: any) => err instanceof UserAdminError && err.code === 'INVALID_INVITATION_TOKEN' && err.statusCode === 400
      );

      // Token B funciona
      const inspectB = await usersService.inspectInvitation(tokenRotB);
      assert.strictEqual(inspectB.valid, true);

      // 15. Expiração bloqueia inspect e accept
      const inviteExp = await usersService.inviteUser(orgA.id, adminAUser.id, {
        name: 'CI Expiration T',
        email: 'ci_expiration_t@zafira.test',
      });
      createdUserIds.push(inviteExp.userId);
      createdMemberIds.push(inviteExp.membershipId);

      const tokenExp = inviteExp.invitation.token;
      await prisma.organizationInvitation.update({
        where: { tokenHash: hashInvitationToken(tokenExp) },
        data: { expiresAt: new Date('2020-01-01') },
      });

      await assert.rejects(
        usersService.inspectInvitation(tokenExp),
        (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_EXPIRED' && err.statusCode === 410
      );
      await assert.rejects(
        usersService.acceptInvitation(tokenExp, 'SenhaValida123!'),
        (err: any) => err instanceof UserAdminError && err.code === 'INVITATION_EXPIRED' && err.statusCode === 410
      );

      // 16. Remoção de membership remove invitation por FK cascade
      await usersService.removeMember(orgA.id, adminAUser.id, inviteExp.membershipId);
      const invRemovedCheck = await prisma.organizationInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(tokenExp) },
      });
      assert.strictEqual(invRemovedCheck, null, 'Invitation deve ser removida em cascata');

      // 17 & 18. AuditLogs não contêm segredos e são tenant-scoped
      const logsA = await auditService.list({ organizationId: orgA.id });
      const issuedLog = logsA.items.find((l: any) => l.action === 'user.invitation_issued');
      const acceptedLog = logsA.items.find((l: any) => l.action === 'user.invitation_accepted');

      assert.ok(issuedLog, 'Log de emissão deve existir');
      assert.ok(acceptedLog, 'Log de aceite deve existir');

      // Prova de que NENHUM log contém token bruto ou tokenHash
      const logsAStr = JSON.stringify(logsA);
      assert.strictEqual(logsAStr.includes(rawTokenNew), false, 'AuditLog NUNCA deve conter raw token');
      assert.strictEqual(logsAStr.includes(tokenHashNew), false, 'AuditLog NUNCA deve conter tokenHash');
    } finally {
      // Cleanup das fixtures criadas no subteste T
      for (const mId of createdMemberIds) {
        await prisma.organizationInvitation.deleteMany({ where: { organizationMemberId: mId } });
        await prisma.userClientAssignment.deleteMany({ where: { organizationMemberId: mId } });
        await prisma.organizationMemberPermission.deleteMany({ where: { organizationMemberId: mId } });
        await prisma.organizationMember.deleteMany({ where: { id: mId } });
      }
      for (const uId of createdUserIds) {
        await prisma.organizationMember.deleteMany({ where: { userId: uId } });
        await prisma.user.deleteMany({ where: { id: uId } });
      }
    }
  });
});
