import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientAsanaTask } from '../../services/asana';
import {
  DEFAULT_TASK_FILTERS,
  NO_SECTION,
  addDaysToIsoDate,
  buildCalendarMonth,
  countTasks,
  filterTasks,
  formatDueDate,
  getAsanaTaskLink,
  getCalendarMonthTitle,
  getTaskDueDate,
  groupTasks,
  hasActiveFilters,
  hasTasksWithoutSection,
  listAssignees,
  listSections,
  safeExternalUrl,
  MONTH_NAMES_PTBR,
  WEEKDAY_SHORT_PTBR,
  type TaskFilters,
} from '../asana-task-view';

const TODAY = '2026-10-10';

function task(overrides: Partial<ClientAsanaTask>): ClientAsanaTask {
  return {
    gid: 'g1',
    name: 'Tarefa',
    completed: false,
    dueOn: null,
    dueAt: null,
    isOverdue: false,
    projectGid: 'p1',
    projectName: 'Projeto 1',
    ...overrides,
  };
}

const withFilters = (patch: Partial<TaskFilters>): TaskFilters => ({ ...DEFAULT_TASK_FILTERS, ...patch });

const sample: ClientAsanaTask[] = [
  task({ gid: 'a', name: 'Roteiro do Reels', dueOn: '2026-10-05', isOverdue: true, sectionName: 'Produção', assignee: { gid: 'u1', name: 'Ana Souza' } }),
  task({ gid: 'b', name: 'Arte do feed', dueOn: '2026-10-10', sectionName: 'Produção', assignee: { gid: 'u2', name: 'Bruno Lima' } }),
  task({ gid: 'c', name: 'Relatório mensal', dueOn: '2026-10-14', sectionName: 'Revisão' }),
  task({ gid: 'd', name: 'Planejamento', dueOn: '2026-10-30', sectionName: 'Revisão', assignee: { gid: 'u1', name: 'Ana Souza' } }),
  task({ gid: 'e', name: 'Briefing', completed: true, dueOn: '2026-10-01', sectionName: 'Concluídas', assignee: { gid: 'u2', name: 'Bruno Lima' } }),
  task({ gid: 'f', name: 'Ideia solta', projectGid: 'p2', projectName: 'Projeto 2' }),
];

const ids = (list: ClientAsanaTask[]) => list.map((t) => t.gid);

test('addDaysToIsoDate soma dias atravessando mês e ano sem depender de fuso', () => {
  assert.equal(addDaysToIsoDate('2026-10-10', 7), '2026-10-17');
  assert.equal(addDaysToIsoDate('2026-10-28', 7), '2026-11-04');
  assert.equal(addDaysToIsoDate('2026-12-30', 3), '2027-01-02');
});

test('getTaskDueDate: dueOn tem prioridade, valores inválidos viram null', () => {
  assert.equal(getTaskDueDate({ dueOn: '2026-10-10', dueAt: null }), '2026-10-10');
  assert.equal(getTaskDueDate({ dueOn: '2026-10-10T12:00:00Z', dueAt: null }), '2026-10-10');
  assert.equal(getTaskDueDate({ dueOn: null, dueAt: null }), null);
  assert.equal(getTaskDueDate({ dueOn: 'amanhã', dueAt: null }), null);
  assert.equal(getTaskDueDate({ dueOn: null, dueAt: 'nao-e-data' }), null);
  assert.match(getTaskDueDate({ dueOn: null, dueAt: '2026-10-10T15:00:00Z' }) || '', /^\d{4}-\d{2}-\d{2}$/);
});

test('formatDueDate usa DD/MM/AAAA e "-" sem prazo', () => {
  assert.equal(formatDueDate({ dueOn: '2026-10-05', dueAt: null }), '05/10/2026');
  assert.equal(formatDueDate({ dueOn: null, dueAt: null }), '-');
});

test('sem filtros devolve todas as tarefas, na mesma ordem', () => {
  assert.deepEqual(ids(filterTasks(sample, DEFAULT_TASK_FILTERS, TODAY)), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(hasActiveFilters(DEFAULT_TASK_FILTERS), false);
});

test('filtro de situação: pendentes, atrasadas e concluídas são mutuamente exclusivos', () => {
  assert.deepEqual(ids(filterTasks(sample, withFilters({ status: 'overdue' }), TODAY)), ['a']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ status: 'completed' }), TODAY)), ['e']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ status: 'pending' }), TODAY)), ['b', 'c', 'd', 'f']);
});

test('filtro de prazo: hoje, próximos 7 dias, atrasadas e sem prazo', () => {
  assert.deepEqual(ids(filterTasks(sample, withFilters({ due: 'today' }), TODAY)), ['b']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ due: 'next7' }), TODAY)), ['b', 'c']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ due: 'overdue' }), TODAY)), ['a']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ due: 'none' }), TODAY)), ['f']);
});

test('tarefa concluída nunca aparece em "hoje" nem em "próximos 7 dias", mesmo com prazo na janela', () => {
  const done = task({ gid: 'x', completed: true, dueOn: '2026-10-12' });
  assert.deepEqual(filterTasks([done], withFilters({ due: 'next7' }), TODAY), []);
  assert.deepEqual(filterTasks([done], withFilters({ due: 'today' }), TODAY), []);
});

test('limite da janela de 7 dias é inclusivo no dia +7 e exclui o dia +8', () => {
  const edge = task({ gid: 'e7', dueOn: '2026-10-17' });
  const beyond = task({ gid: 'e8', dueOn: '2026-10-18' });
  assert.deepEqual(ids(filterTasks([edge, beyond], withFilters({ due: 'next7' }), TODAY)), ['e7']);
});

test('filtro de responsável: específico e sem responsável', () => {
  assert.deepEqual(ids(filterTasks(sample, withFilters({ assignee: 'u1' }), TODAY)), ['a', 'd']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ assignee: 'unassigned' }), TODAY)), ['c', 'f']);
});

test('filtro de seção: por nome e "sem seção"', () => {
  assert.deepEqual(ids(filterTasks(sample, withFilters({ section: 'Revisão' }), TODAY)), ['c', 'd']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ section: NO_SECTION }), TODAY)), ['f']);
});

test('filtro de projeto isola tarefas de outros projetos', () => {
  assert.deepEqual(ids(filterTasks(sample, withFilters({ projectGid: 'p2' }), TODAY)), ['f']);
});

test('busca ignora maiúsculas e acentos e procura em nome, seção, responsável e projeto', () => {
  assert.deepEqual(ids(filterTasks(sample, withFilters({ search: 'relatorio' }), TODAY)), ['c']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ search: 'REVISAO' }), TODAY)), ['c', 'd']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ search: 'bruno' }), TODAY)), ['b', 'e']);
  assert.deepEqual(ids(filterTasks(sample, withFilters({ search: 'projeto 2' }), TODAY)), ['f']);
  assert.deepEqual(filterTasks(sample, withFilters({ search: 'inexistente' }), TODAY), []);
});

test('filtros combinam por interseção', () => {
  const result = filterTasks(sample, withFilters({ assignee: 'u1', due: 'overdue', section: 'Produção' }), TODAY);
  assert.deepEqual(ids(result), ['a']);
  assert.equal(hasActiveFilters(withFilters({ due: 'today' })), true);
});

test('listas auxiliares: seções, responsáveis e contadores', () => {
  assert.deepEqual(listSections(sample, 'all'), ['Concluídas', 'Produção', 'Revisão']);
  assert.deepEqual(listSections(sample, 'p2'), []);
  assert.equal(hasTasksWithoutSection(sample, 'all'), true);
  assert.equal(hasTasksWithoutSection(sample, 'p1'), false);
  assert.deepEqual(listAssignees(sample), [
    { gid: 'u1', name: 'Ana Souza' },
    { gid: 'u2', name: 'Bruno Lima' },
  ]);
  assert.deepEqual(countTasks(sample), { total: 6, completed: 1, overdue: 1, pending: 4 });
});

test('safeExternalUrl aceita https e rejeita esquemas perigosos e valores malformados', () => {
  assert.equal(safeExternalUrl('https://app.asana.com/0/1/2'), 'https://app.asana.com/0/1/2');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,<script>1</script>'), null);
  assert.equal(safeExternalUrl('http://app.asana.com/0/1/2'), null);
  assert.equal(safeExternalUrl('//app.asana.com/0/1/2'), null);
  assert.equal(safeExternalUrl('não é url'), null);
  assert.equal(safeExternalUrl(null), null);
  assert.equal(safeExternalUrl(''), null);
});

test('getAsanaTaskLink só aceita hosts do Asana, inclusive contra subdomínios enganosos', () => {
  assert.equal(
    getAsanaTaskLink({ permalinkUrl: 'https://app.asana.com/0/123/456' }),
    'https://app.asana.com/0/123/456'
  );
  assert.equal(getAsanaTaskLink({ permalinkUrl: 'https://evil.example.com/asana.com' }), null);
  assert.equal(getAsanaTaskLink({ permalinkUrl: 'https://asana.com.evil.example/0/1' }), null);
  assert.equal(getAsanaTaskLink({ permalinkUrl: 'https://notasana.com/0/1' }), null);
  assert.equal(getAsanaTaskLink({ permalinkUrl: 'javascript:alert(1)' }), null);
  assert.equal(getAsanaTaskLink({ permalinkUrl: null }), null);
});

test('quadro por situação: três colunas fixas, mesmo vazias, com exclusividade entre elas', () => {
  const columns = groupTasks(sample, 'status');
  assert.deepEqual(columns.map((c) => c.key), ['overdue', 'pending', 'completed']);
  assert.deepEqual(ids(columns[0].tasks), ['a']);
  assert.deepEqual(ids(columns[1].tasks), ['b', 'c', 'd', 'f']);
  assert.deepEqual(ids(columns[2].tasks), ['e']);

  const empty = groupTasks([], 'status');
  assert.equal(empty.length, 3);
  assert.ok(empty.every((c) => c.tasks.length === 0));
});

test('quadro por seção: ordem do Asana quando conhecida, "Sem seção" por último', () => {
  const columns = groupTasks(sample, 'section', { sectionOrder: ['Planejamento', 'Produção', 'Revisão', 'Concluídas'] });
  assert.deepEqual(columns.map((c) => c.title), ['Produção', 'Revisão', 'Concluídas', 'Sem seção']);
  assert.deepEqual(ids(columns[0].tasks), ['a', 'b']);
  assert.deepEqual(ids(columns[3].tasks), ['f']);
});

test('quadro por seção sem ordem conhecida cai para ordem alfabética, "Sem seção" por último', () => {
  const columns = groupTasks(sample, 'section');
  assert.deepEqual(columns.map((c) => c.title), ['Concluídas', 'Produção', 'Revisão', 'Sem seção']);
});

test('quadro por seção coloca seções fora da ordem conhecida depois das conhecidas', () => {
  const columns = groupTasks(sample, 'section', { sectionOrder: ['Revisão'] });
  assert.deepEqual(columns.map((c) => c.title), ['Revisão', 'Concluídas', 'Produção', 'Sem seção']);
});

test('quadro por projeto segue a ordem dos projetos informados e omite colunas vazias', () => {
  const columns = groupTasks(sample, 'project', {
    projects: [
      { projectGid: 'p2', projectName: 'Projeto 2' },
      { projectGid: 'p1', projectName: 'Projeto 1' },
      { projectGid: 'p3', projectName: 'Projeto 3' },
    ],
  });
  assert.deepEqual(columns.map((c) => c.key), ['p2', 'p1']);
  assert.deepEqual(ids(columns[0].tasks), ['f']);
  assert.equal(columns[1].tasks.length, 5);
});

test('quadro por responsável: alfabético, "Sem responsável" por último, tarefas não se repetem', () => {
  const columns = groupTasks(sample, 'assignee');
  assert.deepEqual(columns.map((c) => c.title), ['Ana Souza', 'Bruno Lima', 'Sem responsável']);
  assert.deepEqual(ids(columns[0].tasks), ['a', 'd']);
  assert.deepEqual(ids(columns[2].tasks), ['c', 'f']);
  const all = columns.flatMap((c) => ids(c.tasks)).sort();
  assert.deepEqual(all, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('agrupar não altera nem reordena a lista original recebida', () => {
  const before = ids(sample);
  groupTasks(sample, 'section');
  groupTasks(sample, 'status');
  assert.deepEqual(ids(sample), before);
});

// ---------------------------------------------------------------------------
// Testes da lógica de Calendário visual (F6-IMP.5)
// ---------------------------------------------------------------------------

test('getCalendarMonthTitle gera título com nome do mês por extenso e ano em português', () => {
  assert.equal(getCalendarMonthTitle(2026, 9), 'Outubro de 2026'); // mês 9 = Outubro (0-indexed)
  assert.equal(getCalendarMonthTitle(2027, 0), 'Janeiro de 2027');
  assert.equal(MONTH_NAMES_PTBR.length, 12);
  assert.equal(WEEKDAY_SHORT_PTBR.length, 7);
});

test('buildCalendarMonth constrói semanas completas de 7 dias com dias padding do mês anterior/posterior', () => {
  // Outubro de 2026: 01/10/2026 é Quinta-feira (dia 4 da semana, Dom=0).
  // Portanto, a primeira semana deve conter Dom 27/09, Seg 28/09, Ter 29/09, Qua 30/09, Qui 01/10, Sex 02/10, Sáb 03/10.
  const cal = buildCalendarMonth(2026, 9, sample, TODAY);

  assert.equal(cal.year, 2026);
  assert.equal(cal.month, 9);
  assert.equal(cal.title, 'Outubro de 2026');
  assert.ok(cal.weeks.length >= 4 && cal.weeks.length <= 6);

  // Toda semana deve ter exatamente 7 dias
  for (const week of cal.weeks) {
    assert.equal(week.days.length, 7);
  }

  // Primeiro dia da primeira semana deve ser 27/09/2026 (mês anterior, isCurrentMonth = false)
  const firstDay = cal.weeks[0].days[0];
  assert.equal(firstDay.isoDate, '2026-09-27');
  assert.equal(firstDay.isCurrentMonth, false);

  // O dia 1 de Outubro deve ter isCurrentMonth = true
  const day1 = cal.weeks[0].days.find((d) => d.isoDate === '2026-10-01');
  assert.ok(day1);
  assert.equal(day1.isCurrentMonth, true);
  assert.equal(day1.dayNumber, 1);
});

test('buildCalendarMonth posiciona tarefas no dia correto (isoDate) e separa tarefas sem prazo em noDueDateTasks', () => {
  const cal = buildCalendarMonth(2026, 9, sample, TODAY);

  // sample tem:
  // - a: dueOn '2026-10-05'
  // - b: dueOn '2026-10-10'
  // - c: dueOn '2026-10-14'
  // - d: dueOn '2026-10-30'
  // - e: dueOn '2026-10-01' (concluída)
  // - f: sem prazo (dueOn: null, dueAt: null)

  const allDays = cal.weeks.flatMap((w) => w.days);

  const dayOct1 = allDays.find((d) => d.isoDate === '2026-10-01');
  assert.ok(dayOct1);
  assert.deepEqual(ids(dayOct1.tasks), ['e']);

  const dayOct5 = allDays.find((d) => d.isoDate === '2026-10-05');
  assert.ok(dayOct5);
  assert.deepEqual(ids(dayOct5.tasks), ['a']);

  const dayOct10 = allDays.find((d) => d.isoDate === '2026-10-10');
  assert.ok(dayOct10);
  assert.deepEqual(ids(dayOct10.tasks), ['b']);

  // Tarefa f não tem prazo: deve estar em noDueDateTasks
  assert.deepEqual(ids(cal.noDueDateTasks), ['f']);
  assert.equal(cal.totalTasksInMonth, 5); // a, b, c, d, e
});

test('buildCalendarMonth marca isToday corretamente apenas na célula que bate com todayIsoDate', () => {
  const cal = buildCalendarMonth(2026, 9, sample, '2026-10-10');
  const allDays = cal.weeks.flatMap((w) => w.days);

  const todayCell = allDays.find((d) => d.isoDate === '2026-10-10');
  assert.ok(todayCell);
  assert.equal(todayCell.isToday, true);

  const otherCell = allDays.find((d) => d.isoDate === '2026-10-11');
  assert.ok(otherCell);
  assert.equal(otherCell.isToday, false);
});

test('buildCalendarMonth trata transição de ano (Dezembro para Janeiro)', () => {
  const calDec = buildCalendarMonth(2026, 11, [], '2026-12-15');
  assert.equal(calDec.title, 'Dezembro de 2026');

  const calJan = buildCalendarMonth(2027, 0, [], '2027-01-01');
  assert.equal(calJan.title, 'Janeiro de 2027');

  // Primeiro dia da grade de Janeiro de 2027 (01/01/2027 é Sexta-feira, dia 5)
  // Domingo inicial deve ser 27/12/2026
  assert.equal(calJan.weeks[0].days[0].isoDate, '2026-12-27');
  assert.equal(calJan.weeks[0].days[0].isCurrentMonth, false);
});
