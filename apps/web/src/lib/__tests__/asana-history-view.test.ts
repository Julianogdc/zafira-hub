import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chartPoints,
  describeAsanaChange,
  describeFreshness,
  formatDayMonth,
  periodStartFor,
} from '../asana-history-view';

test('descrição das mudanças das tarefas (F6-IMP.8)', () => {
  assert.equal(describeAsanaChange({ field: 'completed', before: false, after: true, taskName: 'x' }), 'Marcada como concluída');
  assert.equal(describeAsanaChange({ field: 'completed', before: true, after: false, taskName: 'x' }), 'Reaberta (deixou de estar concluída)');
  assert.equal(
    describeAsanaChange({ field: 'due', before: { dueOn: '2026-10-20' }, after: { dueOn: '2026-10-30' }, taskName: 'x' }),
    'Prazo: 20/10 → 30/10'
  );
  assert.equal(
    describeAsanaChange({ field: 'due', before: { dueOn: null }, after: { dueOn: '2026-10-30' }, taskName: 'x' }),
    'Prazo: sem data → 30/10'
  );
  assert.equal(
    describeAsanaChange({ field: 'assignee', before: { name: 'Ana' }, after: { name: null }, taskName: 'x' }),
    'Responsável: Ana → ninguém'
  );
  assert.equal(
    describeAsanaChange({ field: 'section', before: { name: 'Produção' }, after: { name: 'Revisão' }, taskName: 'x' }),
    'Seção: Produção → Revisão'
  );
  assert.equal(describeAsanaChange({ field: 'name', before: 'Antigo', after: 'Novo', taskName: 'Novo' }), 'Renomeada (antes: "Antigo")');
  assert.match(describeAsanaChange({ field: 'removed', before: null, after: null, taskName: 'x' }), /saiu do projeto/);
  assert.equal(formatDayMonth('lixo'), 'sem data');
});

test('frescor: nunca conferido, ok e falha mostrando a última conferência boa', () => {
  assert.equal(
    describeFreshness({ lastSyncStatus: 'NEVER', lastSyncedAt: null, lastAttemptAt: null, lastSyncError: null }).tone,
    'never'
  );
  assert.equal(
    describeFreshness({ lastSyncStatus: 'SUCCESS', lastSyncedAt: '2026-10-15T15:00:00Z', lastAttemptAt: '2026-10-15T15:00:00Z', lastSyncError: null }).tone,
    'ok'
  );
  const failed = describeFreshness({
    lastSyncStatus: 'FAILED',
    lastSyncedAt: '2026-10-15T15:00:00Z',
    lastAttemptAt: '2026-10-16T15:00:00Z',
    lastSyncError: 'Asana fora do ar',
  });
  assert.equal(failed.tone, 'error');
  assert.match(failed.detail ?? '', /última conferência boa/);
  assert.match(failed.detail ?? '', /Asana fora do ar/);
});

test('gráfico: dias sem foto ficam sem ponto (ausência não vira zero)', () => {
  const snaps = [
    { date: '2026-10-01', totalTasks: 5, completedTasks: 1, pendingTasks: 4, overdueTasks: 2, capturedAt: '' },
    { date: '2026-10-03', totalTasks: 5, completedTasks: 2, pendingTasks: 3, overdueTasks: 0, capturedAt: '' },
    { date: '2026-09-01', totalTasks: 9, completedTasks: 0, pendingTasks: 9, overdueTasks: 9, capturedAt: '' }, // fora da janela
  ];
  const points = chartPoints(snaps, 'overdueTasks', '2026-10-01', 3);
  assert.deepEqual(points, [
    { x: 0, y: 2, date: '2026-10-01' },
    { x: 1, y: 0, date: '2026-10-03' },
  ]);
  assert.equal(periodStartFor(30, new Date(2026, 9, 30)), '2026-10-01');
});
