import { useState, useRef, useMemo } from "react";
import { useFinanceStore } from "@/store/useFinanceStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Edit2, Plus, ChevronDown, ChevronUp, Save, Search, ArrowLeft } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CATEGORY_ICONS, INITIAL_ICONS } from "@/constants/categoryIcons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Category } from "@/types/finance";

const PRESET_COLORS = [
    "#ef4444", "#f97316", "#eab308", "#84cc16",
    "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
    "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e",
    "#64748b", "#71717a"
];

export function CategoryManager() {
    const { categories, addCategory, updateCategory, removeCategory } = useFinanceStore();
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("list");

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [iconKey, setIconKey] = useState("Wallet");
    const [color, setColor] = useState("#3b82f6");
    const [showAllIcons, setShowAllIcons] = useState(false);

    // Sort Categories by usage (Recent first)
    const sortedCategories = useMemo(() => {
        return [...categories].sort((a, b) => {
            const timeA = a.lastUsed || "0";
            const timeB = b.lastUsed || "0";
            return timeB.localeCompare(timeA);
        });
    }, [categories]);

    // Derived Icon Component for Preview
    const PreviewIcon = CATEGORY_ICONS[iconKey] || CATEGORY_ICONS["Wallet"];

    const handleSave = () => {
        if (!name.trim()) return;

        if (editingId) {
            updateCategory({
                id: editingId,
                name,
                icon: iconKey,
                color,
                // lastUsed preserves in store
            });
        } else {
            addCategory({
                id: crypto.randomUUID(),
                name,
                icon: iconKey,
                color,
                lastUsed: new Date().toISOString()
            });
        }

        resetForm();
        setActiveTab("list");
    };

    // Custom Color Input Ref
    const colorInputRef = useRef<HTMLInputElement>(null);

    const handleEdit = (cat: Category) => {
        setEditingId(cat.id);
        setName(cat.name);
        setIconKey(cat.icon || "Wallet");
        setColor(cat.color || "#3b82f6");
        setActiveTab("create");
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm("Excluir esta categoria?")) {
            removeCategory(id);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setName("");
        setIconKey("Wallet");
        setColor("#3b82f6");
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Edit2 className="w-3 h-3" /> Gerenciar Categorias
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md h-[700px] p-0 flex flex-col bg-[#09090b] border-white/10">
                <div className="p-6 pb-0 shrink-0">
                    <DialogHeader>
                        <DialogTitle className="text-xl">Categorias</DialogTitle>
                    </DialogHeader>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                    <div className="px-6 mt-4 shrink-0">
                        <TabsList className="grid w-full grid-cols-2 bg-white/5">
                            <TabsTrigger value="list" onClick={resetForm}>Minhas Categorias</TabsTrigger>
                            <TabsTrigger value="create">{editingId ? "Editar" : "Nova Categoria"}</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="list" className="flex-1 p-6 pt-4 overflow-hidden flex flex-col gap-4 data-[state=inactive]:hidden">
                        <div className="relative shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input placeholder="Buscar..." className="pl-9 bg-white/5 border-none" />
                        </div>

                        <div className="flex-1 -mr-4 pr-4 overflow-y-auto custom-scrollbar">
                            <div className="space-y-2 pb-4">
                                {sortedCategories.map(cat => {
                                    const CatIcon = CATEGORY_ICONS[cat.icon || "Wallet"] || CATEGORY_ICONS["Wallet"];
                                    return (
                                        <div
                                            key={cat.id}
                                            onClick={() => handleEdit(cat)}
                                            className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-transparent hover:border-primary/50 hover:bg-white/10 transition-all cursor-pointer group"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div
                                                    className="w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-black/40 shadow-inner"
                                                    style={{ color: cat.color }}
                                                >
                                                    <CatIcon className="w-6 h-6" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-slate-100">{cat.name}</span>
                                                    <span className="text-xs text-muted-foreground">Último uso: {cat.lastUsed ? new Date(cat.lastUsed).toLocaleDateString() : 'Nunca'}</span>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                                                onClick={(e) => handleDelete(cat.id, e)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    );
                                })}
                                {sortedCategories.length === 0 && (
                                    <div className="text-center py-10 text-muted-foreground">
                                        Nenhuma categoria encontrada.
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="create" className="flex-1 flex flex-col min-h-0 data-[state=inactive]:hidden">
                        {/* HERO PREVIEW SECTION - FIXED */}
                        <div className="shrink-0 flex flex-col items-center justify-center py-6 bg-gradient-to-b from-white/5 to-transparent border-b border-white/5 z-10 relative">
                            <div className="relative group cursor-default">
                                <div
                                    className="w-20 h-20 rounded-full flex items-center justify-center text-3xl shadow-2xl transition-all duration-300"
                                    style={{
                                        backgroundColor: color,
                                        color: "#fff",
                                        boxShadow: `0 0 30px ${color}60`
                                    }}
                                >
                                    <PreviewIcon className="w-10 h-10" />
                                </div>
                                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#1e1e2e] border border-white/10 text-[10px] uppercase font-bold tracking-wider text-slate-400 px-2 py-0.5 rounded-full shadow-xl whitespace-nowrap">
                                    Pré-visualização
                                </div>
                            </div>

                            <div className="w-full max-w-[280px] mt-6">
                                <Input
                                    placeholder="Nome da Categoria"
                                    className="h-auto py-2 text-center text-xl font-bold bg-transparent border-none focus-visible:ring-0 placeholder:text-white/20 text-white"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    autoFocus
                                />
                                <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                            </div>
                        </div>

                        {/* SCROLLABLE FORM SECTION */}
                        <div className="flex-1 w-full overflow-y-auto min-h-0 custom-scrollbar">
                            <div className="p-6 space-y-6 pb-20">
                                {/* COLOR PICKER */}
                                <div className="space-y-3">
                                    <Label className="text-xs uppercase tracking-wider text-slate-500 font-semibold ml-1">Cor do Ícone</Label>
                                    <div className="flex flex-wrap gap-3 justify-center">
                                        {PRESET_COLORS.map(c => (
                                            <button
                                                key={c}
                                                onClick={() => setColor(c)}
                                                className={cn(
                                                    "w-10 h-10 rounded-full transition-all duration-300 flex items-center justify-center",
                                                    color === c ? "scale-110 ring-2 ring-offset-2 ring-offset-[#09090b] ring-white" : "hover:scale-105 hover:opacity-80"
                                                )}
                                                style={{ backgroundColor: c }}
                                            >
                                                {color === c && <div className="w-3 h-3 bg-white rounded-full animate-in zoom-in" />}
                                            </button>
                                        ))}
                                        <div className="relative w-10 h-10 group">
                                            <Input
                                                ref={colorInputRef}
                                                type="color"
                                                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
                                                value={color}
                                                onChange={(e) => setColor(e.target.value)}
                                            />
                                            <div className="w-full h-full rounded-full border-2 border-dashed border-slate-600 flex items-center justify-center group-hover:border-white transition-colors bg-white/5">
                                                <Plus className="w-4 h-4 text-slate-400 group-hover:text-white" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ICON PICKER */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs uppercase tracking-wider text-slate-500 font-semibold ml-1">Ícone</Label>
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-xs text-primary"
                                            onClick={() => setShowAllIcons(!showAllIcons)}
                                        >
                                            {showAllIcons ? "Mostrar Menos" : "Ver Todos"}
                                        </Button>
                                    </div>

                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 shadow-inner">
                                        <div className={cn(
                                            "grid grid-cols-6 gap-2 transition-all duration-500 ease-in-out",
                                            showAllIcons ? "max-h-[300px] overflow-y-auto pr-2 custom-scrollbar" : ""
                                        )}>
                                            {(showAllIcons ? Object.keys(CATEGORY_ICONS) : INITIAL_ICONS).map(key => {
                                                const Icon = CATEGORY_ICONS[key];
                                                const isSelected = iconKey === key;
                                                return (
                                                    <button
                                                        key={key}
                                                        onClick={() => setIconKey(key)}
                                                        className={cn(
                                                            "aspect-square flex items-center justify-center rounded-xl transition-all duration-200",
                                                            isSelected
                                                                ? "bg-primary text-white scale-110 shadow-lg ring-2 ring-primary/50"
                                                                : "text-slate-400 hover:bg-white/10 hover:text-white hover:scale-105"
                                                        )}
                                                        style={isSelected ? { backgroundColor: color } : undefined}
                                                        title={key}
                                                    >
                                                        <Icon className="w-5 h-5" />
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>

                                <Button
                                    onClick={handleSave}
                                    className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-primary/25 transition-all active:scale-[0.98]"
                                    disabled={!name}
                                    style={{ backgroundColor: name ? color : undefined }}
                                >
                                    <Save className="w-5 h-5 mr-2" />
                                    {editingId ? "Salvar Alterações" : "Criar Categoria"}
                                </Button>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
