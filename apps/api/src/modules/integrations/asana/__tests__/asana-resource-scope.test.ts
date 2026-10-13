import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../app.js';
import { prisma } from '../../../../lib/prisma.js';
import { AsanaService } from '../asana.service.js';
import { ASANA_OAUTH_SCOPES } from '../asana.routes.js';

test('Asana Client Resource Scope & Organization Context Hardening Suite (F4.4B-S2A)', { concurrency: 1 }, async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  // Preservar métodos originais do Prisma
  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalClientFindFirst = prisma.client.findFirst;

  // Espiões de métodos do AsanaService
  const originalGetClientProjects = AsanaService.prototype.getClientProjects;
  const originalGetClientTasks = AsanaService.prototype.getClientTasks;
  const originalLinkProjectsToClient = AsanaService.prototype.linkProjectsToClient;
  const originalGetWorkspaceProjects = AsanaService.prototype.getWorkspaceProjects;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    prisma.client.findFirst = originalClientFindFirst;

    AsanaService.prototype.getClientProjects = originalGetClientProjects;
    AsanaService.prototype.getClientTasks = originalGetClientTasks;
    AsanaService.prototype.linkProjectsToClient = originalLinkProjectsToClient;
    AsanaService.prototype.getWorkspaceProjects = originalGetWorkspaceProjects;

    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgA = 'org_alpha_111';
  const orgB = 'org_beta_222';
  const orgZafira = 'org_zafira_999';

  const adminUserId = 'usr_admin_owner';
  const managerUserId = 'usr_manager_scoped';
  const memberUserId = 'usr_regular_member';
  const multiOrgUserId = 'usr_multi_org';
  const noPermUserId = 'usr_no_perm';

  const clientA = 'cli_alpha_assigned';
  const clientB = 'cli_alpha_unassigned';
  const clientTeamActive = 'cli_team_active';
  const clientTeamInactive = 'cli_team_inactive';
  const clientOrgB = 'cli_beta_foreign';

  const SENTINEL_VALUE = 'CROSS_CLIENT_SENTINEL_987654';

  function setupAuthMocks() {
    // 1. Mock de User
    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === adminUserId) {
        return {
          id: adminUserId,
          name: 'Admin User',
          email: 'admin@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_admin_alpha',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
          ],
        };
      }

      if (where.id === managerUserId) {
        return {
          id: managerUserId,
          name: 'Manager User',
          email: 'manager@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_manager_alpha',
              role: 'MANAGER',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
          ],
        };
      }

      if (where.id === memberUserId) {
        return {
          id: memberUserId,
          name: 'Member User',
          email: 'member@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_member_alpha',
              role: 'MEMBER',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
          ],
        };
      }

      if (where.id === multiOrgUserId) {
        return {
          id: multiOrgUserId,
          name: 'Multi Org User',
          email: 'multiorg@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_multiorg_alpha',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
            {
              id: 'mem_multiorg_zafira',
              role: 'ADMIN',
              status: 'ACTIVE',
              organizationId: orgZafira,
              organization: { id: orgZafira, slug: 'zafira' },
            },
          ],
        };
      }

      if (where.id === noPermUserId) {
        return {
          id: noPermUserId,
          name: 'No Perm User',
          email: 'noperm@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_noperm_alpha',
              role: 'MEMBER',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
            },
          ],
        };
      }

      return null;
    }) as any;

    // 2. Mock de OrganizationMember para resolver permissões
    prisma.organizationMember.findUnique = (async ({ where, include }: any) => {
      const { organizationId_userId } = where;
      if (!organizationId_userId) return null;

      const { organizationId, userId } = organizationId_userId;
      const requestedPerm = include?.permissions?.where?.permissionCode;

      if (userId === adminUserId && organizationId === orgA) {
        return {
          id: 'mem_admin_alpha',
          organizationId: orgA,
          userId: adminUserId,
          role: 'ADMIN',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }

      if (userId === managerUserId && organizationId === orgA) {
        return {
          id: 'mem_manager_alpha',
          organizationId: orgA,
          userId: managerUserId,
          role: 'MANAGER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }

      if (userId === memberUserId && organizationId === orgA) {
        return {
          id: 'mem_member_alpha',
          organizationId: orgA,
          userId: memberUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }

      if (userId === multiOrgUserId) {
        if (organizationId === orgA) {
          return {
            id: 'mem_multiorg_alpha',
            organizationId: orgA,
            userId: multiOrgUserId,
            role: 'ADMIN',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
            permissions: [],
          };
        }
        if (organizationId === orgZafira) {
          return {
            id: 'mem_multiorg_zafira',
            organizationId: orgZafira,
            userId: multiOrgUserId,
            role: 'ADMIN',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
            permissions: [],
          };
        }
      }

      if (userId === noPermUserId && organizationId === orgA) {
        // Usuário com override explícito negando a permissão
        return {
          id: 'mem_noperm_alpha',
          organizationId: orgA,
          userId: noPermUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: requestedPerm ? [{ permissionCode: requestedPerm, allowed: false }] : [],
        };
      }

      return null;
    }) as any;

    // 3. Mock de RolePermission (Padrões RBAC de role-defaults)
    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const { role_permissionCode } = where;
      if (!role_permissionCode) return null;
      const { role, permissionCode } = role_permissionCode;

      // ADMIN possui todas
      if (role === 'ADMIN') {
        return { role, permissionCode, granted: true };
      }

      // MANAGER possui projects.*, deliverables.*, integrations.view
      if (role === 'MANAGER') {
        if (
          permissionCode === 'projects.view' ||
          permissionCode === 'projects.manage_links' ||
          permissionCode === 'deliverables.view' ||
          permissionCode === 'deliverables.plan' ||
          permissionCode === 'integrations.view'
        ) {
          return { role, permissionCode, granted: true };
        }
      }

      // MEMBER possui projects.view, deliverables.view, integrations.view (sem plan e sem manage_links)
      if (role === 'MEMBER') {
        if (
          permissionCode === 'projects.view' ||
          permissionCode === 'deliverables.view' ||
          permissionCode === 'integrations.view'
        ) {
          return { role, permissionCode, granted: true };
        }
      }

      return null;
    }) as any;

    // 4. Mock de findFirst para Client Resource Scope
    prisma.client.findFirst = (async ({ where }: any) => {
      // Cláusula AND construída por findClientInResourceScope:
      // where.AND = [ scopeWhere, { id: clientId } ]
      const scopeWhere = where?.AND?.[0];
      const targetId = where?.AND?.[1]?.id;

      if (!targetId || !scopeWhere) return null;

      const orgId = scopeWhere.organizationId;

      // Se for cliente pertencente a outra organização:
      if (targetId === clientOrgB && orgId === orgA) {
        return null; // Pertence a orgB, não orgA
      }

      // Regra 1: ADMIN (scopeWhere não possui OR de atribuição)
      if (!scopeWhere.OR) {
        if (orgId === orgA && [clientA, clientB, clientTeamActive, clientTeamInactive].includes(targetId)) {
          return { id: targetId, name: `Client ${targetId}` };
        }
        return null;
      }

      // Regra 2: MANAGER / MEMBER com OR de atribuição
      // Verificando atribuição direta ao membership
      const directMembershipId = scopeWhere.OR[0]?.assignedMembers?.some?.organizationMemberId;
      // Verificando atribuição de equipe ativa
      const teamMembershipId = scopeWhere.OR[1]?.teamAssignments?.some?.team?.members?.some?.organizationMemberId;
      const teamActiveRequired = scopeWhere.OR[1]?.teamAssignments?.some?.team?.isActive;

      // Client A: atribuído diretamente a mem_member_alpha e mem_manager_alpha
      if (targetId === clientA) {
        if (directMembershipId === 'mem_member_alpha' || directMembershipId === 'mem_manager_alpha' || directMembershipId === 'mem_noperm_alpha') {
          return { id: clientA, name: 'Client Alpha Assigned' };
        }
      }

      // Client Team Active: atribuído via equipe ativa
      if (targetId === clientTeamActive) {
        if (teamActiveRequired === true && (teamMembershipId === 'mem_member_alpha' || teamMembershipId === 'mem_manager_alpha')) {
          return { id: clientTeamActive, name: 'Client Team Active' };
        }
      }

      // Client Team Inactive: equipe inativa (scopeWhere exige isActive = true, logo não retorna)
      if (targetId === clientTeamInactive) {
        return null; // Equipe inativa é filtrada pelo Prisma
      }

      // Client B: não atribuído
      if (targetId === clientB) {
        return null;
      }

      return null;
    }) as any;
  }

  // =========================================================================
  // 1. ADMIN - Acesso Irrestrito Dentro da Organização Ativa (Seção 18)
  // =========================================================================
  await t.test('1. ADMIN acessa qualquer cliente da organização ativa sem restrição de carteira', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientProjects = (async (clientId: string, organizationId: string) => {
      asanaServiceCalled = true;
      assert.strictEqual(clientId, clientA);
      assert.strictEqual(organizationId, orgA);
      return [{ id: 'int-1', projectGid: 'proj-1', projectName: 'Admin Proj' }];
    }) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientA}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(asanaServiceCalled, true);
    const body = JSON.parse(response.body);
    assert.strictEqual(body[0].projectName, 'Admin Proj');
  });

  // =========================================================================
  // 2. MEMBER - Read Cross-Client Bloqueado (Seção 19 & 30)
  // =========================================================================
  await t.test('2. MEMBER recebe 404 ao ler projetos de cliente fora de sua carteira (Read Cross-Client)', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientProjects = (async () => {
      asanaServiceCalled = true;
      return [{ id: 'int-leak', projectGid: 'proj-leak', projectName: SENTINEL_VALUE }];
    }) as any;

    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientB}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(asanaServiceCalled, false, 'AsanaService NÃO deve ser chamado para cliente fora do scope');
    const body = JSON.parse(response.body);
    assert.strictEqual(body.message, 'Cliente não encontrado.');
    assert.ok(!response.body.includes(SENTINEL_VALUE), 'Valor sentinela jamais deve vazar');
  });

  await t.test('2.1 MEMBER recebe 404 ao ler tarefas de cliente fora de sua carteira (GET /tasks)', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientTasks = (async () => {
      asanaServiceCalled = true;
      return [{ gid: 'task-leak', name: SENTINEL_VALUE }];
    }) as any;

    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientB}/asana/tasks`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(asanaServiceCalled, false);
    assert.strictEqual(JSON.parse(response.body).message, 'Cliente não encontrado.');
  });

  // =========================================================================
  // 3. Asana somente leitura (DEC-ASANA-001 / F6-RO.0)
  // Nenhuma rota de escrita em tarefas Asana existe, nem para ADMIN em cliente do próprio escopo.
  // =========================================================================
  await t.test('3. Rotas de escrita em tarefas Asana não existem, nem para ADMIN no próprio escopo', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });
    const writeRoutes: Array<{ method: 'POST' | 'PATCH' | 'DELETE'; path: string }> = [
      { method: 'PATCH', path: '/asana/tasks/task-gid-1' },
      { method: 'POST', path: '/asana/tasks' },
      { method: 'POST', path: '/asana/tasks/task-gid-1/section' },
      { method: 'POST', path: '/asana/tasks/task-gid-1/subtasks' },
      { method: 'POST', path: '/asana/tasks/task-gid-1/stories' },
      { method: 'POST', path: '/asana/tasks/task-gid-1/attachments' },
      { method: 'POST', path: '/asana/tasks/task-gid-1/tags' },
      { method: 'DELETE', path: '/asana/tasks/task-gid-1/tags/tag-gid-1' },
    ];

    for (const prefix of ['', '/api']) {
      for (const route of writeRoutes) {
        const url = `${prefix}/clients/${clientA}${route.path}`;
        const response = await app.inject({
          method: route.method,
          url,
          headers: { authorization: `Bearer ${token}` },
          payload: { name: 'Tentativa de escrita', projectGid: 'proj-1', sectionGid: 'sec-1', text: 'x', tagGid: 'tag-1' },
        });
        assert.strictEqual(response.statusCode, 404, `${route.method} ${url} deveria não existir`);
        assert.ok(
          !response.body.includes('Cliente não encontrado'),
          `${route.method} ${url} deve ser 404 por rota inexistente, não por escopo`
        );
      }
    }
  });

  await t.test('3.1 AsanaService não expõe métodos que escrevem em tarefas Asana', async () => {
    const forbidden = [
      'updateClientTask',
      'createClientTask',
      'moveTaskSection',
      'createTaskSubtask',
      'addTaskComment',
      'uploadTaskAttachment',
      'addTagToTask',
      'removeTagFromTask',
    ];
    for (const name of forbidden) {
      assert.strictEqual(
        typeof (AsanaService.prototype as any)[name],
        'undefined',
        `AsanaService.${name} não deve existir (DEC-ASANA-001)`
      );
    }
  });

  await t.test('3.1.1 Escopos OAuth do Asana são só de leitura, exceto webhooks (DEC-ASANA-002)', async () => {
    for (const scope of ASANA_OAUTH_SCOPES) {
      assert.ok(
        scope.endsWith(':read') || scope.startsWith('webhooks:'),
        `Escopo OAuth não permitido: ${scope}`
      );
    }
    for (const write of ['tasks:write', 'projects:write', 'stories:write', 'attachments:write', 'tags:write', 'custom_fields:write']) {
      assert.ok(!(ASANA_OAUTH_SCOPES as readonly string[]).includes(write), `${write} não pode ser solicitado`);
    }
  });

  await t.test('3.2 MANAGER recebe 404 ao vincular projetos em cliente fora do escopo (POST /projects)', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.linkProjectsToClient = (async () => {
      asanaServiceCalled = true;
      return { linked: 1, errors: [] };
    }) as any;

    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'POST',
      url: `/clients/${clientB}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectGids: ['proj-gid-999'],
      },
    });

    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(asanaServiceCalled, false);
    assert.strictEqual(JSON.parse(response.body).message, 'Cliente não encontrado.');
  });

  // =========================================================================
  // 4. TEAM ASSIGNMENT ATIVO - Acesso Permitido (Seção 21)
  // =========================================================================
  await t.test('4. MEMBER recebe 200 ao acessar cliente atribuído à sua equipe ativa', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientProjects = (async (clientId: string, orgId: string) => {
      asanaServiceCalled = true;
      assert.strictEqual(clientId, clientTeamActive);
      assert.strictEqual(orgId, orgA);
      return [{ id: 'int-team', projectGid: 'proj-team', projectName: 'Team Project' }];
    }) as any;

    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientTeamActive}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(asanaServiceCalled, true);
  });

  // =========================================================================
  // 5. TEAM ASSIGNMENT INATIVO - Acesso Bloqueado (Seção 22)
  // =========================================================================
  await t.test('5. MEMBER recebe 404 ao tentar acessar cliente de equipe inativa (isActive = false)', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientProjects = (async () => {
      asanaServiceCalled = true;
      return [];
    }) as any;

    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientTeamInactive}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(asanaServiceCalled, false);
    assert.strictEqual(JSON.parse(response.body).message, 'Cliente não encontrado.');
  });

  // =========================================================================
  // 6. CROSS-ORGANIZATION - Cliente de Outra Organização (Seção 23)
  // =========================================================================
  await t.test('6. Recebe 404 para cliente de outra organização mesmo com ID conhecido', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientProjects = (async () => {
      asanaServiceCalled = true;
      return [];
    }) as any;

    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientOrgB}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(asanaServiceCalled, false);
    assert.strictEqual(JSON.parse(response.body).message, 'Cliente não encontrado.');
  });

  // =========================================================================
  // 7. MULTI-ORG CRÍTICO - ORG_A x ZAFIRA (Seção 24)
  // =========================================================================
  await t.test('7. Multi-Org: operação Asana utiliza estritamente organizationId ativo (ORG_A) e NUNCA slug zafira', async () => {
    setupAuthMocks();
    let resolvedOrgInService = '';

    AsanaService.prototype.getClientProjects = (async (clientId: string, orgId: string) => {
      resolvedOrgInService = orgId;
      return [{ id: 'int-1', projectGid: 'p1', projectName: 'P1' }];
    }) as any;

    const token = createToken({ sub: multiOrgUserId, email: 'multiorg@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientA}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(resolvedOrgInService, orgA, 'Deve usar exclusivamente orgA');
    assert.notStrictEqual(resolvedOrgInService, orgZafira, 'Jamais deve fazer fallback para zafira');
  });

  await t.test('7.1 Multi-Org em rota organizacional: GET /integrations/asana/projects usa ORG_A', async () => {
    setupAuthMocks();
    let resolvedOrgInService = '';

    AsanaService.prototype.getWorkspaceProjects = (async (orgId: string) => {
      resolvedOrgInService = orgId;
      return [{ gid: 'proj-w1', name: 'Workspace Proj 1' }];
    }) as any;

    const token = createToken({ sub: multiOrgUserId, email: 'multiorg@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: '/integrations/asana/projects',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(resolvedOrgInService, orgA);
    assert.notStrictEqual(resolvedOrgInService, orgZafira);
  });

  // =========================================================================
  // 8. TESTE DE PERMISSAO NEGATIVA - Continua Válido (Seção 25)
  // =========================================================================
  await t.test('8. Usuário no scope do cliente mas sem permissão recebe 403 do RBAC (não 404)', async () => {
    setupAuthMocks();
    let asanaServiceCalled = false;

    AsanaService.prototype.getClientProjects = (async () => {
      asanaServiceCalled = true;
      return [];
    }) as any;

    const token = createToken({ sub: noPermUserId, email: 'noperm@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientA}/asana/projects`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 403);
    assert.strictEqual(asanaServiceCalled, false);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'forbidden');
    assert.strictEqual(body.message, 'Permissao insuficiente para executar esta acao');
  });

  // =========================================================================
  // 9. API KEY / MACHINE CREDENTIAL (Seção 26)
  // =========================================================================
  await t.test('9. Chamada com API Key em rota protegida recebe 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
    const prevKey = process.env.HUB_INTERNAL_API_KEY;
    const prevOrgs = process.env.HUB_INTERNAL_API_KEY_ORGS;
    process.env.HUB_INTERNAL_API_KEY = 'test-secret-key-123';
    process.env.HUB_INTERNAL_API_KEY_ORGS = orgA;

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/clients/${clientA}/asana/projects`,
        headers: { 'x-api-key': 'test-secret-key-123' },
      });

      assert.strictEqual(response.statusCode, 403);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'forbidden');
      assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = prevKey;
      process.env.HUB_INTERNAL_API_KEY_ORGS = prevOrgs;
    }
  });

  // =========================================================================
  // 10. SECURITY SENTINEL (Seção 30)
  // =========================================================================
  await t.test('10. Security Sentinel: MEMBER sem carteira não recebe dado exclusivo sob nenhuma circunstância', async () => {
    setupAuthMocks();

    AsanaService.prototype.getClientTasks = (async () => {
      return [{ gid: 'task-sentinel', name: `Tarefa Secreta ${SENTINEL_VALUE}` }];
    }) as any;

    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const response = await app.inject({
      method: 'GET',
      url: `/clients/${clientB}/asana/tasks`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 404);
    assert.ok(!response.body.includes(SENTINEL_VALUE));
  });
  // =========================================================================
  // 11 a 14. Leituras Asana somente com escopo, permissão e organização (F6-RO.1)
  // Cobre todas as rotas de leitura de projetos e tarefas, não só a listagem.
  // =========================================================================
  const readRoutes: Array<{ path: (clientId: string) => string; method: keyof AsanaService }> = [
    { path: (c) => `/clients/${c}/asana/projects`, method: 'getClientProjects' },
    { path: (c) => `/clients/${c}/asana/tasks`, method: 'getClientTasks' },
    { path: (c) => `/clients/${c}/asana/tasks/task-gid-1`, method: 'getClientSingleTask' },
    { path: (c) => `/clients/${c}/asana/projects/proj-gid-1/sections`, method: 'getProjectSections' },
    { path: (c) => `/clients/${c}/asana/tasks/task-gid-1/subtasks`, method: 'getTaskSubtasks' },
    { path: (c) => `/clients/${c}/asana/tasks/task-gid-1/stories`, method: 'getTaskStories' },
    { path: (c) => `/clients/${c}/asana/tasks/task-gid-1/attachments`, method: 'getTaskAttachments' },
    { path: (c) => `/clients/${c}/asana/tasks/task-gid-1/dependencies`, method: 'getTaskDependencies' },
  ];

  /**
   * Substitui os métodos de leitura do AsanaService por espiões que devolvem o valor sentinela
   * e registram quais foram chamados. Restaura os originais ao final.
   */
  const withReadSpies = async (run: (called: Set<string>) => Promise<void>) => {
    const called = new Set<string>();
    const originals = new Map<string, unknown>();
    for (const route of readRoutes) {
      const name = route.method as string;
      originals.set(name, (AsanaService.prototype as any)[name]);
      (AsanaService.prototype as any)[name] = async () => {
        called.add(name);
        return [{ gid: 'leak', name: SENTINEL_VALUE }];
      };
    }
    try {
      await run(called);
    } finally {
      for (const [name, fn] of originals) {
        (AsanaService.prototype as any)[name] = fn;
      }
    }
  };

  await t.test('11. MEMBER recebe 404 em todas as leituras Asana de cliente fora da carteira, sem vazar dado', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    await withReadSpies(async (called) => {
      for (const route of readRoutes) {
        const url = route.path(clientB);
        const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
        assert.strictEqual(response.statusCode, 404, `GET ${url} deveria responder 404`);
        assert.ok(!response.body.includes(SENTINEL_VALUE), `GET ${url} não pode vazar dado`);
      }
      assert.strictEqual(called.size, 0, `AsanaService não deve ser chamado: ${[...called].join(', ')}`);
    });
  });

  await t.test('12. Requisição sem autenticação recebe 401 em todas as leituras Asana', async () => {
    setupAuthMocks();
    await withReadSpies(async (called) => {
      for (const route of readRoutes) {
        const url = route.path(clientA);
        const response = await app.inject({ method: 'GET', url });
        assert.strictEqual(response.statusCode, 401, `GET ${url} sem token deveria responder 401`);
        assert.ok(!response.body.includes(SENTINEL_VALUE));
      }
      assert.strictEqual(called.size, 0);
    });
  });

  await t.test('13. Usuário sem projects.view recebe 403 em todas as leituras Asana, mesmo no próprio escopo', async () => {
    setupAuthMocks();
    const token = createToken({ sub: noPermUserId, email: 'noperm@zafira.test', activeOrganizationId: orgA });
    await withReadSpies(async (called) => {
      for (const route of readRoutes) {
        const url = route.path(clientA);
        const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
        assert.strictEqual(response.statusCode, 403, `GET ${url} sem permissão deveria responder 403`);
        assert.ok(!response.body.includes(SENTINEL_VALUE));
      }
      assert.strictEqual(called.size, 0);
    });
  });

  await t.test('14. ADMIN da organização A recebe 404 em todas as leituras Asana de cliente da organização B', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });
    await withReadSpies(async (called) => {
      for (const route of readRoutes) {
        const url = route.path(clientOrgB);
        const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
        assert.strictEqual(response.statusCode, 404, `GET ${url} de outra organização deveria responder 404`);
        assert.ok(!response.body.includes(SENTINEL_VALUE));
      }
      assert.strictEqual(called.size, 0);
    });
  });
});
