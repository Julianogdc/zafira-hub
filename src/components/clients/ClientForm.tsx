import React, { useEffect, useState } from 'react';
import { Upload, FileText, Download, AlertTriangle, Calendar } from 'lucide-react';
import { Client } from '../../types/client';
import { useClientStore } from '../../store/useClientStore';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ClientFormProps {
  isOpen: boolean;
  onClose: () => void;
  editingClient: Client | null;
}

export function ClientForm({ isOpen, onClose, editingClient }: ClientFormProps) {
  const { clients, addClient, updateClient, addContract } = useClientStore();
  const liveClient = clients.find(c => c.id === editingClient?.id) || editingClient;

  // Form States
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentDay, setPaymentDay] = useState('');

  // Upload States
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string, data: string } | null>(null);

  // Error States
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (editingClient) {
      setName(editingClient.name);
      setStatus(editingClient.status);
      setValue(editingClient.contractValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      setNotes(editingClient.notes);
      setStartDate(editingClient.contractStart || '');
      setEndDate(editingClient.contractEnd || '');
      setPaymentDay(editingClient.paymentDay?.toString() || '');
    } else {
      resetForm();
    }
  }, [editingClient, isOpen]);

  const resetForm = () => {
    setName('');
    setStatus('active');
    setValue('');
    setNotes('');
    setStartDate('');
    setEndDate('');
    setPaymentDay('');
    setPendingFile(null);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setErrorOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      showError("O arquivo é maior que 3MB.");
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const base64String = event.target?.result as string;
        setPendingFile({ name: file.name, data: base64String });
        setIsUploading(false);
      } catch (error) {
        showError("Erro ao processar arquivo.");
        setIsUploading(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!name || !value) {
      showError("Preencha Nome e Valor.");
      return;
    }

    const cleanValue = value.replace(/[^\d,]/g, '').replace(',', '.');
    const numericValue = parseFloat(cleanValue);

    // Validate Payment Day
    const pDay = parseInt(paymentDay);
    if (paymentDay && (isNaN(pDay) || pDay < 1 || pDay > 31)) {
      showError("Dia de pagamento inválido (1-31).");
      return;
    }

    let targetClientId = editingClient?.id;

    try {
      const clientData = {
        name,
        status,
        contractValue: isNaN(numericValue) ? 0 : numericValue,
        notes,
        contractStart: startDate,
        contractEnd: endDate,
        paymentDay: pDay || null
      };

      if (editingClient) {
        await updateClient(editingClient.id, clientData);
      } else {
        targetClientId = await addClient(clientData);
      }

      if (pendingFile && targetClientId) {
        await addContract(targetClientId, pendingFile.name, pendingFile.data);
      }

      onClose();
      resetForm();

    } catch (error: any) {
      console.error(error);
      showError(`Erro ao salvar: ${error.message || JSON.stringify(error)}`);
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent className="bg-zinc-950 border-l border-white/10 text-white sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl text-white">
              {editingClient ? 'Editar Cliente' : 'Novo Cliente'}
            </SheetTitle>
            <SheetDescription className="text-zinc-500">
              Gestão de contrato e vigência.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-zinc-400">Nome da Empresa / Cliente</Label>
              <Input
                placeholder="Ex: Zafira Tech Ltda"
                className="bg-zinc-900/50 border-white/10 focus-visible:ring-emerald-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-400">Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as 'active' | 'inactive')}
                >
                  <SelectTrigger className="bg-zinc-900/50 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    <SelectItem value="active" className="text-emerald-500">Ativo</SelectItem>
                    <SelectItem value="inactive" className="text-zinc-500">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-400">Valor Mensal</Label>
                <Input
                  type="text"
                  placeholder="R$ 0,00"
                  className="bg-zinc-900/50 border-white/10 focus-visible:ring-emerald-500"
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    const p = (Number(v) / 100).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL"
                    });
                    setValue(p);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-400">Dia de Pagamento</Label>
                <Input
                  type="number"
                  placeholder="Ex: 5"
                  min={1}
                  max={31}
                  className="bg-zinc-900/50 border-white/10"
                  value={paymentDay}
                  onChange={(e) => setPaymentDay(e.target.value)}
                />
              </div>
            </div>

            {/* DATAS DE VIGÊNCIA */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-400 flex items-center gap-2">
                  <Calendar className="w-3 h-3" /> Início
                </Label>
                <Input
                  type="date"
                  className="bg-zinc-900/50 border-white/10 text-xs"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-400 flex items-center gap-2">
                  <Calendar className="w-3 h-3" /> Vencimento
                </Label>
                <Input
                  type="date"
                  className="bg-zinc-900/50 border-white/10 text-xs"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Upload de Contrato */}
            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-zinc-400">Arquivo de Contrato</Label>
                <div className="relative">
                  <input
                    type="file"
                    id="contract-upload"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.png,.jpg"
                    onChange={handleFileSelect}
                  />
                  <Label
                    htmlFor="contract-upload"
                    className={`flex items-center gap-2 cursor-pointer text-xs px-3 py-1.5 rounded-md transition-colors
                      ${isUploading
                        ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                        : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}
                    `}
                  >
                    <Upload className="w-3 h-3" />
                    {isUploading ? 'Processando...' : (pendingFile ? 'Arquivo Selecionado' : 'Anexar PDF')}
                  </Label>
                </div>
              </div>

              {pendingFile && (
                <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-3 mb-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs font-medium text-emerald-300 truncate">{pendingFile.name}</p>
                    <p className="text-[10px] text-emerald-500/60">Pronto para salvar</p>
                  </div>
                </div>
              )}

              {liveClient?.contracts && liveClient.contracts.length > 0 && (
                <div className="space-y-2 mt-2">
                  {liveClient.contracts.map((contract) => (
                    <div key={contract.id} className="flex items-center justify-between p-2 rounded bg-zinc-900/50 border border-white/5 group hover:border-white/10">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
                        <span className="text-xs text-zinc-300 truncate max-w-[200px]">
                          {contract.fileName}
                        </span>
                      </div>
                      <a
                        href={contract.fileData}
                        download={contract.fileName}
                        className="text-zinc-400 hover:text-emerald-400"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-400">Observações</Label>
              <Textarea
                className="bg-zinc-900/50 border-white/10 min-h-[100px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="pt-6 flex gap-3">
              <Button variant="outline" className="w-full border-white/10 hover:bg-zinc-900" onClick={onClose}>
                Cancelar
              </Button>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSubmit}>
                {editingClient ? 'Salvar Alterações' : 'Criar Cliente'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={errorOpen} onOpenChange={setErrorOpen}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="text-red-500 w-5 h-5" />
              Erro no Processo
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {errorMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorOpen(false)} className="bg-zinc-800 text-white">
              Ok, entendi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}