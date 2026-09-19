import { Database, Cloud, User, ShieldCheck, Upload, Trash2, MapPin, AlignLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ZAFIRA_VERSION } from '@/components/settings/constants';
import { useAuthStore } from '@/store/useAuthStore';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from 'react';

const PRESET_AVATARS = [
    '/avatars/avatar_preset_1_1768182784164.png',
    '/avatars/avatar_preset_2_1768182798188.png',
    '/avatars/avatar_preset_3_1768182810394.png',
    '/avatars/avatar_preset_4_1768182822035.png',
    '/avatars/avatar_preset_5_1768182834984.png',
    '/avatars/avatar_preset_6_1768182846535.png',
];

export default function Configuracoes() {
    const { user, uploadAvatar, updateProfile } = useAuthStore();
    const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);

    const handleRemoveAvatar = async () => {
        if (confirm('Tem certeza que deseja remover sua foto de perfil?')) {
            await updateProfile({ avatar: '' }); // Set to empty string or handle null in backend
        }
    };

    const handlePresetSelect = async (url: string) => {
        // Since these are local files, we can just save the path relative to public or full URL if needed.
        // Usually Supabase storage URLs are full URLs.
        // For local assets, we might need a way to distinguish.
        // Assuming updateProfile handles string URL fine.
        // However, user.avatar is expected to be a URL? 
        // Let's use the window.location.origin to verify if needed or just path.
        // The AvatarImage src works with root relative paths.
        await updateProfile({ avatar: url });
        setIsAvatarDialogOpen(false);
    }

    return (
        <div className="space-y-8 pb-10 fade-in">
            {/* Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
                    <Database className="h-8 w-8 text-primary" />
                    Configurações
                </h1>
                <p className="text-muted-foreground">
                    Gerencie sua conta e status do sistema.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Cloud Status */}
                <Card className="glass-panel border-white/10 md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Cloud className="h-5 w-5 text-emerald-400" />
                            Status da Nuvem
                        </CardTitle>
                        <CardDescription>
                            Seus dados estão seguros e sincronizados com a nuvem Zafira.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                            <ShieldCheck className="h-6 w-6 text-emerald-400" />
                            <div>
                                <p className="font-medium text-white">Sincronização Ativa</p>
                                <p className="text-sm text-emerald-400/80">Zafira HUB está sincronizada.</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* User Profile Info */}
                <Card className="glass-panel border-white/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-blue-400" />
                            Perfil do Usuário
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-start gap-6">
                            <div className="flex flex-col items-center gap-3">
                                <div className="relative group">
                                    <Avatar className="w-24 h-24 border-2 border-white/10 shadow-lg">
                                        <AvatarImage src={user?.avatar || undefined} className="object-cover" />
                                        <AvatarFallback className="text-2xl">{user?.name?.charAt(0)}</AvatarFallback>
                                    </Avatar>

                                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-full gap-2">
                                        <label htmlFor="avatar-upload" className="cursor-pointer p-2 hover:bg-white/20 rounded-full transition-colors" title="Upload Foto">
                                            <Upload className="w-5 h-5 text-white" />
                                        </label>
                                        <button onClick={() => setIsAvatarDialogOpen(true)} className="p-2 hover:bg-white/20 rounded-full transition-colors" title="Escolher Avatar">
                                            <User className="w-5 h-5 text-white" />
                                        </button>
                                        {user?.avatar && (
                                            <button onClick={handleRemoveAvatar} className="p-2 hover:bg-red-500/20 rounded-full transition-colors" title="Remover Foto">
                                                <Trash2 className="w-5 h-5 text-red-400" />
                                            </button>
                                        )}
                                    </div>

                                    <input
                                        id="avatar-upload"
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const url = await uploadAvatar(file);
                                                if (url) updateProfile({ avatar: url });
                                            }
                                        }}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">Clique para alterar</p>
                            </div>

                            <div className="flex-1 space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-zinc-400">Nome Completo</label>
                                    <Input
                                        value={user?.name || ''}
                                        onChange={(e) => updateProfile({ name: e.target.value })}
                                        className="bg-white/5 border-white/10"
                                        placeholder="Seu nome"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-zinc-400">Email</label>
                                    <Input
                                        value={user?.email || ''}
                                        readOnly
                                        className="bg-white/5 border-white/10 text-zinc-500 cursor-not-allowed"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 border-t border-white/5 pt-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                                    <MapPin className="w-3 h-3" /> Cidade / Região
                                </label>
                                <Input
                                    value={user?.city || ''}
                                    onChange={(e) => updateProfile({ city: e.target.value })}
                                    className="bg-white/5 border-white/10"
                                    placeholder="Ex: São Paulo, SP"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                                    <AlignLeft className="w-3 h-3" /> Bio / Sobre Mim
                                </label>
                                <Textarea
                                    value={user?.bio || ''}
                                    onChange={(e) => updateProfile({ bio: e.target.value })}
                                    className="bg-white/5 border-white/10 min-h-[80px] resize-none"
                                    placeholder="Fale um pouco sobre você..."
                                />
                            </div>
                        </div>

                        <div className="flex justify-between py-3 border-t border-white/5 bg-white/5 rounded-lg px-4 mt-4">
                            <div className="flex items-center gap-2">
                                <span className="text-zinc-400 text-xs font-medium">Cargo</span>
                                <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-300 bg-purple-500/10">
                                    {user?.role?.toUpperCase()}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-zinc-400 text-xs font-medium">Organização</span>
                                <span className="text-xs text-white font-medium">{user?.organizationId ? 'Corporativo' : 'Pessoal'}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>


                {/* APP INFO */}
                <div className="md:col-span-2 flex justify-center py-6">
                    <div className="text-center space-y-2">
                        <Badge variant="outline" className="border-white/10 text-muted-foreground">
                            Zafira Hub {ZAFIRA_VERSION}
                        </Badge>
                        <p className="text-xs text-white/20">
                            Versão Nuvem
                        </p>
                    </div>
                </div>

            </div>

            <Dialog open={isAvatarDialogOpen} onOpenChange={setIsAvatarDialogOpen}>
                <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-white">
                    <DialogHeader>
                        <DialogTitle>Escolher Avatar</DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="h-72 w-full p-4 rounded-md border border-zinc-800 bg-zinc-950/50">
                        <div className="grid grid-cols-3 gap-4">
                            {PRESET_AVATARS.map((avatar, index) => (
                                <button
                                    key={index}
                                    onClick={() => handlePresetSelect(avatar)}
                                    className="relative group rounded-full overflow-hidden border-2 border-transparent hover:border-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-zinc-900"
                                >
                                    <img src={avatar} alt={`Avatar Preset ${index + 1}`} className="w-full h-full object-cover" />
                                    {user?.avatar === avatar && (
                                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                                            <div className="w-3 h-3 bg-primary rounded-full" />
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
}