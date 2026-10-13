import test from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { ClientsService } from '../clients.service.js';
import {
  ClientMutationResultSchema,
  CreateClientRequestSchema,
  UpdateClientRequestSchema,
  CreateClientMeetingNoteRequestSchema,
  UpdateClientMeetingNoteRequestSchema,
  ClientDetailSchema,
  ClientMeetingNoteSchema,
  isValidHttpUrl,
} from '@zafira/contracts';

test('Clients Hardening, APIs Canônicas, Sub-recursos e Timeline (HTTP Integration Tests)', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindManyMember = prisma.organizationMember.findMany;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalFindManyClient = (prisma as any).client.findMany;
  const originalFindFirstClient = (prisma as any).client.findFirst;
  const originalCreateClient = (prisma as any).client.create;
  const originalUpdateClient = (prisma as any).client.update;
  const originalFindManyTeam = (prisma as any).team.findMany;
  const originalCreateManyTeamAssignment = (prisma as any).teamClientAssignment.createMany;
  const originalDeleteManyTeamAssignment = (prisma as any).teamClientAssignment.deleteMany;
  const originalFindManyTeamAssignment = (prisma as any).teamClientAssignment.findMany;
  const originalCreateUserAssignment = (prisma as any).userClientAssignment.create;
  const originalCreateAudit = (prisma as any).auditLog.create;
  const originalFindManyAudit = (prisma as any).auditLog.findMany;
  const originalFindManyContact = (prisma as any).clientContact.findMany;
  const originalFindFirstContact = (prisma as any).clientContact.findFirst;
  const originalCreateContact = (prisma as any).clientContact.create;
  const originalUpdateContact = (prisma as any).clientContact.update;
  const originalDeleteContact = (prisma as any).clientContact.delete;
  const originalUpdateManyContact = (prisma as any).clientContact.updateMany;
  const originalFindManyMeeting = (prisma as any).clientMeetingNote.findMany;
  const originalFindFirstMeeting = (prisma as any).clientMeetingNote.findFirst;
  const originalCreateMeeting = (prisma as any).clientMeetingNote.create;
  const originalUpdateMeeting = (prisma as any).clientMeetingNote.update;
  const originalDeleteMeeting = (prisma as any).clientMeetingNote.delete;
  const originalFindManyConn = (prisma as any).integrationConnection.findMany;
  const originalTransaction = prisma.$transaction;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    prisma.organizationMember.findMany = originalFindManyMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    (prisma as any).client.findMany = originalFindManyClient;
    (prisma as any).client.findFirst = originalFindFirstClient;
    (prisma as any).client.create = originalCreateClient;
    (prisma as any).client.update = originalUpdateClient;
    (prisma as any).team.findMany = originalFindManyTeam;
    (prisma as any).teamClientAssignment.createMany = originalCreateManyTeamAssignment;
    (prisma as any).teamClientAssignment.deleteMany = originalDeleteManyTeamAssignment;
    (prisma as any).teamClientAssignment.findMany = originalFindManyTeamAssignment;
    (prisma as any).userClientAssignment.create = originalCreateUserAssignment;
    (prisma as any).auditLog.create = originalCreateAudit;
    (prisma as any).auditLog.findMany = originalFindManyAudit;
    (prisma as any).clientContact.findMany = originalFindManyContact;
    (prisma as any).clientContact.findFirst = originalFindFirstContact;
    (prisma as any).clientContact.create = originalCreateContact;
    (prisma as any).clientContact.update = originalUpdateContact;
    (prisma as any).clientContact.delete = originalDeleteContact;
    (prisma as any).clientContact.updateMany = originalUpdateManyContact;
    (prisma as any).clientMeetingNote.findMany = originalFindManyMeeting;
    (prisma as any).clientMeetingNote.findFirst = originalFindFirstMeeting;
    (prisma as any).clientMeetingNote.create = originalCreateMeeting;
    (prisma as any).clientMeetingNote.update = originalUpdateMeeting;
    (prisma as any).clientMeetingNote.delete = originalDeleteMeeting;
    (prisma as any).integrationConnection.findMany = originalFindManyConn;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgId = '11111111-1111-4111-8111-111111111111';
  const defaultUserId = '22222222-2222-4222-8222-222222222222';
  const defaultClientId = '33333333-3333-4333-8333-333333333333';
  const targetMemberId = '44444444-4444-4444-8444-444444444444';
  const teamId1 = '55555555-5555-4555-8555-555555555555';
  const contactId1 = '66666666-6666-4666-8666-666666666666';
  const meetingId1 = '77777777-7777-4777-8777-777777777777';

  function mockAuth({
    userId = defaultUserId,
    role = 'ADMIN',
    allowedPermissions = [] as string[],
  }) {
    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: `${userId}@zafira.com`,
          status: 'ACTIVE',
          memberships: [
            {
              id: `mem_${userId}`,
              role,
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-test', name: 'Org Test' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const targetUid = where.organizationId_userId?.userId;
      if (targetUid === userId) {
        return {
          id: `mem_${userId}`,
          role,
          status: 'ACTIVE',
          organizationId: orgId,
          userId,
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      if (targetUid === targetMemberId) {
        return {
          id: `mem_${targetMemberId}`,
          role: 'MEMBER',
          status: 'ACTIVE',
          organizationId: orgId,
          userId: targetMemberId,
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const pCode = where.role_permissionCode?.permissionCode;
      if (allowedPermissions.includes(pCode)) {
        return { id: `rp_${pCode}`, role, permissionCode: pCode, granted: true };
      }
      return null;
    }) as any;

    // Transaction mock: executa callback recebendo o próprio prisma mock
    prisma.$transaction = (async (cb: any) => {
      if (typeof cb === 'function') {
        return await cb(prisma);
      }
      return cb;
    }) as any;
  }

  /* ==========================================================================
     GRUPO 1: GET /clients (DTO SEGURO DA CARTEIRA)
     ========================================================================== */

  await t.test('1.1 a 1.5: GET /clients sanitiza DTO da carteira, não expõe dados sensíveis e exclui POSTIZ', async () => {
    mockAuth({
      allowedPermissions: ['clients.list', 'teams.view', 'integrations.view'],
    });

    (prisma as any).client.findMany = (async () => [
      {
        id: defaultClientId,
        organizationId: orgId,
        name: 'Cliente Seguro',
        legalName: 'Cliente Razão Social',
        document: '12.345.678/0001-90', // Sensível: não pode vazar
        contractValue: 15000.0, // Sensível: não pode vazar
        notes: 'Notas confidenciais', // Sensível: não pode vazar
        briefing: { objective: 'Briefing' }, // Não pode vazar
        brandKit: { colors: [] }, // Não pode vazar
        status: 'ACTIVE',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        responsibleUser: {
          id: defaultUserId,
          name: 'Gestor Teste',
          email: 'gestor@zafira.com',
          avatarUrl: null,
        },
        teamAssignments: [
          { team: { id: teamId1, name: 'Squad Performance' } },
        ],
        contacts: [
          { name: 'Contato Primário', email: 'contato@cliente.com', phone: '11999999999' },
        ],
        integrationConnections: [
          { id: '88888888-8888-4888-8888-888888888888' },
        ],
      },
    ]) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.length, 1);
    const item = body[0];

    // Campos permitidos
    assert.strictEqual(item.id, defaultClientId);
    assert.strictEqual(item.name, 'Cliente Seguro');
    assert.strictEqual(item.legalName, 'Cliente Razão Social');
    assert.strictEqual(item.status, 'ACTIVE');
    assert.strictEqual(item.responsibleUser.name, 'Gestor Teste');
    assert.strictEqual(item.squads.length, 1);
    assert.strictEqual(item.squads[0].name, 'Squad Performance');
    assert.strictEqual(item.primaryContact.name, 'Contato Primário');
    assert.strictEqual(item.activeIntegrationsCount, 1);

    // Campos que NÃO PODEM vazar
    assert.strictEqual(item.document, undefined);
    assert.strictEqual(item.contractValue, undefined);
    assert.strictEqual(item.notes, undefined);
    assert.strictEqual(item.briefing, undefined);
    assert.strictEqual(item.brandKit, undefined);
    assert.strictEqual(item.credentialCiphertext, undefined);
  });

  await t.test('1.6 & 1.7: GET /clients sem teams.view retorna squads vazio', async () => {
    mockAuth({
      allowedPermissions: ['clients.list'], // Sem teams.view nem integrations.view
    });

    (prisma as any).client.findMany = (async () => [
      {
        id: defaultClientId,
        name: 'Cliente Sem View Teams',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        teamAssignments: [{ team: { id: teamId1, name: 'Squad Secreta' } }],
        contacts: [],
        integrationConnections: [{ id: 'conn_1' }],
      },
    ]) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body[0].squads, []);
    assert.strictEqual(body[0].activeIntegrationsCount, 0);
  });

  /* ==========================================================================
     GRUPO 2: GET /clients/:id (CLIENT DETAIL CANÔNICO & SENSITIVE/FINANCIAL)
     ========================================================================== */

  await t.test('2.1: GET /clients/:id sem clients.view_sensitive retorna document = null', async () => {
    mockAuth({
      allowedPermissions: ['clients.view', 'financial.view_summary'],
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      name: 'Cliente Detail',
      document: '123456789',
      contractValue: 5000,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      teamAssignments: [],
      contacts: [],
      meetingNotes: [],
      integrationConnections: [],
    })) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.document, null); // FAIL-CLOSED
    assert.strictEqual(body.contractValue, 5000); // Com financial.view_summary
  });

  await t.test('2.2: GET /clients/:id com clients.view_sensitive retorna document real', async () => {
    mockAuth({
      allowedPermissions: ['clients.view', 'clients.view_sensitive'],
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      name: 'Cliente Detail',
      document: '987654321',
      contractValue: 5000,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      teamAssignments: [],
      contacts: [],
      meetingNotes: [],
      integrationConnections: [],
    })) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.document, '987654321');
    assert.strictEqual(body.contractValue, null); // Sem financial.view_summary -> null!
  });

  await t.test('2.3: GET /clients/:id fora do Resource Scope retorna 404', async () => {
    mockAuth({
      allowedPermissions: ['clients.view'],
    });

    (prisma as any).client.findFirst = (async () => null) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  /* ==========================================================================
     GRUPO 3: POST & PATCH FIELD-LEVEL AUTHORIZATION
     ========================================================================== */

  await t.test('3.1: POST /clients com responsibleUserId sem users.assign_clients retorna 403', async () => {
    mockAuth({
      allowedPermissions: ['clients.create'], // sem users.assign_clients
    });

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Novo Cliente',
        responsibleUserId: targetMemberId,
      },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'error');
  });

  await t.test('3.2: POST /clients com responsibleUserId e users.assign_clients retorna 201', async () => {
    mockAuth({
      allowedPermissions: ['clients.create', 'users.assign_clients'],
    });

    (prisma as any).client.create = (async ({ data }: any) => ({
      id: defaultClientId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Novo Cliente Autorizado',
        responsibleUserId: targetMemberId,
      },
    });

    assert.strictEqual(res.statusCode, 201);
  });

  await t.test('3.3: POST /clients com contractValue sem financial.edit retorna 403', async () => {
    mockAuth({
      allowedPermissions: ['clients.create'], // sem financial.edit
    });

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cliente Com Valor',
        contractValue: 12000,
      },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('3.4: POST /clients com teamIds sem teams.manage retorna 403', async () => {
    mockAuth({
      allowedPermissions: ['clients.create'], // sem teams.manage
    });

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cliente Com Squads',
        teamIds: [teamId1],
      },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('3.5: POST /clients com teamIds inválidos/cross-tenant retorna 400', async () => {
    mockAuth({
      allowedPermissions: ['clients.create', 'teams.manage'],
    });

    // Mock retorna equipes vazias => validação falha
    (prisma as any).team.findMany = (async () => []) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cliente Com Squad Alien',
        teamIds: [teamId1],
      },
    });

    assert.strictEqual(res.statusCode, 400);
  });

  await t.test('3.6: PATCH /clients/:id com mesmo contractValue não exige financial.edit', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'], // sem financial.edit
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      name: 'Cliente Existente',
      contractValue: 10000,
      teamAssignments: [],
    })) as any;

    (prisma as any).client.update = (async ({ data }: any) => ({
      id: defaultClientId,
      name: data.name ?? 'Cliente Existente',
      status: data.status ?? 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contractValue: 10000, // mesmo valor material!
        notes: 'Atualizando apenas notas',
      },
    });

    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('3.7: PATCH /clients/:id com mesma composição de teamIds em ordem diferente não exige teams.manage', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'], // sem teams.manage
    });

    const teamId2 = '99999999-9999-4999-8999-999999999999';

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      name: 'Cliente Existente',
      teamAssignments: [{ teamId: teamId1 }, { teamId: teamId2 }],
    })) as any;

    (prisma as any).client.update = (async ({ data }: any) => ({
      id: defaultClientId,
      name: data.name ?? 'Cliente Existente',
      status: data.status ?? 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        teamIds: [teamId2, teamId1], // mesma composição, ordem inversa!
      },
    });

    assert.strictEqual(res.statusCode, 200);
  });

  /* ==========================================================================
     GRUPO 4: CLIENT CONTACTS (Stakeholders)
     ========================================================================== */

  await t.test('4.1: POST /clients/:id/contacts com isPrimary: true desmarca primário anterior', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    let updatedManyCalled = false;
    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
    })) as any;

    (prisma as any).clientContact.updateMany = (async ({ data }: any) => {
      if (data.isPrimary === false) {
        updatedManyCalled = true;
      }
      return { count: 1 };
    }) as any;

    (prisma as any).clientContact.create = (async ({ data }: any) => ({
      id: contactId1,
      organizationId: orgId,
      clientId: defaultClientId,
      name: data.name,
      role: data.role,
      email: data.email,
      phone: data.phone,
      isPrimary: data.isPrimary,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Novo Contato Diretor',
        email: 'diretor@cliente.com',
        isPrimary: true,
      },
    });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(updatedManyCalled, true);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.isPrimary, true);
  });

  await t.test('4.2: DELETE /clients/:id/contacts/:contactId deleta e não promove outro', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;
    (prisma as any).clientContact.findFirst = (async () => ({
      id: contactId1,
      name: 'Contato Deletado',
      isPrimary: true,
    })) as any;

    let deletedId: string | null = null;
    (prisma as any).clientContact.delete = (async ({ where }: any) => {
      deletedId = where.id;
      return {};
    }) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'DELETE',
      url: `/clients/${defaultClientId}/contacts/${contactId1}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(deletedId, contactId1);
  });

  /* ==========================================================================
     GRUPO 5: CLIENT MEETING NOTES (Memória do Relacionamento)
     ========================================================================== */

  await t.test('5.1: POST /clients/:id/meetings associa autor ao usuário logado e rejeita spoofing', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;

    let savedAuthorUserId: string | null = null;
    (prisma as any).clientMeetingNote.create = (async ({ data }: any) => {
      savedAuthorUserId = data.authorUserId;
      return {
        id: meetingId1,
        organizationId: orgId,
        clientId: defaultClientId,
        title: data.title,
        meetingDate: data.meetingDate,
        summary: data.summary,
        actionItems: null,
        externalLink: null,
        authorUserId: data.authorUserId,
        authorUser: { name: 'Admin Real' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Alinhamento Semanal',
        meetingDate: '2026-10-08T10:00:00.000Z',
        summary: 'Reunião de alinhamento de escopo',
        authorUserId: 'spoofed_user_id', // deve ser ignorado pelo schema/backend
      },
    });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(savedAuthorUserId, defaultUserId); // gravou usuário logado!
  });

  /* ==========================================================================
     GRUPO 6: TIMELINE CONTEXTUAL
     ========================================================================== */

  await t.test('6.1: GET /clients/:id/timeline agrega eventos factuais e não vaza AuditLog cru', async () => {
    mockAuth({
      allowedPermissions: ['clients.view', 'integrations.view'],
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      startDate: new Date('2026-01-05T00:00:00.000Z'),
    })) as any;

    (prisma as any).clientMeetingNote.findMany = (async () => [
      {
        id: meetingId1,
        title: 'Kickoff do Projeto',
        meetingDate: new Date('2026-01-06T14:00:00.000Z'),
        summary: 'Reunião inicial com stakeholders',
        authorUser: { name: 'Especialista' },
      },
    ]) as any;

    (prisma as any).auditLog.findMany = (async () => [
      {
        id: 'audit_event_1',
        action: 'client.responsible_changed',
        createdAt: new Date('2026-01-07T12:00:00.000Z'),
        actorUser: { name: 'Diretor' },
      },
    ]) as any;

    (prisma as any).integrationConnection.findMany = (async () => [
      {
        id: 'conn_asana_1',
        provider: 'ASANA',
        status: 'ACTIVE',
        displayName: 'Workspace Asana',
        createdAt: new Date('2026-01-08T09:00:00.000Z'),
      },
    ]) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}/timeline`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const events = JSON.parse(res.body);
    assert.strictEqual(events.length, 5);

    // Tipos de evento esperados
    const types = events.map((e: any) => e.type);
    assert.ok(types.includes('INTEGRATION_CONNECTED'));
    assert.ok(types.includes('RESPONSIBLE_CHANGED'));
    assert.ok(types.includes('MEETING_RECORDED'));
    assert.ok(types.includes('DATA_UPDATED'));
    assert.ok(types.includes('CLIENT_CREATED'));

    // Verifica que nenhum campo técnico de AuditLog vazou
    for (const e of events) {
      assert.strictEqual(e.before, undefined);
      assert.strictEqual(e.after, undefined);
      assert.strictEqual(e.metadata, undefined);
      assert.strictEqual(e.stackTrace, undefined);
    }
  });

  await t.test('6.2: GET /clients/:id/timeline sem integrations.view não exibe eventos de integração', async () => {
    mockAuth({
      allowedPermissions: ['clients.view'], // sem integrations.view
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
    })) as any;

    (prisma as any).clientMeetingNote.findMany = (async () => []) as any;
    (prisma as any).auditLog.findMany = (async () => []) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}/timeline`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const events = JSON.parse(res.body);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'CLIENT_CREATED');
  });

  await t.test('6.3: Timeline de cliente fora do Resource Scope retorna 404', async () => {
    mockAuth({
      allowedPermissions: ['clients.view'],
    });

    (prisma as any).client.findFirst = (async () => null) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}/timeline`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  /* ==========================================================================
     TESTES ADICIONAIS: AUTO-ASSIGNMENT NÃO-ADMIN E OPERAÇÕES RESTANTES
     ========================================================================== */

  await t.test('3.8: POST /clients por MANAGER cria UserClientAssignment automaticamente para o criador', async () => {
    mockAuth({
      userId: targetMemberId,
      role: 'MANAGER',
      allowedPermissions: ['clients.create'],
    });

    let createdAssignment: any = null;
    (prisma as any).client.create = (async ({ data }: any) => ({
      id: defaultClientId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).userClientAssignment.create = (async ({ data }: any) => {
      createdAssignment = data;
      return data;
    }) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: targetMemberId, email: 'manager@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cliente Criado Por Manager',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    assert.ok(createdAssignment);
    assert.strictEqual(createdAssignment.clientId, defaultClientId);
    assert.strictEqual(createdAssignment.organizationMemberId, `mem_${targetMemberId}`);
  });

  await t.test('4.3: GET /clients/:id/contacts sem clients.view retorna 403', async () => {
    mockAuth({
      allowedPermissions: [], // sem clients.view
    });

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('4.4: PATCH /clients/:id/contacts/:contactId atualiza dados com clients.edit', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;
    (prisma as any).clientContact.findFirst = (async () => ({
      id: contactId1,
      clientId: defaultClientId,
      name: 'Nome Antigo',
      isPrimary: false,
    })) as any;

    (prisma as any).clientContact.update = (async ({ data }: any) => ({
      id: contactId1,
      organizationId: orgId,
      clientId: defaultClientId,
      name: data.name ?? 'Nome Antigo',
      role: 'Gerente',
      email: 'novo@email.com',
      phone: null,
      isPrimary: false,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}/contacts/${contactId1}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Nome Atualizado',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.name, 'Nome Atualizado');
  });

  await t.test('5.2: GET /clients/:id/meetings lista atas ordenadas por meetingDate desc', async () => {
    mockAuth({
      allowedPermissions: ['clients.view'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;
    (prisma as any).clientMeetingNote.findMany = (async () => [
      {
        id: meetingId1,
        organizationId: orgId,
        clientId: defaultClientId,
        title: 'Reunião Mais Recente',
        meetingDate: new Date('2026-10-09T10:00:00.000Z'),
        summary: 'Resumo mais recente',
        actionItems: null,
        externalLink: null,
        authorUserId: defaultUserId,
        authorUser: { name: 'Admin' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].title, 'Reunião Mais Recente');
  });

  await t.test('5.3: DELETE /clients/:id/meetings/:meetingId exclui ata de reunião', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;
    (prisma as any).clientMeetingNote.findFirst = (async () => ({
      id: meetingId1,
      clientId: defaultClientId,
      title: 'Reunião Para Deletar',
    })) as any;

    let deletedMeetingId: string | null = null;
    (prisma as any).clientMeetingNote.delete = (async ({ where }: any) => {
      deletedMeetingId = where.id;
      return {};
    }) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'DELETE',
      url: `/clients/${defaultClientId}/meetings/${meetingId1}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(deletedMeetingId, meetingId1);
  });

  await t.test('5.4: POST /clients/:id/meetings aceita URL HTTPS e aceita ausência de URL', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;
    let savedExternalLink: string | null = null;
    (prisma as any).clientMeetingNote.create = (async ({ data }: any) => {
      savedExternalLink = data.externalLink;
      return {
        id: meetingId1,
        organizationId: orgId,
        clientId: defaultClientId,
        title: data.title,
        meetingDate: data.meetingDate,
        summary: data.summary,
        actionItems: null,
        externalLink: data.externalLink,
        authorUserId: defaultUserId,
        authorUser: { name: 'Admin Real' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });

    // Com URL HTTPS válida
    const resHttps = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Reunião com HTTPS',
        meetingDate: '2026-10-09T10:00:00.000Z',
        summary: 'Resumo com link HTTPS',
        externalLink: 'https://meet.google.com/abc-defg-hij',
      },
    });
    assert.strictEqual(resHttps.statusCode, 201);
    assert.strictEqual(savedExternalLink, 'https://meet.google.com/abc-defg-hij');

    // Sem URL (omitido)
    const resNoUrl = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Reunião sem link',
        meetingDate: '2026-10-09T10:00:00.000Z',
        summary: 'Resumo sem externalLink',
      },
    });
    assert.strictEqual(resNoUrl.statusCode, 201);
  });

  await t.test('5.5: POST /clients/:id/meetings rejeita URLs inseguras (javascript:, data:, malformada) com 400', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });

    // javascript:
    const resJs = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Reunião XSS',
        meetingDate: '2026-10-09T10:00:00.000Z',
        summary: 'Tentativa XSS',
        externalLink: 'javascript:alert(1)',
      },
    });
    assert.strictEqual(resJs.statusCode, 400);

    // data:
    const resData = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Reunião Data URL',
        meetingDate: '2026-10-09T10:00:00.000Z',
        summary: 'Data URI',
        externalLink: 'data:text/html;base64,PHNjcmlwdD4=',
      },
    });
    assert.strictEqual(resData.statusCode, 400);

    // malformada
    const resMalformed = await app.inject({
      method: 'POST',
      url: `/clients/${defaultClientId}/meetings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Reunião Link Inválido',
        meetingDate: '2026-10-09T10:00:00.000Z',
        summary: 'String qualquer',
        externalLink: 'not-a-url',
      },
    });
    assert.strictEqual(resMalformed.statusCode, 400);
  });

  await t.test('5.6: PATCH /clients/:id/meetings/:meetingId permite externalLink: null e rejeita insegura', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'],
    });

    (prisma as any).client.findFirst = (async () => ({ id: defaultClientId })) as any;
    (prisma as any).clientMeetingNote.findFirst = (async () => ({
      id: meetingId1,
      clientId: defaultClientId,
      organizationId: orgId,
      title: 'Ata Existente',
      summary: 'Resumo',
      externalLink: 'https://docs.zafira.agency/antigo',
    })) as any;

    let updatedExternalLink: any = undefined;
    (prisma as any).clientMeetingNote.update = (async ({ data }: any) => {
      updatedExternalLink = data.externalLink;
      return {
        id: meetingId1,
        organizationId: orgId,
        clientId: defaultClientId,
        title: 'Ata Existente',
        meetingDate: new Date(),
        summary: 'Resumo',
        actionItems: null,
        externalLink: data.externalLink,
        authorUserId: defaultUserId,
        authorUser: { name: 'Admin' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });

    // Permite externalLink: null
    const resNull = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}/meetings/${meetingId1}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        externalLink: null,
      },
    });
    assert.strictEqual(resNull.statusCode, 200);
    assert.strictEqual(updatedExternalLink, null);

    // Rejeita javascript:
    const resJs = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}/meetings/${meetingId1}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        externalLink: 'javascript:alert(2)',
      },
    });
    assert.strictEqual(resJs.statusCode, 400);
  });
});

test('ClientsService - Hardening de Autorização e Resolução de Usuário (Cenários A a H)', async (t) => {
  const svc = new ClientsService();
  const orgId = '11111111-1111-4111-8111-111111111111';
  const otherOrgId = '99999999-9999-4999-8999-999999999999';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const validMemberId = 'mem-valid-1';

  const originalFindFirstMember = prisma.organizationMember.findFirst;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;

  t.after(() => {
    prisma.organizationMember.findFirst = originalFindFirstMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
  });

  // A. contexto HTTP com userId válido resolve permission normalmente
  await t.test('A. contexto com userId válido resolve permission normalmente', async () => {
    (prisma as any).rolePermission.findUnique = (async () => ({ granted: true })) as any;
    prisma.organizationMember.findUnique = (async () => ({
      id: validMemberId,
      role: 'ADMIN',
      status: 'ACTIVE',
      organizationId: orgId,
      userId: validUserId,
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    const allowed = await (svc as any).checkPermission({
      userId: validUserId,
      organizationId: orgId,
      membershipId: validMemberId,
      role: 'ADMIN',
    }, 'financial.edit');
    assert.strictEqual(allowed, true);
  });

  // B. contexto programático sem userId, mas com membershipId válido da mesma organization, resolve o User correto
  await t.test('B. contexto programático sem userId, mas com membershipId ativo da mesma org, resolve userId', async () => {
    prisma.organizationMember.findFirst = (async ({ where }: any) => {
      if (where.id === validMemberId && where.organizationId === orgId && where.status === 'ACTIVE' && where.user?.status === 'ACTIVE') {
        return { userId: validUserId };
      }
      return null;
    }) as any;

    const resolved = await (svc as any).resolveUserId({
      organizationId: orgId,
      membershipId: validMemberId,
      role: 'MANAGER',
    });
    assert.strictEqual(resolved, validUserId);
  });

  // C. membershipId de outra organization NÃO resolve userId
  await t.test('C. membershipId de outra organization NÃO resolve userId (tenant-isolation)', async () => {
    prisma.organizationMember.findFirst = (async ({ where }: any) => {
      if (where.id === validMemberId && where.organizationId === otherOrgId) {
        return null;
      }
      return null;
    }) as any;

    const resolved = await (svc as any).resolveUserId({
      organizationId: otherOrgId,
      membershipId: validMemberId,
      role: 'MANAGER',
    });
    assert.strictEqual(resolved, undefined);
  });

  // D. membership INACTIVE/SUSPENDED não resolve autorização
  await t.test('D. membership INACTIVE/SUSPENDED não resolve autorização', async () => {
    prisma.organizationMember.findFirst = (async () => null) as any;

    const resolved = await (svc as any).resolveUserId({
      organizationId: orgId,
      membershipId: 'mem-suspended',
      role: 'MEMBER',
    });
    assert.strictEqual(resolved, undefined);

    const allowed = await (svc as any).checkPermission({
      organizationId: orgId,
      membershipId: 'mem-suspended',
      role: 'MEMBER',
    }, 'financial.edit');
    assert.strictEqual(allowed, false);
  });

  // E. User INACTIVE não resolve autorização
  await t.test('E. User INACTIVE não resolve autorização', async () => {
    prisma.organizationMember.findFirst = (async () => null) as any;

    const resolved = await (svc as any).resolveUserId({
      organizationId: orgId,
      membershipId: 'mem-user-inactive',
      role: 'MANAGER',
    });
    assert.strictEqual(resolved, undefined);

    const allowed = await (svc as any).checkPermission({
      organizationId: orgId,
      membershipId: 'mem-user-inactive',
      role: 'MANAGER',
    }, 'financial.edit');
    assert.strictEqual(allowed, false);
  });

  // F. ausência de userId resolvível resulta em fail-closed
  await t.test('F. ausência de userId resolvível resulta em fail-closed', async () => {
    prisma.organizationMember.findFirst = (async () => null) as any;

    const allowed = await (svc as any).checkPermission({
      organizationId: orgId,
      membershipId: 'mem-inexistente',
      role: 'MEMBER',
    }, 'financial.edit');
    assert.strictEqual(allowed, false);
  });

  // G. role ADMIN sem userId/membership humano válido NÃO recebe permission automaticamente
  await t.test('G. role ADMIN sem userId/membership humano válido NÃO recebe permission automaticamente (sem bypass)', async () => {
    prisma.organizationMember.findFirst = (async () => null) as any;

    const allowed = await (svc as any).checkPermission({
      organizationId: orgId,
      membershipId: 'mem-inexistente',
      role: 'ADMIN',
    }, 'financial.edit');
    assert.strictEqual(allowed, false);
  });

  // H. Role nunca substitui resolveAuthorizationContext
  await t.test('H. Role nunca substitui resolveAuthorizationContext: ADMIN sem permissão concedida no RBAC recebe false', async () => {
    prisma.organizationMember.findFirst = (async () => ({ userId: validUserId })) as any;
    prisma.organizationMember.findUnique = (async () => ({
      id: validMemberId,
      role: 'ADMIN',
      status: 'ACTIVE',
      organizationId: orgId,
      userId: validUserId,
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;
    (prisma as any).rolePermission.findUnique = (async () => null) as any;

    const allowed = await (svc as any).checkPermission({
      userId: validUserId,
      organizationId: orgId,
      membershipId: validMemberId,
      role: 'ADMIN',
    }, 'financial.edit');
    assert.strictEqual(allowed, false, 'ADMIN sem rolePermission concedida não pode receber true');
  });
});

test('Clients Hardening - Respostas de Mutação Seguras e Auditoria Financeira (F5-IMP.2.2)', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgId = '11111111-1111-4111-8111-111111111111';
  const defaultUserId = '22222222-2222-4222-8222-222222222222';
  const defaultClientId = '33333333-3333-4333-8333-333333333333';

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalFindFirstClient = (prisma as any).client.findFirst;
  const originalCreateClient = (prisma as any).client.create;
  const originalUpdateClient = (prisma as any).client.update;
  const originalCreateAudit = (prisma as any).auditLog.create;
  const originalCreateUserAssignment = (prisma as any).userClientAssignment.create;
  const originalTransaction = prisma.$transaction;

  (prisma as any).userClientAssignment.create = (async () => ({})) as any;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    (prisma as any).client.findFirst = originalFindFirstClient;
    (prisma as any).client.create = originalCreateClient;
    (prisma as any).client.update = originalUpdateClient;
    (prisma as any).auditLog.create = originalCreateAudit;
    (prisma as any).userClientAssignment.create = originalCreateUserAssignment;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  function mockAuth({
    userId = defaultUserId,
    role = 'MANAGER',
    allowedPermissions = [] as string[],
  }) {
    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === userId) {
        return {
          id: userId,
          email: `${userId}@zafira.com`,
          status: 'ACTIVE',
          memberships: [
            {
              id: `mem_${userId}`,
              role,
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-test', name: 'Org Test' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const targetUid = where.organizationId_userId?.userId;
      if (targetUid === userId) {
        return {
          id: `mem_${userId}`,
          role,
          status: 'ACTIVE',
          organizationId: orgId,
          userId,
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async ({ where }: any) => {
      const pCode = where.role_permissionCode?.permissionCode;
      if (allowedPermissions.includes(pCode)) {
        return { id: `rp_${pCode}`, role, permissionCode: pCode, granted: true };
      }
      return null;
    }) as any;

    (prisma as any).organizationMember.findMany = (async () => []) as any;
  }

  // 1. Validação do DTO de mutação
  await t.test('1. ClientMutationResultSchema aceita estritamente campos canônicos e rejeita dados sensíveis', async () => {
    const valid = ClientMutationResultSchema.parse({
      id: defaultClientId,
      name: 'Client Alpha',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.strictEqual(valid.id, defaultClientId);
    assert.strictEqual(valid.name, 'Client Alpha');

    // Inspecionar que não possui campos adicionais
    assert.strictEqual((valid as any).contractValue, undefined);
    assert.strictEqual((valid as any).document, undefined);
    assert.strictEqual((valid as any).organizationId, undefined);
  });

  // 2. PATCH /clients/:id NÃO vaza financeiro quando usuário possui clients.edit mas não financial.view_summary
  await t.test('2. PATCH /clients/:id não vaza contractValue sem financial.view_summary', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit'], // NÃO possui financial.view_summary
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      name: 'Client Existing',
      legalName: 'Legal Name SA',
      document: '12345678900',
      contractValue: 10000,
      notes: 'Segredo de notas',
      briefing: { objective: 'briefing secreto' },
      brandKit: { colors: [] },
      status: 'ACTIVE',
      teamAssignments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).client.update = (async ({ data }: any) => ({
      id: defaultClientId,
      name: data.name ?? 'Client Existing',
      legalName: 'Legal Name SA',
      document: '12345678900',
      contractValue: 10000,
      notes: 'Segredo de notas',
      briefing: { objective: 'briefing secreto' },
      brandKit: { colors: [] },
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    const token = createToken({ sub: defaultUserId, email: 'manager@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Client Name Updated' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.name, 'Client Name Updated');
    assert.strictEqual(body.contractValue, undefined, 'contractValue NÃO pode vazar no retorno da mutação');
    assert.strictEqual(body.document, undefined, 'document NÃO pode vazar no retorno da mutação');
    assert.strictEqual(body.notes, undefined, 'notes NÃO pode vazar no retorno da mutação');
    assert.strictEqual(body.briefing, undefined, 'briefing NÃO pode vazar no retorno da mutação');
    assert.strictEqual(body.brandKit, undefined, 'brandKit NÃO pode vazar no retorno da mutação');
    assert.strictEqual(body.legalName, undefined, 'legalName NÃO deve constar no resultado mínimo');
  });

  // 3. POST /clients NÃO vaza document mesmo quando enviado, se não possuir clients.view_sensitive
  await t.test('3. POST /clients não vaza document na resposta mesmo após envio', async () => {
    mockAuth({
      allowedPermissions: ['clients.create'], // NÃO possui clients.view_sensitive
    });

    (prisma as any).client.create = (async ({ data }: any) => ({
      id: defaultClientId,
      name: data.name,
      legalName: data.legalName,
      document: data.document,
      contractValue: null,
      status: data.status ?? 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).auditLog.create = (async () => ({})) as any;
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    const token = createToken({ sub: defaultUserId, email: 'manager@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Novo Cliente Seguro',
        document: '99988877700',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.name, 'Novo Cliente Seguro');
    assert.strictEqual(body.document, undefined, 'document NÃO pode ser devolvido na resposta 201');
    assert.strictEqual(body.contractValue, undefined);
  });

  // 4. financial.edit NÃO concede financial.view_summary (WRITE != READ)
  await t.test('4. financial.edit permite alterar contractValue mas resposta NÃO devolve contractValue', async () => {
    mockAuth({
      allowedPermissions: ['clients.edit', 'financial.edit'], // Possui financial.edit, NÃO possui financial.view_summary
    });

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      name: 'Client Alpha',
      contractValue: 5000,
      status: 'ACTIVE',
      teamAssignments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    (prisma as any).client.update = (async ({ data }: any) => ({
      id: defaultClientId,
      name: 'Client Alpha',
      contractValue: data.contractValue,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    let recordedAuditLog: any = null;
    (prisma as any).auditLog.create = (async ({ data }: any) => {
      recordedAuditLog = data;
      return {};
    }) as any;
    prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

    const token = createToken({ sub: defaultUserId, email: 'manager@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { contractValue: 12500 },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.contractValue, undefined, 'financial.edit NÃO implica visualização no retorno');

    // Confirmar auditoria de contractValue sem expor valores brutos
    assert.ok(recordedAuditLog, 'AuditLog deve ter sido gerado para a mutação de contractValue');
    assert.strictEqual(recordedAuditLog.action, 'client.updated');
    assert.ok(recordedAuditLog.metadata.changedFields.includes('contractValue'));
    assert.strictEqual(recordedAuditLog.before?.contractValue, undefined, 'AuditLog não deve conter valor anterior bruto');
    assert.strictEqual(recordedAuditLog.after?.contractValue, undefined, 'AuditLog não deve conter valor novo bruto');
  });

  // 5. Query de IntegrationConnection na timeline seleciona apenas campos seguros
  await t.test('5. timeline consulta IntegrationConnection com select restrito ao mínimo necessário', async () => {
    const svc = new ClientsService();

    let capturedSelect: any = null;
    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      createdAt: new Date(),
      startDate: null,
    })) as any;
    (prisma as any).clientMeetingNote.findMany = (async () => []) as any;
    (prisma as any).auditLog.findMany = (async () => []) as any;
    (prisma as any).integrationConnection.findMany = (async (args: any) => {
      capturedSelect = args.select;
      return [
        {
          id: 'conn-1',
          provider: 'ASANA',
          displayName: 'Asana Conexão',
          createdAt: new Date(),
        },
      ];
    }) as any;

    (prisma as any).rolePermission.findUnique = (async () => ({ granted: true })) as any;
    prisma.organizationMember.findUnique = (async () => ({
      id: `mem_${defaultUserId}`,
      role: 'ADMIN',
      status: 'ACTIVE',
      organizationId: orgId,
      userId: defaultUserId,
      user: { status: 'ACTIVE' },
      permissions: [],
    })) as any;

    const timeline = await svc.getTimeline(
      {
        userId: defaultUserId,
        organizationId: orgId,
        membershipId: `mem_${defaultUserId}`,
        role: 'ADMIN',
      },
      defaultClientId
    );

    assert.ok(capturedSelect, 'Query deve usar select restrito');
    assert.strictEqual(capturedSelect.id, true);
    assert.strictEqual(capturedSelect.provider, true);
    assert.strictEqual(capturedSelect.displayName, true);
    assert.strictEqual(capturedSelect.createdAt, true);
    assert.strictEqual(capturedSelect.credentialCiphertext, undefined, 'Não carregar credentialCiphertext');
    assert.strictEqual(capturedSelect.metadata, undefined, 'Não carregar metadata bruto');
    assert.strictEqual(capturedSelect.externalScopeId, undefined, 'Não carregar externalScopeId');

    const asanaEvt = timeline.find((e) => e.type === 'INTEGRATION_CONNECTED');
    assert.ok(asanaEvt);
    assert.strictEqual(asanaEvt.title, 'Integração conectada: ASANA');
  });
});

test('CreateClientRequestSchema - Default Canônico de Status e Validação Zod (F5-IMP.2.3)', async () => {
  // CASO A: sem status informado -> default canônico 'ACTIVE'
  const parsedDefault = CreateClientRequestSchema.parse({
    name: 'Cliente Teste',
  });
  assert.strictEqual(parsedDefault.status, 'ACTIVE', 'O default canônico deve ser ACTIVE quando status omitido');

  // CASO B: status explícito 'LEAD' -> preserva 'LEAD'
  const parsedLead = CreateClientRequestSchema.parse({
    name: 'Cliente Lead',
    status: 'LEAD',
  });
  assert.strictEqual(parsedLead.status, 'LEAD', 'Status LEAD explícito deve ser preservado');

  // CASO C: status inválido -> lança erro de validação Zod
  assert.throws(
    () => {
      CreateClientRequestSchema.parse({
        name: 'Cliente Invalido',
        status: 'STATUS_INVALIDO' as any,
      });
    },
    (err: any) => {
      assert.ok(err && err.name === 'ZodError', 'Deve lançar erro de validação Zod');
      return true;
    }
  );
});

/* ==========================================================================
   TESTES DA F5-IMP.5: MAP-READY ADDRESS (Fundação Cadastral)
   ========================================================================== */
test('ClientAddressSchema Validations', () => {
  // A. address omitido é válido (testado pelo request schema)
  const req1 = CreateClientRequestSchema.parse({ name: 'Alpha' });
  assert.strictEqual(req1.address, undefined);

  // B. endereço textual completo é válido
  const validAddress = {
    street: 'Rua Principal',
    number: '123',
    complement: 'Apt 4',
    district: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    postalCode: '01000-000',
    countryCode: 'BR',
    latitude: -23.55052,
    longitude: -46.633308,
  };
  const parsedFull = CreateClientRequestSchema.parse({ name: 'Alpha', address: validAddress });
  assert.deepStrictEqual(parsedFull.address, validAddress);

  // C. endereço parcial é válido
  const parsedPartial = CreateClientRequestSchema.parse({ name: 'Alpha', address: { street: 'Rua' } });
  assert.strictEqual(parsedPartial.address?.street, 'Rua');

  // D. latitude -90 é válida
  const latMin = CreateClientRequestSchema.parse({ name: 'Alpha', address: { latitude: -90 } });
  assert.strictEqual(latMin.address?.latitude, -90);

  // E. latitude 90 é válida
  const latMax = CreateClientRequestSchema.parse({ name: 'Alpha', address: { latitude: 90 } });
  assert.strictEqual(latMax.address?.latitude, 90);

  // F. latitude abaixo de -90 é rejeitada
  assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { latitude: -91 } }));

  // G. latitude acima de 90 é rejeitada
  assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { latitude: 91 } }));

  // H. longitude -180 é válida
  const lngMin = CreateClientRequestSchema.parse({ name: 'Alpha', address: { longitude: -180 } });
  assert.strictEqual(lngMin.address?.longitude, -180);

  // I. longitude 180 é válida
  const lngMax = CreateClientRequestSchema.parse({ name: 'Alpha', address: { longitude: 180 } });
  assert.strictEqual(lngMax.address?.longitude, 180);

  // J. longitude fora da faixa é rejeitada
  assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { longitude: 181 } }));
  assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { longitude: -181 } }));

  // K. address null é válido no update
  const updateNull = UpdateClientRequestSchema.parse({ address: null });
  assert.strictEqual(updateNull.address, null);

  // L. countryCode inválido é rejeitado
  assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { countryCode: 'BRA' } }));
  assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { countryCode: 'B' } }));
});

test('F5-IMP.5: Endereço do Cliente HTTP Integration Tests', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  const originalFindUniqueUser = prisma.user.findUnique;
  const originalFindUniqueMember = prisma.organizationMember.findUnique;
  const originalFindManyMember = prisma.organizationMember.findMany;
  const originalFindUniqueRolePerm = (prisma as any).rolePermission.findUnique;
  const originalFindManyClient = (prisma as any).client.findMany;
  const originalFindFirstClient = (prisma as any).client.findFirst;
  const originalCreateClient = (prisma as any).client.create;
  const originalUpdateClient = (prisma as any).client.update;
  const originalCreateAudit = (prisma as any).auditLog.create;
  const originalTransaction = prisma.$transaction;

  t.after(async () => {
    prisma.user.findUnique = originalFindUniqueUser;
    prisma.organizationMember.findUnique = originalFindUniqueMember;
    prisma.organizationMember.findMany = originalFindManyMember;
    (prisma as any).rolePermission.findUnique = originalFindUniqueRolePerm;
    (prisma as any).client.findMany = originalFindManyClient;
    (prisma as any).client.findFirst = originalFindFirstClient;
    (prisma as any).client.create = originalCreateClient;
    (prisma as any).client.update = originalUpdateClient;
    (prisma as any).auditLog.create = originalCreateAudit;
    prisma.$transaction = originalTransaction;
    await app.close();
  });

  const createToken = (payload: { sub: string; email: string; activeOrganizationId?: string | null }) => {
    return (app as any).jwt.sign(payload);
  };

  const orgId = '11111111-1111-4111-8111-111111111111';
  const defaultUserId = '22222222-2222-4222-8222-222222222222';
  const defaultClientId = '33333333-3333-4333-8333-333333333333';

  function mockAuth() {
    prisma.user.findUnique = (async ({ where }: any) => {
      if (where.id === defaultUserId) {
        return {
          id: defaultUserId,
          email: `${defaultUserId}@zafira.com`,
          status: 'ACTIVE',
          memberships: [
            {
              id: `mem_${defaultUserId}`,
              role: 'ADMIN',
              status: 'ACTIVE',
              organization: { id: orgId, slug: 'org-test', name: 'Org Test' },
            },
          ],
        };
      }
      return null;
    }) as any;

    prisma.organizationMember.findUnique = (async ({ where }: any) => {
      const targetUid = where.organizationId_userId?.userId;
      if (targetUid === defaultUserId) {
        return {
          id: `mem_${defaultUserId}`,
          role: 'ADMIN',
          status: 'ACTIVE',
          organizationId: orgId,
          userId: defaultUserId,
          user: { status: 'ACTIVE' },
          permissions: [],
        };
      }
      return null;
    }) as any;

    (prisma as any).rolePermission.findUnique = (async () => {
      return { id: `rp`, role: 'ADMIN', permissionCode: 'admin', granted: true };
    }) as any;

    prisma.$transaction = (async (cb: any) => {
      if (typeof cb === 'function') {
        return await cb(prisma);
      }
      return cb;
    }) as any;
  }

  await t.test('POST /clients com address estruturado e material change', async () => {
    mockAuth();

    let createdClientData: any = null;
    let auditLogData: any = null;

    (prisma as any).client.create = (async ({ data }: any) => {
      createdClientData = data;
      return {
        id: defaultClientId,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as any;

    (prisma as any).auditLog.create = (async ({ data }: any) => {
      auditLogData = data;
      return {};
    }) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cliente Address',
        address: {
          street: 'Av. Paulista',
          number: '1000',
          latitude: -23.561,
          longitude: -46.656,
        },
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);

    // ClientMutationResult NÃO contém address
    assert.strictEqual(body.address, undefined);
    assert.strictEqual(body.addressStreet, undefined);

    // Campos persistidos corretamente no Prisma
    assert.strictEqual(createdClientData.addressStreet, 'Av. Paulista');
    assert.strictEqual(createdClientData.addressNumber, '1000');
    assert.strictEqual(createdClientData.addressLatitude, -23.561);
    assert.strictEqual(createdClientData.organizationId, orgId);
  });

  await t.test('PATCH /clients/:id faz update parcial e loga material change corretamente', async () => {
    mockAuth();

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      name: 'Cliente',
      addressStreet: 'Rua Velha',
      addressNumber: '10',
      addressCity: 'São Paulo',
      addressState: 'SP',
      teamAssignments: [],
    })) as any;

    let updatedData: any = null;
    (prisma as any).client.update = (async ({ data }: any) => {
      updatedData = data;
      return {
        id: defaultClientId,
        name: 'Cliente',
        status: 'ACTIVE',
        ...JSON.parse(JSON.stringify(data)),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as any;

    let auditLogData: any = null;
    (prisma as any).auditLog.create = (async ({ data }: any) => {
      auditLogData = data;
      return {};
    }) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        address: {
          number: '200',
        },
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);

    // Verifica updates parciais
    assert.strictEqual(updatedData.addressNumber, '200');
    assert.strictEqual(updatedData.addressStreet, undefined, 'Não deve sobrescrever com undefined');
    assert.strictEqual(updatedData.addressCity, undefined);

    // Verifica Material Change (changedFields deve conter 'address' e NENHUM valor bruto)
    assert.ok(auditLogData.metadata.changedFields.includes('address'));
    assert.strictEqual(auditLogData.before?.address, undefined);
    assert.strictEqual(auditLogData.after?.address, undefined);
  });

  await t.test('PATCH /clients/:id com address semanticamente igual não cria falso change', async () => {
    mockAuth();

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      addressStreet: 'Rua 1',
      teamAssignments: [],
    })) as any;

    (prisma as any).client.update = (async ({ data }: any) => ({
      id: defaultClientId,
      name: 'Cliente',
      status: 'ACTIVE',
      ...JSON.parse(JSON.stringify(data)),
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;

    let auditLogData: any = null;
    (prisma as any).auditLog.create = (async ({ data }: any) => {
      auditLogData = data;
      return {};
    }) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        address: {
          street: 'Rua 1',
        },
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    // Como nada mudou, nem criou AuditLog (se só mandou address)
    assert.strictEqual(auditLogData, null);
  });

  await t.test('PATCH /clients/:id com address: null limpa endereço', async () => {
    mockAuth();

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      addressStreet: 'Rua Velha',
      teamAssignments: [],
    })) as any;

    let updatedData: any = null;
    (prisma as any).client.update = (async ({ data }: any) => {
      updatedData = data;
      return { id: defaultClientId, name: 'Cliente', status: 'ACTIVE', ...JSON.parse(JSON.stringify(data)), createdAt: new Date(), updatedAt: new Date() };
    }) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'PATCH',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        address: null,
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(updatedData.addressStreet, null);
    assert.strictEqual(updatedData.addressLatitude, null);
  });

  await t.test('GET /clients/:id mapeia endereço flat para objeto e converte Decimal para Number', async () => {
    mockAuth();

    (prisma as any).client.findFirst = (async () => ({
      id: defaultClientId,
      organizationId: orgId,
      name: 'Client',
      status: 'ACTIVE',
      contractValue: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      addressStreet: 'Av',
      addressNumber: '10',
      addressLatitude: '-23.5',
      addressLongitude: -46.5,
      teamAssignments: [],
      contacts: [],
      meetingNotes: [],
      integrationConnections: [],
    })) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/clients/${defaultClientId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);

    assert.ok(body.address);
    assert.strictEqual(body.address.street, 'Av');
    assert.strictEqual(body.address.number, '10');
    assert.strictEqual(body.address.latitude, -23.5);
    assert.strictEqual(body.address.longitude, -46.5);
  });

  await t.test('ClientPortfolioItem / GET /clients NÃO expõe endereço (Sanitizado)', async () => {
    mockAuth();

    (prisma as any).client.findMany = (async () => [
      {
        id: defaultClientId,
        organizationId: orgId,
        name: 'Cliente Seguro',
        status: 'ACTIVE',
        addressStreet: 'Rua Secreta',
        addressCity: 'Cidade Oculta',
        addressLatitude: -20,
        createdAt: new Date(),
        updatedAt: new Date(),
        teamAssignments: [],
        contacts: [],
        integrationConnections: [],
      },
    ]) as any;

    const token = createToken({ sub: defaultUserId, email: 'admin@zafira.com', activeOrganizationId: orgId });
    const res = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.length, 1);
    
    const item = body[0];
    assert.strictEqual(item.address, undefined);
    assert.strictEqual(item.addressStreet, undefined);
    assert.strictEqual(item.addressCity, undefined);
    assert.strictEqual(item.addressLatitude, undefined);
  });
});

test('F5-IMP.5.1: Address String Limits & Mutation Result', async (t) => {
  await t.test('street excessivamente grande -> rejeita', () => {
    assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { street: 'a'.repeat(201) } }));
  });

  await t.test('city excessivamente grande -> rejeita', () => {
    assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { city: 'b'.repeat(121) } }));
  });

  await t.test('postalCode excessivamente grande -> rejeita', () => {
    assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { postalCode: 'c'.repeat(33) } }));
  });

  await t.test('countryCode aceita br e transforma em BR', () => {
    const res = CreateClientRequestSchema.parse({ name: 'A', address: { countryCode: 'br' } });
    assert.strictEqual(res.address?.countryCode, 'BR');
  });

  await t.test('countryCode rejeita fora de 2 letras', () => {
    assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { countryCode: 'BRA' } }));
    assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { countryCode: 'B' } }));
    assert.throws(() => CreateClientRequestSchema.parse({ name: 'A', address: { countryCode: '12' } }));
  });

  await t.test('ClientMutationResult NÃO expõe address', () => {
    const clientData = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Cliente Mutation',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      address: { street: 'Rua', number: '123' },
      addressStreet: 'Rua',
    };
    
    // Schema strips unknown properties
    const res = ClientMutationResultSchema.parse(clientData) as any;
    assert.strictEqual(res.address, undefined);
    assert.strictEqual(res.addressStreet, undefined);
  });
});

test('F5-IMP.7B.1: Proteção e Validação de Links Externos (Cenários A a K)', async (t) => {
  // A. Ata com URL HTTPS aceita
  await t.test('Cenário A: CreateClientMeetingNoteRequestSchema aceita URL HTTPS válida', () => {
    const valid = CreateClientMeetingNoteRequestSchema.parse({
      title: 'Alinhamento Semanal',
      meetingDate: new Date('2026-10-09T10:00:00.000Z'),
      summary: 'Alinhamento com link seguro',
      externalLink: 'https://docs.zafira.agency/atas/123',
    });
    assert.strictEqual(valid.externalLink, 'https://docs.zafira.agency/atas/123');
  });

  // B. Ata sem URL aceita (undefined, null, string vazia)
  await t.test('Cenário B: CreateClientMeetingNoteRequestSchema aceita ata sem URL (undefined, null, vazio)', () => {
    const parsedUndefined = CreateClientMeetingNoteRequestSchema.parse({
      title: 'Alinhamento Semanal',
      meetingDate: new Date('2026-10-09T10:00:00.000Z'),
      summary: 'Sem link (undefined)',
    });
    assert.strictEqual(parsedUndefined.externalLink, undefined);

    const parsedNull = CreateClientMeetingNoteRequestSchema.parse({
      title: 'Alinhamento Semanal',
      meetingDate: new Date('2026-10-09T10:00:00.000Z'),
      summary: 'Sem link (null)',
      externalLink: null,
    });
    assert.strictEqual(parsedNull.externalLink, null);

    const parsedEmpty = CreateClientMeetingNoteRequestSchema.parse({
      title: 'Alinhamento Semanal',
      meetingDate: new Date('2026-10-09T10:00:00.000Z'),
      summary: 'Sem link (vazio)',
      externalLink: '',
    });
    assert.strictEqual(parsedEmpty.externalLink, '');
  });

  // C. Ata com URL javascript: rejeitada pela API / schema
  await t.test('Cenário C: CreateClientMeetingNoteRequestSchema rejeita URL javascript:', () => {
    assert.throws(
      () =>
        CreateClientMeetingNoteRequestSchema.parse({
          title: 'Alinhamento Semanal',
          meetingDate: new Date('2026-10-09T10:00:00.000Z'),
          summary: 'Tentativa de XSS',
          externalLink: 'javascript:alert(1)',
        }),
      /URL da ata deve utilizar protocolo http: ou https:/
    );
  });

  // D. Ata com URL data: rejeitada
  await t.test('Cenário D: CreateClientMeetingNoteRequestSchema rejeita URL data:', () => {
    assert.throws(
      () =>
        CreateClientMeetingNoteRequestSchema.parse({
          title: 'Alinhamento Semanal',
          meetingDate: new Date('2026-10-09T10:00:00.000Z'),
          summary: 'Payload data:',
          externalLink: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        }),
      /URL da ata deve utilizar protocolo http: ou https:/
    );
  });

  // E. Ata com URL malformada rejeitada
  await t.test('Cenário E: CreateClientMeetingNoteRequestSchema rejeita URL malformada', () => {
    assert.throws(
      () =>
        CreateClientMeetingNoteRequestSchema.parse({
          title: 'Alinhamento Semanal',
          meetingDate: new Date('2026-10-09T10:00:00.000Z'),
          summary: 'URL malformada',
          externalLink: 'not-a-valid-url',
        }),
      /URL da ata deve utilizar protocolo http: ou https:/
    );
  });

  // F. Atualização com externalLink: null continua permitida
  await t.test('Cenário F: UpdateClientMeetingNoteRequestSchema aceita externalLink: null, vazio e rejeita insegura', () => {
    const updateNull = UpdateClientMeetingNoteRequestSchema.parse({
      externalLink: null,
    });
    assert.strictEqual(updateNull.externalLink, null);

    const updateEmpty = UpdateClientMeetingNoteRequestSchema.parse({
      externalLink: '',
    });
    assert.strictEqual(updateEmpty.externalLink, '');

    const updateValid = UpdateClientMeetingNoteRequestSchema.parse({
      externalLink: 'http://intranet.local/ata-456',
    });
    assert.strictEqual(updateValid.externalLink, 'http://intranet.local/ata-456');

    assert.throws(
      () =>
        UpdateClientMeetingNoteRequestSchema.parse({
          externalLink: 'javascript:void(0)',
        }),
      /URL da ata deve utilizar protocolo http: ou https:/
    );
  });

  // G e H. isValidHttpUrl protege links na renderização (cenários G e H)
  await t.test('Cenários G e H: isValidHttpUrl protege links seguros e neutraliza protocolos inseguros', () => {
    // H: Links HTTP e HTTPS são válidos
    assert.strictEqual(isValidHttpUrl('https://app.zafira.agency'), true);
    assert.strictEqual(isValidHttpUrl('http://localhost:3000/ata'), true);

    // G: Protocolos inseguros retornam false e não produzem href clicável
    assert.strictEqual(isValidHttpUrl('javascript:alert(1)'), false);
    assert.strictEqual(isValidHttpUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.strictEqual(isValidHttpUrl('ftp://ftp.example.com/files'), false);
    assert.strictEqual(isValidHttpUrl('file:///etc/passwd'), false);
    assert.strictEqual(isValidHttpUrl('vbscript:msgbox(1)'), false);
    assert.strictEqual(isValidHttpUrl(''), false);
    assert.strictEqual(isValidHttpUrl('invalid-url'), false);
  });

  // I. Brand Kit com link HTTPS continua aceito em CreateClient e UpdateClient
  await t.test('Cenário I: Brand Kit com link HTTPS aceito em criação e atualização de cliente', () => {
    const createData = CreateClientRequestSchema.parse({
      name: 'Cliente Brand Kit Seguro',
      brandKit: {
        externalLinks: [
          { label: 'Figma', url: 'https://figma.com/@brand' },
          { label: 'Drive', url: 'http://drive.google.com/folder', type: 'DRIVE' },
        ],
      },
    });
    assert.strictEqual(createData.brandKit?.externalLinks?.length, 2);

    const updateData = UpdateClientRequestSchema.parse({
      brandKit: {
        externalLinks: [
          { label: 'Manual da Marca', url: 'https://brand.zafira.agency/guide.pdf' },
        ],
      },
    });
    assert.strictEqual(updateData.brandKit?.externalLinks?.length, 1);
  });

  // J. Brand Kit com link inseguro em criação/atualização é rejeitado
  await t.test('Cenário J: Brand Kit com link inseguro rejeitado em criação e atualização de cliente', () => {
    assert.throws(
      () =>
        CreateClientRequestSchema.parse({
          name: 'Cliente Inseguro',
          brandKit: {
            externalLinks: [{ label: 'Malicioso', url: 'javascript:alert(1)' }],
          },
        }),
      /URL do link deve ser válida e utilizar protocolo http: ou https:/
    );

    assert.throws(
      () =>
        CreateClientRequestSchema.parse({
          name: 'Cliente Inseguro Data',
          brandKit: {
            externalLinks: [{ label: 'Data', url: 'data:text/plain;base64,SGVsbG8=' }],
          },
        }),
      /URL do link deve ser válida e utilizar protocolo http: ou https:/
    );

    assert.throws(
      () =>
        UpdateClientRequestSchema.parse({
          brandKit: {
            externalLinks: [{ label: 'FTP', url: 'ftp://ftp.server.com/assets' }],
          },
        }),
      /URL do link deve ser válida e utilizar protocolo http: ou https:/
    );
  });

  // K. ClientDetailSchema e ClientMeetingNoteSchema continuam legíveis com dados legados
  await t.test('Cenário K: Leitura de dados legados com URLs inseguras não falha em ClientDetail e ClientMeetingNote', () => {
    const legacyMeetingNote = ClientMeetingNoteSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      clientId: '33333333-3333-4333-8333-333333333333',
      title: 'Ata Legada com Link Inseguro',
      meetingDate: '2026-01-01T12:00:00.000Z',
      summary: 'Resumo com link legado javascript gravado anteriormente',
      externalLink: 'javascript:alert("antigo")',
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
    });
    assert.strictEqual(legacyMeetingNote.externalLink, 'javascript:alert("antigo")');

    const legacyClientDetail = ClientDetailSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      organizationId: '22222222-2222-4222-8222-222222222222',
      name: 'Cliente Legado com Links Antigos',
      status: 'ACTIVE',
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
      brandKit: {
        colors: [],
        typography: [],
        externalLinks: [
          { label: 'Legado Inseguro', url: 'javascript:void(0)' },
          { label: 'Legado Data', url: 'data:text/html,abc' },
        ],
      },
      contacts: [],
      squads: [],
      meetingNotes: [legacyMeetingNote],
      activeIntegrations: [],
    });
    assert.strictEqual(legacyClientDetail.brandKit?.externalLinks?.length, 2);
    assert.strictEqual(legacyClientDetail.meetingNotes?.length, 1);
  });
});
