
import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Transaction } from "@/types/finance";
import { useFinanceStore } from "@/store/useFinanceStore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryManager } from "@/components/finance/CategoryManager";
import { CATEGORY_ICONS } from "@/constants/categoryIcons";

interface TransactionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    type?: "income" | "expense"; // Se fornecido, força o tipo (para criação)
    editingTransaction?: Transaction | null; // Se fornecido, é edição
}

export function TransactionDialog({
    open,
    onOpenChange,
    type,
    editingTransaction,
}: TransactionDialogProps) {
    const { addTransaction, updateTransaction, categories } = useFinanceStore();

    const [title, setTitle] = useState("");
    const [date, setDate] = useState("");
    const [amount, setAmount] = useState("");
    const [category, setCategory] = useState("");

    // Efeito para carregar dados ao editar ou limpar ao criar
    useEffect(() => {
        if (editingTransaction) {
            setTitle(editingTransaction.title);
            // slice(0, 10) para pegar YYYY-MM-DD
            setDate(editingTransaction.date.slice(0, 10));
            setAmount(String(editingTransaction.amount));
            setCategory(editingTransaction.category);
        } else {
            setTitle("");
            // Default Date: Local "Today"
            const today = new Date();
            const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
            setDate(localDate);

            setAmount("");
            setCategory("");
        }
    }, [editingTransaction, open]);

    const handleSave = () => {
        // Determina o tipo: se estiver editando, usa o da transação, senão usa a prop 'type'
        const finalType = editingTransaction ? editingTransaction.type : type;

        // Safety check
        if (!finalType) return;

        // ✅ VACINA DE DATA e HORA: Adiciona T12:00:00 para evitar problemas de fuso
        const safeDate = new Date(date + "T12:00:00").toISOString();

        if (editingTransaction) {
            updateTransaction({
                ...editingTransaction,
                title,
                amount: Number(amount),
                category: category,
                date: safeDate,
            });
        } else {
            addTransaction({
                id: crypto.randomUUID(),
                title,
                type: finalType,
                amount: Number(amount),
                category: category || "Outros",
                date: safeDate,
            });
        }
        onOpenChange(false);
    };

    const dialogTitle = editingTransaction
        ? `Editar ${editingTransaction.type === "income" ? "receita" : "despesa"} `
        : `Nova ${type === "income" ? "receita" : "despesa"} `;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{dialogTitle}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                    <Label>Nome</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} />

                    <Label>Data</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

                    <Label>Valor</Label>
                    <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />

                    <div className="flex items-center justify-between mt-1">
                        <Label>Categoria</Label>
                        <CategoryManager />
                    </div>

                    <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecione uma categoria" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                            {categories.map(cat => {
                                const Icon = CATEGORY_ICONS[cat.icon || "Wallet"] || CATEGORY_ICONS["Wallet"];
                                return (
                                    <SelectItem key={cat.id} value={cat.name}>
                                        <div className="flex items-center gap-2">
                                            <Icon className="w-4 h-4" style={{ color: cat.color }} />
                                            <span>{cat.name}</span>
                                        </div>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave}>
                        {editingTransaction ? "Salvar alterações" : "Salvar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
