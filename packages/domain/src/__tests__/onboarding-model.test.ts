import test from 'node:test';
import assert from 'node:assert';
import type { OnboardingStepInput } from '@zafira/contracts';
import {
  ADMIN_DEFAULTS,
  MANAGER_DEFAULTS,
  MEMBER_DEFAULTS,
  PERMISSIONS,
  addBusinessDays,
  cloneStepsForNewVersion,
  findDependencyCycle,
  isBusinessDay,
  orderSteps,
  validateDraftIntegrity,
  validatePublishable,
  ONBOARDING_CALENDAR_AVAILABLE,
} from '../index.js';

const step = (key: string, over: Partial<OnboardingStepInput> = {}): OnboardingStepInput => ({
  stepKey: key,
  title: `Etapa ${key}`,
  description: null,
  kind: 'MANUAL',
  assigneeMode: 'NONE',
  functionId: null,
  memberId: null,
  dueBusinessDays: null,
  dueAnchor: 'RELEASED',
  evidenceKind: 'NONE',
  evidenceRequired: false,
  completionCondition: 'CONFIRMATION',
  blocksCompletion: false,
  dependsOn: [],
  ...over,
});
const ctx = { activeFunctionIds: new Set(['fn-1']), activeMemberIds: new Set(['mem-1']) };
const codes = (problems: { code: string }[]) => problems.map((p) => p.code).sort();

test('Calendar e automação disponíveis (F7-3c/F7-4a) com regras próprias, ao salvar e ao publicar', () => {
  // F7-3c (DEC-F7-014): Calendar disponivel; coerencia entre tipo e condicao e exigida
  assert.strictEqual(ONBOARDING_CALENDAR_AVAILABLE, true);
  const cal = step('a', { kind: 'CALENDAR_EVENT', completionCondition: 'CALENDAR_EVENT_LINKED' });
  assert.deepStrictEqual(codes(validateDraftIntegrity([cal])), []);
  assert.deepStrictEqual(codes(validatePublishable([cal], ctx)), []);
  const wrongCondition = step('b', { kind: 'CALENDAR_EVENT', completionCondition: 'CONFIRMATION' });
  assert.ok(codes(validatePublishable([wrongCondition], ctx)).includes('CONDITION_MISMATCH'));
  const onlyCondition = step('c', { completionCondition: 'CALENDAR_EVENT_LINKED' });
  assert.ok(codes(validatePublishable([onlyCondition], ctx)).includes('CONDITION_MISMATCH'));
  const withEvidence = step('d', { kind: 'CALENDAR_EVENT', completionCondition: 'CALENDAR_EVENT_LINKED', evidenceKind: 'LINK', evidenceRequired: true });
  assert.ok(codes(validatePublishable([withEvidence], ctx)).includes('EVIDENCE_MISMATCH'));
  // F7-4a (DEC-F7-016): automacao disponivel; exige fluxo habilitado e a condicao propria
  const auto = step('c', { kind: 'AUTOMATION', completionCondition: 'AUTOMATION_SUCCEEDED', automationKey: 'boas-vindas' } as never);
  assert.deepStrictEqual(codes(validateDraftIntegrity([auto])), []);
  const okCtx = { ...ctx, enabledAutomationKeys: new Set(['boas-vindas']) };
  assert.deepStrictEqual(codes(validatePublishable([auto], okCtx)), []);
  const noFlow = step('d', { kind: 'AUTOMATION', completionCondition: 'AUTOMATION_SUCCEEDED' } as never);
  assert.ok(codes(validatePublishable([noFlow], okCtx)).includes('AUTOMATION_KEY_REQUIRED'));
  const disabled = step('e', { kind: 'AUTOMATION', completionCondition: 'AUTOMATION_SUCCEEDED', automationKey: 'outro' } as never);
  assert.ok(codes(validatePublishable([disabled], okCtx)).includes('AUTOMATION_FLOW_INVALID'));
  const wrongCond = step('f', { kind: 'AUTOMATION', completionCondition: 'CONFIRMATION', automationKey: 'boas-vindas' } as never);
  assert.ok(codes(validatePublishable([wrongCond], okCtx)).includes('CONDITION_MISMATCH'));
  const condOnly = step('g', { completionCondition: 'AUTOMATION_SUCCEEDED' } as never);
  assert.ok(codes(validatePublishable([condOnly], okCtx)).includes('CONDITION_MISMATCH'));
});

test('Integridade do rascunho: chave repetida, dependência inexistente, auto-dependência e repetida', () => {
  assert.deepStrictEqual(codes(validateDraftIntegrity([step('a'), step('a')])), ['DUPLICATE_STEP_KEY']);
  assert.deepStrictEqual(codes(validateDraftIntegrity([step('a', { dependsOn: ['zzz'] })])), ['UNKNOWN_DEPENDENCY']);
  assert.deepStrictEqual(codes(validateDraftIntegrity([step('a', { dependsOn: ['a'] })])), ['SELF_DEPENDENCY']);
  assert.deepStrictEqual(
    codes(validateDraftIntegrity([step('a'), step('b', { dependsOn: ['a', 'a'] })])),
    ['DUPLICATE_DEPENDENCY']
  );
  // rascunho incompleto é permitido: título vazio e ciclo não bloqueiam o salvamento
  assert.deepStrictEqual(
    validateDraftIntegrity([step('a', { title: '', dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })]),
    []
  );
});

test('Ciclo de dependências é detectado e descrito; grafo válido não tem ciclo', () => {
  assert.strictEqual(findDependencyCycle([step('a'), step('b', { dependsOn: ['a'] }), step('c', { dependsOn: ['a', 'b'] })]), null);
  const cycle = findDependencyCycle([
    step('a', { dependsOn: ['c'] }),
    step('b', { dependsOn: ['a'] }),
    step('c', { dependsOn: ['b'] }),
  ]);
  assert.ok(cycle && cycle.length === 4 && cycle[0] === cycle[3]);
  const problems = validatePublishable(
    [step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })],
    ctx
  );
  assert.ok(codes(problems).includes('DEPENDENCY_CYCLE'));
});

test('Ordem topológica é estável pela posição e respeita dependências', () => {
  const steps = [step('c', { dependsOn: ['a'] }), step('a'), step('b'), step('d', { dependsOn: ['c', 'b'] })];
  // prontas após 'a': c (posição 0) e b (posição 2) → c primeiro
  assert.deepStrictEqual(orderSteps(steps), ['a', 'c', 'b', 'd']);
});

test('Publicação: modelo vazio e etapa sem título', () => {
  assert.deepStrictEqual(codes(validatePublishable([], ctx)), ['STEP_REQUIRED']);
  assert.ok(codes(validatePublishable([step('a', { title: '   ' })], ctx)).includes('TITLE_REQUIRED'));
  assert.deepStrictEqual(validatePublishable([step('a')], ctx), []);
});

test('Responsável: função e pessoa devem existir, estar ativas e ser coerentes com o modo', () => {
  assert.deepStrictEqual(codes(validatePublishable([step('a', { assigneeMode: 'FUNCTION' })], ctx)), ['ASSIGNEE_FUNCTION_REQUIRED']);
  assert.deepStrictEqual(
    codes(validatePublishable([step('a', { assigneeMode: 'FUNCTION', functionId: 'fn-x' })], ctx)),
    ['ASSIGNEE_FUNCTION_INVALID']
  );
  assert.deepStrictEqual(validatePublishable([step('a', { assigneeMode: 'FUNCTION', functionId: 'fn-1' })], ctx), []);
  assert.deepStrictEqual(codes(validatePublishable([step('a', { assigneeMode: 'MEMBER' })], ctx)), ['ASSIGNEE_MEMBER_REQUIRED']);
  assert.deepStrictEqual(
    codes(validatePublishable([step('a', { assigneeMode: 'MEMBER', memberId: 'mem-x' })], ctx)),
    ['ASSIGNEE_MEMBER_INVALID']
  );
  assert.deepStrictEqual(validatePublishable([step('a', { assigneeMode: 'MEMBER', memberId: 'mem-1' })], ctx), []);
  assert.deepStrictEqual(
    codes(validatePublishable([step('a', { assigneeMode: 'NONE', functionId: 'fn-1' })], ctx)),
    ['ASSIGNEE_EXTRA_FIELD']
  );
  assert.deepStrictEqual(
    codes(validatePublishable([step('a', { assigneeMode: 'MEMBER', memberId: 'mem-1', functionId: 'fn-1' })], ctx)),
    ['ASSIGNEE_EXTRA_FIELD']
  );
});

test('Catálogo fechado (B1): coerência entre tipo, condição e evidência', () => {
  // Asana: exige ASANA_PROJECT_LINKED e só existe nesse tipo
  assert.deepStrictEqual(
    validatePublishable([step('a', { kind: 'CONFIRM_ASANA_PROJECT', completionCondition: 'ASANA_PROJECT_LINKED' })], ctx),
    []
  );
  assert.deepStrictEqual(codes(validatePublishable([step('a', { kind: 'CONFIRM_ASANA_PROJECT' })], ctx)), ['CONDITION_MISMATCH']);
  assert.deepStrictEqual(codes(validatePublishable([step('a', { completionCondition: 'ASANA_PROJECT_LINKED' })], ctx)), ['CONDITION_MISMATCH']);
  // evidência fornecida exige tipo + obrigatória
  assert.deepStrictEqual(
    validatePublishable([step('a', { completionCondition: 'EVIDENCE_PROVIDED', evidenceKind: 'LINK', evidenceRequired: true })], ctx),
    []
  );
  assert.deepStrictEqual(codes(validatePublishable([step('a', { completionCondition: 'EVIDENCE_PROVIDED' })], ctx)), ['EVIDENCE_MISMATCH']);
  assert.ok(codes(validatePublishable([step('a', { evidenceRequired: true, evidenceKind: 'NOTE' })], ctx)).includes('EVIDENCE_MISMATCH'));
});

test('Nova versão preserva stepKey e não compartilha referências', () => {
  const original = [step('a'), step('b', { dependsOn: ['a'] })];
  const copy = cloneStepsForNewVersion(original);
  assert.deepStrictEqual(copy.map((s) => s.stepKey), ['a', 'b']);
  assert.deepStrictEqual(copy[1].dependsOn, ['a']);
  copy[1].dependsOn.push('x');
  assert.deepStrictEqual(original[1].dependsOn, ['a'], 'a cópia não altera a versão original');
});

test('Dias úteis: fins de semana, virada de mês, ano bissexto e feriados', () => {
  // 2026-10-09 é sexta-feira
  assert.strictEqual(isBusinessDay('2026-10-09'), true);
  assert.strictEqual(isBusinessDay('2026-10-10'), false);
  assert.strictEqual(addBusinessDays('2026-10-09', 0), '2026-10-09');
  assert.strictEqual(addBusinessDays('2026-10-10', 0), '2026-10-12', 'sábado + 0 → próxima segunda');
  assert.strictEqual(addBusinessDays('2026-10-09', 1), '2026-10-12');
  assert.strictEqual(addBusinessDays('2026-10-09', 5), '2026-10-16');
  assert.strictEqual(addBusinessDays('2026-10-30', 1), '2026-11-02', 'virada de mês (sexta → segunda)');
  assert.strictEqual(addBusinessDays('2028-02-28', 1), '2028-02-29', 'bissexto');
  assert.strictEqual(addBusinessDays('2026-10-09', 1, new Set(['2026-10-12'])), '2026-10-13', 'feriado na segunda');
  assert.throws(() => addBusinessDays('2026-02-30', 1));
  assert.throws(() => addBusinessDays('2026-10-09', -1));
});

test('RBAC (spec §6): padrões por papel; função operacional nunca concede permissão', () => {
  const onboarding = PERMISSIONS.filter((p) => p.startsWith('onboarding.')).sort();
  assert.deepStrictEqual(onboarding, [
    'onboarding.cancel', 'onboarding.execute', 'onboarding.manage_functions', 'onboarding.manage_templates',
    'onboarding.override', 'onboarding.start', 'onboarding.view',
  ]);
  for (const p of onboarding) assert.ok(ADMIN_DEFAULTS.includes(p as never), `ADMIN ${p}`);
  assert.ok(!MANAGER_DEFAULTS.includes('onboarding.manage_templates' as never));
  assert.ok(!MANAGER_DEFAULTS.includes('onboarding.manage_functions' as never));
  for (const p of ['onboarding.view', 'onboarding.start', 'onboarding.execute', 'onboarding.override', 'onboarding.cancel']) {
    assert.ok(MANAGER_DEFAULTS.includes(p as never), `MANAGER ${p}`);
  }
  assert.deepStrictEqual(
    MEMBER_DEFAULTS.filter((p) => p.startsWith('onboarding.')).sort(),
    ['onboarding.execute', 'onboarding.view']
  );
});
