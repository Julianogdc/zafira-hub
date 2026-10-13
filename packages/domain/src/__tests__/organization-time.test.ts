import test from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_ORGANIZATION_TIMEZONE,
  currentPeriodInTimeZone,
  dateInTimeZone,
  isOverdueInTimeZone,
  isValidTimeZone,
  resolveTimeZone,
  todayInTimeZone,
} from '../index.js';

test('fuso padrão é São Paulo e fuso inválido volta ao padrão (DEC-F6-005)', () => {
  assert.strictEqual(DEFAULT_ORGANIZATION_TIMEZONE, 'America/Sao_Paulo');
  assert.strictEqual(isValidTimeZone('Europe/Lisbon'), true);
  assert.strictEqual(isValidTimeZone('Marte/Base'), false);
  assert.strictEqual(resolveTimeZone(undefined), 'America/Sao_Paulo');
  assert.strictEqual(resolveTimeZone('Marte/Base'), 'America/Sao_Paulo');
});

test('"hoje" e mês corrente seguem o fuso da organização, não o do servidor', () => {
  const instant = new Date('2026-11-01T01:30:00Z'); // 31/10 22:30 em São Paulo; 01/11 02:30 em Lisboa
  assert.strictEqual(todayInTimeZone('America/Sao_Paulo', instant), '2026-10-31');
  assert.strictEqual(todayInTimeZone('Europe/Lisbon', instant), '2026-11-01');
  assert.strictEqual(currentPeriodInTimeZone('America/Sao_Paulo', instant), '2026-10');
  assert.strictEqual(currentPeriodInTimeZone('Europe/Lisbon', instant), '2026-11');
  assert.strictEqual(dateInTimeZone('2026-11-01T01:30:00Z', 'America/Sao_Paulo'), '2026-10-31');
  assert.strictEqual(dateInTimeZone('lixo', 'America/Sao_Paulo'), null);
});

test('atraso: prazo só com data vence no fim do dia do fuso; com horário, no instante', () => {
  const instant = new Date('2026-11-01T01:30:00Z'); // 31/10 22:30 em São Paulo
  assert.strictEqual(isOverdueInTimeZone({ dueOn: '2026-10-31' }, 'America/Sao_Paulo', instant), false, 'ainda é 31/10 em SP');
  assert.strictEqual(isOverdueInTimeZone({ dueOn: '2026-10-31' }, 'Europe/Lisbon', instant), true, 'já é 01/11 em Lisboa');
  assert.strictEqual(isOverdueInTimeZone({ dueOn: '2026-10-30' }, 'America/Sao_Paulo', instant), true);
  assert.strictEqual(isOverdueInTimeZone({ dueOn: '2026-10-30', completed: true }, 'America/Sao_Paulo', instant), false);
  assert.strictEqual(isOverdueInTimeZone({ dueAt: '2026-11-01T01:00:00Z' }, 'America/Sao_Paulo', instant), true);
  assert.strictEqual(isOverdueInTimeZone({ dueAt: '2026-11-01T02:00:00Z' }, 'America/Sao_Paulo', instant), false);
  assert.strictEqual(isOverdueInTimeZone({}, 'America/Sao_Paulo', instant), false);
});
