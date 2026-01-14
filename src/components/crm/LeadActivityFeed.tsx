import { useEffect, useState } from 'react';
import { useCRMStore } from '@/store/useCRMStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Phone, Mail, Calendar, StickyNote, Send, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadActivityFeedProps {
    leadId: string;
}

export function LeadActivityFeed({ leadId }: LeadActivityFeedProps) {
    const { currentLeadActivities, fetchLeadActivities, addActivity } = useCRMStore();
    const [noteContent, setNoteContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        fetchLeadActivities(leadId);
    }, [leadId, fetchLeadActivities]);

    const handleAddNote = async () => {
        if (!noteContent.trim()) return;
        setIsSubmitting(true);
        try {
            await addActivity(leadId, 'note', noteContent);
            setNoteContent('');
        } finally {
            setIsSubmitting(false);
        }
    };

    const getActivityIcon = (type: string) => {
        switch (type) {
            case 'whatsapp': return <MessageSquare className="w-4 h-4 text-emerald-500" />;
            case 'call': return <Phone className="w-4 h-4 text-blue-500" />;
            case 'email': return <Mail className="w-4 h-4 text-amber-500" />;
            case 'meeting': return <Calendar className="w-4 h-4 text-purple-500" />;
            case 'note': return <StickyNote className="w-4 h-4 text-zinc-400" />;
            default: return <StickyNote className="w-4 h-4 text-zinc-400" />;
        }
    };

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Input Area */}
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-white/10 bg-zinc-950/30">
                <Textarea
                    placeholder="Adicionar uma nota ou observação..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    className="min-h-[80px] bg-transparent border-none resize-none focus-visible:ring-0 p-0 text-zinc-200 placeholder:text-zinc-600"
                />
                <div className="flex justify-between items-center pt-2 border-t border-white/5">
                    <div className="flex gap-2">
                        {/* Future: Filters or Type Selectors could go here */}
                    </div>
                    <Button
                        size="sm"
                        onClick={handleAddNote}
                        disabled={!noteContent.trim() || isSubmitting}
                        className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                    >
                        {isSubmitting ? 'Salvando...' : 'Salvar Nota'}
                        <Send className="w-3 h-3 ml-2" />
                    </Button>
                </div>
            </div>

            {/* Timeline */}
            <ScrollArea className="flex-1 pr-4">
                <div className="space-y-6">
                    {currentLeadActivities.length === 0 ? (
                        <div className="text-center text-zinc-500 py-8 text-sm italic">
                            Nenhuma atividade registrada ainda.
                        </div>
                    ) : (
                        currentLeadActivities.map((activity) => (
                            <div key={activity.id} className="flex gap-3 group relative pl-4 border-l border-white/10 last:border-0 pb-6 last:pb-0">
                                {/* Connector Dot */}
                                <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-zinc-900 border border-zinc-700 group-hover:border-purple-500 transition-colors" />

                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium text-zinc-400">
                                            {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true, locale: ptBR })}
                                        </span>
                                        <div className="flex items-center gap-1 bg-zinc-900/50 px-1.5 py-0.5 rounded text-[10px] uppercase text-zinc-500 font-medium border border-white/5">
                                            {getActivityIcon(activity.type)}
                                            {activity.type}
                                        </div>
                                    </div>
                                    <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                                        {activity.content}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
