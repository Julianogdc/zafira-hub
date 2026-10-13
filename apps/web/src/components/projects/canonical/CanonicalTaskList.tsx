import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  X,
  Filter,
  Calendar,
  ExternalLink,
  Eye,
  Layers,
  LayoutGrid,
  List,
  Lock,
  Sparkles,
} from 'lucide-react';
import { ClientAsanaTask, ClientAsanaProject } from '@/services/asana';
import {
  LoadingState,
  EmptyState,
  ErrorState,
  PermissionState,
} from '@/components/ui/ds';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CanonicalTaskBoard } from './CanonicalTaskBoard';
import { CanonicalTaskCalendar } from './CanonicalTaskCalendar';
import { CanonicalDeliverablesView } from './CanonicalDeliverablesView';
import {
  BOARD_GROUPING_LABELS,
  DEFAULT_TASK_FILTERS,
  NO_SECTION,
  UNASSIGNED,
  countTasks,
  filterTasks,
  formatDueDate,
  getAsanaTaskLink,
  hasActiveFilters,
  hasTasksWithoutSection,
  isTaskOverdue,
  listAssignees,
  listSections,
  type BoardGrouping,
  type DueFilter,
  type StatusFilter,
  type TaskFilters,
} from '@/lib/asana-task-view';
import { useAuthStore } from '@/store/useAuthStore';
import { currentPeriodInTimeZone, isoDateToCalendarDate, todayInTimeZone } from '@/lib/organization-time';
import styles from './CanonicalTaskList.module.css';

export interface CanonicalTaskListProps {
  tasks: ClientAsanaTask[];
  projects: ClientAsanaProject[];
  loading: boolean;
  error: { status?: number; message: string } | null;
  onRetry: () => void;
  onTaskClick: (task: ClientAsanaTask) => void;
  clientId: string;
  clientName?: string;
}

const triggerClass = 'bg-[#0d0d12] border-white/10 text-white text-xs h-9';
const contentClass = 'bg-[#111116] border-white/10 text-white text-xs max-h-56';

/**
 * Lista de tarefas Asana de um cliente — SOMENTE LEITURA (DEC-ASANA-001).
 * Edição, criação e conclusão de tarefas acontecem no próprio Asana, pelo link "Abrir no Asana".
 * O componente deve ser montado com `key` do cliente para que os filtros não vazem entre clientes.
 */
export function CanonicalTaskList({
  tasks,
  projects,
  loading,
  error,
  onRetry,
  onTaskClick,
  clientId,
  clientName,
}: CanonicalTaskListProps) {
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS);
  // DEC-F6-005: "hoje" no fuso da organização ativa
  const orgTimeZone = useAuthStore((state) => state.currentOrganization?.timezone);
  const [view, setView] = useState<'list' | 'board' | 'calendar' | 'deliverables'>('list');
  const [groupBy, setGroupBy] = useState<BoardGrouping>('section');

  const setFilter = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Trocar de projeto invalida a seção escolhida (seções pertencem a um projeto).
  const handleProjectChange = (projectGid: string) =>
    setFilters((prev) => ({ ...prev, projectGid, section: 'all' }));

  const handleResetFilters = () => setFilters(DEFAULT_TASK_FILTERS);

  const assignees = useMemo(() => listAssignees(tasks), [tasks]);
  const sections = useMemo(() => listSections(tasks, filters.projectGid), [tasks, filters.projectGid]);
  const showNoSection = useMemo(
    () => hasTasksWithoutSection(tasks, filters.projectGid),
    [tasks, filters.projectGid]
  );
  const counts = useMemo(() => countTasks(tasks), [tasks]);

  const filteredTasks = useMemo(
    () => filterTasks(tasks, filters, todayInTimeZone(orgTimeZone)),
    [tasks, filters, orgTimeZone]
  );

  const filtersActive = hasActiveFilters(filters);

  const header = (
    <div className={styles.taskListHeader}>
      <div className={styles.titleArea}>
        <h2 className={styles.sectionTitle}>
          <Layers size={18} />
          Tarefas Operacionais
        </h2>
        <span className={styles.taskCountBadge}>
          {tasks.length} {tasks.length === 1 ? 'tarefa total' : 'tarefas totais'}
        </span>
      </div>

      <div>
        <span
          className="text-[11px] text-muted-foreground flex items-center gap-1 bg-white/[0.03] px-2.5 py-1 rounded border border-white/5"
          title="Tarefas são criadas e editadas no próprio Asana"
        >
          <Lock size={12} className="text-slate-400" />
          Somente leitura
        </span>
      </div>
    </div>
  );

  const viewBar = (
    <div className={styles.viewBar}>
      <div className={styles.viewToggle} role="group" aria-label="Forma de visualização">
        <button
          type="button"
          className={`${styles.viewToggleBtn} ${view === 'list' ? styles.viewToggleBtnActive : ''}`}
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          <List size={13} /> Lista
        </button>
        <button
          type="button"
          className={`${styles.viewToggleBtn} ${view === 'board' ? styles.viewToggleBtnActive : ''}`}
          aria-pressed={view === 'board'}
          onClick={() => setView('board')}
        >
          <LayoutGrid size={13} /> Quadro
        </button>
        <button
          type="button"
          className={`${styles.viewToggleBtn} ${view === 'calendar' ? styles.viewToggleBtnActive : ''}`}
          aria-pressed={view === 'calendar'}
          onClick={() => setView('calendar')}
        >
          <Calendar size={13} /> Calendário
        </button>
        <button
          type="button"
          className={`${styles.viewToggleBtn} ${view === 'deliverables' ? styles.viewToggleBtnActive : ''}`}
          aria-pressed={view === 'deliverables'}
          onClick={() => setView('deliverables')}
        >
          <Sparkles size={13} /> Entregas
        </button>
      </div>

      {view === 'board' && (
        <div className={styles.groupByArea}>
          <span className={styles.groupByLabel}>Agrupar por</span>
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as BoardGrouping)}>
            <SelectTrigger className={`${triggerClass} w-[150px]`} aria-label="Agrupar quadro por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={contentClass}>
              {(Object.keys(BOARD_GROUPING_LABELS) as BoardGrouping[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {BOARD_GROUPING_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );

  if (view === 'deliverables') {
    return (
      <div className={styles.taskListContainer}>
        {header}
        {viewBar}
        <CanonicalDeliverablesView clientId={clientId} clientName={clientName} />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ESTADOS: carregando, erro, permissão e vazio das tarefas do Asana.
  // A barra de visualização continua visível: Entregas são do Hub e não dependem do Asana.
  // --------------------------------------------------------------------------
  if (loading) {
    return (
      <div className={styles.taskListContainer}>
        {viewBar}
        <LoadingState
          message={`Consultando todas as tarefas Asana de ${clientName || 'cliente'}...`}
          fullHeight={false}
        />
      </div>
    );
  }

  if (error) {
    if (error.status === 403) {
      return (
        <div className={styles.taskListContainer}>
          {viewBar}
          <PermissionState
            title="Acesso Restrito a Tarefas"
            description={
              error.message ||
              "Você não possui a permissão 'projects.view' para acessar a lista de tarefas deste cliente."
            }
          />
        </div>
      );
    }

    return (
      <div className={styles.taskListContainer}>
        {viewBar}
        <ErrorState
          title="Falha ao carregar tarefas do Asana"
          description={
            error.message ||
            'Não foi possível consolidar as tarefas dos projetos vinculados no momento. Nenhuma informação parcial é exibida.'
          }
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={styles.taskListContainer}>
        {header}
        {viewBar}
        <EmptyState
          icon={<Layers size={36} />}
          title="Nenhuma tarefa encontrada"
          description={`Os projetos vinculados a "${clientName || 'este cliente'}" não possuem tarefas cadastradas no Asana.`}
        />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // LISTA CARREGADA COM FILTROS
  // --------------------------------------------------------------------------
  return (
    <div className={styles.taskListContainer}>
      {header}
      {viewBar}

      <div className={styles.toolbar}>
        <div className={styles.filtersRow}>
          <div className={styles.searchBox}>
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Buscar por tarefa, seção, responsável ou projeto..."
              aria-label="Buscar tarefas"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              className={styles.searchInput}
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => setFilter('search', '')}
                className={styles.clearSearchBtn}
                title="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Projeto */}
          <Select value={filters.projectGid} onValueChange={handleProjectChange}>
            <SelectTrigger className={triggerClass} aria-label="Filtrar por projeto">
              <SelectValue placeholder="Todos os projetos" />
            </SelectTrigger>
            <SelectContent className={contentClass}>
              <SelectItem value="all">Todos os projetos ({projects.length})</SelectItem>
              {projects.map((proj) => (
                <SelectItem key={proj.projectGid} value={proj.projectGid}>
                  {proj.projectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Situação */}
          <Select
            value={filters.status}
            onValueChange={(value) => setFilter('status', value as StatusFilter)}
          >
            <SelectTrigger className={triggerClass} aria-label="Filtrar por situação">
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent className={contentClass}>
              <SelectItem value="all">Todas as situações ({counts.total})</SelectItem>
              <SelectItem value="pending">Pendentes ({counts.pending})</SelectItem>
              <SelectItem value="overdue">Em atraso ({counts.overdue})</SelectItem>
              <SelectItem value="completed">Concluídas ({counts.completed})</SelectItem>
            </SelectContent>
          </Select>

          {/* Prazo */}
          <Select
            value={filters.due}
            onValueChange={(value) => setFilter('due', value as DueFilter)}
          >
            <SelectTrigger className={triggerClass} aria-label="Filtrar por prazo">
              <SelectValue placeholder="Prazo" />
            </SelectTrigger>
            <SelectContent className={contentClass}>
              <SelectItem value="all">Qualquer prazo</SelectItem>
              <SelectItem value="overdue">Atrasadas</SelectItem>
              <SelectItem value="today">Vencem hoje</SelectItem>
              <SelectItem value="next7">Próximos 7 dias</SelectItem>
              <SelectItem value="none">Sem prazo</SelectItem>
            </SelectContent>
          </Select>

          {/* Seção */}
          <Select value={filters.section} onValueChange={(value) => setFilter('section', value)}>
            <SelectTrigger className={triggerClass} aria-label="Filtrar por seção">
              <SelectValue placeholder="Seção" />
            </SelectTrigger>
            <SelectContent className={contentClass}>
              <SelectItem value="all">Todas as seções</SelectItem>
              {showNoSection && <SelectItem value={NO_SECTION}>Sem seção</SelectItem>}
              {sections.map((section) => (
                <SelectItem key={section} value={section}>
                  {section}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Responsável */}
          <Select value={filters.assignee} onValueChange={(value) => setFilter('assignee', value)}>
            <SelectTrigger className={triggerClass} aria-label="Filtrar por responsável">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent className={contentClass}>
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              <SelectItem value={UNASSIGNED}>Sem responsável</SelectItem>
              {assignees.map((assignee) => (
                <SelectItem key={assignee.gid} value={assignee.gid}>
                  {assignee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={styles.filterSummary}>
          <span aria-live="polite">
            Exibindo <strong>{filteredTasks.length}</strong> de {tasks.length} tarefas
            {filtersActive && ' (filtrado)'}
          </span>
          <span className="flex items-center gap-3">
            {filtersActive && (
              <button type="button" onClick={handleResetFilters} className={styles.resetFiltersBtn}>
                Limpar filtros
              </button>
            )}
            <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
              Leitura paginada completa confirmada
            </span>
          </span>
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className={styles.noFilterResults}>
          <Filter size={24} className="text-slate-500" />
          <p className="font-medium text-slate-300">
            Nenhuma tarefa corresponde aos filtros selecionados.
          </p>
          <button type="button" onClick={handleResetFilters} className={styles.resetFiltersBtn}>
            Limpar todos os filtros
          </button>
        </div>
      ) : view === 'board' ? (
        <>
          <CanonicalTaskBoard
            tasks={filteredTasks}
            projects={projects}
            clientId={clientId}
            groupBy={groupBy}
            onTaskClick={onTaskClick}
          />
          <p className={styles.boardNote}>
            Quadro de consulta: não é possível mover cartões. Para mudar uma tarefa de seção ou
            editá-la, abra-a no Asana.
          </p>
        </>
      ) : view === 'calendar' ? (
        <CanonicalTaskCalendar
          tasks={filteredTasks}
          onTaskClick={onTaskClick}
          clientName={clientName}
        />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.tasksTable}>
            <thead className={styles.tableHead}>
              <tr>
                <th className={styles.tableHeadTh}>Situação</th>
                <th className={styles.tableHeadTh}>Tarefa</th>
                <th className={styles.tableHeadTh}>Projeto</th>
                <th className={styles.tableHeadTh}>Seção</th>
                <th className={styles.tableHeadTh}>Responsável</th>
                <th className={styles.tableHeadTh}>Prazo</th>
                <th className={styles.tableHeadTh} style={{ textAlign: 'right' }}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const overdue = isTaskOverdue(task);
                const asanaLink = getAsanaTaskLink(task);

                return (
                  <tr key={task.gid} className={styles.tableRow} onClick={() => onTaskClick(task)}>
                    <td className={styles.tableTd}>
                      {task.completed ? (
                        <span className={`${styles.statusBadge} ${styles.statusCompleted}`}>
                          <CheckCircle2 size={12} /> Concluída
                        </span>
                      ) : overdue ? (
                        <span className={`${styles.statusBadge} ${styles.statusOverdue}`}>
                          <AlertTriangle size={12} /> Atrasada
                        </span>
                      ) : (
                        <span className={`${styles.statusBadge} ${styles.statusPending}`}>
                          <Clock size={12} /> Pendente
                        </span>
                      )}
                    </td>

                    <td className={styles.tableTd}>
                      <div className={styles.taskNameCell}>
                        <span
                          className={`${styles.taskNameText} ${
                            task.completed ? styles.taskCompletedText : ''
                          }`}
                          title={task.name}
                        >
                          {task.name}
                        </span>
                      </div>
                    </td>

                    <td className={styles.tableTd}>
                      <span className={styles.projectBadge} title={task.projectName}>
                        {task.projectName}
                      </span>
                    </td>

                    <td className={styles.tableTd}>
                      <span className={styles.sectionText} title={task.sectionName || '-'}>
                        {task.sectionName || '-'}
                      </span>
                    </td>

                    <td className={styles.tableTd}>
                      <div className={styles.assigneeCell}>
                        {task.assignee ? (
                          <>
                            <div className={styles.assigneeAvatar}>
                              {task.assignee.photoUrl ? (
                                <img
                                  src={task.assignee.photoUrl}
                                  alt={task.assignee.name}
                                  className={styles.assigneePhoto}
                                />
                              ) : (
                                <span>{task.assignee.name.charAt(0).toUpperCase()}</span>
                              )}
                            </div>
                            <span className={styles.assigneeName} title={task.assignee.name}>
                              {task.assignee.name}
                            </span>
                          </>
                        ) : (
                          <span className={styles.unassignedText}>Sem responsável</span>
                        )}
                      </div>
                    </td>

                    <td className={styles.tableTd}>
                      <div
                        className={`${styles.dueDateCell} ${
                          overdue ? styles.dueDateOverdue : styles.dueDateNormal
                        }`}
                      >
                        <Calendar size={12} />
                        <span>{formatDueDate(task)}</span>
                      </div>
                    </td>

                    <td className={styles.tableTd} style={{ textAlign: 'right' }}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          className={styles.detailsBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTaskClick(task);
                          }}
                        >
                          <Eye size={11} />
                          <span>Detalhes</span>
                        </button>
                        {asanaLink && (
                          <a
                            href={asanaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.detailsBtn}
                            onClick={(e) => e.stopPropagation()}
                            title="Abrir esta tarefa no Asana para editar"
                          >
                            <ExternalLink size={11} />
                            <span>Asana</span>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
