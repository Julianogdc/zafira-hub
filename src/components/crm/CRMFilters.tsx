import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, X, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CRMFiltersProps {
    searchTerm: string;
    setSearchTerm: (value: string) => void;
    sourceFilter: string;
    setSourceFilter: (value: string) => void;
    dateFilter: string;
    setDateFilter: (value: string) => void;
}

export const CRMFilters = ({
    searchTerm,
    setSearchTerm,
    sourceFilter,
    setSourceFilter,
    dateFilter,
    setDateFilter
}: CRMFiltersProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input when expanding
    useEffect(() => {
        if (isExpanded && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isExpanded]);

    const hasActiveFilters = searchTerm || sourceFilter !== 'all' || dateFilter !== 'all';

    const clearFilters = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setDateFilter('all');
        setIsExpanded(false);
    }

    if (!isExpanded && !hasActiveFilters) {
        return (
            <div className="flex justify-end mb-2 px-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsExpanded(true)}
                    className="text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 h-8 gap-2 group"
                >
                    <div className="bg-emerald-500/10 p-1 rounded group-hover:bg-emerald-500/20 transition-colors">
                        <Search className="w-3 h-3 text-emerald-500" />
                    </div>
                    <span className="text-xs font-medium">Buscar & Filtrar</span>
                </Button>
            </div>
        )
    }

    return (
        <div className={cn(
            "flex flex-col md:flex-row gap-3 mb-4 p-2 bg-zinc-900/40 border border-white/5 rounded-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-2",
            isExpanded ? "items-start md:items-center" : ""
        )}>
            <div className="flex-1 relative flex items-center gap-2 w-full">
                <Search className="absolute left-3 w-4 h-4 text-zinc-500" />
                <Input
                    ref={inputRef}
                    placeholder="Buscar lead (nome, empresa)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9 bg-zinc-950/50 border-white/10 text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50 text-sm"
                />
            </div>

            <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[140px] h-9 bg-zinc-950/50 border-white/10 text-zinc-300 text-xs">
                        <Filter className="w-3 h-3 mr-2 text-zinc-500" />
                        <SelectValue placeholder="Origem" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas as Origens</SelectItem>
                        <SelectItem value="indicação">Indicação</SelectItem>
                        <SelectItem value="prospecção_ativa">Prospecção Ativa</SelectItem>
                        <SelectItem value="comercial">Comercial</SelectItem>
                        <SelectItem value="anuncio">Anúncio (Ads)</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={dateFilter} onValueChange={setDateFilter}>
                    <SelectTrigger className="w-[140px] h-9 bg-zinc-950/50 border-white/10 text-zinc-300 text-xs">
                        <Calendar className="w-3 h-3 mr-2 text-zinc-500" />
                        <SelectValue placeholder="Período" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todo o Período</SelectItem>
                        <SelectItem value="30days">Últimos 30 dias</SelectItem>
                        <SelectItem value="thisMonth">Este Mês</SelectItem>
                    </SelectContent>
                </Select>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearFilters}
                    className="h-9 w-9 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                    title="Limpar Filtros"
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
};
