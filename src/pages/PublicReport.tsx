import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PublicReport as PublicReportType } from '@/types/publicReport';
import {
    Loader2, TrendingUp, TrendingDown, DollarSign, MousePointer,
    Target, BarChart3, Users, Eye, Zap, ArrowRight, ChevronDown,
    Sparkles, ChevronRight, PieChart
} from 'lucide-react';

/**
 * Página pública de visualização de relatório de performance
 * DESIGN PREMIUM - Tema dark com brilhos roxos animados
 */
const PublicReport = () => {
    const { slug } = useParams<{ slug: string }>();
    const [report, setReport] = useState<PublicReportType | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
    const [glossaryOpen, setGlossaryOpen] = useState(false);

    useEffect(() => {
        if (slug) {
            fetchReport(slug);
        }
    }, [slug]);

    // Intersection Observer para animações de entrada
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setVisibleSections((prev) => new Set([...prev, entry.target.id]));
                    }
                });
            },
            { threshold: 0.1, rootMargin: '50px' }
        );

        document.querySelectorAll('[data-animate]').forEach((el) => {
            observer.observe(el);
        });

        return () => observer.disconnect();
    }, [report]);

    const fetchReport = async (reportSlug: string) => {
        try {
            setLoading(true);

            const { data, error: fetchError } = await supabase
                .from('public_reports')
                .select('*')
                .eq('slug', reportSlug)
                .single();

            if (fetchError) throw new Error('Relatório não encontrado');

            if (fetchError) throw new Error('Relatório não encontrado');

            // Force check for active status being explicitly true or missing (backwards compatibility)
            // But since we added default TRUE, it should be true.
            // If it is false, we block.
            console.log("Checking active status:", data.active, " ID:", data.id);

            if (data.active === false) {
                throw new Error('Este link foi desativado pelo remetente');
            }

            if (data.expires_at && new Date(data.expires_at) < new Date()) {
                throw new Error('Este relatório expirou');
            }

            setReport(data);

            // Registrar Visita Detalhada (Trigger atualiza views automaticamente)
            const registerVisit = async () => {
                const { data: { user } } = await supabase.auth.getUser();
                await supabase.from('public_report_visits').insert({
                    report_id: data.id,
                    user_id: user?.id || null
                });
            };
            registerVisit();

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao carregar relatório');
        } finally {
            setLoading(false);
        }
    };


    // Formatadores
    const fmtCurrency = (value: number) =>
        `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtNumber = (value: number) => value.toLocaleString('pt-BR');
    const fmtPercent = (value: number) => `${value.toFixed(2)}%`;

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-purple-900/10" />
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[128px] animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/15 rounded-full blur-[100px] animate-pulse delay-1000" />
                <Loader2 className="w-12 h-12 animate-spin text-purple-500 relative z-10" />
            </div>
        );
    }

    if (error || !report) {
        return (
            <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-purple-900/10" />
                <div className="text-center p-8 bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 relative z-10">
                    <h1 className="text-2xl font-bold text-white mb-2">Relatório não encontrado</h1>
                    <p className="text-white/50">{error || 'O link pode estar incorreto ou expirado.'}</p>
                </div>
            </div>
        );
    }

    const data = report.report_data;
    const cpa = data.totalResults > 0 ? data.totalSpend / data.totalResults : 0;
    const totalClicks = data.campaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
    const totalImpressions = totalClicks > 0 ? Math.round(totalClicks / (data.avgCtr / 100)) : 0;
    const conversionRate = totalClicks > 0 ? (data.totalResults / totalClicks) * 100 : 0;

    // Dados para gráfico de Pizza
    const totalSpend = data.campaigns.reduce((sum, c) => sum + c.spend, 0);
    const pieData = data.campaigns.slice(0, 5).map((c, idx) => ({
        name: c.name,
        value: c.spend,
        percentage: (c.spend / totalSpend) * 100,
        color: ['#a855f7', '#8b5cf6', '#7c3aed', '#6366f1', '#818cf8'][idx]
    }));

    return (
        <div className="min-h-screen bg-[#0a0a14] text-white overflow-x-hidden print:bg-white print:text-black">
            {/* Background Effects - Hide on print */}
            <div className="fixed inset-0 pointer-events-none print:hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-purple-900/10" />
                <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[150px] animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
                <div className="absolute top-1/2 right-0 w-[300px] h-[300px] bg-violet-600/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '4s' }} />
            </div>

            {/* Header */}
            <header className="sticky top-0 z-50 bg-[#0a0a14]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <img
                        src="https://i.ibb.co/Y44FV9Kv/Ativo-1-2x.png"
                        alt="Zafira"
                        className="h-8 brightness-0 invert opacity-90"
                    />
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-white/40 uppercase tracking-widest">Relatório de Performance</span>
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    </div>
                </div>
            </header>

            <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">

                {/* Hero Section */}
                <section
                    id="hero"
                    data-animate
                    className={`mb-16 transition-all duration-1000 ${visibleSections.has('hero') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-600/20 to-purple-900/20 border border-purple-500/20 p-8 md:p-12 print:bg-purple-50 print:border-purple-200">
                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDBNIDAgMjAgTCA0MCAyMCBNIDIwIDAgTCAyMCA0MCBNIDAgMzAgTCA0MCAzMCBNIDMwIDAgTCAzMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDIpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50 print:hidden" />

                        <div className="relative">
                            <div className="flex items-center gap-2 text-purple-400 text-sm mb-4 print:text-purple-600">
                                <Sparkles className="w-4 h-4" />
                                <span className="uppercase tracking-widest">Análise de Performance</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white via-white to-purple-200 bg-clip-text text-transparent print:text-purple-900">
                                {report.client_name}
                            </h1>
                            <p className="text-xl text-white/60 print:text-gray-600">
                                {new Date(report.report_month + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                            </p>
                        </div>
                    </div>
                </section>

                {/* Quick Stats */}
                <section
                    id="quick-stats"
                    data-animate
                    className={`mb-16 transition-all duration-1000 delay-100 ${visibleSections.has('quick-stats') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <QuickStatCard label="Investimento Total" value={fmtCurrency(data.totalSpend)} highlight delay={0} />
                        <QuickStatCard label="Resultados Gerados" value={fmtNumber(data.totalResults)} delay={100} />
                        <QuickStatCard label="Custo por Resultado" value={fmtCurrency(cpa)} delay={200} />
                        <QuickStatCard label="Taxa de Cliques" value={fmtPercent(data.avgCtr)} delay={300} />
                    </div>
                </section>

                {/* Funnel Section with SVG Funnel */}
                <section
                    id="funnel"
                    data-animate
                    className={`mb-16 transition-all duration-1000 delay-200 ${visibleSections.has('funnel') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                        <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-700 rounded-full" />
                        Funil de Conversão
                    </h2>
                    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-8 print:bg-gray-50 print:border-gray-200">
                        <div className="flex flex-col lg:flex-row items-center gap-8">
                            {/* SVG Funnel Chart */}
                            <div className="flex-1 flex justify-center">
                                <svg viewBox="0 0 300 250" className="w-full max-w-md">
                                    {/* Funnel shapes */}
                                    <defs>
                                        <linearGradient id="funnel1" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#9333ea" />
                                            <stop offset="100%" stopColor="#a855f7" />
                                        </linearGradient>
                                        <linearGradient id="funnel2" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#7c3aed" />
                                            <stop offset="100%" stopColor="#8b5cf6" />
                                        </linearGradient>
                                        <linearGradient id="funnel3" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#16a34a" />
                                            <stop offset="100%" stopColor="#22c55e" />
                                        </linearGradient>
                                    </defs>

                                    {/* Impressões - widest */}
                                    <path
                                        d="M 20 20 L 280 20 L 250 80 L 50 80 Z"
                                        fill="url(#funnel1)"
                                        className={`transition-all duration-1000 ${visibleSections.has('funnel') ? 'opacity-100' : 'opacity-0'}`}
                                        style={{ transitionDelay: '0ms' }}
                                    />
                                    <text x="150" y="45" textAnchor="middle" fill="white" className="text-sm font-bold">
                                        {fmtNumber(totalImpressions)}
                                    </text>
                                    <text x="150" y="62" textAnchor="middle" fill="rgba(255,255,255,0.8)" className="text-xs">
                                        Impressões
                                    </text>

                                    {/* Cliques - medium */}
                                    <path
                                        d="M 50 90 L 250 90 L 210 150 L 90 150 Z"
                                        fill="url(#funnel2)"
                                        className={`transition-all duration-1000 ${visibleSections.has('funnel') ? 'opacity-100' : 'opacity-0'}`}
                                        style={{ transitionDelay: '300ms' }}
                                    />
                                    <text x="150" y="115" textAnchor="middle" fill="white" className="text-sm font-bold">
                                        {fmtNumber(totalClicks)}
                                    </text>
                                    <text x="150" y="132" textAnchor="middle" fill="rgba(255,255,255,0.8)" className="text-xs">
                                        Cliques ({fmtPercent(data.avgCtr)})
                                    </text>

                                    {/* Conversões - narrowest */}
                                    <path
                                        d="M 90 160 L 210 160 L 170 220 L 130 220 Z"
                                        fill="url(#funnel3)"
                                        className={`transition-all duration-1000 ${visibleSections.has('funnel') ? 'opacity-100' : 'opacity-0'}`}
                                        style={{ transitionDelay: '600ms' }}
                                    />
                                    <text x="150" y="185" textAnchor="middle" fill="white" className="text-sm font-bold">
                                        {fmtNumber(data.totalResults)}
                                    </text>
                                    <text x="150" y="202" textAnchor="middle" fill="rgba(255,255,255,0.8)" className="text-xs">
                                        Conversões ({fmtPercent(conversionRate)})
                                    </text>

                                    {/* Arrows */}
                                    <path d="M 150 82 L 150 88" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                                    <path d="M 150 152 L 150 158" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                                </svg>
                            </div>

                            {/* Stats sidebar */}
                            <div className="flex-1 space-y-4">
                                <div className="bg-purple-600/20 rounded-2xl p-4 border border-purple-500/20">
                                    <div className="text-sm text-white/60 mb-1">Taxa de Cliques (CTR)</div>
                                    <div className="text-3xl font-bold text-purple-300">{fmtPercent(data.avgCtr)}</div>
                                </div>
                                <div className="bg-purple-500/20 rounded-2xl p-4 border border-purple-500/20">
                                    <div className="text-sm text-white/60 mb-1">Taxa de Conversão</div>
                                    <div className="text-3xl font-bold text-purple-200">{fmtPercent(conversionRate)}</div>
                                </div>
                                <div className="bg-green-600/20 rounded-2xl p-4 border border-green-500/20">
                                    <div className="text-sm text-white/60 mb-1">Custo por Conversão</div>
                                    <div className="text-3xl font-bold text-green-300">{fmtCurrency(cpa)}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Donut Chart Section */}
                <section
                    id="donut"
                    data-animate
                    className={`mb-16 transition-all duration-1000 delay-300 ${visibleSections.has('donut') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                        <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-700 rounded-full" />
                        <PieChart className="w-6 h-6 text-purple-400" />
                        Distribuição de Investimento
                    </h2>
                    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-8 print:bg-gray-50">
                        <div className="flex flex-col lg:flex-row items-center gap-8">
                            {/* SVG Donut Chart */}
                            <div className="flex-1 flex justify-center">
                                <svg viewBox="0 0 200 200" className="w-64 h-64">
                                    {pieData.map((segment, idx) => {
                                        const startAngle = pieData.slice(0, idx).reduce((acc, s) => acc + s.percentage * 3.6, 0);
                                        const endAngle = startAngle + segment.percentage * 3.6;
                                        const largeArc = segment.percentage > 50 ? 1 : 0;

                                        const startX = 100 + 70 * Math.cos((startAngle - 90) * Math.PI / 180);
                                        const startY = 100 + 70 * Math.sin((startAngle - 90) * Math.PI / 180);
                                        const endX = 100 + 70 * Math.cos((endAngle - 90) * Math.PI / 180);
                                        const endY = 100 + 70 * Math.sin((endAngle - 90) * Math.PI / 180);

                                        return (
                                            <path
                                                key={idx}
                                                d={`M 100 100 L ${startX} ${startY} A 70 70 0 ${largeArc} 1 ${endX} ${endY} Z`}
                                                fill={segment.color}
                                                className={`transition-all duration-1000 hover:opacity-80 ${visibleSections.has('donut') ? 'opacity-100' : 'opacity-0'}`}
                                                style={{ transitionDelay: `${idx * 200}ms` }}
                                            />
                                        );
                                    })}
                                    {/* Center hole */}
                                    <circle cx="100" cy="100" r="40" fill="#0a0a14" className="print:fill-white" />
                                    <text x="100" y="95" textAnchor="middle" fill="white" className="text-xs font-medium print:fill-gray-800">Total</text>
                                    <text x="100" y="112" textAnchor="middle" fill="white" className="text-sm font-bold print:fill-gray-800">{fmtCurrency(totalSpend)}</text>
                                </svg>
                            </div>

                            {/* Legend */}
                            <div className="flex-1 space-y-3">
                                {pieData.map((segment, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all duration-500 ${visibleSections.has('donut') ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'}`}
                                        style={{ transitionDelay: `${idx * 100 + 500}ms` }}
                                    >
                                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: segment.color }} />
                                        <div className="flex-1">
                                            <div className="text-sm text-white/80 truncate">{segment.name}</div>
                                            <div className="text-xs text-white/50">{fmtCurrency(segment.value)}</div>
                                        </div>
                                        <div className="text-lg font-bold text-white">{segment.percentage.toFixed(0)}%</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Campaigns Bar Charts */}
                <section
                    id="campaigns"
                    data-animate
                    className={`mb-16 transition-all duration-1000 delay-400 ${visibleSections.has('campaigns') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                        <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-700 rounded-full" />
                        Desempenho por Campanha
                    </h2>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-6 print:bg-gray-50">
                            <h3 className="text-lg font-semibold mb-6 text-white/80 print:text-gray-800">Investimento por Campanha</h3>
                            <div className="space-y-4">
                                {data.campaigns.slice(0, 5).map((campaign, idx) => {
                                    const maxSpend = Math.max(...data.campaigns.map(c => c.spend));
                                    const percentage = (campaign.spend / maxSpend) * 100;
                                    return (
                                        <AnimatedBar
                                            key={campaign.id || idx}
                                            label={campaign.name}
                                            value={fmtCurrency(campaign.spend)}
                                            percentage={percentage}
                                            isVisible={visibleSections.has('campaigns')}
                                            delay={idx * 150}
                                            color={['bg-purple-500', 'bg-purple-400', 'bg-purple-300', 'bg-violet-400', 'bg-violet-300'][idx]}
                                        />
                                    );
                                })}
                            </div>
                        </div>

                        <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-6 print:bg-gray-50">
                            <h3 className="text-lg font-semibold mb-6 text-white/80 print:text-gray-800">Resultados por Campanha</h3>
                            <div className="space-y-4">
                                {data.campaigns.slice(0, 5).map((campaign, idx) => {
                                    const maxResults = Math.max(...data.campaigns.map(c => c.results));
                                    const percentage = (campaign.results / maxResults) * 100;
                                    return (
                                        <AnimatedBar
                                            key={campaign.id || idx}
                                            label={campaign.name}
                                            value={`${fmtNumber(campaign.results)} leads`}
                                            percentage={percentage}
                                            isVisible={visibleSections.has('campaigns')}
                                            delay={idx * 150 + 500}
                                            color={['bg-green-500', 'bg-green-400', 'bg-emerald-400', 'bg-teal-400', 'bg-cyan-400'][idx]}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Campaigns Table */}
                <section
                    id="table"
                    data-animate
                    className={`mb-16 transition-all duration-1000 delay-500 ${visibleSections.has('table') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                        <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-700 rounded-full" />
                        Tabela Detalhada
                    </h2>
                    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden print:bg-white print:border-gray-200">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-purple-600/20 border-b border-white/10 print:bg-purple-100">
                                        <th className="text-left p-4 text-white/80 font-medium print:text-gray-800">Campanha</th>
                                        <th className="text-right p-4 text-white/80 font-medium print:text-gray-800">Investimento</th>
                                        <th className="text-right p-4 text-white/80 font-medium print:text-gray-800">Resultados</th>
                                        <th className="text-right p-4 text-white/80 font-medium print:text-gray-800">CPA</th>
                                        <th className="text-right p-4 text-white/80 font-medium print:text-gray-800">CTR</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.campaigns.map((campaign, idx) => (
                                        <tr
                                            key={campaign.id || idx}
                                            className={`border-b border-white/5 hover:bg-white/5 transition-all duration-300 print:border-gray-200 ${visibleSections.has('table') ? 'opacity-100' : 'opacity-0'}`}
                                            style={{ transitionDelay: `${idx * 50}ms` }}
                                        >
                                            <td className="p-4">
                                                <span className="font-medium text-white/90 print:text-gray-800">{campaign.name}</span>
                                            </td>
                                            <td className="p-4 text-right text-white/70 print:text-gray-600">{fmtCurrency(campaign.spend)}</td>
                                            <td className="p-4 text-right">
                                                <span className="text-green-400 font-medium print:text-green-600">{fmtNumber(campaign.results)}</span>
                                            </td>
                                            <td className="p-4 text-right text-white/70 print:text-gray-600">{fmtCurrency(campaign.costPerResult)}</td>
                                            <td className="p-4 text-right text-white/70 print:text-gray-600">{fmtPercent(campaign.ctr)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* AI Insight */}
                {report.ai_insight && (
                    <section
                        id="ai"
                        data-animate
                        className={`mb-16 transition-all duration-1000 delay-600 ${visibleSections.has('ai') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                    >
                        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                            <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-700 rounded-full" />
                            <Sparkles className="w-6 h-6 text-purple-400" />
                            Análise Estratégica da IA
                        </h2>
                        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-900/30 to-purple-600/10 border border-purple-500/20 p-8 print:bg-purple-50">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-[80px] print:hidden" />
                            <div className="relative prose prose-invert prose-purple max-w-none print:prose-gray">
                                <div className="whitespace-pre-wrap text-white/80 leading-relaxed print:text-gray-700">
                                    {report.ai_insight.replace(/\*\*/g, '').replace(/###/g, '').replace(/#/g, '')}
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Glossary Accordion */}
                <section
                    id="glossary"
                    data-animate
                    className={`mb-16 transition-all duration-1000 delay-700 ${visibleSections.has('glossary') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                >
                    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden print:bg-gray-50">
                        <button
                            onClick={() => setGlossaryOpen(!glossaryOpen)}
                            className="w-full flex items-center justify-between p-6 hover:bg-white/5 transition-colors print:hidden"
                        >
                            <h3 className="text-lg font-semibold text-white/80 flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-purple-400" />
                                Glossário de Termos
                            </h3>
                            <ChevronRight className={`w-5 h-5 text-white/50 transition-transform duration-300 ${glossaryOpen ? 'rotate-90' : ''}`} />
                        </button>
                        <div className={`overflow-hidden transition-all duration-500 ${glossaryOpen ? 'max-h-96' : 'max-h-0'} print:max-h-full`}>
                            <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <GlossaryItem term="CTR" desc="Click-Through Rate - Taxa de cliques sobre impressões" color="purple" />
                                <GlossaryItem term="CPC" desc="Cost Per Click - Custo médio por clique" color="blue" />
                                <GlossaryItem term="CPA" desc="Cost Per Acquisition - Custo por resultado" color="green" />
                                <GlossaryItem term="ROAS" desc="Return on Ad Spend - Retorno sobre investimento" color="orange" />
                                <GlossaryItem term="Impressões" desc="Número de vezes que o anúncio foi exibido" color="cyan" />
                                <GlossaryItem term="Conversões" desc="Leads ou ações concluídas" color="pink" />
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="relative z-10 border-t border-white/5 py-12 bg-[#0a0a14]/80 print:bg-white print:border-gray-200">
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <img
                        src="https://i.ibb.co/Y44FV9Kv/Ativo-1-2x.png"
                        alt="Zafira"
                        className="h-12 mx-auto mb-4 brightness-0 invert opacity-80 print:invert-0"
                    />
                    <p className="text-white/30 text-sm print:text-gray-500">
                        Relatório gerado por Zafira Hub © {new Date().getFullYear()}
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-3 text-white/20 text-xs print:text-gray-400">
                        <Eye className="w-3 h-3" />
                        <span>{(report.views || 0) + 1} visualizações</span>
                    </div>
                </div>
            </footer>
        </div>
    );
};

// ==================== COMPONENTES ====================

const QuickStatCard = ({ label, value, highlight = false, delay = 0 }: { label: string; value: string; highlight?: boolean; delay?: number; }) => (
    <div
        className={`relative overflow-hidden rounded-2xl p-6 border transition-all duration-500 hover:scale-105 group print:hover:scale-100 ${highlight ? 'bg-gradient-to-br from-purple-600/30 to-purple-900/30 border-purple-500/30 print:bg-purple-100' : 'bg-white/5 border-white/10 print:bg-gray-100'}`}
        style={{ transitionDelay: `${delay}ms` }}
    >
        {highlight && <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/10 to-purple-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 print:hidden" />}
        <div className="relative">
            <p className="text-xs text-white/50 uppercase tracking-wider mb-2 print:text-gray-600">{label}</p>
            <p className={`text-2xl md:text-3xl font-bold ${highlight ? 'text-purple-300 print:text-purple-700' : 'text-white print:text-gray-800'}`}>{value}</p>
        </div>
    </div>
);

const AnimatedBar = ({ label, value, percentage, isVisible, delay, color }: { label: string; value: string; percentage: number; isVisible: boolean; delay: number; color: string; }) => (
    <div className="space-y-2">
        <div className="flex justify-between text-sm">
            <span className="text-white/70 truncate pr-4 max-w-[60%] print:text-gray-600">{label}</span>
            <span className="text-white font-medium print:text-gray-800">{value}</span>
        </div>
        <div className="h-3 bg-white/5 rounded-full overflow-hidden print:bg-gray-200">
            <div
                className={`h-full ${color} rounded-full transition-all duration-1000 ease-out`}
                style={{ width: isVisible ? `${percentage}%` : '0%', transitionDelay: `${delay}ms` }}
            />
        </div>
    </div>
);

const GlossaryItem = ({ term, desc, color }: { term: string; desc: string; color: string }) => {
    const colorMap: Record<string, string> = {
        purple: 'bg-purple-500/50 text-purple-400',
        blue: 'bg-blue-500/50 text-blue-400',
        green: 'bg-green-500/50 text-green-400',
        orange: 'bg-orange-500/50 text-orange-400',
        cyan: 'bg-cyan-500/50 text-cyan-400',
        pink: 'bg-pink-500/50 text-pink-400',
    };
    return (
        <div className="flex gap-3">
            <div className={`w-1 rounded-full ${colorMap[color].split(' ')[0]}`} />
            <div>
                <strong className={colorMap[color].split(' ')[1]}>{term}</strong>
                <span className="text-white/50 print:text-gray-600"> - {desc}</span>
            </div>
        </div>
    );
};

export default PublicReport;
