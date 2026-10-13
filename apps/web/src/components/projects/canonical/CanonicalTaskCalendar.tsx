import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ClientAsanaTask } from '@/services/asana';
import {
  WEEKDAY_SHORT_PTBR,
  buildCalendarMonth,
  getAsanaTaskLink,
  isTaskOverdue,
} from '@/lib/asana-task-view';
import { useAuthStore } from '@/store/useAuthStore';
import { currentPeriodInTimeZone, isoDateToCalendarDate, todayInTimeZone } from '@/lib/organization-time';
import styles from './CanonicalTaskCalendar.module.css';

export interface CanonicalTaskCalendarProps {
  /** Tarefas já filtradas (compartilha os mesmos filtros com a Lista e o Quadro). */
  tasks: ClientAsanaTask[];
  onTaskClick: (task: ClientAsanaTask) => void;
  clientName?: string;
}

const MAX_TASKS_PER_DAY = 3;

/**
 * Calendário VISUAL de tarefas do Asana — SOMENTE LEITURA (DEC-ASANA-001).
 * Exibe tarefas agrupadas por data de vencimento (dueOn / dueAt).
 * Não há drag-and-drop nem alteração de prazos: edição ocorre estritamente no Asana.
 */
export function CanonicalTaskCalendar({
  tasks,
  onTaskClick,
}: CanonicalTaskCalendarProps) {
  // DEC-F6-005: "hoje" no fuso da organização ativa
  const orgTimeZone = useAuthStore((state) => state.currentOrganization?.timezone);
  const todayIso = useMemo(() => todayInTimeZone(orgTimeZone), [orgTimeZone]);
  const today = useMemo(() => isoDateToCalendarDate(todayIso), [todayIso]);

  const [currentYear, setCurrentYear] = useState<number>(() => today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(() => today.getMonth());
  const [showNoDueDate, setShowNoDueDate] = useState<boolean>(true);

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => {
      if (prev === 0) {
        setCurrentYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => {
      if (prev === 11) {
        setCurrentYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const handleToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  const monthData = useMemo(
    () => buildCalendarMonth(currentYear, currentMonth, tasks, todayIso),
    [currentYear, currentMonth, tasks, todayIso]
  );

  return (
    <div
      className={styles.calendarContainer}
      role="region"
      aria-label="Calendário de tarefas Asana, somente leitura"
    >
      {/* 1. Cabeçalho com Navegação de Mês */}
      <header className={styles.calendarHeader}>
        <div className={styles.titleArea}>
          <h3 className={styles.monthTitle}>{monthData.title}</h3>
          <span className={styles.monthBadge} title="Tarefas com prazo neste mês">
            {monthData.totalTasksInMonth}{' '}
            {monthData.totalTasksInMonth === 1 ? 'tarefa no mês' : 'tarefas no mês'}
          </span>
        </div>

        <div className={styles.navControls}>
          <button
            type="button"
            className={styles.todayBtn}
            onClick={handleToday}
            title="Ir para o mês atual"
          >
            <CalendarIcon size={13} />
            Hoje
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={handlePrevMonth}
            aria-label="Mês anterior"
            title="Mês anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={handleNextMonth}
            aria-label="Próximo mês"
            title="Próximo mês"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      {/* 2. Grade de 7 Colunas (Dias da Semana e Células) */}
      <div className={styles.calendarGrid} role="grid" aria-label="Grade mensal">
        {/* Cabeçalho dos dias da semana */}
        {WEEKDAY_SHORT_PTBR.map((weekday) => (
          <div key={weekday} className={styles.weekdayHeader} role="columnheader">
            {weekday}
          </div>
        ))}

        {/* Células dos dias */}
        {monthData.weeks.map((week) =>
          week.days.map((day) => {
            const hasTasks = day.tasks.length > 0;
            const visibleTasks = day.tasks.slice(0, MAX_TASKS_PER_DAY);
            const extraCount = day.tasks.length - MAX_TASKS_PER_DAY;

            return (
              <div
                key={day.isoDate}
                className={`${styles.dayCell} ${
                  !day.isCurrentMonth ? styles.dayCellOtherMonth : ''
                } ${day.isToday ? styles.dayCellToday : ''}`}
                role="gridcell"
                aria-label={`${day.dayNumber} de ${monthData.title}, ${day.tasks.length} tarefas`}
              >
                <div className={styles.dayCellHeader}>
                  <span
                    className={`${styles.dayNumber} ${
                      day.isToday ? styles.dayNumberToday : ''
                    }`}
                  >
                    {day.dayNumber}
                  </span>
                  {hasTasks && (
                    <span className={styles.dayTaskCount}>{day.tasks.length}</span>
                  )}
                </div>

                <div className={styles.tasksList}>
                  {visibleTasks.map((task) => {
                    const overdue = isTaskOverdue(task);
                    const asanaLink = getAsanaTaskLink(task);

                    return (
                      <div
                        key={task.gid}
                        className={`${styles.taskItem} ${
                          task.completed
                            ? styles.taskItemDone
                            : overdue
                            ? styles.taskItemOverdue
                            : ''
                        }`}
                        onClick={() => onTaskClick(task)}
                        title={`${task.name} (${task.projectName}${
                          task.assignee ? ` • ${task.assignee.name}` : ''
                        })`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onTaskClick(task);
                          }
                        }}
                      >
                        <div className={styles.taskContent}>
                          {task.completed ? (
                            <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
                          ) : overdue ? (
                            <AlertTriangle size={11} className="shrink-0 text-red-400" />
                          ) : (
                            <Clock size={11} className="shrink-0 text-slate-400" />
                          )}
                          <span
                            className={`${styles.taskTitle} ${
                              task.completed ? styles.taskTitleDone : ''
                            }`}
                          >
                            {task.name}
                          </span>
                        </div>

                        {asanaLink && (
                          <a
                            href={asanaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.taskLink}
                            title="Abrir no Asana"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Abrir "${task.name}" no Asana`}
                          >
                            <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    );
                  })}

                  {extraCount > 0 && (
                    <span
                      className={styles.moreTasksBadge}
                      title={`${extraCount} outras tarefas neste dia`}
                    >
                      +{extraCount} mais
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. Seção de Tarefas Sem Prazo Definido */}
      {monthData.noDueDateTasks.length > 0 && (
        <section className={styles.noDueDateSection} aria-label="Tarefas sem prazo">
          <div
            className={styles.noDueDateHeader}
            onClick={() => setShowNoDueDate((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowNoDueDate((prev) => !prev);
              }
            }}
          >
            <div className={styles.noDueDateTitle}>
              <CalendarIcon size={14} className="text-slate-400" />
              <span>Tarefas sem prazo definido</span>
              <span className={styles.noDueDateCount}>
                {monthData.noDueDateTasks.length}
              </span>
            </div>
            {showNoDueDate ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>

          {showNoDueDate && (
            <div className={styles.noDueDateGrid}>
              {monthData.noDueDateTasks.map((task) => {
                const asanaLink = getAsanaTaskLink(task);

                return (
                  <div
                    key={task.gid}
                    className={styles.noDueDateCard}
                    onClick={() => onTaskClick(task)}
                    role="button"
                    tabIndex={0}
                    title="Clique para ver detalhes da tarefa"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTaskClick(task);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      {task.completed ? (
                        <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                      ) : (
                        <Clock size={12} className="shrink-0 text-slate-400" />
                      )}
                      <span className="truncate font-medium">{task.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.projectName && (
                        <span className="text-[10px] text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded">
                          {task.projectName}
                        </span>
                      )}
                      {asanaLink && (
                        <a
                          href={asanaLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.taskLink}
                          onClick={(e) => e.stopPropagation()}
                          title="Abrir no Asana"
                          aria-label={`Abrir "${task.name}" no Asana`}
                        >
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 4. Nota explicativa de Somente Leitura */}
      <p className={styles.calendarNote}>
        Calendário de consulta: tarefas são organizadas conforme o prazo definido no Asana.
        Não é possível arrastar ou alterar datas pelo Hub. Para reagendar ou editar uma tarefa,
        utilize o link do Asana.
      </p>
    </div>
  );
}
