import { useEffect } from 'react';
import { useGoalsStore } from '@/store/useGoalsStore';
import { useFinanceStore } from '@/store/useFinanceStore';
import { useCRMStore } from '@/store/useCRMStore';
import { Goal } from '@/types/goals';

export function useGoalAutomation() {
    const { goals, updateNumericProgress } = useGoalsStore();
    const { transactions } = useFinanceStore();
    const { leads } = useCRMStore();

    useEffect(() => {
        goals.forEach(goal => {
            if (!goal.active || !goal.automationBinding) return;

            let newValue = 0;
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

            // Helper to check date range of goal
            // Actually, usually users want "Current Month" progress for "Monthly" goals.
            // Or "Goal Period" progress?
            // Existing logic uses goal.startDate and goal.endDate.
            // Let's filter data based on goal start/end.
            const startDate = new Date(goal.startDate);
            const endDate = new Date(goal.endDate);

            // 1. Finance Automation
            if (goal.automationBinding.startsWith('revenue') ||
                goal.automationBinding.startsWith('expenses') ||
                goal.automationBinding === 'profit_margin' ||
                goal.automationBinding === 'cash_balance') {

                // Filter transactions within goal period
                const relevantTransactions = transactions.filter(t => {
                    const tDate = new Date(t.date);
                    return tDate >= startDate && tDate <= endDate;
                });

                if (goal.automationBinding === 'revenue_monthly' || goal.automationBinding === 'revenue_yearly') {
                    newValue = relevantTransactions
                        .filter(t => t.type === 'income')
                        .reduce((acc, t) => acc + t.amount, 0);
                } else if (goal.automationBinding === 'expenses_monthly') {
                    newValue = relevantTransactions
                        .filter(t => t.type === 'expense')
                        .reduce((acc, t) => acc + t.amount, 0);
                } else if (goal.automationBinding === 'profit_margin') {
                    const income = relevantTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
                    const expense = relevantTransactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
                    const profit = income - expense;
                    // Margin %? Or Absolute Profit? Usually Margin is %. 
                    // Let's assume absolute profit if targetValue is large, or % if calculated.
                    // But 'profit_margin' implies %. (Profit / Revenue) * 100.
                    newValue = income > 0 ? ((profit / income) * 100) : 0;
                } else if (goal.automationBinding === 'cash_balance') {
                    // Cash balance is total, not just period? 
                    // Or balance *change* in period?
                    // Let's assume Total Cumulative Balance (ignoring period start, just up to period end?)
                    // "Saldo em Caixa" usually means current status.
                    // Let's calculate total balance of ALL time up to now.
                    const allTime = transactions.filter(t => new Date(t.date) <= endDate);
                    const income = allTime.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
                    const expense = allTime.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
                    newValue = income - expense;
                }
            }

            // 2. CRM Automation
            else if (goal.automationBinding.startsWith('crm_')) {
                // Filter leads within goal period (created or updated?)
                // Depends on metric. "Leads Created" -> createdAt. "Deals Closed" -> updatedAt/closedAt?
                // We only have createdAt and updatedAt.

                if (goal.automationBinding === 'crm_leads_created') {
                    newValue = leads.filter(l => {
                        const d = new Date(l.createdAt);
                        return d >= startDate && d <= endDate;
                    }).length;
                } else if (goal.automationBinding === 'crm_deals_closed') {
                    newValue = leads.filter(l => {
                        // Use updatedAt for now as proxy for closing date if status is closed
                        // Ideally we'd have `closedAt`. 
                        // But let's use updatedAt if status is closed.
                        if (l.status !== 'closed') return false;
                        const d = new Date(l.updatedAt);
                        return d >= startDate && d <= endDate;
                    }).length;
                } else if (goal.automationBinding === 'crm_total_sales') {
                    newValue = leads
                        .filter(l => {
                            if (l.status !== 'closed') return false;
                            const d = new Date(l.updatedAt);
                            return d >= startDate && d <= endDate;
                        })
                        .reduce((acc, l) => acc + l.value, 0);
                }
            }

            // Update Store if Value Changed
            if (newValue !== goal.currentValue) {
                // Determine if we should update.
                // Round to 2 decimals for monetary/percentage
                const roundedNew = Math.round(newValue * 100) / 100;
                const roundedCurrent = Math.round((goal.currentValue || 0) * 100) / 100;

                if (roundedNew !== roundedCurrent) {
                    updateNumericProgress(goal.id, roundedNew);
                }
            }
        });
    }, [goals, transactions, leads, updateNumericProgress]);
}
