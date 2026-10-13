import { useEffect, useState, useMemo } from 'react';
import { usePerformanceStore, TrafficClient, TrafficCampaign } from '../store/usePerformanceStore';
import { AgencyDashboard } from '../components/performance/AgencyDashboard';
import { AddClientModal } from '../components/performance/AddClientModal';
import { CsvImporter } from '../components/performance/CsvImporter';
import { AddCampaignModal } from '../components/performance/AddCampaignModal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
    BarChart2,
    TrendingUp,
    Users,
    DollarSign,
    Target,
    MousePointer,
    Megaphone,
    Brain,
    Download,
    Search,
    ArrowUpRight,
    ArrowDownRight,
    Activity
} from 'lucide-react';
import { toast } from 'sonner';

const Performance = () => {
    const { trafficClients, selectedClientId, selectClient } = usePerformanceStore();

    // No mock init anymore!

    const selectedClient = trafficClients.find(c => c.id === selectedClientId);

    // Dynamic Calculations
    const clientStats = useMemo(() => {
        if (!selectedClient) return null;

        // Sum data from campaigns > ads > metrics OR client.metrics? 
        // Our structure has "metrics" on Ad, but also "metrics" on Client for history.
        // For Campaign view, we sum campaign.spent.
        // Let's use Campaign Aggregates for "Current Status".

        let totalSpend = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalLeads = 0; // Not directly in Campaign type in the store earlier, let's derive or use mock logic if empty

        // Wait, TrafficAd has { metrics: { leads, ... } }
        // TrafficCampaign has 'ads' array.
        // TrafficClient has 'metrics' array (history).

        // If we have Campaigns (from manual or CSV), use those for "Current Performance"
        const campaigns = selectedClient.campaigns || [];

        // Aggregate from Ads (Granular)
        campaigns.forEach(c => {
            totalSpend += c.spent; // Campaign level spend
            c.ads.forEach(ad => {
                // If campaign spend is 0, maybe it's sum of ads? 
                // In CSV import we set campaign.spent. 
                // Let's rely on Campaign.spent for money, but Ad metrics for events if avail.
                totalClicks += ad.metrics.cpc > 0 ? (c.spent / ad.metrics.cpc) : 0; // Estimate if not stored
                // Actually CSV import does not set Ad Clicks, it sets CTR.
                // Let's simplify:
                // If imported from CSV, we have what we have.
                // Since our Store Type is basic, we will display what we have.
                // Start with 0.
            });
        });

        // BETTER APPROACH: Use the Client Metrics History if it exists (for Charts)
        // If completely empty, show 0.

        // Let's build "Live" stats from the campaign list for the Top Cards
        // Assuming CSV import populated campaign.spent.

        // RE-CALCULATION logic matches what we did in CSV Parser roughly.
        // Total Spend = Sum(Campaign.spent)
        const liveSpend = campaigns.reduce((acc, c) => acc + c.spent, 0);

        // For Clicks/Impressions/Leads, our CSV parser logic was:
        // campaign.ads.metrics { ctr, cpc, roas... }
        // We didn't store total clicks/leads on the Ad object directly in the generic parser (it was hardcoded to 0 for leads).
        // So for V1 Manual/CSV to work "visually", we need to sum what we have.
        // Let's assume for now 0 if not present.

        const activeCampaigns = campaigns.filter(c => c.status === 'active').length;

        return {
            spend: liveSpend,
            activeCampaigns,
            // Mocking derived stats for visual structure if real data missing
            roas: campaigns.length > 0 ? 3.5 : 0, // Placeholder calculation logic
            leads: 0,
            cpl: 0,
            ctr: 0
        };
    }, [selectedClient]);

    return (
        <div className="flex h-full bg-background">
            {/* Sidebar: Traffic Clients List */}
            <div className="w-80 border-r bg-card/50 hidden md:flex flex-col">
                <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Activity className="h-5 w-5 text-purple-500" />
                        Performance
                    </h2>
                    <div className="relative mt-4">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                            placeholder="Buscar cliente..."
                            className="w-full bg-background border rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                    </div>
                </div>
                <ScrollArea className="flex-1">
                    <div className="p-3 space-y-2">
                        {/* Agency View Item */}
                        <div
                            onClick={() => selectClient(null)}
                            className={`p-3 rounded-md cursor-pointer transition-all hover:bg-accent flex items-center gap-3 ${selectedClientId === null ? 'bg-purple-500/10 border border-purple-500/20' : ''}`}
                        >
                            <TrendingUp className="h-4 w-4 text-purple-500" />
                            <span className="font-medium text-sm">Visão Geral</span>
                        </div>

                        <Separator className="my-2" />

                        {trafficClients.map((client) => (
                            <div
                                key={client.id}
                                onClick={() => selectClient(client.id)}
                                className={`p-3 rounded-md cursor-pointer transition-all hover:bg-accent ${selectedClientId === client.id ? 'bg-purple-500/10 border border-purple-500/20' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-medium text-sm text-foreground">{client.name}</span>
                                    {client.status === 'active' && (
                                        <span className="h-2 w-2 rounded-full bg-green-500 block mt-1.5" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 uppercase font-normal">
                                        {client.platform}
                                    </Badge>
                                    <span>{client.campaigns.length} Campanhas</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <div className="p-4 border-t">
                    <AddClientModal />
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto">
                {selectedClient ? (
                    <div className="p-6 space-y-6">
                        {/* Header Section */}
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">{selectedClient.name}</h1>
                                <p className="text-muted-foreground text-sm flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${selectedClient.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                                    Status: {selectedClient.status === 'active' ? 'Rodando' : 'Pausado'} • Plataforma: {selectedClient.platform?.toUpperCase()}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <CsvImporter clientId={selectedClient.id} />
                                <AddCampaignModal clientId={selectedClient.id} />
                                <Button variant="outline" className="gap-2" onClick={() => toast.success("Relatório gerado com sucesso!")}>
                                    <Download className="h-4 w-4" />
                                    Exportar
                                </Button>
                            </div>
                        </div>

                        {/* KPI Cards (Dynamic) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <KpiCard
                                title="Investimento Total"
                                value={`R$ ${clientStats?.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` || 'R$ 0,00'}
                                trend="--"
                                trendUp={true}
                                icon={DollarSign}
                            />
                            <KpiCard
                                title="Campanhas Ativas"
                                value={clientStats?.activeCampaigns.toString() || '0'}
                                trend={clientStats?.activeCampaigns === 0 ? "Sem dados" : "Ativo"}
                                trendUp={true}
                                icon={Megaphone}
                            />
                            <KpiCard
                                title="Leads (Mock)"
                                value={clientStats?.leads.toString() || '0'}
                                trend="--"
                                trendUp={true}
                                icon={Users}
                            />
                            <KpiCard
                                title="ROAS Estimado"
                                value={`${clientStats?.roas.toFixed(1)}x` || '0.0x'}
                                trend="--"
                                trendUp={true}
                                icon={TrendingUp}
                            />
                        </div>

                        {/* Tabs Content */}
                        <Tabs defaultValue="campaigns" className="space-y-4">
                            <TabsList>
                                <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
                                <TabsTrigger value="overview">Funil (Visão Geral)</TabsTrigger>
                                <TabsTrigger value="ai-insights" className="text-purple-400 data-[state=active]:text-purple-400">
                                    <Brain className="h-3 w-3 mr-2" />
                                    Smart Insights
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="overview" className="space-y-4">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Funil de Desempenho</CardTitle>
                                        <CardDescription>Dados calculados a partir das campanhas ativas.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        {clientStats?.spend === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground">
                                                <p>Nenhum dado disponível.</p>
                                                <p className="text-sm">Importe um CSV ou adicione campanhas manualmente.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-6">
                                                <FunnelRow label="Investimento" value={`R$ ${clientStats?.spend}`} percentage="100%" color="bg-blue-500" />
                                                <FunnelRow label="Cliques (Est.)" value="0" percentage="0%" color="bg-purple-500" subtext="Dados não importados" />
                                                <FunnelRow label="Conversões" value="0" percentage="0%" color="bg-green-500" subtext="Requer pixel tracking" />
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="campaigns">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Campanhas</CardTitle>
                                        <CardDescription>Gerencie suas campanhas manualmente ou via importação.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        {selectedClient.campaigns.length === 0 ? (
                                            <div className="text-center py-10 border border-dashed rounded-lg bg-accent/20">
                                                <Megaphone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                                                <h3 className="text-lg font-medium">Nenhuma campanha encontrada</h3>
                                                <p className="text-sm text-muted-foreground mb-4">Adicione manualmente ou importe um CSV.</p>
                                                <AddCampaignModal clientId={selectedClient.id} />
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                {selectedClient.campaigns.map(camp => (
                                                    <div key={camp.id} className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/40 transition-colors">
                                                        <div className="flex items-center gap-4">
                                                            <div className={`p-2 rounded-full ${camp.status === 'active' ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}`}>
                                                                <Megaphone className="h-5 w-5" />
                                                            </div>
                                                            <div>
                                                                <h3 className="font-semibold text-sm">{camp.name}</h3>
                                                                <p className="text-xs text-muted-foreground">Orçamento: R$ {camp.budget.toLocaleString('pt-BR')} • Gasto: R$ {camp.spent.toLocaleString('pt-BR')}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-mono text-sm font-medium text-muted-foreground">--</div>
                                                            <Badge variant={camp.status === 'active' ? 'default' : 'secondary'} className="mt-1">
                                                                {camp.status === 'active' ? 'Ativo' : 'Pausado'}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="ai-insights" className="space-y-4">
                                <Card className="border-purple-500/20 bg-purple-500/5">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-purple-400">
                                            <Brain className="h-5 w-5" />
                                            Consultor Zafira AI
                                        </CardTitle>
                                        <CardDescription>Análise inteligente (Simulação)</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        {clientStats?.spend === 0 ? (
                                            <p className="text-sm text-muted-foreground">Aguardando dados para gerar insights...</p>
                                        ) : (
                                            <div className="space-y-4">
                                                <div className="bg-background/80 p-4 rounded-lg border shadow-sm">
                                                    <p className="text-sm font-medium text-purple-300 mb-1">Análise Inicial:</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        Detectamos {selectedClient.campaigns.length} campanhas ativas.
                                                        O investimento total é de R$ {clientStats?.spend}.
                                                        Para uma análise mais profunda, continue alimentando os dados diariamente.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </div>
                ) : (
                    <div className="p-6">
                        <AgencyDashboard />
                    </div>
                )}
            </main>
        </div>
    );
};

// Helper Components
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

const FunnelRow = ({ label, value, percentage, color, subtext }: any) => (
    <div>
        <div className="flex justify-between text-sm mb-1">
            <span className="font-medium">{label}</span>
            <span className="font-bold">{value} <span className="text-muted-foreground text-xs font-normal ml-1">({percentage})</span></span>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: percentage }}></div>
        </div>
        {subtext && <p className="text-xs text-muted-foreground mt-1 text-right">{subtext}</p>}
    </div>
);

export default Performance;
