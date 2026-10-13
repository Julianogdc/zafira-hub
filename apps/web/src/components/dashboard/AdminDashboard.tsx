import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowUpRight,
    ArrowDownRight,
    Wallet,
    Target,
    AlertTriangle,
    Clock,
    CheckCircle2,
    ChevronRight,
    AlertCircle
} from 'lucide-react';

import { useFinanceStore } from '@/store/useFinanceStore';
import { useClientStore } from '@/store/useClientStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useGoalsStore } from '@/store/useGoalsStore';
import { Goal } from '@/types/goals';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { CashFlowChart } from '@/components/dashboard/charts/CashFlowChart';
import { SalesFunnelChart } from '@/components/dashboard/charts/SalesFunnelChart';
import { BarChart3, Filter } from 'lucide-react';

import { InsightPanel } from '@/components/ia/InsightPanel';
import { MotivationalQuote } from '@/components/dashboard/MotivationalQuote';
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

/* --- HELPERS (Copied from Index.tsx) --- */
function getCurrentValue(goal: Goal, finance: any): number {
    try {
        if (goal.automationBinding) {
            switch (goal.automationBinding) {
                case "revenue_monthly": {
                    const now = new Date();
                    return finance?.transactions?.filter((t: any) => {
                        const d = new Date(t.date);
                        return t.type === "income" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                    })?.reduce((sum: number, t: any) => sum + t.amount, 0) ?? 0;
                }
                case "expenses_monthly": return Number(finance?.expenses?.monthly ?? 0);
                case "cash_balance": return Number(finance?.cash ?? 0);
            }
        }
        return Number(goal.currentValue || 0);
    } catch { return 0; }
}

function getExpectedProgress(goal: Goal) {
    if (!goal.startDate || !goal.endDate) return 0;
    const now = Date.now();
    if (now <= goal.startDate) return 0;
    if (now >= goal.endDate) return 1;
    return (now - goal.startDate) / (goal.endDate - goal.startDate);
}

function getStatus(progress: number, expected: number) {
    const tolerance = 0.05;
    if (progress >= 1) return "achieved";
    if (progress + tolerance < expected) return "off_track";
    return "in_progress";
}

export function AdminDashboard() {
    const [featuredGoalId, setFeaturedGoalId] = React.useState<string | null>(null);

    const navigate = useNavigate();
    const finance = useFinanceStore();
    const { transactions } = finance;

    const now = new Date();
    const currentMonthTrans = transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const income = currentMonthTrans.filter(t => t.type === 'income').reduce((acc, curr) => acc + curr.amount, 0);
    const expense = currentMonthTrans.filter(t => t.type === 'expense').reduce((acc, curr) => acc + curr.amount, 0);
    const totalBalance = transactions.reduce((acc, curr) => curr.type === 'income' ? acc + curr.amount : acc - curr.amount, 0);

    const { clients: allClients } = useClientStore();
    const { user } = useAuthStore();
    const clients = allClients.filter(c => !c.ownerId || c.ownerId === user?.id);

    const expiringContracts = clients.filter(c => {
        if (!c.contractEnd || c.status !== 'active') return false;
        const end = new Date(c.contractEnd);
        const diffTime = end.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays >= -5 && diffDays <= 30;
    });

    const { goals: allGoals } = useGoalsStore();
    const goals = allGoals.filter(g => !g.ownerId || g.ownerId === user?.id);
    const activeRawGoals = goals.filter(g => g.active);

    const calculatedGoals = activeRawGoals.map(goal => {
        const current = getCurrentValue(goal, finance);
        const safeTarget = goal.targetValue > 0 ? goal.targetValue : 1;
        const progress = Math.max(0, current / safeTarget);
        const expected = getExpectedProgress(goal);
        const status = getStatus(progress, expected);
        return { ...goal, currentValue: current, progress, status };
    });

    const featuredGoal = featuredGoalId
        ? calculatedGoals.find(g => g.id === featuredGoalId)
        : (calculatedGoals.length > 0 ? calculatedGoals[0] : null);

    React.useEffect(() => {
        if (!featuredGoalId && calculatedGoals.length > 0) {
            setFeaturedGoalId(calculatedGoals[0].id);
        }
    }, [featuredGoalId, calculatedGoals]);

    const activeGoalsInProgress = calculatedGoals.filter(g => g.status === 'in_progress');
    const completedGoalsCount = calculatedGoals.filter(g => g.status === 'achieved').length;
    const lateGoals = calculatedGoals.filter(g => g.status === 'off_track');

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);


    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Headers ... */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {/* SidebarTrigger removed */}
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white">Visão Geral</h1>
                        <p className="text-zinc-400 mt-2">Resumo executivo da operação Zafira.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <NotificationBell />
                    <div className="text-right hidden sm:block">
                        <p className="text-sm text-zinc-500 capitalize">
                            {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <InsightPanel />
                </div>
                <div className="lg:col-span-1">
                    <MotivationalQuote />
                </div>
            </div>

            {/* 1. CARDS SELECTIONS (Moved to Top) */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div
                    className="p-6 rounded-xl bg-zinc-950/50 border border-white/10 backdrop-blur-sm relative overflow-hidden group cursor-pointer hover:border-white/20 transition-colors"
                    onClick={() => navigate('/financas')}
                >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Wallet className="w-16 h-16 text-white" />
                    </div>
                    <div className="flex flex-col h-full justify-between">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="p-2 rounded-lg bg-zinc-900 border border-white/5 text-white">
                                <Wallet className="w-4 h-4" />
                            </span>
                            <span className="text-sm font-medium text-zinc-400">Caixa Atual</span>
                        </div>
                        <div>
                            <span className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-white' : 'text-red-400'}`}>
                                {formatCurrency(totalBalance)}
                            </span>
                            <p className="text-xs text-zinc-500 mt-1">Acumulado total</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 rounded-xl bg-zinc-950/50 border border-white/10 backdrop-blur-sm">
                    <div className="flex flex-col h-full justify-between">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                                <ArrowUpRight className="w-4 h-4" />
                            </span>
                            <span className="text-sm font-medium text-zinc-400">Receitas (Mês)</span>
                        </div>
                        <div>
                            <span className="text-2xl font-bold text-emerald-400">
                                {formatCurrency(income)}
                            </span>
                            <p className="text-xs text-zinc-500 mt-1">Entradas confirmadas</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 rounded-xl bg-zinc-950/50 border border-white/10 backdrop-blur-sm">
                    <div className="flex flex-col h-full justify-between">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500">
                                <ArrowDownRight className="w-4 h-4" />
                            </span>
                            <span className="text-sm font-medium text-zinc-400">Despesas (Mês)</span>
                        </div>
                        <div>
                            <span className="text-2xl font-bold text-red-400">
                                {formatCurrency(expense)}
                            </span>
                            <p className="text-xs text-zinc-500 mt-1">Saídas realizadas</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* NEW: ANALYTICS SECTION */}
            {/* NEW: ANALYTICS SECTION (Wrapped in Accordion) */}
            <Accordion type="single" collapsible defaultValue="analytics" className="border border-white/10 rounded-xl bg-zinc-950/30">
                <AccordionItem value="analytics" className="border-none">
                    <div className="px-6 py-4 flex items-center justify-between">
                        <AccordionTrigger className="hover:no-underline py-0">
                            <div className="flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-purple-400" />
                                <h3 className="text-lg font-semibold text-white">Analytics</h3>
                            </div>
                        </AccordionTrigger>
                    </div>
                    <AccordionContent className="px-6 pb-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Cash Flow Chart */}
                            <div className="p-6 rounded-xl bg-zinc-950/50 border border-white/10 backdrop-blur-sm">
                                <div className="flex items-center justify-between mb-6">
                                    <h4 className="text-sm font-medium text-zinc-300">Fluxo de Caixa (6 Meses)</h4>
                                    <div className="p-2 rounded-lg bg-zinc-900 border border-white/5">
                                        <Wallet className="w-4 h-4 text-emerald-500" />
                                    </div>
                                </div>
                                <CashFlowChart />
                            </div>

                            {/* Sales Funnel Chart */}
                            <div className="p-6 rounded-xl bg-zinc-950/50 border border-white/10 backdrop-blur-sm">
                                <div className="flex items-center justify-between mb-6">
                                    <h4 className="text-sm font-medium text-zinc-300">Funil de Vendas</h4>
                                    <div className="p-2 rounded-lg bg-zinc-900 border border-white/5">
                                        <Filter className="w-4 h-4 text-purple-500" />
                                    </div>
                                </div>
                                <SalesFunnelChart />
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            {/* GOALS SECTION (Wrapped in Accordion) */}
            <Accordion type="single" collapsible defaultValue="goals" className="border border-white/10 rounded-xl bg-zinc-950/30">
                <AccordionItem value="goals" className="border-none">
                    <div className="px-6 py-4 flex items-center justify-between">
                        <AccordionTrigger className="hover:no-underline py-0">
                            <div className="flex items-center gap-2">
                                <Target className="w-5 h-5 text-purple-400" />
                                <h3 className="text-lg font-semibold text-white">Performance de Metas</h3>
                            </div>
                        </AccordionTrigger>
                        <Button
                            variant="ghost"
                            className="text-xs text-zinc-400 hover:text-white hover:bg-zinc-900"
                            onClick={(e) => { e.stopPropagation(); navigate('/metas'); }}
                        >
                            Ver todas <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                    </div>
                    <AccordionContent className="px-6 pb-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-white/5">
                            <div className="flex flex-col justify-between">
                                <div className="grid grid-cols-3 gap-4 mb-4">
                                    <div className="text-center p-3 rounded-lg bg-zinc-900/50 border border-white/5">
                                        <span className="block text-2xl font-bold text-white">{activeGoalsInProgress.length}</span>
                                        <span className="text-xs text-zinc-500">Em Andamento</span>
                                    </div>
                                    <div className="text-center p-3 rounded-lg bg-zinc-900/50 border border-white/5">
                                        <span className="block text-2xl font-bold text-emerald-400">{completedGoalsCount}</span>
                                        <span className="text-xs text-zinc-500">Concluídas</span>
                                    </div>
                                    <div className="text-center p-3 rounded-lg bg-zinc-900/50 border border-white/5">
                                        <span className="block text-2xl font-bold text-red-400">{lateGoals.length}</span>
                                        <span className="text-xs text-zinc-500">Fora da Curva</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col justify-center">
                                {calculatedGoals.length > 0 ? (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1 mr-4">
                                                <span className="text-xs font-medium text-purple-400 uppercase tracking-wider mb-2 block">Meta em Destaque</span>
                                                <Select
                                                    value={featuredGoal?.id || ""}
                                                    onValueChange={setFeaturedGoalId}
                                                >
                                                    <SelectTrigger className="w-full h-auto text-xl font-bold bg-transparent border-none p-0 focus:ring-0 text-white shadow-none hover:bg-transparent data-[placeholder]:text-white [&>svg]:hidden">
                                                        <SelectValue placeholder="Selecione uma meta" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {calculatedGoals.map(g => (
                                                            <SelectItem key={g.id} value={g.id}>
                                                                {g.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <span className="text-lg font-bold text-white mt-1">
                                                {featuredGoal ? Math.round(featuredGoal.progress * 100) : 0}%
                                            </span>
                                        </div>
                                        {featuredGoal && (
                                            <>
                                                <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-purple-500 transition-all duration-500"
                                                        style={{ width: `${Math.min(100, featuredGoal.progress * 100)}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between text-xs text-zinc-500">
                                                    <span>Atual: {featuredGoal.category === 'financeiro' ? formatCurrency(featuredGoal.currentValue || 0) : featuredGoal.currentValue}</span>
                                                    <span>Alvo: {featuredGoal.category === 'financeiro' ? formatCurrency(featuredGoal.targetValue) : featuredGoal.targetValue}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-zinc-500 h-full">
                                        <CheckCircle2 className="w-8 h-8 mb-2 opacity-50" />
                                        <p>Nenhuma meta ativa no momento.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>





            <section>
                <h3 className="text-sm font-medium text-zinc-400 mb-4 uppercase tracking-wider">Pontos de Atenção</h3>
                {/* ... Alerts ... */}
                <div className="space-y-3">
                    {totalBalance < 0 && (
                        <div className="flex items-center justify-between p-4 rounded-lg bg-red-950/20 border border-red-500/20 animate-in slide-in-from-left-2">
                            <div className="flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 text-red-500" />
                                <div>
                                    <p className="text-sm font-medium text-red-200">Alerta Financeiro: Caixa Negativo</p>
                                    <p className="text-xs text-red-400/70">As despesas superam as receitas acumuladas.</p>
                                </div>
                            </div>
                            <Button variant="outline" size="sm" className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-950/50" onClick={() => navigate('/financas')}>
                                Ver Extrato
                            </Button>
                        </div>
                    )}

                    {expiringContracts.map(contract => (
                        <div key={contract.id} className="flex items-center justify-between p-4 rounded-lg bg-yellow-950/20 border border-yellow-500/20 animate-in slide-in-from-left-2">
                            <div className="flex items-center gap-3">
                                <Clock className="w-5 h-5 text-yellow-500" />
                                <div>
                                    <p className="text-sm font-medium text-yellow-200">Vencimento: {contract.name}</p>
                                    <p className="text-xs text-yellow-400/70">
                                        Vence em {new Date(contract.contractEnd!).toLocaleDateString('pt-BR')}
                                    </p>
                                </div>
                            </div>
                            <Button variant="outline" size="sm" className="border-yellow-500/30 bg-transparent text-yellow-400 hover:bg-yellow-950/50" onClick={() => navigate('/clientes')}>
                                Ver Contrato
                            </Button>
                        </div>
                    ))}

                    {lateGoals.length > 0 && (
                        <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-900 border border-white/10 animate-in slide-in-from-left-2">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="w-5 h-5 text-zinc-400" />
                                <div>
                                    <p className="text-sm font-medium text-zinc-200">{lateGoals.length} Metas Fora da Curva</p>
                                    <p className="text-xs text-zinc-500">Atenção ao progresso esperado.</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white" onClick={() => navigate('/metas')}>
                                Revisar
                            </Button>
                        </div>
                    )}

                    {totalBalance >= 0 && lateGoals.length === 0 && expiringContracts.length === 0 && (
                        <div className="p-8 text-center border border-white/5 rounded-xl bg-zinc-950/30 border-dashed">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
                            <p className="text-zinc-500">Operação estável. Nenhum alerta crítico.</p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
