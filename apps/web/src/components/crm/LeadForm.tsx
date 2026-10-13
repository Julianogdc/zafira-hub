import React, { useEffect, useState } from 'react';
import { Lead, LeadSource, LeadStatus } from '../../types/crm';
import { useCRMStore } from '../../store/useCRMStore';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, User, Phone, MapPin, Tag, DollarSign, LayoutList, CalendarDays, History, ArrowRight } from 'lucide-react';

const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
        prospect: 'Prospecção',
        contact: 'Contato',
        proposal: 'Proposta',
        negotiation: 'Negociação',
        closed: 'Fechado',
        lost: 'Perdidos'
    };
    return labels[status] || status;
};

interface LeadFormProps {
    isOpen: boolean;
    onClose: () => void;
    editingLead: Lead | null;
    initialStatus?: LeadStatus;
}

export function LeadForm({ isOpen, onClose, editingLead, initialStatus }: LeadFormProps) {
    const { addLead, updateLead } = useCRMStore();

    const [formData, setFormData] = useState({
        name: '',
        company: '',
        value: '',
        phone: '',
        city: '',
        niche: '',
        description: '',
        source: 'prospecção_ativa' as LeadSource,
        status: 'prospecção' as LeadStatus,
        createdAt: ''
    });

    useEffect(() => {
        if (editingLead) {
            // Correct timezone for input
            const date = new Date(editingLead.createdAt);
            const offset = date.getTimezoneOffset();
            const localDate = new Date(date.getTime() - (offset * 60 * 1000));
            const formattedDate = localDate.toISOString().slice(0, 16);

            setFormData({
                name: editingLead.name,
                company: editingLead.company || '',
                value: editingLead.value.toString(),
                phone: editingLead.phone || '',
                city: editingLead.city || '',
                niche: editingLead.niche || '',
                description: editingLead.description || '',
                source: editingLead.source,
                status: editingLead.status,
                createdAt: formattedDate
            });
        } else {
            // Current time local
            const now = new Date();
            const offset = now.getTimezoneOffset();
            const localNow = new Date(now.getTime() - (offset * 60 * 1000));

            setFormData({
                name: '',
                company: '',
                value: '',
                phone: '',
                city: '',
                niche: '',
                description: '',
                source: 'prospecção_ativa', // Padrão
                status: initialStatus || 'prospect',
                createdAt: localNow.toISOString().slice(0, 16)
            });
        }
    }, [editingLead, isOpen, initialStatus]);

    const handleSubmit = () => {
        if (!formData.name) return;

        const numericValue = parseFloat(formData.value.replace(/[^\d.,]/g, '').replace(',', '.'));
        const cleanData = {
            ...formData,
            value: isNaN(numericValue) ? 0 : numericValue
        };

        // Validate types for source and status if needed (TS mostly handles this via state type)

        if (editingLead) {
            updateLead(editingLead.id, cleanData);
        } else {
            addLead(cleanData);
        }

        onClose();
    };

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent className="bg-zinc-950 border-l border-white/10 text-white sm:max-w-xl overflow-y-auto">
                <SheetHeader className="mb-6">
                    <SheetTitle className="text-xl text-white">
                        {editingLead ? 'Editar Lead' : 'Novo Lead'}
                    </SheetTitle>
                    <SheetDescription className="text-zinc-500">
                        Preencha os detalhes da oportunidade.
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6">
                    {/* Dados Principais */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2 col-span-2 sm:col-span-1">
                            <Label className="text-zinc-400 flex items-center gap-2"><User className="w-3 h-3" /> Nome do Contato</Label>
                            <Input value={formData.name} onChange={e => handleChange('name', e.target.value)} className="bg-zinc-900/50 border-white/10" />
                        </div>
                        <div className="space-y-2 col-span-2 sm:col-span-1">
                            <Label className="text-zinc-400 flex items-center gap-2"><Building2 className="w-3 h-3" /> Empresa</Label>
                            <Input value={formData.company} onChange={e => handleChange('company', e.target.value)} className="bg-zinc-900/50 border-white/10" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-zinc-400 flex items-center gap-2"><Phone className="w-3 h-3" /> WhatsApp / Telefone</Label>
                            <Input value={formData.phone} onChange={e => handleChange('phone', e.target.value)} className="bg-zinc-900/50 border-white/10" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-zinc-400 flex items-center gap-2"><MapPin className="w-3 h-3" /> Cidade</Label>
                            <Input value={formData.city} onChange={e => handleChange('city', e.target.value)} className="bg-zinc-900/50 border-white/10" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-zinc-400 flex items-center gap-2"><DollarSign className="w-3 h-3" /> Valor Estimado (R$)</Label>
                            <Input type="number" value={formData.value} onChange={e => handleChange('value', e.target.value)} className="bg-zinc-900/50 border-white/10" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-zinc-400 flex items-center gap-2"><Tag className="w-3 h-3" /> Nicho / Especialidade</Label>
                            <Input value={formData.niche} onChange={e => handleChange('niche', e.target.value)} className="bg-zinc-900/50 border-white/10" />
                        </div>
                    </div>

                    {/* Origem e Status */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-900/30 rounded-lg border border-white/5">
                        <div className="space-y-2">
                            <Label className="text-zinc-400">Origem</Label>
                            <Select value={formData.source} onValueChange={v => handleChange('source', v)}>
                                <SelectTrigger className="bg-zinc-800 border-white/10"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="indicação">Indicação</SelectItem>
                                    <SelectItem value="prospecção_ativa">Prospecção Ativa</SelectItem>
                                    <SelectItem value="comercial">Time Comercial</SelectItem>
                                    <SelectItem value="anuncio">Anúncio (Ads)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-zinc-400">Fase do Funil</Label>
                            <Select value={formData.status} onValueChange={v => handleChange('status', v)}>
                                <SelectTrigger className="bg-zinc-800 border-white/10"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="prospect">Prospecção</SelectItem>
                                    <SelectItem value="contact">Contato</SelectItem>
                                    <SelectItem value="proposal">Proposta Enviada</SelectItem>
                                    <SelectItem value="negotiation">Negociação</SelectItem>
                                    <SelectItem value="closed">Fechado</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Descrição */}
                    <div className="space-y-2">
                        <Label className="text-zinc-400 flex items-center gap-2"><LayoutList className="w-3 h-3" /> Detalhes & Links</Label>
                        <Textarea
                            value={formData.description}
                            onChange={e => handleChange('description', e.target.value)}
                            className="bg-zinc-900/50 border-white/10 min-h-[120px]"
                            placeholder="Cole links, anotações sobre a reunião, necessidades do cliente..."
                        />
                    </div>

                    {/* Date of Creation (Editable) */}
                    <div className="space-y-2">
                        <Label className="text-zinc-400 flex items-center gap-2"><CalendarDays className="w-3 h-3" /> Data de Cadastro (Registro)</Label>
                        <Input
                            type="datetime-local"
                            value={formData.createdAt}
                            onChange={e => handleChange('createdAt', e.target.value)}
                            className="bg-zinc-900/50 border-white/10 w-full sm:w-1/2"
                        />
                    </div>

                    {/* History Timeline */}
                    {editingLead && editingLead.history && editingLead.history.length > 0 && (
                        <div className="space-y-3 pt-4 border-t border-white/10">
                            <Label className="text-zinc-400 flex items-center gap-2"><History className="w-3 h-3" /> Histórico de Movimentações</Label>
                            <div className="space-y-3 px-2">
                                {editingLead.history.slice().reverse().map((item) => (
                                    <div key={item.id} className="flex flex-col sm:flex-row sm:items-center text-xs text-zinc-500 gap-1 sm:gap-3 bg-zinc-900/30 p-2 rounded border border-white/5">
                                        <span className="font-mono text-zinc-400 shrink-0">
                                            {new Date(item.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-zinc-300">{getStatusLabel(item.fromStatus)}</span>
                                            <ArrowRight className="w-3 h-3 text-zinc-600" />
                                            <span className="font-medium text-emerald-500">{getStatusLabel(item.toStatus)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="pt-6 flex gap-3">
                        <Button variant="outline" className="w-full border-white/10 hover:bg-zinc-900" onClick={onClose}>
                            Cancelar
                        </Button>
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSubmit}>
                            {editingLead ? 'Salvar Alterações' : 'Criar Lead'}
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
