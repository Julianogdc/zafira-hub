import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Calendar, User, FolderGit2, Layers, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  asanaIntegrationService,
  ClientAsanaProject,
  ClientAsanaTask,
  AsanaSection,
  AsanaUser,
} from '@/services/asana';

interface CreateAsanaTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  projects: ClientAsanaProject[];
  onTaskCreated: (task: ClientAsanaTask) => void;
}

export function CreateAsanaTaskModal({
  isOpen,
  onClose,
  clientId,
  projects,
  onTaskCreated,
}: CreateAsanaTaskModalProps) {
  const [selectedProjectGid, setSelectedProjectGid] = useState<string>('');
  const [sections, setSections] = useState<AsanaSection[]>([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [selectedSectionGid, setSelectedSectionGid] = useState<string>('');

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [assigneeGid, setAssigneeGid] = useState<string>('');

  const [users, setUsers] = useState<AsanaUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inicializa o projeto selecionado quando abrir ou quando a lista de projetos mudar
  useEffect(() => {
    if (isOpen) {
      if (projects.length > 0 && !selectedProjectGid) {
        setSelectedProjectGid(projects[0].projectGid);
      }
      loadUsers();
    }
  }, [isOpen, projects]);

  // Carrega seções sempre que o projeto selecionado mudar
  useEffect(() => {
    if (isOpen && selectedProjectGid) {
      loadSections(selectedProjectGid);
    }
  }, [isOpen, selectedProjectGid]);

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const res = await asanaIntegrationService.getWorkspaceUsers();
      setUsers(Array.isArray(res) ? res : []);
    } catch (err) {
      console.warn('[CreateAsanaTaskModal] Falha ao carregar usuários:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadSections = async (projectGid: string) => {
    try {
      setLoadingSections(true);
      const data = await asanaIntegrationService.getProjectSections(clientId, projectGid);
      setSections(Array.isArray(data) ? data : []);
      if (data && data.length > 0) {
        setSelectedSectionGid(data[0].gid);
      } else {
        setSelectedSectionGid('');
      }
    } catch (err) {
      console.warn('[CreateAsanaTaskModal] Falha ao carregar seções do projeto:', err);
      setSections([]);
      setSelectedSectionGid('');
    } finally {
      setLoadingSections(false);
    }
  };

  const handleReset = () => {
    setName('');
    setNotes('');
    setDueOn('');
    setAssigneeGid('');
    setSelectedSectionGid(sections.length > 0 ? sections[0].gid : '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Informe o título da demanda.');
      return;
    }

    if (!selectedProjectGid) {
      toast.error('Selecione um projeto de destino.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        projectGid: selectedProjectGid,
        name: name.trim(),
        notes: notes.trim() ? notes.trim() : null,
        due_on: dueOn ? dueOn : null,
        assignee: assigneeGid ? assigneeGid : null,
        sectionGid: selectedSectionGid ? selectedSectionGid : null,
      };

      const created = await asanaIntegrationService.createTask(clientId, payload);
      toast.success('Demanda criada com sucesso no Asana!');
      onTaskCreated(created);
      handleReset();
      onClose();
    } catch (err: any) {
      console.error('[CreateAsanaTaskModal] Erro ao criar demanda:', err);
      toast.error(err?.message || 'Falha ao criar demanda no Asana.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="bg-zinc-950 border-white/10 text-white sm:max-w-lg shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-white text-base font-semibold">
                Nova Demanda no Asana
              </DialogTitle>
              <DialogDescription className="text-zinc-400 text-xs mt-0.5">
                Crie uma tarefa operacional diretamente sincronizada com o projeto no Asana.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Título da Demanda */}
          <div className="space-y-1.5">
            <Label htmlFor="task-name" className="text-xs font-medium text-zinc-300">
              Título da Demanda <span className="text-emerald-400">*</span>
            </Label>
            <Input
              id="task-name"
              placeholder="Ex: Elaborar campanha de lançamento Q4"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-900/60 border-white/10 text-white text-sm focus-visible:ring-emerald-500"
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          {/* Seleção de Projeto e Seção em Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Projeto de Destino */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <FolderGit2 className="w-3.5 h-3.5 text-zinc-400" />
                Projeto <span className="text-emerald-400">*</span>
              </Label>
              <Select
                value={selectedProjectGid}
                onValueChange={(val) => setSelectedProjectGid(val)}
                disabled={isSubmitting || projects.length === 0}
              >
                <SelectTrigger className="bg-zinc-900/60 border-white/10 text-xs text-white h-9">
                  <SelectValue placeholder="Selecione o projeto" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                  {projects.map((p) => (
                    <SelectItem key={p.projectGid} value={p.projectGid} className="text-xs focus:bg-white/10">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: p.color || '#10b981' }}
                        />
                        <span className="truncate">{p.projectName}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Seção / Etapa do Projeto */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                Seção / Etapa
              </Label>
              <Select
                value={selectedSectionGid}
                onValueChange={(val) => setSelectedSectionGid(val)}
                disabled={isSubmitting || loadingSections || sections.length === 0}
              >
                <SelectTrigger className="bg-zinc-900/60 border-white/10 text-xs text-white h-9">
                  {loadingSections ? (
                    <span className="flex items-center gap-1.5 text-zinc-400">
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                      Carregando seções...
                    </span>
                  ) : (
                    <SelectValue placeholder={sections.length === 0 ? 'Sem seções' : 'Selecione a seção'} />
                  )}
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                  {sections.map((s) => (
                    <SelectItem key={s.gid} value={s.gid} className="text-xs focus:bg-white/10">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Responsável e Prazo em Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Responsável */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-zinc-400" />
                Responsável
              </Label>
              <Select
                value={assigneeGid || 'none'}
                onValueChange={(val) => setAssigneeGid(val === 'none' ? '' : val)}
                disabled={isSubmitting || loadingUsers}
              >
                <SelectTrigger className="bg-zinc-900/60 border-white/10 text-xs text-white h-9">
                  {loadingUsers ? (
                    <span className="flex items-center gap-1.5 text-zinc-400">
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                      Carregando...
                    </span>
                  ) : (
                    <SelectValue placeholder="Não atribuído" />
                  )}
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                  <SelectItem value="none" className="text-xs text-zinc-400 focus:bg-white/10">
                    Não atribuído
                  </SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.gid} value={u.gid} className="text-xs focus:bg-white/10">
                      <div className="flex items-center gap-2">
                        {u.photoUrl ? (
                          <img src={u.photoUrl} alt={u.name} className="w-4 h-4 rounded-full" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-300">
                            {u.name.charAt(0)}
                          </div>
                        )}
                        <span className="truncate">{u.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data de Entrega / Prazo */}
            <div className="space-y-1.5">
              <Label htmlFor="task-due-on" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                Data de Entrega
              </Label>
              <Input
                id="task-due-on"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className="bg-zinc-900/60 border-white/10 text-white text-xs h-9 focus-visible:ring-emerald-500 [color-scheme:dark]"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Descrição / Notas Iniciais */}
          <div className="space-y-1.5">
            <Label htmlFor="task-notes" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              Descrição / Briefing
            </Label>
            <Textarea
              id="task-notes"
              placeholder="Descreva o objetivo, contexto e especificações desta demanda..."
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-zinc-900/60 border-white/10 text-white text-xs resize-none focus-visible:ring-emerald-500 leading-relaxed"
              disabled={isSubmitting}
            />
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 text-xs h-9"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !name.trim() || !selectedProjectGid}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-9 gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Criando Demanda...
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Criar Demanda no Asana
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
