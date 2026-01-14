import { useState, useEffect } from 'react';
import { useCRMStore } from '@/store/useCRMStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon, Trash2, Plus, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CRMTasksProps {
    leadId: string;
}

export function CRMTasks({ leadId }: CRMTasksProps) {
    const { tasks, fetchTasks, addTask, toggleTask, deleteTask } = useCRMStore();
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [date, setDate] = useState<Date | undefined>();

    useEffect(() => {
        fetchTasks(leadId);
    }, [leadId]);

    const handleAdd = async () => {
        if (!newTaskTitle.trim()) return;

        await addTask(leadId, newTaskTitle, date?.toISOString());
        setNewTaskTitle('');
        setDate(undefined);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAdd();
    };

    const leadTasks = tasks.filter(t => t.leadId === leadId);

    return (
        <div className="flex flex-col h-full space-y-4">
            <div className="flex gap-2">
                <Input
                    placeholder="Adicionar nova tarefa..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-zinc-900 border-zinc-800"
                />

                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-[240px] justify-start text-left font-normal border-zinc-800 bg-zinc-900", !date && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {date ? format(date, "PPP", { locale: ptBR }) : <span>Prazo (Opcional)</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={date}
                            onSelect={setDate}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>

                <Button onClick={handleAdd} className="bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="w-4 h-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1 pr-4">
                <div className="space-y-2">
                    {leadTasks.length === 0 && (
                        <div className="text-center py-8 text-zinc-500">
                            Nenhuma tarefa pendente.
                        </div>
                    )}

                    {leadTasks.map(task => (
                        <div key={task.id} className="group flex items-center justify-between p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all">
                            <div className="flex items-center gap-3">
                                <button onClick={() => toggleTask(task.id, !task.completed)}>
                                    {task.completed ? (
                                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                    ) : (
                                        <Circle className="w-5 h-5 text-zinc-500 hover:text-emerald-500" />
                                    )}
                                </button>
                                <div className={cn("flex flex-col", task.completed && "opacity-50 line-through")}>
                                    <span className="text-sm font-medium text-zinc-200">{task.title}</span>
                                    {task.dueDate && (
                                        <span className={cn("text-xs flex items-center gap-1",
                                            new Date(task.dueDate) < new Date() && !task.completed ? "text-red-400" : "text-zinc-500"
                                        )}>
                                            <CalendarIcon className="w-3 h-3" />
                                            {format(new Date(task.dueDate), "dd 'de' MMM", { locale: ptBR })}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <Button
                                variant="ghost"
                                size="sm"
                                className="opacity-0 group-hover:opacity-100 text-red-400 hover:bg-red-950/30 hover:text-red-300"
                                onClick={() => deleteTask(task.id)}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
