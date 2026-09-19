import { useState } from "react";
import { Plus, Trash2, Check, Pencil, X, Save } from "lucide-react";
import { Goal, ChecklistItem } from "../../types/goals";
import { useGoalsStore } from "../../store/useGoalsStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
// ✅ IMPORTAÇÃO DO CONFETE
import confetti from "canvas-confetti";

interface GoalChecklistProps {
  goal: Goal;
}

export const GoalChecklist = ({ goal }: GoalChecklistProps) => {
  const { updateGoal, toggleCheckItem } = useGoalsStore();
  const [newItemLabel, setNewItemLabel] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const handleAddItem = () => {
    if (!newItemLabel.trim()) return;
    const newItem: ChecklistItem = {
      id: crypto.randomUUID(),
      label: newItemLabel,
      checked: false,
    };
    updateGoal(goal.id, { checklist: [...(goal.checklist || []), newItem] });
    setNewItemLabel("");
  };

  const handleRemoveItem = (itemId: string) => {
    updateGoal(goal.id, {
      checklist: (goal.checklist || []).filter((item) => item.id !== itemId),
    });
  };

  // ✅ LÓGICA DE CONFETES AO MARCAR
  const handleToggle = (itemId: string, currentChecked: boolean) => {
    // 1. Atualiza no store
    toggleCheckItem(goal.id, itemId);

    // 2. Se estamos marcando como FEITO (não desmarcando)
    if (!currentChecked) {
        const items = goal.checklist || [];
        const total = items.length;
        // Conta quantos JÁ estavam feitos
        const completedCount = items.filter(i => i.checked).length;
        
        // Se já tínhamos (total - 1) feitos e agora marcamos mais um... SUCESSO!
        if (completedCount === total - 1) {
            triggerConfetti();
        }
    }
  };

  const triggerConfetti = () => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      // Confetes saindo de dois pontos da tela
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
  };

  const startEditing = (item: ChecklistItem) => {
    setEditingItemId(item.id);
    setEditLabel(item.label);
  };

  const saveEdit = () => {
    if (!editingItemId || !editLabel.trim()) return;
    const newChecklist = (goal.checklist || []).map(item => 
        item.id === editingItemId ? { ...item, label: editLabel } : item
    );
    updateGoal(goal.id, { checklist: newChecklist });
    setEditingItemId(null);
  };

  if (goal.type !== "checklist") return null;

  return (
    <div className="mt-4 rounded-lg border border-border/50 bg-secondary/20 p-4">
      <h4 className="mb-3 text-sm font-medium text-muted-foreground">Lista de Tarefas</h4>

      <div className="space-y-2 mb-4">
        {(goal.checklist || []).length === 0 && (
            <p className="text-xs text-muted-foreground italic">Nenhuma tarefa adicionada.</p>
        )}
        
        {(goal.checklist || []).map((item) => (
          <div key={item.id} className="group flex items-center gap-2 rounded-md bg-background/50 p-2 text-sm transition-all hover:bg-background">
            
            {editingItemId === item.id ? (
                <div className="flex flex-1 items-center gap-2">
                    <Input 
                        value={editLabel} 
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="h-7 text-xs"
                        autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-500" onClick={saveEdit}>
                        <Save className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => setEditingItemId(null)}>
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            ) : (
                <>
                    <div 
                        className="flex items-center gap-3 cursor-pointer flex-1"
                        // ✅ CHAMA NOSSA FUNÇÃO NOVA
                        onClick={() => handleToggle(item.id, item.checked)}
                    >
                        <div className={cn(
                            "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                            item.checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 hover:border-primary"
                        )}>
                            {item.checked && <Check className="h-3.5 w-3.5" />}
                        </div>
                        <span className={cn("truncate max-w-[200px] sm:max-w-xs", item.checked && "text-muted-foreground line-through")}>
                            {item.label}
                        </span>
                    </div>

                    <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => startEditing(item)}>
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveItem(item.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Nova tarefa..."
          value={newItemLabel}
          onChange={(e) => setNewItemLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
          className="h-8 text-sm"
        />
        <Button size="sm" variant="secondary" onClick={handleAddItem} className="h-8 px-3">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};