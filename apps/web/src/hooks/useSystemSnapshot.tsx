import { useMemo } from 'react';
import { useFinanceStore } from '../store/useFinanceStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useClientStore } from '../store/useClientStore';
import { SystemSnapshot } from '../types/ai';

export function useSystemSnapshot(): SystemSnapshot {
  // 1. Leitura das fontes de dados
  const { transactions } = useFinanceStore();
  const { goals } = useGoalsStore();
  const { clients } = useClientStore();

  // 2. Processamento dos dados (Memoizado para performance)
  const snapshot = useMemo(() => {
    // --- CÁLCULOS FINANCEIROS ---
    // Assumindo que Transaction tem { type: 'income' | 'outcome', amount: number }
    // Ajuste 'amount' ou 'value' conforme seu type Transaction real
    const financeData = transactions.reduce(
      (acc, t: any) => {
        const value = Number(t.amount || t.value || 0);
        if (t.type === 'income' || t.type === 'receita') {
          acc.revenue += value;
          acc.balance += value;
        } else if (t.type === 'outcome' || t.type === 'despesa') {
          acc.expenses += value;
          acc.balance -= value;
        }
        return acc;
      },
      { revenue: 0, expenses: 0, balance: 0 }
    );

    // Burn Rate (quanto queimamos da receita)
    const burnRate = financeData.revenue > 0 
      ? Math.round((financeData.expenses / financeData.revenue) * 100) 
      : 0;


    // --- CÁLCULOS DE METAS ---
    const activeGoals = goals.filter(g => g.status === 'in_progress' || g.active);
    const completedGoals = goals.filter(g => g.status === 'achieved' || g.progress >= 100);
    
    // Risco simplificado: Ativas com menos de 50% de progresso
    const goalsAtRisk = activeGoals.filter(g => (g.progress || 0) < 50).length;
    
    const avgProgress = activeGoals.length > 0
      ? Math.round(activeGoals.reduce((acc, g) => acc + (g.progress || 0), 0) / activeGoals.length)
      : 0;


    // --- CÁLCULOS DE CLIENTES ---
    // Filtro simples para clientes ativos (se houver campo status, use-o)
    const activeClients = clients.length; // Assumindo todos na lista como ativos por enquanto
    
    // Exemplo de lógica de churn: Clientes sem contratos recentes (mockado por enquanto)
    const churnRisk = 0; 
    
    // Clientes novos este mês
    const currentMonth = new Date().getMonth();
    const newClients = clients.filter(c => {
        const created = new Date(c.createdAt || Date.now());
        return created.getMonth() === currentMonth;
    }).length;


    // 3. Montagem do Objeto Final
    return {
      finance: {
        balance: financeData.balance,
        revenue: financeData.revenue,
        expenses: financeData.expenses,
        burnRate,
        pendingContractsCount: 0 // Placeholder se não tivermos dados de contratos pendentes
      },
      goals: {
        total: goals.length,
        completed: completedGoals.length,
        atRisk: goalsAtRisk,
        averageProgress: avgProgress
      },
      clients: {
        totalActive: activeClients,
        churnRiskCount: churnRisk,
        newClientsThisMonth: newClients
      },
      timestamp: new Date()
    };

  }, [transactions, goals, clients]);

  return snapshot;
}