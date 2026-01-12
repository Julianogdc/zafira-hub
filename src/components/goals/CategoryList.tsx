import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListTodo, Hash, DollarSign, Zap } from "lucide-react";
import { Goal, GoalType } from "@/types/goals";
import { GoalChecklist } from "@/components/goals/GoalChecklist";
import { GoalNumericUpdate } from "@/components/goals/GoalNumericUpdate";
import { goalTypeLabels } from "@/hooks/useGoalMetrics";

interface CategoryListProps {
    metasPorCategoria: any[];
    onEdit: (meta: Goal) => void;
    onDelete: (meta: Goal) => void;
}

const getTypeIcon = (type: GoalType) => {
    switch (type) {
        case 'checklist': return <ListTodo className="h-4 w-4" />;
        case 'numeric': return <Hash className="h-4 w-4" />;
        default: return <DollarSign className="h-4 w-4" />;
    }
};

const formatDate = (timestamp: number) => {
    if (!timestamp) return "-";
    return new Date(timestamp).toLocaleDateString("pt-BR");
}

export function CategoryList({ metasPorCategoria, onEdit, onDelete }: CategoryListProps) {
    return (
        <Card className="border border-border/70 bg-card/80 backdrop-blur-xl">
            <CardHeader>
                <CardTitle className="text-base font-medium">Detalhamento por Categoria</CardTitle>
            </CardHeader>
            <CardContent>
                <Accordion type="single" collapsible className="space-y-4">
                    {metasPorCategoria.map((grupo) => (
                        <AccordionItem key={grupo.pilar} value={grupo.pilar} className="border-none">
                            <AccordionTrigger className="px-4 py-3 rounded-lg bg-accent/20 hover:bg-accent/30 hover:no-underline transition-colors">
                                <div className="flex w-full items-center justify-between pr-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1 h-6 bg-emerald-500 rounded-full" />
                                        <span className="font-semibold text-lg tracking-tight">{grupo.pilar}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs text-muted-foreground bg-background/50 px-2 py-1 rounded-md border border-white/5">
                                            {grupo.metas.length} metas
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">Média:</span>
                                            <span className={`text-sm font-bold ${grupo.progressoMedio >= 100 ? 'text-emerald-500' : 'text-zinc-200'}`}>
                                                {grupo.progressoMedio}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-4 px-1">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {grupo.metas.map((meta: any) => (
                                        <div
                                            key={meta.id}
                                            className="group flex flex-col justify-between rounded-xl border border-white/5 bg-zinc-900/40 p-5 hover:bg-zinc-900/60 hover:border-white/10 transition-all duration-300 relative overflow-hidden"
                                        >
                                            {/* Decorative Gradient Background */}
                                            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl -z-10 rounded-full group-hover:bg-emerald-500/10 transition-colors" />

                                            <div className="space-y-4">
                                                {/* HEADER */}
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2.5 rounded-xl bg-zinc-950 border border-white/5 shadow-sm">
                                                            {getTypeIcon(meta.type)}
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`w-1.5 h-1.5 rounded-full ${meta.progress >= 1 ? 'bg-emerald-500' : 'bg-emerald-500/30'}`} />
                                                                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                                                    {meta.type === 'checklist' ? 'Tarefa' :
                                                                        meta.type === 'monetary' ? 'Financeiro' : 'Numérico'}
                                                                </span>
                                                            </div>
                                                            <h3 className="font-semibold text-base mt-0.5 line-clamp-1 text-zinc-100" title={meta.name}>
                                                                {meta.name}
                                                            </h3>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* PROGRESS & VALUES */}
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-end text-sm">
                                                        <span className="text-muted-foreground">Progresso</span>
                                                        <span className="font-bold text-lg">{Math.round(meta.progress * 100)}%</span>
                                                    </div>
                                                    <Progress
                                                        value={Math.round(meta.progress * 100)}
                                                        className={`h-2 bg-zinc-950 border border-white/5 ${meta.progress >= 1 ? '[&>div]:bg-emerald-500' : '[&>div]:bg-emerald-600'}`}
                                                    />

                                                    {/* TYPE SPECIFIC INFO */}
                                                    <div className="pt-2 min-h-[40px]">
                                                        {meta.type === 'checklist' && <GoalChecklist goal={meta} />}
                                                        {meta.type === 'numeric' && <GoalNumericUpdate goal={meta} />}
                                                        {meta.type === 'monetary' && (
                                                            <div className="flex justify-between items-center text-sm bg-zinc-950/30 p-2 rounded-lg border border-white/5">
                                                                <div className="flex flex-col">
                                                                    <span className="text-[10px] text-muted-foreground uppercase">Atual</span>
                                                                    <span className="font-medium text-zinc-300">R$ {meta.current?.toLocaleString('pt-BR')}</span>
                                                                </div>
                                                                <div className="w-px h-6 bg-white/10" />
                                                                <div className="flex flex-col text-right">
                                                                    <span className="text-[10px] text-muted-foreground uppercase">Meta</span>
                                                                    <span className="font-medium text-emerald-400">R$ {meta.targetValue?.toLocaleString('pt-BR')}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* FOOTER */}
                                            <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[10px] text-muted-foreground font-medium uppercase">Prazo</span>
                                                    <span className="text-xs text-zinc-400 font-medium">
                                                        {formatDate(meta.endDate)}
                                                    </span>
                                                </div>

                                                <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                    <Button size="sm" variant="ghost" className="h-8 px-2 hover:bg-zinc-800 hover:text-white" onClick={() => onEdit(meta)}>
                                                        Editar
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 px-2 text-rose-500/70 hover:text-rose-400 hover:bg-rose-500/10"
                                                        onClick={() => onDelete(meta)}
                                                    >
                                                        Excluir
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* Automation Badge (Absolute or Integrated) */}
                                            {meta.automationBinding && (
                                                <div className="absolute top-5 right-5" title={`Automatizado: ${goalTypeLabels[meta.automationBinding]}`}>
                                                    <Zap className="w-4 h-4 text-amber-500 fill-amber-500/20 animate-pulse" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </CardContent>
        </Card>
    );
}
