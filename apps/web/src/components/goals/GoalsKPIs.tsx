import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, AlertTriangle, CheckCircle2, BarChart3 } from "lucide-react";

interface GoalsKPIsProps {
    total: number;
    emAtraso: number;
    concluidas: number;
    percentConcluidas: number;
}

export function GoalsKPIs({ total, emAtraso, concluidas, percentConcluidas }: GoalsKPIsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-4">
            <Card className="border border-border/70 bg-card/80 backdrop-blur-xl">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Target className="h-4 w-4 text-primary" /> Metas ativas
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold">{total}</p>
                </CardContent>
            </Card>

            <Card className="border border-amber-400/60 bg-card/80 backdrop-blur-xl">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                        <AlertTriangle className="h-4 w-4 text-amber-400" /> Em atraso
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold text-amber-300">{emAtraso}</p>
                </CardContent>
            </Card>

            <Card className="border border-emerald-400/60 bg-card/80 backdrop-blur-xl">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Concluídas
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold text-emerald-400">{concluidas}</p>
                </CardContent>
            </Card>

            <Card className="border border-border/70 bg-card/80 backdrop-blur-xl">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                        <BarChart3 className="h-4 w-4" /> Taxa de Sucesso
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-semibold">{percentConcluidas}%</p>
                </CardContent>
            </Card>
        </div>
    );
}
