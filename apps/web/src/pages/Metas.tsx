import { useState, useEffect } from "react";
import { Plus, Target } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useGoalsStore } from "@/store/useGoalsStore";
import { Goal } from "@/types/goals";
import { useGoalMetrics } from "@/hooks/useGoalMetrics";
import { GoalsKPIs } from "@/components/goals/GoalsKPIs";
import { GlobalProgress } from "@/components/goals/GlobalProgress";
import { CategoryList } from "@/components/goals/CategoryList";
import { GoalFormDialog } from "@/components/goals/GoalFormDialog";
import { useGoalAutomation } from "@/hooks/useGoalAutomation";

// Helper para converter timestamp em YYYY-MM-DD local
function timestampToInputDate(timestamp: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Metas() {
  const { setForm, removeGoal, resetForm, fetchGoals, initialized } = useGoalsStore();

  useEffect(() => {
    if (!initialized) {
      fetchGoals();
    }
  }, [initialized, fetchGoals]);


  // Ativa automação de metas (Financeiro + CRM)
  useGoalAutomation();

  // Hook de Metricas
  const {
    total,
    emAtraso,
    concluidas,
    percentConcluidas,
    metasPorCategoria
  } = useGoalMetrics();

  // Estados Locais
  const [open, setOpen] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);

  // Handlers
  function openEdit(meta: Goal) {
    setEditingGoalId(meta.id);
    setForm({
      name: meta.name,
      category: meta.category,
      type: meta.type || 'monetary',
      targetValue: meta.targetValue || 0,
      automationBinding: meta.automationBinding,
      startDate: timestampToInputDate(meta.startDate),
      endDate: timestampToInputDate(meta.endDate),
    } as any);
    setOpen(true);
  }

  function openNew() {
    resetForm();
    setEditingGoalId(null);
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <PageHeader
        title="Metas e Objetivos"
        description="Acompanhe suas metas financeiras e operacionais em tempo real."
        icon={Target}
      >
        <Button size="sm" className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> Nova meta
        </Button>
      </PageHeader>

      {/* KPIs */}
      <GoalsKPIs
        total={total}
        emAtraso={emAtraso}
        concluidas={concluidas}
        percentConcluidas={percentConcluidas}
      />

      {/* PROGRESSO GLOBAL */}
      <GlobalProgress percentConcluidas={percentConcluidas} />

      {/* METAS DETALHADAS */}
      <CategoryList
        metasPorCategoria={metasPorCategoria}
        onEdit={openEdit}
        onDelete={setGoalToDelete}
      />

      {/* DIALOG DE CONFIRMAÇÃO DE EXCLUSÃO */}
      <Dialog open={!!goalToDelete} onOpenChange={() => setGoalToDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir meta</DialogTitle>
            <DialogDescription>Deseja apagar <strong>{goalToDelete?.name}</strong>?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalToDelete(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { if (goalToDelete) removeGoal(goalToDelete.id); setGoalToDelete(null); }}>Confirmar Exclusão</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE CRIAÇÃO/EDIÇÃO */}
      <GoalFormDialog
        open={open}
        onOpenChange={setOpen}
        editingGoalId={editingGoalId}
        setEditingGoalId={setEditingGoalId}
      />
    </div>
  );
}