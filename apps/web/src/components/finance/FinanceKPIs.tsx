import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";

interface FinanceKPIsProps {
    caixa: number;
    receita: number;
    despesa: number;
    formatBRL: (val: number) => string;
}

export function FinanceKPIs({ caixa, receita, despesa, formatBRL }: FinanceKPIsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader className="flex justify-between pb-2">
                    <CardTitle className="text-sm">Caixa</CardTitle>
                    <Wallet className="h-5 w-5 text-emerald-400" />
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold text-emerald-400">
                        {formatBRL(caixa)}
                    </p>
                </CardContent>
            </Card>

            <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader className="flex justify-between pb-2">
                    <CardTitle className="text-sm">Receita</CardTitle>
                    <TrendingUp className="h-5 w-5 text-primary" />
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold">
                        {formatBRL(receita)}
                    </p>
                </CardContent>
            </Card>

            <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader className="flex justify-between pb-2">
                    <CardTitle className="text-sm">Despesa</CardTitle>
                    <TrendingDown className="h-5 w-5 text-rose-400" />
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold text-rose-300">
                        {formatBRL(despesa)}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
