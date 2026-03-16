import { useState, useRef } from 'react';
import { usePerformanceStore } from '../../store/usePerformanceStore';
import { PerformanceCampaign } from '../../types/performance';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Upload, FileSpreadsheet, AlertCircle, Loader2, Clipboard } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface PerformanceImporterProps {
    clientId: string;
}

export const PerformanceImporter = ({ clientId }: PerformanceImporterProps) => {
    const { addReport, selectMonth: setStoreMonth } = usePerformanceStore();
    const [open, setOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pastedData, setPastedData] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
    const [importMode, setImportMode] = useState<'sum' | 'replace'>('replace');
    const [platform, setPlatform] = useState<'meta' | 'google'>('meta');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Mapeamentos Google Ads
    const GOOGLE_COLUMN_MAPPINGS: Record<string, string[]> = {
        name: ['Campaign', 'Campaign name', 'Nome da campanha', 'Campanha'],
        spend: ['Cost', 'Spend', 'Custo', 'Gasto'],
        impressions: ['Impr.', 'Impressions', 'Impressões'],
        reach: ['Reach'],
        frequency: ['Frequency'],
        clicks: ['Clicks', 'Cliques'],
        ctr: ['CTR', 'Click-through rate (CTR)'],
        cpc: ['Avg. CPC', 'CPC', 'Custo por clique méd.'],
        cpm: ['Avg. CPM', 'CPM'],
        results: ['Conversions', 'Conv.', 'Conversões', 'All conversions'],
        costPerResult: ['Cost / conv.', 'Cost per conversion', 'Custo / conv.'],
        resultType: ['Conversion action', 'Tipo de conversão'],
        status: ['Campaign status', 'Status', 'Estado'],
        date: ['Day', 'Day of week', 'Date'],
        dateEnd: [],
    };

    const COLUMN_MAPPINGS: Record<string, string[]> = {
        name: ['Nome da campanha', 'Campaign Name', 'Campanha', 'Nome'],
        spend: ['Valor usado (BRL)', 'Valor gasto', 'Amount Spent', 'Gasto', 'Valor usado', 'Spent', 'Usa'],
        impressions: ['Impressões', 'Impressions', 'Impr', 'Exibições', 'Exibicao'],
        reach: ['Alcance', 'Reach', 'Alca'],
        frequency: ['Frequência', 'Frequency', 'Freq'],
        clicks: ['Cliques no link (todos)', 'Cliques únicos no link', 'Cliques no link', 'Link Clicks', 'Unique Link Clicks', 'Cliques', 'Clicks', 'Clic'],
        ctr: ['CTR (taxa de cliques no link)', 'CTR (todos)', 'CTR', 'Link Click-Through Rate', 'Unique CTR', 'Taxa de cliques'],
        cpc: ['CPC (custo por clique no link)', 'CPC (todos)', 'CPC', 'Cost Per Link Click', 'Custo por clique'],
        cpm: ['CPM (custo por 1.000 impressões)', 'CPM', 'Cost Per 1,000 Impressions'],
        results: ['Resultados', 'Results', 'Result', 'Resultado', 'Resu', 'Total de resultados'],
        costPerResult: ['Custo por resultado', 'Cost Per Result', 'Custo/resultado', 'Custo por', 'Custo/re'],
        resultType: ['Tipo de resultado', 'Result Type', 'Tipo de re', 'Tipo', 'Result'],
        status: ['Status de veiculação', 'Veiculação', 'Delivery', 'Status', 'Estado'],
        date: ['Início dos relatórios', 'Reporting Starts', 'Data de início'],
        dateEnd: ['Término dos relatórios', 'Reporting Ends', 'Data de término']
    };

    const getColumnMappings = () => platform === 'google' ? GOOGLE_COLUMN_MAPPINGS : COLUMN_MAPPINGS;

    const findColumnIndex = (headers: any[], keys: string[]) => {
        if (!headers || !Array.isArray(headers) || !keys) return -1;
        const normalizedHeaders = headers.map(h => h ? String(h).trim().toLowerCase() : '');
        const effectiveMappings = getColumnMappings();

        const exactIdx = normalizedHeaders.findIndex(h =>
            keys.some(key => key && key.toLowerCase() === h)
        );
        if (exactIdx !== -1) return exactIdx;

        return normalizedHeaders.findIndex(h => {
            if (!h || h.includes(';') || h.split(',').length > 3) return false;
            return keys.some(key => {
                const normalizedKey = (key || '').toLowerCase();
                return h.includes(normalizedKey) || normalizedKey.includes(h);
            });
        });
    };

    const parseNum = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        let s = String(val).trim();
        // Remover percentual e moeda
        s = s.replace(/[^\d,.-]/g, '');
        if (!s || s === '-' || s === '--') return 0;

        const hasComma = s.includes(',');
        const hasDot = s.includes('.');

        if (hasComma && hasDot) {
            if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
                // Formato europeu: 1.234,56 → remove pontos, troca vírgula por ponto
                s = s.replace(/\./g, '').replace(',', '.');
            } else {
                // Formato americano: 1,234.56 → remove vírgulas
                s = s.replace(/,/g, '');
            }
        } else if (hasComma) {
            if (s.lastIndexOf(',') >= s.length - 3) s = s.replace(',', '.');
            else s = s.replace(',', '');
        } else if (hasDot) {
            // Google Ads exporta 120.00 (decimal) e 1.000 (milhar BR)
            // Só trata como milhar se tiver EXATAMENTE 3 dígitos depois E houver dígitos antes
            const parts = s.split('.');
            const lastPart = parts[parts.length - 1];
            if (lastPart.length === 3 && parts.length > 1 && parts[0].length > 0) {
                s = s.replace(/\./g, '');
            }
        }

        return parseFloat(s) || 0;
    };

    // Parser específico para Google Ads: formato americano padrão (vírgula=milhar, ponto=decimal)
    const parseNumGoogle = (val: any): number => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        let s = String(val).trim();
        // Remover símbolos de moeda, % e espaços
        s = s.replace(/[^\d,.-]/g, '');
        if (!s || s === '-' || s === '--') return 0;
        // Vírgula é sempre separador de milhar no formato americano
        s = s.replace(/,/g, '');
        return parseFloat(s) || 0;
    };

    const processData = async (jsonData: any[][], sourceName: string) => {
        if (!jsonData || jsonData.length < 1) {
            throw new Error("O arquivo parece estar vazio.");
        }

        const autoSplit = (originalData: any[][]) => {
            const candidates = [';', '\t', ','];
            let bestSplit = originalData;
            let maxCols = 0;
            for (const r of originalData) {
                if (r && r.length > maxCols) maxCols = r.length;
            }

            for (const sep of candidates) {
                const testSplit = originalData.map(row => {
                    if (row && row.length === 1 && typeof row[0] === 'string' && row[0].includes(sep)) {
                        return row[0].split(sep).map(c => c.trim());
                    }
                    return row;
                });
                const sample = testSplit.slice(0, 10).filter(r => r && r.length > 0);
                if (sample.length === 0) continue;
                const avgCols = sample.reduce((acc, row) => acc + (row ? row.length : 0), 0) / sample.length;
                if (avgCols > maxCols) {
                    maxCols = avgCols;
                    bestSplit = testSplit;
                }
            }
            return bestSplit;
        };

        jsonData = autoSplit(jsonData);

        const activeMappings = getColumnMappings();
        const getIdx = (headerRow: any[], key: string) => findColumnIndex(headerRow, activeMappings[key]);

        let headerRowIndex = -1;
        let maxScore = -1;

        for (let i = 0; i < Math.min(jsonData.length, 30); i++) {
            const row = jsonData[i];
            if (!row || !Array.isArray(row)) continue;
            let score = 0;
            if (findColumnIndex(row, activeMappings.name) !== -1) score += 2;
            if (findColumnIndex(row, activeMappings.spend) !== -1) score++;
            if (findColumnIndex(row, activeMappings.results) !== -1) score++;
            if (score > maxScore) {
                maxScore = score;
                headerRowIndex = i;
            }
            if (score >= 4) break;
        }

        if (headerRowIndex === -1 && jsonData.length > 0) headerRowIndex = 0;
        const headers = jsonData[headerRowIndex] || [];

        // === DEBUG - abrir DevTools (F12) para ver ===
        console.group(`[Importer Debug] Plataforma: ${platform}`);
        console.log('Headers detectados:', headers);
        console.log('Linha do header (index):', headerRowIndex);

        let idxName = getIdx(headers, 'name');
        let idxSpend = getIdx(headers, 'spend');
        let idxResults = getIdx(headers, 'results');
        let idxImpressions = getIdx(headers, 'impressions');
        let idxClicks = getIdx(headers, 'clicks');
        let idxStatus = getIdx(headers, 'status');
        let idxDateStart = getIdx(headers, 'date');
        let idxDateEnd = getIdx(headers, 'dateEnd');

        // --- Mapeamento Estatístico Automático (Caso nomes falhem) ---
        if (jsonData.length > headerRowIndex + 1) {
            const sampleRows = jsonData.slice(headerRowIndex + 1, headerRowIndex + 10).filter(r => r && r.length > 0);
            if (sampleRows.length > 0) {
                const numCols = (sampleRows[0] || []).length;
                const colStats = Array.from({ length: numCols }, (_, colIdx) => {
                    let sum = 0;
                    let count = 0;
                    let isText = 0;
                    sampleRows.forEach(r => {
                        const val = r[colIdx];
                        if (val === undefined || val === null) return;
                        const s = String(val).trim();
                        if (!s) return;
                        const n = parseNum(val);
                        if (isNaN(Number(s.replace(/[^\d.,]/g, '')))) isText++;
                        else {
                            sum += n;
                            count++;
                        }
                    });
                    return { colIdx, avg: count > 0 ? sum / count : 0, isTextRatio: isText / sampleRows.length };
                });

                if (idxName === -1) {
                    const textCol = colStats.find(s => s.isTextRatio > 0.8 && s.avg === 0);
                    if (textCol) idxName = textCol.colIdx;
                }

                if (idxSpend === -1) {
                    // Gasto costuma ter decimais e valores significativos
                    const spendCol = colStats.find(s => s.colIdx !== idxName && s.avg > 0);
                    if (spendCol) idxSpend = spendCol.colIdx;
                }

                // Se Cliques e Impressões não foram achados por nome, usamos magnitude
                if (idxImpressions === -1 || idxClicks === -1) {
                    const numericCols = colStats
                        .filter(s => s.colIdx !== idxName && s.colIdx !== idxSpend && s.avg > 0)
                        .sort((a, b) => b.avg - a.avg); // Ordem decrescente

                    if (numericCols.length >= 1 && idxImpressions === -1) idxImpressions = numericCols[0].colIdx;
                    if (numericCols.length >= 2 && idxClicks === -1) idxClicks = numericCols[1].colIdx;
                }
            }
        }

        if (idxName === -1 || idxSpend === -1) {
            const platformLabel = platform === 'google' ? 'Google Ads' : 'Meta Ads';
            throw new Error(`Não encontramos as colunas de Campanha ou Custo no relatório de ${platformLabel}. Verifique se o arquivo está correto.`);
        }

        const idxReach = getIdx(headers, 'reach');
        const idxFreq = getIdx(headers, 'frequency');
        const idxCtr = getIdx(headers, 'ctr');
        const idxCpc = getIdx(headers, 'cpc');
        const idxCpm = getIdx(headers, 'cpm');
        const idxCpr = getIdx(headers, 'costPerResult');
        const idxResultType = getIdx(headers, 'resultType');

        const parseFn = platform === 'google' ? parseNumGoogle : parseNum;

        // Log de colunas detectadas
        console.log('Mapeamento de colunas:', {
            name: idxName, spend: idxSpend, results: idxResults,
            impressions: idxImpressions, clicks: idxClicks,
            ctr: idxCtr, cpc: idxCpc, cpm: idxCpm, costPerResult: idxCpr
        });
        const firstDataRow = jsonData[headerRowIndex + 1];
        if (firstDataRow) {
            console.log('Primeira linha de dados (raw):', firstDataRow);
            console.log('Nome:', firstDataRow[idxName]);
            console.log('Custo (raw):', firstDataRow[idxSpend], '→ parsed:', parseFn(firstDataRow[idxSpend]));
            console.log('Conversões (raw):', firstDataRow[idxResults], '→ parsed:', parseFn(firstDataRow[idxResults]));
        }
        console.groupEnd();

        const campaigns: PerformanceCampaign[] = [];
        let totalSpendSum = 0;
        let totalResultsSum = 0;
        let sumCtrVal = 0;
        let sumCpcVal = 0;

        let reportStartDate = '';
        let reportEndDate = '';

        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || !Array.isArray(row) || row.length <= Math.max(idxName, idxSpend)) continue;

            const nameValue = String(row[idxName] || '').trim();
            if (!nameValue || nameValue.toLowerCase() === 'null' || nameValue.toLowerCase().includes('total') || nameValue.toLowerCase().includes('resumo')) continue;
            if (headers.some(h => h && String(h).trim() === nameValue)) continue;

            const spend = parseFn(row[idxSpend]);
            const results = parseFn(row[idxResults]);
            const clicks = parseFn(row[idxClicks]);
            const impressions = parseFn(row[idxImpressions]);
            const status = idxStatus !== -1 ? String(row[idxStatus] || '').trim() : undefined;

            if (!reportStartDate && idxDateStart !== -1) reportStartDate = String(row[idxDateStart] || '');
            if (!reportEndDate && idxDateEnd !== -1) reportEndDate = String(row[idxDateEnd] || '');

            let ctr = parseFn(row[idxCtr]);
            let cpc = parseFn(row[idxCpc]);

            // Forçar cálculo se estiver zerado
            if (ctr === 0 && impressions > 0 && clicks > 0) ctr = (clicks / impressions) * 100;
            if (cpc === 0 && clicks > 0 && spend > 0) cpc = spend / clicks;

            campaigns.push({
                id: crypto.randomUUID(),
                name: nameValue,
                spend,
                impressions,
                reach: parseFn(row[idxReach]),
                frequency: parseFn(row[idxFreq]),
                clicks,
                ctr,
                cpc,
                cpm: parseFn(row[idxCpm]),
                results,
                costPerResult: parseFn(row[idxCpr]) || (results > 0 ? spend / results : 0),
                status,
                resultType: String(row[idxResultType] || (platform === 'google' ? 'Conversão' : 'Resultados')).replace(/\s*[\(\[].*?[\)\]]/g, '').trim(),
            });

            totalSpendSum += spend;
            totalResultsSum += results;
            sumCtrVal += ctr;
            sumCpcVal += cpc;
        }

        if (campaigns.length === 0) {
            throw new Error("Colunas mapeadas, mas nenhum dado foi extraído.");
        }

        await addReport({
            clientId,
            month: selectedMonth,
            fileName: sourceName,
            source: platform,
            campaigns,
            totalSpend: totalSpendSum,
            totalResults: totalResultsSum,
            avgCtr: campaigns.length > 0 ? sumCtrVal / campaigns.length : 0,
            avgCpc: campaigns.length > 0 ? sumCpcVal / campaigns.length : 0,
            startDate: reportStartDate,
            endDate: reportEndDate
        }, importMode);

        setStoreMonth(selectedMonth);
        toast.success("Dados importados com sucesso!");
        setOpen(false);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsProcessing(true);
        setError(null);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as any[][];
            await processData(jsonData, file.name);
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Erro no arquivo.");
            toast.error("Falha na importação.");
        } finally {
            setIsProcessing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handlePasteSubmit = async () => {
        if (!pastedData.trim()) return;
        setIsProcessing(true);
        setError(null);
        try {
            const rows = pastedData.trim().split('\n').map(line =>
                line.split(/\t| {2,}/).map(cell => (cell || '').trim())
            );
            await processData(rows, 'Dados Colados');
            setPastedData('');
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Erro nos dados.");
            toast.error("Falha na importação.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="gap-2 bg-purple-600 hover:bg-purple-700">
                    <Upload className="h-4 w-4" />
                    Importar Dados Meta
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Importar Relatório Meta Ads</DialogTitle>
                    <DialogDescription>
                        Escolha o mês de referência e o método de importação.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="flex items-center gap-3 bg-muted/30 p-3 rounded-lg border border-purple-500/20">
                        <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Mês de Referência:</span>
                        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                            <SelectTrigger className="w-full bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: 12 }, (_, i) => {
                                    const date = new Date();
                                    date.setMonth(date.getMonth() - i);
                                    const val = date.toISOString().substring(0, 7);
                                    return (
                                        <SelectItem key={val} value={val}>
                                            {date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Seletor de Plataforma */}
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Plataforma de Anúncios</Label>
                        <RadioGroup value={platform} onValueChange={(v) => setPlatform(v as 'meta' | 'google')} className="grid grid-cols-2 gap-2">
                            <div
                                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer select-none transition-all ${platform === 'meta' ? 'bg-purple-500/10 border-purple-500/40 text-purple-500' : 'border-border hover:bg-accent/50'}`}
                                onClick={() => setPlatform('meta')}
                            >
                                <RadioGroupItem value="meta" id="plat-meta" />
                                <Label htmlFor="plat-meta" className="cursor-pointer font-medium">Meta Ads</Label>
                            </div>
                            <div
                                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer select-none transition-all ${platform === 'google' ? 'bg-blue-500/10 border-blue-500/40 text-blue-500' : 'border-border hover:bg-accent/50'}`}
                                onClick={() => setPlatform('google')}
                            >
                                <RadioGroupItem value="google" id="plat-google" />
                                <Label htmlFor="plat-google" className="cursor-pointer font-medium">Google Ads</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className="space-y-3 p-4 bg-muted/10 border rounded-lg">
                        <Label className="text-sm font-medium">Como importar os dados destas campanhas?</Label>
                        <RadioGroup value={importMode} onValueChange={(val) => setImportMode(val as 'sum' | 'replace')} className="flex flex-col space-y-1">
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="replace" id="replace" className="text-purple-600" />
                                <Label htmlFor="replace" className="font-normal cursor-pointer">Substituir o Mês Atual (Limpa as antigas)</Label>
                            </div>
                            <div className="flex items-center space-x-2 mt-1">
                                <RadioGroupItem value="sum" id="sum" className="text-purple-600" />
                                <Label htmlFor="sum" className="font-normal cursor-pointer">Somar com o Mês Atual (Mescla dados)</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <Tabs defaultValue="file" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-muted/50">
                            <TabsTrigger value="file" className="gap-2">
                                <FileSpreadsheet className="h-4 w-4" />
                                Arquivo Excel/CSV
                            </TabsTrigger>
                            <TabsTrigger value="paste" className="gap-2">
                                <Clipboard className="h-4 w-4" />
                                Copiar e Colar
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="file" className="mt-4">
                            <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer hover:bg-accent/50 border-purple-500/30" onClick={() => fileInputRef.current?.click()}>
                                {isProcessing ? <Loader2 className="h-12 w-12 text-purple-500 animate-spin mb-4" /> : <FileSpreadsheet className="h-12 w-12 text-purple-500 mb-4" />}
                                <p className="text-center font-medium">{isProcessing ? "Processando..." : "Selecione ou arraste o arquivo"}</p>
                                <p className="text-xs text-muted-foreground mt-2">.xlsx ou .csv exportado do Meta</p>
                                <input type="file" accept=".csv, .xlsx, .xls" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                            </div>
                        </TabsContent>

                        <TabsContent value="paste" className="mt-4 space-y-4">
                            <Textarea placeholder="Cole aqui os dados copiados..." className="min-h-[200px] font-mono text-xs" value={pastedData} onChange={(e) => setPastedData(e.target.value)} />
                            <Button className="w-full bg-purple-600 hover:bg-purple-700" disabled={!pastedData.trim() || isProcessing} onClick={handlePasteSubmit}>
                                {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Processar e Importar
                            </Button>
                        </TabsContent>
                    </Tabs>

                    {error && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex gap-3 items-start">
                            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                            <p className="text-xs text-destructive font-medium leading-relaxed">{error}</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
