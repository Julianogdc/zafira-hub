import { useGoalsStore } from "../store/useGoalsStore";
import { Goal } from "../types/goals";
import { useAuthStore } from "../store/useAuthStore";

// Labels
export const goalTypeLabels: Record<string, string> = {
    revenue_monthly: "Faturamento Mensal",
    revenue_yearly: "Faturamento Anual",
    expenses_monthly: "Despesas Mensais",
    cash_balance: "Saldo em Caixa",
    profit_margin: "Margem de Lucro",
    growth_rate: "Taxa de Crescimento",
    // CRM
    crm_total_sales: "Vendas Totais (CRM)",
    crm_deals_closed: "Vendas Fechadas (CRM)",
    crm_leads_created: "Leads Criados (CRM)",
};

export function useGoalMetrics() {
    const { goals } = useGoalsStore();
    const { user } = useAuthStore();

    const activeGoals = goals.filter((g) => {
        if (g.active === false) return false;

        // RLS handles security. If we fetched it, we can see it.
        return true;
    });

    // CÁLCULO DE PROGRESSO
    const calculated = activeGoals.map((goal) => {
        let current = goal.currentValue || 0;
        let progress = 0;
        let status = goal.status || 'in_progress';

        if (goal.type === 'checklist') {
            progress = goal.progress ? goal.progress / 100 : 0;
        }
        else {
            // Numeric & Monetary (Atualizados via automação ou manual)
            const target = goal.targetValue || 1;
            progress = Math.min(current / target, 1.1);
            if (progress >= 1) status = 'achieved';
        }

        return { ...goal, progress, current, status };
    });

    const total = calculated.length;
    const concluidas = calculated.filter((g) => g.progress >= 1).length;
    const emAtraso = calculated.filter((g) => g.status === "off_track").length;
    const percentConcluidas = total === 0 ? 0 : Math.round((concluidas / total) * 100);

    const metasPorCategoria = Object.values(
        calculated.reduce((acc: any, g) => {
            const cat = g.category;
            if (!acc[cat]) {
                acc[cat] = {
                    label: cat.charAt(0).toUpperCase() + cat.slice(1),
                    metas: [],
                    total: 0,
                };
            }
            acc[cat].metas.push(g);
            acc[cat].total += g.progress;
            return acc;
        }, {})
    ).map((item: any) => ({
        pilar: item.label,
        progressoMedio: item.metas.length ? Math.round((item.total / item.metas.length) * 100) : 0,
        metas: item.metas,
    }));

    return {
        total,
        concluidas,
        emAtraso,
        percentConcluidas,
        metasPorCategoria,
        calculatedGoals: calculated
    };
}
