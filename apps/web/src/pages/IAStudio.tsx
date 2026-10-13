
import React, { useState, useEffect, useRef } from 'react';
import { useAIStore } from '@/store/useAIStore';
import { Brain, Plus, Settings2, Book, Trash2, Pencil } from 'lucide-react';
import { generateInsight } from '@/lib/ai-engine';
import { AIAnalysisType } from '@/types/ai';
import { AISettingsDialog } from '@/components/ia/AISettingsDialog';
import { IAPromptsDialog } from '@/components/ia/IAPromptsDialog';
import { IASidebar } from '@/components/ia/IASidebar';
import { IAChatArea } from '@/components/ia/IAChatArea';
import { useAIActionHandler } from '@/hooks/useAIActionHandler';
import { useAuthStore } from '@/store/useAuthStore';
import { PERSONAS, AIPersona } from '@/data/ai-personas';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreatePersonaDialog } from '@/components/ia/CreatePersonaDialog';
import { EditPersonaDialog } from '@/components/ia/EditPersonaDialog';
import * as LucideIcons from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Helper to resolve icon
const getIcon = (iconName: any) => {
  if (typeof iconName === 'string') {
    // @ts-ignore
    return LucideIcons[iconName] || LucideIcons.Bot;
  }
  return iconName;
};

const IAStudio = () => {
  const { user } = useAuthStore();
  const [inputValue, setInputValue] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPromptsOpen, setIsPromptsOpen] = useState(false);
  const [isCreatePersonaOpen, setIsCreatePersonaOpen] = useState(false);
  const [isEditPersonaOpen, setIsEditPersonaOpen] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");

  const {
    messages,
    sessions,
    currentSessionId,
    isAnalyzing,
    addMessage,
    setAnalyzing,
    createSession,
    loadSession,
    deleteSession,
    resetSession,
    customPersonas,
    fetchPersonas,
    deletePersona
  } = useAIStore();

  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Merge static and custom personas
  const allPersonas = [...PERSONAS, ...customPersonas];

  // Filter Personas based on Role
  const availablePersonas = user?.role === 'admin'
    ? allPersonas
    : allPersonas.filter(p => p.id !== 'general_assistant');

  // Set default persona when user/personas are ready
  useEffect(() => {
    // If current selected is invalid or empty, set default
    if (!selectedPersonaId || !allPersonas.find(p => p.id === selectedPersonaId)) {
      if (availablePersonas.length > 0) {
        setSelectedPersonaId(availablePersonas[0].id);
      }
    }
  }, [availablePersonas, selectedPersonaId, allPersonas]);

  const activePersona = allPersonas.find(p => p.id === selectedPersonaId) || availablePersonas[0] || PERSONAS[0];

  // Fetch custom personas on mount
  useEffect(() => {
    fetchPersonas();
  }, []);

  // NOVO: Hook de Ações
  const { handleAIAction } = useAIActionHandler();

  // RESET on Mount: Start fresh like ChatGPT
  useEffect(() => {
    resetSession();

    // PROATIVIDADE: Iniciar com um briefing (apenas se não for member novo sem contexto ou se quiser forçar)
    const timer = setTimeout(() => {
      // Se for member, talvez não queira disparar "Briefing Executivo" logo de cara se ele selecionou "Copywriter"
      // Vamos manter o comportamento padrão APENAS se estiver na persona geral (e se ela tiver disponivel)
      if (selectedPersonaId === 'general_assistant' && user?.role === 'admin') {
        handleAnalysis('geral', 'Gere um Briefing Executivo RÁPIDO sobre a minha situação atual. Seja direta.');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [selectedPersonaId, user?.role]);

  // Função que processa o envio
  const handleAnalysis = async (type: AIAnalysisType, promptText?: string) => {
    if (isAnalyzing) return;

    // Auto-create session if none exists
    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      activeSessionId = await createSession();
    }

    setAnalyzing(true);

    const userText = promptText || `Análise de: ${type.toUpperCase()}`;

    // Adiciona mensagem do usuário
    addMessage({ role: 'user', content: userText, type: type }, activeSessionId);

    try {
      // Passa o systemPrompt da persona ativa como override
      const rawResponse = await generateInsight(type, promptText, { systemPromptOverride: activePersona.systemPrompt });

      let finalContent = "";

      if (typeof rawResponse === 'string') {
        finalContent = rawResponse;
      } else if (rawResponse && typeof rawResponse === 'object' && 'content' in rawResponse) {
        finalContent = (rawResponse as any).content;
      } else {
        throw new Error("Formato de resposta da IA inválido.");
      }

      if (!finalContent) {
        throw new Error("A IA devolveu uma resposta vazia.");
      }

      // NOVO: Tenta executar ação se for um JSON de Tool
      const actionResult = handleAIAction(finalContent);

      if (actionResult) {
        // Se foi uma ação, adiciona a resposta do sistema
        addMessage({ role: 'assistant', content: actionResult, type: type }, activeSessionId);
      } else {
        // Se foi texto normal
        addMessage({ role: 'assistant', content: finalContent, type: type }, activeSessionId);
      }

    } catch (error: any) {
      console.error("ERRO CAPTURADO NA TELA:", error);
      addMessage({
        role: 'assistant',
        content: `**ERRO TÉCNICO:**\n\n${error.message || JSON.stringify(error)}\n\n*Verifique o Console (F12) para mais detalhes.*`,
        type: 'geral'
      }, activeSessionId);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    handleAnalysis('geral', inputValue);
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleSelectPrompt = (content: string) => {
    setInputValue(content);
    // Auto-resize textarea
    if (textareaRef.current) {
      setTimeout(() => {
        textareaRef.current!.style.height = 'auto';
        textareaRef.current!.style.height = `${textareaRef.current!.scrollHeight}px`;
        textareaRef.current!.focus();
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleNewChat = () => {
    resetSession();
    // Optionally focus input
    if (textareaRef.current) textareaRef.current.focus();
  };

  const confirmDeletePersona = async () => {
    await deletePersona(activePersona.id);
    setSelectedPersonaId("");
  };

  return (
    <div className="h-[calc(100vh-5rem)] p-4 md:p-6 animate-in fade-in duration-500 flex flex-col overflow-hidden">

      <header className="mb-4 shrink-0 flex items-start md:items-center justify-between flex-col md:flex-row gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
            {/* Icone Dinamico */}
            {React.createElement(getIcon(activePersona.icon), { className: "w-5 h-5 text-orange-400" })}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight leading-none">IA Studio</h1>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
              {currentSessionId ? "Sessão Ativa" : "Nova Sessão"} •
              <span className="text-orange-400">{activePersona.role}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">

          {/* SELETOR DE PERSONA (Para Members e Admins) */}
          <div className="w-[180px]">
            <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
              <SelectTrigger className="h-9 bg-white/5 border-white/10 text-xs uppercase font-bold tracking-wide text-zinc-300">
                <SelectValue placeholder="Selecione o Assistente" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {availablePersonas.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-zinc-200 focus:bg-purple-500 focus:text-white">
                    <div className="flex items-center gap-2">
                      {React.createElement(getIcon(p.icon), { className: "w-3 h-3" })}
                      <span>{p.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Edit/Delete Buttons (Only for Custom Personas owned by user or Admin) */}
          {activePersona.created_by && (user?.id === activePersona.created_by || user?.role === 'admin') && (
            <>
              {/* Edit Button */}
              <button
                onClick={() => setIsEditPersonaOpen(true)}
                className="flex items-center justify-center h-9 w-9 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition-all border border-indigo-500/10"
                title="Editar Agente"
              >
                <Pencil className="w-4 h-4" />
              </button>

              {/* Delete Button */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="flex items-center justify-center h-9 w-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-all border border-red-500/10"
                    title="Apagar este Agente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apagar Agente?</AlertDialogTitle>
                    <AlertDialogDescription className="text-zinc-400">
                      Você tem certeza que deseja remover o agente <strong>{activePersona.name}</strong>?
                      <br />Essa ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300">Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={confirmDeletePersona}
                      className="bg-red-600 hover:bg-red-700 text-white border-none"
                    >
                      Sim, apagar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {/* Add Persona Button */}
          <button
            onClick={() => setIsCreatePersonaOpen(true)}
            className="flex items-center justify-center h-9 w-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all border border-white/10"
            title="Criar Novo Agente"
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsPromptsOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-xs font-bold uppercase tracking-wide border border-white/10"
          >
            <Book className="w-4 h-4" />
            <span className="hidden sm:inline">Biblioteca</span>
          </button>

          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-all text-xs font-bold uppercase tracking-wide shadow-lg shadow-purple-500/20"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova Conversa</span>
          </button>

          {/* Configurações APENAS para Admin */}
          {user?.role === 'admin' && (
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-white transition-all"
              title="Configurações Avançadas"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* ÁREA PRINCIPAL */}
      <div className="flex-1 flex gap-4 min-h-0">

        {/* ESQUERDA: CHAT */}
        <IAChatArea
          messages={messages}
          isAnalyzing={isAnalyzing}
          inputValue={inputValue}
          onInputChange={handleInput}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
          onAnalysis={handleAnalysis}
          inputRef={textareaRef}
        />

        {/* DIREITA: HISTÓRICO (SESSÕES) */}
        <IASidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          isOpen={isHistoryOpen}
          onToggle={() => setIsHistoryOpen(!isHistoryOpen)}
          onLoadSession={loadSession}
          onDeleteSession={deleteSession}
        />

      </div>

      <AISettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <IAPromptsDialog open={isPromptsOpen} onOpenChange={setIsPromptsOpen} onSelectPrompt={handleSelectPrompt} />
      <CreatePersonaDialog open={isCreatePersonaOpen} onOpenChange={setIsCreatePersonaOpen} />
      <EditPersonaDialog open={isEditPersonaOpen} onOpenChange={setIsEditPersonaOpen} persona={activePersona} />

    </div>
  );
};

export default IAStudio;