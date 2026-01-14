import { memo } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Lead } from '../../types/crm';
import { useCRMStore } from '@/store/useCRMStore';
import { Phone, Building2, Calendar, GripVertical, CheckSquare, Edit2, Trash2, MapPin, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface LeadCardProps {
    lead: Lead;
    index: number;
    onEdit: (lead: Lead) => void;
    onDelete: (id: string) => void;
}

export const LeadCard = memo(({ lead, index, onEdit, onDelete }: LeadCardProps) => {
    const { tasks } = useCRMStore();
    const incompleteTasksCount = tasks.filter(t => t.leadId === lead.id && !t.completed).length;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    };

    const sourceTypeColors = {
        'indicação': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        'prospecção_ativa': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        'comercial': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        'anuncio': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    };

    const sourceLabel: Record<string, string> = {
        'indicação': 'Indicação',
        'prospecção_ativa': 'Prospecção',
        'comercial': 'Comercial',
        'anuncio': 'Anúncio'
    };

    return (
        <Draggable draggableId={lead.id} index={index}>
            {(provided, snapshot) => (
                <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={provided.draggableProps.style}
                    className={`
            group relative p-4 mb-3 rounded-xl border transition-all duration-200
            ${snapshot.isDragging
                            ? 'bg-[#1a1a24]/90 border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.2)] z-50 scale-105'
                            : 'bg-[#1a1a24]/40 border-white/5 hover:border-purple-500/30 hover:bg-[#1a1a24]/80 hover:shadow-lg hover:shadow-purple-900/10'}
          `}
                >
                    {/* Hover Gradient Effect */}
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/0 via-purple-500/0 to-purple-500/0 group-hover:via-purple-500/5 pointer-events-none transition-all duration-500" />

                    {/* Header: Name & Value */}
                    <div className="flex justify-between items-start mb-3 relative z-10">
                        <div className="flex-1 min-w-0 mr-2">
                            <h4 className="text-sm font-semibold text-slate-200 truncate group-hover:text-purple-200 transition-colors">{lead.name}</h4>
                            {lead.company && (
                                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                                    <Building2 className="w-3 h-3 text-slate-600" />
                                    <span className="truncate">{lead.company}</span>
                                </div>
                            )}
                        </div>
                        <span className={`text-sm font-bold whitespace-nowrap ${lead.value > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {lead.value > 0 ? formatCurrency(lead.value) : '-'}
                        </span>
                    </div>

                    {/* Details Badges */}
                    <div className="flex flex-wrap gap-2 mb-3 relative z-10">
                        <Badge variant="outline" className={`text-[10px] h-5 px-2 border ${sourceTypeColors[lead.source] || 'bg-slate-800 text-slate-400'}`}>
                            {sourceLabel[lead.source] || lead.source}
                        </Badge>

                        {lead.niche && (
                            <Badge variant="outline" className="text-[10px] h-5 px-2 bg-white/5 text-slate-400 border-white/10">
                                <Tag className="w-2.5 h-2.5 mr-1 text-slate-500" /> {lead.niche}
                            </Badge>
                        )}
                        {lead.tags?.map((tag, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] h-5 px-2 bg-indigo-500/10 text-indigo-300 border-indigo-500/20">
                                #{tag}
                            </Badge>
                        ))}
                    </div>

                    {/* Footer Info */}
                    <div className="space-y-1.5 relative z-10 border-t border-white/5 pt-2 mt-2">
                        {lead.city && (
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <MapPin className="w-3 h-3 shrink-0 opacity-50" />
                                <span className="truncate">{lead.city}</span>
                            </div>
                        )}
                        {lead.phone && (
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Phone className="w-3 h-3 shrink-0 opacity-50" />
                                <span>{lead.phone}</span>
                            </div>
                        )}

                        <div className="flex items-center gap-2 mt-2">
                            {incompleteTasksCount > 0 && (
                                <div className="flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20" title={`${incompleteTasksCount} tarefas pendentes`}>
                                    <CheckSquare className="w-3 h-3" />
                                    <span>{incompleteTasksCount}</span>
                                </div>
                            )}
                            <div className="text-[10px] text-zinc-500 flex items-center gap-1 ml-auto">
                                <Calendar className="w-3 h-3" />
                                {new Date(lead.createdAt).toLocaleDateString('pt-BR')}
                            </div>
                        </div>
                    </div>

                    {/* Actions (Hidden by default, visible on hover) */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0 z-20">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 bg-[#1a1a24] border border-white/10 text-slate-400 hover:text-white hover:border-purple-500/50 shadow-sm"
                            onClick={(e) => { e.stopPropagation(); onEdit(lead); }}
                        >
                            <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 bg-[#1a1a24] border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/50 shadow-sm"
                            onClick={(e) => { e.stopPropagation(); onDelete(lead.id); }}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>
            )}
        </Draggable>
    );
});

LeadCard.displayName = 'LeadCard';
