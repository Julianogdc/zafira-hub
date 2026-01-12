import { useState, useEffect } from 'react';
import { Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { STORAGE_KEYS } from './constants';

export function AIGovernanceCard() {
    const { toast } = useToast();

    // Carregar configurações salvas ou padrão
    const [aiSettings, setAiSettings] = useState(() => {
        const stored = localStorage.getItem(STORAGE_KEYS.ai);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error("Failed to parse AI settings", e);
            }
        }
        return {
            readFinance: true,
            readGoals: true,
            readClients: true,
            readProjects: true,
            readCrm: true
        };
    });

    // Persistir alterações automaticamente
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.ai, JSON.stringify(aiSettings));
    }, [aiSettings]);

    const toggleAiSetting = (key: keyof typeof aiSettings) => {
        setAiSettings((prev: any) => ({ ...prev, [key]: !prev[key] }));
        // Toast removido para evitar spam visual na troca rápida, ou manter se desejar feedback
        // Mas como é persistência silenciosa, talvez seja melhor sem. 
        // O user quer "correção de botões", então vou manter o toast mas mais sutil ou manter como estava
    };

    const handleResetModule = (moduleName: string, key: string) => {
        localStorage.removeItem(key);
        toast({
            title: `${moduleName} resetado`,
            description: "Recarregando sistema...",
        });
        setTimeout(() => window.location.reload(), 1000);
    };

    return (
        <Card className="glass-panel border-white/10">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-purple-400" />
                    IA Studio
                </CardTitle>
                <CardDescription>
                    Controle o que a Inteligência Artificial pode ler.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>Ler Finanças</Label>
                            <p className="text-xs text-muted-foreground">Permitir análise de fluxo de caixa</p>
                        </div>
                        <Switch checked={aiSettings.readFinance} onCheckedChange={() => toggleAiSetting('readFinance')} />
                    </div>
                    <Separator className="bg-white/5" />
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>Ler Metas</Label>
                            <p className="text-xs text-muted-foreground">Permitir análise de objetivos</p>
                        </div>
                        <Switch checked={aiSettings.readGoals} onCheckedChange={() => toggleAiSetting('readGoals')} />
                    </div>
                    <Separator className="bg-white/5" />
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>Ler Clientes</Label>
                            <p className="text-xs text-muted-foreground">Permitir contexto de contratos</p>
                        </div>
                        <Switch checked={aiSettings.readClients} onCheckedChange={() => toggleAiSetting('readClients')} />
                    </div>
                    <Separator className="bg-white/5" />
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>Ler Projetos</Label>
                            <p className="text-xs text-muted-foreground">Permitir acompanhamento de prazos</p>
                        </div>
                        <Switch checked={aiSettings.readProjects} onCheckedChange={() => toggleAiSetting('readProjects')} />
                    </div>
                    <Separator className="bg-white/5" />
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>Ler Comercial</Label>
                            <p className="text-xs text-muted-foreground">Permitir análise de leads e funil</p>
                        </div>
                        <Switch checked={aiSettings.readCrm} onCheckedChange={() => toggleAiSetting('readCrm')} />
                    </div>
                </div>

                <div className="pt-4">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" className="w-full border-purple-500/30 text-purple-300 hover:bg-purple-500/10">
                                Resetar Memória da IA
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="glass-panel">
                            <AlertDialogHeader>
                                <AlertDialogTitle>Resetar IA?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    O histórico do chat e o contexto aprendido serão apagados.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleResetModule("IA Studio", STORAGE_KEYS.ai)}>
                                    Resetar
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardContent>
        </Card>
    );
}
