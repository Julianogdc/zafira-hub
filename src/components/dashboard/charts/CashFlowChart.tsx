import React, { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from 'recharts';
import { useFinanceStore } from '@/store/useFinanceStore';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO, eachDayOfInterval, startOfDay, endOfDay, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ChartData {
    name: string;
    dateVal: number; // For sorting
    Receitas: number;
    Despesas: number;
}

export const CashFlowChart = () => {
    const { transactions } = useFinanceStore();

    const data = useMemo(() => {
        const today = new Date();
        // Check if we have data spanning more than 1 month
        if (transactions.length === 0) return [];

        const dates = transactions.map(t => new Date(t.date).getTime());
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));

        // Decide granularity: If data span is <= 31 days, show Daily. Else Monthly.
        const daySpan = (maxDate.getTime() - minDate.getTime()) / (1000 * 3600 * 24);
        const isDaily = daySpan <= 35 && daySpan >= 0; // Slightly more than a month to catch edge cases

        let chartData: ChartData[] = [];

        if (isDaily) {
            // Daily View (Last 30 days or range)
            const start = subDays(today, 30);
            const days = eachDayOfInterval({ start, end: today });

            chartData = days.map(day => {
                const dayStart = startOfDay(day);
                const dayEnd = endOfDay(day);

                const dayTrans = transactions.filter(t => {
                    const tDate = new Date(t.date);
                    return isWithinInterval(tDate, { start: dayStart, end: dayEnd });
                });

                return {
                    name: format(day, 'dd/MM'),
                    dateVal: day.getTime(),
                    Receitas: dayTrans.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0),
                    Despesas: dayTrans.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0),
                };
            });

        } else {
            // Monthly View (Last 6 Months)
            const last6Months = Array.from({ length: 6 }, (_, i) => {
                const d = subMonths(today, 5 - i);
                return {
                    date: d,
                    label: format(d, 'MMM', { locale: ptBR }).toUpperCase(),
                    start: startOfMonth(d),
                    end: endOfMonth(d)
                };
            });

            chartData = last6Months.map(month => {
                const monthTransactions = transactions.filter(t => {
                    const tDate = new Date(t.date);
                    return isWithinInterval(tDate, { start: month.start, end: month.end });
                });

                return {
                    name: month.label,
                    dateVal: month.date.getTime(),
                    Receitas: monthTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount), 0),
                    Despesas: monthTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount), 0)
                };
            });
        }

        // Sort by date ascending (Oldest -> Newest)
        return chartData.sort((a, b) => a.dateVal - b.dateVal);
    }, [transactions]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg shadow-xl">
                    <p className="text-zinc-200 font-bold mb-2">{label}</p>
                    <p className="text-emerald-400 text-sm">
                        Receitas: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(payload[0].value)}
                    </p>
                    <p className="text-red-400 text-sm">
                        Despesas: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(payload[1].value)}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={data}
                    margin={{
                        top: 20,
                        right: 30,
                        left: 20,
                        bottom: 5,
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis
                        dataKey="name"
                        stroke="#666"
                        tick={{ fill: '#888', fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        stroke="#666"
                        tick={{ fill: '#888', fontSize: 12 }}
                        tickFormatter={(value) => `R$${value / 1000}k`}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    <Bar dataKey="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
