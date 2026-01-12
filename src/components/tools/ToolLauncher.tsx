import { useEffect } from "react";
import { Tool } from "@/types/tools";
import { useToolsStore } from "@/store/useToolsStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ExternalLink, Zap, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ToolLauncherProps {
  tool: Tool | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ToolLauncher({ tool, open, onOpenChange }: ToolLauncherProps) {
  const { logUsage } = useToolsStore();

  // Registra o uso automaticamente ao abrir a ferramenta
  useEffect(() => {
    if (open && tool) {
      logUsage({
        toolId: tool.id,
        toolName: tool.name,
        status: 'success',
        message: 'Sessão iniciada pelo usuário'
      });
    }
  }, [open, tool, logUsage]);

  if (!tool) return null;

  // Decide o que renderizar dentro do Drawer
  const renderContent = () => {
    switch (tool.type) {
      case 'iframe':
        return (
          <div className="w-full h-full min-h-[500px] rounded-lg overflow-hidden border border-zinc-800 bg-white">
            <iframe
              src={tool.source}
              className="w-full h-full"
              title={tool.name}
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
            />
          </div>
        );
      
      case 'link_external':
        return (
          <div className="flex flex-col items-center justify-center h-[60vh] space-y-6 text-center">
            <div className="bg-emerald-500/10 p-8 rounded-full ring-1 ring-emerald-500/20">
              <ExternalLink className="w-16 h-16 text-emerald-400" />
            </div>
            <div className="space-y-2 max-w-md">
              <h3 className="text-2xl font-medium text-white">Acesso Externo</h3>
              <p className="text-zinc-400">
                A ferramenta <strong>{tool.name}</strong> é hospedada em um ambiente externo seguro.
              </p>
            </div>
            <Button 
              size="lg" 
              className="bg-emerald-500 hover:bg-emerald-600 text-white min-w-[200px]"
              onClick={() => window.open(tool.source, '_blank')}
            >
              Acessar Agora <ExternalLink className="ml-2 w-4 h-4" />
            </Button>
          </div>
        );

      case 'webhook':
        return (
          <div className="flex flex-col items-center justify-center h-[60vh] space-y-6 max-w-lg mx-auto">
             <Alert className="border-purple-500/20 bg-purple-500/10 text-purple-200">
              <Zap className="h-4 w-4" />
              <AlertTitle>Disparador de Automação</AlertTitle>
              <AlertDescription>
                Esta ferramenta dispara um webhook para: <code className="bg-black/30 px-1 rounded">{tool.source}</code>
              </AlertDescription>
            </Alert>
            <Button 
              size="lg" 
              variant="outline"
              className="border-zinc-700 hover:bg-zinc-800 hover:text-white"
              onClick={() => {
                alert(`[SIMULAÇÃO] POST enviado para: ${tool.source}`);
              }}
            >
              Executar Disparo
            </Button>
          </div>
        );

      case 'component':
        return (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/50">
            <Terminal className="w-10 h-10 text-zinc-600 mb-4" />
            <p className="text-zinc-400 text-lg">Componente Interno</p>
            <p className="text-sm text-zinc-500 font-mono mt-1">Ref: {tool.source}</p>
            <p className="text-xs text-zinc-600 mt-4 max-w-xs">
              (Em um cenário real, aqui usaríamos um Map de componentes para renderizar o componente React correspondente à string de referência)
            </p>
          </div>
        );

      default:
        return <div className="p-10 text-center text-zinc-500">Tipo de ferramenta não suportado.</div>;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] bg-zinc-950 border-t-zinc-800 p-0 flex flex-col focus:outline-none">
        <SheetHeader className="px-8 py-6 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-2xl font-light text-white flex items-center gap-3">
                {tool.name}
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded">
                  {tool.type}
                </span>
              </SheetTitle>
              <SheetDescription className="text-zinc-400 mt-1">
                {tool.description}
              </SheetDescription>
            </div>
            {/* Espaço reservado para ações de topo se necessário */}
          </div>
        </SheetHeader>
        
        <div className="flex-1 overflow-auto p-8 bg-black/40">
          {renderContent()}
        </div>
      </SheetContent>
    </Sheet>
  );
}