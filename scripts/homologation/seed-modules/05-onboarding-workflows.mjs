import { OnboardingStepInputSchema } from '@zafira/contracts';
import { validatePublishable, planExecutionStart, findReleasable, computeDueDate, progressOf,
  resolveAssignee, validateStepCompletion, resolveTimeZone, isValidTimeZone } from '@zafira/domain';
import { ORGANIZATIONS, PEOPLE } from './02-core-organizations.mjs';
import { TEAM_CLIENT_FIXTURE } from './03-teams-and-clients.mjs';
import { refuse } from './01-safety-guard.mjs';

const org = ORGANIZATIONS[0].id;
const manager = PEOPLE.find((p) => p.organizationId === org && p.role === 'MANAGER');
const member = PEOPLE.find((p) => p.organizationId === org && p.role === 'MEMBER');
const id = (kind, n) => `a4b40000-${kind}-4000-8000-${String(n).padStart(12, '0')}`;
export const ONBOARDING_MODELS = ['onboardingTemplate', 'onboardingTemplateVersion', 'onboardingStepDefinition',
  'onboardingStepDependency', 'onboardingEvent', 'onboardingExecution', 'onboardingStepRun', 'onboardingExecutionEvent'];
const canonical = (v) => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const asDate = (day) => day ? new Date(day + 'T00:00:00.000Z') : null;

export function onboardingSteps() {
  return ['briefing', 'projeto', 'kickoff', 'acessos'].map((stepKey, position) => OnboardingStepInputSchema.parse({
    stepKey, title: ['Briefing SINTETICO', 'Projeto local SINTETICO', 'Kickoff SINTETICO', 'Acessos SINTETICOS'][position],
    description: 'Demonstracao ficticia; nenhuma acao humana ou integracao real.',
    kind: position === 1 ? 'CONFIRM_ASANA_PROJECT' : 'MANUAL', assigneeMode: 'MEMBER', memberId: manager.membershipId,
    functionId: null, automationKey: null, dueBusinessDays: position + 1, dueAnchor: 'RELEASED',
    evidenceKind: position === 0 || position === 3 ? 'NOTE' : 'NONE', evidenceRequired: position === 0 || position === 3,
    completionCondition: position === 1 ? 'ASANA_PROJECT_LINKED' : position === 0 || position === 3 ? 'EVIDENCE_PROVIDED' : 'CONFIRMATION',
    blocksCompletion: true, dependsOn: position ? [['briefing', 'projeto', 'kickoff'][position - 1]] : [],
  }));
}

// Same portfolio contract as client-resource-scope.ts, evaluated only for these
// synthetic participants. This is seed preflight, never a product authorization path.
export function eligibleSyntheticMembers(clientId, f = TEAM_CLIENT_FIXTURE, people = PEOPLE) {
  const client = f.client.find((c) => c.id === clientId && c.organizationId === org);
  if (!client) refuse('ONBOARDING_CLIENT_SCOPE');
  return new Set(people.filter((p) => p.organizationId === org &&
    (p.role === 'ADMIN' || f.userClientAssignment.some((a) => a.organizationMemberId === p.membershipId && a.clientId === clientId && a.organizationId === org) ||
      f.teamMember.some((m) => m.organizationMemberId === p.membershipId && m.organizationId === org &&
        f.team.some((t) => t.id === m.teamId && t.organizationId === org && t.isActive) &&
        f.teamClientAssignment.some((a) => a.teamId === m.teamId && a.clientId === clientId && a.organizationId === org))))
    .map((p) => p.membershipId));
}

export function buildOnboardingFixture(env, timeZone) {
  if (timeZone != null && !isValidTimeZone(timeZone)) refuse('ONBOARDING_TIMEZONE');
  const zone = resolveTimeZone(timeZone), reference = env.HML_SEED_REFERENCE_DATE;
  const ref = new Date(reference + 'T15:00:00.000Z');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(reference ?? '') || !Number.isFinite(ref.getTime()) || ref.toISOString().slice(0, 10) !== reference) refuse('REFERENCE_DATE');
  const at = (days, seconds = 0) => new Date(ref.getTime() + days * 86400000 + seconds * 1000);
  const created = at(-5), published = at(-5, 60), templateId = id('0001', 1), versionId = id('0002', 1);
  const marker = `DEMONSTRACAO SINTETICA; referencia ${reference}; fuso ${zone}; sem operacao real.`;
  const steps = onboardingSteps();
  if (validatePublishable(steps, { activeFunctionIds: new Set(), activeMemberIds: new Set([manager.membershipId]) }).length) refuse('ONBOARDING_DEFINITION');
  const f = Object.fromEntries(ONBOARDING_MODELS.map((m) => [m, []]));
  f.onboardingTemplate.push({ id: templateId, organizationId: org, name: 'Onboarding SINTETICO Alpha', description: marker,
    scopeKind: 'GENERAL', scopeLabel: null, status: 'ACTIVE', createdByUserId: manager.id, createdAt: created, updatedAt: published });
  f.onboardingTemplateVersion.push({ id: versionId, organizationId: org, templateId, versionNumber: 1, status: 'PUBLISHED',
    changeNote: marker, basedOnVersionId: null, publishedAt: published, publishedByUserId: manager.id, createdAt: created, updatedAt: published });
  for (const [position, input] of steps.entries()) {
    const { dependsOn, ...def } = input;
    f.onboardingStepDefinition.push({ id: id('0003', position + 1), organizationId: org, versionId, position, ...def, createdAt: created });
    for (const dependency of dependsOn) f.onboardingStepDependency.push({ organizationId: org, versionId, stepKey: input.stepKey, dependsOnStepKey: dependency });
  }
  f.onboardingEvent.push({ id: id('0004', 1), organizationId: org, templateId, versionId, type: 'TEMPLATE_CREATED', actorUserId: manager.id,
    reason: marker, before: null, after: { name: f.onboardingTemplate[0].name, scopeKind: 'GENERAL' }, createdAt: created },
  { id: id('0004', 2), organizationId: org, templateId, versionId, type: 'VERSION_PUBLISHED', actorUserId: manager.id,
    reason: marker, before: { status: 'DRAFT' }, after: { status: 'PUBLISHED', versionNumber: 1, stepCount: 4 }, createdAt: published });
  let eventNumber = 0;
  for (const [i, client] of [TEAM_CLIENT_FIXTURE.client[1], TEAM_CLIENT_FIXTURE.client[0]].entries()) {
    const executionId = id('0005', i + 1), startedAt = at(i ? 0 : -3);
    f.onboardingExecution.push({ id: executionId, organizationId: org, clientId: client.id, templateId, versionId,
      status: 'ACTIVE', startTrigger: 'MANUAL', sourceRef: 'synthetic-h4b4', requestId: `synthetic-h4b4-execution-${i + 1}`,
      startedAt, startedByUserId: manager.id, completedAt: null, completedByUserId: null, completionMode: null,
      cancelledAt: null, cancelledByUserId: null, cancelReason: null, createdAt: startedAt, updatedAt: startedAt });
    const event = (type, when, stepKey, after, before) => f.onboardingExecutionEvent.push({ id: id('0007', ++eventNumber), organizationId: org,
      executionId, stepKey: stepKey ?? null, type, actorUserId: manager.id, reason: marker, before: before ?? null, after, createdAt: when });
    event('EXECUTION_STARTED', startedAt, null, { clientId: client.id, templateId, versionId, versionNumber: 1, trigger: 'MANUAL', steps: 4, unresolvedStepKeys: [] });
    const eligible = eligibleSyntheticMembers(client.id);
    const runs = planExecutionStart(steps, { startedAt, timeZone: zone }).map((p, j) => {
      const chosen = !i && p.stepKey === 'kickoff' ? member.membershipId : null;
      // resolveAssignee deliberately ignores invalid manual choices: refuse FIRST.
      if (!eligible.has(steps[j].memberId) || (chosen && !eligible.has(chosen))) refuse('ONBOARDING_ASSIGNEE');
      const resolution = resolveAssignee(steps[j], { eligible, functionMembers: new Map(), chosen });
      if (resolution.unresolved) refuse('ONBOARDING_ASSIGNEE');
      return { id: id('0006', i * 4 + j + 1), organizationId: org, executionId, versionId, stepKey: p.stepKey, status: p.status,
        blocked: false, blockedReason: null, blockedAt: null, assigneeMemberId: resolution.memberId, assigneeSource: resolution.source, functionId: null,
        releasedAt: p.releasedAt, dueDate: asDate(p.dueDate), startedAt: null, completedAt: null, completedByUserId: null,
        evidenceLink: null, evidenceNote: null, asanaProjectGid: null, calendarEventId: null, calendarEventTitle: null,
        calendarEventStartAt: null, completedBySystem: false, skipReason: null, skippedByUserId: null, createdAt: startedAt, updatedAt: startedAt };
    });
    if (!i) {
      for (const j of [0, 1]) {
        const run = runs[j], when = at(-2 + j), input = j === 0 ? { confirm: false, evidenceNote: marker } : { confirm: false, asanaProjectGid: 'synthetic-h4b3-alpha-project' };
        if (run.status !== 'READY' || validateStepCompletion(steps[j], input).length) refuse('ONBOARDING_COMPLETION');
        event('STEP_COMPLETED', when, run.stepKey, { status: 'DONE', condition: steps[j].completionCondition, hasEvidence: j === 0, calendarEventId: null, viaOverrideWithoutAssignee: false }, { status: 'READY' });
        Object.assign(run, { status: 'DONE', completedAt: when, completedByUserId: manager.id, evidenceNote: input.evidenceNote ?? null, asanaProjectGid: input.asanaProjectGid ?? null, updatedAt: when });
        for (const key of findReleasable(steps, runs)) {
          const next = runs.find((r) => r.stepKey === key), def = steps.find((d) => d.stepKey === key);
          const dueDate = computeDueDate(when, def.dueBusinessDays, zone);
          Object.assign(next, { status: 'READY', releasedAt: when, dueDate: asDate(dueDate), updatedAt: when });
          event('STEP_RELEASED', when, key, { dueDate });
        }
      }
      const when = at(-1, 60);
      Object.assign(runs[2], { status: 'IN_PROGRESS', startedAt: when, updatedAt: when });
      event('STEP_STARTED', when, 'kickoff', { status: 'IN_PROGRESS' }, { status: 'READY' });
    }
    f.onboardingStepRun.push(...runs);
    if (progressOf(runs).percent !== (i ? 0 : 50)) refuse('ONBOARDING_PROGRESS');
  }
  assertOnboardingRelations(f);
  return freeze(f);
}

export function assertOnboardingRelations(f) {
  const template = f.onboardingTemplate[0], version = f.onboardingTemplateVersion[0];
  if (f.onboardingTemplate.length !== 1 || f.onboardingTemplateVersion.length !== 1 || template.organizationId !== org ||
    version.organizationId !== org || version.templateId !== template.id || version.status !== 'PUBLISHED') refuse('ONBOARDING_TEMPLATE_SCOPE');
  for (const model of ONBOARDING_MODELS) for (const row of f[model]) {
    if (row.organizationId !== org || (row.templateId && row.templateId !== template.id) || (row.versionId && row.versionId !== version.id)) refuse('ONBOARDING_SCOPE');
    for (const key of ['actorUserId', 'createdByUserId', 'publishedByUserId', 'startedByUserId', 'completedByUserId'])
      if (row[key] && !PEOPLE.some((p) => p.id === row[key] && p.organizationId === org)) refuse('ONBOARDING_ACTOR');
    if (row.executionId && !f.onboardingExecution.some((e) => e.id === row.executionId)) refuse('ONBOARDING_EXECUTION_SCOPE');
    if (row.stepKey && !f.onboardingStepDefinition.some((d) => d.stepKey === row.stepKey)) refuse('ONBOARDING_STEP_SCOPE');
  }
  const steps = f.onboardingStepDefinition.map((d) => ({ ...d, dependsOn: f.onboardingStepDependency.filter((r) => r.stepKey === d.stepKey).map((r) => r.dependsOnStepKey) }));
  if (validatePublishable(steps, { activeFunctionIds: new Set(), activeMemberIds: new Set([manager.membershipId]) }).length) refuse('ONBOARDING_DEFINITION');
  for (const e of f.onboardingExecution) {
    const eligible = eligibleSyntheticMembers(e.clientId);
    for (const r of f.onboardingStepRun.filter((r) => r.executionId === e.id)) {
      if (!eligible.has(r.assigneeMemberId)) refuse('ONBOARDING_ASSIGNEE');
      const def = steps.find((d) => d.stepKey === r.stepKey);
      if (r.status === 'DONE' && validateStepCompletion(def, { confirm: true, ...r }).length) refuse('ONBOARDING_COMPLETION');
    }
  }
}

// New records are created once. Existing published records/events must never see
// even an empty UPDATE (SQL triggers intentionally reject it).
export async function seedOnboarding(tx, env) {
  const configs = await tx.organizationConfig.findMany({ where: { organizationId: org } });
  const f = buildOnboardingFixture(env, configs[0]?.timezone);
  const templateId = f.onboardingTemplate[0].id, versionId = f.onboardingTemplateVersion[0].id;
  const executionIds = f.onboardingExecution.map((e) => e.id);
  // Verify actual participants and existing local links; no provider calls.
  const users = await tx.user.findMany({ where: { id: { in: PEOPLE.filter((p) => p.organizationId === org).map((p) => p.id) } } });
  const members = await tx.organizationMember.findMany({ where: { organizationId: org } });
  for (const p of PEOPLE.filter((p) => p.organizationId === org)) {
    if (!users.some((u) => u.id === p.id && u.status === 'ACTIVE') || !members.some((m) => m.id === p.membershipId && m.userId === p.id && m.organizationId === org && m.status === 'ACTIVE' && m.role === p.role)) refuse('ONBOARDING_PARTICIPANT');
  }
  const actualBusiness = {};
  for (const model of ['client', 'team', 'teamMember', 'teamClientAssignment', 'userClientAssignment']) actualBusiness[model] = await tx[model].findMany({ where: { organizationId: org } });
  for (const e of f.onboardingExecution) {
    const eligible = eligibleSyntheticMembers(e.clientId, actualBusiness);
    if (f.onboardingStepRun.filter((r) => r.executionId === e.id).some((r) => !eligible.has(r.assigneeMemberId))) refuse('ONBOARDING_ASSIGNEE');
  }
  const run = f.onboardingStepRun.find((r) => r.asanaProjectGid);
  const links = await tx.clientIntegration.findMany({ where: { clientId: f.onboardingExecution[0].clientId, provider: 'ASANA', externalId: run.asanaProjectGid } });
  if (links.length !== 1 || links[0].metadata?.synthetic !== true) refuse('ONBOARDING_PROJECT_LINK');
  let present = 0, expectedCount = 0;
  for (const model of ONBOARDING_MODELS) {
    const expected = f[model], or = [];
    if (model !== 'onboardingStepDependency') or.push({ id: { in: expected.map((r) => r.id) } });
    if (model === 'onboardingTemplate') or.push({ organizationId: org, name: expected[0].name });
    else if (model === 'onboardingTemplateVersion' || model === 'onboardingEvent') or.push({ templateId });
    else if (model === 'onboardingStepDefinition' || model === 'onboardingStepDependency') or.push({ versionId });
    else if (model === 'onboardingExecution') or.push({ templateId }, ...expected.map((e) => ({ organizationId: org, requestId: e.requestId })));
    else or.push({ executionId: { in: executionIds } });
    const rows = await tx[model].findMany({ where: { OR: or } });
    if (rows.some((row) => !expected.some((e) => Object.keys(e).every((key) => equal(row[key] ?? null, e[key]))))) refuse(`ONBOARDING_COLLISION_${model}`);
    present += rows.length; expectedCount += expected.length;
  }
  if (present && present !== expectedCount) refuse('ONBOARDING_PARTIAL_STATE');
  if (!present) {
    await tx.onboardingTemplate.create({ data: f.onboardingTemplate[0] });
    const v = f.onboardingTemplateVersion[0];
    await tx.onboardingTemplateVersion.create({ data: { ...v, status: 'DRAFT', publishedAt: null, publishedByUserId: null } });
    for (const model of ['onboardingStepDefinition', 'onboardingStepDependency']) for (const row of f[model]) await tx[model].create({ data: row });
    // Only the version created by this transaction may transition to PUBLISHED.
    await tx.onboardingTemplateVersion.update({ where: { id: versionId, status: 'DRAFT' }, data: { status: v.status, publishedAt: v.publishedAt, publishedByUserId: v.publishedByUserId, updatedAt: v.updatedAt } });
    for (const model of ['onboardingEvent', 'onboardingExecution', 'onboardingStepRun', 'onboardingExecutionEvent']) for (const row of f[model]) {
      const data = Object.fromEntries(Object.entries(row).filter(([key, value]) => !(value === null && ['before', 'after'].includes(key))));
      await tx[model].create({ data });
    }
  }
  return Object.fromEntries(ONBOARDING_MODELS.map((m) => [m, f[m].length]));
}
