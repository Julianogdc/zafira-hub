import { usePerformanceStore } from '../../store/usePerformanceStore';
import { useClientStore } from '../../store/useClientStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    TrendingUp,
    Users,
    DollarSign,
    Target,
    Briefcase,
    Activity,
    AlertCircle,
    CheckCircle2,
    BarChart3
} from 'lucide-react';

export const AgencyDashboard = () => {
    const { reports, getHealthData, trackedClientIds } = usePerformanceStore();
    const { clients } = useClientStore();

    // Get health data for tracked clients
    const healthData = getHealthData();

    // Aggregate metrics for the current/latest month
    const latestMonth = reports.length > 0
        ? [...new Set(reports.map(r => r.month))].sort().reverse()[0]
        : new Date().toISOString().substring(0, 7);

    const latestReports = reports.filter(r => r.month === latestMonth);

    const totalSpend = latestReports.reduce((acc, r) => acc + r.totalSpend, 0);
    const totalResults = latestReports.reduce((acc, r) => acc + r.totalResults, 0);
    const avgCtr = latestReports.length > 0
        ? latestReports.reduce((acc, r) => acc + r.avgCtr, 0) / latestReports.length
        : 0;
    const avgCpc = latestReports.length > 0
        ? latestReports.reduce((acc, r) => acc + r.avgCpc, 0) / latestReports.length
        : 0;

    const criticalClients = healthData.filter(h => h.status === 'critical').length;
    const warningClients = healthData.filter(h => h.status === 'warning').length;

    // Highlights logic
    const topClient = [...healthData].sort((a, b) => b.score - a.score)[0];
    const worstClient = [...healthData].sort((a, b) => a.score - b.score)[0];

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Painel da Agência</h2>
                    <p className="text-muted-foreground">Visão consolidada de performance: {new Date(latestMonth + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>
                </div>
                <div className="flex gap-2">
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 py-1 px-3">
                        {healthData.filter(h => h.status === 'healthy').length} Saudáveis
                    </Badge>
                    {warningClients > 0 && (
                        <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20 py-1 px-3">
                            {warningClients} Alertas
                        </Badge>
                    )}
                    {criticalClients > 0 && (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 py-1 px-3">
                            {criticalClients} Críticos
                        </Badge>
                    )}
                </div>
            </div>

            {/* Global KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KpiCard
                    title="Investimento Total"
                    value={`R$ ${totalSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                    icon={DollarSign}
                    color="text-blue-500"
                />
                <KpiCard
                    title="Resultados Totais"
                    value={totalResults.toLocaleString('pt-BR')}
                    icon={Target}
                    color="text-green-500"
                />
                <KpiCard
                    title="CTR Médio Agência"
                    value={`${avgCtr.toFixed(2)}%`}
                    icon={TrendingUp}
                    color="text-purple-500"
                />
                <KpiCard
                    title="Contas Ativas"
                    value={trackedClientIds.length}
                    icon={Briefcase}
                    color="text-orange-500"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Client Health List */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Saúde das Contas</CardTitle>
                        <CardDescription>Status atual baseado em detecção de gargalos automáticos.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {healthData.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
                                    Nenhum cliente rastreado para performance. Utilize a barra lateral para adicionar.
                                </div>
                            ) : (
                                healthData.map((health) => (
                                    <div key={health.clientId} className="flex items-center justify-between p-4 border rounded-xl hover:bg-accent/5 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-full ${health.status === 'healthy' ? 'bg-green-500/10 text-green-500' :
                                                health.status === 'warning' ? 'bg-orange-500/10 text-orange-500' :
                                                    'bg-destructive/10 text-destructive'
                                                }`}>
                                                {health.status === 'healthy' ? <CheckCircle2 className="h-5 w-5" /> :
                                                    health.status === 'warning' ? <AlertCircle className="h-5 w-5" /> :
                                                        <Activity className="h-5 w-5" />}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-sm">{health.clientName}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {health.alertCount} alertas detectados este mês
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium">Saúde: {health.score}%</span>
                                                <Progress value={health.score} className="w-20 h-1.5" />
                                            </div>
                                            <Badge variant="secondary" className="text-[10px] uppercase">
                                                Meta Ads
                                            </Badge>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Agency Highlights */}
                <Card>
                    <CardHeader>
                        <CardTitle>Destaques do Mês</CardTitle>
                        <CardDescription>Insights baseados no volume de dados.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">CTR Médio (Benchmark 1%)</span>
                                <span className={`font-bold ${avgCtr >= 1 ? 'text-green-500' : 'text-orange-500'}`}>
                                    {avgCtr.toFixed(2)}%
                                </span>
                            </div>
                            <Progress value={Math.min(avgCtr * 100, 100)} className="h-1.5" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">CPC Médio Agência</span>
                                <span className="font-bold text-blue-500">R$ {avgCpc.toFixed(2)}</span>
                            </div>
                            <Progress value={avgCpc > 0 ? 100 - Math.min(avgCpc * 50, 100) : 0} className="h-1.5" />
                        </div>

                        <Separator />

                        <div className="space-y-3">
                            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Observação Operacional</h4>
                            <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg space-y-2">
                                {topClient && topClient.score > 80 ? (
                                    <>
                                        <div className="flex items-center gap-2 text-xs font-bold text-green-400">
                                            <CheckCircle2 className="h-3 w-3" />
                                            CASE DE SUCESSO
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            <strong>{topClient.clientName}</strong> está com performance excelente (Saúde: {topClient.score}%).
                                            Continue com as otimizações atuais.
                                        </p>
                                    </>
                                ) : worstClient && worstClient.status === 'critical' ? (
                                    <>
                                        <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                                            <AlertCircle className="h-3 w-3" />
                                            ATENÇÃO PRIORITÁRIA
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            <strong>{worstClient.clientName}</strong> apresenta gargalos críticos ({worstClient.alertCount} alertas).
                                            Recomendamos check-up técnico imediato.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2 text-xs font-bold text-purple-400">
                                            <BarChart3 className="h-3 w-3" />
                                            OPERAÇÃO ESTÁVEL
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            As contas rastreadas estão operando dentro da normalidade média da agência.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

const KpiCard = ({ title, value, icon: Icon, color }: any) => (
    <Card className="bg-card">
        <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <div className={`p-2 rounded-lg bg-accent/50 ${color}`}>
                    <Icon className="h-4 w-4" />
                </div>
            </div>
            <div className="pt-2">
                <div className="text-2xl font-bold tracking-tight">{value}</div>
            </div>
        </CardContent>
    </Card>
);

const Separator = () => <div className="h-px w-full bg-border" />;

