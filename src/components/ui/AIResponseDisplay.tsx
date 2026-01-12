import React from 'react';
import { cn } from '@/lib/utils';
import { AIRole } from '@/types/ai';
import { Bot, User, Sparkles } from 'lucide-react';

interface AIResponseDisplayProps {
  role: AIRole;
  content: string;
  className?: string;
}

// AQUI ESTÁ A CHAVE: "export function" garante que outros arquivos consigam ver este componente
export function AIResponseDisplay({ role, content, className }: AIResponseDisplayProps) {
  const isUser = role === 'user';
  
  const parseBold = (text: string) => {
    if (!text) return null;
    const parts = text.split(/\*\*([^*]+)\*\*/g);

    if (parts.length === 1) {
      if (text.includes('*') && !text.trim().startsWith('*')) {
         const singleParts = text.split(/\*([^*]+)\*/g);
         if (singleParts.length > 1) {
            return singleParts.map((p, i) => i % 2 === 1 ? <strong key={i} className="text-white font-bold">{p}</strong> : p);
         }
      }
      return text;
    }
    
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <strong key={index} className="text-white font-bold">{part}</strong>;
      }
      return part;
    });
  };

  const renderContent = (fullText: string) => {
    return fullText.split('\n').map((line, index) => {
      let trimmed = line.trim();
      if (!trimmed) return <div key={index} className="h-3" />;

      if (trimmed.startsWith('#')) {
        const cleanTitle = trimmed.replace(/^#+/, '').replace(/\*/g, '').trim();
        return (
          <h3 key={index} className="text-sm font-bold text-purple-300 mt-6 mb-2 uppercase tracking-wide flex items-center gap-2 border-b border-white/5 pb-2">
            <Sparkles className="w-3 h-3 text-purple-500 shrink-0" />
            <span>{cleanTitle}</span>
          </h3>
        );
      }

      const numMatch = trimmed.match(/^(\d+)[\.\)]\s+(.*)/);
      if (numMatch) {
        const [_, num, body] = numMatch;
        return (
          <div key={index} className="flex gap-3 ml-1 mb-3 group">
            <span className="text-purple-400 font-mono text-xs font-bold mt-0.5 min-w-[20px] text-right shrink-0">
              {num}.
            </span>
            <span className="text-slate-300 leading-relaxed flex-1">
               {parseBold(body)}
            </span>
          </div>
        );
      }

      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        const body = trimmed.replace(/^[\*\-]\s+/, '');
        return (
          <div key={index} className="flex gap-3 ml-1 mb-2">
            <span className="text-purple-500 mt-1.5 text-[6px] shrink-0">●</span>
            <span className="text-slate-300 leading-relaxed flex-1">
               {parseBold(body)}
            </span>
          </div>
        );
      }

      return (
        <p key={index} className="mb-2 text-slate-300 leading-relaxed">
          {parseBold(trimmed)}
        </p>
      );
    });
  };

  return (
    <div
      className={cn(
        "flex w-full gap-4 p-4 rounded-xl text-sm transition-all animate-in fade-in slide-in-from-bottom-2",
        isUser ? "bg-white/5 border border-white/10" : "bg-transparent",
        className
      )}
    >
      <div className={cn(
        "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg border text-xs font-medium shadow-sm",
        isUser 
          ? "bg-purple-600 border-purple-500 text-white" 
          : "bg-gradient-to-br from-zinc-800 to-zinc-900 border-zinc-700 text-purple-400"
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      
      <div className="flex-1 space-y-1 overflow-hidden min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 flex justify-between border-b border-white/5 pb-1">
          <span>{isUser ? 'Você' : 'Zafira AI'}</span>
        </div>
        
        <div className="text-slate-300">
          {renderContent(content)}
        </div>
      </div>
    </div>
  );
}