import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from 'lucide-react';

interface LostReasonDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}

const COMMON_REASONS = [
    "Preço alto",
    "Optou pela concorrência",
    "Sem orçamento no momento",
    "Não respondeu (Ghosting)",
    "Funcionalidade faltando",
    "Outro"
];

export function LostReasonDialog({ isOpen, onClose, onConfirm }: LostReasonDialogProps) {
    const [reason, setReason] = useState<string>('');
    const [customReason, setCustomReason] = useState('');
    const [loading, setLoading] = useState(false);

    const handleConfirm = async () => {
        const finalReason = reason === 'Outro' ? customReason : reason;
        if (!finalReason) return;

        setLoading(true);
        try {
            await onConfirm(finalReason);
            setReason('');
            setCustomReason('');
            onClose();
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md bg-zinc-950 border-zinc-800 text-zinc-100">
                <DialogHeader>
                    <div className="mx-auto bg-red-950/30 p-3 rounded-full mb-2 border border-red-500/20">
                        <AlertTriangle className="w-6 h-6 text-red-500" />
                    </div>
                    <DialogTitle className="text-center text-xl">Motivo da Perda</DialogTitle>
                    <DialogDescription className="text-center text-zinc-400">
                        Saber por que perdemos é o primeiro passo para ganhar a próxima. O que houve?
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label>Selecione um motivo</Label>
                        <Select onValueChange={setReason} value={reason}>
                            <SelectTrigger className="bg-zinc-900 border-zinc-700">
                                <SelectValue placeholder="Escolha um motivo..." />
                            </SelectTrigger>
                            <SelectContent>
                                {COMMON_REASONS.map((r) => (
                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {reason === 'Outro' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                            <Label>Especifique</Label>
                            <Textarea
                                placeholder="Conte mais detalhes..."
                                value={customReason}
                                onChange={(e) => setCustomReason(e.target.value)}
                                className="bg-zinc-900 border-zinc-700 min-h-[80px]"
                            />
                        </div>
                    )}
                </div>

                <DialogFooter className="sm:justify-center gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={loading}>
                        Cancelar (Não mover)
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!reason || (reason === 'Outro' && !customReason) || loading}
                        className="bg-red-600 hover:bg-red-700 text-white min-w-[120px]"
                    >
                        Confirmar Perda
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
