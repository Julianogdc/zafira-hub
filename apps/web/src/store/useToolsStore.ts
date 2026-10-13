import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Tool, ToolHistoryLog } from '@/types/tools';

// Generate ID locally for optimistic updates if needed, but usually DB handles it
const generateId = () => Math.random().toString(36).substr(2, 9);

interface ToolsState {
  tools: Tool[];
  history: ToolHistoryLog[];
  loading: boolean;
  initialized: boolean;

  fetchTools: () => Promise<void>;
  addTool: (tool: Omit<Tool, 'id' | 'createdAt'>) => Promise<void>;
  editTool: (id: string, updates: Partial<Omit<Tool, 'id' | 'createdAt'>>) => Promise<void>;
  deleteTool: (id: string) => Promise<void>;

  logUsage: (log: Omit<ToolHistoryLog, 'id' | 'timestamp'>) => void; // Log can remain local or move to DB? Local for now as it's usage history.
  clearHistory: () => void;
}

export const useToolsStore = create<ToolsState>((set, get) => ({
  tools: [],
  history: [], // Keep history local or move to DB later? The user focused on "Tools" list sharing.
  loading: false,
  initialized: false,

  fetchTools: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.from('tools').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      const tools: Tool[] = (data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        source: t.url, // Database column is 'url', TS is 'source'
        type: 'link_external', // Default to external link
        icon: t.icon,
        category: t.category as any, // Cast to union type
        description: t.description,
        status: 'active', // Default status
        createdAt: t.created_at,
        visibility: t.visibility // New field
      }));

      set({ tools, initialized: true });
    } catch (error) {
      console.error('Error fetching tools:', error);
    } finally {
      set({ loading: false });
    }
  },

  addTool: async (newTool) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        name: newTool.name,
        url: newTool.source,
        icon: newTool.icon,
        category: newTool.category,
        description: newTool.description,
        // Ensure visibility is sent, default to 'all' if missing
        visibility: newTool.visibility || 'all',
        owner_id: user.user?.id
      };

      const { error } = await supabase.from('tools').insert(payload);
      if (error) throw error;
      get().fetchTools();
    } catch (error) {
      console.error('Error adding tool:', error);
    }
  },

  editTool: async (id, updates) => {
    try {
      // Map TS updates to DB payload
      const payload: any = {};
      if (updates.name) payload.name = updates.name;
      if (updates.source) payload.url = updates.source;
      if (updates.icon) payload.icon = updates.icon;
      if (updates.category) payload.category = updates.category;
      if (updates.description) payload.description = updates.description;
      if (updates.visibility) payload.visibility = updates.visibility;

      const { error } = await supabase.from('tools').update(payload).eq('id', id);
      if (error) throw error;
      get().fetchTools();
    } catch (error) {
      console.error('Error updating tool:', error);
    }
  },

  deleteTool: async (id) => {
    try {
      const { error } = await supabase.from('tools').delete().eq('id', id);
      if (error) throw error;
      set(state => ({ tools: state.tools.filter(t => t.id !== id) }));
    } catch (error) {
      console.error('Error deleting tool:', error);
    }
  },

  logUsage: (log) => set((state) => ({
    history: [
      { ...log, id: generateId(), timestamp: new Date().toISOString() },
      ...state.history
    ].slice(0, 100)
  })),

  clearHistory: () => set({ history: [] }),
}));