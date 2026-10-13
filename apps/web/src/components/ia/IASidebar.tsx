import { History, ChevronRight, ChevronLeft, Trash2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AISession } from "@/types/ai"; // Assuming Session type exists, otherwise might need defining or importing from store

interface IASidebarProps {
    sessions: AISession[];
    currentSessionId: string | null;
    isOpen: boolean;
    onToggle: () => void;
    onLoadSession: (id: string) => void;
    onDeleteSession: (id: string) => void;
}

// Internal Component: Session Item
const SessionItem = ({ id, title, date, active, onClick, onDelete }: any) => (
    <div
        onClick={onClick}
        className={cn(
            "group relative p-3 rounded-lg border mb-2 cursor-pointer transition-all",
            active
                ? "bg-purple-500/20 border-purple-500/50"
                : "bg-black/20 border-white/5 hover:bg-white/5 hover:border-white/10"
        )}
    >
        <div className="flex items-center gap-2 mb-1">
            <MessageSquare className={cn("w-3 h-3", active ? "text-purple-400" : "text-slate-500")} />
            <span className={cn("text-xs font-medium truncate w-[160px]", active ? "text-purple-100" : "text-slate-300")}>
                {title || "Nova Conversa"}
            </span>
        </div>
        <div className="flex justify-between items-center pl-5">
            <span className="text-[9px] text-slate-600 font-mono">
                {date ? new Date(date).toLocaleDateString() : 'Hoje'} • {date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
        </div>

        {/* Botão de Deletar */}
        <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute right-2 top-3 opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all"
            title="Apagar conversa"
        >
            <Trash2 className="w-3 h-3" />
        </button>
    </div>
);

export function IASidebar({
    sessions,
    currentSessionId,
    isOpen,
    onToggle,
    onLoadSession,
    onDeleteSession
}: IASidebarProps) {
    return (
        <div className={cn(
            "hidden lg:flex flex-col rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm transition-all duration-300 ease-in-out overflow-hidden",
            isOpen ? "w-72 opacity-100" : "w-12 opacity-80"
        )}>

            <div className={cn(
                "flex items-center p-3 border-b border-white/5 h-14",
                isOpen ? "justify-between" : "justify-center"
            )}>
                {isOpen && (
                    <div className="flex items-center gap-2 text-slate-400 fade-in">
                        <History className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Histórico</span>
                    </div>
                )}
                <button
                    onClick={onToggle}
                    className="p-1.5 rounded hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                >
                    {isOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
            </div>

            {isOpen && (
                <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-white/10 animate-in fade-in slide-in-from-right-4 duration-300">
                    {sessions.length === 0 ? (
                        <p className="text-[10px] text-slate-600 text-center py-10 italic">Nenhuma conversa salva.</p>
                    ) : (
                        sessions.map((session) => (
                            <SessionItem
                                key={session.id}
                                {...session}
                                date={session.updatedAt}
                                active={session.id === currentSessionId}
                                onClick={() => onLoadSession(session.id)}
                                onDelete={() => onDeleteSession(session.id)}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
