import { ShieldAlert } from 'lucide-react';
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

export function DangerZoneCard() {
    const { toast } = useToast();

    const handleTotalReset = () => {
        localStorage.clear();
        toast({
            variant: "destructive",
            title: "FACTORY RESET",
            description: "Adeus! O sistema foi completamente limpo.",
        });
        setTimeout(() => window.location.reload(), 1500);
    };

    return (
        <Card className="glass-panel border-red-900/30 md:col-span-2 bg-red-950/5">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-500">
                    <ShieldAlert className="h-5 w-5" />
                    Zona de Perigo
                </CardTitle>
                <CardDescription>
                    Ações destrutivas globais.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-sm text-muted-foreground">
                    <p>Ao realizar um Factory Reset, <strong>todos</strong> os dados do Zafira Hub serão apagados deste navegador.</p>
                    <p>Essa ação não pode ser desfeita.</p>
                </div>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full md:w-auto">
                            RESETAR ZAFIRA HUB
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glass-panel border-red-500/30">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-red-500">TEM CERTEZA ABSOLUTA?</AlertDialogTitle>
                            <AlertDialogDescription className="text-white/80">
                                Esta ação limpará Finanças, Metas, Clientes, Ferramentas e IA. <br /><br />
                                O sistema voltará ao estado de "instalação limpa".
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleTotalReset} className="bg-red-600 hover:bg-red-700">
                                SIM, APAGAR TUDO
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
        </Card>
    );
}
