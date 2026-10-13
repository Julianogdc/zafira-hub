import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ORGANIZATION_TIMEZONE,
  currentPeriodInTimeZone,
  isoDateToCalendarDate,
  resolveTimeZone,
  todayInTimeZone,
} from '../organization-time';

test('tela usa o fuso da organização (DEC-F6-005), padrão São Paulo', () => {
  assert.equal(DEFAULT_ORGANIZATION_TIMEZONE, 'America/Sao_Paulo');
  assert.equal(resolveTimeZone(undefined), 'America/Sao_Paulo');
  assert.equal(resolveTimeZone('Marte/Base'), 'America/Sao_Paulo');
  const instant = new Date('2026-11-01T01:30:00Z'); // 31/10 22:30 em SP
  assert.equal(todayInTimeZone('America/Sao_Paulo', instant), '2026-10-31');
  assert.equal(todayInTimeZone('Europe/Lisbon', instant), '2026-11-01');
  assert.equal(currentPeriodInTimeZone(undefined, instant), '2026-10');
  const d = isoDateToCalendarDate('2026-10-31');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 9, 31]);
});
