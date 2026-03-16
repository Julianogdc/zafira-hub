import { useMemo, useState } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell
} from 'recharts';
import { PerformanceReport } from '@/types/performance';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle } from 'lucide-react';

interface PerformanceChartProps {
    currentReport: PerformanceReport;
    previousReport?: PerformanceReport | null;
}

export function PerformanceChart({ currentReport, previousReport }: PerformanceChartProps) {
    const [metric, setMetric] = useState<'spend' | 'results'>('spend');

    const chartData = useMemo(() => {
        // Pegar top 5 campanhas atuais (por gasto) para não poluir o gráfico
        const topCampaigns = [...currentReport.campaigns]
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 5);

        return topCampaigns.map(camp => {
            // Tentar achar campanha similar no mês passado pelo nome
            const prevCamp = previousReport?.campaigns.find(p => p.name === camp.name);

            return {
                name: camp.name.length > 20 ? camp.name.substring(0, 20) + '...' : camp.name,
                full_name: camp.name,
                current_spend: camp.spend,
                current_results: camp.results,
                previous_spend: prevCamp ? prevCamp.spend : 0,
                previous_results: prevCamp ? prevCamp.results : 0,
            };
        });
    }, [currentReport, previousReport]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-background/95 border border-border p-3 rounded-lg shadow-xl backdrop-blur-sm">
                    <p className="font-semibold text-sm mb-2">{payload[0].payload.full_name}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="text-muted-foreground">{entry.name}:</span>
                            <span className="font-bold">
                                {metric === 'spend'
                                    ? `R$ ${entry.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                    : entry.value.toLocaleString('pt-BR')}
                            </span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Select value={metric} onValueChange={(val: any) => setMetric(val)}>
                    <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue placeholder="Métrica" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="spend">Visão: Gastos (R$)</SelectItem>
                        <SelectItem value="results">Visão: Resultados</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {!previousReport && (
                <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 p-2 rounded-md mb-2">
                    <AlertCircle className="w-4 h-4" />
                    Nenhum relatório encontrado no mês imediatamente anterior para comparação. Exibindo apenas o mês atual.
                </div>
            )}

            <div className="h-[250px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
                        barGap={2}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.2} vertical={false} />
                        <XAxis
                            dataKey="name"
                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            dy={10}
                        />
                        <YAxis
                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => metric === 'spend' ? `R$${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val}` : val}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }} />
                        <Legend
                            iconType="circle"
                            wrapperStyle={{ fontSize: 12 }}
                            verticalAlign="top"
                            height={36}
                        />

                        {/* Linha Mês Passado (Tracejada/Fraca) */}
                        <Bar
                            dataKey={metric === 'spend' ? 'previous_spend' : 'previous_results'}
                            name="Mês Anterior"
                            fill="hsl(var(--muted-foreground))"
                            opacity={0.3}
                            radius={[4, 4, 0, 0]}
                        />

                        {/* Linha Mês Atual (Forte) */}
                        <Bar
                            dataKey={metric === 'spend' ? 'current_spend' : 'current_results'}
                            name="Mês Atual"
                            fill={metric === 'spend' ? '#8b5cf6' : '#22c55e'} // Roxo para spend, verde para results
                            radius={[4, 4, 0, 0]}
                        >
                            {chartData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={
                                        metric === 'spend'
                                            ? (entry.current_spend > entry.previous_spend ? '#ef4444' : '#8b5cf6') // Se gastou MAIS que mês passado, vermelho, senao Roxo normal
                                            : (entry.current_results > entry.previous_results ? '#22c55e' : '#eab308') // Se gerou MAIS results q mês anterior verde, senao amarelo
                                    }
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
