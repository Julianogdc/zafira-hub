import { memo } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface QuickTaskInputProps {
    active: boolean;
    onActivate: () => void;
    onCancel: () => void;
    name: string;
    setName: (val: string) => void;
    desc: string;
    setDesc: (val: string) => void;
    onSubmit: () => void;
}

export const QuickTaskInput = memo(({ active, onActivate, onCancel, name, setName, desc, setDesc, onSubmit }: QuickTaskInputProps) => {
    if (!active) {
        return (
            <div className="flex items-center gap-2 p-3 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg cursor-pointer transition-colors mb-2 border border-dashed border-white/5 hover:border-white/10" onClick={onActivate}>
                <Plus className="w-4 h-4" />
                <span className="text-sm font-medium">Adicionar tarefa...</span>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2 p-3 bg-[#1e1e2e] border border-blue-500/30 rounded-lg shadow-lg mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2">
                <div className="w-4 h-4 ml-1 border-2 border-slate-600 rounded-sm shrink-0"></div>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="border-none bg-transparent shadow-none focus-visible:ring-0 h-8 px-2 font-medium text-sm placeholder:text-slate-500" placeholder="Nome da tarefa..." onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } if (e.key === 'Escape') onCancel(); }} />
            </div>
            <div className="pl-8 pr-2">
                <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (opcional)..." className="min-h-[60px] text-xs bg-black/20 border-none resize-none focus-visible:ring-0 text-slate-300 placeholder:text-slate-600 mb-2" />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs hover:bg-white/10 text-slate-400">Cancelar</Button>
                    <Button size="sm" onClick={onSubmit} className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium px-4">Criar</Button>
                </div>
            </div>
        </div>
    );
});

QuickTaskInput.displayName = 'QuickTaskInput';
