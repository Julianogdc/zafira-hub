import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Transaction, Category } from "@/types/finance";

const DEFAULT_CATEGORIES: Category[] = [
  { id: "1", name: "Vendas", icon: "Wallet", color: "#10b981", lastUsed: new Date().toISOString() },
  { id: "2", name: "Serviços", icon: "Wrench", color: "#3b82f6", lastUsed: new Date().toISOString() },
  { id: "3", name: "Marketing", icon: "Megaphone", color: "#f59e0b" },
  { id: "4", name: "Infraestrutura", icon: "Home", color: "#6366f1" },
  { id: "5", name: "Pessoal", icon: "User", color: "#ec4899" },
  { id: "6", name: "Outros", icon: "Box", color: "#94a3b8" },
];

interface FinanceState {
  transactions: Transaction[];
  categories: Category[];
  loading: boolean;
  initialized: boolean;

  fetchFinance: () => Promise<void>;

  // Actions
  addTransaction: (transaction: Transaction) => Promise<void>;
  updateTransaction: (transaction: Transaction) => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;

  addCategory: (cat: Category) => Promise<void>;
  updateCategory: (cat: Category) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;
}

export const useFinanceStore = create<FinanceState>((set, get) => ({
  transactions: [],
  categories: DEFAULT_CATEGORIES,
  loading: false,
  initialized: false,

  fetchFinance: async () => {
    set({ loading: true });
    try {
      // Fetch Transactions
      const { data: transData, error: transError } = await supabase
        .from('finance_transactions')
        .select('*')
        .order('date', { ascending: false });

      if (transError) throw transError;

      // Fetch Categories
      const { data: catsData, error: catsError } = await supabase
        .from('finance_categories')
        .select('*')
        .order('last_used', { ascending: false });

      if (catsError) throw catsError;

      const transactions: Transaction[] = (transData || []).map((t: any) => ({
        id: t.id,
        title: t.description, // Mapped from description
        amount: t.amount,
        type: t.type,
        category: t.category,
        date: t.date,
      }));

      const categories: Category[] = (catsData && catsData.length > 0)
        ? (catsData).map((c: any) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          color: c.color,
          lastUsed: c.last_used
        }))
        : DEFAULT_CATEGORIES;

      set({ transactions, categories, initialized: true });
    } catch (error) {
      console.error('Error fetching finance data:', error);
    } finally {
      set({ loading: false });
    }
  },

  addTransaction: async (transaction) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        description: transaction.title,
        amount: transaction.amount,
        type: transaction.type,
        category: transaction.category,
        date: transaction.date,
        // status: pending,
        owner_id: user.user?.id
      };

      const { data: newT, error } = await supabase.from('finance_transactions').insert(payload).select().single();
      if (error) throw error;

      // Update category usage
      const cat = get().categories.find(c => c.name === transaction.category);
      if (cat) {
        // If it's a DB category (has UUID likely, but we can just check existence), update it
        // Wait, default categories don't exist in DB initially unless user added them or we seed them.
        // For now, we only update if it is in DB. We might need logic to sync default categories to DB.
      }

      get().fetchFinance();
    } catch (error) {
      console.error('Error adding transaction:', error);
    }
  },

  updateTransaction: async (transaction) => {
    try {
      const payload = {
        description: transaction.title,
        amount: transaction.amount,
        type: transaction.type,
        category: transaction.category,
        date: transaction.date,
      };

      const { error } = await supabase.from('finance_transactions').update(payload).eq('id', transaction.id);
      if (error) throw error;

      get().fetchFinance();
    } catch (error) {
      console.error('Error updating transaction:', error);
    }
  },

  removeTransaction: async (id) => {
    try {
      const { error } = await supabase.from('finance_transactions').delete().eq('id', id);
      if (error) throw error;
      set(state => ({ transactions: state.transactions.filter(t => t.id !== id) }));
    } catch (error) {
      console.error('Error deleting transaction:', error);
    }
  },

  addCategory: async (cat) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        last_used: new Date().toISOString(),
        owner_id: user.user?.id
      };

      const { error } = await supabase.from('finance_categories').insert(payload);
      if (error) throw error;
      get().fetchFinance();
    } catch (error) {
      console.error('Error adding category:', error);
    }
  },

  updateCategory: async (cat) => {
    try {
      const payload = {
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        last_used: cat.lastUsed
      };
      const { error } = await supabase.from('finance_categories').update(payload).eq('id', cat.id);
      if (error) throw error;
      get().fetchFinance();
    } catch (error) {
      console.error('Error updating category:', error);
    }
  },

  removeCategory: async (id) => {
    try {
      const { error } = await supabase.from('finance_categories').delete().eq('id', id);
      if (error) throw error;
      set(state => ({ categories: state.categories.filter(c => c.id !== id) }));
    } catch (error) {
      console.error('Error deleting category:', error);
    }
  }
}));
