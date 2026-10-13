import { useState, useMemo } from 'react';
import { useFinanceStore } from '@/store/useFinanceStore';
import { Transaction } from '@/types/finance';

export type PeriodFilter = "current-month" | "last-month" | "current-year" | "custom";
import { DateRange } from "react-day-picker";

export function useFinanceMetrics() {
  const { transactions } = useFinanceStore();

  // States de Filtro
  const [period, setPeriod] = useState<PeriodFilter>("current-month");
  // const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // REMOVED in favor of DateRange
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Data Base
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // 1. Filtragem Principal
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const d = new Date(t.date);

      if (period === "custom") {
        if (dateRange?.from && dateRange?.to) {
          const from = new Date(dateRange.from); from.setHours(0, 0, 0, 0);
          const to = new Date(dateRange.to); to.setHours(23, 59, 59, 999);
          // Adjust t.date to local Midnight for fair comparison? Or just direct compare if ISO
          // Typically t.date is ISO or YYYY-MM-DD.
          // Assuming YYYY-MM-DD (as strings usually are in this app context, checking other files...)
          // The types file said ISO string.
          const tDate = new Date(t.date);
          return tDate >= from && tDate <= to;
        }
        if (dateRange?.from) {
          const from = new Date(dateRange.from); from.setHours(0, 0, 0, 0);
          return new Date(t.date) >= from;
        }
        return true; // if no range selected show all? or none? Show all for now.
      }

      if (period === "current-month") {
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }

      if (period === "last-month") {
        const lastMonth = new Date(currentYear, currentMonth - 1, 1);
        return (
          d.getMonth() === lastMonth.getMonth() &&
          d.getFullYear() === lastMonth.getFullYear()
        );
      }

      // current-year
      return d.getFullYear() === currentYear;
    });
  }, [transactions, period, dateRange, currentMonth, currentYear]);

  // 2. Cálculos Totais (Filtrados)
  const { receita, despesa, caixa } = useMemo(() => {
    const rec = filteredTransactions
      .filter((t) => t.type === "income")
      .reduce((acc, t) => acc + t.amount, 0);

    const desp = filteredTransactions
      .filter((t) => t.type === "expense")
      .reduce((acc, t) => acc + t.amount, 0);

    return { receita: rec, despesa: desp, caixa: rec - desp };
  }, [filteredTransactions]);

  // 3. Cálculos Anuais (Sempre fixo no ano corrente para o Resumo Anual)
  const yearTransactions = useMemo(() => {
    return transactions.filter((t) => new Date(t.date).getFullYear() === currentYear);
  }, [transactions, currentYear]);

  const { receitaAnual, despesaAnual, caixaAnual } = useMemo(() => {
    const rec = yearTransactions
      .filter((t) => t.type === "income")
      .reduce((acc, t) => acc + t.amount, 0);

    const desp = yearTransactions
      .filter((t) => t.type === "expense")
      .reduce((acc, t) => acc + t.amount, 0);

    return { receitaAnual: rec, despesaAnual: desp, caixaAnual: rec - desp };
  }, [yearTransactions]);

  const formatBRL = (value: number) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return {
    // Filtros
    period,
    setPeriod,
    dateRange,
    setDateRange,

    // Dados Filtrados
    filteredTransactions,
    receita,
    despesa,
    caixa,

    // Dados Anuais
    yearTransactions,
    receitaAnual,
    despesaAnual,
    caixaAnual,
    currentYear,

    // Helpers
    formatBRL
  };
}
