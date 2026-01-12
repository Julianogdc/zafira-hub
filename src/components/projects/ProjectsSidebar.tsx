import { useEffect, useState } from "react";
import axios from "axios";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Home,
    CheckCircle2,
    Bell,
    Briefcase,
    Plus,
    ChevronDown,
    MoreHorizontal,
    Star,
    Settings
} from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/store/useAuthStore";
import { asanaService } from "@/lib/asana-service";
import { AsanaProject } from "@/types/asana";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface ProjectsSidebarProps {
    selectedId: string | 'my_tasks' | 'home';
    onSelect: (id: string | 'my_tasks' | 'home') => void;
    onConnectClick: () => void;
    onWorkspaceChange?: (workspaceId: string) => void;
}

export function ProjectsSidebar({ selectedId, onSelect, onConnectClick, onWorkspaceChange }: ProjectsSidebarProps) {
    const { user } = useAuthStore();
    const [projects, setProjects] = useState<AsanaProject[]>([]);
    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [currentWorkspace, setCurrentWorkspace] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [isProjectsExpanded, setIsProjectsExpanded] = useState(true);

    useEffect(() => {
        if (user?.asanaAccessToken) {
            initData();
        }
    }, [user?.asanaAccessToken]);

    const initData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Workspaces
            const wsList = await asanaService.getWorkspaces();
            setWorkspaces(wsList);

            // 2. Determine Current Workspace
            let activeWsId = await asanaService.getWorkspaceId();

            // Should match one of the list
            if (!wsList.find((w: any) => w.gid === activeWsId) && wsList.length > 0) {
                activeWsId = wsList[0].gid;
                asanaService.setWorkspaceId(activeWsId);
            }
            setCurrentWorkspace(activeWsId);

            // 3. Fetch Projects for this workspace
            await loadProjectsForWorkspace();

        } catch (error) {
            console.error("Failed to load initial Asana data", error);
        } finally {
            setLoading(false);
        }
    };

    const loadProjectsForWorkspace = async () => {
        try {
            const data = await asanaService.getProjects();
            setProjects(data);
        } catch (error) {
            console.error("Failed to load projects", error);
        }
    }

    const handleWorkspaceChange = async (value: string) => {
        setCurrentWorkspace(value);
        asanaService.setWorkspaceId(value);
        if (onWorkspaceChange) onWorkspaceChange(value);
        setLoading(true);
        await loadProjectsForWorkspace();
        setLoading(false);
    };

    const NavItem = ({
        icon: Icon,
        label,
        id,
        isActive
    }: { icon: any, label: string, id: string, isActive?: boolean }) => (
        <Button
            variant="ghost"
            className={cn(
                "w-full justify-start gap-3 h-9 px-3 font-normal text-muted-foreground hover:text-foreground",
                isActive && "bg-accent text-accent-foreground hover:bg-accent/90 font-medium"
            )}
            onClick={() => onSelect(id as any)}
        >
            <Icon className={cn("w-4 h-4", isActive ? "text-blue-600 dark:text-blue-400" : "text-zinc-500")} />
            {label}
        </Button>
    );

    return (
        <div className="w-[240px] flex flex-col h-full border-r border-border bg-background">
            {/* Header / Logo Area if needed, usually just list */}

            <div className="p-4 pb-2 space-y-3">
                {/* Workspace Selector */}
                {!loading && workspaces.length > 0 && (
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider px-1">Workspace</label>
                        <Select value={currentWorkspace} onValueChange={handleWorkspaceChange}>
                            <SelectTrigger className="w-full h-9 bg-transparent border-border text-xs focus:ring-0">
                                <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                                {workspaces.map(ws => (
                                    <SelectItem key={ws.gid} value={ws.gid} className="text-xs">
                                        {ws.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                <Button
                    variant="outline"
                    className="w-full justify-start gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 border-dashed hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:border-zinc-700 h-8"
                    onClick={onConnectClick}
                >
                    <Settings className="w-3 h-3" />
                    {user?.asanaAccessToken ? 'Configurações' : 'Conectar Asana'}
                </Button>
            </div>

            <ScrollArea className="flex-1 px-3">
                <div className="space-y-1">
                    <NavItem icon={Home} label="Início" id="home" isActive={selectedId === 'home'} />
                    <NavItem icon={CheckCircle2} label="Minhas Tarefas" id="my_tasks" isActive={selectedId === 'my_tasks'} />
                    <NavItem icon={Bell} label="Caixa de Entrada" id="inbox" isActive={selectedId === 'inbox'} />
                </div>

                <div className="mt-8">
                    <div className="flex items-center justify-between px-3 mb-2 group cursor-pointer" onClick={() => setIsProjectsExpanded(!isProjectsExpanded)}>
                        <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300">Projetos</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Plus className="w-3 h-3 text-zinc-500" />
                            <ChevronDown className={cn("w-3 h-3 text-zinc-500 transition-transform", !isProjectsExpanded && "-rotate-90")} />
                        </div>
                    </div>

                    {isProjectsExpanded && (
                        <div className="space-y-0.5">
                            {loading && Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="px-3 py-2 flex items-center gap-3">
                                    <Skeleton className="w-4 h-4 rounded" />
                                    <Skeleton className="h-3 w-24" />
                                </div>
                            ))}

                            {!loading && projects.map((project) => (
                                <Button
                                    key={project.gid}
                                    variant="ghost"
                                    className={cn(
                                        "w-full justify-start gap-3 h-8 px-3 font-normal text-sm text-muted-foreground hover:text-foreground hover:bg-accent",
                                        selectedId === project.gid && "bg-accent text-accent-foreground hover:bg-accent/90"
                                    )}
                                    onClick={() => onSelect(project.gid)}
                                >
                                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: project.color || '#888' }} />
                                    <span className="truncate">{project.name}</span>
                                </Button>
                            ))}

                            {!loading && projects.length === 0 && user?.asanaAccessToken && (
                                <div className="px-5 py-4 text-xs text-zinc-400 text-center">
                                    Nenhum projeto encontrado.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Favorites Section could go here */}

            </ScrollArea>


        </div>
    );
}
