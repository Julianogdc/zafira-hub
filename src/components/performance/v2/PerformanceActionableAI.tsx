import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PerformanceReport } from '@/types/performance';
import { Client } from '@/types/client';

interface PerformanceActionableAIProps {
    report: PerformanceReport;
    client: Client;
}

export function PerformanceActionableAI({ report, client }: PerformanceActionableAIProps) {

    const insights = useMemo(() => {
        if (!report || report.campaigns.length === 0) return null;

        // Apenas campanhas ativas
        const activeCampaigns = report.campaigns.filter(c => c.status === 'ACTIVE');

        if (activeCampaigns.length === 0) return null;

        // Encontrar melhor campanha (menor CPA com mais de 0 resultados)
        const campaignsWithResults = activeCampaigns.filter(c => c.results > 0);
        const bestCampaign = campaignsWithResults.length > 0
            ? campaignsWithResults.reduce((prev, current) => (prev.costPerResult < current.costPerResult ? prev : current))
            : null;

        // Encontrar pior campanha (maior CPA ou gasto sem resultado)
        let worstCampaign = null;
        const campaignsWithSpendAndNoResults = activeCampaigns.filter(c => c.results === 0 && c.spend > 50); // Gastou mais de 50 e não converteu

        if (campaignsWithSpendAndNoResults.length > 0) {
            worstCampaign = campaignsWithSpendAndNoResults.reduce((prev, current) => (prev.spend > current.spend ? prev : current));
        } else if (campaignsWithResults.length > 1) {
            worstCampaign = campaignsWithResults.reduce((prev, current) => (prev.costPerResult > current.costPerResult ? prev : current));
            // Só considera "pior" se o custo por resultado for pelo menos 30% maior que o geral
            if (worstCampaign.costPerResult <= report.avgCpc * 5) { // heurística simples
                worstCampaign = null;
            }
        }

        // Se só tem uma campanha, não tem como comparar melhor/pior.
        if (activeCampaigns.length === 1 && !worstCampaign) {
            return {
                type: 'neutral',
                message: `Analisando a campanha ativa "${activeCampaigns[0].name}". Considere criar novos testes A/B para comparar e escalar os resultados atuais.`,
                suggestion: 'Criar variações de criativos e públicos.',
                badge: 'Monitorando'
            }
        }

        if (bestCampaign && worstCampaign && bestCampaign.id !== worstCampaign.id) {
            return {
                type: 'action',
                message: `A campanha "${bestCampaign.name}" é o seu destaque, trazendo resultados a R$ ${bestCampaign.costPerResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Em contraponto, a campanha "${worstCampaign.name}" está com custo alto ou sem gerar conversões.`,
                suggestion: `Escale o orçamento na campanha "${bestCampaign.name}" e pause os anúncios com CTR baixo na campanha "${worstCampaign.name}".`,
                badgegood: 'Oportunidade de Escala',
                badgebad: 'Atenção Necessária'
            }
        } else if (bestCampaign) {
            return {
                type: 'good',
                message: `Sua principal campanha "${bestCampaign.name}" está performando super bem, com um Custo p/ Resultado de R$ ${bestCampaign.costPerResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
                suggestion: 'O cenário está favorável. Considere aumentar o orçamento gradativamente nesta campanha vencedora.',
                badgegood: 'Performance Excelente'
            }
        } else if (worstCampaign) {
            return {
                type: 'bad',
                message: `Atenção: A campanha "${worstCampaign.name}" já gastou R$ ${worstCampaign.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} com baixo retorno aparente.`,
                suggestion: 'Pause essa campanha temporariamente e revise a qualidade do tráfego (CTR baixo) ou a conversão da página.',
                badgebad: 'Custo Elevado'
            }
        }

        return {
            type: 'neutral',
            message: 'A performance geral das campanhas está dentro de padrões normais de estabilidade.',
            suggestion: 'Mantenha o monitoramento diário para identificar tendências.',
            badge: 'Estável'
        };

    }, [report]);

    return (
        <Card className="md:col-span-1 border-purple-500/30 bg-gradient-to-br from-background to-purple-500/5 shadow-md relative overflow-hidden group h-full">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Brain className="w-24 h-24 text-purple-500" />
            </div>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-purple-600">
                    <Brain className="h-5 w-5" />
                    Insight da IA
                </CardTitle>
                <CardDescription>Recomendações baseadas nos seus dados</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-2 relative z-10">
                {!insights ? (
                    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-sm">
                        <CheckCircle2 className="h-8 w-8 text-green-500/50 mb-2" />
                        Sem dados o suficiente no momento.
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                            {insights.message}
                        </p>

                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                            <span className="text-[11px] uppercase tracking-wider font-bold text-purple-600 flex items-center gap-1 mb-1">
                                Ação Recomendada
                            </span>
                            <p className="text-sm text-foreground">
                                {insights.suggestion}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                            {insights.badgegood && (
                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20">
                                    <TrendingUp className="w-3 h-3 mr-1" />
                                    {insights.badgegood}
                                </Badge>
                            )}
                            {insights.badgebad && (
                                <Badge variant="secondary" className="bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 border-rose-500/20">
                                    <AlertTriangle className="w-3 h-3 mr-1" />
                                    {insights.badgebad}
                                </Badge>
                            )}
                            {insights.badge && (
                                <Badge variant="outline" className="border-purple-500/30 text-purple-600">
                                    {insights.badge}
                                </Badge>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
