import { useState } from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { useCRMStore } from '../../store/useCRMStore';
import { useClientStore } from '@/store/useClientStore';
import { toast } from 'sonner';
import { LeadCard } from './LeadCard';
import { LeadStatus, Lead } from '../../types/crm';
import { ChevronRight, ChevronLeft, Archive } from 'lucide-react';

interface KanbanBoardProps {
    leads: Lead[];
    onEditLead: (lead: any) => void;
}

import { LostReasonDialog } from './LostReasonDialog';

// ...

export const KanbanBoard = ({ leads, onEditLead }: KanbanBoardProps) => {
    const { moveLead, deleteLead } = useCRMStore();
    const [isLostCollapsed, setIsLostCollapsed] = useState(true);

    // Lost Reason State
    const [isLostReasonOpen, setIsLostReasonOpen] = useState(false);
    const [pendingLoss, setPendingLoss] = useState<{ id: string, destination: LeadStatus } | null>(null);

    const columns: { id: LeadStatus; title: string; color: string }[] = [
        { id: 'prospect', title: 'Prospecção', color: 'border-l-4 border-l-blue-500' },
        { id: 'contact', title: 'Contato', color: 'border-l-4 border-l-yellow-500' },
        { id: 'proposal', title: 'Proposta Enviada', color: 'border-l-4 border-l-purple-500' },
        { id: 'negotiation', title: 'Negociação', color: 'border-l-4 border-l-orange-500' },
        { id: 'closed', title: 'Fechado', color: 'border-l-4 border-l-emerald-500' },
        { id: 'lost', title: 'Perdidos / Retomada', color: 'border-l-4 border-l-zinc-500' },
    ];

    const onDragEnd = (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        // Intercept LOST move
        if (destination.droppableId === 'lost') {
            setPendingLoss({ id: draggableId, destination: 'lost' });
            setIsLostReasonOpen(true);
            return;
        }

        moveLead(draggableId, destination.droppableId as LeadStatus);

        // Automacao: Criar Cliente quando Lead vai para Fechado
        if (destination.droppableId === 'closed' && source.droppableId !== 'closed') {
            // ... (existing logic)
            const lead = leads.find(l => l.id === draggableId);
            if (lead) {
                useClientStore.getState().addClient({
                    name: lead.name,
                    status: 'active',
                    contractValue: lead.value,
                    notes: `Lead importado do CRM.\nEmpresa: ${lead.company || 'N/A'}\nTelefone: ${lead.phone || 'N/A'}\nOrigem: ${lead.source}\n\n${lead.description || ''}`,
                });

                toast.success("Cliente criado!", {
                    description: `${lead.name} foi adicionado aos Clientes Ativos.`
                });
            }
        }
    };

    const confirmLoss = (reason: string) => {
        if (pendingLoss) {
            moveLead(pendingLoss.id, pendingLoss.destination, reason);
            setPendingLoss(null);
            setIsLostReasonOpen(false);
        }
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-transparent">
            {/* Scroll Container for the board - Horizontal scroll hidden unless absolutely necessary */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                <DragDropContext onDragEnd={onDragEnd}>
                    {/* 
                        Layout Logic:
                        - default: Flex row with gap.
                        - min-w-[200px] per column allows 6 columns to fit in ~1250px (Standard Laptop).
                        - flex-1 makes them share available space evenly on larger screens.
                    */}
                    <div className="flex h-full gap-3 px-4 pb-2 min-w-max xl:min-w-0 xl:w-full">
                        {columns.map((col) => {
                            const columnLeads = leads.filter(l => l.status === col.id);
                            const totalValue = columnLeads.reduce((acc, curr) => acc + curr.value, 0);
                            const isLost = col.id === 'lost';

                            // Logic for collapsed Lost column
                            if (isLost && isLostCollapsed) {
                                return (
                                    <Droppable key={col.id} droppableId={col.id}>
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.droppableProps}
                                                onClick={() => setIsLostCollapsed(false)}
                                                className={`flex-shrink-0 w-10 flex flex-col items-center h-full rounded-xl bg-zinc-950/20 border border-white/5 cursor-pointer hover:bg-zinc-900/40 transition-all ${snapshot.isDraggingOver ? 'bg-zinc-800/50 ring-2 ring-zinc-500' : ''}`}
                                            >
                                                <div className="h-full flex flex-col items-center py-4 gap-4">
                                                    <Archive className="w-4 h-4 text-zinc-600" />
                                                    <div className="flex-1 flex items-center justify-center">
                                                        <span className="text-zinc-600 text-xs font-medium whitespace-nowrap -rotate-90 tracking-wider">
                                                            RETOMADA
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-zinc-600 bg-white/5 px-1.5 py-0.5 rounded">
                                                        {columnLeads.length}
                                                    </span>
                                                </div>
                                                <div className="hidden">{provided.placeholder}</div>
                                            </div>
                                        )}
                                    </Droppable>
                                );
                            }

                            return (
                                <div key={col.id} className="flex-1 min-w-[220px] max-w-[400px] flex flex-col h-full rounded-xl bg-zinc-950/20 border border-white/5 relative group transition-all duration-300">
                                    {/* Column Header */}
                                    <div className={`p-3 border-b border-white/5 bg-zinc-900/20 rounded-t-xl ${col.color} flex justify-between items-center shrink-0`}>
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <h3 className="font-medium text-xs text-zinc-200 truncate uppercase tracking-wider" title={col.title}>{col.title}</h3>
                                            <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-white/5 shrink-0">{columnLeads.length}</span>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-[10px] font-mono text-zinc-500">
                                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(totalValue)}
                                            </span>
                                            {isLost && (
                                                <button onClick={() => setIsLostCollapsed(true)} className="p-1 hover:bg-white/10 rounded text-zinc-400"><ChevronRight className="w-3.5 h-3.5" /></button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Droppable Area with HIDDEN SCROLLBAR by default (Premium Polish) */}
                                    <Droppable droppableId={col.id}>
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.droppableProps}
                                                className={`
                                                    flex-1 p-2 overflow-y-auto 
                                                    scrollbar-thin scrollbar-thumb-transparent hover:scrollbar-thumb-white/10 scrollbar-track-transparent 
                                                    transition-colors
                                                    ${snapshot.isDraggingOver ? 'bg-zinc-900/30' : ''}
                                                `}
                                            >
                                                {columnLeads.map((lead, index) => (
                                                    <LeadCard key={lead.id} lead={lead} index={index} onEdit={onEditLead} onDelete={deleteLead} />
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </div>
                            );
                        })}
                    </div>
                </DragDropContext>
            </div>

            <LostReasonDialog
                isOpen={isLostReasonOpen}
                onClose={() => { setIsLostReasonOpen(false); setPendingLoss(null); }}
                onConfirm={confirmLoss}
            />
        </div>
    );
};
