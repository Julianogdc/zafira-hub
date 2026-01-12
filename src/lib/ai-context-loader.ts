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
        const { data: clients, error } = await supabase.from('clients').select('name, status, contract_value').eq('status', 'active');
        if (error) throw error;

        const totalMRR = clients?.reduce((acc, c) => acc + (Number(c.contract_value) || 0), 0) || 0;
        return `Total Active Clients: ${clients?.length || 0}. Total Monthly Recurring Revenue (MRR): R$ ${totalMRR.toFixed(2)}.`;
    } catch (error) {
        console.error("Error loading Clients context", error);
        return "";
    }
};

export const loadSummarizedContext = async (permissions: { canReadFinance: boolean; canReadClients: boolean; canReadGoals: boolean; canReadCRM?: boolean }): Promise<string> => {
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

    return parts.join("\n\n");
};
