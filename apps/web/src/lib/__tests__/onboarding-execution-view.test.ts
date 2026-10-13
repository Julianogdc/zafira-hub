import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assigneeIssueMessage,
  earlyCompletionPreview,
  eventLabel,
  formatDay,
  isHighlightedEvent,
  isNavItemVisible,
  stepBadges,
} from '../onboarding-execution-view';

test('selos: bloqueada, atrasada e sem responsavel aparecem junto da situacao', () => {
  const labels = (s: Parameters<typeof stepBadges>[0]) => stepBadges(s).map((b) => b.label);
  assert.deepEqual(labels({ status: 'READY', blocked: false, late: false, assigneeIssue: null }), ['Pronta para iniciar']);
  assert.deepEqual(labels({ status: 'READY', blocked: true, late: true, assigneeIssue: 'UNASSIGNED' }), [
    'Pronta para iniciar',
    'Bloqueada',
    'Atrasada',
    'Sem responsável',
  ]);
  assert.deepEqual(labels({ status: 'DONE', blocked: false, late: false, assigneeIssue: null }), ['Concluída']);
  // etapa encerrada nunca aparece como bloqueada
  assert.deepEqual(labels({ status: 'DONE', blocked: true, late: false, assigneeIssue: null }), ['Concluída']);
  assert.deepEqual(labels({ status: 'SKIPPED', blocked: false, late: false, assigneeIssue: null }), ['Dispensada']);
  assert.ok(labels({ status: 'READY', blocked: false, late: false, assigneeIssue: 'INACTIVE_OR_OUT_OF_SCOPE' }).includes('Responsável indisponível'));
});

test('mensagens de responsavel elegivel sao compreensiveis', () => {
  assert.match(assigneeIssueMessage('UNASSIGNED') ?? '', /não tem responsável elegível/);
  assert.match(assigneeIssueMessage('INACTIVE_OR_OUT_OF_SCOPE') ?? '', /Reatribua/);
  assert.equal(assigneeIssueMessage(null), null);
});

test('historico: rotulos em portugues e destaque da dispensa de etapa bloqueante (P4)', () => {
  assert.equal(eventLabel('STEP_SKIPPED'), 'Etapa dispensada');
  assert.equal(eventLabel('ALGO_NOVO'), 'ALGO_NOVO');
  assert.equal(isHighlightedEvent({ type: 'STEP_SKIPPED', after: { highlight: 'BLOCKING_STEP_SKIPPED' } }), true);
  assert.equal(isHighlightedEvent({ type: 'STEP_SKIPPED', after: { highlight: null } }), false);
  assert.equal(isHighlightedEvent({ type: 'STEP_COMPLETED', after: {} }), false);
});

test('data de calendario sem deslocamento de fuso', () => {
  assert.equal(formatDay('2026-10-12'), '12/10/2026');
  assert.equal(formatDay(null), '');
});

test('previa da conclusao antecipada (P3)', () => {
  const steps = [
    { stepKey: 'a', title: 'A', status: 'DONE' as const, blocksCompletion: true },
    { stepKey: 'b', title: 'B', status: 'READY' as const, blocksCompletion: false },
    { stepKey: 'c', title: 'C', status: 'WAITING' as const, blocksCompletion: true },
  ];
  const p = earlyCompletionPreview(steps);
  assert.deepEqual(p.blockingOpen.map((s) => s.stepKey), ['c']);
  assert.deepEqual(p.toSkip.map((s) => s.stepKey), ['b']);
});

test('menu: item de onboarding exige onboarding.view; demais itens seguem a regra anterior', () => {
  assert.equal(isNavItemVisible({ requires: 'onboarding.view' }, { view: false }), false);
  assert.equal(isNavItemVisible({ requires: 'onboarding.view' }, { view: true }), true);
  assert.equal(isNavItemVisible({}, { view: false }), true);
  // agenda: exige calendar.view (negacao por padrao)
  assert.equal(isNavItemVisible({ requires: 'calendar.view' }, { view: true }), false);
  assert.equal(isNavItemVisible({ requires: 'calendar.view' }, { view: false, calendarView: true }), true);
});

test('condicao do Calendar: atendida, pendente e indisponivel com mensagens compreensiveis (F7-3c)', async () => {
  const { calendarConditionText } = await import('../onboarding-execution-view');
  const met = calendarConditionText({ state: 'MET', reason: null });
  assert.equal(met.tone, 'success');
  assert.match(met.message, /vínculo sozinho não conclui/);
  const pending = calendarConditionText({ state: 'PENDING', reason: 'NO_LINKED_EVENT' });
  assert.equal(pending.tone, 'warning');
  assert.match(pending.message, /Vincule um evento na Agenda/);
  const revoked = calendarConditionText({ state: 'UNAVAILABLE', reason: 'CONNECTION_UNAVAILABLE' });
  assert.equal(revoked.tone, 'danger');
  assert.match(revoked.message, /revogada ou desconectada/);
  assert.match(calendarConditionText({ state: 'UNAVAILABLE', reason: 'NO_MONITORED_CALENDAR' }).message, /Nenhum calendário está monitorado/);
});

test('item de menu de conteudo exige content.view (F8-1)', () => {
  assert.equal(isNavItemVisible({ requires: 'content.view' }, { view: true }), false);
  assert.equal(isNavItemVisible({ requires: 'content.view' }, { view: false, contentView: true }), true);
});
