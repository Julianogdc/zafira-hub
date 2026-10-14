import test from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../app.js';
import { prisma } from '../../../../lib/prisma.js';
import {
  SocialPublisherService,
  SocialPublisherServiceError,
} from '../social-publisher.service.js';
import {
  SocialPublisherContext,
  SocialPublisherProvider,
} from '../social-publisher.provider.js';
import { SocialPost, SocialAccount } from '@zafira/contracts';

test('SocialPublisher Client Resource Scope Hardening Suite (F4.4B-S2B)', { concurrency: 1 }, async (t) => {
  const orgA = 'org_alpha_111';
  const orgB = 'org_beta_222';

  const adminUserId = 'usr_admin_owner';
  const managerUserId = 'usr_manager_scoped';
  const memberUserId = 'usr_regular_member';
  const memberConnectUserId = 'usr_member_connect';
  const noPermUserId = 'usr_no_perm';

  const clientA = 'cli_alpha_assigned';
  const clientB = 'cli_alpha_unassigned';
  const clientTeamActive = 'cli_team_active';
  const clientTeamInactive = 'cli_team_inactive';
  const clientOrgB = 'cli_beta_foreign';

  const SENTINEL_VALUE = 'CROSS_CLIENT_SOCIAL_SENTINEL_987654';
  const CROSS_CLIENT_NAME_SENTINEL = 'CROSS_CLIENT_NAME_SENTINEL_654321';
  const CROSS_CLIENT_MIXED_STATE_SENTINEL = 'CROSS_CLIENT_MIXED_STATE_SENTINEL_246810';

  // Espiões de chamadas ao provedor BrightBean
  const providerCalls = {
    createPost: 0,
    schedulePost: 0,
    cancelPost: 0,
    listPosts: 0,
    listAccounts: 0,
    getPost: 0,
    getPostAnalytics: 0,
    getAccountAnalytics: 0,
  };

  const mockProvider: SocialPublisherProvider = {
    async getStatus() {
      return { connected: true, provider: 'BRIGHTBEAN' };
    },
    async listAccounts() {
      providerCalls.listAccounts++;
      return [
        { id: 'acc_a', platform: 'INSTAGRAM', accountName: 'Conta Client A' },
        { id: 'acc_a2', platform: 'FACEBOOK', accountName: 'Conta Facebook Client A' },
        { id: 'acc_b', platform: 'INSTAGRAM', accountName: 'Conta Client B' },
        { id: 'acc_u', platform: 'INSTAGRAM', accountName: 'Conta Unlinked' },
      ];
    },
    async listPosts(_ctx: SocialPublisherContext, filters?: any) {
      providerCalls.listPosts++;
      const allPosts: SocialPost[] = [
        {
          id: 'post_a1',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: 'Post legítimo do Client A',
          mediaItems: [],
          platformStates: [{ accountId: 'acc_a', platform: 'INSTAGRAM', status: 'PUBLISHED' }],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'post_b1',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: `Post alien do Client B contendo ${SENTINEL_VALUE}`,
          mediaItems: [],
          platformStates: [{ accountId: 'acc_b', platform: 'INSTAGRAM', status: 'PUBLISHED' }],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'post_mixed_ab',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: 'Post multidestino misto entre Client A e Client B',
          mediaItems: [],
          platformStates: [
            { accountId: 'acc_a', platform: 'INSTAGRAM', status: 'PUBLISHED' },
            {
              accountId: 'acc_b',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              permalink: `https://instagram.com/p/${CROSS_CLIENT_MIXED_STATE_SENTINEL}`,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'post_same_client',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: 'Post multidestino legítimo do mesmo Client A',
          mediaItems: [],
          platformStates: [
            { accountId: 'acc_a', platform: 'INSTAGRAM', status: 'PUBLISHED' },
            { accountId: 'acc_a2', platform: 'FACEBOOK', status: 'PUBLISHED' },
          ],
          createdAt: new Date().toISOString(),
        },
      ];

      if (filters?.socialAccountId) {
        return {
          posts: allPosts.filter((p) => p.platformStates.some((ps) => ps.accountId === filters.socialAccountId)),
          total: allPosts.length,
        };
      }

      return { posts: allPosts, total: allPosts.length };
    },
    async getPost(_ctx, postId) {
      providerCalls.getPost++;
      if (postId === 'post_a1') {
        return {
          id: 'post_a1',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: 'Post legítimo Client A',
          mediaItems: [],
          platformStates: [{ accountId: 'acc_a', platform: 'INSTAGRAM', status: 'PUBLISHED' }],
          createdAt: new Date().toISOString(),
        };
      }
      if (postId === 'post_b1') {
        return {
          id: 'post_b1',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: `Post alien Client B ${SENTINEL_VALUE}`,
          mediaItems: [],
          platformStates: [{ accountId: 'acc_b', platform: 'INSTAGRAM', status: 'PUBLISHED' }],
          createdAt: new Date().toISOString(),
        };
      }
      if (postId === 'post_mixed_ab') {
        return {
          id: 'post_mixed_ab',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: 'Post multidestino misto',
          mediaItems: [],
          platformStates: [
            { accountId: 'acc_a', platform: 'INSTAGRAM', status: 'PUBLISHED' },
            {
              accountId: 'acc_b',
              platform: 'INSTAGRAM',
              status: 'PUBLISHED',
              permalink: `https://instagram.com/p/${CROSS_CLIENT_MIXED_STATE_SENTINEL}`,
            },
          ],
          createdAt: new Date().toISOString(),
        };
      }
      if (postId === 'post_same_client') {
        return {
          id: 'post_same_client',
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'PUBLISHED',
          content: 'Post multidestino same client',
          mediaItems: [],
          platformStates: [
            { accountId: 'acc_a', platform: 'INSTAGRAM', status: 'PUBLISHED' },
            { accountId: 'acc_a2', platform: 'FACEBOOK', status: 'PUBLISHED' },
          ],
          createdAt: new Date().toISOString(),
        };
      }
      return null;
    },
    async uploadMedia() {
      return { id: 'media_upload_123', status: 'READY' } as any;
    },
    async createPost() {
      providerCalls.createPost++;
      return {
        id: 'post_created_new',
        platform: 'INSTAGRAM',
        format: 'FEED',
        status: 'DRAFT',
        content: 'Novo Post',
        mediaItems: [],
        platformStates: [{ accountId: 'acc_a', platform: 'INSTAGRAM', status: 'DRAFT' }],
        createdAt: new Date().toISOString(),
      };
    },
    async schedulePost() {
      providerCalls.schedulePost++;
      return {
        id: 'post_scheduled_1',
        platform: 'INSTAGRAM',
        format: 'FEED',
        status: 'SCHEDULED',
        content: 'Post Reagendado',
        mediaItems: [],
        platformStates: [],
        createdAt: new Date().toISOString(),
      };
    },
    async cancelPost() {
      providerCalls.cancelPost++;
      return { success: true };
    },
    async getPostAnalytics() {
      providerCalls.getPostAnalytics++;
      return { impressions: 10, reach: 8, engagement: 2 } as any;
    },
    async getAccountAnalytics() {
      providerCalls.getAccountAnalytics++;
      return { followersCount: 500, profileViews: 20 } as any;
    },
  };

  const customService = new SocialPublisherService(mockProvider, prisma as any);
  const app: FastifyInstance = buildApp({ socialPublisherService: customService });
  await app.ready();

  // Preservar métodos originais do Prisma
  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalClientFindFirst = prisma.client.findFirst;
  const originalClientFindMany = prisma.client.findMany;
  const originalIntegrationConnFindMany = prisma.integrationConnection.findMany;
  const originalClientIntegrationFindMany = prisma.clientIntegration.findMany;
  const originalClientIntegrationFindFirst = prisma.clientIntegration.findFirst;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    prisma.client.findFirst = originalClientFindFirst;
    prisma.client.findMany = originalClientFindMany;
    prisma.integrationConnection.findMany = originalIntegrationConnFindMany;
    prisma.clientIntegration.findMany = originalClientIntegrationFindMany;
    prisma.clientIntegration.findFirst = originalClientIntegrationFindFirst;

    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

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

      if (where.id === memberConnectUserId) {
        return {
          id: memberConnectUserId,
          name: 'Member Connect User',
          email: 'member-connect@zafira.test',
          status: 'ACTIVE',
          memberships: [
            {
              id: 'mem_member_connect_alpha',
              role: 'MEMBER',
              status: 'ACTIVE',
              organizationId: orgA,
              organization: { id: orgA, slug: 'org-alpha' },
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

    // 2. Mock de OrganizationMember para RBAC
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

      if (userId === memberConnectUserId && organizationId === orgA) {
        const hasConnect = requestedPerm === 'integrations.connect';
        return {
          id: 'mem_member_connect_alpha',
          organizationId: orgA,
          userId: memberConnectUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: hasConnect
            ? [{ permissionCode: 'integrations.connect', allowed: true }]
            : [],
        };
      }

      if (userId === noPermUserId && organizationId === orgA) {
        // Usuário com override explícito revogando permissão
        const isRevoked = requestedPerm === 'content.review' || requestedPerm === 'content.create';
        return {
          id: 'mem_noperm_alpha',
          organizationId: orgA,
          userId: noPermUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          permissions: isRevoked
            ? [{ permissionCode: requestedPerm, allowed: false }]
            : [],
        };
      }

      return null;
    }) as any;

    // 3. Mock de RolePermission (Padrões RBAC)
    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const { role_permissionCode } = where;
      if (!role_permissionCode) return null;
      const { role, permissionCode } = role_permissionCode;

      if (role === 'ADMIN') {
        return { role, permissionCode, granted: true };
      }

      if (role === 'MANAGER') {
        if (
          permissionCode === 'integrations.view' ||
          permissionCode === 'integrations.connect' ||
          permissionCode === 'integrations.remove' ||
          permissionCode === 'content.view' ||
          permissionCode === 'content.create' ||
          permissionCode === 'content.review' ||
          permissionCode === 'content.schedule' ||
          permissionCode === 'content.delete'
        ) {
          return { role, permissionCode, granted: true };
        }
      }

      if (role === 'MEMBER') {
        if (
          permissionCode === 'integrations.view' ||
          permissionCode === 'content.view' ||
          permissionCode === 'content.create' ||
          permissionCode === 'content.review'
        ) {
          return { role, permissionCode, granted: true };
        }
      }

      return null;
    }) as any;

    // 4. Conexão organizacional ativa da BrightBean
    prisma.integrationConnection.findMany = (async ({ where }: any) => {
      if (where.organizationId === orgA && where.provider === 'BRIGHTBEAN') {
        return [
          {
            id: 'conn_bb_alpha',
            organizationId: orgA,
            provider: 'BRIGHTBEAN',
            clientId: null,
            status: 'ACTIVE',
            externalScopeId: 'ws_alpha',
            metadata: { hiddenPostIds: [] },
          },
        ];
      }
      return [];
    }) as any;

    // 5. Mock de client.findFirst para Client Resource Scope
    prisma.client.findFirst = (async ({ where }: any) => {
      const scopeWhere = where?.AND?.[0];
      const targetId = where?.AND?.[1]?.id;

      if (!targetId || !scopeWhere) return null;
      const orgId = scopeWhere.organizationId;

      if (targetId === clientOrgB && orgId === orgA) {
        return null;
      }

      // ADMIN: scopeWhere não possui OR
      if (!scopeWhere.OR) {
        if (orgId === orgA && [clientA, clientB, clientTeamActive, clientTeamInactive].includes(targetId)) {
          return {
            id: targetId,
            name: targetId === clientB ? `Client Beta ${CROSS_CLIENT_NAME_SENTINEL}` : `Client ${targetId}`,
          };
        }
        return null;
      }

      // MANAGER / MEMBER:
      const directMembershipId = scopeWhere.OR[0]?.assignedMembers?.some?.organizationMemberId;
      const teamMembershipId = scopeWhere.OR[1]?.teamAssignments?.some?.team?.members?.some?.organizationMemberId;
      const teamActiveRequired = scopeWhere.OR[1]?.teamAssignments?.some?.team?.isActive;

      if (targetId === clientA) {
        if (
          directMembershipId === 'mem_member_alpha' ||
          directMembershipId === 'mem_manager_alpha' ||
          directMembershipId === 'mem_noperm_alpha' ||
          directMembershipId === 'mem_member_connect_alpha'
        ) {
          return { id: clientA, name: 'Client Alpha Assigned' };
        }
      }

      if (targetId === clientTeamActive) {
        if (teamActiveRequired === true && (teamMembershipId === 'mem_member_alpha' || teamMembershipId === 'mem_manager_alpha')) {
          return { id: clientTeamActive, name: 'Client Team Active' };
        }
      }

      return null;
    }) as any;

    // 6. Mock de client.findMany (usado na rota global de contas disponíveis para MANAGER/MEMBER)
    prisma.client.findMany = (async ({ where }: any) => {
      if (where.organizationId === orgA) {
        if (!where.OR) {
          // ADMIN: todos os clientes da orgA
          return [
            { id: clientA, name: 'Client A' },
            { id: clientB, name: `Client B ${CROSS_CLIENT_NAME_SENTINEL}` },
            { id: clientTeamActive, name: 'Client Team Active' },
          ];
        }
        // MEMBER/MANAGER: apenas os clientes atribuídos
        return [{ id: clientA, name: 'Client A' }];
      }
      return [];
    }) as any;

    // 7. Mock de clientIntegration
    const allIntegrations = [
      {
        id: 'ci_a',
        clientId: clientA,
        provider: 'BRIGHTBEAN',
        externalId: 'acc_a',
        client: { id: clientA, name: 'Client Alpha' },
      },
      {
        id: 'ci_a2',
        clientId: clientA,
        provider: 'BRIGHTBEAN',
        externalId: 'acc_a2',
        client: { id: clientA, name: 'Client Alpha' },
      },
      {
        id: 'ci_b',
        clientId: clientB,
        provider: 'BRIGHTBEAN',
        externalId: 'acc_b',
        client: { id: clientB, name: `Client Beta ${CROSS_CLIENT_NAME_SENTINEL}` },
      },
    ];

    prisma.clientIntegration.findMany = (async ({ where }: any) => {
      // Filtro por clientId específico
      if (where?.clientId) {
        return allIntegrations.filter((ci) => ci.clientId === where.clientId);
      }

      // Filtro por client (onde client pode ser clientScopeWhere)
      if (where?.client) {
        if (!where.client.OR) {
          // ADMIN: todos os clientes da organização
          return allIntegrations;
        }
        // MEMBER: apenas clientA in-scope
        return allIntegrations.filter((ci) => ci.clientId === clientA);
      }

      return allIntegrations;
    }) as any;

    prisma.clientIntegration.findFirst = (async ({ where }: any) => {
      for (const ci of allIntegrations) {
        if (where.externalId && ci.externalId !== where.externalId) continue;
        if (where.provider && ci.provider !== where.provider) continue;
        if (where.clientId !== undefined) {
          if (typeof where.clientId === 'object' && where.clientId.not) {
            if (ci.clientId === where.clientId.not) continue;
          } else if (ci.clientId !== where.clientId) {
            continue;
          }
        }
        if (where.client) {
          if (where.client.organizationId && where.client.organizationId !== orgA) continue;
          if (where.client.OR) {
            // Member/Manager scope: apenas clientA in-scope
            if (ci.clientId !== clientA) continue;
          }
        }
        return {
          id: ci.id,
          clientId: ci.clientId,
          provider: ci.provider,
          externalId: ci.externalId,
        };
      }
      return null;
    }) as any;

    prisma.clientIntegration.create = (async ({ data }: any) => {
      return {
        id: 'ci_created_' + Date.now(),
        ...data,
      };
    }) as any;
  }

  // =========================================================================
  // TESTES DE SEGURANÇA
  // =========================================================================

  await t.test('1. ADMIN acessa client-scoped sem direct assignment (Organization-wide)', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientB}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
  });

  await t.test('2. MEMBER read cross-client em accounts e content retorna 404 sem revelar dados', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    // Client B fora da carteira
    const resAccounts = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientB}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resAccounts.statusCode, 404);
    assert.equal(JSON.parse(resAccounts.body).error, 'CLIENT_NOT_FOUND');

    const resContent = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientB}/social/content`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resContent.statusCode, 404);
    assert.equal(JSON.parse(resContent.body).error, 'CLIENT_NOT_FOUND');
  });

  await t.test('3. MEMBER create cross-client bloqueado (escrita legada desativada, D-F84-1: 410) e provider.createPost NÃO chamado', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialCreateCount = providerCalls.createPost;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientB}/social/content`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'key_create_cross_test',
      },
      payload: {
        accountId: 'acc_b',
        format: 'FEED',
        content: `Tentativa invasiva com ${SENTINEL_VALUE}`,
      },
    });

    assert.equal(res.statusCode, 410);
    assert.equal(JSON.parse(res.body).code, 'LEGACY_WRITE_DISABLED');
    assert.equal(providerCalls.createPost, initialCreateCount, 'provider.createPost NÃO deve ser chamado');
    assert.equal(res.body.includes(SENTINEL_VALUE), false, 'Sentinel não deve vazar na resposta');
  });

  await t.test('4. MANAGER schedule e cancel cross-client bloqueados (escrita legada desativada, D-F84-1: 410) e provider NÃO chamado', async () => {
    setupAuthMocks();
    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });
    const initialScheduleCount = providerCalls.schedulePost;
    const initialCancelCount = providerCalls.cancelPost;

    const resSchedule = await app.inject({
      method: 'PATCH',
      url: `/api/v1/clients/${clientB}/social/content/post_b1/schedule`,
      headers: { authorization: `Bearer ${token}` },
      payload: { scheduledAt: '2026-11-01T10:00:00Z' },
    });
    assert.equal(resSchedule.statusCode, 410);
    assert.equal(JSON.parse(resSchedule.body).code, 'LEGACY_WRITE_DISABLED');
    assert.equal(providerCalls.schedulePost, initialScheduleCount, 'provider.schedulePost NÃO deve ser chamado');

    const resCancel = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientB}/social/content/post_b1/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resCancel.statusCode, 410);
    assert.equal(JSON.parse(resCancel.body).code, 'LEGACY_WRITE_DISABLED');
    assert.equal(providerCalls.cancelPost, initialCancelCount, 'provider.cancelPost NÃO deve ser chamado');
  });

  await t.test('5. GET /api/v1/social/content por MEMBER retorna apenas posts da carteira e filtra Client B', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.posts));

    // Apenas post_a1 deve estar presente
    const postIds = body.posts.map((p: any) => p.id);
    assert.ok(postIds.includes('post_a1'), 'post_a1 do Client A deve estar presente');
    assert.equal(postIds.includes('post_b1'), false, 'post_b1 do Client B NÃO pode estar presente');
    assert.equal(res.body.includes(SENTINEL_VALUE), false, 'Sentinel do Client B não pode aparecer');
  });

  await t.test('6. GET /api/v1/social/content?clientId=ClientB por MEMBER falha com 404 CLIENT_NOT_FOUND', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialListCount = providerCalls.listPosts;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/social/content?clientId=${clientB}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'CLIENT_NOT_FOUND');
    assert.equal(providerCalls.listPosts, initialListCount, 'Listagem remota deve ser evitada quando clientId for fora do scope');
  });

  await t.test('7. GET /api/v1/social/accounts/available por MEMBER retorna somente contas da carteira (sem unlinked nem Client B)', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/accounts/available',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const accounts = JSON.parse(res.body);
    const accIds = accounts.map((a: any) => a.id);

    assert.ok(accIds.includes('acc_a'), 'acc_a deve estar presente');
    assert.equal(accIds.includes('acc_b'), false, 'acc_b de outro cliente NÃO pode aparecer');
    assert.equal(accIds.includes('acc_u'), false, 'acc_u desvinculada NÃO pode aparecer na rota global para MEMBER');
  });

  await t.test('8. GET /api/v1/social/accounts/available por ADMIN preserva todas as contas da organização', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/accounts/available',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const accounts = JSON.parse(res.body);
    const accIds = accounts.map((a: any) => a.id);

    assert.ok(accIds.includes('acc_a'), 'ADMIN vê acc_a');
    assert.ok(accIds.includes('acc_b'), 'ADMIN vê acc_b');
    assert.ok(accIds.includes('acc_u'), 'ADMIN vê acc_u');
  });

  await t.test('9. MEMBER view-only em /clients/:clientId/social/accounts/available recebe 403 e ZERO chamadas de listAccounts', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialListAccountsCount = providerCalls.listAccounts;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/accounts/available`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'forbidden');
    assert.equal(providerCalls.listAccounts, initialListAccountsCount, 'listAccounts do provider NÃO deve ser chamado sem integrations.connect');
  });

  await t.test('10. MEMBER com integrations.connect autorizado em /clients/:A/social/accounts/available vê vinculadas a A e unlinked, ocultando Client B', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberConnectUserId, email: 'member-connect@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/accounts/available`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const accounts = JSON.parse(res.body);
    const accMap = new Map<string, any>(accounts.map((a: any) => [a.id, a]));

    // acc_a: vinculada a Client A
    assert.ok(accMap.has('acc_a'), 'acc_a vinculada a Client A deve estar presente');
    assert.equal(accMap.get('acc_a')?.isLinked, true);
    assert.equal(accMap.get('acc_a')?.linkedClientId, clientA);

    // acc_u: unlinked disponível para vínculo
    assert.ok(accMap.has('acc_u'), 'acc_u unlinked deve estar presente');
    assert.equal(accMap.get('acc_u')?.isLinked, false);
    assert.equal(accMap.get('acc_u')?.linkedClientId, null);

    // acc_b: de outro cliente NÃO deve aparecer e NÃO deve ser falsificada como isLinked: false
    assert.equal(accMap.has('acc_b'), false, 'acc_b de outro cliente deve ser omitida');
  });

  await t.test('10. Team Assignment: Team ativa concede acesso; Team inativa bloqueia com 404', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    // Equipe ativa: 200
    const resActive = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientTeamActive}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resActive.statusCode, 200);

    // Equipe inativa: 404
    const resInactive = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientTeamInactive}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resInactive.statusCode, 404);
  });

  await t.test('11. Cross-organization: cliente pertencente a outra organização retorna 404 sem vazar dados', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientOrgB}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'CLIENT_NOT_FOUND');
  });

  await t.test('12. Permission negativa: override revogando permissão resulta em 403 anterior ao Resource Scope', async () => {
    setupAuthMocks();
    const token = createToken({ sub: noPermUserId, email: 'noperm@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/content`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'forbidden');
  });

  await t.test('13. Machine credential (API key) em rotas com requirePermission é rejeitada com 403', async () => {
    setupAuthMocks();
    const prevKey = process.env.HUB_INTERNAL_API_KEY;
    const prevOrgs = process.env.HUB_INTERNAL_API_KEY_ORGS;
    process.env.HUB_INTERNAL_API_KEY = 'secret_machine_token_123';
    process.env.HUB_INTERNAL_API_KEY_ORGS = orgA;

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/clients/${clientA}/social/accounts`,
        headers: {
          'x-api-key': 'secret_machine_token_123',
          'x-organization-id': orgA,
        },
      });

      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = prevKey;
      process.env.HUB_INTERNAL_API_KEY_ORGS = prevOrgs;
    }
  });

  await t.test('14. Link e Unlink de conta em cliente fora da carteira retornam 404 sem expor vínculo', async () => {
    setupAuthMocks();
    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const resLink = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientB}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { accountId: 'acc_a' },
    });
    assert.equal(resLink.statusCode, 404);
    assert.equal(JSON.parse(resLink.body).error, 'CLIENT_NOT_FOUND');

    const resUnlink = await app.inject({
      method: 'DELETE',
      url: `/api/v1/clients/${clientB}/social/accounts/acc_b`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resUnlink.statusCode, 404);
    assert.equal(JSON.parse(resUnlink.body).error, 'CLIENT_NOT_FOUND');
  });

  await t.test('15. Analytics de post e conta em cliente fora da carteira retornam 404 sem chamar provedor', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialPostAnalyticsCount = providerCalls.getPostAnalytics;
    const initialAccAnalyticsCount = providerCalls.getAccountAnalytics;

    const resPostAnalytics = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientB}/social/content/post_b1/analytics`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resPostAnalytics.statusCode, 404);
    assert.equal(JSON.parse(resPostAnalytics.body).error, 'CLIENT_NOT_FOUND');
    assert.equal(providerCalls.getPostAnalytics, initialPostAnalyticsCount, 'getPostAnalytics remoto NÃO deve ser chamado');

    const resAccAnalytics = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientB}/social/accounts/acc_b/analytics`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resAccAnalytics.statusCode, 404);
    assert.equal(JSON.parse(resAccAnalytics.body).error, 'CLIENT_NOT_FOUND');
    assert.equal(providerCalls.getAccountAnalytics, initialAccAnalyticsCount, 'getAccountAnalytics remoto NÃO deve ser chamado');
  });

  await t.test('16. Conflito de vínculo em linkAccountToClient retorna 409 genérico e NÃO vaza CROSS_CLIENT_NAME_SENTINEL_654321', async () => {
    setupAuthMocks();
    const token = createToken({ sub: managerUserId, email: 'manager@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientA}/social/accounts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { accountId: 'acc_b' },
    });

    assert.equal(res.statusCode, 409);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'ACCOUNT_ALREADY_LINKED_TO_ANOTHER_CLIENT');
    assert.equal(body.message, 'Esta conta social já está vinculada a outro cliente nesta organização.');
    assert.equal(res.body.includes(CROSS_CLIENT_NAME_SENTINEL), false, 'Sentinel do nome do outro cliente NÃO pode vazar na resposta');
    assert.equal(res.body.includes(clientB), false, 'ID do outro cliente NÃO pode vazar na resposta');
  });

  await t.test('17. GET /api/v1/social/content?accountId=acc_b por MEMBER falha com 404 e provider.listPosts tem ZERO chamadas', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialListCount = providerCalls.listPosts;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content?accountId=acc_b',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'ACCOUNT_NOT_FOUND');
    assert.equal(providerCalls.listPosts, initialListCount, 'provider.listPosts NÃO deve ser chamado para accountId fora do scope');
    assert.equal(res.body.includes(SENTINEL_VALUE), false, 'Sentinel do Client B não pode aparecer');
  });

  await t.test('18. GET /api/v1/social/content?accountId=acc_a por MEMBER tem sucesso e chama provider normalmente', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialListCount = providerCalls.listPosts;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content?accountId=acc_a',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.posts));
    assert.equal(providerCalls.listPosts, initialListCount + 1, 'provider.listPosts deve ser chamado para accountId in-scope');
    const postIds = body.posts.map((p: any) => p.id);
    assert.ok(postIds.includes('post_a1'));
  });

  await t.test('19. GET /api/v1/social/content?accountId=acc_u por MEMBER falha com 404 e provider.listPosts tem ZERO chamadas', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });
    const initialListCount = providerCalls.listPosts;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content?accountId=acc_u',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'ACCOUNT_NOT_FOUND');
    assert.equal(providerCalls.listPosts, initialListCount, 'provider.listPosts NÃO deve ser chamado para conta unlinked');
  });

  await t.test('20. GET /api/v1/social/content?accountId=acc_b por ADMIN preserva comportamento organization-wide e tem sucesso', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });
    const initialListCount = providerCalls.listPosts;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content?accountId=acc_b',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(providerCalls.listPosts, initialListCount + 1, 'provider.listPosts deve ser chamado para ADMIN');
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.posts));
    const postIds = body.posts.map((p: any) => p.id);
    assert.ok(postIds.includes('post_b1'));
  });

  await t.test('21. Multidestino cross-client na agregação global por MEMBER omite post_mixed_ab por inteiro e não vaza sentinel', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const postIds = body.posts.map((p: any) => p.id);

    assert.ok(postIds.includes('post_a1'), 'post_a1 legítimo deve estar presente');
    assert.ok(postIds.includes('post_same_client'), 'post_same_client com múltiplos destinos do mesmo cliente deve estar presente');
    assert.equal(postIds.includes('post_b1'), false, 'post_b1 do Client B deve estar ausente');
    assert.equal(postIds.includes('post_mixed_ab'), false, 'post_mixed_ab deve ser OMITIDO POR INTEIRO');
    assert.equal(res.body.includes(CROSS_CLIENT_MIXED_STATE_SENTINEL), false, 'Sentinel de mixed state alien NÃO pode aparecer');
  });

  await t.test('22. Multidestino cross-client na agregação global por ADMIN omite post_mixed_ab por integridade semântica', async () => {
    setupAuthMocks();
    const token = createToken({ sub: adminUserId, email: 'admin@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const postIds = body.posts.map((p: any) => p.id);

    assert.ok(postIds.includes('post_a1'), 'ADMIN vê post_a1');
    assert.ok(postIds.includes('post_b1'), 'ADMIN vê post_b1');
    assert.ok(postIds.includes('post_same_client'), 'ADMIN vê post_same_client');
    assert.equal(postIds.includes('post_mixed_ab'), false, 'post_mixed_ab que divide clientes diferentes deve ser omitido mesmo para ADMIN');
    assert.equal(res.body.includes(CROSS_CLIENT_MIXED_STATE_SENTINEL), false);
  });

  await t.test('23. getClientPost com post multidestino misto (post_mixed_ab) retorna 404 POST_NOT_FOUND (Every Child Belong)', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/content/post_mixed_ab`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'POST_NOT_FOUND');
    assert.equal(res.body.includes(CROSS_CLIENT_MIXED_STATE_SENTINEL), false, 'Nenhum platformState de outro cliente é retornado');
  });

  await t.test('24. getClientPosts com post multidestino misto (post_mixed_ab) omite o post por inteiro', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/content`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const postIds = body.posts.map((p: any) => p.id);

    assert.ok(postIds.includes('post_a1'));
    assert.ok(postIds.includes('post_same_client'));
    assert.equal(postIds.includes('post_mixed_ab'), false, 'post_mixed_ab deve ser omitido da listagem do cliente');
  });

  await t.test('25. getClientPost com multidestino legítimo do mesmo cliente (post_same_client) retorna 200 com ambos os states', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/content/post_same_client`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const post = JSON.parse(res.body);
    assert.equal(post.id, 'post_same_client');
    assert.equal(post.platformStates.length, 2);
    assert.equal(post.platformStates[0].accountId, 'acc_a');
    assert.equal(post.platformStates[1].accountId, 'acc_a2');
  });

  await t.test('26. GET /api/v1/social/content?accountId=acc_a2 reconhece segundo platformState em multidestino same-client', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/social/content?accountId=acc_a2',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const postIds = body.posts.map((p: any) => p.id);

    assert.ok(postIds.includes('post_same_client'), 'post_same_client deve ser encontrado pelo filtro do segundo state');
    const matchedPost = body.posts.find((p: any) => p.id === 'post_same_client');
    assert.equal(matchedPost.accountId, 'acc_a2', 'representativeState usou acc_a2 solicitado no filtro');
    assert.equal(matchedPost.platform, 'FACEBOOK');
  });

  await t.test('27. getClientPosts com accountId e post multidestino misto (post_mixed_ab) omite post inteiro (Fail-Closed)', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    // Chamada HTTP via rota com query param accountId
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/content?accountId=acc_a`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const postIds = body.posts.map((p: any) => p.id);

    assert.ok(postIds.includes('post_a1'));
    assert.equal(postIds.includes('post_mixed_ab'), false, 'post_mixed_ab com platformState alien deve ser omitido mesmo quando accountId bate com o primeiro state');
    assert.equal(res.body.includes(CROSS_CLIENT_MIXED_STATE_SENTINEL), false, 'Sentinel alien não vaza na resposta');

    // Chamada direta no service com filter accountId explícito
    const memberScope = {
      userId: memberUserId,
      membershipId: 'mem_member_alpha',
      organizationId: orgA,
      role: 'MEMBER' as const,
      clientIds: [clientA],
    };
    const svcRes = await customService.getClientPosts(memberScope, clientA, { accountId: 'acc_a' });
    const svcPostIds = svcRes.posts.map((p) => p.id);
    assert.ok(svcPostIds.includes('post_a1'));
    assert.equal(svcPostIds.includes('post_mixed_ab'), false, 'post_mixed_ab omitido no service quando accountId é fornecido');
  });

  await t.test('28. getClientPosts com accountId secundário em post same-client (post_same_client) preserva o post', async () => {
    setupAuthMocks();
    const token = createToken({ sub: memberUserId, email: 'member@zafira.test', activeOrganizationId: orgA });

    // Chamada HTTP via rota
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}/social/content?accountId=acc_a2`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const postIds = body.posts.map((p: any) => p.id);
    assert.ok(postIds.includes('post_same_client'), 'post_same_client deve estar presente na listagem do cliente');
    assert.equal(postIds.includes('post_a1'), false, 'post_a1 não possui acc_a2 e deve ser omitido na resposta HTTP');

    // Chamada direta no service com filter accountId secundário explícito
    const memberScope = {
      userId: memberUserId,
      membershipId: 'mem_member_alpha',
      organizationId: orgA,
      role: 'MEMBER' as const,
      clientIds: [clientA],
    };
    const svcRes = await customService.getClientPosts(memberScope, clientA, { accountId: 'acc_a2' });
    const svcPostIds = svcRes.posts.map((p) => p.id);
    assert.ok(svcPostIds.includes('post_same_client'), 'post_same_client presente no filtro por conta secundária');
    assert.equal(svcPostIds.includes('post_a1'), false, 'post_a1 não possui acc_a2 e deve ser filtrado');
  });
});

