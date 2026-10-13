import { useState, useMemo, useEffect } from 'react';
import { useCRMStore } from '@/store/useCRMStore';
import { useAuthStore } from '@/store/useAuthStore';
import { KanbanBoard } from '@/components/crm/KanbanBoard';
import { LeadForm } from '@/components/crm/LeadForm';
import { CRMFilters } from '@/components/crm/CRMFilters';
import { CRMImportDialog } from "@/components/crm/CRMImportDialog";
import { FunnelViewDialog } from "@/components/crm/FunnelViewDialog";

import { Lead } from '@/types/crm';
import { Button } from '@/components/ui/button';
import { Plus, Users, Target, CheckCircle2, DollarSign, TrendingUp } from 'lucide-react';
import { SalesMotivationWidget } from '@/components/crm/SalesMotivationWidget';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export default function CRM() {
    const { leads: allLeads, fetchLeads, initialized } = useCRMStore();

    useEffect(() => {
        if (!initialized) {
            fetchLeads();
        }
    }, [initialized, fetchLeads]);

    const { user } = useAuthStore();

    // Filter leads: Show owned leads OR legacy leads (no owner)
    const leads = allLeads.filter(l => !l.ownerId || l.ownerId === user?.id);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<Lead | null>(null);

    // Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [sourceFilter, setSourceFilter] = useState('all');
    const [dateFilter, setDateFilter] = useState('all');

    // Filtering Logic
    const filteredLeads = useMemo(() => {
        return leads.filter(lead => {
            // 1. Search (Name, Company, City, Niche)
            const matchesSearch = searchTerm === '' ||
                [lead.name, lead.company, lead.city, lead.niche].some(field =>
                    field?.toLowerCase().includes(searchTerm.toLowerCase())
                );

            // 2. Source
            const matchesSource = sourceFilter === 'all' || lead.source === sourceFilter;

            // 3. Date
            let matchesDate = true;
            if (dateFilter === '30days') {
                const date = new Date(lead.createdAt);
                const diffTime = Math.abs(new Date().getTime() - date.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                matchesDate = diffDays <= 30;
            } else if (dateFilter === 'thisMonth') {
                const date = new Date(lead.createdAt);
                const now = new Date();
                matchesDate = date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
            }

            return matchesSearch && matchesSource && matchesDate;
        });
    }, [leads, searchTerm, sourceFilter, dateFilter]);

    // KPIs Calculations (Based on Filtered Data)
    const totalLeads = filteredLeads.length;

    const last30Days = filteredLeads.filter(l => {
        const date = new Date(l.createdAt);
        const diffTime = Math.abs(new Date().getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= 30;
    }).length;

    const closedLeads = filteredLeads.filter(l => l.status === 'closed').length;

    const conversionRate = totalLeads > 0
        ? ((closedLeads / totalLeads) * 100).toFixed(1)
        : '0.0';

    const totalSold = filteredLeads
        .filter(l => l.status === 'closed')
        .reduce((acc, curr) => acc + curr.value, 0);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);


    const handleEdit = (lead: Lead) => {
        setEditingLead(lead);
        setIsFormOpen(true);
    };

    const handleNew = () => {
        setEditingLead(null);
        setIsFormOpen(true);
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-2 animate-in fade-in duration-500 overflow-hidden">

            {/* Header & KPIs */}
            <Accordion type="single" collapsible defaultValue="overview" className="border border-white/10 rounded-lg bg-zinc-950/30 overflow-hidden shadow-sm">
                <AccordionItem value="overview" className="border-none">
                    <div className="flex items-center px-4 py-2 border-b border-transparent data-[state=open]:border-white/5 bg-zinc-900/40 hover:bg-zinc-900/60 transition-colors">
                        <AccordionTrigger className="flex-1 py-0 hover:no-underline [&[data-state=open]>div>svg]:rotate-180">
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-emerald-400" />
                                <span className="font-semibold text-xs uppercase tracking-wide text-zinc-200">Performance & Insights</span>
                            </div>
                        </AccordionTrigger>
                        <div className="flex items-center gap-2 ml-4">
                            <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
                                <CRMFilters
                                    searchTerm={searchTerm}
                                    setSearchTerm={setSearchTerm}
                                    sourceFilter={sourceFilter}
                                    setSourceFilter={setSourceFilter}
                                    dateFilter={dateFilter}
                                    setDateFilter={setDateFilter}
                                />
                                <div className="h-4 w-px bg-white/10 mx-2" />
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                                <CRMImportDialog />
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                                <FunnelViewDialog leads={filteredLeads} />
                            </div>
                            <Button onClick={(e) => { e.stopPropagation(); handleNew(); }} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 h-7 text-xs px-3 shadow-sm shadow-emerald-900/20">
                                <Plus className="h-3 w-3" /> Lead
                            </Button>
                        </div>
                    </div>
                    <AccordionContent className="bg-black/20 border-t border-white/5 max-h-[45vh] overflow-y-auto">
                        <div className="p-2 md:p-4 flex flex-col gap-4">
                            {/* Motivation Widget - Full Width Banner */}
                            <div className="w-full hidden sm:block">
                                <SalesMotivationWidget />
                            </div>

                            {/* KPIs Scrollable Row */}
                            <div className="w-full min-w-0">
                                <div className="flex gap-2 md:gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 scrollbar-track-transparent snap-x">

                                    <div className="min-w-[140px] md:min-w-[160px] flex-1 p-3 md:p-4 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur flex flex-col justify-center snap-start">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-zinc-500 text-[10px] md:text-xs font-medium uppercase">Total Leads</span>
                                            <Users className="w-3 h-3 md:w-4 md:h-4 text-zinc-600" />
                                        </div>
                                        <div className="text-xl md:text-2xl font-bold text-white">{totalLeads}</div>
                                    </div>

                                    <div className="min-w-[140px] md:min-w-[160px] flex-1 p-3 md:p-4 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur flex flex-col justify-center snap-start">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-purple-500/80 text-[10px] md:text-xs font-medium uppercase">Novos (30d)</span>
                                            <Target className="w-3 h-3 md:w-4 md:h-4 text-purple-500" />
                                        </div>
                                        <div className="text-xl md:text-2xl font-bold text-white">{last30Days}</div>
                                    </div>

                                    <div className="min-w-[140px] md:min-w-[160px] flex-1 p-3 md:p-4 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur flex flex-col justify-center snap-start">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-emerald-500/80 text-[10px] md:text-xs font-medium uppercase">Fechados</span>
                                            <CheckCircle2 className="w-3 h-3 md:w-4 md:h-4 text-emerald-500" />
                                        </div>
                                        <div className="text-xl md:text-2xl font-bold text-white">{closedLeads}</div>
                                    </div>

                                    <div className="min-w-[140px] md:min-w-[160px] flex-1 p-3 md:p-4 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur flex flex-col justify-center snap-start">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-blue-500/80 text-[10px] md:text-xs font-medium uppercase">Conversão</span>
                                            <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-blue-500" />
                                        </div>
                                        <div className="text-xl md:text-2xl font-bold text-white">{conversionRate}%</div>
                                    </div>

                                    <div className="min-w-[150px] md:min-w-[180px] flex-1 p-3 md:p-4 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur flex flex-col justify-center snap-start">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-emerald-400/80 text-[10px] md:text-xs font-medium uppercase">Total Vendido</span>
                                            <DollarSign className="w-3 h-3 md:w-4 md:h-4 text-emerald-400" />
                                        </div>
                                        <div className="text-lg md:text-xl font-bold text-white truncate" title={formatCurrency(totalSold)}>
                                            {formatCurrency(totalSold)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>


            {/* Kanban Board Container - Fixed height, internal scroll */}
            <div className="flex-1 min-h-0 relative overflow-hidden border-t border-white/5 pt-2">
                <KanbanBoard leads={filteredLeads} onEditLead={handleEdit} />
            </div>

            <LeadForm
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                editingLead={editingLead}
            />
        </div >
    );
}
