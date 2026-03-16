import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Target, TrendingUp, Sparkles } from 'lucide-react';
import { PerformanceReport } from '@/types/performance';
import { Client } from '@/types/client';
import { PerformanceChart } from './PerformanceChart';
import { PerformanceGoalTracker } from './PerformanceGoalTracker';
import { PerformanceCalculator } from './PerformanceCalculator';
import { PerformanceActionableAI } from './PerformanceActionableAI';

interface PerformanceV2DashboardProps {
    report: PerformanceReport;
    client: Client;
    previousReport?: PerformanceReport | null;
}

export function PerformanceV2Dashboard({ report, client, previousReport }: PerformanceV2DashboardProps) {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header V2 */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="border-purple-500/30 text-purple-500 bg-purple-500/10">
                        <Sparkles className="w-3 h-3 mr-1" />
                        Beta V2
                    </Badge>
                    <h2 className="text-xl font-semibold">Visão Estratégica</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                    Análise inteligente e acompanhamento de metas para {client.name}.
                </p>
            </div>

            {/* Bento Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Main AI Insight Box */}
                <PerformanceActionableAI report={report} client={client} />

                {/* Goals Tracker */}
                <PerformanceGoalTracker report={report} client={client} />

                {/* Funnel Calculator */}
                <PerformanceCalculator report={report} client={client} />

                {/* Advanced Chart Placeholder */}
                <Card className="md:col-span-3 border-orange-500/20 shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-orange-500" />
                            Comparativo de Campanhas (Top 5)
                        </CardTitle>
                        <CardDescription>Mês Atual vs. Mês Anterior</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <PerformanceChart currentReport={report} previousReport={previousReport} />
                    </CardContent>
                </Card>

            </div>
        </div>
    );
}
