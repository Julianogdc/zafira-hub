import { useState } from 'react';
import { usePerformanceStore, TrafficCampaign } from '../../store/usePerformanceStore';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogClose
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

interface AddCampaignModalProps {
    clientId: string;
}

export const AddCampaignModal = ({ clientId }: AddCampaignModalProps) => {
    const { addCampaign } = usePerformanceStore();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [status, setStatus] = useState<'active' | 'paused'>('active');
    const [budget, setBudget] = useState('');

    const handleSave = () => {
        if (!name) {
            toast.error("O nome da campanha é obrigatório.");
            return;
        }

        const newCampaign: TrafficCampaign = {
            id: crypto.randomUUID(),
            name,
            status,
            budget: parseFloat(budget) || 0,
            spent: 0,
            ads: [] // Empty ads initially
        };

        addCampaign(clientId, newCampaign);
        toast.success("Campanha adicionada com sucesso!");
        setOpen(false);
        setName('');
        setBudget('');
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="gap-2 bg-purple-600 hover:bg-purple-700">
                    <Plus className="h-4 w-4" />
                    Nova Campanha
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adicionar Campanha Manual</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Nome da Campanha</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ex: Campanha Institucional V1"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Status</Label>
                            <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Ativa</SelectItem>
                                    <SelectItem value="paused">Pausada</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Orçamento (R$)</Label>
                            <Input
                                type="number"
                                value={budget}
                                onChange={(e) => setBudget(e.target.value)}
                                placeholder="0,00"
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancelar</Button>
                    </DialogClose>
                    <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700">Adicionar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
