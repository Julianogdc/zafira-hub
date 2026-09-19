import { useState, useEffect } from "react";
import { AsanaTask } from "@/types/asana";
import { asanaService } from "@/lib/asana-service";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, GripVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface SubtaskListProps {
    parentTask: AsanaTask;
    onTaskClick?: (task: AsanaTask) => void;
}

export const SubtaskList = ({ parentTask, onTaskClick }: SubtaskListProps) => {
    const [subtasks, setSubtasks] = useState<AsanaTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [newSubtaskName, setNewSubtaskName] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadSubtasks();
    }, [parentTask.gid]);

    const loadSubtasks = async () => {
        setLoading(true);
        try {
            const data = await asanaService.getSubtasks(parentTask.gid);
            setSubtasks(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSubtask = async () => {
        if (!newSubtaskName.trim()) return;
        setCreating(true);
        try {
            const created = await asanaService.createSubtask(parentTask.gid, newSubtaskName);
            setSubtasks(prev => [...prev, created]);
            setNewSubtaskName("");
            toast.success("Subtarefa criada!");
        } catch (error) {
            toast.error("Erro ao criar subtarefa.");
        } finally {
            setCreating(false);
        }
    };

    const handleToggleComplete = async (gid: string, completed: boolean) => {
        // Optimistic update
        setSubtasks(prev => prev.map(t => t.gid === gid ? { ...t, completed } : t));
        try {
            await asanaService.completeTask(gid, completed);
        } catch (error) {
            toast.error("Erro ao atualizar.");
            // Rollback
            setSubtasks(prev => prev.map(t => t.gid === gid ? { ...t, completed: !completed } : t));
        }
    };

    const handleDeleteSubtask = async (gid: string) => {
        setSubtasks(prev => prev.filter(t => t.gid !== gid));
        try {
            await asanaService.deleteTask(gid);
            toast.success("Subtarefa excluída");
        } catch (error) {
            toast.error("Erro ao excluir");
            loadSubtasks(); // Rollback
        }
    };

    return (
        <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                Subtarefas
                {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            </h3>

            <div className="space-y-1">
                {subtasks.map(t => (
                    <div key={t.gid} className="group flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5 cursor-pointer" onClick={() => onTaskClick?.(t)}>
                        <GripVertical className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 cursor-grab" onClick={(e) => e.stopPropagation()} />
                        <div
                            className={`w-4 h-4 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${t.completed ? 'bg-green-500 border-green-500' : 'border-slate-500 hover:border-purple-400'}`}
                            onClick={(e) => { e.stopPropagation(); handleToggleComplete(t.gid, !t.completed); }}
                        >
                            {t.completed && <div className="w-2 h-2 bg-white rounded-full" />}
                        </div>
                        <span className={`text-sm flex-1 ${t.completed ? 'line-through text-slate-500' : 'text-slate-300'}`}>{t.name}</span>
                        {t.assignee && (
                            <Avatar className="h-5 w-5">
                                <AvatarImage src={t.assignee.photo?.image_60x60} />
                                <AvatarFallback className="text-[8px] bg-slate-700 text-slate-300">U</AvatarFallback>
                            </Avatar>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all"
                            onClick={(e) => { e.stopPropagation(); handleDeleteSubtask(t.gid); }}
                        >
                            <Trash2 className="w-3 h-3" />
                        </Button>
                    </div>
                ))}
            </div>

            <div className="flex items-center gap-2 pl-7">
                <Input
                    value={newSubtaskName}
                    onChange={(e) => setNewSubtaskName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSubtask(); }}
                    placeholder="Adicionar subtarefa..."
                    className="h-8 bg-transparent border-transparent hover:bg-white/5 hover:border-white/10 focus:border-purple-500/50 focus:bg-black/20 transition-all text-sm placeholder:text-slate-500"
                />
                <Button
                    size="icon"
                    variant="ghost"
                    disabled={!newSubtaskName.trim() || creating}
                    onClick={handleCreateSubtask}
                    className="h-8 w-8 text-slate-400 hover:text-purple-400"
                >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
            </div>
        </div>
    );
};
