import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Sparkles, CheckCircle2, Zap } from "lucide-react";

export function NewModuleModal() {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const VERSION_KEY = "zafira_news_v1";

    useEffect(() => {
        const hasSeenNews = localStorage.getItem(VERSION_KEY);
        if (!hasSeenNews) {
            // Small delay to ensure smoother entrance after login
            const timer = setTimeout(() => setOpen(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleClose = () => {
        setOpen(false);
        localStorage.setItem(VERSION_KEY, "true");
    };

    const handleNavigate = () => {
        handleClose();
        navigate("/performance");
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[500px] border-zinc-800 bg-zinc-950/95 backdrop-blur-xl">
                <DialogHeader>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 border border-purple-500/20">
                            <Sparkles className="h-4 w-4" />
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">Novidade</span>
                    </div>
                    <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                        Novo Módulo: Performance
                    </DialogTitle>
                    <DialogDescription className="text-zinc-400 pt-2">
                        Acabamos de lançar uma nova área dedicada à análise de dados e KPIs do seu negócio.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50  hover:border-purple-500/20 transition-colors">
                        <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                            <Zap className="h-4 w-4 text-amber-400" />
                            Melhorias desta versão
                        </h4>
                        <ul className="space-y-2.5">
                            <li className="flex items-start gap-2 text-sm text-zinc-400">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500/70 mt-0.5 shrink-0" />
                                <span>Correção no Login (tela duplicada)</span>
                            </li>
                            <li className="flex items-start gap-2 text-sm text-zinc-400">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500/70 mt-0.5 shrink-0" />
                                <span>Melhorias no fluxo de cadastro de clientes</span>
                            </li>
                            <li className="flex items-start gap-2 text-sm text-zinc-400">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500/70 mt-0.5 shrink-0" />
                                <span>Otimizações gerais de performance</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={handleClose} className="border-zinc-800 hover:bg-zinc-800 text-zinc-300">
                        Fechar
                    </Button>
                    <Button onClick={handleNavigate} className="bg-purple-600 hover:bg-purple-700 text-white font-medium">
                        Conhecer Performance
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
