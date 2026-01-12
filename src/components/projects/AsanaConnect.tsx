import { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, Loader2, Briefcase } from "lucide-react";
import { toast } from "sonner"; // Assuming sonner is used, or generic toast
import { asanaService } from "@/lib/asana-service";

export function AsanaConnect() {
    const { user, updateProfile } = useAuthStore();
    const [token, setToken] = useState(user?.asanaAccessToken || "");
    const [manualCode, setManualCode] = useState("");
    const [isWaitingCode, setIsWaitingCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAuthClick = async () => {
        setIsWaitingCode(true);
        // Add listener for popup message
        const handleMessage = async (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data.type === 'ASANA_AUTH_CODE' && event.data.code) {
                window.removeEventListener('message', handleMessage);
                await performExchange(event.data.code);
            } else if (event.data.type === 'ASANA_AUTH_ERROR') {
                toast.error(`Erro: ${event.data.error}`);
                window.removeEventListener('message', handleMessage);
                setIsWaitingCode(false);
            }
        };
        window.addEventListener('message', handleMessage);

        await asanaService.initiateAuth();
    };

    const performExchange = async (code: string) => {
        setLoading(true);
        try {
            const data = await asanaService.exchangeCode(code);
            if (!data.access_token) throw new Error("Sem token na resposta.");

            await updateProfile({
                asanaAccessToken: data.access_token,
                asanaRefreshToken: data.refresh_token
            });
            toast.success("Conectado com sucesso!");
            setIsWaitingCode(false);
        } catch (error: any) {
            const msg = error?.response?.data?.error_description || error?.message || "Erro desconhecido";
            toast.error(`Falha ao conectar: ${msg}`);
            setIsWaitingCode(false);
        } finally {
            setLoading(false);
        }
    };

    // Manual fallback still optional but UI can be simplified
    const handleCodeSubmit = () => performExchange(manualCode);

    const handleSavePAT = async () => {
        if (!token.trim()) return;
        setLoading(true);
        setError(null);

        try {
            await updateProfile({ asanaAccessToken: token });
            // Now verify
            try {
                await asanaService.getMe();
                toast.success("Conexão com Asana estabelecida com sucesso!");
            } catch (e) {
                throw new Error("Token inválido ou erro de conexão.");
            }

        } catch (err) {
            setError("Falha ao conectar. Verifique seu token.");
            toast.error("Erro ao validar token do Asana");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDisconnect = async () => {
        setLoading(true);
        try {
            await updateProfile({ asanaAccessToken: "" }); // Clear it
            setToken("");
            setIsWaitingCode(false);
            setManualCode("");
            toast.success("Conta desconectada.");
        } catch (e) {
            toast.error("Erro ao desconectar.");
        } finally {
            setLoading(false);
        }
    }

    const isConnected = !!user?.asanaAccessToken;

    return (
        <Card className="w-full max-w-md mx-auto mt-10 shadow-lg border-indigo-100">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <CardTitle>Integração Asana</CardTitle>
                    {isConnected && <CheckCircle2 className="text-green-500 w-5 h-5" />}
                </div>
                <CardDescription>
                    Gerencie seus projetos e tarefas diretamente do Zafira Hub.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {isConnected ? (
                    <div className="p-4 bg-green-50 rounded-lg border border-green-100 flex items-center gap-3">
                        <div className="bg-green-100 p-2 rounded-full">
                            <CheckCircle2 className="text-green-600 w-6 h-6" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-green-800">Conectado</h4>
                            <p className="text-green-600 text-sm">Sincronização ativa.</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {!isWaitingCode ? (
                            <Button
                                onClick={handleAuthClick}
                                className="w-full bg-[#FCBD01] hover:bg-[#e6ac00] text-black font-semibold h-12"
                            >
                                <Briefcase className="w-5 h-5 mr-2" />
                                Conectar com Asana (Recomendado)
                            </Button>
                        ) : (
                            <div className="space-y-2 anim-in fade-in slide-in-from-top-2">
                                <p className="text-sm font-medium text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
                                    Uma janela se abriu. Autorize o App, copie o código exibido na tela e cole abaixo:
                                </p>
                                <Label>Código de Autorização</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={manualCode}
                                        onChange={e => setManualCode(e.target.value)}
                                        placeholder="Cole o código aqui..."
                                    />
                                    <Button onClick={handleCodeSubmit} disabled={loading || !manualCode}>
                                        {loading && <Loader2 className="animate-spin w-4 h-4" />}
                                        Validar
                                    </Button>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setIsWaitingCode(false)} className="text-xs text-muted-foreground">
                                    Cancelar
                                </Button>
                            </div>
                        )}

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                            <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Ou use Token (Avançado)</span></div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="token">Personal Access Token (PAT)</Label>
                            <Input
                                id="token"
                                placeholder="1/123456789..."
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                type="password"
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Para gerar um token, vá em Asana &gt; Minhas Configurações &gt; Apps &gt; Gerenciar tokens de desenvolvedor.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-2 rounded">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

            </CardContent>
            <CardFooter className="flex justify-between">
                {isConnected ? (
                    <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Desconectar
                    </Button>
                ) : (
                    <Button onClick={handleSavePAT} disabled={loading || !token} className="w-full bg-[#F06A6A] hover:bg-[#d95a5a]">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Conectar via Token
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}
