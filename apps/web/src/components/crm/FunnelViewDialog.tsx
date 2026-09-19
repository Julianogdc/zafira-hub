import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Filter, ChevronRight, CheckCircle2, User } from 'lucide-react';
import { SalesFunnelChart } from '@/components/dashboard/charts/SalesFunnelChart';
import { Lead } from '@/types/crm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

interface FunnelViewDialogProps {
    leads: Lead[];
}

export function FunnelViewDialog({ leads }: FunnelViewDialogProps) {
    const [open, setOpen] = useState(false);

    // Group leads by status
    const leadsByStatus = {
        prospect: leads.filter(l => l.status === 'prospect'),
        contact: leads.filter(l => l.status === 'contact'),
        proposal: leads.filter(l => l.status === 'proposal'),
        negotiation: leads.filter(l => l.status === 'negotiation'),
        closed: leads.filter(l => l.status === 'closed'),
    };

    const statusLabels: Record<string, string> = {
        prospect: 'Novos',
        contact: 'Contatados',
        proposal: 'Proposta',
        negotiation: 'Negociação',
        closed: 'Fechado'
    };

    const statusColors: Record<string, string> = {
        prospect: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        contact: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        proposal: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        negotiation: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
        closed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 h-7 text-xs px-3 bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300">
                    <Filter className="h-3 w-3" />
                    Funil
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col bg-zinc-950 border-zinc-800 p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-2 border-b border-white/5">
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        <Filter className="w-5 h-5 text-purple-400" />
                        Funil de Vendas Confirmado
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* CHART SECTION */}
                    <div className="p-4 rounded-xl bg-zinc-900/30 border border-white/5">
                        <SalesFunnelChart leads={leads} />
                    </div>

                    {/* DETAILS SECTION */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Detalhamento por Etapa</h3>

                        <Accordion type="single" collapsible className="space-y-2">
                            {Object.entries(leadsByStatus).map(([status, stageLeads]) => {
                                if (stageLeads.length === 0) return null;
                                const isWin = status === 'closed';

                                return (
                                    <AccordionItem key={status} value={status} className="border border-white/5 rounded-lg bg-zinc-900/20 px-4">
                                        <AccordionTrigger className="hover:no-underline py-3">
                                            <div className="flex items-center gap-4 w-full">
                                                <Badge variant="outline" className={`${statusColors[status]} border min-w-[100px] justify-center`}>
                                                    {statusLabels[status]}
                                                </Badge>
                                                <span className="text-sm text-zinc-400">
                                                    {stageLeads.length} leads
                                                </span>
                                                <div className="flex-1 border-b border-dashed border-white/5 mx-4" />
                                                <span className="text-sm font-medium text-zinc-300 mr-2">
                                                    {formatCurrency(stageLeads.reduce((acc, l) => acc + l.value, 0))}
                                                </span>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="pb-4 pt-1">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-2">
                                                {stageLeads.map(lead => (
                                                    <div key={lead.id} className="flex items-center justify-between p-2 rounded bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                                                <User className="w-4 h-4 text-zinc-500" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-zinc-200 truncate">{lead.name}</p>
                                                                <p className="text-xs text-zinc-500 truncate">{lead.company || 'Sem empresa'}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className={`text-sm font-bold ${isWin ? 'text-emerald-400' : 'text-zinc-300'}`}>
                                                                {formatCurrency(lead.value)}
                                                            </p>
                                                            <p className="text-[10px] text-zinc-600">
                                                                {new Date(lead.createdAt).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                );
                            })}
                        </Accordion>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
