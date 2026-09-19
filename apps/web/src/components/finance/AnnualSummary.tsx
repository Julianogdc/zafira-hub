import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { CashFlowChart } from "@/components/finance/CashFlowChart";
import { Transaction } from "@/types/finance";

interface AnnualSummaryProps {
    currentYear: number;
    receitaAnual: number;
    despesaAnual: number;
    caixaAnual: number;
    yearTransactions: Transaction[];
    formatBRL: (val: number) => string;
}

export function AnnualSummary({
    currentYear,
    receitaAnual,
    despesaAnual,
    caixaAnual,
    yearTransactions,
    formatBRL
}: AnnualSummaryProps) {

    // Prepara dados Pizza
    const pieData = [
        { name: "Receita", value: receitaAnual },
        { name: "Despesa", value: despesaAnual },
    ];

    // Prepara dados Barras (Meses)
    const monthlyData = Array.from({ length: 12 }).map((_, month) => {
        const monthTx = yearTransactions.filter(
            (t) => new Date(t.date).getMonth() === month
        );

        return {
            month: new Date(currentYear, month).toLocaleString("pt-BR", {
                month: "short",
            }),
            receita: monthTx
                .filter((t) => t.type === "income")
                .reduce((acc, t) => acc + t.amount, 0),
            despesa: monthTx
                .filter((t) => t.type === "expense")
                .reduce((acc, t) => acc + t.amount, 0),
        };
    });

    return (
        <Card className="bg-card/80 backdrop-blur-xl">
            <CardHeader>
                <CardTitle>Resumo anual • {currentYear}</CardTitle>
                <CardDescription>
                    Leitura consolidada do desempenho financeiro do ano
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-8">
                <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border bg-background/40 p-4">
                        <p className="text-sm text-muted-foreground">Receita anual</p>
                        <p className="text-xl font-semibold text-emerald-400">
                            {formatBRL(receitaAnual)}
                        </p>
                    </div>

                    <div className="rounded-lg border bg-background/40 p-4">
                        <p className="text-sm text-muted-foreground">Despesa anual</p>
                        <p className="text-xl font-semibold text-rose-400">
                            {formatBRL(despesaAnual)}
                        </p>
                    </div>

                    <div className="rounded-lg border bg-background/40 p-4">
                        <p className="text-sm text-muted-foreground">Caixa final</p>
                        <p className="text-xl font-semibold text-primary">
                            {formatBRL(caixaAnual)}
                        </p>
                    </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-lg border bg-background/40 p-4">
                        <p className="mb-4 text-sm font-medium">
                            Proporção Receita × Despesa
                        </p>
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    dataKey="value"
                                    nameKey="name"
                                    innerRadius={60}
                                    outerRadius={90}
                                    paddingAngle={4}
                                >
                                    <Cell fill="#34d399" />
                                    <Cell fill="#fb7185" />
                                </Pie>
                                <Tooltip formatter={(v: number) => formatBRL(v)} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="rounded-lg border bg-background/40 p-4">
                        <p className="mb-4 text-sm font-medium">
                            Receitas e despesas por mês
                        </p>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={monthlyData}>
                                <XAxis dataKey="month" />
                                <YAxis hide />
                                <Tooltip formatter={(v: number) => formatBRL(v)} />
                                <Bar dataKey="receita" fill="#34d399" />
                                <Bar dataKey="despesa" fill="#fb7185" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="rounded-lg border bg-background/40 p-4">
                    <p className="mb-4 text-sm font-medium">Fluxo de caixa anual</p>
                    <CashFlowChart transactions={yearTransactions} />
                </div>
            </CardContent>
        </Card>
    );
}
