import { useState } from 'react';
import { generateInsight } from '../../lib/ai-engine';
import { PERSONAS } from '../../data/ai-personas';
import { Button } from '@/components/ui/button';
import { Brain, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PerformanceReport } from '../../types/performance';
import ReactMarkdown from 'react-markdown';

interface AIAnalysisPanelProps {
    report: PerformanceReport;
    clientName: string;
    onResultGenerate?: (result: string) => void;
}

export const AIAnalysisPanel = ({ report, clientName, onResultGenerate }: AIAnalysisPanelProps) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const trafficPersona = PERSONAS.find(p => p.id === 'traffic_manager');

            const customPrompt = `
                Analise o desempenho de tráfego do cliente ${clientName} para o mês ${report.month}.
                Métricas Principais:
                - Investimento: R$ ${report.totalSpend.toFixed(2)}
                - Resultados: ${report.totalResults}
                - CTR Médio: ${report.avgCtr.toFixed(2)}%
                - CPC Médio: R$ ${report.avgCpc.toFixed(2)}

                Campanhas detalhadas:
                ${report.campaigns.map(c => `- ${c.name}: R$ ${c.spend} spent, ${c.results} results, ${c.ctr}% CTR`).join('\n')}

                Por favor, forneça:
                1. Um resumo executivo do mês.
                2. Identificação dos 2 maiores gargalos.
                3. Sugestão prática para o próximo mês.
            `;

            const response = await generateInsight('performance', customPrompt, {
                systemPromptOverride: trafficPersona?.systemPrompt
            });

            setResult(response.content);
            if (onResultGenerate) onResultGenerate(response.content);
            toast.success("Análise gerada com sucesso!");
        } catch (error: any) {
            console.error(error);
            toast.error("Falha ao gerar análise: " + error.message);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-4">
            {!result ? (
                <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
                    <div className="p-4 rounded-full bg-purple-500/10">
                        <Brain className={`h-10 w-10 text-purple-500 ${isGenerating ? 'animate-pulse' : ''}`} />
                    </div>
                    <div className="max-w-md space-y-2">
                        <h3 className="text-lg font-bold">Solicitar Diagnóstico Mensal</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Nossa IA irá processar os {report.campaigns.length} itens de campanha,
                            comparar métricas e gerar um relatório acionável em segundos.
                        </p>
                    </div>
                    <Button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-500/20 gap-2 min-w-[200px]"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Analisando dados...
                            </>
                        ) : (
                            <>
                                <Sparkles className="h-4 w-4" />
                                Gerar Relatório IA
                            </>
                        )}
                    </Button>
                </div>
            ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-400 flex items-center gap-2">
                            <Sparkles className="h-4 w-4" />
                            Parecer Técnico - Gestor de Tráfego AI
                        </h3>
                        <Button variant="ghost" size="sm" onClick={() => setResult(null)} className="text-xs">
                            Recalcular
                        </Button>
                    </div>

                    <div className="prose prose-invert prose-sm max-w-none bg-background/50 border border-purple-500/20 p-6 rounded-2xl shadow-inner overflow-y-auto max-h-[500px]">
                        <ReactMarkdown>
                            {result}
                        </ReactMarkdown>
                    </div>

                    <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex gap-3 items-start">
                        <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Esta análise é gerada por inteligência artificial com base nos dados importados.
                            Use-a como um suporte para tomada de decisão estratégica.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};
