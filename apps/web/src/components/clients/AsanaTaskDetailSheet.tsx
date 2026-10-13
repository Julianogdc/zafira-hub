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
import { Badge } from '@/components/ui/badge';
import {
  ClientAsanaTask,
  AsanaSubtask,
  AsanaStory,
  AsanaAttachment,
  AsanaDependency,
  asanaIntegrationService,
} from '@/services/asana';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAsanaTaskLink, safeExternalUrl } from '@/lib/asana-task-view';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  User,
  ExternalLink,
  FolderGit2,
  Tag,
  Sliders,
  Loader2,
  FileText,
  Layers,
  ArrowRightLeft,
  CheckSquare,
  History,
  Circle,
  Paperclip,
  Download,
  File,
} from 'lucide-react';

interface AsanaTaskDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  task: ClientAsanaTask | null;
  clientId: string;
}

/**
 * Detalhe de tarefa Asana em modo SOMENTE LEITURA (DEC-ASANA-001 / F6-RO.0).
 * Toda edição é feita no próprio Asana, pelo link "Abrir no Asana".
 */
export function AsanaTaskDetailSheet({ isOpen, onClose, task, clientId }: AsanaTaskDetailSheetProps) {
  const [fullTask, setFullTask] = useState<ClientAsanaTask | null>(task);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const [subtasks, setSubtasks] = useState<AsanaSubtask[]>([]);
  const [isLoadingSubtasks, setIsLoadingSubtasks] = useState(false);

  const [attachments, setAttachments] = useState<AsanaAttachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);

  const [stories, setStories] = useState<AsanaStory[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);

  const [dependencies, setDependencies] = useState<AsanaDependency[]>([]);

  const [activeTab, setActiveTab] = useState<'geral' | 'subtarefas' | 'anexos' | 'atividades'>('geral');

  // Carrega os dados de leitura da tarefa selecionada
  useEffect(() => {
    if (task && isOpen) {
      setFullTask(task);

      asanaIntegrationService
        .getTaskDependencies(clientId, task.gid)
        .then((deps) => setDependencies(deps))
        .catch(() => {});

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

      // Dados enriquecidos (notes, tags, custom_fields)
      setIsLoadingDetails(true);
      asanaIntegrationService
        .getSingleTask(clientId, task.gid)
        .then((detailed) => {
          if (detailed) {
            setFullTask(detailed);
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
  const asanaLink = getAsanaTaskLink(currentTask);

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

              {/* Badge de Seção */}
              {currentTask.sectionName && (
                <Badge
                  variant="outline"
                  className="bg-zinc-800/80 border-white/10 text-zinc-400 text-[11px] gap-1 py-1 px-2.5 font-normal"
                  title="Seção do projeto no Asana"
                >
                  <Layers className="w-3 h-3 text-zinc-500" />
                  {currentTask.sectionName}
                </Badge>
              )}
            </div>

            {isLoadingDetails && (
              <span className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                Sincronizando...
              </span>
            )}
          </div>

          <div className="space-y-1">
            <SheetTitle className="sr-only">Detalhe da Tarefa: {currentTask.name}</SheetTitle>
            <SheetDescription className="sr-only">
              Visualização somente leitura de tarefa do Asana
            </SheetDescription>
            <h2 className="text-base sm:text-lg font-semibold text-white leading-snug px-1">
              {currentTask.name}
            </h2>
          </div>
        </SheetHeader>

        {/* CORPO DO SHEET COM SCROLL */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Responsável e Prazo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-zinc-900/30 border border-white/5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-zinc-500" />
                Responsável
              </label>
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
                      <div className="w-4 h-4 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                        {currentTask.assignee.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span>{currentTask.assignee.name}</span>
                  </>
                ) : (
                  <span className="text-zinc-500 italic">Não atribuído no Asana</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                Prazo de Entrega
              </label>
              <div className="text-xs text-zinc-300 flex items-center gap-2 h-9 px-3 rounded-md bg-zinc-900/60 border border-white/5">
                {currentTask.dueOn || currentTask.dueAt ? (
                  <span
                    className={
                      currentTask.isOverdue && !currentTask.completed
                        ? 'text-red-400 font-medium'
                        : 'text-zinc-300'
                    }
                  >
                    {formatDateDisplay(currentTask.dueOn || currentTask.dueAt)}
                  </span>
                ) : (
                  <span className="text-zinc-500 italic">Sem prazo definido</span>
                )}
              </div>
            </div>
          </div>

          {/* Abas de Conteúdo: Geral, Subtarefas, Anexos, Histórico */}
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
                <History className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Histórico</span>
                {stories.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-zinc-700 text-zinc-300">
                    {stories.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ABA 1: GERAL (Descrição, Tags, Campos Personalizados, Dependências) */}
            <TabsContent value="geral" className="space-y-6 focus-visible:outline-none">
              {/* Descrição exibida como texto escapado (sem HTML) */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-zinc-500" />
                  Descrição / Notas da Tarefa
                </label>
                <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 text-xs text-zinc-300 leading-relaxed min-h-[100px] whitespace-pre-wrap font-sans">
                  {currentTask.notes ? (
                    currentTask.notes
                  ) : (
                    <span className="text-zinc-600 italic">Nenhuma descrição informada no Asana.</span>
                  )}
                </div>
              </div>

              {/* Tags */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-zinc-500" />
                  Tags ({currentTask.tags?.length || 0})
                </label>

                <div className="flex flex-wrap gap-1.5">
                  {currentTask.tags && currentTask.tags.length > 0 ? (
                    currentTask.tags.map((tag) => (
                      <Badge
                        key={tag.gid}
                        variant="outline"
                        className="bg-white/5 border-white/10 text-zinc-300 text-[11px] py-0.5 px-2 font-normal"
                      >
                        #{tag.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-zinc-500 text-xs italic">Nenhuma tag vinculada no Asana.</span>
                  )}
                </div>
              </div>

              {/* Campos Personalizados */}
              {currentTask.customFields && currentTask.customFields.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-zinc-500" />
                    Campos Personalizados ({currentTask.customFields.length})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentTask.customFields.map((cf) => (
                      <div
                        key={cf.gid}
                        className="p-3 rounded-lg bg-zinc-900/40 border border-white/5 space-y-1"
                      >
                        <p className="text-[11px] font-medium text-zinc-400 truncate">{cf.name}</p>
                        <p className="text-xs text-zinc-200 font-medium truncate">
                          {cf.value || <span className="text-zinc-600 italic">Não preenchido</span>}
                        </p>
                      </div>
                    ))}
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
                        className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/40 border border-white/5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              dep.relationship === 'blocking'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            }`}
                          >
                            {dep.relationship === 'blocking' ? 'Bloqueia esta demanda' : 'Depende desta demanda'}
                          </Badge>
                          <span className={`text-zinc-200 ${dep.completed ? 'line-through text-zinc-500' : ''}`}>
                            {dep.name}
                          </span>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            dep.completed
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {dep.completed ? 'Concluída' : 'Pendente'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ABA 2: SUBTAREFAS */}
            <TabsContent value="subtarefas" className="space-y-4 focus-visible:outline-none">
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
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-white/5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {st.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-zinc-600 shrink-0" />
                        )}
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

            {/* ABA 3: ANEXOS (visualização e download) */}
            <TabsContent value="anexos" className="space-y-4 focus-visible:outline-none">
              {isLoadingAttachments ? (
                <div className="py-8 flex flex-col items-center justify-center text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Carregando anexos...</span>
                </div>
              ) : attachments.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs italic bg-zinc-900/20 rounded-lg border border-white/5">
                  Nenhum anexo encontrado nesta demanda no Asana.
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <div
                      key={att.gid}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
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

                      <div className="flex items-center gap-1.5 shrink-0">
                        {safeExternalUrl(att.downloadUrl || att.viewUrl) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="h-8 px-2.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 gap-1.5"
                          >
                            <a
                              href={safeExternalUrl(att.downloadUrl || att.viewUrl) || undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Baixar</span>
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ABA 4: HISTÓRICO E COMENTÁRIOS */}
            <TabsContent value="atividades" className="space-y-4 focus-visible:outline-none">
              {isLoadingStories ? (
                <div className="py-8 flex flex-col items-center justify-center text-zinc-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Carregando histórico...</span>
                </div>
              ) : stories.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs italic bg-zinc-900/20 rounded-lg border border-white/5">
                  Nenhum comentário ou atividade registrada no Asana.
                </div>
              ) : (
                <div className="space-y-3">
                  {stories.map((s) => (
                    <div
                      key={s.gid}
                      className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                        s.type === 'comment'
                          ? 'bg-zinc-900/50 border-white/10'
                          : 'bg-zinc-950/40 border-white/5 text-zinc-400'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] text-zinc-500">
                        <div className="flex items-center gap-2">
                          {s.createdBy ? (
                            <span className="font-medium text-zinc-300">{s.createdBy.name}</span>
                          ) : (
                            <span>Sistema Asana</span>
                          )}
                          <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                            {s.type === 'comment' ? 'Comentário' : 'Histórico'}
                          </span>
                        </div>
                        <span>{formatDateDisplay(s.createdAt)}</span>
                      </div>
                      <p className="text-zinc-200 leading-relaxed whitespace-pre-wrap">{s.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* RODAPÉ: edição apenas no próprio Asana */}
        <SheetFooter className="p-4 border-t border-white/10 bg-zinc-900/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            Somente leitura. Para editar esta tarefa, abra-a no Asana.
          </p>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 text-xs h-9 px-3"
            >
              Fechar
            </Button>

            {asanaLink && (
              <Button
                size="sm"
                variant="default"
                asChild
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-9 px-4 gap-2 shadow-sm font-medium"
              >
                <a href={asanaLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir no Asana
                </a>
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
