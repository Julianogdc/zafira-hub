import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, TrendingDown, History } from "lucide-react";

interface FinanceKPIsProps {
    caixa: number; // Resultado do período
    receita: number;
    despesa: number;
    previousBalance: number;
    totalBalance: number;
    formatBRL: (val: number) => string;
}

export function FinanceKPIs({ caixa, receita, despesa, previousBalance, totalBalance, formatBRL }: FinanceKPIsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Caixa */}
            <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Caixa Anterior</CardTitle>
                    <History className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-lg font-bold text-muted-foreground">{formatBRL(previousBalance)}</div>
                    <p className="text-xs text-muted-foreground">
                        Acumulado até o início do período
                    </p>
                </CardContent>
            </Card>

            {/* Receita */}
            <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Receitas</CardTitle>
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-emerald-500">{formatBRL(receita)}</div>
                    <p className="text-xs text-muted-foreground">
                        Entradas do período
                    </p>
                </CardContent>
            </Card>

            {/* Despesa */}
            <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Despesas</CardTitle>
                    <TrendingDown className="h-4 w-4 text-rose-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-rose-500">{formatBRL(despesa)}</div>
                    <p className="text-xs text-muted-foreground">
                        Saídas do período
                    </p>
                </CardContent>
            </Card>

            {/* Caixa Atual (Total) */}
            <Card className="bg-card/80 backdrop-blur-xl border-emerald-500/20">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Caixa</CardTitle>
                    <Wallet className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-emerald-500">{formatBRL(totalBalance)}</div>
                    <p className="text-xs text-muted-foreground">
                        Resultado do Período: {caixa > 0 ? '+' : ''}{formatBRL(caixa)}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
