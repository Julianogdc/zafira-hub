import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CheckCircle2, Play, Pause, Trash2, User, CalendarClock, Briefcase, List, Plus, Activity, Paperclip, Loader2, MoreHorizontal, PanelRightClose } from "lucide-react";
import { format, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { formatTimer, getColorClass, formatTaskDate, convertToAsanaHtml } from "@/lib/asana-helpers";
import { AsanaTask, AsanaUser, AsanaProject, AsanaStory } from "@/types/asana";
import { TiptapEditor } from "./TiptapEditor";
import { SubtaskList } from "./SubtaskList";
import { AttachmentList } from "./AttachmentList";
import { RichTextRenderer } from "./RichTextRenderer";
import { formatDistanceToNow } from "date-fns";
import { fromAsanaDate, createLocalDate, toAsanaUTC } from "@/lib/date-utils";
import { useState, useRef, useEffect } from "react";
import { asanaService } from "@/lib/asana-service";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface TaskDetailModalProps {
    task: AsanaTask | null;
    onClose: () => void;
    users: AsanaUser[];
    projects: AsanaProject[];
    currentUser: AsanaUser | null;
    activeTimerId: string | null;
    timers: Record<string, number>;
    onToggleTimer: (taskId: string) => void;
    onUpdateTask: (gid: string, field: string, value: any) => void;
    onDeleteTask: (gid: string) => void;
    onCompleteTask: (gid: string, completed: boolean) => void;
    onAddProject: (taskGid: string, projectGid: string) => void;
    stories: AsanaStory[];
    setStories: React.Dispatch<React.SetStateAction<AsanaStory[]>>;
}

export function TaskDetailModal({
    task,
    onClose,
    users,
    projects,
    currentUser,
    activeTimerId,
    timers,
    onToggleTimer,
    onUpdateTask,
    onDeleteTask,
    onCompleteTask,
    onAddProject,
    stories,
    setStories
}: TaskDetailModalProps) {
    const [titleText, setTitleText] = useState("");
    const [descText, setDescText] = useState("");
    const [newComment, setNewComment] = useState("");
    const [sending, setSending] = useState(false);
    const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
    const [editingTime, setEditingTime] = useState("");
    const descRef = useRef<HTMLTextAreaElement>(null);

    // Sync internal state when task changes
    // Sync internal state when task changes
    useEffect(() => {
        if (task) {
            setTitleText(task.name);
            // Fix: Asana might return html_notes with \n which browsers ignore. Force <br/>.
            const rawHtml = task.html_notes || task.notes || "";
            // Ensure visual line breaks for Tiptap
            const processedHtml = rawHtml.replace(/\n/g, "<br/>");
            setDescText(processedHtml);

            if (task.due_at) {
                const dt = fromAsanaDate(task.due_at);
                setEditingTime(format(dt, "HH:mm"));
            } else {
                setEditingTime("");
            }
        }
    }, [task]);

    // Comment logic
    const handleSendComment = async () => {
        if (!newComment.trim() || !task) return;
        setSending(true);
        try {
            // Use same sanitization for comments
            const htmlPayload = convertToAsanaHtml(newComment, []);
            await asanaService.addComment(task.gid, htmlPayload);
            setNewComment("");
            const s = await asanaService.getTaskStories(task.gid);
            setStories(s);
            toast.success("Enviado");
        } catch (e) { toast.error("Erro ao comentar"); } finally { setSending(false); }
    };

    const handleDeleteComment = async (storyId: string) => {
        try {
            setStories(prev => prev.filter(s => s.gid !== storyId));
            await asanaService.deleteComment(storyId);
            toast.success("Comentário excluído");
        } catch (e: any) {
            console.error("Delete story error:", e.response?.data);
            const errorMsg = e.response?.data?.errors?.[0]?.message || "";

            if (errorMsg.includes("Full permissions are required") || errorMsg.includes("Forbidden")) {
                toast.error("O Asana impediu a exclusão. Apenas o autor original ou admins podem apagar.");
            } else {
                const msg = errorMsg || e.message || "Erro desconhecido";
                toast.error(`Erro ao excluir: ${msg}`);
            }

            if (task) {
                const s = await asanaService.getTaskStories(task.gid);
                setStories(s);
            }
        }
    };

    const onDropComment = async (acceptedFiles: File[]) => {
        if (!task || acceptedFiles.length === 0) return;
        toast.info("Enviando anexos...");
        for (const file of acceptedFiles) {
            try {
                await asanaService.uploadAttachment(task.gid, file);
                toast.success(`${file.name} enviado!`);
            } catch (error) { toast.error(`Erro ao enviar ${file.name}`); }
        }
        const s = await asanaService.getTaskStories(task.gid);
        setStories(s);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: onDropComment, noClick: true });

    if (!task) return null;

    const activityKeywords = ['Iniciou', 'Finalizou', 'criou', 'adicionou', 'alterou', 'Inició', 'Finalizó', 'creó', 'cambió'];
    const activityStories = stories.filter(s => s.type === 'system' || activityKeywords.some(k => s.text.toLowerCase().includes(k.toLowerCase())) || s.text.includes('⏱️') || s.text.includes('▶️') || s.text.includes('✅'));
    const userComments = stories.filter(s => !activityStories.includes(s));

    return (
        <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 bg-zinc-950 text-zinc-100 border-zinc-900 shadow-2xl gap-0 overflow-hidden outline-none sm:rounded-xl">
                <DialogTitle className="sr-only">Detalhes da Tarefa</DialogTitle>
                <DialogDescription className="sr-only">Detalhes completos da tarefa selecionada.</DialogDescription>

                {/* HEADER */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-900 bg-zinc-950 shrink-0 h-16">
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => onCompleteTask(task.gid, !task.completed)}
                            variant={task.completed ? "default" : "outline"}
                            className={`h-9 gap-2 transition-all font-medium ${task.completed
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                                : 'bg-transparent border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-white hover:border-zinc-500'
                                }`}
                        >
                            <CheckCircle2 className={`w-4 h-4 ${task.completed ? 'fill-current' : ''}`} />
                            {task.completed ? "Concluída" : "Marcar como finalizada"}
                        </Button>
                    </div>

                    <div className="flex items-center gap-1 text-zinc-400">
                        {/* Timer Widget */}
                        <div className={`flex items-center gap-2 rounded-md px-3 py-1 mr-2 transition-all ${activeTimerId === task.gid ? 'bg-purple-900/20 text-purple-400 ring-1 ring-purple-500/50' : 'hover:bg-zinc-900'}`}>
                            <span className="font-mono text-sm font-medium w-[4ch] text-center">{formatTimer(timers[task.gid] || 0)}</span>
                            <Button size="icon" variant="ghost" className={`h-7 w-7 rounded-md hover:bg-white/10 ${activeTimerId === task.gid ? 'text-purple-400' : 'text-zinc-500'}`} onClick={() => onToggleTimer(task.gid)}>
                                {activeTimerId === task.gid ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current pl-0.5" />}
                            </Button>
                        </div>

                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-zinc-800 hover:text-zinc-200" title="Anexar">
                            <Paperclip className="w-4 h-4" />
                        </Button>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-zinc-800 hover:text-zinc-200">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-zinc-300">
                                <DropdownMenuItem onClick={() => onDeleteTask(task.gid)} className="text-red-400 hover:text-red-300 focus:text-red-300 focus:bg-red-950/30 cursor-pointer">
                                    <Trash2 className="w-4 h-4 mr-2" /> Excluir tarefa
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-zinc-800 hover:text-zinc-200" onClick={onClose} title="Fechar">
                            <PanelRightClose className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* MAIN CONTENT */}
                <div className="flex-1 overflow-hidden flex flex-col md:flex-row relative">
                    <ScrollArea className="flex-1 h-full w-full">
                        <div className="px-8 py-8 w-full max-w-4xl mx-auto space-y-8 pb-32">

                            {/* TITLE */}
                            <div>
                                <Input
                                    value={titleText}
                                    onChange={(e) => setTitleText(e.target.value)}
                                    onBlur={() => task.name !== titleText && onUpdateTask(task.gid, 'name', titleText)}
                                    className="text-3xl font-bold bg-transparent border-none p-0 h-auto focus-visible:ring-0 placeholder:text-zinc-700 text-zinc-100"
                                    placeholder="Nome da tarefa"
                                />
                            </div>

                            {/* FIELDS GRID (Label -> Value Row Style) */}
                            <div className="grid gap-4 max-w-2xl">

                                {/* ASSIGNEE */}
                                <div className="grid grid-cols-[140px_1fr] items-center">
                                    <div className="text-sm text-zinc-500 font-medium">Responsável</div>
                                    <div className="flex items-center">
                                        <Select value={task.assignee?.gid || "unassigned"} onValueChange={(val) => onUpdateTask(task.gid, 'assignee', val)}>
                                            <SelectTrigger className="w-fit min-w-[200px] h-9 bg-transparent hover:bg-zinc-900 border-transparent hover:border-zinc-800 text-sm rounded-lg transition-all focus:ring-0 focus:ring-offset-0 px-2 -ml-2">
                                                <div className="flex items-center gap-2">
                                                    {task.assignee?.gid && task.assignee.gid !== 'unassigned' ? (
                                                        <>
                                                            <Avatar className="h-6 w-6 border border-zinc-800">
                                                                <AvatarImage src={task.assignee?.photo?.image_60x60} />
                                                                <AvatarFallback className="text-[10px] bg-zinc-800 text-zinc-400">
                                                                    {task.assignee?.name?.substring(0, 2).toUpperCase()}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <span className="text-zinc-200">{task.assignee?.name}</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="h-6 w-6 rounded-full border border-dashed border-zinc-600 flex items-center justify-center">
                                                                <User className="h-3 w-3 text-zinc-500" />
                                                            </div>
                                                            <span className="text-zinc-500">Não atribuído</span>
                                                        </>
                                                    )}
                                                </div>
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-300">
                                                {users.map(u => (<SelectItem key={u.gid} value={u.gid} className="focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer">{u.name}</SelectItem>))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* DUE DATE */}
                                <div className="grid grid-cols-[140px_1fr] items-center">
                                    <div className="text-sm text-zinc-500 font-medium">Data de entrega</div>
                                    <div className="flex items-center gap-2">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    className={`h-9 px-2 -ml-2 rounded-lg hover:bg-zinc-900 justify-start font-normal ${task.due_on ? (isBefore(fromAsanaDate(task.due_at || task.due_on), new Date()) && !task.completed ? "text-red-400" : "text-zinc-200") : "text-zinc-500"
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div className={`h-6 w-6 rounded-full border border-dashed flex items-center justify-center ${task.due_on ? 'border-transparent bg-zinc-800' : 'border-zinc-600'}`}>
                                                            <CalendarClock className="h-3 w-3" />
                                                        </div>
                                                        <span>{formatTaskDate(task) || "Sem data"}</span>
                                                    </div>
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="p-0 bg-zinc-950 border-zinc-800 w-auto" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={task.due_on ? fromAsanaDate(task.due_on) : undefined}
                                                    onSelect={(date) => date && onUpdateTask(task.gid, 'due_on', format(date, 'yyyy-MM-dd'))}
                                                    className="bg-zinc-950 text-zinc-100"
                                                />
                                            </PopoverContent>
                                        </Popover>

                                        {task.due_on && (
                                            <Input
                                                type="time"
                                                value={editingTime}
                                                onChange={(e) => {
                                                    setEditingTime(e.target.value);
                                                    if (task.due_on && e.target.value) {
                                                        const localDate = createLocalDate(task.due_on, e.target.value);
                                                        onUpdateTask(task.gid, 'due_at', toAsanaUTC(localDate));
                                                    }
                                                }}
                                                className="w-20 h-8 bg-transparent border-transparent hover:bg-zinc-900 hover:border-zinc-800 text-xs text-zinc-400 focus:text-zinc-200 rounded-md p-1"
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* PROJECTS */}
                                <div className="grid grid-cols-[140px_1fr] items-center">
                                    <div className="text-sm text-zinc-500 font-medium">Projetos</div>
                                    <div className="flex flex-wrap items-center gap-2 -ml-2 px-2">
                                        {task.projects?.map(p => (
                                            <div key={p.gid} className={`text-xs px-2.5 py-1 rounded-full font-medium cursor-default opacity-90 hover:opacity-100 ${getColorClass(p.color)}`}>
                                                {p.name}
                                            </div>
                                        ))}
                                        <Select onValueChange={(val) => onAddProject(task.gid, val)}>
                                            <SelectTrigger className="w-6 h-6 p-0 rounded-full border border-dashed border-zinc-600 flex items-center justify-center hover:border-zinc-400 hover:bg-zinc-900 transition-colors focus:ring-0">
                                                <Plus className="w-3 h-3 text-zinc-500" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-300">
                                                {projects.map(p => <SelectItem key={p.gid} value={p.gid}>{p.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* DESCRIPTION */}
                                <div className="grid grid-cols-[140px_1fr] items-start pt-4">
                                    <div className="text-sm text-zinc-500 font-medium pt-2">Descrição</div>
                                    <div className="group min-h-[100px] w-full rounded-lg border border-transparent hover:border-zinc-800 hover:bg-zinc-900/30 transition-all p-3 -ml-3">
                                        <TiptapEditor
                                            value={descText}
                                            onChange={(val) => { setDescText(val); }}
                                            className="min-h-[100px] bg-transparent border-none overflow-hidden text-sm text-zinc-300 leading-relaxed outline-none"
                                            placeholder="Adicione mais detalhes a esta tarefa..."
                                        />
                                        {/* Always visible save button if text exists or edited */}
                                        <div className="flex justify-end pt-4">
                                            <Button
                                                size="sm"
                                                onClick={() => onUpdateTask(task.gid, 'notes', descText)}
                                                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs h-7"
                                            >
                                                Salvar Alterações
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* DIVIDER */}
                            <div className="h-px bg-zinc-900 w-full" />

                            {/* SUBTASKS */}
                            <div>
                                <h3 className="text-sm font-medium text-zinc-100 mb-4 flex items-center gap-2">
                                    Subtarefas
                                </h3>
                                <div className="bg-zinc-900/20 rounded-xl border border-zinc-900/50 p-1">
                                    <SubtaskList parentTask={task} />
                                </div>
                            </div>

                            {/* DIVIDER */}
                            <div className="h-px bg-zinc-900 w-full" />

                            {/* ACTIVITY FEED */}
                            <div>
                                <div className="flex items-start gap-3 mb-8">
                                    <Avatar className="h-8 w-8 mt-1 border border-zinc-800">
                                        <AvatarImage src={currentUser?.photo?.image_60x60} />
                                        <AvatarFallback className="bg-purple-900 text-purple-200">EU</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/30 focus-within:bg-zinc-900 focus-within:border-zinc-700 transition-all overflow-hidden group">
                                        <TiptapEditor
                                            value={newComment}
                                            onChange={setNewComment}
                                            placeholder="Faça uma pergunta ou publique uma atualização..."
                                            className="w-full min-h-[60px] bg-transparent border-none p-3 text-sm text-zinc-200 placeholder:text-zinc-600"
                                        />
                                        <div className="flex items-center justify-between p-2 bg-zinc-900/50 border-t border-zinc-800/50 opacity-100">
                                            <div {...getRootProps()} className="cursor-pointer p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors" title="Anexar arquivos">
                                                <input {...getInputProps()} />
                                                <Paperclip className="w-4 h-4" />
                                            </div>
                                            <Button
                                                size="sm"
                                                onClick={handleSendComment}
                                                disabled={sending || !newComment.trim()}
                                                className="h-7 px-4 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-md disabled:opacity-50"
                                            >
                                                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Comentar"}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    {/* User Comments */}
                                    {userComments.map(story => (
                                        <div key={story.gid} className="group flex gap-3">
                                            <Avatar className="h-8 w-8 mt-1 border border-zinc-800">
                                                <AvatarImage src={story.created_by.photo?.image_60x60} />
                                                <AvatarFallback className="bg-zinc-800 text-zinc-500 text-xs">
                                                    {story.created_by.name?.substring(0, 2).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-sm text-zinc-200">{story.created_by.name}</span>
                                                    <span className="text-xs text-zinc-500">{formatDistanceToNow(new Date(story.created_at), { addSuffix: true, locale: ptBR })}</span>
                                                    {currentUser?.gid && story.created_by.gid && String(currentUser.gid) === String(story.created_by.gid) && (
                                                        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 -ml-1" onClick={() => handleDeleteComment(story.gid)}>
                                                            <Trash2 className="w-3 h-3" />
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className="text-sm text-zinc-300 leading-relaxed bg-zinc-900/30 rounded-lg p-3 border border-zinc-900 inline-block max-w-full">
                                                    <RichTextRenderer text={story.text} />
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* System Activity */}
                                    {activityStories.length > 0 && (
                                        <div className="relative py-4">
                                            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-zinc-900" /></div>
                                            <div className="relative flex justify-center text-xs uppercase tracking-wider"><span className="bg-zinc-950 px-2 text-zinc-600 font-medium">Histórico</span></div>
                                        </div>
                                    )}
                                    <div className="space-y-1 pl-2">
                                        {activityStories.map(story => (
                                            <div key={story.gid} className="flex items-center gap-2 text-[11px] text-zinc-500 py-0.5">
                                                <div className="h-1.5 w-1.5 rounded-full bg-zinc-800" />
                                                <span className="font-medium text-zinc-400">{story.created_by.name}</span>
                                                <span className="text-zinc-600"><RichTextRenderer text={story.text} /></span>
                                                <span className="opacity-40 tabular-nums">{format(new Date(story.created_at), "HH:mm")}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
}
