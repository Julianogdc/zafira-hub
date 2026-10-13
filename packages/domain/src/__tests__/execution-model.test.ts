import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedStepActions,
  canActOnStep,
  computeDueDate,
  findReleasable,
  isAutoCompletable,
  isStepLate,
  planEarlyCompletion,
  planExecutionStart,
  progressOf,
  resolveAssignee,
  validateStepCompletion,
  type StepDef,
} from '../onboarding/execution-model.js';

const def = (stepKey: string, extra: Partial<StepDef> = {}): StepDef => ({
  stepKey,
  dueBusinessDays: null,
  dueAnchor: 'RELEASED',
  dependsOn: [],
  blocksCompletion: false,
  completionCondition: 'CONFIRMATION',
  evidenceKind: 'NONE',
  evidenceRequired: false,
  assigneeMode: 'NONE',
  functionId: null,
  memberId: null,
  kind: 'MANUAL',
  ...extra,
});

const SP = 'America/Sao_Paulo';

test('prazo em dias uteis: fim de semana, virada de mes e fuso da organizacao', () => {
  // sexta 2026-10-09 14:00 UTC => sexta em Sao Paulo; +1 dia util = segunda 12
  assert.equal(computeDueDate(new Date('2026-10-09T17:00:00Z'), 1, SP), '2026-10-12');
  // virada de mes: sexta 2026-10-30 + 2 = terca 11-03
  assert.equal(computeDueDate(new Date('2026-10-30T15:00:00Z'), 2, SP), '2026-11-03');
  // 02h UTC de sabado ainda e sexta em Sao Paulo (UTC-3): +0 = sexta
  assert.equal(computeDueDate(new Date('2026-10-10T02:00:00Z'), 0, SP), '2026-10-09');
  assert.equal(computeDueDate(new Date('2026-10-09T17:00:00Z'), null, SP), null);
  // feriado da lista e pulado
  assert.equal(computeDueDate(new Date('2026-10-09T17:00:00Z'), 1, SP, new Set(['2026-10-12'])), '2026-10-13');
});

test('plano inicial: sem dependencia nasce READY; ancora START calcula ja; RELEASED so quando liberada', () => {
  const startedAt = new Date('2026-10-12T13:00:00Z');
  const plan = planExecutionStart(
    [
      def('a', { dueBusinessDays: 2 }),
      def('b', { dependsOn: ['a'], dueBusinessDays: 3, dueAnchor: 'RELEASED' }),
      def('c', { dependsOn: ['a'], dueBusinessDays: 3, dueAnchor: 'START' }),
    ],
    { startedAt, timeZone: SP }
  );
  const by = Object.fromEntries(plan.map((p) => [p.stepKey, p]));
  assert.equal(by.a.status, 'READY');
  assert.equal(by.a.dueDate, '2026-10-14');
  assert.equal(by.b.status, 'WAITING');
  assert.equal(by.b.dueDate, null);
  assert.equal(by.b.releasedAt, null);
  assert.equal(by.c.status, 'WAITING');
  assert.equal(by.c.dueDate, '2026-10-15');
});

test('liberacao por dependencias: DONE e SKIPPED satisfazem; aberta ou cancelada nao', () => {
  const steps = [def('a'), def('b'), def('c', { dependsOn: ['a', 'b'] })];
  const run = (a: string, b: string) => [
    { stepKey: 'a', status: a as never, blocked: false },
    { stepKey: 'b', status: b as never, blocked: false },
    { stepKey: 'c', status: 'WAITING' as const, blocked: false },
  ];
  assert.deepEqual(findReleasable(steps, run('DONE', 'IN_PROGRESS')), []);
  assert.deepEqual(findReleasable(steps, run('DONE', 'SKIPPED')), ['c']);
  assert.deepEqual(findReleasable(steps, run('DONE', 'CANCELLED')), []);
});

test('atraso e indicador no fuso da organizacao e so para etapa aberta', () => {
  const now = new Date('2026-10-13T12:00:00Z'); // terca em SP
  assert.equal(isStepLate({ status: 'READY', dueDate: '2026-10-12' }, SP, now), true);
  assert.equal(isStepLate({ status: 'READY', dueDate: '2026-10-13' }, SP, now), false);
  assert.equal(isStepLate({ status: 'DONE', dueDate: '2026-10-01' }, SP, now), false);
  assert.equal(isStepLate({ status: 'READY', dueDate: null }, SP, now), false);
});

test('progresso ignora etapas canceladas', () => {
  assert.deepEqual(progressOf([{ status: 'DONE' }, { status: 'SKIPPED' }, { status: 'READY' }, { status: 'CANCELLED' }]), {
    closed: 2,
    total: 3,
    percent: 67,
  });
  assert.equal(progressOf([]).percent, 0);
});

test('responsaveis (P1): so ativos com o cliente na carteira; carteira nunca e ampliada', () => {
  const eligible = new Set(['m1', 'm2']);
  const fm = new Map([['fn', ['m1', 'm3']], ['fn2', ['m1', 'm2']], ['fn3', ['m9']]]);
  // pessoa fixa elegivel
  assert.equal(resolveAssignee(def('s', { assigneeMode: 'MEMBER', memberId: 'm1' }), { eligible, functionMembers: fm }).memberId, 'm1');
  // pessoa fixa fora da carteira/inativa => sem responsavel
  const out = resolveAssignee(def('s', { assigneeMode: 'MEMBER', memberId: 'm3' }), { eligible, functionMembers: fm });
  assert.equal(out.memberId, null);
  assert.equal(out.unresolved, 'MEMBER_NOT_ELIGIBLE');
  // funcao: m3 nao e elegivel, so m1 => resolvido
  const one = resolveAssignee(def('s', { assigneeMode: 'FUNCTION', functionId: 'fn' }), { eligible, functionMembers: fm });
  assert.deepEqual([one.memberId, one.source], ['m1', 'FUNCTION_RESOLVED']);
  // funcao com varios candidatos => gestor escolhe
  const many = resolveAssignee(def('s', { assigneeMode: 'FUNCTION', functionId: 'fn2' }), { eligible, functionMembers: fm });
  assert.deepEqual([many.memberId, many.unresolved, many.candidates], [null, 'FUNCTION_MANY_CANDIDATES', ['m1', 'm2']]);
  // funcao sem elegivel
  assert.equal(resolveAssignee(def('s', { assigneeMode: 'FUNCTION', functionId: 'fn3' }), { eligible, functionMembers: fm }).unresolved, 'FUNCTION_NO_ELIGIBLE_MEMBER');
  // escolha do gestor so vale se elegivel
  const chosen = resolveAssignee(def('s', { assigneeMode: 'FUNCTION', functionId: 'fn2' }), { eligible, functionMembers: fm, chosen: 'm2' });
  assert.deepEqual([chosen.memberId, chosen.source], ['m2', 'MANUAL']);
  const bad = resolveAssignee(def('s', { assigneeMode: 'FUNCTION', functionId: 'fn2' }), { eligible, functionMembers: fm, chosen: 'm7' });
  assert.equal(bad.memberId, null);
  // sem configuracao
  assert.equal(resolveAssignee(def('s'), { eligible, functionMembers: fm }).unresolved, 'NO_ASSIGNEE_CONFIGURED');
});

test('quem pode agir (P2): sem responsavel elegivel so override', () => {
  const base = { actorMemberId: 'm1', hasExecute: true, hasOverride: false, assigneeMemberId: 'm1', assigneeEligible: true };
  assert.equal(canActOnStep(base), true);
  assert.equal(canActOnStep({ ...base, assigneeMemberId: 'm2' }), false);
  assert.equal(canActOnStep({ ...base, assigneeMemberId: null }), false);
  assert.equal(canActOnStep({ ...base, assigneeEligible: false }), false);
  assert.equal(canActOnStep({ ...base, hasExecute: false }), false);
  assert.equal(canActOnStep({ ...base, assigneeMemberId: null, hasOverride: true }), true);
});

test('condicoes de conclusao do catalogo fechado', () => {
  const manual = { completionCondition: 'CONFIRMATION' as const, evidenceKind: 'NONE' as const, evidenceRequired: false };
  assert.equal(validateStepCompletion(manual, { confirm: false }).length, 1);
  assert.equal(validateStepCompletion(manual, { confirm: true }).length, 0);
  const link = { completionCondition: 'EVIDENCE_PROVIDED' as const, evidenceKind: 'LINK' as const, evidenceRequired: true };
  assert.equal(validateStepCompletion(link, { confirm: true }).length, 1);
  assert.equal(validateStepCompletion(link, { confirm: false, evidenceLink: 'https://x.test/a' }).length, 0);
  const note = { completionCondition: 'EVIDENCE_PROVIDED' as const, evidenceKind: 'NOTE' as const, evidenceRequired: true };
  assert.equal(validateStepCompletion(note, { confirm: true, evidenceLink: 'https://x.test' }).length, 1);
  assert.equal(validateStepCompletion(note, { confirm: false, evidenceNote: 'ok' }).length, 0);
  const asana = { completionCondition: 'ASANA_PROJECT_LINKED' as const, evidenceKind: 'NONE' as const, evidenceRequired: false };
  assert.equal(validateStepCompletion(asana, { confirm: true }).length, 1);
  assert.equal(validateStepCompletion(asana, { confirm: false, asanaProjectGid: '123' }).length, 0);
  const cal = { completionCondition: 'CALENDAR_EVENT_LINKED' as const, evidenceKind: 'NONE' as const, evidenceRequired: false };
  assert.equal(validateStepCompletion(cal, { confirm: true })[0].code, 'CALENDAR_EVENT_REQUIRED');
  assert.equal(validateStepCompletion(cal, { confirm: false, calendarEventId: 'ev-1' }).length, 0);
  // automacao: nunca por acao manual (D2/D4)
  const auto = { completionCondition: 'AUTOMATION_SUCCEEDED' as const, evidenceKind: 'NONE' as const, evidenceRequired: false };
  assert.equal(validateStepCompletion(auto, { confirm: true })[0].code, 'AUTOMATION_MANUAL_COMPLETION');
});

test('conclusao antecipada (P3): bloqueantes abertas impedem; demais abertas serao dispensadas', () => {
  const steps = [def('a', { blocksCompletion: true }), def('b'), def('c', { blocksCompletion: true }), def('d')];
  const runs = (a: string, b: string, c: string, d: string) =>
    ['a', 'b', 'c', 'd'].map((k, i) => ({ stepKey: k, status: [a, b, c, d][i] as never, blocked: false }));
  const blocked = planEarlyCompletion(steps, runs('DONE', 'READY', 'WAITING', 'READY'));
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockingOpen, ['c']);
  const ok = planEarlyCompletion(steps, runs('DONE', 'READY', 'SKIPPED', 'WAITING'));
  assert.equal(ok.allowed, true);
  assert.deepEqual(ok.toSkip, ['b', 'd']);
  const none = planEarlyCompletion(steps, runs('DONE', 'DONE', 'DONE', 'DONE'));
  assert.deepEqual([none.allowed, none.toSkip], [true, []]);
});

test('conclusao automatica exige todas DONE/SKIPPED', () => {
  assert.equal(isAutoCompletable([{ status: 'DONE' }, { status: 'SKIPPED' }]), true);
  assert.equal(isAutoCompletable([{ status: 'DONE' }, { status: 'READY' }]), false);
  assert.equal(isAutoCompletable([{ status: 'DONE' }, { status: 'CANCELLED' }]), false);
  assert.equal(isAutoCompletable([]), false);
});

test('acoes de estado permitidas por situacao da etapa', () => {
  const r = (status: never, blocked = false) => ({ stepKey: 'a', status, blocked });
  assert.deepEqual(allowedStepActions(r('READY' as never)), ['start', 'complete', 'block', 'skip', 'reassign']);
  assert.deepEqual(allowedStepActions(r('WAITING' as never)), ['block', 'skip', 'reassign']);
  assert.deepEqual(allowedStepActions(r('READY' as never, true)), ['unblock', 'skip', 'reassign']);
  assert.deepEqual(allowedStepActions(r('DONE' as never)), []);
  assert.deepEqual(allowedStepActions(r('CANCELLED' as never)), []);
});
