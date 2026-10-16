import { deriveItemProgress, validatePieceFormat } from '@zafira/domain';
import { PEOPLE } from './02-core-organizations.mjs';
import { TEAM_CLIENT_FIXTURE } from './03-teams-and-clients.mjs';
import { refuse } from './01-safety-guard.mjs';

const id = (kind, n) => `a4b30000-${kind}-4000-8000-${String(n).padStart(12, '0')}`;
const date = (day, hour = 15) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const offset = (day, n) => new Date(Date.parse(date(day)) + n * 86400000).toISOString().slice(0, 10);
const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export const DELIVERY_MODELS = ['deliverableTemplate', 'deliverablePlan', 'deliverableItem', 'deliverablePiece', 'deliverableEvent',
  'clientIntegration', 'asanaProjectMirror', 'asanaTaskMirror', 'asanaTaskChange', 'asanaProjectSnapshot'];

// No implicit clock or period rollover. A changed date meets the SAME IDs and is
// refused by immutable preflight, instead of creating a second period/history.
export function buildDeliverableMirrorFixture(env) {
  const ref = env.HML_SEED_REFERENCE_DATE;
  if (typeof ref !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(ref) || !Number.isFinite(Date.parse(date(ref))) || offset(ref, 0) !== ref) refuse('REFERENCE_DATE');
  const f = Object.fromEntries(DELIVERY_MODELS.map((m) => [m, []]));
  let eventNumber = 0;
  for (const [index, client] of [TEAM_CLIENT_FIXTURE.client[1], TEAM_CLIENT_FIXTURE.client[4]].entries()) {
    const n = index + 1, org = client.organizationId, label = index ? 'beta' : 'alpha';
    const actor = PEOPLE.find((p) => p.organizationId === org && p.role === 'MANAGER').id;
    const period = ref.slice(0, 7), planId = id('0001', n), projectGid = `synthetic-h4b3-${label}-project`;
    const marker = `DEMONSTRACAO SINTETICA; referencia ${ref}; nenhuma consulta ao Asana.`;
    const base = { organizationId: org, clientId: client.id };
    const defaults = [{ title: 'Conteudos sociais sinteticos', type: 'CONTEUDO_SOCIAL', unit: 'unidade', targetQuantity: 4 },
      { title: 'Criativo sintetico', type: 'CRIATIVO_ADS', unit: 'unidade', targetQuantity: 1 }];
    f.deliverableTemplate.push({ id: id('0002', n), organizationId: org, name: `Template Sintetico ${label}`, description: marker, defaultItems: defaults, isActive: true });
    f.deliverablePlan.push({ id: planId, ...base, title: `Plano Sintetico ${label} ${period}`, period, status: 'ACTIVE', targetCount: 5,
      startDate: date(`${period}-01`, 0), endDate: date(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).toISOString().slice(0, 10), 23), notes: marker });
    const event = (type, itemId, at, after, before) => f.deliverableEvent.push({ id: id('0005', ++eventNumber), organizationId: org, planId,
      ...(itemId ? { itemId } : {}), actorUserId: actor, eventType: type, reason: marker, createdAt: at, after, ...(before ? { before } : {}) });
    event('PLAN_CREATED', null, date(`${period}-01`, 0), { period, targetCount: 5 });
    for (const [j, spec] of defaults.entries()) {
      const itemId = id('0003', index * 2 + j + 1);
      const stages = j === 0 ? ['PRODUCED', 'APPROVED', 'DELIVERED'] : ['DELIVERED'];
      const progress = deriveItemProgress(spec.targetQuantity, stages);
      f.deliverableItem.push({ id: itemId, organizationId: org, planId, ...spec, ...progress, isExtra: false, description: marker,
        expectedDeliveryDate: date(ref, 18), ...(progress.status === 'DELIVERED' ? { deliveredAt: date(ref, 12), deliveredByUserId: actor } : {}) });
      event('ITEM_ADDED', itemId, date(`${period}-01`, 1), { title: spec.title, targetQuantity: spec.targetQuantity, type: spec.type });
      for (const [k, stage] of stages.entries()) {
        const pieceId = id('0004', index * 4 + (j === 0 ? k + 1 : 4));
        const format = j === 0 ? ['FEED', 'REELS', 'CARROSSEL'][k] : null;
        const piece = { id: pieceId, organizationId: org, itemId, title: `Peca Sintetica ${label} ${j + 1}-${k + 1}`, format, stage,
          producedAt: date(ref, 10), producedByUserId: actor, url: null,
          ...(stage !== 'PRODUCED' ? { approvedAt: date(ref, 11), approvedByUserId: actor } : {}),
          ...(stage === 'DELIVERED' ? { deliveredAt: date(ref, 12), deliveredByUserId: actor } : {}) };
        f.deliverablePiece.push(piece);
        event('PIECE_ADDED', itemId, date(ref, 10), { pieceId, title: piece.title, format, stage: 'PRODUCED' });
        if (stage !== 'PRODUCED') event('PIECE_ADVANCED', itemId, date(ref, 11), { pieceId, stage: 'APPROVED' }, { pieceId, stage: 'PRODUCED' });
        if (stage === 'DELIVERED') event('PIECE_ADVANCED', itemId, date(ref, 12), { pieceId, stage: 'DELIVERED' }, { pieceId, stage: 'APPROVED' });
      }
    }
    // A local demonstrative link is required by getClientHistory to render a project.
    // It is NOT an IntegrationConnection, credential, webhook or network call.
    f.clientIntegration.push({ id: id('0006', n), clientId: client.id, provider: 'ASANA', externalId: projectGid,
      metadata: { projectName: `DEMONSTRACAO SINTETICA ${label} (${ref})`, synthetic: true, referenceDate: ref } });
    f.asanaProjectMirror.push({ id: id('0007', n), ...base, projectGid, name: `DEMONSTRACAO SINTETICA ${label} (${ref})`,
      baselineAt: null, lastSyncedAt: null, lastAttemptAt: null, lastSyncStatus: null, lastSyncError: marker });
    for (let t = 0; t < 6; t++) {
      const taskGid = `synthetic-h4b3-${label}-task-${t + 1}`;
      const name = `Tarefa SINTETICA ${label} ${t + 1}`;
      f.asanaTaskMirror.push({ id: id('0008', index * 6 + t + 1), ...base, projectGid, taskGid, name, completed: t < 3,
        dueOn: offset(ref, t < 3 ? 2 : t < 5 ? -14 : 1), dueAt: null, assigneeGid: `synthetic-h4b3-${label}-person`, assigneeName: 'Pessoa ficticia do espelho',
        sectionGid: `synthetic-h4b3-${label}-section`, sectionName: 'DEMONSTRACAO SINTETICA', permalinkUrl: null,
        firstSeenAt: date(offset(ref, -13)), lastSeenAt: date(ref), removedAt: null });
      if (t < 3) f.asanaTaskChange.push({ id: id('0009', index * 3 + t + 1), ...base, projectGid, taskGid, taskName: name,
        field: 'completed', before: false, after: true, detectedAt: date(offset(ref, -13 + (t + 1) * 4)), syncRunId: null });
    }
    for (let day = 0; day < 14; day++) {
      const completed = Math.floor(day / 4), snapshotDate = offset(ref, day - 13);
      f.asanaProjectSnapshot.push({ id: id('0010', index * 14 + day + 1), ...base, projectGid, snapshotDate,
        totalTasks: 6, completedTasks: completed, pendingTasks: 6 - completed, overdueTasks: 2, capturedAt: date(snapshotDate), syncRunId: null });
    }
  }
  assertDeliverableMirrorRelations(f);
  return freeze(f);
}

export function assertDeliverableMirrorRelations(f) {
  const same = (rows, value, org) => rows.find((r) => r.id === value && r.organizationId === org);
  for (const model of DELIVERY_MODELS) for (const row of f[model]) {
    const org = row.organizationId ?? TEAM_CLIENT_FIXTURE.client.find((c) => c.id === row.clientId)?.organizationId;
    if (!PEOPLE.some((p) => p.organizationId === org)) refuse('DELIVERY_TENANT');
    if (row.clientId && !same(TEAM_CLIENT_FIXTURE.client, row.clientId, org)) refuse('DELIVERY_CLIENT_SCOPE');
    if (row.planId && !same(f.deliverablePlan, row.planId, org)) refuse('DELIVERY_PLAN_SCOPE');
    if (row.itemId) {
      const item = same(f.deliverableItem, row.itemId, org);
      if (!item || (row.planId && item.planId !== row.planId)) refuse('DELIVERY_ITEM_SCOPE');
    }
    for (const key of ['actorUserId', 'producedByUserId', 'approvedByUserId', 'deliveredByUserId']) {
      if (row[key] && !same(PEOPLE, row[key], org)) refuse('DELIVERY_ACTOR_SCOPE');
    }
    if (row.projectGid && !f.asanaProjectMirror.some((p) => p.organizationId === org && p.clientId === row.clientId && p.projectGid === row.projectGid)) refuse('MIRROR_PROJECT_SCOPE');
    if (row.projectGid && !row.projectGid.startsWith('synthetic-h4b3-')) refuse('MIRROR_SYNTHETIC_ID');
    if (model === 'asanaTaskChange' && !f.asanaTaskMirror.some((t) => t.organizationId === org && t.clientId === row.clientId && t.projectGid === row.projectGid && t.taskGid === row.taskGid)) refuse('MIRROR_TASK_SCOPE');
  }
  for (const plan of f.deliverablePlan) {
    if (f.deliverableItem.filter((i) => i.planId === plan.id).reduce((sum, i) => sum + i.targetQuantity, 0) !== plan.targetCount) refuse('DELIVERY_TARGET');
  }
  for (const item of f.deliverableItem) {
    const pieces = f.deliverablePiece.filter((p) => p.itemId === item.id);
    const progress = deriveItemProgress(item.targetQuantity, pieces.map((p) => p.stage));
    if (progress.status !== item.status || progress.deliveredQuantity !== item.deliveredQuantity) refuse('DELIVERY_PROGRESS');
    for (const piece of pieces) validatePieceFormat(item.type, piece.format);
    for (const p of pieces) {
      const approved = p.stage === 'APPROVED' || p.stage === 'DELIVERED', delivered = p.stage === 'DELIVERED';
      if (Boolean(p.approvedAt) !== approved || Boolean(p.approvedByUserId) !== approved || Boolean(p.deliveredAt) !== delivered || Boolean(p.deliveredByUserId) !== delivered ||
        (approved && p.approvedAt < p.producedAt) || (delivered && p.deliveredAt < p.approvedAt)) refuse('DELIVERY_STAGE_TIME');
    }
  }
  for (const s of f.asanaProjectSnapshot) {
    if (s.totalTasks !== s.completedTasks + s.pendingTasks || s.overdueTasks < 0 || s.overdueTasks > s.pendingTasks) refuse('MIRROR_COUNTS');
  }
}

const dateKeys = new Set(['startDate', 'endDate', 'expectedDeliveryDate', 'producedAt', 'approvedAt', 'deliveredAt', 'createdAt', 'firstSeenAt', 'lastSeenAt', 'detectedAt', 'capturedAt']);
const canonical = (v) => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;

export async function seedDeliverablesAndMirror(tx, f) {
  assertDeliverableMirrorRelations(f);
  const ids = (model) => ({ in: f[model].map((r) => r.id) });
  for (const model of DELIVERY_MODELS) {
    const rows = f[model], extra = [];
    if (model === 'deliverableTemplate') extra.push(...rows.map(({ organizationId, name }) => ({ organizationId, name })));
    if (model === 'deliverablePlan') extra.push(...rows.map(({ organizationId, clientId, period }) => ({ organizationId, clientId, period })));
    if (['deliverableItem', 'deliverableEvent'].includes(model)) extra.push({ planId: ids('deliverablePlan') });
    if (model === 'deliverablePiece') extra.push({ itemId: ids('deliverableItem') });
    if (model === 'clientIntegration') extra.push({ externalId: { in: rows.map((r) => r.externalId) } });
    if (model.startsWith('asana')) extra.push({ projectGid: { in: f.asanaProjectMirror.map((r) => r.projectGid) } });
    const existing = await tx[model].findMany({ where: { OR: [{ id: ids(model) }, ...extra] } });
    for (const row of existing) {
      // Full seeded payload is immutable, including dates/periods/stages/provenance.
      if (!rows.some((expected) => Object.keys(expected).every((key) => JSON.stringify(canonical(row[key])) === JSON.stringify(canonical(expected[key]))))) refuse(`DELIVERY_COLLISION_${model}`);
    }
  }
  for (const model of DELIVERY_MODELS) for (const row of f[model]) {
    const create = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, dateKeys.has(key) && value ? new Date(value) : value]));
    await tx[model].upsert({ where: { id: row.id }, update: {}, create });
  }
  return Object.fromEntries(DELIVERY_MODELS.map((m) => [m, f[m].length]));
}
