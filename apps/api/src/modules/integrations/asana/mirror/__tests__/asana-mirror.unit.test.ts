import test from 'node:test';
import assert from 'node:assert';
import {
  KnownTask,
  MirrorTask,
  computeProjectCounts,
  diffMirror,
  isTaskOverdue,
  normalizeAsanaTask,
  retentionCutoff,
  snapshotDateFor,
} from '../asana-mirror.diff.js';
import { AsanaMirrorScheduler, msUntilNextHour } from '../asana-mirror.scheduler.js';
import { AsanaService } from '../../asana.service.js';

const task = (over: Partial<MirrorTask> = {}): MirrorTask => ({
  taskGid: 't1',
  name: 'Roteiro',
  completed: false,
  dueOn: '2026-10-20',
  dueAt: null,
  assigneeGid: 'u1',
  assigneeName: 'Ana',
  sectionGid: 's1',
  sectionName: 'Produção',
  permalinkUrl: 'https://app.asana.com/0/p/t1',
  ...over,
});
const known = (over: Partial<MirrorTask> = {}, removed = false): KnownTask => ({ ...task(over), removed });

test('normalizeAsanaTask: usa a seção do projeto espelhado e ignora tarefa sem gid', () => {
  const raw = {
    gid: 't9',
    name: 'Post',
    completed: false,
    due_on: '2026-10-01',
    assignee: { gid: 'u2', name: 'Bruno' },
    memberships: [
      { project: { gid: 'outro' }, section: { gid: 'sx', name: 'Outra seção' } },
      { project: { gid: 'p1' }, section: { gid: 's2', name: 'Revisão' } },
    ],
  };
  const t = normalizeAsanaTask(raw, 'p1');
  assert.strictEqual(t?.sectionName, 'Revisão');
  assert.strictEqual(t?.assigneeName, 'Bruno');
  assert.strictEqual(normalizeAsanaTask({ name: 'sem gid' }, 'p1'), null);
});

test('números do projeto e atraso seguem a regra de /projetos', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  assert.strictEqual(isTaskOverdue(task({ dueOn: '2026-10-10' }), now), true);
  assert.strictEqual(isTaskOverdue(task({ dueOn: '2026-10-10', completed: true }), now), false);
  assert.strictEqual(isTaskOverdue(task({ dueOn: null }), now), false);
  const counts = computeProjectCounts(
    [task({ taskGid: 'a', dueOn: '2026-10-01' }), task({ taskGid: 'b', completed: true }), task({ taskGid: 'c', dueOn: '2026-12-01' })],
    now
  );
  assert.deepStrictEqual(counts, { totalTasks: 3, completedTasks: 1, pendingTasks: 2, overdueTasks: 1 });
});

test('foto diária usa o dia de São Paulo, não o dia UTC', () => {
  // 02:00 UTC de 16/10 ainda é 15/10 em São Paulo (UTC-3)
  assert.strictEqual(snapshotDateFor(new Date('2026-10-16T02:00:00Z')), '2026-10-15');
  assert.strictEqual(snapshotDateFor(new Date('2026-10-16T15:00:00Z')), '2026-10-16');
});

test('retenção de 13 meses', () => {
  assert.strictEqual(retentionCutoff(new Date('2026-10-15T00:00:00Z')).toISOString(), '2025-09-15T00:00:00.000Z');
});

test('primeira conferência (ponto de partida): cria o espelho sem gerar histórico', () => {
  const diff = diffMirror([], [task({ taskGid: 'a' }), task({ taskGid: 'b' })], false);
  assert.strictEqual(diff.added.length, 2);
  assert.strictEqual(diff.changes.length, 0);
});

test('mudanças relevantes viram histórico; detalhes de exibição só atualizam o espelho', () => {
  const before = [
    known({ taskGid: 'done' }),
    known({ taskGid: 'due' }),
    known({ taskGid: 'who' }),
    known({ taskGid: 'sec' }),
    known({ taskGid: 'ren' }),
    known({ taskGid: 'gone' }),
    known({ taskGid: 'cosmetic' }),
    known({ taskGid: 'back' }, true),
    known({ taskGid: 'same' }),
  ];
  const now = [
    task({ taskGid: 'done', completed: true }),
    task({ taskGid: 'due', dueOn: '2026-11-01' }),
    task({ taskGid: 'who', assigneeGid: 'u2', assigneeName: 'Bruno' }),
    task({ taskGid: 'sec', sectionGid: 's2', sectionName: 'Revisão' }),
    task({ taskGid: 'ren', name: 'Roteiro v2' }),
    task({ taskGid: 'cosmetic', assigneeName: 'Ana Souza' }),
    task({ taskGid: 'back' }),
    task({ taskGid: 'new' }),
    task({ taskGid: 'same' }),
    task({ taskGid: 'same' }), // duplicata de paginação ignorada
  ];
  const diff = diffMirror(before, now, true);
  const fields = diff.changes.map((c) => `${c.taskGid}:${c.field}`).sort();
  assert.deepStrictEqual(fields, [
    'back:restored',
    'done:completed',
    'due:due',
    'gone:removed',
    'new:created',
    'ren:name',
    'sec:section',
    'who:assignee',
  ]);
  assert.deepStrictEqual(diff.removed, ['gone']);
  assert.deepStrictEqual(diff.added.map((t) => t.taskGid).sort(), ['back', 'new']);
  assert.deepStrictEqual(diff.updated.map((t) => t.taskGid).sort(), ['cosmetic', 'done', 'due', 'ren', 'sec', 'who']);
  assert.ok(!diff.updated.some((t) => t.taskGid === 'same'));
});

test('agendador: desligado por padrão — não agenda nada nem reage a avisos', () => {
  const calls: unknown[] = [];
  const fake = { syncOrganization: async (...args: unknown[]) => { calls.push(args); return { skipped: false, projects: 0, succeeded: 0, failed: 0 }; } } as any;
  const quiet = { info: () => {}, error: () => {} };
  const scheduler = new AsanaMirrorScheduler(fake, {}, quiet);
  assert.strictEqual(scheduler.start(), false);
  assert.strictEqual(scheduler.notifyProjectChanged('org-1', 'p1'), false);
  scheduler.stop();
  assert.strictEqual(calls.length, 0);
});

test('agendador ligado: avisos próximos do mesmo org viram UMA conferência só dos projetos avisados', async () => {
  const calls: any[] = [];
  const fake = { syncOrganization: async (...args: any[]) => { calls.push(args); return { skipped: false, projects: 2, succeeded: 2, failed: 0 }; } } as any;
  const quiet = { info: () => {}, error: () => {} };
  const scheduler = new AsanaMirrorScheduler(fake, { ASANA_MIRROR_SCHEDULE_ENABLED: 'true', ASANA_MIRROR_WEBHOOK_DEBOUNCE_SECONDS: '10' }, quiet);
  // DEC-F6-004: padrões de tempo real (10 s) e conferência noturna (3h); valores inválidos voltam ao padrão
  const defaults = new AsanaMirrorScheduler(fake, {}, quiet);
  assert.strictEqual(defaults.debounceMs, 10_000);
  assert.strictEqual(defaults.nightlyHour, 3);
  assert.strictEqual(new AsanaMirrorScheduler(fake, { ASANA_MIRROR_NIGHTLY_HOUR: '25', ASANA_MIRROR_WEBHOOK_DEBOUNCE_SECONDS: '1' }, quiet).nightlyHour, 3);
  assert.strictEqual(new AsanaMirrorScheduler(fake, { ASANA_MIRROR_WEBHOOK_DEBOUNCE_SECONDS: '1' }, quiet).debounceMs, 10_000);
  assert.strictEqual(scheduler.debounceMs, 10_000);

  const realSetTimeout = global.setTimeout;
  const scheduled: Array<() => void> = [];
  (global as any).setTimeout = (fn: () => void) => {
    scheduled.push(fn);
    return { unref() {} } as any;
  };
  try {
    assert.strictEqual(scheduler.notifyProjectChanged('org-1', 'p1'), true);
    assert.strictEqual(scheduler.notifyProjectChanged('org-1', 'p2'), true);
    assert.strictEqual(scheduler.notifyProjectChanged('org-1', 'p1'), true);
    assert.strictEqual(scheduled.length, 1, 'um único temporizador por organização');
    scheduled[0]();
    await new Promise((r) => realSetTimeout(r, 0));
  } finally {
    (global as any).setTimeout = realSetTimeout;
  }
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], ['org-1', 'webhook', { projectGids: ['p1', 'p2'] }]);
});

test('conferência noturna: próxima 03:00 no horário de São Paulo', () => {
  // 23:30 em São Paulo (02:30 UTC do dia seguinte) → faltam 3h30
  assert.strictEqual(msUntilNextHour(new Date('2026-10-16T02:30:00Z'), 3), 3.5 * 3600_000);
  // 03:00 em ponto → próxima é amanhã (24h)
  assert.strictEqual(msUntilNextHour(new Date('2026-10-16T06:00:00Z'), 3), 24 * 3600_000);
  // 04:00 em São Paulo → faltam 23h
  assert.strictEqual(msUntilNextHour(new Date('2026-10-16T07:00:00Z'), 3), 23 * 3600_000);
});

test('tempo real: se outra conferência estiver rodando, tenta de novo uma única vez', async () => {
  const calls: any[] = [];
  const fake = { syncOrganization: async (...args: any[]) => { calls.push(args); return { skipped: true, projects: 0, succeeded: 0, failed: 0 }; } } as any;
  const scheduler = new AsanaMirrorScheduler(fake, { ASANA_MIRROR_SCHEDULE_ENABLED: 'true' }, { info: () => {}, error: () => {} });
  const realSetTimeout = global.setTimeout;
  const queue: Array<() => void> = [];
  (global as any).setTimeout = (fn: () => void) => { queue.push(fn); return { unref() {} } as any; };
  try {
    scheduler.notifyProjectChanged('org-1', 'p1');
    queue.shift()!();
    await new Promise((r) => realSetTimeout(r, 0));
    assert.strictEqual(queue.length, 1, 'reagendou uma vez');
    queue.shift()!();
    await new Promise((r) => realSetTimeout(r, 0));
    assert.strictEqual(queue.length, 0, 'não reagenda indefinidamente');
  } finally {
    (global as any).setTimeout = realSetTimeout;
  }
  assert.strictEqual(calls.length, 2);
});

test('avisos do Asana: sem endereço público https do Hub 2.1, recusa (nunca usa o endereço do Hub 2.0)', () => {
  const saved = { w: process.env.WEBHOOK_BASE_URL, a: process.env.API_BASE_URL };
  try {
    delete process.env.WEBHOOK_BASE_URL;
    delete process.env.API_BASE_URL;
    const service = new AsanaService();
    assert.throws(() => service.getWebhookBaseUrl(), /não configurado/);
    process.env.WEBHOOK_BASE_URL = 'http://inseguro.example';
    assert.throws(() => service.getWebhookBaseUrl(), /não configurado/);
    process.env.WEBHOOK_BASE_URL = 'https://hub21.example/';
    assert.strictEqual(service.getWebhookBaseUrl(), 'https://hub21.example');
  } finally {
    if (saved.w === undefined) delete process.env.WEBHOOK_BASE_URL; else process.env.WEBHOOK_BASE_URL = saved.w;
    if (saved.a === undefined) delete process.env.API_BASE_URL; else process.env.API_BASE_URL = saved.a;
  }
});

test('Asana simulado (Browser Gate F6): ASANA_API_BASE_URL só vale fora de produção', () => {
  const saved = { env: process.env.NODE_ENV, url: process.env.ASANA_API_BASE_URL };
  try {
    process.env.ASANA_API_BASE_URL = 'http://asana-mock:8080/api/1.0/';
    process.env.NODE_ENV = 'test';
    assert.strictEqual((new AsanaService() as any).asanaBaseUrl, 'http://asana-mock:8080/api/1.0');
    process.env.NODE_ENV = 'production';
    assert.strictEqual((new AsanaService() as any).asanaBaseUrl, 'https://app.asana.com/api/1.0');
  } finally {
    process.env.NODE_ENV = saved.env;
    if (saved.url === undefined) delete process.env.ASANA_API_BASE_URL; else process.env.ASANA_API_BASE_URL = saved.url;
  }
});
