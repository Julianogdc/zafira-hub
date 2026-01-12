import { AsanaSection, AsanaTask } from "@/types/asana";
import { TaskRow } from "./TaskRow";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ListViewProps {
    sections: AsanaSection[];
    tasks: AsanaTask[];
    onTaskClick: (task: AsanaTask) => void;
    onComplete: (gid: string, completed: boolean) => void;
    onDelete: (gid: string) => void;
    timerState?: { id: string | null; time: number };
    onToggleTimer?: (gid: string) => void;
    onNewTask?: (sectionGid: string) => void;
}

export function ListView({ sections, tasks, onTaskClick, onComplete, onDelete, timerState, onToggleTimer, onNewTask }: ListViewProps) {
    // Helper to get tasks for a section
    const getTasksBySection = (sectionGid: string) => {
        return tasks.filter(t => t.memberships?.some(m => m.section?.gid === sectionGid));
    };

    // Helper for tasks without section
    const unsortedTasks = tasks.filter(t => !t.memberships?.some(m => sections.some(s => s.gid === m.section?.gid)));

    return (
        <div className="flex flex-col pb-20">
            {/* Unsorted Tasks */}
            {unsortedTasks.length > 0 && (
                <div className="mb-6">
                    <SectionHeader title="Sem Seção" count={unsortedTasks.length} />
                    <div className="divide-y divide-white/5 border-t border-white/5">
                        {unsortedTasks.map(task => (
                            <TaskRow
                                key={task.gid}
                                task={task}
                                onClick={onTaskClick}
                                onComplete={onComplete}
                                onDelete={onDelete}
                                timerState={timerState}
                                onToggleTimer={onToggleTimer}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Sections */}
            {sections.map(section => {
                const sectionTasks = getTasksBySection(section.gid);
                return (
                    <div key={section.gid} className="mb-6">
                        <SectionHeader title={section.name} count={sectionTasks.length} action={() => onNewTask?.(section.gid)} />
                        <div className="divide-y divide-white/5 border-t border-white/5">
                            {sectionTasks.map(task => (
                                <TaskRow
                                    key={task.gid}
                                    task={task}
                                    onClick={onTaskClick}
                                    onComplete={onComplete}
                                    onDelete={onDelete}
                                    timerState={timerState}
                                    onToggleTimer={onToggleTimer}
                                />
                            ))}
                        </div>
                        {/* "Add Task" placeholder row */}
                        <div
                            className="flex items-center gap-3 p-2 pl-4 text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 cursor-pointer transition-colors border-b border-transparent hover:border-white/5"
                            onClick={() => onNewTask?.(section.gid)}
                        >
                            <Plus className="w-4 h-4 ml-[1.6rem]" /> Adicionar tarefa...
                        </div>
                    </div>
                );
            })}
            {sections.length === 0 && unsortedTasks.length === 0 && (
                <div className="text-center py-20 text-slate-500">
                    Nenhuma tarefa encontrada.
                    <Button variant="link" onClick={() => onNewTask?.("")}>Criar primeira tarefa</Button>
                </div>
            )}
        </div>
    );
}

const SectionHeader = ({ title, count, action }: { title: string, count: number, action?: () => void }) => {
    const [isOpen, setIsOpen] = useState(true);
    return (
        <div className="group flex items-center gap-2 py-2 px-1 mb-1">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-white -ml-2" onClick={() => setIsOpen(!isOpen)}>
                <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
            </Button>
            <h3 className="text-sm font-bold text-slate-200">{title}</h3>
            {/* <span className="text-xs text-slate-600">{count}</span> */}
            {action && (
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" onClick={action}>
                    <Plus className="w-4 h-4 text-slate-400" />
                </Button>
            )}
        </div>
    );
}
