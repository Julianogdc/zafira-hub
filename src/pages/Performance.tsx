import { useEffect, useMemo, useState } from 'react';
import { usePerformanceStore } from '../store/usePerformanceStore';
import { useClientStore } from '../store/useClientStore';
import { AgencyDashboard } from '../components/performance/AgencyDashboard';
import { PerformanceImporter } from '../components/performance/PerformanceImporter';
import { AIAnalysisPanel } from '../components/performance/AIAnalysisPanel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Activity,
    TrendingUp,
    DollarSign,
    Megaphone,
    Brain,
    Download,
    Search,
    Calendar,
    AlertTriangle,
    CheckCircle2,
    Info,
    FileSpreadsheet,
    Trash2,
    HelpCircle,
    Link2,
    Copy,
    Check,
    ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { AddPerformanceClientDialog } from '../components/performance/AddPerformanceClientDialog';
import { PerformanceGlossary } from '../components/performance/PerformanceGlossary';
import { generatePerformanceReport } from '../lib/exportUtils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';

const getStatusInfo = (status: string | undefined) => {
    if (!status) return { label: 'Ativo', color: 'bg-green-500/10 text-green-500 border-green-500/20' };
    const s = status.toLowerCase().trim();

    if (s === 'active' || s === 'ativo' || s === 'em veiculação' || s === 'veiculando') {
        return { label: 'Ativo', color: 'bg-green-500/10 text-green-500 border-green-500/20' };
    }

    if (s.includes('conclu') || s === 'completed' || s === 'recently_completed') {
        return { label: 'Concluído', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
    }

    if (s.includes('pausa') || s === 'paused') {
        return { label: 'Pausado', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' };
    }

    if (s === 'not_delivering' || s === 'inactive' || s === 'inativo' || s === 'desativado') {
        return { label: 'Inativo', color: 'bg-muted text-muted-foreground border-transparent' };
    }

    return { label: status, color: 'bg-muted text-muted-foreground border-transparent' };
};

const Performance = () => {
    const [lastAiResult, setLastAiResult] = useState<string | null>(null);
    const [includeAiInPdf, setIncludeAiInPdf] = useState(true);
    const [isGeneratingLink, setIsGeneratingLink] = useState(false);
    const [generatedLink, setGeneratedLink] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);
    const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
    const { user } = useAuthStore();
    const { clients, fetchClients } = useClientStore();
    const {
        reports,
        fetchReports,
        selectedClientId,
        selectClient,
        selectedMonth,
        selectMonth,
        getClientAlerts,
        trackedClientIds,
        fetchTrackedClients,
        removeTrackedClient,
        deleteReport
    } = usePerformanceStore();

    useEffect(() => {
        fetchClients();
        fetchReports();
        fetchTrackedClients();
    }, [fetchClients, fetchReports, fetchTrackedClients]);

    // Limpar estados ao trocar de cliente ou mês
    useEffect(() => {
        setLastAiResult(null);
        setGeneratedLink(null);
        setLinkCopied(false);
    }, [selectedClientId, selectedMonth]);

    const filteredClient = clients.find(c => c.id === selectedClientId);

    const currentReport = useMemo(() => {
        if (!selectedClientId) return null;
        return reports.find(r => r.clientId === selectedClientId && r.month === selectedMonth);
    }, [reports, selectedClientId, selectedMonth]);

    // Inicializar seleção com todas as campanhas quando report mudar
    useEffect(() => {
        if (currentReport?.campaigns) {
            setSelectedCampaignIds(currentReport.campaigns.map(c => c.id));
        }
    }, [currentReport]);

    const filteredReport = useMemo(() => {
        if (!currentReport) return null;

        const activeCampaigns = currentReport.campaigns.filter(c => selectedCampaignIds.includes(c.id));

        // Recalcular totais
        const totalSpend = activeCampaigns.reduce((acc, c) => acc + (c.spend || 0), 0);
        const totalResults = activeCampaigns.reduce((acc, c) => acc + (c.results || 0), 0);

        return {
            ...currentReport,
            campaigns: activeCampaigns,
            totalSpend,
            totalResults
        };
    }, [currentReport, selectedCampaignIds]);

    const toggleAllCampaigns = () => {
        if (!currentReport) return;
        if (selectedCampaignIds.length === currentReport.campaigns.length) {
            setSelectedCampaignIds([]);
        } else {
            setSelectedCampaignIds(currentReport.campaigns.map(c => c.id));
        }
    };

    const toggleCampaign = (id: string) => {
        if (selectedCampaignIds.includes(id)) {
            setSelectedCampaignIds(prev => prev.filter(cid => cid !== id));
        } else {
            setSelectedCampaignIds(prev => [...prev, id]);
        }
    };

    // Função para gerar link público do relatório
    const handleGeneratePublicLink = async () => {
        if (!filteredReport || !filteredClient) return;

        setIsGeneratingLink(true);
        try {
            // Gerar slug curto e único
            const slug = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 6);

            const { data, error } = await supabase
                .from('public_reports')
                .insert({
                    slug,
                    client_name: filteredClient.name,
                    report_month: filteredReport.month,
                    report_data: filteredReport,
                    ai_insight: includeAiInPdf ? lastAiResult : null,
                    created_by: user?.id || null,
                    expires_at: null // Sem expiração por padrão
                })
                .select()
                .single();

            if (error) throw error;

            // Gerar URL completa
            const publicUrl = `${window.location.origin}/r/${slug}`;

            // Mostrar modal com link
            setGeneratedLink(publicUrl);
            setLinkCopied(false);

            toast.success('Link gerado com sucesso!');

        } catch (error) {
            console.error('Erro ao gerar link:', error);
            toast.error('Erro ao gerar link público');
        } finally {
            setIsGeneratingLink(false);
        }
    };



    const alerts = useMemo(() => {
        if (!selectedClientId || !selectedMonth) return [];
        return getClientAlerts(selectedClientId, selectedMonth);
    }, [selectedClientId, selectedMonth, getClientAlerts]);

    const availableMonths = useMemo(() => {
        const months = Array.from(new Set(reports.map(r => r.month)));
        if (!months.includes(new Date().toISOString().substring(0, 7))) {
            months.push(new Date().toISOString().substring(0, 7));
        }
        return months.sort().reverse();
    }, [reports]);

    return (
        <TooltipProvider>
            <div className="flex h-full bg-background overflow-hidden">
                {/* Sidebar: Clientes */}
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
                            <div
                                onClick={() => selectClient(null)}
                                className={`p-3 rounded-md cursor-pointer transition-all hover:bg-accent flex items-center gap-3 ${selectedClientId === null ? 'bg-purple-500/10 border border-purple-500/20' : ''}`}
                            >
                                <TrendingUp className="h-4 w-4 text-purple-500" />
                                <span className="font-medium text-sm">Visão Geral Agência</span>
                            </div>

                            <Separator className="my-2" />

                            <div className="px-3 py-2">
                                <AddPerformanceClientDialog />
                            </div>

                            <Separator className="my-2" />

                            {clients
                                .filter(client => trackedClientIds.includes(client.id))
                                .map((client) => (
                                    <div
                                        key={client.id}
                                        onClick={() => selectClient(client.id)}
                                        className={`p-3 rounded-md cursor-pointer transition-all hover:bg-accent group relative ${selectedClientId === client.id ? 'bg-purple-500/10 border border-purple-500/20' : ''}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="font-medium text-sm text-foreground">{client.name}</span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm(`Remover ${client.name} do módulo de Performance?`)) {
                                                            removeTrackedClient(client.id);
                                                            toast.success("Cliente removido do rastreamento.");
                                                        }
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                                {client.status === 'active' && (
                                                    <span className="h-2 w-2 rounded-full bg-green-500 block" />
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 uppercase font-normal">
                                                Meta Ads
                                            </Badge>
                                            <span>{reports.filter(r => r.clientId === client.id).length} Relatórios</span>
                                        </div>
                                    </div>
                                ))}

                            {trackedClientIds.length === 0 && (
                                <div className="px-4 py-8 text-center border border-dashed rounded-lg mx-3">
                                    <p className="text-xs text-muted-foreground">
                                        Nenhum cliente rastreado para tráfego pago.
                                    </p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                    <PerformanceGlossary />
                </div>

                {/* Main Content */}
                <main className="flex-1 overflow-y-auto">
                    {!selectedClientId ? (
                        <div className="p-6">
                            <AgencyDashboard />
                        </div>
                    ) : (
                        <div className="p-6 space-y-6">
                            {/* Header Client */}
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div>
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h1 className="text-2xl font-bold tracking-tight">{filteredClient?.name}</h1>
                                        <Badge variant="secondary" className="bg-purple-500/10 text-purple-500 border-purple-500/20 uppercase tracking-wider text-[10px]">
                                            Meta Ads Manager
                                        </Badge>
                                        {currentReport?.startDate && currentReport?.endDate && (
                                            <Badge variant="outline" className="text-[10px] border-purple-500/20 text-purple-400 bg-purple-500/5">
                                                {new Date(currentReport.startDate).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} - {new Date(currentReport.endDate).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-muted-foreground text-sm mt-1">
                                        Controle de performance e diagnósticos automáticos.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4 text-muted-foreground" />
                                        <Select value={selectedMonth || ''} onValueChange={selectMonth}>
                                            <SelectTrigger className="w-[180px]">
                                                <SelectValue placeholder="Selecione o mês" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableMonths.map(m => (
                                                    <SelectItem key={m} value={m}>
                                                        {new Date(m + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!filteredReport}
                                        className="gap-1.5"
                                        onClick={() => {
                                            if (filteredReport && filteredClient) {
                                                generatePerformanceReport(filteredReport, filteredClient.name, includeAiInPdf ? lastAiResult : null, 'portrait');
                                                toast.success("Relatório PDF gerado com sucesso!");
                                            }
                                        }}
                                    >
                                        <Download className="h-4 w-4 text-purple-500" />
                                        PDF
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!filteredReport || isGeneratingLink}
                                        className="gap-1.5"
                                        onClick={handleGeneratePublicLink}
                                    >
                                        <Link2 className="h-4 w-4 text-purple-500" />
                                        {isGeneratingLink ? '...' : 'Link'}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={!currentReport}
                                        className="text-muted-foreground hover:text-red-500 transition-colors"
                                        onClick={() => {
                                            if (currentReport && confirm(`Tem certeza que deseja apagar o relatório de ${new Date(selectedMonth + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}?`)) {
                                                deleteReport(currentReport.id);
                                                toast.success("Relatório excluído com sucesso.");
                                            }
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                    <PerformanceImporter clientId={selectedClientId} />
                                </div>
                            </div>

                            {currentReport ? (
                                <>
                                    {/* KPIs */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <KpiCard
                                            title="Investimento Mensal"
                                            value={`R$ ${filteredReport?.totalSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}`}
                                            icon={DollarSign}
                                            color="text-blue-500"
                                            description="Valor total investido nas campanhas selecionadas."
                                        />
                                        <KpiCard
                                            title="Resultados Selecionados"
                                            value={filteredReport?.totalResults.toLocaleString('pt-BR') || '0'}
                                            icon={Megaphone}
                                            color="text-green-500"
                                            description="Conversões totais das campanhas selecionadas."
                                        />
                                        <KpiCard
                                            title="CTR Médio"
                                            value={`${filteredReport?.avgCtr.toFixed(2) || '0.00'}%`}
                                            icon={Activity}
                                            color="text-orange-500"
                                            description="Taxa de Cliques (Click-Through Rate). Porcentagem de pessoas que clicaram após ver o anúncio."
                                        />
                                        <KpiCard
                                            title="CPC Médio"
                                            value={`R$ ${filteredReport?.avgCpc.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}`}
                                            icon={DollarSign}
                                            color="text-purple-500"
                                            description="Custo por Clique (Cost Per Click). Valor médio pago por cada clique no link."
                                        />
                                    </div>

                                    {/* Tabs */}
                                    <Tabs defaultValue="campaigns" className="space-y-4">
                                        <TabsList className="bg-muted/50 p-1">
                                            <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
                                            <TabsTrigger value="alerts" className="relative">
                                                Alertas
                                                {alerts.length > 0 && (
                                                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                                                        {alerts.length}
                                                    </span>
                                                )}
                                            </TabsTrigger>
                                            <TabsTrigger value="ai" className="gap-2 text-purple-400 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-400">
                                                <Brain className="h-4 w-4" />
                                                IA Analyst
                                            </TabsTrigger>
                                        </TabsList>

                                        <TabsContent value="campaigns" className="space-y-4">
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle className="text-lg">Detalhamento por Campanha</CardTitle>
                                                    <CardDescription>Métricas importadas do relatório correspondente ao mês.</CardDescription>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="relative overflow-x-auto border rounded-lg">
                                                        <table className="w-full text-sm text-left">
                                                            <thead className="text-xs uppercase bg-muted/50 border-b">
                                                                <tr>
                                                                    <th className="px-4 py-3 w-[40px]">
                                                                        <input
                                                                            type="checkbox"
                                                                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                                            checked={currentReport?.campaigns.length === selectedCampaignIds.length}
                                                                            onChange={toggleAllCampaigns}
                                                                        />
                                                                    </th>
                                                                    <th className="px-4 py-3 font-semibold">Campanha</th>
                                                                    <th className="px-4 py-3 font-semibold">Status</th>
                                                                    <th className="px-4 py-3 font-semibold text-right">Gasto</th>
                                                                    <th className="px-4 py-3 font-semibold text-right">Cliques</th>
                                                                    <th className="px-4 py-3 font-semibold text-right">
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <button className="flex items-center gap-1 ml-auto font-semibold">
                                                                                    CTR <HelpCircle className="h-3 w-3" />
                                                                                </button>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent className="text-left normal-case">
                                                                                <p className="max-w-xs text-xs text-left normal-case">Porcentagem de vezes que as pessoas viram seu anúncio e deram um clique no link.</p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </th>
                                                                    <th className="px-4 py-3 font-semibold text-right">Resultados</th>
                                                                    <th className="px-4 py-3 font-semibold text-right">
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <button className="flex items-center gap-1 ml-auto font-semibold">
                                                                                    Custo/Res <HelpCircle className="h-3 w-3" />
                                                                                </button>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent className="text-left normal-case">
                                                                                <p className="max-w-xs text-xs text-left normal-case">Custo por Resultado. O valor médio investido para obter uma conversão.</p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y">
                                                                {currentReport.campaigns.map(camp => (
                                                                    <tr key={camp.id} className="hover:bg-accent/30 transition-colors">
                                                                        <td className="px-4 py-3">
                                                                            <input
                                                                                type="checkbox"
                                                                                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                                                checked={selectedCampaignIds.includes(camp.id)}
                                                                                onChange={() => toggleCampaign(camp.id)}
                                                                            />
                                                                        </td>
                                                                        <td className="px-4 py-3 font-medium">
                                                                            <div className="flex flex-col">
                                                                                <span>{camp.name}</span>
                                                                                <span className="text-[10px] text-muted-foreground uppercase">{camp.resultType}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-3">
                                                                            <Badge
                                                                                variant="outline"
                                                                                className={`text-[10px] font-normal px-1.5 h-5 ${getStatusInfo(camp.status).color}`}
                                                                            >
                                                                                {getStatusInfo(camp.status).label}
                                                                            </Badge>
                                                                        </td>
                                                                        <td className="px-4 py-3 text-right">R$ {camp.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                                        <td className="px-4 py-3 text-right">{camp.clicks.toLocaleString('pt-BR')}</td>
                                                                        <td className="px-4 py-3 text-right text-muted-foreground">{camp.ctr.toFixed(2)}%</td>
                                                                        <td className="px-4 py-3 text-right font-semibold text-green-500">{camp.results.toLocaleString('pt-BR')}</td>
                                                                        <td className="px-4 py-3 text-right">R$ {camp.costPerResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </TabsContent>

                                        <TabsContent value="alerts">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {alerts.length === 0 ? (
                                                    <Card className="col-span-full py-10 flex flex-col items-center justify-center border-dashed">
                                                        <CheckCircle2 className="h-10 w-10 text-green-500 mb-3" />
                                                        <h3 className="font-semibold">Nenhum gargalo crítico detectado</h3>
                                                        <p className="text-sm text-muted-foreground text-center max-w-xs">
                                                            As campanhas deste período estão dentro dos parâmetros ideais de performance.
                                                        </p>
                                                    </Card>
                                                ) : (
                                                    alerts.map((alert) => (
                                                        <Card key={alert.id} className={`border-l-4 ${alert.type === 'critical' ? 'border-l-destructive bg-destructive/5' :
                                                            alert.type === 'warning' ? 'border-l-orange-500 bg-orange-500/5' :
                                                                'border-l-blue-500 bg-blue-500/5'
                                                            }`}>
                                                            <CardHeader className="pb-2">
                                                                <div className="flex justify-between items-start">
                                                                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                                                                        {alert.type === 'critical' ? <AlertTriangle className="h-4 w-4 text-destructive" /> :
                                                                            alert.type === 'warning' ? <AlertTriangle className="h-4 w-4 text-orange-500" /> :
                                                                                <Info className="h-4 w-4 text-blue-500" />}
                                                                        {alert.campaignName}
                                                                    </CardTitle>
                                                                    <Badge variant="outline" className="text-[10px] uppercase">{alert.metric}</Badge>
                                                                </div>
                                                            </CardHeader>
                                                            <CardContent className="space-y-3">
                                                                <p className="text-sm font-medium">{alert.message}</p>
                                                                <div className="bg-background/80 p-3 rounded-lg border text-[13px] text-muted-foreground">
                                                                    <span className="font-bold text-foreground">Sugestão: </span>
                                                                    {alert.suggestion}
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    ))
                                                )}
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="ai">
                                            <Card className="border-purple-500/30 bg-purple-500/5">
                                                <CardHeader>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <CardTitle className="flex items-center gap-2 text-purple-400">
                                                                <Brain className="h-5 w-5" />
                                                                Analista de Tráfego Zafira Hub
                                                            </CardTitle>
                                                            <CardDescription>Análise inteligente de performance baseada nos dados reais e alertas do sistema.</CardDescription>
                                                        </div>
                                                        <div className="flex items-center gap-2 bg-purple-500/10 px-3 py-2 rounded-lg border border-purple-500/20">
                                                            <input
                                                                type="checkbox"
                                                                id="includeAiPdf"
                                                                checked={includeAiInPdf}
                                                                onChange={(e) => setIncludeAiInPdf(e.target.checked)}
                                                                className="w-4 h-4 rounded border-purple-500/50 text-purple-600 focus:ring-purple-500"
                                                            />
                                                            <label htmlFor="includeAiPdf" className="text-xs text-purple-300 whitespace-nowrap cursor-pointer">
                                                                Anexar no PDF e Link
                                                            </label>
                                                        </div>
                                                    </div>
                                                </CardHeader>
                                                <CardContent>
                                                    <AIAnalysisPanel
                                                        key={filteredReport?.id || 'empty'}
                                                        report={filteredReport}
                                                        clientName={filteredClient?.name || 'Cliente'}
                                                        onResultGenerate={(res) => setLastAiResult(res)}
                                                    />
                                                </CardContent>
                                            </Card>
                                        </TabsContent>
                                    </Tabs>
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-2xl py-20 bg-accent/10">
                                    <FileSpreadsheet className="h-16 w-16 text-muted-foreground/30 mb-6" />
                                    <h2 className="text-xl font-bold mb-2">Sem dados para este período</h2>
                                    <p className="text-muted-foreground text-center max-w-sm mb-8 px-4">
                                        Não encontramos nenhum relatório importado para {filteredClient?.name} no mês de {new Date(selectedMonth + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}.
                                    </p>
                                    <PerformanceImporter clientId={selectedClientId} />
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>

            {/* Modal de Link Gerado */}
            <Dialog open={!!generatedLink} onOpenChange={(open) => !open && setGeneratedLink(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Link2 className="h-5 w-5 text-purple-500" />
                            Link Público Gerado
                        </DialogTitle>
                        <DialogDescription>
                            Compartilhe este link com seu cliente para visualizar o relatório de performance.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                readOnly
                                value={generatedLink || ''}
                                className="flex-1 px-3 py-2 text-sm bg-muted rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={async () => {
                                    if (generatedLink) {
                                        await navigator.clipboard.writeText(generatedLink);
                                        setLinkCopied(true);
                                        toast.success('Link copiado!');
                                        setTimeout(() => setLinkCopied(false), 2000);
                                    }
                                }}
                            >
                                {linkCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                {linkCopied ? 'Copiado!' : 'Copiar'}
                            </Button>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setGeneratedLink(null)}
                            >
                                Fechar
                            </Button>
                            <Button
                                variant="default"
                                size="sm"
                                className="gap-1.5 bg-purple-600 hover:bg-purple-700"
                                onClick={() => {
                                    if (generatedLink) {
                                        window.open(generatedLink, '_blank');
                                    }
                                }}
                            >
                                <ExternalLink className="h-4 w-4" />
                                Abrir Link
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
};

const KpiCard = ({ title, value, icon: Icon, color, description }: any) => (
    <Card className="hover:shadow-md transition-shadow cursor-default group">
        <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">{title}</span>
                    {description && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button className="cursor-help">
                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-left normal-case">
                                <p className="max-w-xs text-xs text-left normal-case">{description}</p>
                            </TooltipContent>
                        </Tooltip>
                    )}
                </div>
                <div className={`p-2 rounded-lg bg-accent/50 ${color}`}>
                    <Icon className="h-4 w-4" />
                </div>
            </div>
            <div className="flex items-end justify-between pt-2">
                <div className="text-2xl font-bold tracking-tight">{value}</div>
            </div>
        </CardContent>
    </Card>
);

export default Performance;
