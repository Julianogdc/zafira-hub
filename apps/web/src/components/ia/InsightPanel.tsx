import React, { useMemo } from 'react';
import { useSystemSnapshot } from '@/hooks/useSystemSnapshot';
import { useAIStore } from '@/store/useAIStore';
import { generateDashboardInsights } from '@/lib/ai-engine';
import { DashboardInsight, InsightRiskLevel } from '@/types/ai';
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle, ShieldAlert, ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { AISettingsDialog } from './AISettingsDialog'; // Importando para poder abrir

const RISK_STYLES: Record<InsightRiskLevel, { border: string, bg: string, text: string, icon: any }> = {
  critical: { border: "border-red-500/30", bg: "bg-red-500/5", text: "text-red-200", icon: ShieldAlert },
  warning: { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-200", icon: AlertTriangle },
  opportunity: { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-200", icon: TrendingUp },
  neutral: { border: "border-slate-500/20", bg: "bg-slate-500/5", text: "text-slate-300", icon: CheckCircle }
};

const InsightCard = ({ insight }: { insight: DashboardInsight }) => {
  const style = RISK_STYLES[insight.riskLevel];
  const Icon = style.icon;
  return (
    <div className={cn("p-4 rounded-xl border backdrop-blur-sm transition-all hover:bg-opacity-20", style.border, style.bg)}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-lg bg-black/20", style.text)}><Icon className="w-4 h-4" /></div>
          <span className={cn("text-xs font-bold uppercase tracking-wider opacity-80", style.text)}>{insight.domain}</span>
        </div>
      </div>
      <h3 className="text-sm font-semibold text-white mb-1">{insight.title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed">{insight.content}</p>
    </div>
  );
};

export function InsightPanel() {
  const navigate = useNavigate();
  const snapshot = useSystemSnapshot();
  const { settings } = useAIStore();
  const [showSettings, setShowSettings] = React.useState(false);

  // Gera insights
  const insights = useMemo(() => {
    // Mesmo se estiver false, tentamos gerar para ver se existem dados, mas não exibimos o conteúdo sensível
    // Se a flag principal estiver OFF, retornamos array vazio para cair no "Empty State"
    if (!settings.autoGenerateInsights) return [];

    return generateDashboardInsights(snapshot, {
      canReadFinance: settings.canReadFinance,
      canReadGoals: settings.canReadGoals,
      canReadClients: settings.canReadClients
    });
  }, [snapshot, settings]);

  // ESTADO 1: Desativado nas configurações (Mostra card de ativação)
  if (!settings.autoGenerateInsights) {
    return (
      <section className="mb-8 p-6 rounded-xl border border-dashed border-white/10 bg-white/5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-full bg-white/5"><Lock className="w-5 h-5 text-slate-400" /></div>
          <div>
            <h3 className="text-sm font-semibold text-white">Insights Desativados</h3>
            <p className="text-xs text-slate-400">A camada de inteligência está em repouso. Ative para ver análises.</p>
          </div>
        </div>
        <button onClick={() => setShowSettings(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors">
          Configurar IA
        </button>
        <AISettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      </section>
    );
  }

  // ESTADO 2: Ativado, mas sem dados (Todas as permissões OFF ou sem dados nas stores)
  if (insights.length === 0) {
    return (
      <section className="mb-8 p-6 rounded-xl border border-white/10 bg-gradient-to-r from-purple-500/10 to-transparent flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-full bg-purple-500/20"><Sparkles className="w-5 h-5 text-purple-400 animate-pulse" /></div>
          <div>
            <h3 className="text-sm font-semibold text-white">Aguardando Dados...</h3>
            <p className="text-xs text-slate-400">Verifique se as permissões de leitura (Finanças, Metas) estão ativas nas configurações.</p>
          </div>
        </div>
        <button onClick={() => setShowSettings(true)} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-colors">
          Revisar Permissões
        </button>
        <AISettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      </section>
    );
  }

  // ESTADO 3: Tudo certo (Exibe os Cards)
  return (
    <section className="mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-medium text-slate-300">Insights Executivos</h2>
        </div>
        <button onClick={() => navigate('/ia-studio')} className="group flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors">
          <span>Abrir Studio</span>
          <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-1" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </section>
  );
}