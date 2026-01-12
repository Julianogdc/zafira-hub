import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAIStore } from "@/store/useAIStore";
import { Book, Plus, Trash2, Search, Braces, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface IAPromptsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelectPrompt: (content: string) => void;
}

export function IAPromptsDialog({ open, onOpenChange, onSelectPrompt }: IAPromptsDialogProps) {
    const { prompts, savePrompt, deletePrompt } = useAIStore();
    const [activeTab, setActiveTab] = useState("system");
    const [search, setSearch] = useState("");

    // New Prompt State
    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newContent, setNewContent] = useState("");

    const filteredPrompts = prompts.filter(p =>
        p.category === (activeTab === "system" ? "system" : "user") &&
        (p.title.toLowerCase().includes(search.toLowerCase()) ||
            p.content.toLowerCase().includes(search.toLowerCase()))
    );

    const handleCreate = () => {
        if (!newTitle.trim() || !newContent.trim()) return;
        savePrompt({
            title: newTitle,
            content: newContent,
            category: 'user'
        });
        setNewTitle("");
        setNewContent("");
        setIsCreating(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-[#09090b] border-white/10 text-slate-200">
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                            <Book className="w-5 h-5 text-orange-400" />
                        </div>
                        <div>
                            <DialogTitle className="text-xl font-bold text-white">Biblioteca de Prompts</DialogTitle>
                            <DialogDescription className="text-xs text-slate-400">
                                Selecione um modelo pronto ou crie seus próprios atalhos.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-[500px] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <TabsList className="bg-white/5 border border-white/10">
                            <TabsTrigger value="system" className="data-[state=active]:bg-orange-500 data-[state=active]:text-white">
                                <Braces className="w-3 h-3 mr-2" /> Sistema
                            </TabsTrigger>
                            <TabsTrigger value="user" className="data-[state=active]:bg-purple-500 data-[state=active]:text-white">
                                <User className="w-3 h-3 mr-2" /> Meus Prompts
                            </TabsTrigger>
                        </TabsList>

                        {activeTab === 'user' && !isCreating && (
                            <Button onClick={() => setIsCreating(true)} size="sm" variant="outline" className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10">
                                <Plus className="w-3 h-3 mr-2" /> Novo Prompt
                            </Button>
                        )}
                    </div>

                    {/* Creation Mode */}
                    {isCreating ? (
                        <div className="flex-1 flex flex-col gap-4 animate-in fade-in slide-in-from-right-4">
                            <div className="space-y-1">
                                <label className="text-xs text-slate-400 font-bold uppercase">Título</label>
                                <Input
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder="Ex: Analisar Texto Legal"
                                    className="bg-white/5 border-white/10"
                                />
                            </div>
                            <div className="space-y-1 flex-1 flex flex-col">
                                <label className="text-xs text-slate-400 font-bold uppercase">Conteúdo do Prompt</label>
                                <Textarea
                                    value={newContent}
                                    onChange={(e) => setNewContent(e.target.value)}
                                    placeholder="Digite o texto que será inserido no chat..."
                                    className="bg-white/5 border-white/10 flex-1 resize-none"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                                <Button variant="ghost" onClick={() => setIsCreating(false)}>Cancelar</Button>
                                <Button onClick={handleCreate} disabled={!newTitle || !newContent} className="bg-purple-600 hover:bg-purple-500">
                                    Salvar Prompt
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Search */}
                            <div className="relative mb-3">
                                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar prompts..."
                                    className="pl-9 bg-black/20 border-white/10"
                                />
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {filteredPrompts.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                                        <Book className="w-8 h-8 mb-2" />
                                        <p className="text-sm">Nenhum prompt encontrado.</p>
                                    </div>
                                ) : (
                                    filteredPrompts.map(prompt => (
                                        <div
                                            key={prompt.id}
                                            className="group p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-all cursor-pointer flex items-center justify-between"
                                            onClick={() => {
                                                onSelectPrompt(prompt.content);
                                                onOpenChange(false);
                                            }}
                                        >
                                            <div className="flex-1 mr-4">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h4 className="font-medium text-slate-200 group-hover:text-white transition-colors">{prompt.title}</h4>
                                                    {prompt.category === 'system' && <Badge variant="secondary" className="text-[9px] h-4 bg-orange-500/10 text-orange-400 border-orange-500/20">System</Badge>}
                                                </div>
                                                <p className="text-xs text-slate-500 line-clamp-2">{prompt.content}</p>
                                            </div>

                                            {prompt.category === 'user' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="opacity-0 group-hover:opacity-100 h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deletePrompt(prompt.id);
                                                    }}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </Tabs>

            </DialogContent>
        </Dialog>
    );
}
