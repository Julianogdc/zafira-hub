import { useState } from 'react';
import { useClientStore } from '../../store/useClientStore';
import { usePerformanceStore } from '../../store/usePerformanceStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

export function AddPerformanceClientDialog() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const { clients } = useClientStore();
    const { trackedClientIds, addTrackedClient } = usePerformanceStore();

    const availableClients = clients.filter(c =>
        c.status === 'active' &&
        !trackedClientIds.includes(c.id) &&
        c.name.toLowerCase().includes(search.toLowerCase())
    );

    const handleAdd = async (clientId: string, name: string) => {
        try {
            await addTrackedClient(clientId);
            toast.success(`${name} adicionado ao módulo de Performance`);
            setOpen(false);
        } catch (error: any) {
            toast.error(`Erro ao adicionar cliente: ${error.message}`);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full gap-2 border-dashed border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5">
                    <Plus className="h-4 w-4" />
                    Adicionar Cliente
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5 text-purple-500" />
                        Habilitar Performance
                    </DialogTitle>
                    <DialogDescription>
                        Selecione um cliente ativo para gerenciar o tráfego pago e métricas.
                    </DialogDescription>
                </DialogHeader>

                <div className="relative mt-2">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        placeholder="Buscar cliente..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-background border rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                </div>

                <ScrollArea className="mt-4 max-h-[300px] pr-4">
                    <div className="space-y-2">
                        {availableClients.length === 0 ? (
                            <p className="text-center py-6 text-sm text-muted-foreground">
                                {search ? "Nenhum cliente encontrado." : "Não há clientes ativos disponíveis."}
                            </p>
                        ) : (
                            availableClients.map((client) => (
                                <div
                                    key={client.id}
                                    className="flex items-center justify-between p-3 rounded-lg border bg-accent/30 hover:bg-accent/50 transition-colors"
                                >
                                    <span className="text-sm font-medium">{client.name}</span>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 text-purple-500 hover:text-purple-400 hover:bg-purple-500/10"
                                        onClick={() => handleAdd(client.id, client.name)}
                                    >
                                        Adicionar
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
