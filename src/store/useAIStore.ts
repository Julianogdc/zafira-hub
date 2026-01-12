// C:\Projetos\zafira-hub-v2\src\store\useAIStore.ts

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { AIState, AISession, AIMessage, AISettings, AIPrompt, AIPersona } from '../types/ai';

const generateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

const DEFAULT_SETTINGS: AISettings = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4-turbo',
  systemPrompt: 'Você é um assistente executivo sênior do Zafira Hub.',
  canReadFinance: false,
  canReadGoals: false,
  canReadClients: false,
  autoGenerateInsights: true,
};

interface AIStoreState extends AIState {
  loading: boolean;
  initialized: boolean;
  fetchSessions: () => Promise<void>;

  fetchPrompts: () => Promise<void>;
  // Custom Personas
  customPersonas: AIPersona[];
  fetchPersonas: () => Promise<void>;
  createPersona: (persona: Omit<AIPersona, 'id' | 'created_by' | 'is_active'>) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  updatePersona: (id: string, updates: Partial<AIPersona>) => Promise<void>;
}

export const useAIStore = create<AIStoreState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  prompts: [],
  customPersonas: [],
  isTyping: false,
  isAnalyzing: false,
  settings: DEFAULT_SETTINGS,
  loading: false,
  initialized: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('ai_sessions')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const sessions: AISession[] = (data || []).map((s: any) => ({
        id: s.id,
        title: s.title || 'Nova Conversa',
        messages: [], // We don't load all messages at once
        updatedAt: new Date(s.updated_at).getTime(),
        model: s.model
      }));

      // Sync with local state map logic if needed, for now just replace
      set({ sessions, initialized: true });
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      set({ loading: false });
    }
  },

  fetchPrompts: async () => {
    try {
      const { data, error } = await supabase.from('ai_prompts').select('*');
      if (error) throw error;

      const dbPrompts: AIPrompt[] = (data || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        category: p.category || 'user'
      }));

      const systemPrompts: AIPrompt[] = [
        { id: 'sys-1', title: 'Resumir Texto', content: 'Por favor, faça um resumo conciso do seguinte texto, destacando os pontos principais:', category: 'system' },
        { id: 'sys-2', title: 'Melhorar Escrita', content: 'Reescreva o texto abaixo para torná-lo mais profissional, claro e direto:', category: 'system' },
        { id: 'sys-3', title: 'Analisar Contrato', content: 'Analise o seguinte contrato e aponte riscos, cláusulas abusivas ou pontos de atenção:', category: 'system' },
        { id: 'sys-4', title: 'Criar E-mail', content: 'Crie um e-mail profissional para [DESTINATÁRIO] sobre [ASSUNTO], com tom [TOM DE VOZ]:', category: 'system' },
      ];

      set({ prompts: [...systemPrompts, ...dbPrompts] });
    } catch (error) {
      console.error('Error fetching prompts:', error);
    }
  },

  fetchPersonas: async () => {
    try {
      const { data, error } = await supabase.from('ai_personas').select('*');
      if (error) throw error;

      const personas: AIPersona[] = (data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        description: p.description,
        systemPrompt: p.system_prompt,
        icon: p.icon,
        visibility: p.visibility,
        created_by: p.created_by,
        is_active: p.is_active
      }));

      set({ customPersonas: personas });
      set({ customPersonas: personas });
    } catch (error) {
      console.error('Error fetching personas. This usually means the SQL_SHARED_AND_STORAGE.sql script or SQL_PERSONAS.sql has not been run.', error);
      // Optional: We could trigger a global toast here if we had access to it outside hooks, 
      // but for now the console error helps debugging.
    }
  },

  createPersona: async (personaData) => {
    try {
      const { data: user } = await supabase.auth.getUser();

      // Get org id (optional, for visibility public)
      let orgId = null;
      if (personaData.visibility === 'public') {
        const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.user?.id).single();
        orgId = profile?.organization_id;
      }

      const { error } = await supabase.from('ai_personas').insert({
        name: personaData.name,
        role: personaData.role,
        description: personaData.description,
        system_prompt: personaData.systemPrompt,
        icon: personaData.icon, // string
        visibility: personaData.visibility || 'private',
        created_by: user.user?.id,
        organization_id: orgId
      });

      if (error) throw error;
      get().fetchPersonas();
    } catch (error) {
      console.error('Error creating persona:', error);
    }
  },

  deletePersona: async (id) => {
    try {
      const { error } = await supabase.from('ai_personas').delete().eq('id', id);
      if (error) throw error;
      set(state => ({ customPersonas: state.customPersonas.filter(p => p.id !== id) }));
    } catch (error) {
      console.error("Error deleting persona:", error);
    }
  },

  updatePersona: async (id, updates) => {
    try {
      const { data: user } = await supabase.auth.getUser();

      // Special logic for Visibility Change to Public
      let orgId = undefined;
      if (updates.visibility === 'public') {
        const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.user?.id).single();
        orgId = profile?.organization_id;
      }

      const updateData: any = {
        name: updates.name,
        role: updates.role,
        description: updates.description,
        system_prompt: updates.systemPrompt,
        icon: updates.icon,
        visibility: updates.visibility
      };

      if (orgId) updateData.organization_id = orgId;

      const { error } = await supabase.from('ai_personas').update(updateData).eq('id', id);

      if (error) throw error;

      // Optimistic Update
      set(state => ({
        customPersonas: state.customPersonas.map(p => p.id === id ? { ...p, ...updates } : p)
      }));

      get().fetchPersonas(); // Fetch to be sure
    } catch (error) {
      console.error("Error updating persona:", error);
    }
  },

  addMessage: async (messageContent, sessionId) => {
    const targetSessionId = sessionId || get().currentSessionId;
    if (!targetSessionId) return;

    // Optimistic UI Update
    const newMessage: AIMessage = {
      id: generateId(), // Temp ID
      timestamp: Date.now(),
      ...messageContent,
    };

    set((state) => ({
      messages: state.currentSessionId === targetSessionId ? [...state.messages, newMessage] : state.messages,
      sessions: state.sessions.map(s => s.id === targetSessionId ? { ...s, updatedAt: Date.now() } : s)
    }));

    try {
      // DB Insert
      const { data: insertedMsg, error } = await supabase.from('ai_messages').insert({
        session_id: targetSessionId,
        role: messageContent.role,
        content: messageContent.content
      }).select().single();

      if (error) throw error;

      // Update title if first user message
      const session = get().sessions.find(s => s.id === targetSessionId);
      // We can check if it's the first message by checking local messages count or DB
      // Simplified: if title is 'Nova Análise' and role is user
      if (session && session.title === 'Nova Análise' && messageContent.role === 'user') {
        const rawTitle = messageContent.content;
        let newTitle = rawTitle.length > 40 ? rawTitle.substring(0, 40) + '...' : rawTitle;
        newTitle = newTitle.charAt(0).toUpperCase() + newTitle.slice(1);

        await supabase.from('ai_sessions').update({ title: newTitle }).eq('id', targetSessionId);
        set(state => ({
          sessions: state.sessions.map(s => s.id === targetSessionId ? { ...s, title: newTitle } : s)
        }));
      }

    } catch (error) {
      console.error('Error adding message:', error);
    }
  },

  createSession: async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data: session, error } = await supabase.from('ai_sessions').insert({
        title: 'Nova Análise',
        model: get().settings.model,
        owner_id: user.user?.id
      }).select().single();

      if (error) throw error;

      const newSession: AISession = {
        id: session.id,
        title: session.title,
        messages: [],
        updatedAt: new Date(session.updated_at).getTime(),
        model: session.model
      };

      set((state) => ({
        sessions: [newSession, ...state.sessions],
        currentSessionId: newSession.id,
        messages: []
      }));

      return newSession.id;

    } catch (error) {
      console.error('Error creating session:', error);
      return '';
    }
  },

  loadSession: async (id) => {
    set({ loading: true, currentSessionId: id, messages: [] });
    try {
      const { data, error } = await supabase
        .from('ai_messages')
        .select('*')
        .eq('session_id', id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const messages: AIMessage[] = (data || []).map((m: any) => ({
        id: m.id,
        role: m.role as any,
        content: m.content,
        timestamp: new Date(m.created_at).getTime()
      }));

      set({ messages });
    } catch (error) {
      console.error('Error loading session:', error);
    } finally {
      set({ loading: false });
    }
  },

  deleteSession: async (id) => {
    try {
      const { error } = await supabase.from('ai_sessions').delete().eq('id', id);
      if (error) throw error;

      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        currentSessionId: state.currentSessionId === id ? null : state.currentSessionId,
        messages: state.currentSessionId === id ? [] : state.messages,
      }));
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  },

  setTyping: (status) => set({ isTyping: status }),
  setAnalyzing: (status) => set({ isAnalyzing: status }),

  updateSettings: (newSettings) => set((state) => ({ settings: { ...state.settings, ...newSettings } })),

  togglePermission: (key) => set((state) => ({
    settings: { ...state.settings, [key]: !state.settings[key] },
  })),

  savePrompt: async (prompt) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('ai_prompts').insert({
        title: prompt.title,
        content: prompt.content,
        category: 'user',
        owner_id: user.user?.id
      }).select().single();

      if (error) throw error;

      // Refresh prompts
      get().fetchPrompts();
    } catch (error) {
      console.error('Error saving prompt:', error);
    }
  },

  deletePrompt: async (id) => {
    try {
      const { error } = await supabase.from('ai_prompts').delete().eq('id', id);
      if (error) throw error;
      set((state) => ({
        prompts: state.prompts.filter(p => p.id !== id)
      }));
    } catch (error) {
      console.error('Error deleting prompt:', error);
    }
  },

  resetSession: () => {
    set({ currentSessionId: null, messages: [] });
  },
}));