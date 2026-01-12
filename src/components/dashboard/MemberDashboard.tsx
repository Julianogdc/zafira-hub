import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { useGoalsStore } from '@/store/useGoalsStore';
import { MotivationalQuote } from '@/components/dashboard/MotivationalQuote';
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Briefcase, Target, Wrench, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MemberDashboard() {
    const { user } = useAuthStore();
    const navigate = useNavigate();
    const { goals, fetchGoals } = useGoalsStore();

    useEffect(() => {
        fetchGoals();
    }, [fetchGoals]);

    // Filter goals: Assigned to user OR Owned by user
    const myGoals = goals.filter(g => g.assignedTo === user?.id || g.ownerId === user?.id);
    const activeGoals = myGoals.filter(g => g.active && g.status === 'in_progress');
    const completedGoals = myGoals.filter(g => g.status === 'achieved');

    const now = new Date();

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* HEADER */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <SidebarTrigger />
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white">Olá, {user?.name?.split(' ')[0]}</h1>
                        <p className="text-zinc-400 mt-2">Aqui está o seu foco para hoje.</p>
                    </div>
                </div>
                <div className="text-right hidden sm:block">
                    <p className="text-sm text-zinc-500 capitalize">
                        {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                </div>
            </div>

            {/* MOTIVATION */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-3">
                    <MotivationalQuote />
                </div>
            </div>

            {/* SHORTCUTS / STATS */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div
                    className="p-6 rounded-xl bg-purple-950/20 border border-purple-500/20 hover:bg-purple-950/30 transition-colors cursor-pointer group"
                    onClick={() => navigate('/metas')}
                >
                    <div className="flex items-center justify-between mb-4">
                        <span className="p-2 rounded-lg bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20">
                            <Target className="w-5 h-5" />
                        </span>
                        <span className="text-2xl font-bold text-white">{activeGoals.length}</span>
                    </div>
                    <h3 className="text-sm font-medium text-purple-200">Metas Ativas</h3>
                    <p className="text-xs text-purple-400/60 mt-1">Focadas em você</p>
                </div>

                <div
                    className="p-6 rounded-xl bg-zinc-900/50 border border-white/5 hover:border-white/10 transition-colors cursor-pointer group"
                    onClick={() => navigate('/projetos')}
                >
                    <div className="flex items-center justify-between mb-4">
                        <span className="p-2 rounded-lg bg-zinc-800 text-zinc-400 group-hover:text-white">
                            <Briefcase className="w-5 h-5" />
                        </span>
                    </div>
                    <h3 className="text-sm font-medium text-zinc-200">Meus Projetos</h3>
                    <p className="text-xs text-zinc-500 mt-1">Tarefas do Asana</p>
                </div>

                <div
                    className="p-6 rounded-xl bg-zinc-900/50 border border-white/5 hover:border-white/10 transition-colors cursor-pointer group"
                    onClick={() => navigate('/ferramentas')}
                >
                    <div className="flex items-center justify-between mb-4">
                        <span className="p-2 rounded-lg bg-zinc-800 text-zinc-400 group-hover:text-white">
                            <Wrench className="w-5 h-5" />
                        </span>
                    </div>
                    <h3 className="text-sm font-medium text-zinc-200">Ferramentas</h3>
                    <p className="text-xs text-zinc-500 mt-1">Acesso rápido</p>
                </div>

                <div
                    className="p-6 rounded-xl bg-zinc-900/50 border border-white/5 hover:border-white/10 transition-colors cursor-pointer group"
                    onClick={() => navigate('/ia-studio')}
                >
                    <div className="flex items-center justify-between mb-4">
                        <span className="p-2 rounded-lg bg-zinc-800 text-zinc-400 group-hover:text-indigo-400">
                            <Sparkles className="w-5 h-5" />
                        </span>
                    </div>
                    <h3 className="text-sm font-medium text-zinc-200">IA Studio</h3>
                    <p className="text-xs text-zinc-500 mt-1">Assistente Pessoal</p>
                </div>
            </section>

            {/* MINHAS METAS (Detailed) */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Progresso das Metas</h2>
                {activeGoals.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeGoals.map(goal => (
                            <div key={goal.id} className="p-4 rounded-xl bg-zinc-950/30 border border-white/10">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-medium text-zinc-200">{goal.name}</h3>
                                    <span className="text-sm font-bold text-white">{Math.round(goal.progress * 100)}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden mb-2">
                                    <div
                                        className="h-full bg-purple-500"
                                        style={{ width: `${Math.min(100, goal.progress * 100)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs text-zinc-500">
                                    <span>Atual: {goal.currentValue}</span>
                                    <span>Alvo: {goal.targetValue}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-8 text-center border border-white/5 rounded-xl bg-zinc-950/30 border-dashed">
                        <CheckCircle2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                        <p className="text-zinc-500">Você não tem metas ativas no momento.</p>
                    </div>
                )}
            </section>
        </div>
    );
}
