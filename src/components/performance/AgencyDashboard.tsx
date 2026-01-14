import { usePerformanceStore } from '../../store/usePerformanceStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    TrendingUp,
    Users,
    DollarSign,
    Target,
    Briefcase,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react';

export const AgencyDashboard = () => {
    const { trafficClients } = usePerformanceStore();

    // Calculate Agency Totals (using flatMap for all campaigns across all clients)
    const allCampaigns = trafficClients.flatMap(c => c.campaigns);

    // Total Spent across all active campaigns
    const totalSpent = allCampaigns.reduce((acc, curr) => acc + curr.spent, 0);

    // Total Budget
    const totalBudget = allCampaigns.reduce((acc, curr) => acc + curr.budget, 0);

    // This is a simplification. Ideally we'd sum metrics from daily snapshots, but for V1 Mock/CSV we sum from campaign snapshots if available
    // OR we sum from the clients' recent metrics if simpler.
    // Let's rely on the client.metrics (historical) for accurate totals if available, otherwise fallback.
    // For V1 Demo, let's sum up the `metrics` from the last available date for each client to get "Current Pace"
    // Actually, let's map from Campaigns -> Ads -> Metrics for the most granular current data if we want "Active" performance.

    // Let's use the Campaign Data for "Lifetime/Current Period" snapshot
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalLeads = 0;
    let totalSales = 0;
    let totalRevenue = 0; // Derived from ROAS * Spend approx? Or we need Revenue field.
    // For V1, let's look at the ADS metrics which have ROAS.
    // Revenue ~= Ad Spend * Ad ROAS

    trafficClients.forEach(client => {
        client.campaigns.forEach(camp => {
            camp.ads.forEach(ad => {
                // Approximate impact of this ad
                // We don't have "Ad Spend" broken down in the mock type, only Campaign Spend.
                // This is a limitation of the simple mock. 
                // Let's use the CLIENT level aggregated metrics for history, or just sum Campaign Spends.

                // For the sake of the Agency Dashboard demo, let's assume:
                // We sum up the "metrics" array from each client (all time or last 30 days)
                client.metrics.forEach(m => {
                    totalImpressions += m.impressions;
                    totalClicks += m.clicks;
                    totalLeads += m.leads;
                    totalSales += m.sales;
                });
            });
        });
    });

    // Recalculate based on specific logic for V1 consistency:
    // Let's just sum the Mock Data "metrics" array which represents daily logs.
    const allMetrics = trafficClients.flatMap(c => c.metrics);
    const agTotalSpend = allMetrics.reduce((acc, m) => acc + m.spend, 0);
    const agTotalLeads = allMetrics.reduce((acc, m) => acc + m.leads, 0);
    const agTotalSales = allMetrics.reduce((acc, m) => acc + m.sales, 0);
    const agTotalClicks = allMetrics.reduce((acc, m) => acc + m.clicks, 0);

    // Calculate Global ROAS (need Revenue, assumed from Sales? Or mocked ROAS?)
    // Let's assume average ROAS from active ads for a "Health Score"
    const activeAds = allCampaigns.flatMap(c => c.ads).filter(a => a.status === 'active');
    const avgRoas = activeAds.length > 0
        ? activeAds.reduce((acc, ad) => acc + ad.metrics.roas, 0) / activeAds.length
        : 0;

    const topClients = [...trafficClients].sort((a, b) => {
        // Sort by total spend in metrics
        const spendA = a.metrics.reduce((acc, m) => acc + m.spend, 0);
        const spendB = b.metrics.reduce((acc, m) => acc + m.spend, 0);
        return spendB - spendA;
    }).slice(0, 5);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Visão Geral da Agência</h2>
                    <p className="text-muted-foreground">Resumo consolidado de todas as contas.</p>
                </div>
                <Badge variant="outline" className="text-sm py-1 px-3">
                    {trafficClients.length} Clientes Ativos
                </Badge>
            </div>

            {/* Global KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KpiCard
                    title="Investimento Total"
                    value={`R$ ${agTotalSpend.toLocaleString('pt-BR')}`}
                    icon={DollarSign}
                    trend="+15%"
                    trendUp={true}
                />
                <KpiCard
                    title="ROAS Global (Médio)"
                    value={`${avgRoas.toFixed(2)}x`}
                    icon={TrendingUp}
                    trend="+0.2"
                    trendUp={true}
                />
                <KpiCard
                    title="Total de Leads"
                    value={agTotalLeads}
                    icon={Users}
                    trend="+45"
                    trendUp={true}
                />
                <KpiCard
                    title="Custo / Lead (Médio)"
                    value={`R$ ${(agTotalSpend / (agTotalLeads || 1)).toFixed(2)}`}
                    icon={Target}
                    trend="-R$ 0.50"
                    trendUp={true} // Lower is better, but visually Green is good
                />
            </div>

            {/* Top Clients Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Top Clientes (Por Investimento)</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {topClients.map(client => {
                            const clientSpend = client.metrics.reduce((acc, m) => acc + m.spend, 0);
                            const clientLeads = client.metrics.reduce((acc, m) => acc + m.leads, 0);
                            return (
                                <div key={client.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/5 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 bg-primary/10 rounded-full text-primary">
                                            <Briefcase className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <p className="font-semibold">{client.name}</p>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1 uppercase">{client.platform}</Badge>
                                                <span>{client.campaigns.filter(c => c.status === 'active').length} Campanhas Ativas</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-sm">R$ {clientSpend.toLocaleString('pt-BR')}</p>
                                        <p className="text-xs text-muted-foreground">{clientLeads} Leads</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

const KpiCard = ({ title, value, trend, trendUp, icon: Icon }: any) => (
    <Card>
        <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-end justify-between pt-2">
                <div className="text-2xl font-bold">{value}</div>
                <div className={`text-xs flex items-center ${trendUp ? 'text-green-500' : 'text-red-500'}`}>
                    {trend}
                    {trendUp ? <ArrowUpRight className="h-3 w-3 ml-0.5" /> : <ArrowDownRight className="h-3 w-3 ml-0.5" />}
                </div>
            </div>
        </CardContent>
    </Card>
);
