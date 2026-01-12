import { useState } from "react";
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths,
    isToday
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AsanaTask } from "@/types/asana";
import { cn } from "@/lib/utils";

interface CalendarViewProps {
    tasks: AsanaTask[];
    onTaskClick: (task: AsanaTask) => void;
}

export function CalendarView({ tasks, onTaskClick }: CalendarViewProps) {
    const [currentDate, setCurrentDate] = useState(new Date());

    const startDate = startOfWeek(startOfMonth(currentDate), { locale: ptBR });
    const endDate = endOfWeek(endOfMonth(currentDate), { locale: ptBR });

    // Create array of all days to render
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    // Days of week headers
    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const goToToday = () => setCurrentDate(new Date());

    const getTasksForDay = (day: Date) => {
        return tasks.filter(task => {
            if (!task.due_on) return false;
            // Handle timezone discrepancies if needed, but string comparison usually works for YYYY-MM-DD
            // Asana due_on is YYYY-MM-DD
            const taskDate = task.due_on;
            const dayString = format(day, 'yyyy-MM-dd');
            return taskDate === dayString;
        });
    };

    return (
        <div className="flex flex-col h-full bg-[#0d0d12] rounded-lg border border-white/5 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-semibold text-white capitalize">
                        {format(currentDate, 'MMMM yyyy', { locale: ptBR })}
                    </h2>
                    <div className="flex items-center bg-white/5 rounded-md p-1">
                        <Button variant="ghost" size="icon" onClick={prevMonth} className="h-7 w-7 hover:bg-white/10">
                            <ChevronLeft className="w-4 h-4 text-slate-400" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={goToToday} className="h-7 px-3 text-xs hover:bg-white/10 text-slate-400">
                            Hoje
                        </Button>
                        <Button variant="ghost" size="icon" onClick={nextMonth} className="h-7 w-7 hover:bg-white/10">
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Grid Header */}
            <div className="grid grid-cols-7 border-b border-white/5 bg-white/[0.02]">
                {weekDays.map(day => (
                    <div key={day} className="py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 flex-1 auto-rows-fr bg-[#0d0d12]">
                {days.map((day, dayIdx) => {
                    const dayTasks = getTasksForDay(day);
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isDayToday = isToday(day);

                    return (
                        <div
                            key={day.toString()}
                            className={cn(
                                "min-h-[120px] p-2 border-b border-r border-white/5 relative group transition-colors hover:bg-white/[0.01]",
                                !isCurrentMonth && "bg-white/[0.01] opacity-50 text-slate-600",
                                isDayToday && "bg-purple-900/10"
                            )}
                        >
                            {/* Date Number */}
                            <div className="flex items-center justify-between mb-2">
                                <span className={cn(
                                    "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
                                    isDayToday ? "bg-purple-600 text-white" : "text-slate-400",
                                    !isCurrentMonth && "text-slate-700"
                                )}>
                                    {format(day, 'd')}
                                </span>
                                {isDayToday && <div className="text-[10px] text-purple-400 font-medium px-2">HOJE</div>}
                            </div>

                            {/* Tasks Container */}
                            <div className="flex flex-col gap-1 overflow-y-auto max-h-[100px] scrollbar-hide">
                                {dayTasks.map(task => (
                                    <div
                                        key={task.gid}
                                        onClick={() => onTaskClick(task)}
                                        className={cn(
                                            "text-xs px-2 py-1 rounded truncate cursor-pointer transition-all border border-transparent",
                                            task.completed
                                                ? "bg-green-500/10 text-green-400 hover:bg-green-500/20 line-through opacity-70"
                                                : "bg-[#1e1e24] text-slate-300 hover:bg-[#272730] hover:border-white/10 hover:shadow-sm"
                                        )}
                                        title={task.name}
                                    >
                                        {task.name}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
