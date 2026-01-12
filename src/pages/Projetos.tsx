
import { useState } from "react";
import { MyTasksList } from "../components/projects/MyTaskList";
import { ProjectsSidebar } from "../components/projects/ProjectsSidebar";
import { AsanaConnect } from "@/components/projects/AsanaConnect";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuthStore } from "@/store/useAuthStore";
import { Button } from "@/components/ui/button";
import { Briefcase } from "lucide-react";

export default function Projetos() {
  const { user } = useAuthStore();
  const [selectedView, setSelectedView] = useState<string>('my_tasks');
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>("default");
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  // Splash Screen if not connected
  if (!user?.asanaAccessToken) {
    return (
      <div className="flex flex-col h-full items-center justify-center space-y-6 animate-in fade-in duration-700 bg-background">
        <div className="bg-red-100 dark:bg-red-900/20 p-6 rounded-full">
          <Briefcase className="w-16 h-16 text-[#F06A6A]" />
        </div>
        <div className="text-center max-w-md px-4">
          <h1 className="text-3xl font-bold text-foreground mb-2">Conecte-se ao Asana</h1>
          <p className="text-muted-foreground">
            Sincronize seus projetos, tarefas e prazos diretamente no Zafira Hub.
            Tenha uma visão unificada do seu trabalho.
          </p>
        </div>
        <Button size="lg" className="bg-[#F06A6A] hover:bg-[#d95a5a] text-white font-semibold px-8" onClick={() => setIsConnectOpen(true)}>
          Conectar Agora
        </Button>

        <Dialog open={isConnectOpen} onOpenChange={setIsConnectOpen}>
          <DialogContent className="max-w-md p-0 overflow-hidden bg-transparent border-none shadow-none">
            <AsanaConnect />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#09090b] overflow-hidden">

      {/* Sidebar */}
      <ProjectsSidebar
        selectedId={selectedView}
        onSelect={setSelectedView}
        onConnectClick={() => setIsConnectOpen(true)}
        onWorkspaceChange={(id) => setCurrentWorkspaceId(id)}
      />
      {/* Note: ProjectsSidebar manages the "currentWorkspace" internally, but we need to know it here to force reload.
          Ideally ProjectsSidebar should accept "currentWorkspace" as prop, OR expose it.
          Let's change ProjectsSidebar to accept an onChange that we can use to trigger a key change.
      */}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0d0d12] relative">
        <MyTasksList key={currentWorkspaceId} viewId={selectedView} />
      </div>

      {/* Settings / Connect Modal */}
      <Dialog open={isConnectOpen} onOpenChange={setIsConnectOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-transparent border-none shadow-none">
          <AsanaConnect />
        </DialogContent>
      </Dialog>
    </div>
  );
}
