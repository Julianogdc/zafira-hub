import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAIStore } from '@/store/useAIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { Bot, PenTool, Search, Briefcase, Code, BarChart, MessageSquare, Zap, Heart, AlertTriangle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { AIPersona } from '@/types/ai';

interface EditPersonaDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    persona: AIPersona;
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

export function EditPersonaDialog({ open, onOpenChange, persona }: EditPersonaDialogProps) {
    const { updatePersona } = useAIStore();
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

    // Populate form on open
    useEffect(() => {
        if (persona && open) {
            setFormData({
                name: persona.name,
                role: persona.role,
                description: persona.description || '',
                systemPrompt: persona.systemPrompt,
                icon: typeof persona.icon === 'string' ? persona.icon : 'Bot',
                visibility: persona.visibility || 'private'
            });
        }
    }, [persona, open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.role || !formData.systemPrompt) return;

        setLoading(true);
        try {
            await updatePersona(persona.id, {
                name: formData.name,
                role: formData.role,
                description: formData.description,
                systemPrompt: formData.systemPrompt,
                icon: formData.icon,
                visibility: formData.visibility as 'private' | 'public'
            });

            toast({
                title: "Agente atualizado!",
                description: "As alterações foram salvas com sucesso.",
                className: "bg-emerald-500 border-none text-white",
            });

            onOpenChange(false);
        } catch (error) {
            console.error(error);
            toast({
                title: "Erro ao salvar",
                description: "Não foi possível atualizar o agente.",
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
                    <DialogTitle>Editar Agente</DialogTitle>
                    <DialogDescription>
                        Faça ajustes no comportamento, nome ou visibilidade do agente.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nome</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Função</Label>
                            <Input
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
                        <Label>System Prompt (Cérebro do Agente)</Label>
                        <Textarea
                            value={formData.systemPrompt}
                            onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                            className="bg-zinc-900 border-zinc-800 min-h-[150px]"
                            required
                        />
                    </div>

                    {/* Visibility Logic: Admin OR User who owns it */}
                    {(user?.role === 'admin' || user?.id === persona.created_by) && (
                        <div className="space-y-2 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                            <Label className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                Visibilidade & Compartilhamento
                            </Label>

                            <Select
                                value={formData.visibility}
                                onValueChange={(v) => setFormData({ ...formData, visibility: v })}
                            >
                                <SelectTrigger className="bg-zinc-900 border-zinc-800">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-800">
                                    <SelectItem value="private">🔒 Privado (Apenas Eu)</SelectItem>
                                    <SelectItem value="public">🌍 Público (Toda a Organização)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-zinc-500 mt-1">
                                {formData.visibility === 'public'
                                    ? "Este agente ficará visível para todos os membros da sua organização."
                                    : "Apenas você poderá ver e usar este agente."}
                            </p>
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
                            {loading ? 'Salvar Alterações' : 'Salvar Alterações'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
