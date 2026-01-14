import { Lead, LeadStatus } from '@/types/crm';
import { STATUS_TRANSLATIONS } from '@/constants/crm';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Building2, Phone, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FunnelViewProps {
    leads: Lead[];
    onEditLead: (lead: Lead) => void;
}

const columns: { id: LeadStatus; title: string; color: string }[] = [
    { id: 'prospect', title: 'Prospecção', color: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
    { id: 'contact', title: 'Contato', color: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' },
    { id: 'proposal', title: 'Proposta Enviada', color: 'bg-purple-500/10 border-purple-500/20 text-purple-400' },
    { id: 'negotiation', title: 'Negociação', color: 'bg-orange-500/10 border-orange-500/20 text-orange-400' },
    { id: 'closed', title: 'Fechado', color: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' },
    { id: 'lost', title: 'Perdidos', color: 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400' },
];

export function FunnelView({ leads, onEditLead }: FunnelViewProps) {
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="h-full overflow-y-auto pr-2 space-y-6 pb-20">
            {columns.map((col) => {
                const stageLeads = leads.filter(l => l.status === col.id);
                const totalValue = stageLeads.reduce((acc, curr) => acc + curr.value, 0);

                if (stageLeads.length === 0) return null;

                return (
                    <div key={col.id} className="space-y-3">
                        {/* Stage Header */}
                        <div className={`p-4 rounded-xl border ${col.color} flex items-center justify-between`}>
                            <div className="flex items-center gap-3">
                                <h3 className="font-semibold text-sm uppercase tracking-wider">{col.title}</h3>
                                <Badge variant="secondary" className="bg-black/20 text-inherit border-none">
                                    {stageLeads.length}
                                </Badge>
                            </div>
                            <div className="font-mono font-medium text-sm text-inherit opacity-80">
                                {formatCurrency(totalValue)}
                            </div>
                        </div>

                        {/* List of Leads */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pl-4 border-l-2 border-white/5 ml-4">
                            {stageLeads.map((lead) => (
                                <Card
                                    key={lead.id}
                                    onClick={() => onEditLead(lead)}
                                    className="p-3 bg-zinc-900/40 border-white/5 hover:bg-zinc-900/60 hover:border-white/10 transition-all cursor-pointer group relative overflow-hidden"
                                >
                                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                                                <User className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
                                                    {lead.name}
                                                </h4>
                                                {lead.company && (
                                                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                                                        <Building2 className="w-3 h-3" />
                                                        <span className="truncate">{lead.company}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="font-bold text-sm text-emerald-500/90 whitespace-nowrap">
                                            {formatCurrency(lead.value)}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 text-[10px] text-zinc-600 mt-2 border-t border-white/5 pt-2">
                                        {lead.phone && (
                                            <div className="flex items-center gap-1">
                                                <Phone className="w-3 h-3" />
                                                <span>{lead.phone}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1 ml-auto">
                                            <Calendar className="w-3 h-3" />
                                            <span>{new Date(lead.createdAt).toLocaleDateString('pt-BR')}</span>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
