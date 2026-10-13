import React, { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts';
import { useCRMStore } from '@/store/useCRMStore';

interface FunnelData {
    name: string;
    count: number;
    color: string;
}

const STATUS_CONFIG = [
    { id: 'prospect', label: 'Novos', color: '#60a5fa' }, // Blue 400
    { id: 'contact', label: 'Contatados', color: '#818cf8' }, // Indigo 400
    { id: 'proposal', label: 'Proposta', color: '#c084fc' }, // Purple 400
    { id: 'negotiation', label: 'Negociação', color: '#f472b6' }, // Pink 400
    { id: 'closed', label: 'Fechado', color: '#34d399' }, // Emerald 400 (Won)
    // 'lost' excluded from main funnel usually, or added at bottom
];

import { Lead } from '@/types/crm';

interface SalesFunnelChartProps {
    leads?: Lead[];
}

export const SalesFunnelChart = ({ leads: propLeads }: SalesFunnelChartProps) => {
    const storeLeads = useCRMStore(state => state.leads);
    const leads = propLeads || storeLeads;

    const data = useMemo(() => {
        const counts = leads.reduce((acc, lead) => {
            acc[lead.status] = (acc[lead.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return STATUS_CONFIG.map(stage => ({
            name: stage.label,
            count: counts[stage.id] || 0,
            color: stage.color
        }));
    }, [leads]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg shadow-xl">
                    <p className="text-zinc-200 font-bold mb-1">{label}</p>
                    <p className="text-white text-sm">
                        {payload[0].value} Leads
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
                    layout="vertical"
                    margin={{
                        top: 5,
                        right: 30,
                        left: 40,
                        bottom: 5,
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={true} vertical={false} />
                    <XAxis type="number" hide />
                    <YAxis
                        dataKey="name"
                        type="category"
                        stroke="#888"
                        tick={{ fill: '#aaa', fontSize: 12 }}
                        width={80}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={30}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
