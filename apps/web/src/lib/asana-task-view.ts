/**
 * Regras de apresentação das tarefas Asana (somente leitura — DEC-ASANA-001).
 *
 * Lógica pura, sem React e sem chamadas de rede, para poder ser testada de forma isolada.
 * Usada pela lista de tarefas de /projetos e pelo detalhe da tarefa.
 */
import type { ClientAsanaTask } from '@/services/asana';

export type StatusFilter = 'all' | 'pending' | 'overdue' | 'completed';
export type DueFilter = 'all' | 'overdue' | 'today' | 'next7' | 'none';

export const NO_SECTION = '__none__';
export const UNASSIGNED = 'unassigned';

export interface TaskFilters {
  search: string;
  projectGid: string; // 'all' ou gid do projeto
  status: StatusFilter;
  assignee: string; // 'all', 'unassigned' ou gid
  due: DueFilter;
  section: string; // 'all', NO_SECTION ou nome da seção
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  search: '',
  projectGid: 'all',
  status: 'all',
  assignee: 'all',
  due: 'all',
  section: 'all',
};

export function hasActiveFilters(filters: TaskFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.projectGid !== 'all' ||
    filters.status !== 'all' ||
    filters.assignee !== 'all' ||
    filters.due !== 'all' ||
    filters.section !== 'all'
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Data local no formato YYYY-MM-DD. */
export function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Soma dias a uma data YYYY-MM-DD sem depender do fuso horário. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d + days));
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
}

/**
 * Data de vencimento da tarefa como YYYY-MM-DD, ou null quando não há prazo
 * (ou o valor não pode ser interpretado). `dueOn` é uma data sem horário;
 * `dueAt` é um instante e é convertido para a data local.
 */
export function getTaskDueDate(task: Pick<ClientAsanaTask, 'dueOn' | 'dueAt'>): string | null {
  if (task.dueOn) {
    const datePart = task.dueOn.includes('T') ? task.dueOn.split('T')[0] : task.dueOn;
    return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
  }
  if (task.dueAt) {
    const parsed = new Date(task.dueAt);
    return Number.isNaN(parsed.getTime()) ? null : toLocalIsoDate(parsed);
  }
  return null;
}

/** Tarefa atrasada: não concluída e marcada como atrasada pelo servidor. */
export function isTaskOverdue(task: Pick<ClientAsanaTask, 'completed' | 'isOverdue'>): boolean {
  return !task.completed && task.isOverdue;
}

export function matchesDueFilter(task: ClientAsanaTask, due: DueFilter, today: string): boolean {
  if (due === 'all') return true;
  const dueDate = getTaskDueDate(task);

  if (due === 'none') return dueDate === null;
  if (due === 'overdue') return isTaskOverdue(task);

  // "Hoje" e "próximos 7 dias" só fazem sentido para tarefas ainda abertas e já atrasadas ficam em "Atrasadas".
  if (task.completed || dueDate === null) return false;
  if (due === 'today') return dueDate === today;
  if (due === 'next7') return dueDate >= today && dueDate <= addDaysToIsoDate(today, 7);
  return true;
}

export function matchesStatusFilter(task: ClientAsanaTask, status: StatusFilter): boolean {
  switch (status) {
    case 'completed':
      return task.completed;
    case 'overdue':
      return isTaskOverdue(task);
    case 'pending':
      return !task.completed && !task.isOverdue;
    default:
      return true;
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function matchesSearch(task: ClientAsanaTask, search: string): boolean {
  const query = normalize(search.trim());
  if (!query) return true;
  return [task.name, task.sectionName, task.assignee?.name, task.projectName]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalize(value).includes(query));
}

export function filterTasks(
  tasks: ClientAsanaTask[],
  filters: TaskFilters,
  today: string
): ClientAsanaTask[] {
  return tasks.filter((task) => {
    if (filters.projectGid !== 'all' && task.projectGid !== filters.projectGid) return false;
    if (!matchesStatusFilter(task, filters.status)) return false;

    if (filters.assignee === UNASSIGNED) {
      if (task.assignee?.gid) return false;
    } else if (filters.assignee !== 'all' && task.assignee?.gid !== filters.assignee) {
      return false;
    }

    if (!matchesDueFilter(task, filters.due, today)) return false;

    if (filters.section === NO_SECTION) {
      if (task.sectionName) return false;
    } else if (filters.section !== 'all' && task.sectionName !== filters.section) {
      return false;
    }

    return matchesSearch(task, filters.search);
  });
}

/** Seções existentes nas tarefas carregadas (restritas ao projeto escolhido, se houver), em ordem alfabética. */
export function listSections(tasks: ClientAsanaTask[], projectGid: string): string[] {
  const names = new Set<string>();
  for (const task of tasks) {
    if (projectGid !== 'all' && task.projectGid !== projectGid) continue;
    if (task.sectionName) names.add(task.sectionName);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function hasTasksWithoutSection(tasks: ClientAsanaTask[], projectGid: string): boolean {
  return tasks.some(
    (task) => (projectGid === 'all' || task.projectGid === projectGid) && !task.sectionName
  );
}

export function listAssignees(
  tasks: ClientAsanaTask[]
): Array<{ gid: string; name: string }> {
  const map = new Map<string, { gid: string; name: string }>();
  for (const task of tasks) {
    if (task.assignee?.gid && task.assignee.name && !map.has(task.assignee.gid)) {
      map.set(task.assignee.gid, { gid: task.assignee.gid, name: task.assignee.name });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Contadores sempre calculados sobre o conjunto completo, independentemente dos filtros. */
export function countTasks(tasks: ClientAsanaTask[]) {
  return {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    overdue: tasks.filter((t) => isTaskOverdue(t)).length,
    pending: tasks.filter((t) => !t.completed && !t.isOverdue).length,
  };
}

// ---------------------------------------------------------------------------
// Quadro (Kanban) VISUAL — F6-IMP.4. Somente agrupa para exibição; nada é gravado no Asana.
// ---------------------------------------------------------------------------

export type BoardGrouping = 'section' | 'status' | 'project' | 'assignee';

export interface BoardColumn {
  key: string;
  title: string;
  tasks: ClientAsanaTask[];
}

export const BOARD_GROUPING_LABELS: Record<BoardGrouping, string> = {
  section: 'Seção',
  status: 'Situação',
  project: 'Projeto',
  assignee: 'Responsável',
};

export interface GroupTasksOptions {
  /** Projetos do cliente, na ordem desejada, para ordenar as colunas do agrupamento por projeto. */
  projects?: Array<{ projectGid: string; projectName: string }>;
  /** Nomes de seção na ordem do Asana (concatenando os projetos), para ordenar as colunas por seção. */
  sectionOrder?: string[];
}

/**
 * Agrupa tarefas em colunas. A ordem das tarefas dentro de cada coluna é a ordem recebida.
 * - situação: três colunas fixas (atrasadas, pendentes, concluídas), mesmo vazias;
 * - seção: ordem do Asana quando conhecida, senão alfabética; "Sem seção" por último;
 * - projeto: ordem informada em `projects`; projetos desconhecidos em ordem alfabética;
 * - responsável: alfabética; "Sem responsável" por último.
 * Nos três últimos só aparecem colunas que têm tarefas.
 */
export function groupTasks(
  tasks: ClientAsanaTask[],
  groupBy: BoardGrouping,
  options: GroupTasksOptions = {}
): BoardColumn[] {
  if (groupBy === 'status') {
    const overdue = tasks.filter((t) => isTaskOverdue(t));
    const completed = tasks.filter((t) => t.completed);
    const pending = tasks.filter((t) => !t.completed && !t.isOverdue);
    return [
      { key: 'overdue', title: 'Atrasadas', tasks: overdue },
      { key: 'pending', title: 'Pendentes', tasks: pending },
      { key: 'completed', title: 'Concluídas', tasks: completed },
    ];
  }

  const columns = new Map<string, BoardColumn>();
  const add = (key: string, title: string, task: ClientAsanaTask) => {
    const column = columns.get(key);
    if (column) column.tasks.push(task);
    else columns.set(key, { key, title, tasks: [task] });
  };

  for (const task of tasks) {
    if (groupBy === 'section') {
      if (task.sectionName) add(task.sectionName, task.sectionName, task);
      else add(NO_SECTION, 'Sem seção', task);
    } else if (groupBy === 'project') {
      add(task.projectGid, task.projectName, task);
    } else if (task.assignee?.gid) {
      add(task.assignee.gid, task.assignee.name, task);
    } else {
      add(UNASSIGNED, 'Sem responsável', task);
    }
  }

  const lastKey = groupBy === 'section' ? NO_SECTION : UNASSIGNED;
  const byTitle = (a: BoardColumn, b: BoardColumn) => a.title.localeCompare(b.title, 'pt-BR');
  const rankOf = (order: string[]) => (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  let ordered = Array.from(columns.values());
  if (groupBy === 'section') {
    const rank = rankOf(options.sectionOrder ?? []);
    ordered.sort((a, b) => rank(a.key) - rank(b.key) || byTitle(a, b));
  } else if (groupBy === 'project') {
    const rank = rankOf((options.projects ?? []).map((p) => p.projectGid));
    ordered.sort((a, b) => rank(a.key) - rank(b.key) || byTitle(a, b));
  } else {
    ordered.sort(byTitle);
  }

  // "Sem seção" / "Sem responsável" sempre por último.
  ordered = [...ordered.filter((c) => c.key !== lastKey), ...ordered.filter((c) => c.key === lastKey)];
  return ordered;
}

/** Formata YYYY-MM-DD (ou instante ISO) como DD/MM/AAAA; devolve "-" quando não há data. */
export function formatDueDate(task: Pick<ClientAsanaTask, 'dueOn' | 'dueAt'>): string {
  const iso = getTaskDueDate(task);
  if (!iso) return '-';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Valida uma URL antes de usá-la em um link. Aceita somente https e, opcionalmente,
 * somente hosts do Asana. Rejeita `javascript:`, `data:`, `http:` e valores malformados.
 */
export function safeExternalUrl(
  url: string | null | undefined,
  options: { asanaOnly?: boolean } = {}
): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (options.asanaOnly) {
    const host = parsed.hostname.toLowerCase();
    if (host !== 'asana.com' && !host.endsWith('.asana.com')) return null;
  }
  return parsed.toString();
}

/** Link seguro para abrir a tarefa no Asana, ou null se o endereço não for do Asana. */
export function getAsanaTaskLink(task: Pick<ClientAsanaTask, 'permalinkUrl'>): string | null {
  return safeExternalUrl(task.permalinkUrl, { asanaOnly: true });
}

// ---------------------------------------------------------------------------
// Calendário VISUAL — F6-IMP.5. Agrupamento por prazo/data (DEC-ASANA-001).
// Não há reagendamento nem mutação: somente leitura.
// ---------------------------------------------------------------------------

export const MONTH_NAMES_PTBR = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export const WEEKDAY_SHORT_PTBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export interface CalendarDay {
  isoDate: string; // YYYY-MM-DD
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  tasks: ClientAsanaTask[];
}

export interface CalendarWeek {
  weekIndex: number;
  days: CalendarDay[];
}

export interface CalendarMonthData {
  year: number;
  month: number; // 0-11
  title: string; // Ex: "Outubro de 2026"
  weeks: CalendarWeek[];
  totalTasksInMonth: number;
  noDueDateTasks: ClientAsanaTask[];
}

export function getCalendarMonthTitle(year: number, month: number): string {
  const name = MONTH_NAMES_PTBR[month] ?? '';
  return `${name} de ${year}`;
}

/**
 * Constrói a estrutura de grade semanal do mês com preenchimento dos dias anteriores
 * e posteriores para compor semanas completas (Domingo a Sábado), associando as tarefas
 * filtradas às suas respectivas datas de vencimento. Tarefas sem prazo são retornadas
 * separadamente em `noDueDateTasks`.
 */
export function buildCalendarMonth(
  year: number,
  month: number, // 0 a 11
  tasks: ClientAsanaTask[],
  todayIsoDate: string
): CalendarMonthData {
  // 1. Agrupa tarefas por data ISO
  const byDate = new Map<string, ClientAsanaTask[]>();
  const noDueDateTasks: ClientAsanaTask[] = [];

  for (const task of tasks) {
    const dueDate = getTaskDueDate(task);
    if (!dueDate) {
      noDueDateTasks.push(task);
      continue;
    }
    const current = byDate.get(dueDate);
    if (current) current.push(task);
    else byDate.set(dueDate, [task]);
  }

  // 2. Calcula início e término da grade de 7 colunas (Dom a Sáb)
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startDayOfWeek = firstOfMonth.getUTCDay(); // 0 = Domingo, ..., 6 = Sábado

  // Data inicial da grade (primeiro Domingo na ou antes do dia 1)
  const gridStartDate = new Date(Date.UTC(year, month, 1 - startDayOfWeek));

  const weeks: CalendarWeek[] = [];
  let totalTasksInMonth = 0;

  // Itera dia a dia em passos de 7 dias até ultrapassar o fim do mês
  let cursor = new Date(gridStartDate.getTime());
  let weekIndex = 0;

  while (true) {
    const days: CalendarDay[] = [];

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const cYear = cursor.getUTCFullYear();
      const cMonth = cursor.getUTCMonth();
      const cDay = cursor.getUTCDate();
      const isoDate = `${cYear}-${pad(cMonth + 1)}-${pad(cDay)}`;

      const isCurrentMonth = cYear === year && cMonth === month;
      const dayTasks = byDate.get(isoDate) || [];

      if (isCurrentMonth) {
        totalTasksInMonth += dayTasks.length;
      }

      days.push({
        isoDate,
        dayNumber: cDay,
        isCurrentMonth,
        isToday: isoDate === todayIsoDate,
        tasks: dayTasks,
      });

      // Avança um dia
      cursor = new Date(Date.UTC(cYear, cMonth, cDay + 1));
    }

    weeks.push({ weekIndex, days });
    weekIndex++;

    // Condição de parada: já passamos do mês atual e completamos a semana de 7 dias
    const nextYear = cursor.getUTCFullYear();
    const nextMonth = cursor.getUTCMonth();
    const isPastMonth = nextYear > year || (nextYear === year && nextMonth > month);

    if (isPastMonth) {
      break;
    }
  }

  return {
    year,
    month,
    title: getCalendarMonthTitle(year, month),
    weeks,
    totalTasksInMonth,
    noDueDateTasks,
  };
}
