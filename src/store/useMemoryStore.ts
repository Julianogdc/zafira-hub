import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface StrategicFact {
    id: string;
    content: string; // Ex: "O foco deste trimestre é reduzir o churn abaixo de 2%"
    category: 'strategy' | 'preference' | 'risk' | 'history';
    createdAt: number;
}

interface MemoryState {
    facts: StrategicFact[];
    loading: boolean;
    initialized: boolean;

    fetchFacts: () => Promise<void>;
    addFact: (content: string, category: StrategicFact['category']) => Promise<void>;
    removeFact: (id: string) => Promise<void>;
    getRelevantFacts: () => string; // Retorna string formatada para o prompt
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
    facts: [],
    loading: false,
    initialized: false,

    fetchFacts: async () => {
        set({ loading: true });
        try {
            const { data, error } = await supabase.from('ai_memories').select('*').order('created_at', { ascending: false });
            if (error) throw error;

            const facts: StrategicFact[] = (data || []).map((m: any) => ({
                id: m.id,
                content: m.content,
                category: m.category as any,
                createdAt: new Date(m.created_at).getTime()
            }));

            set({ facts, initialized: true });
        } catch (error) {
            console.error('Error fetching memories:', error);
        } finally {
            set({ loading: false });
        }
    },

    addFact: async (content, category) => {
        try {
            const { data: user } = await supabase.auth.getUser();
            const { data, error } = await supabase.from('ai_memories').insert({
                content,
                category,
                owner_id: user.user?.id
            }).select().single();

            if (error) throw error;

            // Optimistic or Fetch? Fetch is safer
            get().fetchFacts();

        } catch (error) {
            console.error('Error adding fact:', error);
        }
    },

    removeFact: async (id) => {
        try {
            const { error } = await supabase.from('ai_memories').delete().eq('id', id);
            if (error) throw error;
            set(state => ({ facts: state.facts.filter(f => f.id !== id) }));
        } catch (error) {
            console.error('Error removing fact:', error);
        }
    },

    getRelevantFacts: () => {
        const { facts } = get();
        if (facts.length === 0) return "Ainda não definimos diretrizes estratégicas de longo prazo.";

        return facts.map(f => `- [${f.category.toUpperCase()}] ${f.content}`).join('\n');
    }
}));
