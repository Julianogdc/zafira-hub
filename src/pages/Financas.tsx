import { useState, useEffect } from "react";
import { useFinanceStore } from "@/store/useFinanceStore";
import { useFinanceMetrics } from "@/hooks/useFinanceMetrics";
import { FinanceKPIs } from "@/components/finance/FinanceKPIs";
import { FinanceFilters } from "@/components/finance/FinanceFilters";
import { TransactionList } from "@/components/finance/TransactionList";
import { AnnualSummary } from "@/components/finance/AnnualSummary";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { CashFlowChart } from "@/components/finance/CashFlowChart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Transaction } from "@/types/finance";

import { ExpensesPieChart } from "@/components/finance/ExpensesPieChart";
import { PageHeader } from "@/components/ui/PageHeader";
import { FileText, Plus, Wallet } from "lucide-react"; // Updated imports
import { generateFinanceReport } from "@/lib/exportUtils"; // Added generateFinanceReport

const Financas = () => {
  const { fetchFinance, initialized } = useFinanceStore();

  useEffect(() => {
    if (!initialized) {
      fetchFinance();
    }
  }, [initialized, fetchFinance]);

  // Hook com toda a lógica de dados e cálculos
  const {
    period, setPeriod,
    dateRange, setDateRange,
    filteredTransactions,
    receita, despesa, caixa,
    yearTransactions,
    receitaAnual, despesaAnual, caixaAnual,
    currentYear,
    formatBRL
  } = useFinanceMetrics();

  // Estado da Interface
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<"income" | "expense" | undefined>(undefined);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  // Handlers
  const openNew = (type: "income" | "expense") => {
    setEditingTransaction(null);
    setDialogType(type);
    setDialogOpen(true);
  };

  const openEdit = (t: Transaction) => {
    setEditingTransaction(t);
    setDialogType(undefined); // O tipo será inferido da transação
    setDialogOpen(true);
  };

  const handleExport = () => {
    generateFinanceReport(filteredTransactions, {
      receita,
      despesa,
      caixa,
      period: period === 'custom'
        ? 'Personalizado'
        : period === 'current-month' ? 'Mês Atual'
          : period === 'last-month' ? 'Mês Anterior' : 'Ano Atual'
    });
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      {/* HEADER */}
      <PageHeader
        title="Finanças"
        description="Gestão financeira centralizada da Zafira."
        icon={Wallet}
      >
        <Button variant="outline" onClick={handleExport} className="gap-2">
          <FileText className="w-4 h-4" />
          Exportar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
          onClick={() => openNew("income")}
        >
          <Plus className="mr-2 h-4 w-4" />
          Receita
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
          onClick={() => openNew("expense")}
        >
          <Plus className="mr-2 h-4 w-4" />
          Despesa
        </Button>
      </PageHeader>

      {/* FILTROS */}
      <FinanceFilters
        period={period}
        setPeriod={setPeriod}
        dateRange={dateRange}
        setDateRange={setDateRange}
      />

      {/* KPIs */}
      <FinanceKPIs
        caixa={caixa}
        receita={receita}
        despesa={despesa}
        formatBRL={formatBRL}
      />

      {/* FLUXO DE CAIXA + PIZZA CHARTS */}
      {
        period !== "current-year" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Fluxo de Caixa Ocupa toda a largura */}
            <Card className="bg-card/80 backdrop-blur-xl lg:col-span-2">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-6">
                <div>
                  <CardTitle>Fluxo de caixa</CardTitle>
                  <CardDescription>Evolução de receitas e despesas</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <CashFlowChart transactions={filteredTransactions} />
              </CardContent>
            </Card>

            {/* Pizza Despesas */}
            <Card className="bg-card/80 backdrop-blur-xl">
              <CardHeader>
                <CardTitle>Despesas por Categoria</CardTitle>
                <CardDescription>Top gastos do período</CardDescription>
              </CardHeader>
              <CardContent>
                <ExpensesPieChart transactions={filteredTransactions} />
              </CardContent>
            </Card>
          </div>
        )
      }

      {/* HISTÓRICO (somente fora do ano atual) */}
      {
        period !== "current-year" && (
          <TransactionList
            transactions={filteredTransactions}
            onEdit={openEdit}
            formatBRL={formatBRL}
          />
        )
      }

      {/* VISÃO ANUAL */}
      {
        period === "current-year" && (
          <AnnualSummary
            currentYear={currentYear}
            receitaAnual={receitaAnual}
            despesaAnual={despesaAnual}
            caixaAnual={caixaAnual}
            yearTransactions={yearTransactions}
            formatBRL={formatBRL}
          />
        )
      }

      {/* DIALOG DE CRIAÇÃO/EDIÇÃO */}
      <TransactionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={dialogType}
        editingTransaction={editingTransaction}
      />
    </div >
  );
};

export default Financas;