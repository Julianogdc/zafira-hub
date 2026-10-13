import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALLBACK_WINDOW_MS,
  canResend,
  classifySendStatus,
  decideCallback,
  isTimedOut,
  isTimestampFresh,
  nextAfterSend,
  retryDelayMs,
} from '../automation/automation-model.js';
import { allowedStepActions } from '../onboarding/execution-model.js';

test('classificacao do envio: aceito, repetir ou permanente', () => {
  assert.equal(classifySendStatus(200), 'OK');
  assert.equal(classifySendStatus(202), 'OK');
  for (const s of [null, 408, 425, 429, 500, 502, 503]) assert.equal(classifySendStatus(s), 'RETRY', String(s));
  for (const s of [301, 302, 400, 401, 403, 404, 422]) assert.equal(classifySendStatus(s), 'PERMANENT', String(s));
});

test('backoff 1, 5, 15, 60, 360 min; apos o limite vira DEAD; permanente vira FAILED', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n) / 60_000), [1, 5, 15, 60, 360, 360]);
  const now = new Date('2026-10-12T12:00:00Z');
  assert.deepEqual(nextAfterSend({ outcome: 'OK', attemptsDone: 1, maxAttempts: 6, now }), { status: 'SENT', nextAttemptAt: null });
  assert.deepEqual(nextAfterSend({ outcome: 'PERMANENT', attemptsDone: 1, maxAttempts: 6, now }), { status: 'FAILED', nextAttemptAt: null });
  const r = nextAfterSend({ outcome: 'RETRY', attemptsDone: 2, maxAttempts: 6, now });
  assert.equal(r.status, 'RETRYING');
  assert.equal(r.nextAttemptAt?.toISOString(), '2026-10-12T12:05:00.000Z');
  assert.deepEqual(nextAfterSend({ outcome: 'RETRY', attemptsDone: 6, maxAttempts: 6, now }), { status: 'DEAD', nextAttemptAt: null });
});

test('janela de timestamp do callback (+-5 min) e tempo limite', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const ts = now.getTime() / 1000;
  assert.equal(isTimestampFresh(ts, now), true);
  assert.equal(isTimestampFresh(ts - CALLBACK_WINDOW_MS / 1000 - 1, now), false);
  assert.equal(isTimestampFresh(ts + CALLBACK_WINDOW_MS / 1000 + 1, now), false);
  assert.equal(isTimestampFresh(Number.NaN, now), false);
  assert.equal(isTimedOut(new Date('2026-10-11T11:00:00Z'), now, 24), true);
  assert.equal(isTimedOut(new Date('2026-10-12T00:00:00Z'), now, 24), false);
  assert.equal(isTimedOut(null, now, 24), false);
});

test('callback: so aplica pedido SENT, geracao vigente, execucao ativa e etapa aberta', () => {
  const ok = { outboxStatus: 'SENT' as const, generation: 2, latestGeneration: 2, executionActive: true, stepOpen: true };
  assert.deepEqual(decideCallback(ok), { apply: true });
  assert.deepEqual(decideCallback({ ...ok, outboxStatus: 'SUCCEEDED' }), { apply: false, reason: 'DUPLICATE' });
  for (const s of ['FAILED', 'TIMED_OUT', 'DEAD'] as const) {
    assert.deepEqual(decideCallback({ ...ok, outboxStatus: s }), { apply: false, reason: 'ALREADY_FINAL' });
  }
  for (const s of ['PENDING', 'RETRYING'] as const) {
    assert.deepEqual(decideCallback({ ...ok, outboxStatus: s }), { apply: false, reason: 'NOT_SENT' });
  }
  assert.deepEqual(decideCallback({ ...ok, latestGeneration: 3 }), { apply: false, reason: 'SUPERSEDED' });
  assert.deepEqual(decideCallback({ ...ok, executionActive: false }), { apply: false, reason: 'EXECUTION_CLOSED' });
  assert.deepEqual(decideCallback({ ...ok, stepOpen: false }), { apply: false, reason: 'STEP_NOT_OPEN' });
});

test('reenvio so de pedido final sem sucesso; etapa automatica nao oferece concluir', () => {
  assert.equal(canResend('FAILED'), true);
  assert.equal(canResend('DEAD'), true);
  assert.equal(canResend('TIMED_OUT'), true);
  for (const s of ['PENDING', 'SENT', 'RETRYING', 'SUCCEEDED'] as const) assert.equal(canResend(s), false, s);
  const run = { stepKey: 'a', status: 'READY' as const, blocked: false };
  assert.deepEqual(allowedStepActions(run, { automatic: true }), ['block', 'skip', 'reassign']);
  assert.deepEqual(allowedStepActions({ ...run, blocked: true }, { automatic: true }), ['unblock', 'skip', 'reassign']);
  assert.ok(allowedStepActions(run).includes('complete'));
});
