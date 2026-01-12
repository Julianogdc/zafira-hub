import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Pencil, Trash2, CalendarDays } from "lucide-react";
import { Transaction } from "@/types/finance";
import { useState } from "react";
import { useFinanceStore } from "@/store/useFinanceStore";

interface TransactionListProps {
    transactions: Transaction[];
    onEdit: (t: Transaction) => void;
    formatBRL: (val: number) => string;
}

export function TransactionList({ transactions, onEdit, formatBRL }: TransactionListProps) {
    const { removeTransaction } = useFinanceStore();
    const [toDelete, setToDelete] = useState<Transaction | null>(null);

    // Filter transactions
    const incomes = transactions.filter(t => t.type === 'income');
    const expenses = transactions.filter(t => t.type === 'expense');

    // Helper to group transactions by "Month Year"
    const groupTransactions = (txs: Transaction[]) => {
        return txs.reduce((groups, t) => {
            const date = new Date(t.date);
            const key = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
            const label = key.charAt(0).toUpperCase() + key.slice(1);

            let group = groups.find(g => g.label === label);
            if (!group) {
                group = { label, transactions: [], total: 0 };
                groups.push(group);
            }
            group.transactions.push(t);
            // Amount is absolute for rendering, but let's keep it simple
            group.total += t.amount;
            return groups;
        }, [] as { label: string, transactions: Transaction[], total: number }[]);
    };

    const groupedIncomes = groupTransactions(incomes);
    const groupedExpenses = groupTransactions(expenses);

    // Reusable Accordion Render
    const renderAccordion = (groups: ReturnType<typeof groupTransactions>, type: 'income' | 'expense') => (
        <Accordion type="single" collapsible className="w-full space-y-2">
            {groups.map((group) => (
                <AccordionItem key={group.label} value={group.label} className="border border-white/10 rounded-lg bg-zinc-950/30 px-2">
                    <AccordionTrigger className="hover:no-underline py-3 px-2">
                        <div className="flex justify-between w-full pr-4 items-center">
                            <span className="font-medium text-zinc-200">{group.label}</span>
                            <span className={`text-sm font-bold ${type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatBRL(group.total)}
                            </span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4 px-2 space-y-2">
                        {group.transactions.map((t) => (
                            <div
                                key={t.id}
                                className="flex justify-between items-center rounded-md border border-white/5 bg-zinc-900/50 px-3 py-2 hover:bg-zinc-900 transition-colors"
                            >
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-zinc-200">{t.title}</span>
                                    <span className="text-xs text-zinc-500">
                                        {new Date(t.date).toLocaleDateString("pt-BR")} • {t.category}
                                    </span>
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-semibold ${type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {formatBRL(t.amount)}
                                    </span>

                                    <div className="flex opacity-50 hover:opacity-100 transition-opacity">
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(t)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400 hover:text-rose-300" onClick={() => setToDelete(t)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    );

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* BLOCO RECEITAS */}
                <Card className="bg-emerald-950/10 backdrop-blur-xl border-emerald-500/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-emerald-400">
                            <CalendarDays className="w-5 h-5" />
                            Receitas
                        </CardTitle>
                        <CardDescription>Entradas organizadas por mês</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {groupedIncomes.length > 0 ? renderAccordion(groupedIncomes, 'income') : (
                            <p className="text-zinc-500 text-sm italic">Nenhuma receita registrada no período.</p>
                        )}
                    </CardContent>
                </Card>

                {/* BLOCO DESPESAS */}
                <Card className="bg-rose-950/10 backdrop-blur-xl border-rose-500/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-rose-400">
                            <CalendarDays className="w-5 h-5" />
                            Despesas
                        </CardTitle>
                        <CardDescription>Saídas organizadas por mês</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {groupedExpenses.length > 0 ? renderAccordion(groupedExpenses, 'expense') : (
                            <p className="text-zinc-500 text-sm italic">Nenhuma despesa registrada no período.</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* DIÁLOGO DE CONFIRMAÇÃO DE EXCLUSÃO */}
            <AlertDialog open={!!toDelete} onOpenChange={() => setToDelete(null)}>
                <AlertDialogContent className="bg-zinc-950 border border-white/10">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir transação?</AlertDialogTitle>
                        <AlertDialogDescription className="text-zinc-400">
                            Essa ação não pode ser desfeita e afetará o saldo do mês.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/10 hover:bg-zinc-900">Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-900/50 text-red-200 border border-red-500/20 hover:bg-red-900"
                            onClick={() => {
                                if (toDelete) removeTransaction(toDelete.id);
                                setToDelete(null);
                            }}
                        >
                            Excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
