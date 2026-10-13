import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_STEP_AVAILABLE,
  STEP_KIND_OPTIONS,
  applyAssignee,
  applyEvidence,
  applyKind,
  groupProblemsByStep,
  moveStep,
  newStep,
  removeStep,
  stepsEqual,
} from '../onboarding-builder';

const mk = (key: string, extra = {}) => newStep({ stepKey: key, title: key, ...extra });

test('Calendar e Automação ficam disponíveis no construtor (F7-3c e F7-4b)', () => {
  assert.equal(CALENDAR_STEP_AVAILABLE, true);
  const calendar = STEP_KIND_OPTIONS.find((o) => o.value === 'CALENDAR_EVENT');
  assert.equal(calendar?.available, true);
  const automation = STEP_KIND_OPTIONS.find((o) => o.value === 'AUTOMATION');
  assert.equal(automation?.available, true);
});

test('reordenar por botões troca vizinhas e respeita as bordas', () => {
  const steps = [mk('a'), mk('b'), mk('c')];
  assert.deepEqual(moveStep(steps, 'b', -1).map((s) => s.stepKey), ['b', 'a', 'c']);
  assert.deepEqual(moveStep(steps, 'b', 1).map((s) => s.stepKey), ['a', 'c', 'b']);
  assert.deepEqual(moveStep(steps, 'a', -1).map((s) => s.stepKey), ['a', 'b', 'c']);
  assert.deepEqual(moveStep(steps, 'c', 1).map((s) => s.stepKey), ['a', 'b', 'c']);
});

test('remover etapa limpa dependências que apontavam para ela', () => {
  const steps = [mk('a'), mk('b', { dependsOn: ['a'] }), mk('c', { dependsOn: ['a', 'b'] })];
  const next = removeStep(steps, 'a');
  assert.deepEqual(next.map((s) => s.stepKey), ['b', 'c']);
  assert.deepEqual(next[0].dependsOn, []);
  assert.deepEqual(next[1].dependsOn, ['b']);
});

test('evidência obrigatória deriva a condição "evidência fornecida"', () => {
  const s = applyEvidence(mk('a'), 'LINK', true);
  assert.equal(s.completionCondition, 'EVIDENCE_PROVIDED');
  assert.equal(s.evidenceRequired, true);
  const opt = applyEvidence(s, 'LINK', false);
  assert.equal(opt.completionCondition, 'CONFIRMATION');
  assert.equal(opt.evidenceRequired, false);
  const none = applyEvidence(s, 'NONE', true);
  assert.equal(none.completionCondition, 'CONFIRMATION');
  assert.equal(none.evidenceRequired, false);
});

test('etapa de projeto Asana usa sempre a condição "projeto vinculado"', () => {
  const s = applyKind(mk('a'), 'CONFIRM_ASANA_PROJECT');
  assert.equal(s.completionCondition, 'ASANA_PROJECT_LINKED');
  assert.equal(applyEvidence(s, 'NOTE', true).evidenceRequired, false);
  const back = applyKind(s, 'MANUAL');
  assert.equal(back.completionCondition, 'CONFIRMATION');
});

test('trocar o modo de responsável limpa o campo que deixou de valer', () => {
  const s = applyAssignee(applyAssignee(mk('a'), 'FUNCTION'), 'MEMBER');
  assert.equal(s.functionId, null);
  const withFn = { ...mk('a'), assigneeMode: 'FUNCTION' as const, functionId: 'f1' };
  assert.equal(applyAssignee(withFn, 'NONE').functionId, null);
});

test('agrupa problemas por etapa e detecta alteração', () => {
  const g = groupProblemsByStep([
    { stepKey: 'a', message: '1' },
    { stepKey: 'a', message: '2' },
    { message: '3' },
  ]);
  assert.equal(g.get('a')?.length, 2);
  assert.equal(g.get('')?.length, 1);
  assert.equal(stepsEqual([mk('a')], [mk('a')]), true);
  assert.equal(stepsEqual([mk('a')], [mk('a', { title: 'x' })]), false);
});

test('etapa de automação: condição derivada, evidência zerada e fluxo só neste tipo (F7-4b)', () => {
  const auto = applyKind(mk('a', { automationKey: 'boas-vindas' }), 'AUTOMATION');
  assert.equal(auto.completionCondition, 'AUTOMATION_SUCCEEDED');
  assert.equal(auto.evidenceKind, 'NONE');
  assert.equal(auto.evidenceRequired, false);
  assert.equal(auto.automationKey, 'boas-vindas');
  assert.equal(applyEvidence(auto, 'LINK', true).completionCondition, 'AUTOMATION_SUCCEEDED');
  const back = applyKind(auto, 'MANUAL');
  assert.equal(back.automationKey, null);
  assert.equal(back.completionCondition, 'CONFIRMATION');
  assert.equal(newStep().automationKey, null);
});
