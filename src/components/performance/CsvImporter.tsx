import { useState, useRef } from 'react';
import { usePerformanceStore, TrafficCampaign } from '../../store/usePerformanceStore';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface CsvImporterProps {
    clientId: string;
}

export const CsvImporter = ({ clientId }: CsvImporterProps) => {
    const { importCampaignsFromCsv } = usePerformanceStore();
    const [open, setOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsProcessing(true);

        try {
            const text = await file.text();
            const campaigns = parseCsv(text);

            if (campaigns.length === 0) {
                toast.error("Nenhuma campanha válida encontrada no CSV.");
                return;
            }

            importCampaignsFromCsv(clientId, campaigns);
            toast.success(`${campaigns.length} campanhas importadas com sucesso!`);
            setOpen(false);
        } catch (error) {
            console.error(error);
            toast.error("Erro ao processar arquivo CSV.");
        } finally {
            setIsProcessing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // BASIC PARSER FOR META ADS CSV EXPORT
    // Expects columns like: Campaign Name, Ad Set Name, Ad Name, Delivery Status, Amount Spent, etc.
    // This is a simplified parser logic.
    const parseCsv = (csvText: string): TrafficCampaign[] => {
        const lines = csvText.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

        // Map header indices
        const idxCampaign = headers.findIndex(h => h.includes('campaign name') || h.includes('campanha'));
        const idxAdName = headers.findIndex(h => h.includes('ad name') || h.includes('nome do anúncio'));
        const idxStatus = headers.findIndex(h => h.includes('delivery status') || h.includes('status') || h.includes('veiculação'));
        const idxSpent = headers.findIndex(h => h.includes('amount spent') || h.includes('valor usado'));
        const idxImpressions = headers.findIndex(h => h.includes('impressions') || h.includes('impressões'));
        const idxClicks = headers.findIndex(h => h.includes('link clicks') || h.includes('cliques no link'));
        const idxCtr = headers.findIndex(h => h.includes('ctr'));
        const idxCpc = headers.findIndex(h => h.includes('cpc'));
        const idxRoas = headers.findIndex(h => h.includes('roas') || h.includes('retorno'));

        // Group by Campaign Name
        const campaignsMap = new Map<string, TrafficCampaign>();

        // Start from line 1
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            const cols = line.split(',').map(c => c.trim().replace(/"/g, ''));

            const campaignName = cols[idxCampaign] || 'Campanha Importada';
            const adName = cols[idxAdName] || `Anúncio ${i}`;
            const statusRaw = (cols[idxStatus] || 'active').toLowerCase();
            const status = statusRaw.includes('active') || statusRaw.includes('ativo') ? 'active' : 'paused';

            const spent = parseFloat(cols[idxSpent] || '0');
            const impressions = parseFloat(cols[idxImpressions] || '0'); // Although impressions are int, parse float just in case
            const clicks = parseFloat(cols[idxClicks] || '0');
            const ctr = parseFloat(cols[idxCtr] || '0');
            const cpc = parseFloat(cols[idxCpc] || '0');
            const roas = parseFloat(cols[idxRoas] || '0');

            if (!campaignsMap.has(campaignName)) {
                campaignsMap.set(campaignName, {
                    id: crypto.randomUUID(),
                    name: campaignName,
                    status: 'active', // Assume active if imported recently
                    budget: 1000, // Default budget since CSV usually doesn't show daily budget per row easily
                    spent: 0,
                    ads: []
                });
            }

            const campaign = campaignsMap.get(campaignName)!;
            campaign.spent += spent;

            campaign.ads.push({
                id: crypto.randomUUID(),
                name: adName,
                status,
                metrics: {
                    ctr,
                    cpc,
                    roas,
                    leads: 0, // CSV usually needs specific custom column for leads
                    costPerLead: 0
                }
            });
        }

        return Array.from(campaignsMap.values());
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="secondary" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar CSV
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Importar Relatório de Anúncios</DialogTitle>
                    <DialogDescription>
                        Faça upload do arquivo .csv exportado do Gerenciador de Anúncios.
                        Certifique-se que o arquivo contém as colunas: Campaign Name, Ad Name, Amount Spent, CTR, CPC, ROAS.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 mt-4 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}>

                    {isProcessing ? (
                        <Loader2 className="h-10 w-10 text-purple-500 animate-spin mb-4" />
                    ) : (
                        <FileSpreadsheet className="h-10 w-10 text-muted-foreground mb-4" />
                    )}

                    <p className="text-sm text-muted-foreground font-medium">
                        {isProcessing ? "Processando..." : "Clique para selecionar o arquivo"}
                    </p>
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={handleFileChange}
                    />
                </div>

                <div className="mt-4 bg-yellow-500/10 p-3 rounded-md flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">
                        Nota: Esta importação é para visualização rápida. Os dados serão salvos apenas na sessão atual do navegador para demonstração.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
};
