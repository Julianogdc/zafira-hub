import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Target, Edit2 } from 'lucide-react';
import { PerformanceReport } from '@/types/performance';
import { Client } from '@/types/client';

interface PerformanceGoalTrackerProps {
    report: PerformanceReport;
    client: Client;
}

export function PerformanceGoalTracker({ report, client }: PerformanceGoalTrackerProps) {
    const [goal, setGoal] = useState<number | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState('');

    // Chave única para este cliente e este mês no localStorage
    const storageKey = `zafira_goal_${client.id}_${report.month}`;

    useEffect(() => {
        // Carregar meta salva ao montar ou ao mudar de cliente/mês
        const savedGoal = localStorage.getItem(storageKey);
        if (savedGoal) {
            setGoal(Number(savedGoal));
            setInputValue(savedGoal);
        } else {
            setGoal(null);
            setInputValue('');
            setIsEditing(true); // Se não tem meta, abre para edição
        }
    }, [storageKey]);

    const handleSaveGoal = () => {
        const parsedGoal = Number(inputValue);
        if (parsedGoal > 0) {
            localStorage.setItem(storageKey, parsedGoal.toString());
            setGoal(parsedGoal);
            setIsEditing(false);
        }
    };

    const currentResults = report.totalResults || 0;

    // Calcular progresso (max 100%)
    const percentage = goal ? Math.min(Math.round((currentResults / goal) * 100), 100) : 0;

    const circumference = 2 * Math.PI * 60; // r=60 (circulo mockado usava r=60 cx=cy=64)
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    // Cor muda baseada no progresso. Acima de 100% verde puxando pro roxo da zafira
    const progressColor = percentage >= 100 ? "stroke-emerald-500" : (percentage > 50 ? "stroke-blue-500" : "stroke-amber-500");

    return (
        <Card className="border-blue-500/20 bg-gradient-to-bl from-background to-blue-500/5 shadow-md h-full">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-blue-600">
                    <div className="flex items-center gap-2">
                        <Target className="h-5 w-5" />
                        Meta do Mês
                    </div>
                    {goal && !isEditing && (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setIsEditing(true)}>
                            <Edit2 className="h-3 w-3" />
                        </Button>
                    )}
                </CardTitle>
                <CardDescription>Acompanhamento de Resultados</CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col items-center justify-center p-6 gap-4">
                {(!goal || isEditing) ? (
                    <div className="w-full space-y-3 pt-4">
                        <p className="text-sm font-medium text-center text-muted-foreground">Defina a meta de resultados para este mês:</p>
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                placeholder="Ex: 100"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                className="text-center"
                            />
                            <Button onClick={handleSaveGoal} size="sm" className="bg-blue-600 hover:bg-blue-700">Salvar</Button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Real Gauge / Progress */}
                        <div className="relative w-32 h-32 flex items-center justify-center group">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="64" cy="64" r="60" className="stroke-muted fill-none stroke-[8]" />
                                <circle
                                    cx="64"
                                    cy="64"
                                    r="60"
                                    className={`${progressColor} fill-none stroke-[8] transition-all duration-1000 ease-out`}
                                    strokeDasharray={circumference}
                                    strokeDashoffset={strokeDashoffset}
                                    strokeLinecap="round"
                                />
                            </svg>
                            <div className="absolute flex flex-col items-center">
                                <span className="text-2xl font-bold">{percentage}%</span>
                                <span className="text-xs text-muted-foreground font-medium">{currentResults} / {goal}</span>
                            </div>
                        </div>

                        <p className="text-sm font-medium text-center px-2">
                            {percentage >= 100
                                ? <span className="text-emerald-500 font-semibold">Meta de {goal} batida com sucesso! 🎉</span>
                                : <span>Faltam <span className="font-bold text-foreground">{goal - currentResults}</span> resultados para bater a meta!</span>
                            }
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
