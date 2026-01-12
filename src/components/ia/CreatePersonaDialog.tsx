import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAIStore } from '@/store/useAIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { Bot, PenTool, Search, Briefcase, Code, BarChart, MessageSquare, Zap, Heart } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

interface CreatePersonaDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ICONS = [
    { value: 'Bot', icon: Bot, label: 'Robô' },
    { value: 'PenTool', icon: PenTool, label: 'Caneta' },
    { value: 'Search', icon: Search, label: 'Lupa' },
    { value: 'Briefcase', icon: Briefcase, label: 'Maleta' },
    { value: 'Code', icon: Code, label: 'Código' },
    { value: 'BarChart', icon: BarChart, label: 'Gráfico' },
    { value: 'MessageSquare', icon: MessageSquare, label: 'Chat' },
    { value: 'Zap', icon: Zap, label: 'Raio' },
    { value: 'Heart', icon: Heart, label: 'Coração' },
];

export function CreatePersonaDialog({ open, onOpenChange }: CreatePersonaDialogProps) {
    const { createPersona } = useAIStore();
    const { user } = useAuthStore();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        role: '',
        description: '',
        systemPrompt: '',
        icon: 'Bot',
        visibility: 'private'
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.role || !formData.systemPrompt) return;

        setLoading(true);
        try {
            await createPersona({
                name: formData.name,
                role: formData.role,
                description: formData.description,
                systemPrompt: formData.systemPrompt,
                icon: formData.icon,
                visibility: formData.visibility as 'private' | 'public'
            });

            toast({
                title: "Agente criado com sucesso!",
                description: `O agente "${formData.name}" já está disponível.`,
                className: "bg-emerald-500 border-none text-white",
            });

            onOpenChange(false);
            setFormData({
                name: '',
                role: '',
                description: '',
                systemPrompt: '',
                icon: 'Bot',
                visibility: 'private'
            });
        } catch (error) {
            console.error(error);
            toast({
                title: "Erro ao criar agente",
                description: "Verifique se a tabela 'ai_personas' existe no Supabase (SQL_PERSONAS.sql).",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] bg-zinc-950 border-zinc-800 text-zinc-100">
                <DialogHeader>
                    <DialogTitle>Criar Novo Agente</DialogTitle>
                    <DialogDescription>
                        Personalize um especialista de IA para ajudar nas suas tarefas.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nome do Agente</Label>
                            <Input
                                placeholder="Ex: Expert em Instagram"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Função (Subtítulo)</Label>
                            <Input
                                placeholder="Ex: Criador de ideias para Stories"
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Ícone</Label>
                        <div className="flex flex-wrap gap-2 p-2 bg-zinc-900 rounded-md border border-zinc-800">
                            {ICONS.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.value}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, icon: item.value })}
                                        className={`p-2 rounded-md transition-all ${formData.icon === item.value
                                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
                                            : 'hover:bg-zinc-800 text-zinc-400'
                                            }`}
                                        title={item.label}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Instrução Principal (System Prompt)</Label>
                        <Textarea
                            placeholder="Descreva como este agente deve se comportar, o que ele sabe e como deve responder..."
                            value={formData.systemPrompt}
                            onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                            className="bg-zinc-900 border-zinc-800 min-h-[150px]"
                            required
                        />
                    </div>

                    {user?.role === 'admin' && (
                        <div className="space-y-2">
                            <Label>Visibilidade</Label>
                            <Select
                                value={formData.visibility}
                                onValueChange={(v) => setFormData({ ...formData, visibility: v })}
                            >
                                <SelectTrigger className="bg-zinc-900 border-zinc-800">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-800">
                                    <SelectItem value="private">Privado (Só eu)</SelectItem>
                                    <SelectItem value="public">Público (Toda a Organização)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="bg-purple-600 hover:bg-purple-500 text-white"
                        >
                            {loading ? 'Criando...' : 'Criar Agente'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
