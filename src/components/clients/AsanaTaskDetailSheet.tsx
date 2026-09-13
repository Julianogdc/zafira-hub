import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ClientAsanaTask,
  AsanaUser,
  AsanaSection,
  AsanaSubtask,
  AsanaStory,
  AsanaAttachment,
  asanaIntegrationService,
  UpdateAsanaTaskInput,
} from '@/services/asana';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  Calendar,
  User,
  ExternalLink,
  FolderGit2,
  Tag,
  Sliders,
  Loader2,
  X,
  FileText,
  Layers,
  ArrowRightLeft,
  CheckSquare,
  MessageSquare,
  History,
  Send,
  Plus,
  Check,
  Circle,
  Paperclip,
  Download,
  UploadCloud,
  File,
} from 'lucide-react';

interface AsanaTaskDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  task: ClientAsanaTask | null;
  clientId: string;
  canManage: boolean;
  workspaceUsers: AsanaUser[];
  onTaskUpdated: (updatedTask: ClientAsanaTask) => void;
}

export function AsanaTaskDetailSheet({
  isOpen,
  onClose,
  task,
  clientId,
  canManage,
  workspaceUsers,
  onTaskUpdated,
}: AsanaTaskDetailSheetProps) {
  const [fullTask, setFullTask] = useState<ClientAsanaTask | null>(task);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingComplete, setIsTogglingComplete] = useState(false);
  const [isMovingSection, setIsMovingSection] = useState(false);

  // Seções disponíveis no projeto da tarefa
  const [projectSections, setProjectSections] = useState<AsanaSection[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);

  // Subtarefas
  const [subtasks, setSubtasks] = useState<AsanaSubtask[]>([]);
  const [isLoadingSubtasks, setIsLoadingSubtasks] = useState(false);
  const [newSubtaskName, setNewSubtaskName] = useState('');
  const [isCreatingSubtask, setIsCreatingSubtask] = useState(false);

  // Anexos (Cloud Asana)
  const [attachments, setAttachments] = useState<AsanaAttachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Comentários e Histórico (Stories)
  const [stories, setStories] = useState<AsanaStory[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Tags do workspace e gerenciamento
  const [workspaceTags, setWorkspaceTags] = useState<AsanaTag[]>([]);
  const [isAddingTag, setIsAddingTag] = useState(false);

  // Dependências da Tarefa
  const [dependencies, setDependencies] = useState<AsanaDependency[]>([]);
  const [isLoadingDependencies, setIsLoadingDependencies] = useState(false);

  // Valores de Campos Personalizados editados
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});

  // Aba ativa
  const [activeTab, setActiveTab] = useState<'geral' | 'subtarefas' | 'anexos' | 'atividades'>('geral');

  // Campos de edição local
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [assigneeGid, setAssigneeGid] = useState<string>('unassigned');
  const [sectionGid, setSectionGid] = useState<string>('none');

  // Inicializa o formulário com a tarefa selecionada e busca dados completos
  useEffect(() => {
    if (task && isOpen) {
      setFullTask(task);
      setName(task.name || '');
      setNotes(task.notes || '');
      setDueOn(task.dueOn ? task.dueOn.split('T')[0] : '');
      setAssigneeGid(task.assignee?.gid || 'unassigned');
      setSectionGid(task.sectionGid || 'none');
      setCustomFieldValues({});

      // Busca tags do workspace
      asanaIntegrationService
        .getWorkspaceTags()
        .then((tags) => setWorkspaceTags(tags))
        .catch(() => {});

      // Busca dependências da tarefa
      setIsLoadingDependencies(true);
      asanaIntegrationService
        .getTaskDependencies(clientId, task.gid)
        .then((deps) => setDependencies(deps))
        .catch(() => {})
        .finally(() => setIsLoadingDependencies(false));

      // Busca seções do projeto correspondente
      if (task.projectGid) {
        setIsLoadingSections(true);
        asanaIntegrationService
          .getProjectSections(clientId, task.projectGid)
          .then((secs) => {
            setProjectSections(secs);
          })
          .catch((err) => {
            console.warn('[AsanaTaskDetailSheet] Erro ao buscar seções do projeto:', err);
          })
          .finally(() => {
            setIsLoadingSections(false);
          });
      }

      // Busca subtarefas
      setIsLoadingSubtasks(true);
      asanaIntegrationService
        .getTaskSubtasks(clientId, task.gid)
        .then((items) => {
          setSubtasks(items);
        })
        .catch((err) => {
          console.warn('[AsanaTaskDetailSheet] Erro ao buscar subtarefas:', err);
        })
        .finally(() => {
          setIsLoadingSubtasks(false);
        });

      // Busca comentários e histórico (stories)
      setIsLoadingStories(true);
      asanaIntegrationService
        .getTaskStories(clientId, task.gid)
        .then((items) => {
          setStories(items);
        })
        .catch((err) => {
          console.warn('[AsanaTaskDetailSheet] Erro ao buscar stories:', err);
        })
        .finally(() => {
          setIsLoadingStories(false);
        });

      // Busca anexos do Asana Cloud
      setIsLoadingAttachments(true);
      asanaIntegrationService
        .getTaskAttachments(clientId, task.gid)
        .then((items) => {
          setAttachments(items);
        })
        .catch((err) => {
          console.warn('[AsanaTaskDetailSheet] Erro ao buscar anexos:', err);
        })
        .finally(() => {
          setIsLoadingAttachments(false);
        });

      // Busca dados enriquecidos (notes, tags, custom_fields) da API
      setIsLoadingDetails(true);
      asanaIntegrationService
        .getSingleTask(clientId, task.gid)
        .then((detailed) => {
          if (detailed) {
            setFullTask(detailed);
            setName(detailed.name || '');
            setNotes(detailed.notes || '');
            setDueOn(detailed.dueOn ? detailed.dueOn.split('T')[0] : '');
            setAssigneeGid(detailed.assignee?.gid || 'unassigned');
            setSectionGid(detailed.sectionGid || 'none');
          }
        })
        .catch((err) => {
          console.warn('[AsanaTaskDetailSheet] Erro ao buscar detalhes da tarefa:', err);
        })
        .finally(() => {
          setIsLoadingDetails(false);
        });
    }
  }, [task, isOpen, clientId]);

  if (!task) return null;

  const currentTask = fullTask || task;

  // Formatação amigável de data
  const formatDateDisplay = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Alternar Conclusão / Reabertura com Optimistic Update
  const handleToggleComplete = async () => {
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem alterar tarefas.');
      return;
    }

    const previousTask = { ...currentTask };
    const nextCompleted = !currentTask.completed;

    // 1. Optimistic update local
    const optimisticTask: ClientAsanaTask = {
      ...currentTask,
      completed: nextCompleted,
      isOverdue: nextCompleted ? false : currentTask.isOverdue,
    };
    setFullTask(optimisticTask);
    onTaskUpdated(optimisticTask);

    try {
      setIsTogglingComplete(true);
      const updated = await asanaIntegrationService.updateTask(clientId, currentTask.gid, {
        completed: nextCompleted,
      });

      setFullTask(updated);
      onTaskUpdated(updated);
      toast.success(nextCompleted ? 'Tarefa concluída!' : 'Tarefa reaberta!');
    } catch (err: any) {
      // Rollback em caso de falha
      setFullTask(previousTask);
      onTaskUpdated(previousTask);
      toast.error(`Falha ao alterar status da tarefa: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsTogglingComplete(false);
    }
  };

  // Salvar Edição Geral (Nome, Descrição, Prazo, Responsável)
  const handleSaveChanges = async () => {
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem editar tarefas.');
      return;
    }

    if (!name.trim()) {
      toast.error('O nome da tarefa não pode ficar vazio.');
      return;
    }

    const previousTask = { ...currentTask };
    const targetAssignee =
      assigneeGid === 'unassigned'
        ? null
        : workspaceUsers.find((u) => u.gid === assigneeGid);

    // 1. Optimistic update
    const optimisticTask: ClientAsanaTask = {
      ...currentTask,
      name: name.trim(),
      notes: notes.trim(),
      dueOn: dueOn || null,
      assignee: targetAssignee
        ? {
            gid: targetAssignee.gid,
            name: targetAssignee.name,
            photoUrl: targetAssignee.photoUrl || null,
          }
        : null,
    };

    setFullTask(optimisticTask);
    onTaskUpdated(optimisticTask);

    const payload: UpdateAsanaTaskInput = {
      name: name.trim(),
      notes: notes.trim(),
      due_on: dueOn || null,
      assignee: assigneeGid === 'unassigned' ? null : assigneeGid,
      custom_fields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
    };

    try {
      setIsSaving(true);
      const updated = await asanaIntegrationService.updateTask(clientId, currentTask.gid, payload);

      setFullTask(updated);
      onTaskUpdated(updated);
      toast.success('Tarefa atualizada com sucesso!');
    } catch (err: any) {
      // Rollback
      setFullTask(previousTask);
      onTaskUpdated(previousTask);
      setName(previousTask.name || '');
      setNotes(previousTask.notes || '');
      setDueOn(previousTask.dueOn ? previousTask.dueOn.split('T')[0] : '');
      setAssigneeGid(previousTask.assignee?.gid || 'unassigned');
      toast.error(`Falha ao salvar alterações: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Adicionar Tag à Tarefa
  const handleAddTag = async (tagGid: string) => {
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem vincular tags.');
      return;
    }
    if (!tagGid) return;
    const tagToAdd = workspaceTags.find((t) => t.gid === tagGid);
    if (!tagToAdd) return;

    if (currentTask.tags?.some((t) => t.gid === tagGid)) {
      toast.info('Esta tag já está vinculada à tarefa.');
      return;
    }

    const previousTags = currentTask.tags || [];
    const newTags = [...previousTags, tagToAdd];

    // Optimistic update
    const optimisticTask = { ...currentTask, tags: newTags };
    setFullTask(optimisticTask);
    onTaskUpdated(optimisticTask);

    try {
      setIsAddingTag(true);
      await asanaIntegrationService.addTagToTask(clientId, currentTask.gid, tagGid);
      toast.success(`Tag #${tagToAdd.name} vinculada!`);
    } catch (err: any) {
      // Rollback
      const rollbackTask = { ...currentTask, tags: previousTags };
      setFullTask(rollbackTask);
      onTaskUpdated(rollbackTask);
      toast.error(`Falha ao vincular tag: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsAddingTag(false);
    }
  };

  // Remover Tag da Tarefa
  const handleRemoveTag = async (tagGid: string) => {
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem remover tags.');
      return;
    }

    const previousTags = currentTask.tags || [];
    const targetTag = previousTags.find((t) => t.gid === tagGid);
    const newTags = previousTags.filter((t) => t.gid !== tagGid);

    // Optimistic update
    const optimisticTask = { ...currentTask, tags: newTags };
    setFullTask(optimisticTask);
    onTaskUpdated(optimisticTask);

    try {
      await asanaIntegrationService.removeTagFromTask(clientId, currentTask.gid, tagGid);
      toast.success(`Tag #${targetTag?.name || ''} removida!`);
    } catch (err: any) {
      // Rollback
      const rollbackTask = { ...currentTask, tags: previousTags };
      setFullTask(rollbackTask);
      onTaskUpdated(rollbackTask);
      toast.error(`Falha ao remover tag: ${err?.message || 'Erro no Asana'}`);
    }
  };

  // Mover Tarefa de Seção com Optimistic Update e Rollback
  const handleSectionChange = async (newSectionGid: string) => {
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem alterar a seção.');
      return;
    }
    if (newSectionGid === 'none' || newSectionGid === currentTask.sectionGid) return;

    const previousTask = { ...currentTask };
    const targetSection = projectSections.find((s) => s.gid === newSectionGid);
    const newSectionName = targetSection ? targetSection.name : currentTask.sectionName;

    // 1. Optimistic update
    const optimisticTask: ClientAsanaTask = {
      ...currentTask,
      sectionGid: newSectionGid,
      sectionName: newSectionName,
    };
    setFullTask(optimisticTask);
    setSectionGid(newSectionGid);
    onTaskUpdated(optimisticTask);

    try {
      setIsMovingSection(true);
      const updated = await asanaIntegrationService.moveTaskSection(clientId, currentTask.gid, newSectionGid);
      setFullTask(updated);
      setSectionGid(updated.sectionGid || newSectionGid);
      onTaskUpdated(updated);
      toast.success(`Tarefa movida para a seção "${newSectionName}"`);
    } catch (err: any) {
      // Rollback
      setFullTask(previousTask);
      setSectionGid(previousTask.sectionGid || 'none');
      onTaskUpdated(previousTask);
      toast.error(`Falha ao mover seção: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsMovingSection(false);
    }
  };

  // Alternar conclusão de Subtarefa (Optimistic Update + Rollback)
  const handleToggleSubtaskComplete = async (subtask: AsanaSubtask) => {
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem alterar subtarefas.');
      return;
    }

    const previousSubtasks = [...subtasks];
    const nextCompleted = !subtask.completed;

    // Optimistic update
    setSubtasks((prev) =>
      prev.map((s) => (s.gid === subtask.gid ? { ...s, completed: nextCompleted } : s))
    );

    try {
      await asanaIntegrationService.updateTask(clientId, subtask.gid, {
        completed: nextCompleted,
      });
      toast.success(nextCompleted ? 'Subtarefa concluída!' : 'Subtarefa reaberta!');
    } catch (err: any) {
      // Rollback
      setSubtasks(previousSubtasks);
      toast.error(`Falha ao atualizar subtarefa: ${err?.message || 'Erro no Asana'}`);
    }
  };

  // Criar nova Subtarefa
  const handleCreateSubtask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem criar subtarefas.');
      return;
    }
    if (!newSubtaskName.trim()) {
      toast.error('O nome da subtarefa não pode ficar vazio.');
      return;
    }

    try {
      setIsCreatingSubtask(true);
      const created = await asanaIntegrationService.createTaskSubtask(clientId, currentTask.gid, {
        name: newSubtaskName.trim(),
      });
      setSubtasks((prev) => [...prev, created]);
      setNewSubtaskName('');
      toast.success('Subtarefa adicionada com sucesso!');
    } catch (err: any) {
      toast.error(`Falha ao criar subtarefa: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsCreatingSubtask(false);
    }
  };

  // Adicionar Comentário no Asana
  const handlePostComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem comentar.');
      return;
    }
    if (!newCommentText.trim()) {
      toast.error('O comentário não pode ficar vazio.');
      return;
    }

    try {
      setIsPostingComment(true);
      const created = await asanaIntegrationService.addTaskComment(
        clientId,
        currentTask.gid,
        newCommentText.trim()
      );
      setStories((prev) => [...prev, created]);
      setNewCommentText('');
      toast.success('Comentário publicado no Asana!');
    } catch (err: any) {
      toast.error(`Falha ao publicar comentário: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsPostingComment(false);
    }
  };

  // Upload de Anexo direto ao Asana Cloud
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canManage) {
      toast.error('Apenas Administradores e Gestores podem anexar arquivos.');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      toast.error('O arquivo excede o limite de 25MB permitido pela API do Asana.');
      return;
    }

    try {
      setIsUploadingAttachment(true);
      const uploaded = await asanaIntegrationService.uploadTaskAttachment(
        clientId,
        currentTask.gid,
        file
      );
      setAttachments((prev) => [uploaded, ...prev]);
      toast.success(`Arquivo "${file.name}" anexado com sucesso no Asana Cloud!`);
    } catch (err: any) {
      toast.error(`Falha no upload do anexo: ${err?.message || 'Erro no Asana'}`);
    } finally {
      setIsUploadingAttachment(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes || bytes <= 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl bg-zinc-950 border-white/10 text-zinc-100 p-0 flex flex-col z-50 shadow-2xl overflow-hidden"
      >
        {/* CABEÇALHO DO SHEET */}
        <SheetHeader className="p-6 border-b border-white/10 bg-zinc-900/40 space-y-3">
          <div className="flex items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Badge de Projeto */}
              <Badge
                variant="outline"
                className="bg-white/5 border-white/10 text-zinc-300 text-[11px] gap-1.5 py-1 px-2.5 font-normal"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-emerald-400" />
                {currentTask.projectName}
              </Badge>

              {/* Badge de Status */}
              {currentTask.completed ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] gap-1.5 py-1 px-2.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Concluída
                </Badge>
              ) : currentTask.isOverdue ? (
                <Badge
                  variant="outline"
                  className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] gap-1.5 py-1 px-2.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Atrasada
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] gap-1.5 py-1 px-2.5"
                >
                  <Clock className="w-3.5 h-3.5" /> Pendente
                </Badge>
              )}

              {/* Seletor ou Badge de Seção */}
              {canManage && projectSections.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={sectionGid}
                    onValueChange={handleSectionChange}
                    disabled={isMovingSection}
                  >
                    <SelectTrigger className="bg-zinc-800/80 border-white/10 text-zinc-300 text-[11px] h-7 px-2.5 gap-1.5 font-normal hover:bg-zinc-800 focus:ring-emerald-500/50">
                      <Layers className="w-3 h-3 text-zinc-400" />
                      <SelectValue placeholder="Selecionar seção" />
                      {isMovingSection && <Loader2 className="w-2.5 h-2.5 animate-spin text-emerald-400 ml-1" />}
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-white/10 text-zinc-200">
                      {projectSections.map((s) => (
                        <SelectItem key={s.gid} value={s.gid} className="text-xs">
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : currentTask.sectionName ? (
                <Badge
                  variant="outline"
                  className="bg-zinc-800/80 border-white/10 text-zinc-400 text-[11px] gap-1 py-1 px-2 font-normal"
                  title="Seção do projeto no Asana"
                >
                  <Layers className="w-3 h-3 text-zinc-500" />
                  {currentTask.sectionName}
                </Badge>
              ) : null}
            </div>

            {isLoadingDetails && (
              <span className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                Carregando...
              </span>
            )}
          </div>

          {/* Nome da Tarefa Editável */}
          <div className="space-y-1">
            <SheetTitle className="sr-only">Detalhe da Tarefa: {name}</SheetTitle>
            <SheetDescription className="sr-only">Visualização e edição da tarefa Asana</SheetDescription>
            {canManage ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome da tarefa"
                className="text-base font-semibold text-white bg-zinc-900/80 border-white/10 focus-visible:ring-emerald-500/50 h-10 px-3"
              />
            ) : (
              <h2 className="text-base font-semibold text-white leading-snug px-1">
                {currentTask.name}
              </h2>
            )}
          </div>
        </SheetHeader>

        {/* CORPO DO SHEET COM SCROLL */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Grid de Metadados Principais (Responsável e Prazo) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-zinc-900/30 border border-white/5">
            {/* Responsável */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-zinc-500" />
                Responsável
              </label>

              {canManage ? (
                <Select value={assigneeGid} onValueChange={setAssigneeGid}>
                  <SelectTrigger className="bg-zinc-900 border-white/10 text-xs h-9 text-zinc-200">
                    <SelectValue placeholder="Selecione um responsável" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-zinc-200">
                    <SelectItem value="unassigned" className="text-zinc-500 text-xs">
                      Sem responsável
                    </SelectItem>
                    {workspaceUsers.map((u) => (
                      <SelectItem key={u.gid} value={u.gid} className="text-xs">
                        <div className="flex items-center gap-2">
                          {u.photoUrl ? (
                            <img src={u.photoUrl} alt={u.name} className="w-4 h-4 rounded-full" />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span>{u.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-xs text-zinc-300 flex items-center gap-2 h-9 px-3 rounded-md bg-zinc-900/60 border border-white/5">
                  {currentTask.assignee ? (
                    <>
                      {currentTask.assignee.photoUrl ? (
                        <img
                          src={currentTask.assignee.photoUrl}
                          alt={currentTask.assignee.name}
                          className="w-4 h-4 rounded-full"
                        />
                      ) : (
                        <User className="w-3.5 h-3.5 text-zinc-500" />
                      )}
                      <span>{currentTask.assignee.name}</span>
                    </>
                  ) : (
                    <span className="text-zinc-500">Sem responsável</span>
                  )}
                </div>
              )}
            </div>

            {/* Prazo */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                Prazo de Entrega
              </label>

              {canManage ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={dueOn}
                    onChange={(e) => setDueOn(e.target.value)}
                    className="bg-zinc-900 border-white/10 text-xs h-9 text-zinc-200 flex-1"
                  />
                  {dueOn && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDueOn('')}
                      className="h-9 px-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                      title="Remover prazo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-xs text-zinc-300 flex items-center gap-2 h-9 px-3 rounded-md bg-zinc-900/60 border border-white/5">
                  <span
                    className={
                      currentTask.isOverdue && !currentTask.completed
                        ? 'text-red-400 font-medium'
                        : 'text-zinc-300'
                    }
                  >
                    {formatDateDisplay(currentTask.dueOn || currentTask.dueAt)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Abas de Conteúdo: Geral, Subtarefas, Comentários & Atividades */}
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as any)}
            className="w-full space-y-4"
          >
            <TabsList className="bg-zinc-900/80 border border-white/10 p-1 w-full grid grid-cols-4 h-10 rounded-lg">
              <TabsTrigger
                value="geral"
                className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Geral</span>
              </TabsTrigger>
              <TabsTrigger
                value="subtarefas"
                className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center justify-center gap-1.5"
              >
                <CheckSquare className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Subtarefas</span>
                {subtasks.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-zinc-700 text-zinc-300">
                    {subtasks.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="anexos"
                className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center justify-center gap-1.5"
              >
                <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Anexos</span>
                {attachments.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-zinc-700 text-zinc-300">
                    {attachments.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="atividades"
                className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center justify-center gap-1.5"
              >
                <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Comentários</span>
                {stories.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-zinc-700 text-zinc-300">
                    {stories.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ABA 1: GERAL (Descrição, Tags, Campos Personalizados) */}
            <TabsContent value="geral" className="space-y-6 focus-visible:outline-none">
              {/* Descrição / Notes */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-zinc-500" />
                  Descrição / Notas da Tarefa
                </label>

                {canManage ? (
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Adicione detalhes, orientações ou notas para esta tarefa..."
                    rows={7}
                    className="bg-zinc-900/50 border-white/10 text-xs text-zinc-200 leading-relaxed resize-y focus-visible:ring-emerald-500/50"
                  />
                ) : (
                  <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-white/5 text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed min-h-[100px]">
                    {currentTask.notes || (
                      <span className="text-zinc-600 italic">Nenhuma descrição informada no Asana.</span>
                    )}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-zinc-500" />
                    Tags ({currentTask.tags?.length || 0})
                  </label>

                  {/* Seletor de adição de Tag */}
                  {canManage && workspaceTags.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(tagGid) => handleAddTag(tagGid)}
                      disabled={isAddingTag}
                    >
                      <SelectTrigger className="bg-zinc-800/60 border-white/10 text-zinc-300 text-[11px] h-6 px-2 gap-1 font-normal hover:bg-zinc-800 w-auto">
                        <Plus className="w-3 h-3 text-emerald-400" />
                        <span>Adicionar tag</span>
                        {isAddingTag && <Loader2 className="w-2.5 h-2.5 animate-spin text-emerald-400 ml-1" />}
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-white/10 text-zinc-200">
                        {workspaceTags
                          .filter((wt) => !currentTask.tags?.some((t) => t.gid === wt.gid))
                          .map((wt) => (
                            <SelectItem key={wt.gid} value={wt.gid} className="text-xs">
                              #{wt.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {currentTask.tags && currentTask.tags.length > 0 ? (
                    currentTask.tags.map((tag) => (
                      <Badge
                        key={tag.gid}
                        variant="outline"
                        className="bg-white/5 border-white/10 text-zinc-300 text-[11px] py-0.5 pl-2 pr-1 font-normal flex items-center gap-1"
                      >
                        #{tag.name}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag.gid)}
                            className="text-zinc-500 hover:text-red-400 rounded p-0.5 transition-colors"
                            title="Remover tag"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-zinc-500 text-xs italic">Nenhuma tag vinculada.</span>
                  )}
                </div>
              </div>

              {/* Campos Personalizados (Editáveis) */}
              {currentTask.customFields && currentTask.customFields.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-zinc-500" />
                    Campos Personalizados ({currentTask.customFields.length})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentTask.customFields.map((cf) => {
                      const hasEnumOptions = Array.isArray(cf.enumOptions) && cf.enumOptions.length > 0;
                      const currentValue =
                        customFieldValues[cf.gid] !== undefined
                          ? customFieldValues[cf.gid]
                          : hasEnumOptions
                          ? cf.enumValue?.gid || 'none'
                          : cf.value || '';

                      return (
                        <div
                          key={cf.gid}
                          className="p-3 rounded-lg bg-zinc-900/40 border border-white/5 space-y-1.5"
                        >
                          <p className="text-[11px] font-medium text-zinc-400 truncate">{cf.name}</p>

                          {hasEnumOptions && canManage ? (
                            <Select
                              value={currentValue}
                              onValueChange={(val) => {
                                const targetOpt = cf.enumOptions?.find((o) => o.gid === val);
                                setCustomFieldValues((prev) => ({
                                  ...prev,
                                  [cf.gid]: val === 'none' ? null : val,
                                }));
                                if (fullTask) {
                                  const updatedFields = fullTask.customFields?.map((f) =>
                                    f.gid === cf.gid
                                      ? {
                                          ...f,
                                          value: targetOpt?.name || '',
                                          enumValue: targetOpt
                                            ? { gid: targetOpt.gid, name: targetOpt.name }
                                            : null,
                                        }
                                      : f
                                  );
                                  setFullTask({ ...fullTask, customFields: updatedFields });
                                }
                              }}
                            >
                              <SelectTrigger className="bg-zinc-900 border-white/10 text-xs h-8 text-zinc-200">
                                <SelectValue placeholder="Selecione uma opção" />
                              </SelectTrigger>
                              <SelectContent className="bg-zinc-900 border-white/10 text-zinc-200">
                                <SelectItem value="none" className="text-zinc-500 text-xs">
                                  Nenhum
                                </SelectItem>
                                {cf.enumOptions?.map((opt) => (
                                  <SelectItem key={opt.gid} value={opt.gid} className="text-xs">
                                    {opt.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : canManage ? (
                            <Input
                              value={currentValue}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCustomFieldValues((prev) => ({ ...prev, [cf.gid]: val }));
                                if (fullTask) {
                                  const updatedFields = fullTask.customFields?.map((f) =>
                                    f.gid === cf.gid ? { ...f, value: val } : f
                                  );
                                  setFullTask({ ...fullTask, customFields: updatedFields });
                                }
                              }}
                              placeholder="Valor do campo"
                              className="bg-zinc-900 border-white/10 text-xs h-8 text-zinc-200 px-2"
                            />
                          ) : (
                            <p className="text-xs text-zinc-200 font-medium truncate">
                              {cf.value || <span className="text-zinc-600 italic">Não preenchido</span>}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dependências de Tarefa */}
              {dependencies.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-zinc-500" />
                    Dependências ({dependencies.length})
                  </label>
                  <div className="space-y-1.5">
                    {dependencies.map((dep) => (
                      <div
                        key={dep.gid}
                        className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/40 border border-white/5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              dep.relationship === 'blocking'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]'
                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]'
                            }
                          >
                            {dep.relationship === 'blocking' ? 'Bloqueia esta' : 'Bloqueada por esta'}
                          </Badge>
                          <span
                            className={`truncate ${
                              dep.completed ? 'line-through text-zinc-500' : 'text-zinc-200'
                            }`}
                          >
                            {dep.name}
                          </span>
                        </div>
                        {dep.completed ? (
                          <Badge variant="outline" className="text-emerald-400 border-emerald-500/20 text-[10px]">
                            Concluída
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-zinc-400 border-white/10 text-[10px]">
                            Pendente
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ABA 2: SUBTAREFAS */}
            <TabsContent value="subtarefas" className="space-y-4 focus-visible:outline-none">
              {/* Criação de Subtarefa */}
              {canManage && (
                <form onSubmit={handleCreateSubtask} className="flex items-center gap-2">
                  <Input
                    value={newSubtaskName}
                    onChange={(e) => setNewSubtaskName(e.target.value)}
                    placeholder="Adicionar nova subtarefa..."
                    disabled={isCreatingSubtask}
                    className="bg-zinc-900 border-white/10 text-xs h-9 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-emerald-500/50"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isCreatingSubtask || !newSubtaskName.trim()}
                    className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shrink-0"
                  >
                    {isCreatingSubtask ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar
                      </>
                    )}
                  </Button>
                </form>
              )}

              {/* Lista de Subtarefas */}
              {isLoadingSubtasks ? (
                <div className="py-8 flex flex-col items-center justify-center text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Carregando subtarefas...</span>
                </div>
              ) : subtasks.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs italic bg-zinc-900/20 rounded-lg border border-white/5">
                  Nenhuma subtarefa cadastrada no Asana para esta demanda.
                </div>
              ) : (
                <div className="space-y-2">
                  {subtasks.map((st) => (
                    <div
                      key={st.gid}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleToggleSubtaskComplete(st)}
                          disabled={!canManage}
                          className={`w-5 h-5 rounded flex items-center justify-center border transition-colors shrink-0 ${
                            st.completed
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                              : 'border-zinc-700 hover:border-emerald-500/50 text-transparent'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <span
                          className={`text-xs truncate ${
                            st.completed ? 'line-through text-zinc-500' : 'text-zinc-200'
                          }`}
                        >
                          {st.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 text-[11px] text-zinc-400">
                        {st.assignee && (
                          <span className="flex items-center gap-1.5 bg-zinc-800/60 px-2 py-0.5 rounded text-zinc-300">
                            <User className="w-3 h-3 text-zinc-500" />
                            {st.assignee.name}
                          </span>
                        )}
                        {st.dueOn && (
                          <span className="flex items-center gap-1 bg-zinc-800/60 px-2 py-0.5 rounded text-zinc-300">
                            <Calendar className="w-3 h-3 text-zinc-500" />
                            {formatDateDisplay(st.dueOn)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ABA 3: ANEXOS (Cloud Asana sem retenção na VPS) */}
            <TabsContent value="anexos" className="space-y-4 focus-visible:outline-none">
              {/* Dropzone e Botão de Upload */}
              {canManage && (
                <div className="p-4 rounded-xl border border-dashed border-white/15 bg-zinc-900/20 hover:bg-zinc-900/40 transition-colors flex flex-col items-center justify-center gap-2.5 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={isUploadingAttachment}
                  />
                  <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    {isUploadingAttachment ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UploadCloud className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">
                      {isUploadingAttachment
                        ? 'Enviando arquivo diretamente ao Asana Cloud...'
                        : 'Faça upload de arquivos diretamente no Asana'}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      Suporte até 25MB por anexo. Nenhum arquivo é retido no servidor local do Hub.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isUploadingAttachment}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs gap-1.5 border border-white/10"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Selecionar Arquivo
                  </Button>
                </div>
              )}

              {/* Lista de Anexos */}
              {isLoadingAttachments ? (
                <div className="py-8 flex flex-col items-center justify-center text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Carregando anexos do Asana Cloud...</span>
                </div>
              ) : attachments.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs italic bg-zinc-900/20 rounded-lg border border-white/5">
                  Nenhum anexo associado a esta demanda no Asana.
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <div
                      key={att.gid}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                          <File className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-zinc-200 truncate">{att.name}</p>
                          <p className="text-[10px] text-zinc-500">
                            {formatFileSize(att.size)} • {formatDateDisplay(att.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {(att.downloadUrl || att.viewUrl || att.permanentUrl) && (
                          <Button
                            variant="outline"
                            size="sm"
                            asChild
                            className="h-7 px-2.5 text-xs text-zinc-300 border-white/10 hover:text-white hover:bg-white/5 gap-1.5"
                          >
                            <a
                              href={att.downloadUrl || att.viewUrl || att.permanentUrl || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Baixar ou abrir no Asana Cloud"
                            >
                              <Download className="w-3 h-3" />
                              Abrir
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ABA 4: COMENTÁRIOS E HISTÓRICO */}
            <TabsContent value="atividades" className="space-y-4 focus-visible:outline-none">
              {isLoadingStories ? (
                <div className="py-8 flex flex-col items-center justify-center text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Carregando comentários e histórico...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {stories.length === 0 ? (
                    <div className="py-6 text-center text-zinc-500 text-xs italic bg-zinc-900/20 rounded-lg border border-white/5">
                      Nenhum comentário ou atividade registrada no Asana ainda.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {stories.map((s) => (
                        <div
                          key={s.gid}
                          className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                            s.type === 'comment'
                              ? 'bg-zinc-900/60 border-white/10 space-y-1.5'
                              : 'bg-zinc-950/40 border-white/5 text-zinc-400 flex items-start gap-2.5 py-2'
                          }`}
                        >
                          {s.type === 'comment' ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {s.createdBy?.photoUrl ? (
                                    <img
                                      src={s.createdBy.photoUrl}
                                      alt={s.createdBy.name}
                                      className="w-5 h-5 rounded-full"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-semibold">
                                      {(s.createdBy?.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="font-medium text-zinc-200">
                                    {s.createdBy?.name || 'Usuário Asana'}
                                  </span>
                                </div>
                                <span className="text-[10px] text-zinc-500">
                                  {formatDateDisplay(s.createdAt)}
                                </span>
                              </div>
                              <p className="text-zinc-300 pl-7 whitespace-pre-wrap">{s.text}</p>
                            </>
                          ) : (
                            <>
                              <History className="w-3.5 h-3.5 text-zinc-600 mt-0.5 shrink-0" />
                              <div className="flex-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-zinc-400">{s.text}</span>
                                <span className="text-[10px] text-zinc-600 shrink-0">
                                  {formatDateDisplay(s.createdAt)}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Caixa de Envio de Comentário */}
                  {canManage && (
                    <form onSubmit={handlePostComment} className="pt-2 border-t border-white/10 space-y-2">
                      <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-zinc-500" />
                        Adicionar Comentário no Asana
                      </label>
                      <Textarea
                        value={newCommentText}
                        onChange={(e) => setNewCommentText(e.target.value)}
                        placeholder="Escreva um comentário para sincronizar diretamente com o Asana..."
                        rows={3}
                        disabled={isPostingComment}
                        className="bg-zinc-900 border-white/10 text-xs text-zinc-200 resize-none focus-visible:ring-emerald-500/50"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isPostingComment || !newCommentText.trim()}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 px-3 gap-1.5"
                        >
                          {isPostingComment ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Enviando...
                            </>
                          ) : (
                            <>
                              <Send className="w-3 h-3" />
                              Comentar
                            </>
                          )}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {!canManage && (
            <p className="text-[11px] text-zinc-500 italic text-center pt-2">
              Modo de leitura. Permissões de Administrador ou Gestor são necessárias para editar.
            </p>
          )}
        </div>

        {/* RODAPÉ COM AÇÕES */}
        <SheetFooter className="p-4 border-t border-white/10 bg-zinc-900/60 flex flex-row items-center justify-between sm:justify-between gap-2">
          {/* Botão Externo "Abrir no Asana" */}
          {currentTask.permalinkUrl && (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 text-xs h-9 gap-1.5"
            >
              <a href={currentTask.permalinkUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Abrir no</span> Asana
              </a>
            </Button>
          )}

          <div className="flex items-center gap-2">
            {/* Botão de Conclusão / Reabertura */}
            {canManage && (
              <Button
                type="button"
                variant={currentTask.completed ? 'outline' : 'default'}
                size="sm"
                onClick={handleToggleComplete}
                disabled={isTogglingComplete || isSaving}
                className={
                  currentTask.completed
                    ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs h-9 gap-1.5'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 gap-1.5'
                }
              >
                {isTogglingComplete ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : currentTask.completed ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reabrir
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Concluir
                  </>
                )}
              </Button>
            )}

            {/* Botão Salvar Alterações */}
            {canManage && (
              <Button
                type="button"
                size="sm"
                onClick={handleSaveChanges}
                disabled={isSaving || isTogglingComplete}
                className="bg-white text-zinc-900 hover:bg-zinc-200 text-xs h-9 px-4 font-medium gap-1.5 shadow-sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
