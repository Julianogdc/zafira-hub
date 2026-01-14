import { useMemo } from 'react';
import { Lead } from '@/types/crm';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { STATUS_TRANSLATIONS } from '@/constants/crm';

interface CRMDashboardProps {
    leads: Lead[];
}

const COLORS = ['#0ea5e9', '#eab308', '#a855f7', '#f97316', '#10b981', '#ef4444'];

export function CRMDashboard({ leads }: CRMDashboardProps) {
    const stats = useMemo(() => {
        const total = leads.length;
        const won = leads.filter(l => l.status === 'closed').length;
        const lost = leads.filter(l => l.status === 'lost').length;
        const open = total - won - lost;
        const totalValue = leads.reduce((acc, curr) => acc + curr.value, 0);
        const wonValue = leads.filter(l => l.status === 'closed').reduce((acc, curr) => acc + curr.value, 0);
        const conversionRate = total > 0 ? ((won / total) * 100).toFixed(1) : '0.0';

        // 1. Leads by Status
        const statusCounts = leads.reduce((acc, curr) => {
            acc[curr.status] = (acc[curr.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const statusData = Object.entries(statusCounts).map(([key, value]) => ({
            name: STATUS_TRANSLATIONS[key] || key,
            count: value,
            fill: key === 'closed' ? '#10b981' : key === 'lost' ? '#ef4444' : '#6366f1' // Green for won, Red for lost, Indigo for others
        }));

        // 2. Leads by Source
        const sourceCounts = leads.reduce((acc, curr) => {
            acc[curr.source] = (acc[curr.source] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const sourceData = Object.entries(sourceCounts).map(([key, value]) => ({
            name: key.replace('_', ' ').toUpperCase(),
            value: value
        }));

        // 3. Lost Reasons
        const lostReasonCounts = leads
            .filter(l => l.status === 'lost' && l.lostReason)
            .reduce((acc, curr) => {
                const reason = curr.lostReason!;
                acc[reason] = (acc[reason] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

        const lostReasonData = Object.entries(lostReasonCounts)
            .map(([key, value]) => ({ name: key, count: value }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5); // Top 5 reasons

        return {
            total,
            won,
            lost,
            open,
            totalValue,
            wonValue,
            conversionRate,
            statusData,
            sourceData,
            lostReasonData
        };
    }, [leads]);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(val);

    return (
        <div className="space-y-6 pb-6">
            {/* KPI Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-zinc-900/50 border-white/5">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-medium text-zinc-400">Total de Leads</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-white">{stats.total}</div>
                        <p className="text-xs text-zinc-500">{formatCurrency(stats.totalValue)} em pipeline</p>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-900/50 border-white/5">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-500/80">Fechados (Ganho)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-emerald-500">{stats.won}</div>
                        <p className="text-xs text-emerald-500/60">{formatCurrency(stats.wonValue)} faturado</p>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-900/50 border-white/5">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-medium text-red-500/80">Perdidos</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-red-500">{stats.lost}</div>
                        <p className="text-xs text-zinc-500">{(stats.lost / (stats.total || 1) * 100).toFixed(0)}% de perda</p>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-900/50 border-white/5">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-medium text-blue-500/80">Conversão</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-blue-500">{stats.conversionRate}%</div>
                        <p className="text-xs text-zinc-500">Taxa global</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[300px]">
                {/* Leads by Status Chart */}
                <Card className="bg-zinc-900/50 border-white/5 flex flex-col">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-zinc-200">Funil de Vendas</CardTitle>
                        <CardDescription>Quantidade de leads por etapa</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0 pl-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.statusData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                                <XAxis type="number" stroke="#666" fontSize={12} />
                                <YAxis dataKey="name" type="category" width={100} stroke="#999" fontSize={11} tick={{ fill: '#999' }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                    cursor={{ fill: 'transparent' }} // remove hover background on bars
                                />
                                <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20}>
                                    {stats.statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Leads by Source Pie Chart */}
                <Card className="bg-zinc-900/50 border-white/5 flex flex-col">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-zinc-200">Origem dos Leads</CardTitle>
                        <CardDescription>De onde vêm seus clientes?</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0 relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.sourceData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={90}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {stats.sourceData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }} />
                                <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px', color: '#999' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Lost Reasons (if any) */}
            {stats.lostReasonData.length > 0 && (
                <Card className="bg-zinc-900/50 border-white/5">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-red-400">Principais Motivos de Perda</CardTitle>
                        <CardDescription>Por que os leads não fecharam?</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[250px] pl-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.lostReasonData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                                <XAxis type="number" stroke="#666" fontSize={12} />
                                <YAxis dataKey="name" type="category" width={140} stroke="#999" fontSize={11} tick={{ fill: '#999' }} />
                                <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }} />
                                <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
