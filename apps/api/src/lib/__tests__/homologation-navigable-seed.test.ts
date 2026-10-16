import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { ClientBriefingSchema } from '@zafira/contracts';
import { deriveItemProgress } from '@zafira/domain';
import { computeProjectCounts } from '../../modules/integrations/asana/mirror/asana-mirror.diff.js';

const scriptUrl = new URL('../../../../../scripts/homologation/seed-homologation-navigable.mjs', import.meta.url);
const guardUrl = new URL('./seed-modules/01-safety-guard.mjs', scriptUrl);
const coreUrl = new URL('./seed-modules/02-core-organizations.mjs', scriptUrl);
const { runNavigableSeed } = await import(scriptUrl.href);
const { assertSafeDatabaseTarget, DATABASE_NAME } = await import(guardUrl.href);
const { ORGANIZATIONS, PEOPLE } = await import(coreUrl.href);
const { TEAM_CLIENT_FIXTURE, assertTeamClientRelations } = await import(new URL('./seed-modules/03-teams-and-clients.mjs', scriptUrl).href);
const businessCounts = { client: 5, team: 2, clientContact: 10, clientMeetingNote: 10, teamMember: 2, teamClientAssignment: 3, userClientAssignment: 3 };
const { buildDeliverableMirrorFixture, assertDeliverableMirrorRelations, DELIVERY_MODELS } = await import(new URL('./seed-modules/04-deliverables-and-mirror.mjs', scriptUrl).href);
const deliveryCounts = { deliverableTemplate: 2, deliverablePlan: 2, deliverableItem: 4, deliverablePiece: 8, deliverableEvent: 24,
  clientIntegration: 2, asanaProjectMirror: 2, asanaTaskMirror: 12, asanaTaskChange: 6, asanaProjectSnapshot: 28 };

function configuration() {
  return {
    NODE_ENV: 'test', HML_SYNTHETIC_SEED_ENABLED: '1', HML_SEED_TARGET: 'local-disposable',
    DATABASE_URL: `postgresql://synthetic:ephemeral@localhost:5432/${DATABASE_NAME}`,
    HML_SEED_ALLOWED_TARGET: `localhost:5432/${DATABASE_NAME}`, HML_SEED_DATABASE_USER: 'synthetic',
    HML_SEED_PASSWORD_ALPHA: randomBytes(24).toString('base64url'),
    HML_SEED_PASSWORD_BETA: randomBytes(24).toString('base64url'),
    HML_SEED_REFERENCE_DATE: '2026-10-15',
  };
}

// In-memory Prisma protocol double: no sockets, applies predicates and uniqueness;
// rollback is modeled to check orchestration. Not evidence of PostgreSQL execution.
function memoryDatabase(failAtWrite = Infinity) {
  let state: Record<string, any[]> = { organization: [], user: [], organizationMember: [],
    ...Object.fromEntries([...Object.keys(TEAM_CLIENT_FIXTURE), ...DELIVERY_MODELS].map((model) => [model, []])) };
  let writes = 0;
  let disconnected = 0;
  let identity = { database: DATABASE_NAME, username: 'synthetic', schema: 'public' };
  function matches(row: any, where: any): boolean {
    if (where.OR) return where.OR.some((part: any) => matches(row, part));
    for (const key of ['organizationId_userId', 'teamId_organizationMemberId', 'teamId_clientId', 'organizationMemberId_clientId']) {
      if (where[key]) return matches(row, where[key]);
    }
    return Object.entries(where).every(([key, value]: [string, any]) =>
      value && typeof value === 'object' ? value.in.includes(row[key]) : row[key] === value);
  }
  return {
    get state() { return state; }, get writes() { return writes; }, get disconnected() { return disconnected; },
    set identity(value: typeof identity) { identity = value; },
    async $transaction(action: any, options: any) {
      assert.equal(options.isolationLevel, 'Serializable');
      const draft = structuredClone(state);
      const tx: any = { $queryRaw: async () => [identity] };
      for (const model of Object.keys(draft)) {
        tx[model] = {
          findMany: async ({ where }: any) => structuredClone(draft[model].filter((row) => matches(row, where))),
          upsert: async ({ where, create, update }: any) => {
            writes++;
            if (writes === failAtWrite) throw new Error('Injected write failure');
            const found = draft[model].find((row) => matches(row, where));
            if (found) { Object.assign(found, update); return found; }
            if (draft[model].some((row) => (create.id !== undefined && row.id === create.id) ||
              (model === 'organization' && row.slug === create.slug) ||
              (model === 'user' && row.email === create.email) ||
              (model === 'team' && row.organizationId === create.organizationId && row.name === create.name))) throw new Error('Unique constraint');
            draft[model].push(structuredClone(create)); return create;
          },
        };
      }
      const result = await action(tx);
      state = draft;
      return result;
    },
    async $disconnect() { disconnected++; },
  };
}

test('H4-B.1 accepts only explicitly confirmed local disposable endpoints', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const env = configuration();
    env.DATABASE_URL = `postgres://synthetic:ephemeral@${host}:55432/${DATABASE_NAME}`;
    env.HML_SEED_ALLOWED_TARGET = `${host}:55432/${DATABASE_NAME}`;
    assert.deepEqual(assertSafeDatabaseTarget(env), { database: DATABASE_NAME, user: 'synthetic' });
  }
});

const invalidConfigurations: Record<string, string | undefined>[] = [
  { HML_SYNTHETIC_SEED_ENABLED: undefined }, { HML_SYNTHETIC_SEED_ENABLED: 'true' },
  ...['production', 'development', 'staging', '', undefined].map((NODE_ENV) => ({ NODE_ENV })),
  { HML_SEED_TARGET: 'staging' }, { HML_SEED_ALLOWED_TARGET: undefined },
  { HML_SEED_ALLOWED_TARGET: `localhost:5433/${DATABASE_NAME}` }, { HML_SEED_DATABASE_USER: 'postgres' },
  { DIRECT_URL: 'configured' }, { SHADOW_DATABASE_URL: 'configured' },
  ...['PUBLICATION_DISPATCH_ENABLED', 'PUBLICATION_METRICS_ENABLED', 'N8N_DISPATCH_ENABLED',
    'GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED', 'ASANA_MIRROR_SCHEDULE_ENABLED'].flatMap((key) =>
      [{ [key]: 'true' }, { [key]: '0' }]),
  ...[undefined, 'invalid', `mysql://synthetic:p@localhost/${DATABASE_NAME}`,
    `postgresql://synthetic:p@unknown.invalid/${DATABASE_NAME}`,
    `postgresql://synthetic:p@localhost.evil.invalid/${DATABASE_NAME}`,
    `postgresql://synthetic:p@192.0.2.1/${DATABASE_NAME}`,
    'postgresql://synthetic:p@localhost/zafira_hub_v2?staging=1',
    'postgresql://synthetic:p@localhost/zafira_hub_21_staging',
    `postgresql://synthetic:p@localhost/${DATABASE_NAME}_prod`,
    `postgresql://synthetic:p@localhost/prod_${DATABASE_NAME}`,
    `postgresql://synthetic:p@localhost/${DATABASE_NAME}?host=production.invalid`,
    `postgresql://synthetic:p@localhost/${DATABASE_NAME}?schema=other`,
    `postgresql://synthetic:p@localhost/${DATABASE_NAME}#fragment`,
    `postgresql://synthetic:p@localhost/${DATABASE_NAME}?`,
    `postgresql://synthetic:p@localhost/%7Aafira_hub_navigable_ci`,
    `postgresql://synthetic:p@localhost/${DATABASE_NAME}/other`,
    ` postgresql://synthetic:p@localhost/${DATABASE_NAME}`,
    `postgresql://synthetic@localhost/${DATABASE_NAME}`,
    `postgresql://%73ynthetic:p@localhost/${DATABASE_NAME}`,
  ].map((DATABASE_URL) => ({ DATABASE_URL })),
  { HML_SEED_PASSWORD_ALPHA: undefined }, { HML_SEED_PASSWORD_BETA: 'short' },
];
for (const [index, overrides] of invalidConfigurations.entries()) {
  test(`H4-B.1 forbidden configuration ${index + 1} blocks before client construction/connection`, async () => {
    let clients = 0;
    const env = { ...configuration(), ...overrides };
    await assert.rejects(runNavigableSeed({ env, createClient: () => { clients++; throw new Error('Must not connect'); } }), /Synthetic seed refused/);
    assert.equal(clients, 0);
  });
}

test('H4-B.1 password separation blocks before connection', async () => {
  const env = configuration(); env.HML_SEED_PASSWORD_BETA = env.HML_SEED_PASSWORD_ALPHA;
  await assert.rejects(runNavigableSeed({ env, createClient: () => assert.fail('connected') }), /PASSWORD_SEPARATION/);
});

test('H4-B.1 flags explicitly false are accepted and import itself has no client side effects', () => {
  const env = { ...configuration(), PUBLICATION_DISPATCH_ENABLED: 'false', PUBLICATION_METRICS_ENABLED: 'false',
    N8N_DISPATCH_ENABLED: 'false', GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED: 'false', ASANA_MIRROR_SCHEDULE_ENABLED: 'false' };
  assert.equal(assertSafeDatabaseTarget(env).database, DATABASE_NAME);
});

test('H4-B.1 checks actual database identity before any write and disconnects', async () => {
  for (const identity of [
    { database: 'production', username: 'synthetic', schema: 'public' },
    { database: DATABASE_NAME, username: 'other', schema: 'public' },
    { database: DATABASE_NAME, username: 'synthetic', schema: 'other' },
  ]) {
    const db = memoryDatabase(); db.identity = identity;
    await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /DATABASE_IDENTITY/);
    assert.equal(db.writes, 0); assert.equal(db.disconnected, 1);
  }
});

test('H4-B.1 two runs preserve exact state, foreign records and disjoint tenants; Argon2id verifies', async () => {
  const db = memoryDatabase(); const env = configuration();
  db.state.organization.push({ id: 'unrelated', slug: 'unrelated', name: 'Untouched sentinel' });
  db.state.user.push({ id: 'unrelated', email: 'sentinel@zafira.invalid', name: 'Untouched sentinel' });
  const foreign = structuredClone(db.state);
  assert.deepEqual(await runNavigableSeed({ env, createClient: () => db }), { organizations: 2, users: 6, memberships: 6, business: businessCounts, delivery: deliveryCounts });
  const firstRun = structuredClone(db.state);
  await runNavigableSeed({ env, createClient: () => db });
  assert.deepEqual(db.state, firstRun);
  assert.deepEqual(db.state.organization[0], foreign.organization[0]);
  assert.deepEqual(db.state.user[0], foreign.user[0]);
  for (const person of PEOPLE) {
    const user = db.state.user.find((u) => u.id === person.id)!;
    assert.ok(user.email.endsWith('@zafira.invalid'));
    assert.ok(user.passwordHash.startsWith('$argon2id$'));
    assert.ok(await argon2.verify(user.passwordHash, env[person.passwordKey as keyof typeof env]));
    assert.equal(db.state.organizationMember.filter((m) => m.userId === user.id).length, 1);
    assert.equal(db.state.organizationMember.find((m) => m.userId === user.id)!.organizationId, person.organizationId);
  }
  for (const org of ORGANIZATIONS) {
    const members = db.state.organizationMember.filter((m) => m.organizationId === org.id);
    assert.deepEqual(members.map((m) => m.role).sort(), ['ADMIN', 'MANAGER', 'MEMBER']);
    const other = db.state.organizationMember.filter((m) => m.organizationId !== org.id);
    assert.ok(members.every((m) => !other.some((n) => n.userId === m.userId)));
  }
});

test('H4-B.1 collisions in ID, slug, email or cross-tenant membership refuse before writes', async () => {
  for (const kind of ['org-id', 'org-slug', 'user-id', 'email', 'cross-membership']) {
    const db = memoryDatabase();
    if (kind === 'org-id') db.state.organization.push({ ...ORGANIZATIONS[0], slug: 'foreign' });
    if (kind === 'org-slug') db.state.organization.push({ ...ORGANIZATIONS[0], id: 'foreign' });
    if (kind === 'user-id') db.state.user.push({ id: PEOPLE[0].id, email: 'foreign@zafira.invalid' });
    if (kind === 'email') db.state.user.push({ id: 'foreign', email: PEOPLE[0].email });
    if (kind === 'cross-membership') db.state.organizationMember.push({ id: PEOPLE[0].membershipId,
      organizationId: ORGANIZATIONS[1].id, userId: PEOPLE[0].id, role: 'ADMIN' });
    const before = structuredClone(db.state);
    await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /COLLISION/);
    assert.equal(db.writes, 0); assert.deepEqual(db.state, before); assert.equal(db.disconnected, 1);
  }
});

test('H4-B.1 transaction rollback preserves all records on a partial write failure', async () => {
  const db = memoryDatabase(4);
  db.state.organization.push({ id: 'sentinel', name: 'Untouched', slug: 'sentinel' });
  const before = structuredClone(db.state);
  await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /Injected write failure/);
  assert.deepEqual(db.state, before); assert.equal(db.disconnected, 1);
});

test('H4-B.1 rerun cannot reset a password or silently repair suspended memberships', async () => {
  const db = memoryDatabase(); const env = configuration();
  await runNavigableSeed({ env, createClient: () => db });
  const before = structuredClone(db.state); const writes = db.writes;
  await assert.rejects(runNavigableSeed({ env: { ...env, HML_SEED_PASSWORD_ALPHA: randomBytes(24).toString('hex') },
    createClient: () => db }), /PASSWORD_MISMATCH/);
  assert.equal(db.writes, writes); assert.deepEqual(db.state, before);
  db.state.organizationMember[0].status = 'SUSPENDED';
  await assert.rejects(runNavigableSeed({ env, createClient: () => db }), /MEMBERSHIP_COLLISION/);
  assert.equal(db.writes, writes);
});

test('H4-B.1 CLI suppresses URL/password and returns nonzero on rejected destination', () => {
  const env = { ...process.env, ...configuration(), NODE_ENV: 'production' };
  const child = spawnSync(process.execPath, [fileURLToPath(scriptUrl)], { env, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Synthetic seed refused/);
  for (const value of [env.DATABASE_URL, env.HML_SEED_PASSWORD_ALPHA, env.HML_SEED_PASSWORD_BETA]) {
    assert.ok(!`${child.stdout}${child.stderr}`.includes(value));
  }
});

test('H4-B.2 business fixtures match Cliente 360 contracts and contain no personal identifiers', () => {
  assertTeamClientRelations();
  assert.deepEqual(Object.fromEntries(Object.entries(TEAM_CLIENT_FIXTURE).map(([model, rows]: any) => [model, rows.length])), businessCounts);
  assert.equal(TEAM_CLIENT_FIXTURE.client.filter((c: any) => c.organizationId === ORGANIZATIONS[0].id).length, 4);
  assert.equal(TEAM_CLIENT_FIXTURE.client.filter((c: any) => c.organizationId === ORGANIZATIONS[1].id).length, 1);
  assert.equal(new Set(TEAM_CLIENT_FIXTURE.client.map((c: any) => c.status)).size, 4);
  for (const row of [...TEAM_CLIENT_FIXTURE.client, ...TEAM_CLIENT_FIXTURE.clientContact]) {
    assert.ok(row.email.endsWith('@zafira.invalid')); assert.equal(row.phone, null);
  }
  for (const client of TEAM_CLIENT_FIXTURE.client) {
    ClientBriefingSchema.parse(client.briefing); assert.equal(client.document, null);
    const contacts = TEAM_CLIENT_FIXTURE.clientContact.filter((c: any) => c.clientId === client.id);
    assert.equal(contacts.length, 2); assert.equal(contacts.filter((c: any) => c.isPrimary).length, 1);
    const notes = TEAM_CLIENT_FIXTURE.clientMeetingNote.filter((n: any) => n.clientId === client.id);
    assert.equal(notes.length, 2); assert.ok(notes.every((n: any) => n.organizationId === client.organizationId));
  }
});

for (const [model, field, wrong] of [
  ['teamMember', 'organizationMemberId', PEOPLE[4].membershipId],
  ['teamMember', 'organizationId', ORGANIZATIONS[1].id],
  ['teamClientAssignment', 'clientId', TEAM_CLIENT_FIXTURE.client[4].id],
  ['userClientAssignment', 'clientId', TEAM_CLIENT_FIXTURE.client[4].id],
  ['clientContact', 'organizationId', ORGANIZATIONS[1].id],
  ['clientMeetingNote', 'authorUserId', PEOPLE[4].id],
  ['client', 'responsibleUserId', PEOPLE[4].id],
] as const) {
  test(`H4-B.2 refuses cross-tenant ${model}.${field} before writes`, () => {
    const fixture = structuredClone(TEAM_CLIENT_FIXTURE);
    fixture[model][0][field] = wrong;
    assert.throws(() => assertTeamClientRelations(fixture), /BUSINESS_.*SCOPE/);
  });
}

test('H4-B.2 portfolios are partial and disjoint, combining direct and team assignments', async () => {
  const db = memoryDatabase(); await runNavigableSeed({ env: configuration(), createClient: () => db });
  const scope = (p: any) => db.state.client.filter((client) => client.organizationId === p.organizationId && (
    p.role === 'ADMIN' || db.state.userClientAssignment.some((a) => a.clientId === client.id && a.organizationMemberId === p.membershipId) ||
    db.state.teamClientAssignment.some((a) => a.clientId === client.id && db.state.teamMember.some((m) => m.teamId === a.teamId && m.organizationMemberId === p.membershipId))));
  assert.deepEqual(PEOPLE.map((p: any) => scope(p).length), [4, 3, 2, 1, 1, 0]);
  for (const p of PEOPLE) assert.ok(scope(p).every((c) => c.organizationId === p.organizationId));
});

for (const model of Object.keys(TEAM_CLIENT_FIXTURE)) {
  test(`H4-B.2 refuses a ${model} identity collision and preserves the transaction`, async () => {
    const db = memoryDatabase(); const row = structuredClone(TEAM_CLIENT_FIXTURE[model][0]);
    row.organizationId = ORGANIZATIONS[1].id; db.state[model].push(row);
    const before = structuredClone(db.state);
    await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /BUSINESS_COLLISION/);
    assert.deepEqual(db.state, before);
  });
}

test('H4-B.2 rejects team-name/client-email collisions even with an unrelated ID', async () => {
  for (const model of ['team', 'client']) {
    const db = memoryDatabase(); db.state[model].push({ ...structuredClone(TEAM_CLIENT_FIXTURE[model][0]), id: 'sentinel' });
    const before = structuredClone(db.state);
    await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /BUSINESS_COLLISION/);
    assert.deepEqual(db.state, before);
  }
});

test('H4-B.2 preserves sentinels across every model and modified nonidentity fields on rerun', async () => {
  const db = memoryDatabase(); const env = configuration();
  for (const [model, rows] of Object.entries(TEAM_CLIENT_FIXTURE) as any) {
    const row = structuredClone(rows[0]);
    for (const key of ['id', 'organizationId', 'clientId', 'teamId', 'organizationMemberId', 'email']) if (row[key]) row[key] = `sentinel-${key}`;
    db.state[model].push(row);
  }
  const before = structuredClone(db.state);
  await runNavigableSeed({ env, createClient: () => db });
  for (const model of Object.keys(TEAM_CLIENT_FIXTURE)) assert.deepEqual(db.state[model][0], before[model][0]);
  db.state.client[1].notes = 'Preserved synthetic edit';
  const first = structuredClone(db.state);
  await runNavigableSeed({ env, createClient: () => db }); assert.deepEqual(db.state, first);
});

test('H4-B.2 failure in final business write rolls back core and business together', async () => {
  const db = memoryDatabase(14 + Object.values(businessCounts).reduce((a, b) => a + b, 0));
  const before = structuredClone(db.state);
  await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /Injected write failure/);
  assert.deepEqual(db.state, before);
});

test('H4-B.3 plans, items, templates and piece events respect current domain rules', () => {
  const f = buildDeliverableMirrorFixture(configuration());
  assert.deepEqual(Object.fromEntries(DELIVERY_MODELS.map((m: string) => [m, f[m].length])), deliveryCounts);
  for (const plan of f.deliverablePlan) {
    const items = f.deliverableItem.filter((i: any) => i.planId === plan.id);
    assert.equal(items.reduce((sum: number, i: any) => sum + i.targetQuantity, 0), plan.targetCount);
    assert.equal(plan.targetCount, 5); // independent from six mirrored tasks
    const template = f.deliverableTemplate.find((t: any) => t.organizationId === plan.organizationId);
    assert.equal(template.defaultItems.reduce((sum: number, i: any) => sum + i.targetQuantity, 0), 5);
    for (const item of items) {
      const pieces = f.deliverablePiece.filter((p: any) => p.itemId === item.id);
      assert.deepEqual(deriveItemProgress(item.targetQuantity, pieces.map((p: any) => p.stage)), { status: item.status, deliveredQuantity: item.deliveredQuantity });
      for (const p of pieces) {
        const events = f.deliverableEvent.filter((e: any) => e.after?.pieceId === p.id);
        const stages = events.map((e: any) => e.after.stage);
        assert.deepEqual(stages, p.stage === 'PRODUCED' ? ['PRODUCED'] : p.stage === 'APPROVED' ? ['PRODUCED', 'APPROVED'] : ['PRODUCED', 'APPROVED', 'DELIVERED']);
        assert.equal(events.at(-1).after.stage, p.stage);
      }
    }
  }
});

test('H4-B.3 14 daily snapshots per project match task history using real domain counters', () => {
  const f = buildDeliverableMirrorFixture(configuration());
  for (const project of f.asanaProjectMirror) {
    const snapshots = f.asanaProjectSnapshot.filter((s: any) => s.projectGid === project.projectGid);
    assert.equal(snapshots.length, 14);
    for (const [i, snapshot] of snapshots.entries()) {
      if (i) assert.equal(Date.parse(snapshot.capturedAt) - Date.parse(snapshots[i - 1].capturedAt), 86400000);
      const tasks = f.asanaTaskMirror.filter((t: any) => t.projectGid === project.projectGid).map((t: any) => ({ ...t,
        completed: f.asanaTaskChange.some((c: any) => c.taskGid === t.taskGid && c.detectedAt <= snapshot.capturedAt) }));
      const counts = computeProjectCounts(tasks, new Date(snapshot.capturedAt), 'America/Sao_Paulo');
      for (const key of ['totalTasks', 'completedTasks', 'pendingTasks', 'overdueTasks']) assert.equal(counts[key], snapshot[key]);
    }
  }
});

test('H4-B.3 provenance is explicitly synthetic and has no success/freshness/remote credentials', () => {
  const f = buildDeliverableMirrorFixture(configuration());
  for (const row of f.asanaProjectMirror) {
    assert.equal(row.lastSyncedAt, null); assert.equal(row.lastAttemptAt, null); assert.equal(row.baselineAt, null); assert.equal(row.lastSyncStatus, null);
    assert.match(row.name, /SINTETICA/); assert.match(row.lastSyncError, /nenhuma consulta/);
  }
  for (const link of f.clientIntegration) { assert.equal(link.metadata.synthetic, true); assert.match(link.externalId, /^synthetic-/); }
  for (const row of [...f.asanaTaskChange, ...f.asanaProjectSnapshot]) assert.equal(row.syncRunId, null);
  for (const task of f.asanaTaskMirror) { assert.match(task.taskGid, /^synthetic-/); assert.equal(task.permalinkUrl, null); }
  assert.ok(!Object.keys(f).some((m) => /Connection|SyncRun|Webhook/i.test(m)));
});

for (const value of [undefined, '', 'today', '2026-02-30', '2026-13-01', '2026-10-15T00:00:00Z']) {
  test(`H4-B.3 invalid reference date ${String(value)} blocks before connection`, async () => {
    await assert.rejects(runNavigableSeed({ env: { ...configuration(), HML_SEED_REFERENCE_DATE: value }, createClient: () => assert.fail('connected') }), /REFERENCE_DATE/);
  });
}

test('H4-B.3 same date is deterministic; same-month and different-period changes refuse without mutations', async () => {
  const db = memoryDatabase(); const env = configuration();
  assert.deepEqual(buildDeliverableMirrorFixture(env), buildDeliverableMirrorFixture(env));
  await runNavigableSeed({ env, createClient: () => db }); const before = structuredClone(db.state);
  for (const day of ['2026-10-16', '2026-11-15']) {
    await assert.rejects(runNavigableSeed({ env: { ...env, HML_SEED_REFERENCE_DATE: day }, createClient: () => db }), /DELIVERY_COLLISION/);
    assert.deepEqual(db.state, before);
  }
});

for (const model of DELIVERY_MODELS) {
  test(`H4-B.3 ${model} collision preserves all models and sentinels`, async () => {
    const db = memoryDatabase(); const row = structuredClone(buildDeliverableMirrorFixture(configuration())[model][0]);
    if (row.organizationId) row.organizationId = 'foreign-tenant'; else row.metadata.synthetic = false;
    db.state[model].push(row); const before = structuredClone(db.state);
    await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /DELIVERY_COLLISION/);
    assert.deepEqual(db.state, before);
  });
}

for (const [model, key, value] of [
  ['deliverablePlan', 'clientId', TEAM_CLIENT_FIXTURE.client[4].id],
  ['deliverableItem', 'planId', 'a4b30000-0001-4000-8000-000000000002'],
  ['deliverablePiece', 'approvedByUserId', PEOPLE[4].id],
  ['deliverableEvent', 'actorUserId', PEOPLE[4].id],
  ['asanaProjectSnapshot', 'clientId', TEAM_CLIENT_FIXTURE.client[4].id],
  ['asanaTaskChange', 'taskGid', 'synthetic-unknown-task'],
] as const) {
  test(`H4-B.3 ${model}.${key} rejects cross-scope graphs`, () => {
    const f = structuredClone(buildDeliverableMirrorFixture(configuration())); f[model][0][key] = value;
    assert.throws(() => assertDeliverableMirrorRelations(f), /SCOPE/);
  });
}

test('H4-B.3 final snapshot failure rolls back all four modules', async () => {
  const total = 14 + Object.values(businessCounts).reduce((a, b) => a + b, 0) + Object.values(deliveryCounts).reduce((a, b) => a + b, 0);
  const db = memoryDatabase(total); const before = structuredClone(db.state);
  await assert.rejects(runNavigableSeed({ env: configuration(), createClient: () => db }), /Injected write failure/);
  assert.deepEqual(db.state, before);
});
