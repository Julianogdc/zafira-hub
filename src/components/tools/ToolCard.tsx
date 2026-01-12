import { Tool } from "@/types/tools";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Play, Rocket, Settings2, Code, Terminal, Pencil } from "lucide-react";

interface ToolCardProps {
  tool: Tool;
  onOpen: (tool: Tool) => void;
  onEdit: (tool: Tool) => void; // Nova Prop
}

export const ToolCard = ({ tool, onOpen, onEdit }: ToolCardProps) => {
  
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'development': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getIcon = () => {
    switch (tool.type) {
      case 'link_external': return <ExternalLink className="w-5 h-5 group-hover:text-purple-400 transition-colors" />;
      case 'webhook': return <Rocket className="w-5 h-5 group-hover:text-purple-400 transition-colors" />;
      case 'component': return <Terminal className="w-5 h-5 group-hover:text-purple-400 transition-colors" />;
      default: return <Settings2 className="w-5 h-5 group-hover:text-purple-400 transition-colors" />;
    }
  };

  return (
    <Card className="
      bg-white/5 border-white/10 backdrop-blur-sm 
      transition-all duration-300 group
      hover:border-purple-500/50 
      hover:shadow-[0_0_30px_-5px_rgba(168,85,247,0.3)]
      flex flex-col justify-between relative
    ">
      {/* Botão de Editar (Pequeno e discreto no topo) */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 bg-black/40 hover:bg-purple-500 hover:text-white text-zinc-400 rounded-full"
          onClick={(e) => {
            e.stopPropagation(); // Evita abrir o card
            onEdit(tool);
          }}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      </div>

      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="p-2 rounded-md bg-white/5 border border-white/5 mb-3 group-hover:bg-purple-500/20 group-hover:border-purple-500/30 transition-all duration-300">
            {getIcon()}
          </div>
          <Badge variant="outline" className={`${getStatusStyle(tool.status)} capitalize`}>
            {tool.status === 'development' ? 'Em Dev' : tool.status}
          </Badge>
        </div>
        <CardTitle className="text-lg font-medium text-white group-hover:text-purple-400 transition-colors">
          {tool.name}
        </CardTitle>
        <CardDescription className="line-clamp-2 text-slate-400 text-sm">
          {tool.description}
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="text-xs text-slate-500 font-mono flex gap-2 items-center">
          <Code className="w-3 h-3" />
          {tool.category}
        </div>
      </CardContent>

      <CardFooter className="pt-0">
        <Button 
          className="w-full bg-white/5 text-zinc-300 hover:bg-purple-500 hover:text-white border border-white/10 hover:border-purple-400 transition-all duration-300"
          onClick={() => onOpen(tool)}
          disabled={tool.status === 'inactive'}
        >
          {tool.status === 'inactive' ? 'Indisponível' : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Abrir
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};