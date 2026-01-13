import { useState, useEffect } from "react";
import { Tool } from "@/types/tools";
import { useToolsStore } from "@/store/useToolsStore";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolRegistrationDialog } from "@/components/tools/ToolRegistrationDialog";
import { ToolLauncher } from "@/components/tools/ToolLauncher";
import { Wrench } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { PageHeader } from "@/components/ui/PageHeader";

export default function Ferramentas() {
  const { tools, fetchTools } = useToolsStore();
  const { user } = useAuthStore();
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);
  const [editingTool, setEditingTool] = useState<Tool | null>(null); // Estado da Edição
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleOpenTool = (tool: Tool) => {
    setSelectedTool(tool);
    setIsLauncherOpen(true);
  };

  const handleEditTool = (tool: Tool) => {
    setEditingTool(tool);
    setIsEditModalOpen(true);
  };

  return (
    <div className="w-full h-full flex flex-col p-6 md:p-8 space-y-6 animate-in fade-in duration-500">

      {/* Header Padronizado */}
      <PageHeader
        title="Ferramentas"
        description="Gestão e utilitários internos"
        icon={Wrench}
      >
        {/* Botão de Cadastro (Modo Novo) */}
        {user?.role === 'admin' && <ToolRegistrationDialog />}
      </PageHeader>

      {/* Conteúdo */}
      <div className="flex-1">
        {tools.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center border border-dashed border-white/10 rounded-xl bg-white/5 backdrop-blur-sm">
            <div className="p-4 rounded-full bg-white/5 mb-4">
              <Wrench className="w-8 h-8 text-zinc-500" />
            </div>
            <h3 className="text-lg font-medium text-zinc-300">Nenhuma ferramenta ativa</h3>
            <p className="text-zinc-500 max-w-sm mt-2 mb-6">
              O catálogo está vazio. {user?.role === 'admin' && "Cadastre sua primeira ferramenta."}
            </p>
            {user?.role === 'admin' && <ToolRegistrationDialog />}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {tools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                onOpen={handleOpenTool}
                onEdit={handleEditTool} // Passando a função
              />
            ))}
          </div>
        )}
      </div>

      {/* Launcher (Execução) */}
      <ToolLauncher
        tool={selectedTool}
        open={isLauncherOpen}
        onOpenChange={setIsLauncherOpen}
      />

      {/* Modal de Edição (Controlado pelo Pai) */}
      <ToolRegistrationDialog
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        toolToEdit={editingTool} // Passa os dados para preencher
      />

    </div>
  );
}