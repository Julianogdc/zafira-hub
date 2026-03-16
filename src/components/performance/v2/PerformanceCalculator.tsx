import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Calculator } from 'lucide-react';
import { PerformanceReport } from '@/types/performance';
import { Client } from '@/types/client';

interface PerformanceCalculatorProps {
    report: PerformanceReport;
    client: Client;
}

export function PerformanceCalculator({ report, client }: PerformanceCalculatorProps) {
    const [sales, setSales] = useState<number | ''>('');
    const storageKey = `zafira_sales_${client.id}_${report.month}`;

    useEffect(() => {
        const savedSales = localStorage.getItem(storageKey);
        if (savedSales !== null && savedSales !== '') {
            setSales(Number(savedSales));
        } else {
            setSales('');
        }
    }, [storageKey]);

    const handleSalesChange = (val: string) => {
        if (val === '') {
            setSales('');
            localStorage.removeItem(storageKey);
            return;
        }
        const num = Number(val);
        if (!isNaN(num) && num >= 0) {
            setSales(num);
            localStorage.setItem(storageKey, num.toString());
        }
    };

    const leads = report.totalResults || 0;
    const spend = report.totalSpend || 0;
    const numSales = typeof sales === 'number' ? sales : 0;

    const conversionRate = leads > 0 && numSales > 0 ? (numSales / leads) * 100 : 0;
    const costPerAcquisition = numSales > 0 ? spend / numSales : 0;

    return (
        <Card className="border-pink-500/20 bg-gradient-to-br from-background to-pink-500/5 shadow-md h-full">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center text-pink-600 gap-2">
                    <Calculator className="h-5 w-5" />
                    Conversão & CPA
                </CardTitle>
                <CardDescription>Calcule os custos reais de venda</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-2">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Leads / Resultados:</span>
                        <span className="font-bold">{leads.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Custo p/ Lead:</span>
                        <span className="font-bold text-muted-foreground">R$ {leads > 0 ? (spend / leads).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</span>
                    </div>
                    <div className="flex items-center justify-between items-center pt-1">
                        <span className="text-sm font-medium text-foreground">Vendas Fechadas:</span>
                        <Input
                            type="number"
                            className="w-24 h-8 text-right font-bold bg-background"
                            placeholder="0"
                            value={sales}
                            onChange={(e) => handleSalesChange(e.target.value)}
                        />
                    </div>
                </div>

                <Separator className="bg-pink-500/20" />

                <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col p-2 bg-background/60 rounded-lg border border-pink-500/10 shadow-sm">
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Taxa de Conv.</span>
                        <span className="font-bold text-pink-600 text-lg leading-tight mt-auto">
                            {conversionRate.toFixed(2)}%
                        </span>
                    </div>
                    <div className="flex flex-col p-2 bg-background/60 rounded-lg border border-pink-500/10 shadow-sm">
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Custo/Venda (CPA)</span>
                        <span className="font-bold text-pink-600 text-lg leading-tight mt-auto">
                            R$ {costPerAcquisition.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
