import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadActivityFeed } from './LeadActivityFeed';
import { WhatsAppSenderDialog } from './WhatsAppSenderDialog';
import { CRMTasks } from './CRMTasks';
import { Lead, LeadStatus, LeadSource } from '@/types/crm';
import { useCRMStore } from '@/store/useCRMStore';
import { MessageCircle, Save, Calendar, Building2, User2, MapPin, Tag, CheckSquare } from 'lucide-react';
import { format } from 'date-fns';

interface LeadDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    lead: Lead;
}

export function LeadDetailsModal({ isOpen, onClose, lead }: LeadDetailsModalProps) {
    const { updateLead, addActivity } = useCRMStore();
    const [editedLead, setEditedLead] = useState<Lead>(lead);
    const [hasChanges, setHasChanges] = useState(false);

    // Sync local state when lead changes or modal opens
    useEffect(() => {
        setEditedLead(lead);
        setHasChanges(false);
    }, [lead, isOpen]);

    const handleChange = (field: keyof Lead, value: any) => {
        setEditedLead(prev => ({ ...prev, [field]: value }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        await updateLead(lead.id, editedLead);
        setHasChanges(false);
        // Optional: Close on save or keep open? Keep open is better for flow.
        // onClose(); 
    };

    const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);

    const handleWhatsAppClick = () => {
        setIsWhatsAppOpen(true);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 bg-black/95 border-zinc-800 gap-0">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-start bg-zinc-900/30">
                    <div className="flex flex-col gap-1">
                        <DialogTitle className="text-2xl font-bold flex items-center gap-3">
                            {lead.name}
                            <Badge variant="outline" className="text-sm font-normal uppercase tracking-wider text-zinc-400 border-zinc-700">
                                {lead.status}
                            </Badge>
                        </DialogTitle>
                        <div className="flex items-center gap-4 text-sm text-zinc-400">
                            {lead.company && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {lead.company}</span>}
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Criado em {format(new Date(lead.createdAt), 'dd/MM/yyyy')}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            onClick={handleWhatsAppClick}
                            disabled={!lead.phone}
                            title={!lead.phone ? "Adicione um telefone para usar o WhatsApp" : "Abrir conversa no WhatsApp"}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <MessageCircle className="w-4 h-4" />
                            WhatsApp
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={!hasChanges}
                            variant="secondary"
                            className="gap-2"
                        >
                            <Save className="w-4 h-4" />
                            Salvar
                        </Button>
                    </div>
                </div>

                {/* Content */}
                <Tabs defaultValue="timeline" className="flex-1 flex flex-col min-h-0">
                    <div className="px-6 pt-2 border-b border-white/5 bg-zinc-900/10">
                        <TabsList className="bg-transparent p-0 h-auto gap-6">
                            <TabsTrigger
                                value="details"
                                className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent px-0 pb-3 pt-2 font-medium text-zinc-400 data-[state=active]:text-purple-400"
                            >
                                Detalhes e Dados
                            </TabsTrigger>
                            <TabsTrigger
                                value="timeline"
                                className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent px-0 pb-3 pt-2 font-medium text-zinc-400 data-[state=active]:text-purple-400"
                            >
                                Timeline & Atividades
                            </TabsTrigger>
                            <TabsTrigger
                                value="tasks"
                                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent px-0 pb-3 pt-2 font-medium text-zinc-400 data-[state=active]:text-emerald-500 flex items-center gap-2"
                            >
                                <CheckSquare className="w-4 h-4" />
                                Tarefas & Follow-up
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="details" className="h-full overflow-y-auto p-6 m-0 focus-visible:ring-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nome do Contato</Label>
                                    <div className="relative">
                                        <User2 className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            id="name"
                                            value={editedLead.name}
                                            onChange={(e) => handleChange('name', e.target.value)}
                                            className="pl-9 bg-zinc-950/50 border-white/10"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="company">Empresa</Label>
                                    <div className="relative">
                                        <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            id="company"
                                            value={editedLead.company || ''}
                                            onChange={(e) => handleChange('company', e.target.value)}
                                            className="pl-9 bg-zinc-950/50 border-white/10"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone">WhatsApp / Telefone</Label>
                                    <Input
                                        id="phone"
                                        value={editedLead.phone || ''}
                                        onChange={(e) => handleChange('phone', e.target.value)}
                                        className="bg-zinc-950/50 border-white/10"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="value">Valor Estimado (R$)</Label>
                                    <Input
                                        id="value"
                                        type="number"
                                        value={editedLead.value}
                                        onChange={(e) => handleChange('value', parseFloat(e.target.value) || 0)}
                                        className="bg-zinc-950/50 border-white/10"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="city">Cidade</Label>
                                    <div className="relative">
                                        <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            id="city"
                                            value={editedLead.city || ''}
                                            onChange={(e) => handleChange('city', e.target.value)}
                                            className="pl-9 bg-zinc-950/50 border-white/10"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="niche">Nicho / Área</Label>
                                    <div className="relative">
                                        <Tag className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            id="niche"
                                            value={editedLead.niche || ''}
                                            onChange={(e) => handleChange('niche', e.target.value)}
                                            className="pl-9 bg-zinc-950/50 border-white/10"
                                        />
                                    </div>
                                </div>
                            </div>

                        </div>

                        <div className="md:col-span-2 space-y-2">
                            <Label htmlFor="description">Observações Iniciais</Label>
                            <Textarea
                                id="description"
                                value={editedLead.description || ''}
                                onChange={(e) => handleChange('description', e.target.value)}
                                className="bg-zinc-950/50 border-white/10 min-h-[100px]"
                            />
                        </div>

                        <div className="md:col-span-2 space-y-2 pt-4 border-t border-white/5">
                            <Label>Etiquetas (Tags)</Label>
                            <div className="flex gap-2 mb-2">
                                <div className="relative flex-1">
                                    <Tag className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                    <Input
                                        placeholder="Digite uma tag e aperte Enter..."
                                        className="pl-9 bg-zinc-950/50 border-white/10"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const val = e.currentTarget.value.trim();
                                                if (val) {
                                                    const currentTags = editedLead.tags || [];
                                                    if (!currentTags.includes(val)) {
                                                        const newTags = [...currentTags, val];
                                                        handleChange('tags', newTags);
                                                        // Also update store immediately if desirable, but we rely on Save button for batch update.
                                                        // Actually, for better UX tags usually are instant. But here we are in "Edit Mode".
                                                        // Wait, the store has `addTag` action which is instant. 
                                                        // But here we are editing `editedLead` local state.
                                                        // Let's keep it in local state until "Save".
                                                    }
                                                    e.currentTarget.value = '';
                                                }
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {editedLead.tags?.map((tag, idx) => (
                                    <Badge key={idx} variant="outline" className="h-6 px-2 bg-indigo-500/10 text-indigo-300 border-indigo-500/20 gap-1 pr-1">
                                        #{tag}
                                        <button
                                            onClick={() => {
                                                const newTags = editedLead.tags?.filter(t => t !== tag);
                                                handleChange('tags', newTags);
                                            }}
                                            className="hover:bg-indigo-500/20 rounded-full p-0.5"
                                        >
                                            <span className="sr-only">Remover</span>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-x"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                            <p className="text-[10px] text-zinc-500">Pressione Enter para adicionar.</p>
                        </div>
                    </TabsContent>

                    <TabsContent value="timeline" className="h-full overflow-hidden m-0 p-6">
                        <LeadActivityFeed leadId={lead.id} />
                    </TabsContent>

                    <TabsContent value="tasks" className="h-full overflow-hidden m-0 p-6">
                        <CRMTasks leadId={lead.id} />
                    </TabsContent>
                </Tabs>
            </DialogContent >

            <WhatsAppSenderDialog
                isOpen={isWhatsAppOpen}
                onClose={() => setIsWhatsAppOpen(false)}
                lead={lead}
            />
        </Dialog >
    );
}
