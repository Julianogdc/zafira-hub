import { useState } from 'react';
import { Download, Upload, RefreshCw, HardDrive, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from "@/hooks/use-toast";
import { STORAGE_KEYS, ZAFIRA_VERSION } from './constants';

export function DataBackupCard() {
    const { toast } = useToast();
    const [isImporting, setIsImporting] = useState(false);

    const handleExportData = () => {
        try {
            const data = {
                meta: {
                    version: ZAFIRA_VERSION,
                    exportDate: new Date().toISOString(),
                    app: "Zafira Hub"
                },
                stores: {
                    finance: localStorage.getItem(STORAGE_KEYS.finance) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.finance)!) : null,
                    goals: localStorage.getItem(STORAGE_KEYS.goals) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.goals)!) : null,
                    clients: localStorage.getItem(STORAGE_KEYS.clients) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.clients)!) : null,
                    tools: localStorage.getItem(STORAGE_KEYS.tools) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.tools)!) : null,
                    ai: localStorage.getItem(STORAGE_KEYS.ai) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.ai)!) : null,
                }
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `zafira-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast({
                title: "Backup concluído",
                description: "O arquivo de dados foi gerado com sucesso.",
            });
        } catch (error) {
            console.error("Erro na exportação", error);
            toast({
                variant: "destructive",
                title: "Erro na exportação",
                description: "Falha ao compilar os dados locais.",
            });
        }
    };

    const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target?.result as string);

                // Validação básica
                if (!json.stores || !json.meta) {
                    throw new Error("Formato de arquivo inválido para Zafira Hub.");
                }

                // Importação (Sobrescrita do LocalStorage)
                if (json.stores.finance) localStorage.setItem(STORAGE_KEYS.finance, JSON.stringify(json.stores.finance));
                if (json.stores.goals) localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(json.stores.goals));
                if (json.stores.clients) localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(json.stores.clients));
                if (json.stores.tools) localStorage.setItem(STORAGE_KEYS.tools, JSON.stringify(json.stores.tools));
                if (json.stores.ai) localStorage.setItem(STORAGE_KEYS.ai, JSON.stringify(json.stores.ai));

                toast({
                    title: "Importação concluída",
                    description: "O sistema será recarregado para aplicar os dados.",
                });

                // Delay para UX e Reload para forçar o Zustand a reler o localStorage
                setTimeout(() => {
                    window.location.reload();
                }, 1500);

            } catch (error) {
                console.error(error);
                toast({
                    variant: "destructive",
                    title: "Erro na importação",
                    description: "O arquivo está corrompido ou é incompatível.",
                });
                setIsImporting(false);
            }
        };
        reader.readAsText(file);
    };

    return (
        <Card className="glass-panel border-white/10 md:col-span-2">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <HardDrive className="h-5 w-5 text-blue-400" />
                    Controle de Dados (Backup)
                </CardTitle>
                <CardDescription>
                    Seus dados vivem no navegador. Exporte-os regularmente para segurança.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                    <Button onClick={handleExportData} className="flex-1" variant="outline">
                        <Download className="mr-2 h-4 w-4" />
                        Exportar Tudo (.json)
                    </Button>

                    <div className="flex-1 relative">
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleImportData}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            disabled={isImporting}
                        />
                        <Button className="w-full bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30" disabled={isImporting}>
                            {isImporting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            {isImporting ? "Importando..." : "Importar Backup"}
                        </Button>
                    </div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 text-sm text-yellow-200 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>A importação substitui <strong>todos</strong> os dados atuais pelos do arquivo selecionado. Esta ação é irreversível.</p>
                </div>
            </CardContent>
        </Card>
    );
}
