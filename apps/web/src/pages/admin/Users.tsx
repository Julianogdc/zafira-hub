import { useEffect, useState } from 'react';
import { useAdminStore } from '@/store/useAdminStore';
import { useAuthStore } from '@/store/useAuthStore';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Shield, User as UserIcon, AlertCircle, Search, MoreVertical, Trash2, Ban, CheckCircle2, Briefcase, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function AdminUsers() {
    const { users, fetchUsers, loading, updateUserStatus, updateUserRole, deleteUser } = useAdminStore();
    const { user: currentUser } = useAuthStore();
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    // Filter Logic
    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // KPIs
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'active').length;
    const suspendedUsers = users.filter(u => u.status === 'suspended').length;

    // Calculate "Online Now" (active in last 15 mins)
    const onlineThreshold = new Date(Date.now() - 15 * 60 * 1000);
    const onlineUsers = users.filter(u => u.lastSeen && new Date(u.lastSeen) > onlineThreshold).length;


    const handleStatusChange = async (userId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
        await updateUserStatus(userId, newStatus);
    };

    const handleDelete = async (userId: string) => {
        if (confirm('Tem certeza? Isso irá suspender permanentemente o acesso deste usuário.')) {
            await deleteUser(userId);
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 p-6">
            <PageHeader
                title="Administração de Usuários"
                description="Gestão centralizada de acesso e monitoramento."
                icon={Shield}
            />

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-zinc-950/50 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-zinc-400">Total de Usuários</CardTitle>
                        <UserIcon className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{totalUsers}</div>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-950/50 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-zinc-400">Ativos</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{activeUsers}</div>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-950/50 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-zinc-400">Suspensos</CardTitle>
                        <AlertCircle className="h-4 w-4 text-rose-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{suspendedUsers}</div>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-950/50 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-zinc-400">Online Agora</CardTitle>
                        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{onlineUsers}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Table */}
            <Card className="bg-zinc-950/50 border-white/10">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Usuários da Plataforma</CardTitle>
                            <CardDescription>Visualize o status e última atividade de cada membro.</CardDescription>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
                            <Input
                                placeholder="Buscar usuários..."
                                className="pl-8 bg-black/20 border-white/10"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead className="text-zinc-400">Usuário</TableHead>
                                <TableHead className="text-zinc-400">Role</TableHead>
                                <TableHead className="text-zinc-400">Status</TableHead>
                                <TableHead className="text-zinc-400">Visto por último</TableHead>
                                <TableHead className="text-right text-zinc-400">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredUsers.map((u) => (
                                <TableRow key={u.id} className="border-white/5 hover:bg-white/5 data-[current=true]:bg-emerald-500/5" data-current={u.id === currentUser?.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-9 w-9 border border-white/10">
                                                <AvatarImage src={u.avatar} />
                                                <AvatarFallback>{u.name.charAt(0).toUpperCase()}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-white text-sm">{u.name} {u.id === currentUser?.id && '(Você)'}</span>
                                                <span className="text-xs text-zinc-500">{u.email}</span>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`
                                            capitalize border-white/10
                                            ${u.role === 'admin' ? 'text-purple-400 bg-purple-400/10' : 'text-zinc-400'}
                                        `}>
                                            {u.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`
                                            capitalize border-white/10
                                            ${u.status === 'active' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'}
                                        `}>
                                            {u.status === 'active' ? 'Ativo' : 'Suspenso'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-xs text-zinc-400">
                                            {u.lastSeen ? formatDistanceToNow(new Date(u.lastSeen), { addSuffix: true, locale: ptBR }) : 'Nunca'}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild disabled={u.id === currentUser?.id}>
                                                <Button variant="ghost" className="h-8 w-8 p-0 text-zinc-400 hover:text-white">
                                                    <span className="sr-only">Abrir menu</span>
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10">
                                                <DropdownMenuLabel>Ações</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => handleStatusChange(u.id, u.status || 'active')}>
                                                    {u.status === 'active' ? (
                                                        <>
                                                            <Ban className="mr-2 h-4 w-4 text-rose-500" />
                                                            <span>Suspender Acesso</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                                                            <span>Reativar Acesso</span>
                                                        </>
                                                    )}
                                                </DropdownMenuItem>
                                                <DropdownMenuSub>
                                                    <DropdownMenuSubTrigger>
                                                        <UserPlus className="mr-2 h-4 w-4" />
                                                        <span>Alterar Cargo</span>
                                                    </DropdownMenuSubTrigger>
                                                    <DropdownMenuSubContent className="bg-zinc-950 border-white/10 text-white">
                                                        <DropdownMenuItem onClick={() => updateUserRole(u.id, 'admin')} disabled={u.role === 'admin'}>
                                                            <Shield className="mr-2 h-4 w-4 text-purple-500" />
                                                            <span>Tornar Admin</span>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => updateUserRole(u.id, 'manager')} disabled={u.role === 'manager'}>
                                                            <Briefcase className="mr-2 h-4 w-4 text-emerald-500" />
                                                            <span>Tornar Sócio (Manager)</span>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => updateUserRole(u.id, 'member')} disabled={u.role === 'member'}>
                                                            <UserIcon className="mr-2 h-4 w-4 text-zinc-500" />
                                                            <span>Tornar Membro</span>
                                                        </DropdownMenuItem>
                                                    </DropdownMenuSubContent>
                                                </DropdownMenuSub>
                                                <DropdownMenuSeparator className="bg-white/10" />
                                                <DropdownMenuItem onClick={() => handleDelete(u.id)} className="text-rose-500 focus:text-rose-500">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    <span>Excluir Usuário</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
