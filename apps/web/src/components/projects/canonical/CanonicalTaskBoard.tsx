import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  asanaIntegrationService,
  ClientAsanaProject,
  ClientAsanaTask,
} from '@/services/asana';
import {
  formatDueDate,
  getAsanaTaskLink,
  groupTasks,
  isTaskOverdue,
  type BoardGrouping,
} from '@/lib/asana-task-view';
import styles from './CanonicalTaskBoard.module.css';

export interface CanonicalTaskBoardProps {
  /** Tarefas já filtradas pela lista (mesmos filtros nas duas visões). */
  tasks: ClientAsanaTask[];
  projects: ClientAsanaProject[];
  clientId: string;
  groupBy: BoardGrouping;
  onTaskClick: (task: ClientAsanaTask) => void;
}

/**
 * Quadro (Kanban) VISUAL das tarefas Asana — somente leitura (DEC-ASANA-001).
 * Não há arrastar e soltar: nada aqui altera o Asana. Para mover ou editar uma tarefa,
 * use o link "Asana" do cartão.
 */
export function CanonicalTaskBoard({
  tasks,
  projects,
  clientId,
  groupBy,
  onTaskClick,
}: CanonicalTaskBoardProps) {
  // Ordem real das seções no Asana (leitura). Se falhar, as colunas caem para ordem alfabética.
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const projectKey = projects.map((p) => p.projectGid).join('|');

  useEffect(() => {
    if (groupBy !== 'section' || !projectKey) return;
    let cancelled = false;

    Promise.all(
      projectKey.split('|').map((projectGid) =>
        asanaIntegrationService.getProjectSections(clientId, projectGid).catch(() => [])
      )
    ).then((results) => {
      if (cancelled) return;
      const names: string[] = [];
      for (const sections of results) {
        for (const section of Array.isArray(sections) ? sections : []) {
          if (section?.name && !names.includes(section.name)) names.push(section.name);
        }
      }
      setSectionOrder(names);
    });

    return () => {
      cancelled = true;
    };
  }, [groupBy, clientId, projectKey]);

  const columns = useMemo(
    () => groupTasks(tasks, groupBy, { projects, sectionOrder }),
    [tasks, groupBy, projects, sectionOrder]
  );

  return (
    <div className={styles.boardScroller} role="list" aria-label="Quadro de tarefas, somente leitura">
      {columns.map((column) => (
        <section key={column.key} className={styles.column} role="listitem" aria-label={column.title}>
          <header className={styles.columnHeader}>
            <h3 className={styles.columnTitle} title={column.title}>
              {column.title}
            </h3>
            <span className={styles.columnCount}>{column.tasks.length}</span>
          </header>

          <div className={styles.columnBody}>
            {column.tasks.length === 0 ? (
              <p className={styles.emptyColumn}>Nenhuma tarefa</p>
            ) : (
              column.tasks.map((task) => {
                const overdue = isTaskOverdue(task);
                const asanaLink = getAsanaTaskLink(task);

                return (
                  <article
                    key={task.gid}
                    className={`${styles.card} ${overdue ? styles.cardOverdue : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.cardMain}
                      onClick={() => onTaskClick(task)}
                      title="Ver detalhes da tarefa"
                    >
                      <span
                        className={`${styles.cardTitle} ${task.completed ? styles.cardTitleDone : ''}`}
                      >
                        {task.name}
                      </span>
                    </button>

                    <div className={styles.cardBadges}>
                      {groupBy !== 'status' &&
                        (task.completed ? (
                          <span className={`${styles.badge} ${styles.badgeDone}`}>
                            <CheckCircle2 size={11} /> Concluída
                          </span>
                        ) : overdue ? (
                          <span className={`${styles.badge} ${styles.badgeOverdue}`}>
                            <AlertTriangle size={11} /> Atrasada
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgePending}`}>
                            <Clock size={11} /> Pendente
                          </span>
                        ))}
                      {groupBy !== 'project' && (
                        <span className={styles.badge} title={task.projectName}>
                          {task.projectName}
                        </span>
                      )}
                      {groupBy !== 'section' && task.sectionName && (
                        <span className={styles.badge} title={task.sectionName}>
                          {task.sectionName}
                        </span>
                      )}
                    </div>

                    <footer className={styles.cardFooter}>
                      <span
                        className={`${styles.due} ${overdue ? styles.dueOverdue : ''}`}
                        title="Prazo"
                      >
                        <Calendar size={12} />
                        {formatDueDate(task)}
                      </span>

                      {groupBy !== 'assignee' && (
                        <span className={styles.assignee} title={task.assignee?.name || 'Sem responsável'}>
                          {task.assignee ? (
                            <>
                              <span className={styles.avatar}>
                                {task.assignee.photoUrl ? (
                                  <img src={task.assignee.photoUrl} alt="" className={styles.avatarImg} />
                                ) : (
                                  task.assignee.name.charAt(0).toUpperCase()
                                )}
                              </span>
                              <span className={styles.assigneeName}>{task.assignee.name}</span>
                            </>
                          ) : (
                            <span className={styles.unassigned}>Sem responsável</span>
                          )}
                        </span>
                      )}

                      {asanaLink && (
                        <a
                          href={asanaLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.asanaLink}
                          title="Abrir esta tarefa no Asana"
                          aria-label={`Abrir "${task.name}" no Asana`}
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </footer>
                  </article>
                );
              })
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
