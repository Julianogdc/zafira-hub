import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function ResetZoneCard() {
    const { toast } = useToast();

    const handleResetModule = (moduleName: string, key: string | string[]) => {
        if (Array.isArray(key)) {
            key.forEach(k => localStorage.removeItem(k));
        } else {
            localStorage.removeItem(key);
        }

        toast({
            title: `${moduleName} resetado`,
            description: "Recarregando sistema...",
        });
        setTimeout(() => window.location.reload(), 1000);
    };

    const modules = [
        { label: "Finanças", key: [STORAGE_KEYS.finance, STORAGE_KEYS.finance_categories] },
        { label: "Metas", key: STORAGE_KEYS.goals },
        { label: "Clientes", key: STORAGE_KEYS.clients },
        { label: "Ferramentas", key: STORAGE_KEYS.tools },
    ];

    return (
        <Card className="glass-panel border-white/10">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Trash2 className="h-5 w-5 text-orange-400" />
                    Limpeza Seletiva
                </CardTitle>
                <CardDescription>
                    Resetar módulos específicos para o estado inicial.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {modules.map((item) => (
                    <div key={item.label} className="flex items-center justify-between p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors">
                        <span className="font-medium">{item.label}</span>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-900/20">
                                    Limpar
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="glass-panel border-white/10">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Limpar módulo de {item.label}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Isso apagará todos os registros de {item.label}. O sistema será recarregado.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleResetModule(item.label, item.key)} className="bg-red-600 hover:bg-red-700">
                                        Confirmar Limpeza
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
