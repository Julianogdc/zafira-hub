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
  asanaIntegrationService,
  UpdateAsanaTaskInput,
} from '@/services/asana';
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

          {/* Tags (Somente Leitura nesta etapa) */}
          {currentTask.tags && currentTask.tags.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-zinc-500" />
                Tags ({currentTask.tags.length})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {currentTask.tags.map((tag) => (
                  <Badge
                    key={tag.gid}
                    variant="outline"
                    className="bg-white/5 border-white/10 text-zinc-300 text-[11px] py-0.5 px-2 font-normal"
                  >
                    #{tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Campos Personalizados (Somente Leitura nesta etapa) */}
          {currentTask.customFields && currentTask.customFields.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-zinc-500" />
                Campos Personalizados ({currentTask.customFields.length})
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {currentTask.customFields.map((cf) => (
                  <div
                    key={cf.gid}
                    className="p-2.5 rounded-lg bg-zinc-900/40 border border-white/5 space-y-0.5"
                  >
                    <p className="text-[10px] text-zinc-500 truncate">{cf.name}</p>
                    <p className="text-xs font-medium text-zinc-200 truncate">{cf.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

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
