import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  HubClient,
  ApiClientStatus,
  CreateClientDTO,
  UpdateClientDTO,
  clientsService,
  statusLabels,
} from '@/services/clients';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
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
import { toast } from 'sonner';

interface ClientFormProps {
  isOpen: boolean;
  onClose: () => void;
  editingClient: HubClient | null;
  onSuccess: () => void;
}

export function ClientForm({ isOpen, onClose, editingClient, onSuccess }: ClientFormProps) {
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<ApiClientStatus>('ACTIVE');
  const [contractValue, setContractValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingClient) {
      setName(editingClient.name || '');
      setLegalName(editingClient.legalName || '');
      setDocument(editingClient.document || '');
      setEmail(editingClient.email || '');
      setPhone(editingClient.phone || '');
      setStatus(editingClient.status || 'ACTIVE');
      setContractValue(editingClient.contractValue ? String(editingClient.contractValue) : '');
      setStartDate(editingClient.startDate ? editingClient.startDate.split('T')[0] : '');
      setEndDate(editingClient.endDate ? editingClient.endDate.split('T')[0] : '');
      setNotes(editingClient.notes || '');
    } else {
      resetForm();
    }
  }, [editingClient, isOpen]);

  const resetForm = () => {
    setName('');
    setLegalName('');
    setDocument('');
    setEmail('');
    setPhone('');
    setStatus('ACTIVE');
    setContractValue('');
    setStartDate('');
    setEndDate('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('O nome do cliente é obrigatório.');
      return;
    }

    try {
      setIsSubmitting(true);
      const parsedValue = contractValue ? parseFloat(contractValue.replace(',', '.')) : undefined;

      if (editingClient) {
        const updatePayload: UpdateClientDTO = {
          name: name.trim(),
          legalName: legalName.trim() || null,
          document: document.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          status,
          contractValue: parsedValue ?? null,
          startDate: startDate || null,
          endDate: endDate || null,
          notes: notes.trim() || null,
        };

        await clientsService.updateClient(editingClient.id, updatePayload);
        toast.success('Cliente atualizado com sucesso!');
      } else {
        const createPayload: CreateClientDTO = {
          name: name.trim(),
          legalName: legalName.trim() || undefined,
          document: document.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          status,
          contractValue: parsedValue,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          notes: notes.trim() || undefined,
        };

        await clientsService.createClient(createPayload);
        toast.success('Cliente cadastrado com sucesso!');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar cliente:', err);
      toast.error(err?.message || 'Erro ao salvar cliente. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-zinc-950 border-l border-white/10 text-white overflow-y-auto w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-white text-xl">
            {editingClient ? 'Editar Cliente' : 'Novo Cliente'}
          </SheetTitle>
          <SheetDescription className="text-zinc-400 text-sm">
            {editingClient
              ? 'Atualize as informações cadastrais e contratuais do cliente.'
              : 'Preencha os dados do cliente para adicioná-lo à base do Hub 2.0.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-6">
          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs text-zinc-300">
              Nome do Cliente / Fantasia <span className="text-red-400">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: ACME Corp"
              className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
              required
            />
          </div>

          {/* Razão Social */}
          <div className="space-y-1.5">
            <Label htmlFor="legalName" className="text-xs text-zinc-300">
              Razão Social
            </Label>
            <Input
              id="legalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Ex: ACME Corporation Ltda"
              className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
            />
          </div>

          {/* CPF / CNPJ */}
          <div className="space-y-1.5">
            <Label htmlFor="document" className="text-xs text-zinc-300">
              CNPJ / CPF
            </Label>
            <Input
              id="document"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              placeholder="00.000.000/0000-00"
              className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label htmlFor="status" className="text-xs text-zinc-300">
              Status
            </Label>
            <Select value={status} onValueChange={(val) => setStatus(val as ApiClientStatus)}>
              <SelectTrigger className="bg-zinc-900 border-white/10 text-white">
                <SelectValue placeholder="Selecione o status" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10 text-white">
                <SelectItem value="ACTIVE">{statusLabels.ACTIVE}</SelectItem>
                <SelectItem value="PAUSED">{statusLabels.PAUSED}</SelectItem>
                <SelectItem value="INACTIVE">{statusLabels.INACTIVE}</SelectItem>
                <SelectItem value="LEAD">{statusLabels.LEAD}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* E-mail e Telefone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-zinc-300">
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@cliente.com"
                className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-xs text-zinc-300">
                Telefone / WhatsApp
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
              />
            </div>
          </div>

          {/* Valor do Contrato */}
          <div className="space-y-1.5">
            <Label htmlFor="contractValue" className="text-xs text-zinc-300">
              Valor do Contrato Mensal (R$)
            </Label>
            <Input
              id="contractValue"
              type="number"
              step="0.01"
              value={contractValue}
              onChange={(e) => setContractValue(e.target.value)}
              placeholder="0.00"
              className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
            />
          </div>

          {/* Datas Início e Fim */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate" className="text-xs text-zinc-300">
                Data de Início
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500 [color-scheme:dark]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate" className="text-xs text-zinc-300">
                Data de Término
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500 [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs text-zinc-300">
              Observações
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalhes ou anotações importantes sobre o cliente..."
              className="bg-zinc-900 border-white/10 text-white focus-visible:ring-emerald-500"
            />
          </div>

          <SheetFooter className="pt-4 flex flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-white/10 text-zinc-300 hover:bg-white/5"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingClient ? 'Salvar Alterações' : 'Criar Cliente'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}