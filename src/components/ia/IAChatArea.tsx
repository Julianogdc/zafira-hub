import { useRef, useEffect } from "react";
import { Brain, Send, TrendingUp, DollarSign, Target, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIResponseDisplay } from "@/components/ui/AIResponseDisplay";
import TypingIndicator from "@/components/ui/TypingIndicator";
import { AIMessage, AIAnalysisType } from "@/types/ai";
import { useAuthStore } from "@/store/useAuthStore";

interface IAChatAreaProps {
    messages: AIMessage[];
    isAnalyzing: boolean;
    inputValue: string;
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onSend: () => void;
    onAnalysis: (type: AIAnalysisType) => void;
    inputRef: React.RefObject<HTMLTextAreaElement>;
}

// Internal: Analysis Card
const AnalysisCard = ({ icon: Icon, title, onClick, active }: any) => (
    <button
        onClick={onClick}
        disabled={active}
        className={cn(
            "flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-300 h-24",
            "bg-white/5 hover:bg-white/10 backdrop-blur-sm",
            "border-white/10 hover:border-white/20",
            "text-slate-400 hover:text-white",
            active ? "border-primary/50 bg-primary/10 text-primary opacity-50 cursor-wait" : ""
        )}
    >
        <Icon className="w-5 h-5 mb-2" />
        <span className="text-[10px] font-bold uppercase tracking-wider">{title}</span>
    </button>
);

export function IAChatArea({
    messages,
    isAnalyzing,
    inputValue,
    onInputChange,
    onKeyDown,
    onSend,
    onAnalysis,
    inputRef
}: IAChatAreaProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { user } = useAuthStore();

    // Scroll to bottom
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, isAnalyzing]);

    return (
        <div className="flex-1 flex flex-col gap-4 min-h-0">

            {/* Shortcuts - Only show if empty and not analyzing */}
            {messages.length === 0 && !isAnalyzing && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 animate-in slide-in-from-top-4 fade-in duration-500">
                    <AnalysisCard icon={TrendingUp} title="Visão Geral" onClick={() => onAnalysis('geral')} active={isAnalyzing} />

                    {/* Admin Only Buttons */}
                    {user?.role === 'admin' && (
                        <>
                            <AnalysisCard icon={DollarSign} title="Financeiro" onClick={() => onAnalysis('financas')} active={isAnalyzing} />
                            <AnalysisCard icon={Target} title="Metas" onClick={() => onAnalysis('metas')} active={isAnalyzing} />
                            <AnalysisCard icon={Users} title="Clientes" onClick={() => onAnalysis('clientes')} active={isAnalyzing} />
                        </>
                    )}
                </div>
            )}

            {/* Chat Container */}
            <div className="flex-1 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md flex flex-col min-h-0 relative overflow-hidden shadow-2xl">

                <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    {messages.length === 0 && !isAnalyzing ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                            <Brain className="w-10 h-10 mb-3 animate-pulse" />
                            <p className="text-xs uppercase tracking-widest">Selecione uma análise ou digite abaixo...</p>
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div key={msg.id} className={cn(
                                "flex flex-col max-w-[90%]",
                                msg.role === 'user' ? "self-end items-end" : "self-start items-start"
                            )}>
                                <div className={cn(
                                    "p-3.5 rounded-2xl text-sm leading-relaxed shadow-sm",
                                    msg.role === 'user'
                                        ? "bg-purple-500/10 border border-purple-500/20 text-purple-100 rounded-tr-sm"
                                        : "bg-white/5 border border-white/10 text-slate-200 rounded-tl-sm backdrop-blur-md"
                                )}>
                                    <AIResponseDisplay content={msg.content} role={msg.role} />
                                </div>
                                <span className="text-[9px] text-slate-600 mt-1 px-1 opacity-50">
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        ))
                    )}

                    {/* Typing Indicator */}
                    {isAnalyzing && (
                        <div className="self-start animate-in fade-in slide-in-from-left-2">
                            <div className="p-4 rounded-2xl rounded-tl-sm bg-white/5 border border-white/10 backdrop-blur-md w-fit">
                                <TypingIndicator />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-black/40 border-t border-white/5 shrink-0">
                    <div className="relative flex items-end gap-2 bg-white/5 border border-white/10 rounded-xl p-2 focus-within:border-purple-500/50 focus-within:bg-white/10 transition-all">
                        <textarea
                            ref={inputRef}
                            value={inputValue}
                            onChange={onInputChange}
                            onKeyDown={onKeyDown}
                            placeholder={isAnalyzing ? "O Zafira está pensando..." : "Digite sua mensagem..."}
                            disabled={isAnalyzing}
                            rows={1}
                            className="w-full bg-transparent border-none text-sm text-white placeholder:text-slate-500 focus:outline-none resize-none max-h-32 min-h-[44px] py-3 pl-2 scrollbar-thin scrollbar-thumb-white/20"
                        />

                        <button
                            onClick={onSend}
                            disabled={isAnalyzing || !inputValue.trim()}
                            className={cn(
                                "p-2.5 mb-1 rounded-lg transition-all shadow-lg",
                                isAnalyzing || !inputValue.trim()
                                    ? "bg-transparent text-slate-600 cursor-not-allowed"
                                    : "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-500/20"
                            )}
                            title="Enviar"
                        >
                            <Send className={cn("w-4 h-4", isAnalyzing && "opacity-50")} />
                        </button>
                    </div>
                    <p className="text-[10px] text-center text-slate-600 mt-2 opacity-60">
                        Pressione <span className="font-bold text-slate-500">Enter</span> para enviar, <span className="font-bold text-slate-500">Shift + Enter</span> para nova linha
                    </p>
                </div>

            </div>
        </div>
    );
}
