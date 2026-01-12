import { memo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Play, Pause, Trash2 } from "lucide-react";
import { isBefore, isToday } from "date-fns";
import { AsanaTask } from "@/types/asana";
import { formatTaskDate, formatTimer, getColorClass } from "@/lib/asana-helpers";
import { fromAsanaDate } from "@/lib/date-utils";

interface TaskRowProps {
    task: AsanaTask;
    onClick: (task: AsanaTask) => void;
    onComplete: (gid: string, completed: boolean) => void;
    onDelete: (gid: string) => void;
    timerState?: { id: string | null; time: number };
    onToggleTimer?: (gid: string) => void;
}

export const TaskRow = memo(({ task, onClick, onComplete, onDelete, timerState, onToggleTimer }: TaskRowProps) => {
    const dateText = formatTaskDate(task);
    const isOverdue = (task.due_on || task.due_at) && isBefore(fromAsanaDate(task.due_at || task.due_on!), new Date()) && !isToday(fromAsanaDate(task.due_at || task.due_on!));

    return (
        <div className="group flex items-center gap-4 px-4 py-2 hover:bg-[#2a2a35] border-b border-white/5 cursor-pointer transition-colors relative" onClick={() => onClick(task)}>
            {/* Selection Line */}
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />

            <div onClick={(e) => e.stopPropagation()} className="shrink-0 relative z-10">
                <div
                    onClick={() => onComplete(task.gid, !task.completed)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all duration-300 ${task.completed ? 'bg-green-500 border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'border-slate-500 hover:border-purple-400 group-hover:scale-110'}`}
                >
                    {task.completed && <div className="w-2.5 h-2.5 bg-white rounded-full animate-in zoom-in" />}
                </div>
            </div>
            <div className={`flex-1 min-w-0 flex items-center gap-3 ${task.completed ? 'opacity-50' : ''}`}>
                <span className={`text-sm font-medium truncate ${task.completed ? 'line-through text-muted-foreground' : 'text-slate-200'}`}>{task.name}</span>
                {onToggleTimer && !task.completed && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        {timerState?.id === task.gid && <span className="text-xs font-mono text-purple-400 w-10">{formatTimer(timerState.time)}</span>}
                        <Button variant="ghost" size="icon" className={`h-6 w-6 ${timerState?.id === task.gid ? 'text-purple-400 animate-pulse opacity-100' : 'text-slate-500 hover:text-purple-400'}`} onClick={() => onToggleTimer(task.gid)}>
                            {timerState?.id === task.gid ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </Button>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 shrink-0 relative z-10">
                {task.projects && task.projects.length > 0 && (
                    <div className={`text-[10px] px-2.5 py-1 rounded-full md:max-w-[150px] truncate font-medium border border-white/5 ${getColorClass(task.projects[0].color)}`}>{task.projects[0].name}</div>
                )}
                {dateText && <span className={`text-xs font-medium ${isOverdue && !task.completed ? "text-red-400" : task.completed ? "text-slate-500" : "text-green-400"}`}>{dateText}</span>}
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500 transition-opacity" onClick={(e) => { e.stopPropagation(); onDelete(task.gid); }}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
        </div>
    );
});

TaskRow.displayName = 'TaskRow';
