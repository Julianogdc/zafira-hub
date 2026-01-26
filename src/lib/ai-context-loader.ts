import { supabase } from './supabase';

interface FinanceContext {
    balance: number;
    income: number;
    expenses: number;
    recentTransactions: string[];
}

interface CRMContext {
    totalLeads: number;
    byStatus: Record<string, number>;
    highValueLeads: string[];
}

interface GoalsContext {
    activeGoals: string[];
}

interface BusinessContext {
    finance?: FinanceContext;
    crm?: CRMContext;
    goals?: GoalsContext;
    clients?: string;
}

export const getFinanceContext = async (userId?: string): Promise<FinanceContext> => {
    try {
        const query = supabase.from('finance_transactions').select('*').order('date', { ascending: false });

        // If not admin, maybe filter by user? But usually finance is sensitive.
        // For now we assume the caller checks permissions (Rbac) before calling or the AI Engine handles it.
        // RLS policies will handle the row level security anyway.

        const { data: transactions, error } = await query.limit(50);
        if (error) throw error;

        let income = 0;
        let expenses = 0;
        const recentTx: string[] = [];

        transactions?.forEach(t => {
            const amount = Number(t.amount) || 0;
            if (t.type === 'income') income += amount;
            if (t.type === 'expense') expenses += amount;
        });

        // Formatting last 5 for context
        transactions?.slice(0, 5).forEach(t => {
            recentTx.push(`${t.date}: ${t.description} (R$ ${t.amount}) - ${t.type}`);
        });

        return {
            balance: income - expenses,
            income,
            expenses,
            recentTransactions: recentTx
        };
    } catch (error) {
        console.error("Error loading finance context", error);
        return { balance: 0, income: 0, expenses: 0, recentTransactions: [] };
    }
};

export const getCRMContext = async (): Promise<CRMContext> => {
    try {
        const { data: leads, error } = await supabase.from('leads').select('*').limit(100);
        if (error) throw error;

        const byStatus: Record<string, number> = {};
        const highValue: string[] = [];

        leads?.forEach(l => {
            byStatus[l.status] = (byStatus[l.status] || 0) + 1;
            if (l.value && l.value > 1000) { // Arbitrary high value threshold
                highValue.push(`${l.name} (${l.company}): R$ ${l.value} [${l.status}]`);
            }
        });

        return {
            totalLeads: leads?.length || 0,
            byStatus,
            highValueLeads: highValue.slice(0, 5)
        };
    } catch (error) {
        console.error("Error loading CRM context", error);
        return { totalLeads: 0, byStatus: {}, highValueLeads: [] };
    }
};

export const getGoalsContext = async (): Promise<GoalsContext> => {
    try {
        const { data: goals, error } = await supabase.from('goals').select('*').eq('active', true);
        if (error) throw error;

        const formatted = goals?.map(g => {
            return `${g.name}: ${g.progress}% completed (Current: ${g.current_value}, Target: ${g.target_value})`;
        });

        return {
            activeGoals: formatted || []
        };
    } catch (error) {
        console.error("Error loading Goals context", error);
        return { activeGoals: [] };
    }
};

export const getClientsContext = async (): Promise<string> => {
    try {
        // Fetch ALL clients with related data
        const { data: clients, error } = await supabase
            .from('clients')
            .select(`
                *,
                contracts:client_contracts(*),
                paymentHistory:client_payments(*)
            `);

        if (error) throw error;

        if (!clients || clients.length === 0) return "No clients found.";

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const currentMonthKey = `${(currentMonth + 1).toString().padStart(2, '0')}/${currentYear}`;

        let totalMRR = 0;
        let pendingRevenue = 0;
        let activeCount = 0;
        let inactiveCount = 0;

        const detailedList: string[] = [];

        clients.forEach((c: any) => {
            const isActive = c.status === 'active';
            const value = Number(c.contract_value) || 0;

            if (isActive) {
                totalMRR += value;
                activeCount++;
            } else {
                inactiveCount++;
            }

            // Check Payment Status for Current Month
            const paymentRecord = c.paymentHistory?.find((p: any) => p.month === currentMonthKey);
            const isPaid = paymentRecord?.status === 'paid';

            if (isActive && !isPaid) {
                pendingRevenue += value;
            }

            // Format Payment Day
            const payDay = c.payment_day ? `Day ${c.payment_day}` : 'No fixed day';

            // Recent History (Last 3 months)
            // Simplified for now, just listing status

            detailedList.push(
                `- ${c.name} (${c.status.toUpperCase()}): Value R$ ${value.toFixed(2)}. PayDay: ${payDay}. ` +
                `Current Month (${currentMonthKey}): ${isPaid ? 'PAID' : 'PENDING'}. ` +
                `Contracts: ${c.contracts?.length || 0}.`
            );
        });

        return `
[CLIENTS INTELLIGENCE]
Total Clients: ${clients.length} (Active: ${activeCount}, Inactive: ${inactiveCount})
Current MRR: R$ ${totalMRR.toFixed(2)}
Potential/Pending Revenue (This Month): R$ ${pendingRevenue.toFixed(2)}

DETAILED CLIENT LIST:
${detailedList.join('\n')}
        `.trim();

    } catch (error) {
        console.error("Error loading Clients context", error);
        return "Error loading client data.";
    }
};

export const getPerformanceContext = async (): Promise<string> => {
    try {
        // Try to get tracked client IDs first (gracefully)
        let trackedIds: string[] = [];
        try {
            const { data: trackedData } = await supabase.from('performance_clients').select('client_id');
            if (trackedData) trackedIds = trackedData.map(d => d.client_id);
        } catch (e) {
            // Table might not exist yet, ignoring
        }

        let query = supabase
            .from('performance_reports')
            .select(`
                *,
                client:clients(name)
            `);

        if (trackedIds.length > 0) {
            query = query.in('client_id', trackedIds);
        }

        const { data: reports, error } = await query.order('month', { ascending: false });

        if (error) throw error;
        if (!reports || reports.length === 0) return "No performance reports found.";

        const latestMonth = reports[0].month;
        const currentReports = reports.filter(r => r.month === latestMonth);

        const summaries = currentReports.map(r => {
            return `- Client: ${r.client?.name || 'Unknown'}, Month: ${r.month}, ` +
                `Spend: R$ ${r.total_spend.toFixed(2)}, Results: ${r.total_results}, ` +
                `CTR: ${r.avg_ctr.toFixed(2)}%, CPC: R$ ${r.avg_cpc.toFixed(2)}. ` +
                `Campaigns: ${r.campaigns?.length || 0}.`;
        });

        return `
[PERFORMANCE INTELLIGENCE - ${latestMonth}]
Total Managed Spend: R$ ${currentReports.reduce((acc, r) => acc + r.total_spend, 0).toFixed(2)}
Total Results: ${currentReports.reduce((acc, r) => acc + r.total_results, 0)}

CLIENT REPORTS SUMMARY:
${summaries.join('\n')}
        `.trim();
    } catch (error) {
        console.error("Error loading Performance context", error);
        return "Error loading performance data.";
    }
};

export const loadSummarizedContext = async (permissions: {
    canReadFinance: boolean;
    canReadClients: boolean;
    canReadGoals: boolean;
    canReadCRM?: boolean;
    canReadPerformance?: boolean;
}): Promise<string> => {
    const parts: string[] = [];

    if (permissions.canReadFinance) {
        const fin = await getFinanceContext();
        parts.push(`\n[FINANCE DATA]\nBalance: R$ ${fin.balance.toFixed(2)}\nIncome: R$ ${fin.income.toFixed(2)}\nExpenses: R$ ${fin.expenses.toFixed(2)}\nLast 5 Transactions:\n${fin.recentTransactions.join('\n')}`);
    }

    if (permissions.canReadClients) { // Treating Clients as CRM/Clients mostly
        const crm = await getCRMContext();
        const clientsStr = await getClientsContext();
        parts.push(`\n[CRM & CLIENTS DATA]\n${clientsStr}\nActive Leads: ${crm.totalLeads}\nLeads by Status: ${JSON.stringify(crm.byStatus)}\nHigh Value Leads:\n${crm.highValueLeads.join('\n')}`);
    }

    if (permissions.canReadGoals) {
        const goals = await getGoalsContext();
        parts.push(`\n[GOALS DATA]\n${goals.activeGoals.join('\n')}`);
    }

    // Performance is forced enabled if we have access to clients usually, or explicit
    const perfData = await getPerformanceContext();
    parts.push(`\n[PERFORMANCE DATA]\n${perfData}`);

    return parts.join("\n\n");
};
