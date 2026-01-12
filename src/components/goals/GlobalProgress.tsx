import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface GlobalProgressProps {
    percentConcluidas: number;
}

export function GlobalProgress({ percentConcluidas }: GlobalProgressProps) {
    return (
        <Card className="border border-border/70 bg-card/80 backdrop-blur-xl">
            <CardHeader>
                <CardTitle className="text-base font-medium">Progresso Global</CardTitle>
                <CardDescription>Média de conclusão ponderada.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center py-6">
                <div className="relative h-40 w-40 flex items-center justify-center">
                    <svg viewBox="0 0 36 36" className="h-full w-full">
                        <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            className="text-muted/20"
                        />
                        <path
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeDasharray={`${percentConcluidas}, 100`}
                            className="text-primary"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold">{percentConcluidas}%</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
