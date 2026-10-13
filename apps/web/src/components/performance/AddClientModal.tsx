import { useState } from 'react';
import { usePerformanceStore, TrafficClient } from '../../store/usePerformanceStore';
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
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export const AddClientModal = () => {
    const { addClient } = usePerformanceStore();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [platform, setPlatform] = useState<'meta' | 'google' | 'tiktok' | 'linkedin'>('meta');
    const [notes, setNotes] = useState('');

    const handleSave = () => {
        if (!name) {
            toast.error("O nome do cliente é obrigatório.");
            return;
        }

        const newClient: TrafficClient = {
            id: crypto.randomUUID(),
            name,
            platform,
            status: 'active',
            notes,
            metrics: [],
            campaigns: []
        };

        addClient(newClient);
        toast.success("Cliente adicionado com sucesso!");
        setOpen(false);
        setName('');
        setNotes('');
        setPlatform('meta');
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="w-full text-xs gap-2">
                    <Plus className="h-4 w-4" />
                    Novo Cliente
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adicionar Novo Cliente</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Nome do Cliente / Empresa</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ex: Pizzaria Forno a Lenha"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Plataforma Principal</Label>
                        <Select value={platform} onValueChange={(v: any) => setPlatform(v)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="meta">Meta Ads (Facebook/Instagram)</SelectItem>
                                <SelectItem value="google">Google Ads</SelectItem>
                                <SelectItem value="tiktok">TikTok Ads</SelectItem>
                                <SelectItem value="linkedin">LinkedIn Ads</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label>Observações Iniciais</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Objetivos, budget inicial, etc."
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancelar</Button>
                    </DialogClose>
                    <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700">Adicionar Cliente</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
