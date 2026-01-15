import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { goalTypeLabels } from "@/hooks/useGoalMetrics";
import { useGoalsStore } from "@/store/useGoalsStore";
import { Goal, GoalCategory, GoalType } from "@/types/goals";

import { useAuthStore } from "@/store/useAuthStore";
import { useEffect, useState } from "react";

interface GoalFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingGoalId: string | null;
    setEditingGoalId: (id: string | null) => void;
}

export function GoalFormDialog({
    open,
    onOpenChange,
    editingGoalId,
    setEditingGoalId
}: GoalFormDialogProps) {
    const { form, setForm, addGoal, updateGoal, resetForm } = useGoalsStore();
    const { user, fetchOrganizationMembers } = useAuthStore();
    const [colleagues, setColleagues] = useState<any[]>([]);

    useEffect(() => {
        if (open && (user?.role === 'admin' || user?.role === 'manager')) {
            fetchOrganizationMembers().then(setColleagues);
        }
    }, [open, user, fetchOrganizationMembers]);

    function handleSaveGoal() {
        if (!form.name || !form.startDate || !form.endDate) return;
        if (form.type !== 'checklist' && (!form.targetValue || Number(form.targetValue) <= 0)) return;

        // Adiciona T12:00:00 para fixar no meio do dia e evitar bug de fuso horário
        const start = new Date(`${form.startDate}T12:00:00`).getTime();
        const end = new Date(`${form.endDate}T12:00:00`).getTime();

        if (editingGoalId) {
            updateGoal(editingGoalId, {
                ...form,
                targetValue: Number(form.targetValue),
                startDate: start,
                endDate: end
            });
        } else {
            setForm({
                targetValue: Number(form.targetValue),
                startDate: start,
                endDate: end
            } as any);
            addGoal();
        }
        onOpenChange(false);
        setEditingGoalId(null);
        resetForm();
    }

    const handleClose = () => {
        onOpenChange(false);
        setEditingGoalId(null);
        resetForm();
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{editingGoalId ? "Editar meta" : "Criar nova meta"}</DialogTitle>
                    <DialogDescription>Defina o objetivo, prazos e formato da sua meta.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="grid gap-1.5">
                        <Label>Nome do Objetivo</Label>
                        <Input
                            placeholder="Ex: Aumentar leads em 20%"
                            value={form.name}
                            onChange={(e) => setForm({ name: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-1.5">
                            <Label>Categoria</Label>
                            <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.category}
                                onChange={(e) => setForm({ category: e.target.value as GoalCategory })}
                            >
                                <option value="financeiro">Financeiro</option>
                                <option value="comercial">Comercial</option>
                                <option value="marketing">Marketing</option>
                                <option value="operacional">Operacional</option>
                            </select>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Formato</Label>
                            <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.type}
                                onChange={(e) => setForm({ type: e.target.value as GoalType })}
                            >
                                <option value="monetary">Financeira (R$)</option>
                                <option value="numeric">Numérica (Qtd)</option>
                                <option value="checklist">Tarefas (Lista)</option>
                            </select>
                        </div>
                    </div>
                    {form.type !== 'checklist' && (
                        <div className="grid gap-1.5">
                            <Label>{form.type === 'monetary' ? 'Valor Alvo (R$)' : 'Quantidade Alvo'}</Label>
                            <Input
                                type="number"
                                value={form.targetValue}
                                onChange={(e) => setForm({ targetValue: Number(e.target.value) })}
                            />
                        </div>
                    )}
                    {(form.type === 'monetary' || form.type === 'numeric') && (
                        <div className="grid gap-1.5">
                            <Label>Automação (Rastreio Automático)</Label>
                            <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.automationBinding || ''}
                                onChange={(e) => setForm({ automationBinding: e.target.value as any })}
                            >
                                <option value="">Manual (Sem vínculo)</option>

                                {form.type === 'monetary' && (
                                    <>
                                        <optgroup label="Financeiro">
                                            <option value="revenue_monthly">Receita Mensal</option>
                                            <option value="revenue_yearly">Receita Anual</option>
                                            <option value="expenses_monthly">Despesas Mensais</option>
                                            <option value="profit_margin">Margem de Lucro</option>
                                            <option value="cash_balance">Saldo em Caixa</option>
                                        </optgroup>
                                        <optgroup label="CRM (Comercial)">
                                            <option value="crm_total_sales">Vendas Totais (R$)</option>
                                        </optgroup>
                                    </>
                                )}

                                {form.type === 'numeric' && (
                                    <optgroup label="CRM (Comercial)">
                                        <option value="crm_deals_closed">Vendas Fechadas (Qtd)</option>
                                        <option value="crm_leads_created">Novos Leads (Qtd)</option>
                                    </optgroup>
                                )}
                            </select>
                            <p className="text-[10px] text-muted-foreground">
                                O progresso será atualizado automaticamente com base nos dados.
                            </p>
                        </div>
                    )}

                    {/* ASSIGNEE SELECTOR (Admin & Manager) */}
                    {(user?.role === 'admin' || user?.role === 'manager') && (
                        <div className="grid gap-1.5">
                            <Label>Responsável</Label>
                            <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.assignedTo === null ? 'unassigned' : (form.assignedTo || '')}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setForm({ assignedTo: val === 'unassigned' ? null : (val || undefined) });
                                }}
                            >
                                <option value="unassigned">-- Geral (Sem Responsável) --</option>
                                <option value="">Eu mesmo ({user.name})</option>
                                {colleagues.map((colleague: any) => (
                                    <option key={colleague.id} value={colleague.id}>
                                        {colleague.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="grid gap-1.5">
                        <Label>Visibilidade</Label>
                        <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={form.visibility}
                            onChange={(e) => setForm({ visibility: e.target.value as any })}
                        >
                            <option value="private">Individual (Pessoa Específica)</option>
                            <option value="partners">Sócios (Admin & Managers)</option>
                            <option value="public">Membros (Toda a Equipe)</option>
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-1.5">
                            <Label>Início</Label>
                            <Input
                                type="date"
                                value={form.startDate ? String(form.startDate) : ''}
                                onChange={(e) => setForm({ startDate: e.target.value as any })}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Fim</Label>
                            <Input
                                type="date"
                                value={form.endDate ? String(form.endDate) : ''}
                                onChange={(e) => setForm({ endDate: e.target.value as any })}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                    <Button onClick={handleSaveGoal}>Salvar meta</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
