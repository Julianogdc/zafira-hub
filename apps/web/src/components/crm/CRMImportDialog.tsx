import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, X, FileSpreadsheet, Check } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCRMStore } from '@/store/useCRMStore';
import { LeadSource } from '@/types/crm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export function CRMImportDialog() {
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<any[]>([]);
    const [defaultSource, setDefaultSource] = useState<LeadSource>('anuncio');
    const [isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { addLead } = useCRMStore();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            parseCSV(selectedFile);
        }
    };

    const parseCSV = (file: File) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: 'greedy',
            delimiter: "",
            complete: (results) => {
                const data = results.data as any[];
                if (!data || data.length === 0) return;

                // Smart Key Mapping for Preview
                const keys = Object.keys(data[0]);

                const findKey = (candidates: string[], exclude: string[] = []) =>
                    keys.find(key => {
                        const k = key.toLowerCase().trim();
                        if (exclude.some(bad => k.includes(bad))) return false;
                        return candidates.some(good => k === good || k.includes(good));
                    });

                const nameKey = findKey(['full_name', 'nome_completo', 'nome', 'name', 'cliente', 'p1'], ['campaign', 'campanha', 'ad_', 'adset', 'form', 'id']);
                const companyKey = findKey(['company_name', 'empresa', 'company']);

                // Create Normalized Preview
                const normalizedPreview = data.slice(0, 5).map(row => ({
                    name: nameKey ? row[nameKey] : 'Sem Nome',
                    company: companyKey ? row[companyKey] : ''
                }));

                setPreview(normalizedPreview);
            },
            error: (error) => {
                toast.error("Erro ao ler arquivo CSV: " + error.message);
            }
        });
    };

    const handleImport = async () => {
        if (!file) return;
        setIsImporting(true);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: 'greedy',
            delimiter: "", // Auto-detect
            complete: (results) => {
                const data = results.data as any[];
                let importedCount = 0;

                if (data.length === 0) {
                    toast.error("O arquivo parece estar vazio.");
                    setIsImporting(false);
                    return;
                }

                // Detect Keys dynamically
                const keys = Object.keys(data[0]);

                const findKey = (candidates: string[], exclude: string[] = []) =>
                    keys.find(key => {
                        const k = key.toLowerCase().trim();
                        if (exclude.some(bad => k.includes(bad))) return false;
                        return candidates.some(good => k === good || k.includes(good));
                    });

                // 1. Core Fields Mapping (Priority to Meta format)
                // Added exclusions to prevent 'campaign_name' from matching 'name'
                const nameKey = findKey(['full_name', 'nome_completo', 'nome', 'name', 'cliente', 'p1'], ['campaign', 'campanha', 'ad_', 'adset', 'form', 'id']);
                const phoneKey = findKey(['phone_number', 'telefone', 'celular', 'phone', 'whatsapp']);
                const emailKey = findKey(['email', 'e-mail']);
                const platformKey = findKey(['platform', 'plataforma', 'origem']);
                const cityKey = findKey(['city', 'cidade', 'municipio']);
                const companyKey = findKey(['company_name', 'empresa', 'company']);

                // 2. Identify "Custom Questions" (e.g., "Qual veículo?", "Ano do carro")
                // We exclude technical Meta columns to keep it clean
                const ignoredKeys = [
                    'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name',
                    'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic',
                    'lead_status', 'raw_data'
                ];

                const customKeys = keys.filter(k =>
                    !ignoredKeys.includes(k) &&
                    k !== nameKey &&
                    k !== phoneKey &&
                    k !== emailKey &&
                    k !== platformKey &&
                    k !== cityKey &&
                    k !== companyKey
                );

                data.forEach((row) => {
                    const name = nameKey ? row[nameKey] : 'Sem Nome';

                    // Skip empty rows (common in CSV exports)
                    if ((!name || name === 'Sem Nome') && !Object.values(row).some(v => v)) return;

                    const phone = phoneKey ? row[phoneKey] : '';
                    const company = companyKey ? row[companyKey] : '';
                    const city = cityKey ? row[cityKey] : '';
                    const platform = platformKey ? row[platformKey] : '';
                    const email = emailKey ? row[emailKey] : '';

                    // Build Rich Description from Custom Questions
                    let descLines = [];
                    if (platform) descLines.push(`Plataforma: ${platform}`);
                    if (email) descLines.push(`Email: ${email}`);

                    customKeys.forEach(k => {
                        if (row[k]) {
                            // Format Key: "qual_veiculo_..." -> "Qual veiculo..."
                            const label = k.replace(/_/g, ' ').replace(/\?/g, '');
                            descLines.push(`${label}: ${row[k]}`);
                        }
                    });

                    const description = descLines.length > 0
                        ? descLines.join('\n')
                        : `Importado em ${new Date().toLocaleDateString()}`;

                    // Add to store
                    addLead({
                        name,
                        company,
                        phone,
                        city,
                        value: 0, // Meta leads usually don't have deal value yet
                        source: defaultSource,
                        status: 'prospect',
                        niche: '', // Meta generic export doesn't have niche usually, unless in custom Qs
                        description: description
                    });
                    importedCount++;
                });

                toast.success(`${importedCount} leads importados com sucesso!`);
                setIsImporting(false);
                setOpen(false);
                setFile(null);
                setPreview([]);
            }
        });
    };

    const handleClearFile = () => {
        setFile(null);
        setPreview([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar CSV
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Importar Leads</DialogTitle>
                    <DialogDescription>
                        Importe seus leads de um arquivo CSV (Facebook Ads, Planilhas, etc).
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Origem padrão para estes leads</Label>
                        <Select value={defaultSource} onValueChange={(v) => setDefaultSource(v as LeadSource)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione a origem" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="indicação">Indicação</SelectItem>
                                <SelectItem value="prospecção_ativa">Prospecção Ativa</SelectItem>
                                <SelectItem value="comercial">Comercial</SelectItem>
                                <SelectItem value="anuncio">Anúncio (Ads)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2 hover:bg-muted/50 transition-colors bg-muted/20 relative">
                        {!file ? (
                            <>
                                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                                <div className="text-sm font-medium">
                                    Arraste seu arquivo ou clique para selecionar
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Suporta arquivos .CSV
                                </p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={handleFileChange}
                                />
                            </>
                        ) : (
                            <div className="flex items-center gap-4 w-full px-4">
                                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                                    <FileSpreadsheet className="h-5 w-5 text-green-500" />
                                </div>
                                <div className="flex-1 text-left overflow-hidden">
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {(file.size / 1024).toFixed(1)} KB
                                    </p>
                                </div>
                                <Button variant="ghost" size="icon" onClick={handleClearFile}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>

                    {preview.length > 0 && (
                        <div className="rounded-md border bg-muted/30 p-3">
                            <p className="text-xs font-medium mb-2 text-muted-foreground">Pré-visualização (Primeiros 5):</p>
                            <div className="space-y-1">
                                {preview.map((row, i) => (
                                    <div key={i} className="text-xs flex gap-2 overflow-hidden text-nowrap text-ellipsis opacity-80">
                                        <span className="font-bold w-4">{i + 1}.</span>
                                        <span>{row.name}</span>
                                        <span className="opacity-50">- {row.company}</span>
                                    </div>
                                ))}
                                {preview.length >= 5 && <p className="text-xs pt-1 text-center opacity-50">...</p>}
                            </div>
                        </div>
                    )}

                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button onClick={handleImport} disabled={!file || isImporting} className="gap-2">
                        {isImporting ? 'Importando...' : (
                            <>
                                <Check className="h-4 w-4" /> Importar Leads
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
