import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATION_STATUS,
  automationEventLabel,
  automationNotice,
  automationStatusText,
  flowFormProblem,
  safeExternalUrl,
  secretProblem,
  suggestFlowKey,
} from '../automation-view';
import { eventLabel } from '../onboarding-execution-view';

test('todos os estados do pedido têm rótulo e SENT nunca parece concluído (F7-4b)', () => {
  for (const s of ['PENDING', 'SENT', 'RETRYING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'DEAD'] as const) {
    assert.ok(AUTOMATION_STATUS[s].label.length > 0);
  }
  assert.notEqual(AUTOMATION_STATUS.SENT.tone, 'success');
  assert.match(AUTOMATION_STATUS.SENT.help, /Enviado não é concluído/);
  assert.equal(AUTOMATION_STATUS.SUCCEEDED.tone, 'success');
  assert.equal(automationStatusText(null).label, 'Sem pedido');
});

test('aviso de despachante desligado e de resultado aguardando desbloqueio', () => {
  const base = { flowKey: 'f', appliedAt: null };
  assert.ok(automationNotice({ ...base, status: 'PENDING', dispatcherEnabled: false }, false)?.text.includes('desligado'));
  assert.equal(automationNotice({ ...base, status: 'PENDING', dispatcherEnabled: true }, false), null);
  assert.equal(automationNotice({ ...base, status: 'SENT', dispatcherEnabled: false }, false), null);
  assert.ok(automationNotice({ ...base, status: 'SUCCEEDED', dispatcherEnabled: true }, true)?.text.includes('bloqueada'));
  assert.equal(automationNotice({ ...base, status: 'SUCCEEDED', dispatcherEnabled: true }, false), null);
});

test('rótulos de evento de automação e fallback do histórico', () => {
  assert.equal(automationEventLabel('AUTOMATION_SENT'), 'Automação enviada ao n8n');
  assert.equal(eventLabel('AUTOMATION_TIMED_OUT'), 'Automação sem resultado no prazo');
  assert.equal(automationEventLabel('OUTRO'), null);
});

test('referência externa só vira link em https', () => {
  assert.equal(safeExternalUrl('https://n8n.example/execution/1'), 'https://n8n.example/execution/1');
  assert.equal(safeExternalUrl('http://n8n.example/x'), null);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('texto'), null);
});

test('formulário de fluxo e segredo: validações locais', () => {
  assert.equal(suggestFlowKey('Boas-vindas ao Cliente!'), 'boas-vindas-ao-cliente');
  assert.ok(flowFormProblem({ key: 'ok', name: '', webhookUrl: 'https://x' }, true));
  assert.ok(flowFormProblem({ key: 'Inválido', name: 'n', webhookUrl: 'https://x' }, true));
  assert.ok(flowFormProblem({ key: 'ok', name: 'n', webhookUrl: 'não é url' }, true));
  assert.equal(flowFormProblem({ key: 'ok', name: 'n', webhookUrl: 'https://n8n.example/w' }, true), null);
  assert.equal(flowFormProblem({ key: 'ok', name: 'n', webhookUrl: '' }, false), null);
  assert.ok(secretProblem('curto'));
  assert.equal(secretProblem('x'.repeat(32)), null);
});
