import { useState, useMemo } from 'react';
import { useCRMStore } from '@/store/useCRMStore';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CRMTask, Lead } from '@/types/crm';
import { format, isBefore, isSameDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface TaskNotificationProps {
    onOpenTask: (leadId: string) => void;
}

export function TaskNotification({ onOpenTask }: TaskNotificationProps) {
    const { tasks, leads } = useCRMStore();

    const dueTasks = useMemo(() => {
        const today = new Date();
        return tasks.filter(task => {
            if (task.completed || !task.dueDate) return false;
            const dueDate = parseISO(task.dueDate);
            // Due today OR overdue
            return isSameDay(dueDate, today) || isBefore(dueDate, today);
        });
    }, [tasks]);

    // if (dueTasks.length === 0) return null; // Removed check to always show the bell

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-8 w-8 text-zinc-400 hover:text-white">
                    <Bell className="h-5 w-5" />
                    {dueTasks.length > 0 && (
                        <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-zinc-950 border-zinc-800 p-0" align="end">
                <div className="p-3 border-b border-white/5 bg-zinc-900/40">
                    <h4 className="font-semibold text-sm text-zinc-200">Tarefas Pendentes</h4>
                    <p className="text-xs text-zinc-500">Você tem {dueTasks.length} tarefas vencidas ou para hoje.</p>
                </div>
                <ScrollArea className="h-[300px]">
                    {dueTasks.length === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-xs">
                            <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                            <p>Nenhuma tarefa pendente.</p>
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {dueTasks.map(task => {
                                const lead = leads.find(l => l.id === task.leadId);
                                const dueDate = parseISO(task.dueDate!);
                                const isLate = isBefore(dueDate, new Date()) && !isSameDay(dueDate, new Date());

                                return (
                                    <button
                                        key={task.id}
                                        onClick={() => onOpenTask(task.leadId)}
                                        className="w-full text-left p-2 rounded-lg hover:bg-zinc-900 transition-colors group"
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <p className="text-sm font-medium text-zinc-300 line-clamp-1 group-hover:text-white transition-colors">
                                                {task.title}
                                            </p>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isLate ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                {isLate ? 'Atrasada' : 'Hoje'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs text-zinc-500">
                                            <span className="truncate max-w-[150px]">{lead?.name || 'Lead desconhecido'}</span>
                                            <span>
                                                {format(dueDate, "dd/MM", { locale: ptBR })}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
