import { useEffect, useState, useRef, DragEvent, useMemo } from "react";
import axios from "axios";
import { asanaService } from "@/lib/asana-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChangeEvent, KeyboardEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    CalendarClock, AlertCircle, Trash2, MoreHorizontal, Pencil,
    Plus, Layout, PanelRightClose, ArrowLeft, CheckCircle2, Loader2,
    Play, Pause, User, Save, List, Activity, Briefcase
} from "lucide-react";
import { toast } from "sonner";
import { format, isBefore, isToday, isSameWeek, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import confetti from "canvas-confetti";
import { toAsanaUTC, fromAsanaDate, createLocalDate } from "@/lib/date-utils";

// TYPES
import { AsanaUser, AsanaProject, AsanaTask, AsanaStory, AsanaSection, AsanaNotification } from "@/types/asana";

// HELPERS
import { formatTaskDate, formatTimer, getColorClass, convertToAsanaHtml } from "@/lib/asana-helpers";

// COMPONENTS
import { TaskRow } from "./TaskRow";
import { TaskDetailModal } from "./TaskDetailModal";
import { QuickTaskInput } from "./QuickTaskInput";
import { TiptapEditor } from "./TiptapEditor";
import { RichTextRenderer } from "./RichTextRenderer";
import { SubtaskList } from "./SubtaskList";
import { AttachmentList } from "./AttachmentList";
import { BoardView } from "./BoardView";
import { ListView } from "./ListView";
import { CalendarView } from "./CalendarView";

export interface MyTasksListProps {
    viewId: string;
}

export function MyTasksList({ viewId }: MyTasksListProps) {
    const [tasks, setTasks] = useState<AsanaTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState<AsanaUser | null>(null);
    const [users, setUsers] = useState<AsanaUser[]>([]);
    const [projects, setProjects] = useState<AsanaProject[]>([]);

    const [activeProject, setActiveProject] = useState<AsanaProject | null>(null);
    const [loadingBoard, setLoadingBoard] = useState(false);
    // Removed showRightSidebar
    const [sections, setSections] = useState<AsanaSection[]>([]);
    const [projectTasks, setProjectTasks] = useState<AsanaTask[]>([]);
    const [draggedTask, setDraggedTask] = useState<AsanaTask | null>(null);

    const [activeTimerId, setActiveTimerId] = useState<string | null>(null);
    const [timers, setTimers] = useState<Record<string, number>>({});
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const [selectedTask, setSelectedTask] = useState<AsanaTask | null>(null);
    const [stories, setStories] = useState<AsanaStory[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

    const [isCreating, setIsCreating] = useState(false);
    const [newTaskName, setNewTaskName] = useState("");
    const [newTaskDesc, setNewTaskDesc] = useState("");
    const [newTaskDate, setNewTaskDate] = useState<Date | undefined>(undefined);
    const [newTaskTime, setNewTaskTime] = useState<string>("");
    const [newTaskAssignee, setNewTaskAssignee] = useState<string>("me");
    const [newTaskProject, setNewTaskProject] = useState<string>("none");
    const [newTaskFile, setNewTaskFile] = useState<File | null>(null);
    const [creatingLoading, setCreatingLoading] = useState(false);
    const [quickAddMode, setQuickAddMode] = useState(false);
    const [quickTaskName, setQuickTaskName] = useState("");
    const [quickTaskDesc, setQuickTaskDesc] = useState("");

    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [projectColor, setProjectColor] = useState("light-blue");

    const [notifications, setNotifications] = useState<AsanaNotification[]>([]);
    const [loadingNotifications, setLoadingNotifications] = useState(false);

    // --- BOARD VIEW STATE ---
    const [viewMode, setViewMode] = useState<'list' | 'board' | 'calendar'>('list');

    // EFFECT: Handle View Change
    useEffect(() => {
        handleViewChange(viewId);
    }, [viewId, projects]); // Re-run if projects load or viewId changes

    const handleViewChange = async (id: string) => {
        setLoadingBoard(true);
        setSections([]); // Reset state
        setProjectTasks([]); // Reset state
        // Update: detect view from project layout if possible, or default
        // But for now keeping user preference via state
        if (id === 'calendar_view' || id.includes('calendario')) {
            setViewMode('calendar');
        }

        if (id === 'inbox') {
            setActiveProject(null);
            setLoadingNotifications(true);
            try {
                const notifs = await asanaService.getNotifications();
                setNotifications(notifs);
            } catch (e) {
                console.error("Failed to load notifications", e);
            } finally {
                setLoadingNotifications(false);
            }
        } else if (id === 'my_tasks' || id === 'home') {
            setActiveProject(null);
        } else {
            // Find project
            const proj = projects.find(p => p.gid === id);
            if (proj) {
                setActiveProject(proj);
                setLoadingBoard(true);
                try {
                    console.log("Fetching sections for", proj.gid);
                    const sectionsData = await asanaService.getProjectSections(proj.gid);
                    setSections(sectionsData);
                    console.log("Sections loaded", sectionsData);
                } catch (e: any) {
                    console.warn("Failed to load sections directly (using fallback if possible)", e.response?.data);
                    // toast.error(`Erro ao carregar seções: ${e.response?.data?.errors?.[0]?.message}`);
                }

                try {
                    console.log("Fetching tasks for", proj.gid);
                    const tasksData = await asanaService.getTasksByProject(proj.gid);
                    setProjectTasks(tasksData);
                    console.log("Tasks loaded", tasksData);

                    // Fallback: Infer sections from tasks if getProjectSections failed or returned empty
                    setSections(prevSections => {
                        if (prevSections.length > 0) return prevSections;

                        const inferredSections = new Map<string, string>();
                        tasksData.forEach(task => {
                            task.memberships?.forEach(m => {
                                if (m.project?.gid === proj.gid && m.section) {
                                    inferredSections.set(m.section.gid, m.section.name);
                                }
                            });
                        });

                        if (inferredSections.size > 0) {
                            console.log("Inferred sections from tasks:", inferredSections);
                            return Array.from(inferredSections.entries()).map(([gid, name]) => ({ gid, name }));
                        }
                        return prevSections;
                    });

                } catch (e: any) {
                    console.error("Failed to load tasks", e.response?.data);
                    const msg = e.response?.data?.errors?.[0]?.message || e.message;
                    toast.error(`Erro ao carregar tarefas: ${msg}`);
                } finally {
                    setLoadingBoard(false);
                }
            } else if (projects.length > 0) {
                // Project might not be in the initial list if list is limited or paginated?
                // But for now assume if not found in list, we might need to fetch plain?
            }
        }
    };

    const handleTaskMove = async (taskGid: string, newSectionGid: string) => {
        const taskToMove = projectTasks.find(t => t.gid === taskGid);
        if (!taskToMove) return;

        const updatedTasks = projectTasks.map(t => {
            if (t.gid === taskGid) {
                const newMemberships = t.memberships ? [...t.memberships] : [];
                const sectionIdx = newMemberships.findIndex(m => m.project?.gid === activeProject?.gid);
                if (sectionIdx >= 0) {
                    newMemberships[sectionIdx] = { ...newMemberships[sectionIdx], section: { gid: newSectionGid, name: '' } };
                } else {
                    newMemberships.push({ project: { gid: activeProject?.gid || '', name: typeof activeProject?.name === 'string' ? activeProject.name : '' }, section: { gid: newSectionGid, name: '' } });
                }
                return { ...t, memberships: newMemberships };
            }
            return t;
        });
        setProjectTasks(updatedTasks);
        try {
            await asanaService.moveTaskToSection(taskGid, newSectionGid);
            toast.success("Tarefa movida!");
        } catch (e) {
            console.error(e);
            toast.error("Erro ao mover tarefa.");
        }
    };

    const handleNewTaskInSection = (sectionGid: string) => {
        setIsCreating(true);
    };

    useEffect(() => { loadInitialData(); }, []);

    useEffect(() => {
        if (activeTimerId) {
            timerIntervalRef.current = setInterval(() => {
                setTimers(prev => ({ ...prev, [activeTimerId]: (prev[activeTimerId] || 0) + 1 }));
            }, 1000);
        } else { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); }
        return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
    }, [activeTimerId]);

    const toggleTimer = async (taskId: string) => {
        if (activeTimerId === taskId) {
            const seconds = timers[taskId] || 0;
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            toast.success(`Tempo salvo: ${minutes}m ${secs}s`);
            try {
                await asanaService.addComment(taskId, `⏱️ Tempo registrado: ${minutes}m ${secs}s`);
                const newStories = await asanaService.getTaskStories(taskId);
                setStories(newStories);
            } catch (err) { console.error('Error saving timer:', err); }
            setActiveTimerId(null);
        } else {
            setActiveTimerId(taskId);
            try {
                await asanaService.addComment(taskId, `▶️ Iniciou a tarefa`);
                const newStories = await asanaService.getTaskStories(taskId);
                setStories(newStories);
            } catch (err) { console.error('Error starting timer:', err); }
        }
    };

    const loadInitialData = async () => {
        try {
            const [userData, tasksData, usersData, projectsData] = await Promise.all([
                asanaService.getMe(), asanaService.getMyTasks(), asanaService.getWorkspaceUsers(), asanaService.getProjects()
            ]);
            setCurrentUser(userData); setTasks(tasksData); setUsers(usersData); setProjects(projectsData);
        } catch (err) { console.error(err); toast.error("Erro de conexão."); } finally { setLoading(false); }
    };

    const { overdueTasks, upcomingTasks, completedTasks, weeklyVolume } = useMemo(() => {
        const _overdue = tasks.filter(t => t && !t.completed && (t.due_on || t.due_at) && isBefore(fromAsanaDate(t.due_at || t.due_on!), new Date()) && !isToday(fromAsanaDate(t.due_at || t.due_on!)));
        const _upcoming = tasks.filter(t => t && !t.completed && (!_overdue.includes(t)));
        const _completed = tasks.filter(t => t && t.completed);
        const _volume = tasks.filter(t => t && (t.due_on || t.due_at) && isSameWeek(fromAsanaDate(t.due_at || t.due_on!), new Date(), { locale: ptBR })).length;

        return { overdueTasks: _overdue, upcomingTasks: _upcoming, completedTasks: _completed, weeklyVolume: _volume };
    }, [tasks]);

    const overdueByProject = overdueTasks.reduce((acc, task) => {
        if (task.projects?.length > 0) task.projects.forEach(p => { acc[p.name] = (acc[p.name] || 0) + 1; }); else acc["Sem Projeto"] = (acc["Sem Projeto"] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const topOverdueProject = Object.entries(overdueByProject).sort((a, b) => b[1] - a[1])[0];

    const handleSelectProject = async (project: AsanaProject) => {
        setActiveProject(project); setLoadingBoard(true);
        try { const [sectionsData, tasksData] = await Promise.all([asanaService.getProjectSections(project.gid), asanaService.getTasksByProject(project.gid)]); setSections(sectionsData); setProjectTasks(tasksData); } catch (error) { toast.error("Erro ao carregar projeto."); } finally { setLoadingBoard(false); }
    };

    const handleQuickCreate = async () => {
        if (!quickTaskName.trim()) return;
        const tempId = "temp-" + Date.now();
        const tempTask: AsanaTask = { gid: tempId, name: quickTaskName, due_on: null, due_at: null, completed: false, projects: activeProject ? [{ gid: activeProject.gid, name: activeProject.name, color: activeProject.color }] : [], assignee: { gid: currentUser?.gid || "me", name: currentUser?.name || "Eu", photo: currentUser?.photo || null } };
        if (activeProject) setProjectTasks(prev => [tempTask, ...prev]); else setTasks(prev => [tempTask, ...prev]);
        setQuickTaskName(""); setQuickTaskDesc(""); setQuickAddMode(false);
        try {
            const created = await asanaService.createFullTask({ name: tempTask.name, notes: quickTaskDesc, html_notes: convertToAsanaHtml(quickTaskDesc, users), projects: activeProject ? [activeProject.gid] : [] });
            const updater = (list: AsanaTask[]) => list.map(t => t.gid === tempId ? created : t);
            if (activeProject) setProjectTasks(updater); else setTasks(updater);
        } catch (e) { toast.error("Falha ao sincronizar."); }
    };

    const handleCreateTaskModal = async () => {
        if (!newTaskName.trim()) return;
        setCreatingLoading(true);
        const tempId = "temp-" + Date.now();
        let dueAtISO = undefined, dateISO = undefined;
        if (newTaskDate) {
            const dateStr = format(newTaskDate, "yyyy-MM-dd");
            if (newTaskTime) {
                // FIXED: Create correct ISO string preserving local time -> Asana UTC
                const datePart = format(newTaskDate, "yyyy-MM-dd");
                const localDate = createLocalDate(datePart, newTaskTime);
                dueAtISO = toAsanaUTC(localDate);
            } else {
                dateISO = dateStr;
            }
        }
        const isAssignedToMe = newTaskAssignee === "me" || newTaskAssignee === currentUser?.gid;

        const tempTask: AsanaTask = { gid: tempId, name: newTaskName, due_on: dateISO || null, due_at: dueAtISO || null, completed: false, projects: [], memberships: [], assignee: { gid: newTaskAssignee, name: "...", photo: null } };
        if (isAssignedToMe) setTasks(prev => [tempTask, ...prev]);
        setIsCreating(false); toast.success("Tarefa criada!");

        try {
            const createdTask = await asanaService.createFullTask({ name: newTaskName, notes: newTaskDesc, html_notes: convertToAsanaHtml(newTaskDesc, users), due_on: dateISO, due_at: dueAtISO, assignee: newTaskAssignee === "me" ? undefined : newTaskAssignee, projects: newTaskProject !== "none" ? [newTaskProject] : [] });
            if (newTaskFile) await asanaService.uploadAttachment(createdTask.gid, newTaskFile);
            if (isAssignedToMe) setTasks(prev => prev.map(t => t.gid === tempId ? { ...createdTask, projects: [] } : t)); else setTasks(prev => prev.filter(t => t.gid !== tempId));
            setNewTaskName(""); setNewTaskDesc(""); setNewTaskFile(null); setNewTaskTime("");
        } catch (e) { toast.error("Erro."); if (isAssignedToMe) setTasks(prev => prev.filter(t => t.gid !== tempId)); } finally { setCreatingLoading(false); }
    };

    const handleUpdateTaskProperty = async (gid: string, field: string, value: string | boolean | null) => {
        // Prepare payload and local update values
        let payload: Record<string, unknown> = { [field]: value };
        let localUpdates: Record<string, unknown> = { [field]: value };

        if (field === 'notes' && typeof value === 'string') {
            const convertedHtml = convertToAsanaHtml(value, users);
            payload = { html_notes: convertedHtml };
            // CRITICAL FIX: Update html_notes locally too, otherwise the UI prefers the old html_notes
            localUpdates = { notes: value, html_notes: convertedHtml };
        }

        const updateLocal = (list: AsanaTask[]) => list.map(t => t.gid === gid ? { ...t, ...localUpdates } : t);
        setTasks(updateLocal);
        setProjectTasks(updateLocal);

        if (selectedTask?.gid === gid) {
            setSelectedTask(prev => prev ? { ...prev, ...localUpdates } : null);
        }

        if (field === 'assignee' && value !== currentUser?.gid) {
            // Optional: remove from my tasks if unassigned from self
            // setTasks(prev => prev.filter(t => t.gid !== gid));
        }

        try {
            await asanaService.updateTask(gid, payload);

            // Refetch to confirm what Asana saved (avoid optimistic flags lying to us)
            if (field === 'notes') {
                const refreshed = await asanaService.getTaskDetails(gid);
                if (selectedTask?.gid === gid) {
                    setSelectedTask(refreshed);
                }
                // Update list view lightly
                const updateLocal = (list: AsanaTask[]) => list.map(t => t.gid === gid ? { ...t, notes: refreshed.notes, html_notes: refreshed.html_notes } : t);
                setTasks(updateLocal);
                setProjectTasks(updateLocal);
            }

            toast.success("Salvo.");
        } catch (e: any) {
            console.error("Save error:", e.response?.data);
            const msg = e.response?.data?.errors?.[0]?.message || e.message || "Erro desconhecido";
            toast.error(`Erro ao salvar: ${msg}`);
        }
    };

    const handleUpdateProject = async (gid: string, projectGid: string) => {
        try { await asanaService.addTaskProject(gid, projectGid); toast.success("Projeto adicionado!"); const updated = await asanaService.getTaskDetails(gid); setSelectedTask(updated); } catch (e) { toast.error("Erro."); }
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        setCreatingLoading(true);
        try {
            const w = await asanaService.getWorkspaceId();
            await asanaService.createProject(newProjectName, w, projectColor);
            toast.success("Projeto criado!");
            setNewProjectName("");
            setIsCreatingProject(false);
            const ps = await asanaService.getProjects();
            setProjects(ps);
        } catch (e: any) {
            toast.error("Erro ao criar projeto.");
        } finally {
            setCreatingLoading(false);
        }
    };

    const handleTaskClick = async (task: AsanaTask) => {
        setSelectedTask(task);
        setLoadingDetails(true);
        setStories([]);

        try {
            const [d, s] = await Promise.all([
                asanaService.getTaskDetails(task.gid),
                asanaService.getTaskStories(task.gid)
            ]);
            // Merge details into selectedTask
            setSelectedTask(prev => prev && prev.gid === task.gid ? { ...prev, ...d } : d);
            setStories(s);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingDetails(false);
        }
    };



    const handleCompleteTask = async (taskGid: string, isCompleted: boolean) => {
        if (isCompleted && activeTimerId === taskGid) {
            const seconds = timers[taskGid] || 0;
            const minutes = Math.floor(seconds / 60);
            await asanaService.addComment(taskGid, `✅ Tarefa finalizada em ${minutes}m ${seconds % 60}s`);
            setActiveTimerId(null);
        }

        if (isCompleted && confetti) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        const updater = (list: AsanaTask[]) => list.map(t => t.gid === taskGid ? { ...t, completed: isCompleted } : t);
        if (activeProject) setProjectTasks(updater); else setTasks(updater);

        if (selectedTask?.gid === taskGid) {
            setSelectedTask(prev => prev ? { ...prev, completed: isCompleted } : null);
            const s = await asanaService.getTaskStories(taskGid);
            setStories(s);
        }

        try { await asanaService.completeTask(taskGid, isCompleted); } catch (e) { toast.error("Erro ao sincronizar."); }
    };



    const handleDragStart = (e: DragEvent, task: AsanaTask) => { setDraggedTask(task); e.dataTransfer.effectAllowed = "move"; };
    const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
    const handleDrop = async (e: DragEvent, targetSectionGid: string) => { e.preventDefault(); if (!draggedTask) return; const updatedTasks = projectTasks.map(t => { if (t.gid === draggedTask.gid) return { ...t, memberships: [{ project: { gid: activeProject?.gid || '', name: '' }, section: { gid: targetSectionGid, name: '' } }] }; return t; }); setProjectTasks(updatedTasks); setDraggedTask(null); try { await asanaService.moveTaskToSection(draggedTask.gid, targetSectionGid); } catch (e) { toast.error("Erro."); } };
    const getTasksBySection = (gid: string) => projectTasks.filter(t => t.memberships?.some(m => m.section.gid === gid));
    const handleDeleteTask = async () => { if (!taskToDelete) return; setTasks(prev => prev.filter(t => t.gid !== taskToDelete)); setProjectTasks(prev => prev.filter(t => t.gid !== taskToDelete)); try { await asanaService.deleteTask(taskToDelete); toast.success("Apagada"); } catch (e) { toast.error("Erro."); } finally { setTaskToDelete(null); } };

    if (loading) return <div className="flex items-center justify-center h-full bg-[#0d0d12] text-slate-400 animate-pulse"><Loader2 className="w-6 h-6 animate-spin mr-2 text-purple-500" /> Carregando Zafira Hub...</div>;

    const activityKeywords = ['Iniciou', 'Finalizou', 'criou', 'adicionou', 'alterou', 'Inició', 'Finalizó', 'creó', 'cambió'];
    const activityStories = stories.filter(s => s.type === 'system' || activityKeywords.some(k => s.text.toLowerCase().includes(k.toLowerCase())) || s.text.includes('⏱️') || s.text.includes('▶️') || s.text.includes('✅'));
    const userComments = stories.filter(s => !activityStories.includes(s));

    return (
        <div className="flex h-full overflow-hidden bg-[#0d0d12]">
            {/* MAIN CONTENT AREA */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#0d0d12] relative">

                {/* TOOLBAR / HEADER */}
                <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-[#0f0f15]/50 backdrop-blur-sm shrink-0 z-10 w-full">
                    <div className="flex items-center gap-4">
                        {/* Show Sidebar Toggle (Only if hidden) */}


                        <div className="h-8 w-px bg-white/10" />

                        {activeProject ? (
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={() => setActiveProject(null)} className="mr-2">
                                    <ArrowLeft className="w-5 h-5 text-slate-400" />
                                </Button>
                                <div className={`w-3 h-3 rounded-full ${getColorClass(activeProject.color).split(' ')[0]}`} />
                                <h1 className="text-xl font-bold tracking-tight text-white">{activeProject.name}</h1>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-4">

                                <h1 className="text-xl font-bold tracking-tight text-white">
                                    {viewId === 'inbox' ? 'Caixa de Entrada' : viewId === 'home' ? 'Início' : 'Minhas Tarefas'}
                                </h1>
                                <p className="text-sm text-muted-foreground capitalize ml-4 border-l border-white/10 pl-4">{format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
                            </div>
                        )}

                        {/* VIEW MODE TOGGLE (Only for Projects) */}
                        <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/5 ml-4">
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 px-3 text-xs gap-2 rounded-md ${viewMode === 'list' ? 'bg-[#1e1e2e] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                                onClick={() => setViewMode('list')}
                            >
                                <List className="w-3.5 h-3.5" /> Lista
                            </Button>
                            {activeProject && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`h-7 px-3 text-xs gap-2 rounded-md ${viewMode === 'board' ? 'bg-[#1e1e2e] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                                    onClick={() => setViewMode('board')}
                                >
                                    <Layout className="w-3.5 h-3.5" /> Quadro
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 px-3 text-xs gap-2 rounded-md ${viewMode === 'calendar' ? 'bg-[#1e1e2e] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                                onClick={() => setViewMode('calendar')}
                            >
                                <CalendarClock className="w-3.5 h-3.5" /> Calendário
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button onClick={() => setIsCreating(true)} className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 h-9 rounded-lg shadow-lg shadow-purple-900/20 transition-all hover:scale-105 active:scale-95">
                            <Plus className="w-4 h-4 mr-2" /> Nova Tarefa
                        </Button>
                        <Button onClick={() => setIsCreatingProject(true)} variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 rounded-lg">
                            <Plus className="w-4 h-4 mr-2" /> Novo Projeto
                        </Button>
                    </div>
                </div>

                {/* CONTENT AREA SWAP */}
                <div className="flex-1 overflow-hidden relative w-full">

                    {viewId === 'inbox' ? (
                        <div className="h-full w-full p-8 flex flex-col items-center">
                            <Card className="w-full max-w-4xl h-[calc(100vh-8rem)] flex flex-col bg-[#1e1e2e]/80 backdrop-blur-xl border-white/10 shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/5">
                                <div className="px-8 py-6 border-b border-white/5 bg-[#1e1e2e]/50">
                                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                        <span className="p-2 bg-blue-500/10 rounded-lg"><Layout className="w-5 h-5 text-blue-400" /></span> Caixa de Entrada
                                    </h2>
                                </div>
                                <ScrollArea className="flex-1 bg-black/5 p-6">
                                    {loadingNotifications ? (
                                        <div className="flex justify-center p-10"><Loader2 className="animate-spin text-purple-500" /></div>
                                    ) : notifications.length === 0 ? (
                                        <div className="text-center text-slate-500 p-10">Nenhuma notificação recente.</div>
                                    ) : (
                                        <div className="space-y-3">
                                            {notifications.map(n => (
                                                <div key={n.gid} className="p-4 bg-[#2a2a35] rounded-lg border border-white/5 hover:border-white/10 transition-colors flex gap-3">
                                                    <div className={`p-2 rounded-full shrink-0 ${n.type === 'task' ? 'bg-green-500/10 text-green-400' : 'bg-purple-500/10 text-purple-400'}`}>
                                                        {n.type === 'task' ? <CheckCircle2 className="w-4 h-4" /> : <Layout className="w-4 h-4" />}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm text-slate-200">
                                                            <span className="font-semibold text-white">{n.created_by?.name || "Asana"}</span> {n.resource?.name ? `em ${n.resource.name}` : "atualizou algo"}
                                                        </p>
                                                        <p className="text-xs text-slate-500 mt-1">{format(new Date(n.created_at), "PPp", { locale: ptBR })}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </Card>
                        </div>
                    ) : viewMode === 'calendar' ? (
                        <div className="h-full w-full p-6 overflow-hidden">
                            <CalendarView
                                tasks={activeProject ? projectTasks : tasks}
                                onTaskClick={handleTaskClick}
                            />
                        </div>
                    ) : activeProject ? (
                        // PROJECT VIEW (Board or List)
                        viewMode === 'board' ? (
                            <div className="h-full w-full p-6 overflow-hidden">
                                <BoardView
                                    sections={sections}
                                    tasks={projectTasks}
                                    onTaskClick={handleTaskClick}
                                    onTaskMove={handleTaskMove}
                                    onNewTask={handleNewTaskInSection}
                                />
                            </div>
                        ) : (
                            <ScrollArea className="h-full w-full">
                                <div className="p-6">
                                    <ListView
                                        sections={sections}
                                        tasks={projectTasks}
                                        onTaskClick={handleTaskClick}
                                        onComplete={handleCompleteTask}
                                        onDelete={(gid) => { console.log("Deleting task:", gid); setTaskToDelete(gid); }}
                                        timerState={{ id: activeTimerId, time: activeTimerId ? timers[activeTimerId] || 0 : 0 }}
                                        onToggleTimer={toggleTimer}
                                        onNewTask={handleNewTaskInSection}
                                    />
                                </div>
                            </ScrollArea>
                        )
                    ) : (
                        // MY TASKS VIEW (Floating Card Style)
                        // Removed bg-[#0d0d12] to unify with project identity, centered stats
                        <div className="h-full w-full p-8 flex justify-center items-start">
                            <Card className="w-full max-w-5xl h-[calc(100vh-8rem)] flex flex-col bg-[#1e1e2e]/80 backdrop-blur-xl border-white/10 shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/5">
                                <div className="p-0 flex-1 flex flex-col min-h-0">
                                    <Tabs defaultValue="upcoming" className="flex-1 flex flex-col min-h-0">
                                        <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#1e1e2e]/50">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 bg-purple-500/10 rounded-lg">
                                                    <CheckCircle2 className="w-6 h-6 text-purple-400" />
                                                </div>
                                                <div>
                                                    <h2 className="text-lg font-bold text-white">Minhas Tarefas</h2>
                                                    <p className="text-xs text-slate-400">Gerencie suas atividades diárias</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <div className="text-center">
                                                    <p className="text-2xl font-bold text-white">{weeklyVolume}</p>
                                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Feitas na Semana</p>
                                                </div>
                                                <div className="h-8 w-px bg-white/5" />
                                                <TabsList className="bg-black/20 border border-white/5 h-9 p-0.5 gap-1">
                                                    <TabsTrigger value="upcoming" className="h-[30px] px-4 text-xs data-[state=active]:bg-[#2a2a35] data-[state=active]:text-white transition-all">Próximas <span className="ml-2 bg-white/10 px-1.5 py-0.5 rounded-full text-[10px]">{upcomingTasks.length}</span></TabsTrigger>
                                                    <TabsTrigger value="overdue" className="h-[30px] px-4 text-xs data-[state=active]:bg-red-500/10 data-[state=active]:text-red-400">Atrasadas <span className="ml-2 bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full text-[10px]">{overdueTasks.length}</span></TabsTrigger>
                                                    <TabsTrigger value="completed" className="h-[30px] px-4 text-xs data-[state=active]:bg-green-500/10 data-[state=active]:text-green-400">Concluídas</TabsTrigger>
                                                </TabsList>
                                            </div>
                                        </div>
                                        <TabsContent value="upcoming" className="flex-1 overflow-y-auto min-h-0 p-6 space-y-2 scroll-smooth bg-black/5">
                                            <QuickTaskInput
                                                active={quickAddMode} onActivate={() => setQuickAddMode(true)} onCancel={() => setQuickAddMode(false)}
                                                name={quickTaskName} setName={setQuickTaskName} desc={quickTaskDesc} setDesc={setQuickTaskDesc}
                                                onSubmit={handleQuickCreate}
                                            />
                                            {upcomingTasks.length === 0 && !quickAddMode ? <div className="flex flex-col items-center justify-center py-20 opacity-50"><div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4"><CheckCircle2 className="w-8 h-8 text-slate-500" /></div><p className="text-slate-500">Tudo feito por enquanto.</p></div> : upcomingTasks.map(t => <TaskRow key={t.gid} task={t} onClick={handleTaskClick} onComplete={handleCompleteTask} onDelete={(gid) => { console.log("Deleting task:", gid); setTaskToDelete(gid); }} timerState={{ id: activeTimerId, time: timers[t.gid] || 0 }} onToggleTimer={toggleTimer} />)}
                                        </TabsContent>
                                        <TabsContent value="overdue" className="space-y-2 p-6 bg-black/5">{overdueTasks.map(t => <TaskRow key={t.gid} task={t} onClick={handleTaskClick} onComplete={handleCompleteTask} onDelete={(gid) => { console.log("Deleting overdue:", gid); setTaskToDelete(gid); }} timerState={{ id: activeTimerId, time: timers[t.gid] || 0 }} onToggleTimer={toggleTimer} />)}</TabsContent>
                                        <TabsContent value="completed" className="space-y-2 p-6 bg-black/5">{completedTasks.map(t => <TaskRow key={t.gid} task={t} onClick={handleTaskClick} onComplete={handleCompleteTask} onDelete={(gid) => { console.log("Deleting completed:", gid); setTaskToDelete(gid); }} timerState={{ id: activeTimerId, time: timers[t.gid] || 0 }} onToggleTimer={toggleTimer} />)}</TabsContent>
                                    </Tabs>
                                </div>
                            </Card>
                        </div>
                    )}
                </div>
            </div>



            {/* TASK DETAIL MODAL - Refactored */}
            <TaskDetailModal
                task={selectedTask}
                onClose={() => setSelectedTask(null)}
                users={users}
                projects={projects}
                currentUser={currentUser}
                activeTimerId={activeTimerId}
                timers={timers}
                onToggleTimer={toggleTimer}
                onUpdateTask={handleUpdateTaskProperty}
                onDeleteTask={(gid) => { setTaskToDelete(gid); setSelectedTask(null); }}
                onCompleteTask={handleCompleteTask}
                onAddProject={handleUpdateProject}
                stories={stories}
                setStories={setStories}
            />

            {/* DELETE CONFIRMATION DIALOG */}
            <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
                <AlertDialogContent className="bg-[#1e1e2e] border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir Tarefa?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                            Esta ação não pode ser desfeita. A tarefa será permanentemente removida do Asana.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-white/10 text-white hover:bg-white/5">Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteTask} className="bg-red-500 text-white hover:bg-red-600">Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>



            {/* NEW TASK DIALOG */}
            <Dialog open={isCreating} onOpenChange={setIsCreating}>
                <DialogContent className="sm:max-w-[600px] bg-[#1a1a24] border-white/10 text-white">
                    <DialogHeader><DialogTitle>Nova Tarefa</DialogTitle><DialogDescription>Crie uma nova tarefa no Asana.</DialogDescription></DialogHeader>
                    <div className="grid gap-4 py-4">
                        <Input placeholder="Nome da tarefa" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} className="bg-black/20 border-white/10 text-lg font-medium h-12" />
                        <div className="flex gap-4">
                            <Popover><PopoverTrigger asChild><Button variant="outline" className="flex-1 justify-start border-white/10 bg-black/20 text-slate-300">{newTaskDate ? format(newTaskDate, "PPP", { locale: ptBR }) : <span>Data de conclusão</span>}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 bg-[#1e1e2e] border-white/10"><Calendar mode="single" selected={newTaskDate} onSelect={setNewTaskDate} initialFocus className="text-white" /></PopoverContent></Popover>
                            <Input type="time" value={newTaskTime} onChange={(e) => setNewTaskTime(e.target.value)} className="w-[120px] bg-black/20 border-white/10" />
                        </div>
                        <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}><SelectTrigger className="bg-black/20 border-white/10 text-slate-300"><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent className="bg-[#1e1e2e] border-white/10"><SelectItem value="me">Para mim</SelectItem>{users.map(u => <SelectItem key={u.gid} value={u.gid}>{u.name}</SelectItem>)}</SelectContent></Select>
                        <Select value={newTaskProject} onValueChange={setNewTaskProject}><SelectTrigger className="bg-black/20 border-white/10 text-slate-300"><SelectValue placeholder="Projeto (Opcional)" /></SelectTrigger><SelectContent className="bg-[#1e1e2e] border-white/10"><SelectItem value="none">Sem projeto</SelectItem>{projects.map(p => <SelectItem key={p.gid} value={p.gid}>{p.name}</SelectItem>)}</SelectContent></Select>
                        <TiptapEditor value={newTaskDesc} onChange={setNewTaskDesc} placeholder="Descrição..." className="min-h-[100px] bg-black/20 border-white/10 rounded-md p-3 text-sm" />
                        <Input type="file" onChange={e => setNewTaskFile(e.target.files?.[0] || null)} className="bg-black/20 border-white/10" />
                    </div>
                    <DialogFooter><Button variant="ghost" onClick={() => setIsCreating(false)}>Cancelar</Button><Button onClick={handleCreateTaskModal} disabled={creatingLoading} className="bg-purple-600">{creatingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar Tarefa"}</Button></DialogFooter>
                </DialogContent>
            </Dialog>


            {/* NEW PROJECT DIALOG */}
            <Dialog open={isCreatingProject} onOpenChange={setIsCreatingProject}>
                <DialogContent className="sm:max-w-[400px] bg-[#1a1a24] border-white/10 text-white">
                    <DialogHeader><DialogTitle>Novo Projeto</DialogTitle><DialogDescription>Crie um novo projeto no seu workspace.</DialogDescription></DialogHeader>
                    <div className="grid gap-4 py-4">
                        <Input placeholder="Nome do Projeto" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} className="bg-black/20 border-white/10" />
                        <Select value={projectColor} onValueChange={setProjectColor}>
                            <SelectTrigger className="bg-black/20 border-white/10 text-slate-300"><SelectValue placeholder="Cor" /></SelectTrigger>
                            <SelectContent className="bg-[#1e1e2e] border-white/10">
                                <SelectItem value="light-blue">Azul Claro</SelectItem>
                                <SelectItem value="dark-pink">Rosa</SelectItem>
                                <SelectItem value="dark-green">Verde</SelectItem>
                                <SelectItem value="dark-purple">Roxo</SelectItem>
                                <SelectItem value="dark-brown">Marrom</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsCreatingProject(false)}>Cancelar</Button>
                        <Button onClick={handleCreateProject} disabled={creatingLoading} className="bg-purple-600">
                            {creatingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar Projeto"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

