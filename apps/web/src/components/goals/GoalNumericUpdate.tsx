import { useState, useEffect } from "react";
import { Minus, Plus, Save, Zap } from "lucide-react";
import { Goal } from "../../types/goals";
import { goalTypeLabels } from "../../hooks/useGoalMetrics";
import { useGoalsStore } from "../../store/useGoalsStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// ✅ IMPORTAÇÃO
import confetti from "canvas-confetti";

export const GoalNumericUpdate = ({ goal }: { goal: Goal }) => {
  const { updateNumericProgress } = useGoalsStore();
  const [value, setValue] = useState(goal.currentValue || 0);
  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    setValue(goal.currentValue || 0);
  }, [goal.currentValue]);

  const handleUpdate = (newValue: number) => {
    const safeValue = Math.max(0, newValue);
    setValue(safeValue);
    setHasChanged(true);
  };

  const saveChange = () => {
    updateNumericProgress(goal.id, value);
    setHasChanged(false);

    // ✅ CHECK DE VITÓRIA
    // Se o novo valor atingiu a meta E o valor anterior ainda não tinha atingido
    // (ou simplesmente se atingiu agora para celebrar sempre que salvar no 100%)
    if (value >= (goal.targetValue || 0)) {
      fireSuccessConfetti();
    }
  };

  const fireSuccessConfetti = () => {
    confetti({
      particleCount: 150,
      spread: 60,
      origin: { y: 0.6 }, // Sai um pouco de baixo para cima
      colors: ['#26ccff', '#a25afd', '#ff5e7e', '#88ff5a', '#fcff42', '#ffa62d', '#ff36ff']
    });
  };

  if (goal.type !== "numeric") return null;

  if (goal.automationBinding) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-medium text-emerald-500">Atualização Automática Ativa</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Esta meta está sincronizada e será atualizada automaticamente.
        </p>
        <div className="mt-2 text-xl font-bold text-foreground">
          {value} / {goal.targetValue}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border/50 bg-secondary/20 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-muted-foreground">
          Progresso Atual
        </span>
        <span className="text-sm font-bold">
          {value} / {goal.targetValue}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleUpdate(value - 1)}
        >
          <Minus className="h-4 w-4" />
        </Button>

        <Input
          type="number"
          value={value}
          onChange={(e) => handleUpdate(Number(e.target.value))}
          className="h-8 text-center font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleUpdate(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>

        {hasChanged && (
          <Button
            size="sm"
            className="h-8 gap-2 ml-2 animate-in fade-in zoom-in"
            onClick={saveChange}
          >
            <Save className="h-3 w-3" />
            Salvar
          </Button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Atualize manualmente conforme realizações.
      </p>
    </div>
  );
};