import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lead } from '@/types/crm';
import { useCRMStore } from '@/store/useCRMStore';
import { MessageCircle, Plus, Pencil, Trash2, X, Check, Smile } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface WhatsAppSenderDialogProps {
    isOpen: boolean;
    onClose: () => void;
    lead: Lead;
}

export function WhatsAppSenderDialog({ isOpen, onClose, lead }: WhatsAppSenderDialogProps) {
    const { addActivity, templates, fetchTemplates, createTemplate, updateTemplate, deleteTemplate } = useCRMStore();

    // Message State
    const [message, setMessage] = useState('');

    // CRUD Template State
    const [isManaging, setIsManaging] = useState(false);
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
    const [templateForm, setTemplateForm] = useState({ title: '', content: '' });

    // Emoji State (Shared picker or separate?)
    // Using Popover solves the positioning, so no need for complex state management if we use Radix Popover.
    // If we don't use Radix Popover, we can use simple conditional rendering.
    // Since we have shadcn Popover, let's use it.

    useEffect(() => {
        if (isOpen) {
            fetchTemplates();
            // Set default message (or empty)
            setMessage(formatMessage(`Olá {name}, tudo bem?`));
        }
    }, [isOpen]);

    const formatMessage = (rawText: string) => {
        return rawText.replace(/{name}/g, lead.name);
    };

    const handleSelectTemplate = (content: string) => {
        setMessage(formatMessage(content));
    };

    const handleSend = () => {
        if (!lead.phone) return;
        const cleanPhone = lead.phone.replace(/\D/g, '');
        const url = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;

        window.open(url, '_blank');
        addActivity(lead.id, 'whatsapp', `Iniciou conversa: "${message}"`);
        onClose();
    };

    const onEmojiClickComposer = (emojiData: EmojiClickData) => {
        setMessage(prev => prev + emojiData.emoji);
    };

    const onEmojiClickTemplate = (emojiData: EmojiClickData) => {
        setTemplateForm(prev => ({ ...prev, content: prev.content + emojiData.emoji }));
    };

    // --- CRUD Handlers ---

    const handleSaveTemplate = async () => {
        if (!templateForm.title || !templateForm.content) return;

        if (editingTemplateId) {
            await updateTemplate(editingTemplateId, templateForm.title, templateForm.content);
        } else {
            await createTemplate(templateForm.title, templateForm.content);
        }

        // Reset form
        setIsManaging(false);
        setEditingTemplateId(null);
        setTemplateForm({ title: '', content: '' });
    };

    const startEdit = (t: any) => {
        setIsManaging(true);
        setEditingTemplateId(t.id);
        setTemplateForm({ title: t.title, content: t.content });
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Tem certeza que deseja excluir este modelo?')) {
            await deleteTemplate(id);
        }
    };

    const cancelEdit = () => {
        setIsManaging(false);
        setEditingTemplateId(null);
        setTemplateForm({ title: '', content: '' });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800 text-zinc-100">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-emerald-500" />
                        Enviar WhatsApp para {lead.name}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex gap-6 h-[500px]">
                    {/* Left: Templates List */}
                    <div className="w-1/3 flex flex-col border-r border-white/10 pr-4">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-sm font-medium text-zinc-400">Modelos</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setIsManaging(!isManaging)}
                                className="h-6 w-6 p-0 hover:bg-zinc-800"
                            >
                                {isManaging ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                            </Button>
                        </div>

                        {isManaging ? (
                            <div className="flex flex-col gap-3 animate-in fade-in h-full">
                                <div className="space-y-2">
                                    <Label className="text-xs">Título</Label>
                                    <Input
                                        value={templateForm.title}
                                        onChange={e => setTemplateForm({ ...templateForm, title: e.target.value })}
                                        className="h-8 bg-zinc-900 border-zinc-700"
                                    />
                                </div>
                                <div className="space-y-2 flex-1 flex flex-col">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-xs">Mensagem ({'{name}'} = Nome)</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button size="icon" variant="ghost" className="h-6 w-6">
                                                    <Smile className="w-4 h-4 text-zinc-400 hover:text-yellow-400" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0 border-none">
                                                <EmojiPicker
                                                    theme={Theme.DARK}
                                                    onEmojiClick={onEmojiClickTemplate}
                                                    skinTonesDisabled
                                                    searchDisabled
                                                    width={300}
                                                    height={300}
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                    <Textarea
                                        value={templateForm.content}
                                        onChange={e => setTemplateForm({ ...templateForm, content: e.target.value })}
                                        className="flex-1 bg-zinc-900 border-zinc-700 text-xs resize-none"
                                    />
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleSaveTemplate}>
                                        <Check className="w-3 h-3 mr-1" /> Salvar
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                        Voltar
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <ScrollArea className="flex-1 -mr-2 pr-2">
                                <div className="space-y-2">
                                    {templates.map(t => (
                                        <div
                                            key={t.id}
                                            onClick={() => handleSelectTemplate(t.content)}
                                            className="group relative p-3 rounded-lg bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 cursor-pointer transition-all hover:border-emerald-500/30"
                                        >
                                            <div className="font-medium text-sm text-zinc-200">{t.title}</div>
                                            <div className="text-xs text-zinc-500 line-clamp-2 mt-1">{t.content}</div>

                                            <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEdit(t); }}
                                                    className="p-1 hover:bg-zinc-700 rounded"
                                                >
                                                    <Pencil className="w-3 h-3 text-zinc-400" />
                                                </button>
                                                <button
                                                    onClick={(e) => handleDelete(t.id, e)}
                                                    className="p-1 hover:bg-red-900/30 rounded"
                                                >
                                                    <Trash2 className="w-3 h-3 text-red-400" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {templates.length === 0 && (
                                        <div className="text-center py-8 text-zinc-600 text-sm">
                                            Nenhum modelo criado
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        )}
                    </div>

                    {/* Right: Composer */}
                    <div className="flex-1 flex flex-col gap-4">
                        <div className="flex-1 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <Label>Sua Mensagem</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button size="icon" variant="ghost" className="h-6 w-6">
                                            <Smile className="w-4 h-4 text-zinc-400 hover:text-yellow-400" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 border-none" align="end">
                                        <EmojiPicker
                                            theme={Theme.DARK}
                                            onEmojiClick={onEmojiClickComposer}
                                            skinTonesDisabled
                                            width={320}
                                            height={350}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <Textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                className="flex-1 bg-zinc-900 border-zinc-700 text-base resize-none focus-visible:ring-emerald-500/50"
                                placeholder="Digite sua mensagem ou selecione um modelo..."
                            />
                        </div>
                        <div className="bg-emerald-950/20 p-3 rounded border border-emerald-900/30 text-emerald-400 text-sm flex items-start gap-2">
                            <MessageCircle className="w-4 h-4 mt-0.5" />
                            <div>
                                <span className="font-bold">Preview:</span> <span className="text-emerald-300/80 italic">{message || '...'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={handleSend}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                        disabled={!message.trim()}
                    >
                        Abrir WhatsApp
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
