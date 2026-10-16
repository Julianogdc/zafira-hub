import { ORGANIZATIONS, PEOPLE } from './02-core-organizations.mjs';
import { refuse } from './01-safety-guard.mjs';

const [alpha, beta] = ORGANIZATIONS;
const person = (org, role) => PEOPLE.find((p) => p.organizationId === org.id && p.role === role);
const id = (kind, number) => `a4b20000-${kind}-4000-8000-${String(number).padStart(12, '0')}`;
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const clients = ['LEAD', 'ACTIVE', 'PAUSED', 'INACTIVE', 'ACTIVE'].map((status, i) => {
  const org = i < 4 ? alpha : beta;
  return {
    id: id('0001', i + 1), organizationId: org.id, name: `Cliente Sintetico ${i < 4 ? 'Alpha' : 'Beta'} ${i + 1}`,
    legalName: `Empresa Ficticia de Demonstracao ${i + 1}`, email: `synthetic-client-${i + 1}@zafira.invalid`,
    document: null, phone: null, status, responsibleUserId: person(org, 'MANAGER').id,
    notes: 'Cadastro integralmente ficticio para navegacao; sem contrato ou dados reais.',
    briefing: { version: 1, objective: 'Demonstrar o Cliente 360 com dados sinteticos.',
      targetAudience: 'Publico inteiramente ficticio.', positioning: 'Marca demonstrativa sem operacao comercial.',
      competitors: 'Nenhuma empresa real.', toneOfVoice: 'Claro e didatico.', notes: 'Nao executar integracoes ou publicacoes.' },
  };
});
const teams = ['Social Media Sintetica', 'Performance Sintetica'].map((name, i) => ({
  id: id('0002', i + 1), organizationId: alpha.id, name, isActive: true,
}));
const memberLink = (org, role, client) => ({ organizationId: org.id, organizationMemberId: person(org, role).membershipId, clientId: client.id });
export const TEAM_CLIENT_FIXTURE = freeze({
  client: clients, team: teams,
  clientContact: clients.flatMap((client, i) => ['Principal', 'Apoio'].map((label, j) => ({
    id: id('0003', i * 2 + j + 1), organizationId: client.organizationId, clientId: client.id,
    name: `Contato Ficticio ${i + 1} ${label}`, role: `Papel demonstrativo ${label}`,
    email: `synthetic-contact-${i + 1}-${j + 1}@zafira.invalid`, phone: null, isPrimary: j === 0,
    notes: 'Pessoa inexistente; contato reservado para demonstracao.',
  }))),
  clientMeetingNote: clients.flatMap((client, i) => ['Briefing', 'Acompanhamento'].map((label, j) => ({
    id: id('0004', i * 2 + j + 1), organizationId: client.organizationId, clientId: client.id,
    title: `${label} Sintetico ${i + 1}`, meetingDate: `2026-10-${String(10 + j).padStart(2, '0')}T15:00:00.000Z`,
    summary: 'Registro ficticio de alinhamento de objetivos e acompanhamento da demonstracao.',
    actionItems: 'Revisar apenas os exemplos sinteticos do Cliente 360.', externalLink: null,
    authorUserId: client.responsibleUserId,
  }))),
  teamMember: ['MANAGER', 'MEMBER'].map((role, i) => ({
    organizationId: alpha.id, teamId: teams[i].id, organizationMemberId: person(alpha, role).membershipId,
  })),
  teamClientAssignment: [0, 1, 2].map((i) => ({ organizationId: alpha.id, teamId: teams[i < 2 ? 0 : 1].id, clientId: clients[i].id })),
  // Alpha manager sees clients 1/2 by team + 3 directly; member sees 3 by team + 2 directly.
  // Alpha client 4 is admin-only. Beta manager sees its own client; Beta member sees none.
  userClientAssignment: [memberLink(alpha, 'MANAGER', clients[2]), memberLink(alpha, 'MEMBER', clients[1]), memberLink(beta, 'MANAGER', clients[4])],
});

// Validate the complete graph, including Prisma's composite organizationId relations,
// before any write in this module. This also covers author/responsible user relations.
export function assertTeamClientRelations(fixture = TEAM_CLIENT_FIXTURE) {
  const same = (rows, key, value, org) => rows.some((r) => r[key] === value && r.organizationId === org);
  const orgs = new Set(ORGANIZATIONS.map((o) => o.id));
  for (const rows of Object.values(fixture)) for (const row of rows) {
    if (!orgs.has(row.organizationId)) refuse('BUSINESS_TENANT');
    if (row.teamId && !same(fixture.team, 'id', row.teamId, row.organizationId)) refuse('BUSINESS_TEAM_SCOPE');
    if (row.clientId && !same(fixture.client, 'id', row.clientId, row.organizationId)) refuse('BUSINESS_CLIENT_SCOPE');
    if (row.organizationMemberId && !same(PEOPLE, 'membershipId', row.organizationMemberId, row.organizationId)) refuse('BUSINESS_MEMBER_SCOPE');
    for (const key of ['responsibleUserId', 'authorUserId']) {
      if (row[key] && !same(PEOPLE, 'id', row[key], row.organizationId)) refuse('BUSINESS_USER_SCOPE');
    }
    if (row.email && !row.email.endsWith('@zafira.invalid')) refuse('BUSINESS_EMAIL');
    if (row.phone || row.document) refuse('BUSINESS_PERSONAL_DATA');
  }
}

const identities = {
  client: ['id', 'organizationId', 'name', 'email', 'responsibleUserId'],
  team: ['id', 'organizationId', 'name'],
  clientContact: ['id', 'organizationId', 'clientId', 'name', 'email'],
  clientMeetingNote: ['id', 'organizationId', 'clientId', 'title', 'authorUserId'],
  teamMember: ['organizationId', 'teamId', 'organizationMemberId'],
  teamClientAssignment: ['organizationId', 'teamId', 'clientId'],
  userClientAssignment: ['organizationId', 'organizationMemberId', 'clientId'],
};
const compoundKeys = {
  teamMember: ['teamId', 'organizationMemberId'], teamClientAssignment: ['teamId', 'clientId'],
  userClientAssignment: ['organizationMemberId', 'clientId'],
};
const inIds = (rows, key = 'id') => ({ in: rows.map((r) => r[key]) });

export async function seedTeamsAndClients(tx) {
  const fixture = TEAM_CLIENT_FIXTURE;
  assertTeamClientRelations();
  // Include relationships touching the namespace from either side: unexpected edges
  // must be refused, never silently grant a larger portfolio or be deleted/repaired.
  const queries = {
    client: [{ id: inIds(fixture.client) }, { email: inIds(fixture.client, 'email') }, ...fixture.client.map(({ organizationId, name }) => ({ organizationId, name }))],
    team: [{ id: inIds(fixture.team) }, ...fixture.team.map(({ organizationId, name }) => ({ organizationId, name }))],
    clientContact: [{ id: inIds(fixture.clientContact) }, { email: inIds(fixture.clientContact, 'email') }, { clientId: inIds(fixture.client) }],
    clientMeetingNote: [{ id: inIds(fixture.clientMeetingNote) }, { clientId: inIds(fixture.client) }],
    teamMember: [{ teamId: inIds(fixture.team) }, { organizationMemberId: inIds(PEOPLE, 'membershipId') }],
    teamClientAssignment: [{ teamId: inIds(fixture.team) }, { clientId: inIds(fixture.client) }],
    userClientAssignment: [{ organizationMemberId: inIds(PEOPLE, 'membershipId') }, { clientId: inIds(fixture.client) }],
  };
  for (const [model, rows] of Object.entries(fixture)) {
    const existing = await tx[model].findMany({ where: { OR: queries[model] } });
    for (const row of existing) {
      if (!rows.some((expected) => identities[model].every((key) => expected[key] === row[key]))) refuse(`BUSINESS_COLLISION_${model}`);
    }
  }
  for (const [model, rows] of Object.entries(fixture)) for (const row of rows) {
    const keys = compoundKeys[model];
    const where = keys ? { [keys.join('_')]: Object.fromEntries(keys.map((key) => [key, row[key]])) } : { id: row.id };
    const create = model === 'clientMeetingNote' ? { ...row, meetingDate: new Date(row.meetingDate) } : { ...row };
    await tx[model].upsert({ where, update: {}, create });
  }
  return Object.fromEntries(Object.entries(fixture).map(([model, rows]) => [model, rows.length]));
}
