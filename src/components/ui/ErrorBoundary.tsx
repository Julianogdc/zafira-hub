import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorFallbackProps {
    error: Error;
    resetErrorBoundary: () => void;
}

function ErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
    return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background text-foreground animate-in fade-in duration-300">
            <div className="rounded-full bg-rose-500/10 p-4">
                <AlertTriangle className="h-10 w-10 text-rose-500" />
            </div>
            <div className="text-center space-y-2 max-w-md px-4">
                <h2 className="text-2xl font-bold tracking-tight">Ops, algo deu errado!</h2>
                <p className="text-sm text-zinc-400">
                    Encontramos um erro inesperado ao processar sua solicitação.
                </p>
                <div className="rounded-md bg-zinc-950/50 p-4 mt-4 border border-zinc-800 text-left overflow-auto max-h-32">
                    <code className="text-xs text-rose-300 font-mono break-all">
                        {error.message || "Erro desconhecido"}
                    </code>
                </div>
            </div>
            <div className="mt-6 flex gap-2">
                <Button variant="outline" onClick={() => window.location.reload()}>
                    Recarregar Página
                </Button>
                <Button
                    onClick={resetErrorBoundary}
                    className="gap-2 bg-rose-600 hover:bg-rose-700 text-white"
                >
                    <RotateCcw className="h-4 w-4" />
                    Tentar Novamente
                </Button>
            </div>
        </div>
    );
}

export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
    return (
        <ReactErrorBoundary
            FallbackComponent={ErrorFallback}
            onReset={() => {
                // Reset global state if needed, or just redirect
                window.location.href = "/";
            }}
        >
            {children}
        </ReactErrorBoundary>
    );
}
