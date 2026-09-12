import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, Mail, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/useAuthStore';

const Login = () => {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    // Rota de destino após autenticação
    const from = location.state?.from?.pathname || '/';

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await useAuthStore.getState().login({
                email,
                password,
            });

            toast.success('Bem-vindo ao Zafira Hub 2.0!');
            const target = from === '/login' ? '/' : from;
            navigate(target, { replace: true });
        } catch (error: any) {
            console.error('Erro de login:', error);
            const msg = error?.data?.message || error?.message || 'Credenciais inválidas. Verifique seu e-mail e senha.';
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
            {/* Elementos visuais de fundo */}
            <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-purple-500/10 blur-[100px] animate-pulse delay-1000" />

            <Card className="w-full max-w-md border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl relative z-10 animate-in fade-in zoom-in duration-500">
                <CardHeader className="space-y-2 text-center">
                    <div className="mx-auto w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mb-2 group">
                        <Lock className="w-6 h-6 text-primary group-hover:scale-110 transition-transform duration-300" />
                    </div>
                    <CardTitle className="text-2xl font-bold tracking-tight">Zafira Hub 2.0</CardTitle>
                    <CardDescription>
                        Acesse seu painel corporativo com suas credenciais seguras
                    </CardDescription>
                </CardHeader>
                <form onSubmit={handleAuth}>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">E-mail corporativo</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="seu.email@zafira.com.br"
                                    className="pl-9 bg-white/5 border-white/10 focus:border-primary/50 transition-colors"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="username"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">Senha</Label>
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    className="pl-9 bg-white/5 border-white/10 focus:border-primary/50 transition-colors"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoComplete="current-password"
                                />
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-4">
                        <Button
                            className="w-full h-11 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all duration-300 hover:scale-[1.02]"
                            type="submit"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Autenticando...
                                </>
                            ) : (
                                <>
                                    Entrar no Hub
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </>
                            )}
                        </Button>
                        <div className="text-center text-xs text-muted-foreground">
                            Acesso seguro e restrito a colaboradores autorizados da Zafira.
                        </div>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
};

export default Login;
