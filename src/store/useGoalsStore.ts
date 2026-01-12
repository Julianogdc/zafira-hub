import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Goal, ChecklistItem, GoalType } from '../types/goals';
import { useAuthStore } from './useAuthStore';

type GoalFormData = Omit<Goal, 'id' | 'createdAt' | 'status' | 'currentValue' | 'progress'> & {
  assignedTo?: string; // Form field
};

const INITIAL_FORM_STATE: GoalFormData = {
  name: '',
  category: 'financeiro',
  type: 'monetary',
  targetValue: 0,
  period: 'monthly',
  automationBinding: 'revenue_monthly',
  checklist: [],
  startDate: Date.now(),
  endDate: Date.now(),
  active: true,
  assignedTo: undefined
};

interface GoalsState {
  goals: Goal[];
  form: GoalFormData;
  loading: boolean;
  initialized: boolean;

  setForm: (updates: Partial<GoalFormData>) => void;
  resetForm: () => void;

  // Actions
  fetchGoals: () => Promise<void>;
  addGoal: () => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
  updateGoal: (id: string, updates: Partial<Goal>) => Promise<void>;
  toggleCheckItem: (goalId: string, itemId: string) => Promise<void>;
  updateNumericProgress: (goalId: string, newValue: number) => Promise<void>;
}

// Helper de cálculo
const calculateProgress = (goal: Partial<Goal> & { checklist?: ChecklistItem[] }): number => {
  if (goal.type === 'checklist' && goal.checklist) {
    if (goal.checklist.length === 0) return 0;
    const completed = goal.checklist.filter(i => i.checked).length;
    return Math.round((completed / goal.checklist.length) * 100);
  }
  if (goal.targetValue && goal.targetValue > 0) {
    const current = goal.currentValue || 0;
    return Math.round((current / goal.targetValue) * 100);
  }
  return 0;
};

export const useGoalsStore = create<GoalsState>((set, get) => ({
  goals: [],
  form: { ...INITIAL_FORM_STATE },
  loading: false,
  initialized: false,

  setForm: (updates) => set((state) => ({
    form: { ...state.form, ...updates }
  })),

  resetForm: () => set({ form: { ...INITIAL_FORM_STATE } }),

  fetchGoals: async () => {
    set({ loading: true });
    try {
      const { data: goalsData, error } = await supabase
        .from('goals')
        .select(`
          *,
          checklist:goal_checklist_items(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mappedGoals: Goal[] = (goalsData || []).map((g: any) => ({
        id: g.id,
        name: g.name,
        category: g.category,
        type: g.type,
        targetValue: g.target_value,
        currentValue: g.current_value,
        automationBinding: g.automation_binding,
        period: g.period,
        status: g.status,
        startDate: new Date(g.start_date).getTime(),
        endDate: new Date(g.end_date).getTime(),
        active: g.active,
        progress: g.progress,
        createdAt: new Date(g.created_at).getTime(),
        ownerId: g.owner_id,
        assignedTo: g.assigned_to, // Mapped
        checklist: (g.checklist || []).map((c: any) => ({
          id: c.id,
          label: c.label,
          checked: c.checked
        }))
      }));

      set({ goals: mappedGoals, initialized: true });
    } catch (error) {
      console.error('Error fetching goals:', error);
    } finally {
      set({ loading: false });
    }
  },

  addGoal: async () => {
    const { form } = get();
    try {
      const { data: user } = await supabase.auth.getUser();
      const goalPayload = {
        name: form.name,
        category: form.category,
        type: form.type,
        target_value: form.targetValue,
        current_value: 0,
        automation_binding: form.automationBinding,
        period: form.period,
        status: 'in_progress',
        start_date: new Date(form.startDate).toISOString(),
        end_date: new Date(form.endDate).toISOString(),
        active: form.active,
        progress: 0,
        owner_id: user.user?.id,
        assigned_to: form.assignedTo // Insert
      };

      const { data: goal, error: goalError } = await supabase
        .from('goals')
        .insert(goalPayload)
        .select()
        .single();

      if (goalError) throw goalError;

      // Handle checklist items if any
      if (form.type === 'checklist' && form.checklist && form.checklist.length > 0) {
        const items = form.checklist.map(item => ({
          goal_id: goal.id,
          label: item.label,
          checked: false
        }));
        const { error: checklistError } = await supabase
          .from('goal_checklist_items')
          .insert(items);

        if (checklistError) console.error('Error adding checklist', checklistError);
      }

      set({ form: { ...INITIAL_FORM_STATE } });
      get().fetchGoals();

      // Notify Assignee
      if (goalPayload.assigned_to && goalPayload.assigned_to !== user.user?.id) {
        await supabase.from('notifications').insert({
          user_id: goalPayload.assigned_to,
          title: 'Nova Meta Atribuída 🎯',
          message: `Você foi designado para a meta: ${goalPayload.name}`,
          type: 'info',
          link: '/metas'
        });
      }

    } catch (error) {
      console.error('Error adding goal:', error);
    }
  },

  removeGoal: async (id) => {
    try {
      const { error } = await supabase.from('goals').delete().eq('id', id);
      if (error) throw error;
      set(state => ({ goals: state.goals.filter(g => g.id !== id) }));
    } catch (error) {
      console.error('Error deleting goal:', error);
    }
  },

  updateGoal: async (id, updates) => {
    const prevGoal = get().goals.find(g => g.id === id);
    try {
      // Need to map updates to snake_case
      const payload: any = {};
      if (updates.name) payload.name = updates.name;
      if (updates.category) payload.category = updates.category;
      if (updates.type) payload.type = updates.type;
      if (updates.targetValue !== undefined) payload.target_value = updates.targetValue;
      if (updates.currentValue !== undefined) payload.current_value = updates.currentValue;
      if (updates.startDate) payload.start_date = new Date(updates.startDate).toISOString();
      if (updates.endDate) payload.end_date = new Date(updates.endDate).toISOString();
      if (updates.active !== undefined) payload.active = updates.active;
      if (updates.progress !== undefined) payload.progress = updates.progress;
      if (updates.status) payload.status = updates.status;

      const { error } = await supabase.from('goals').update(payload).eq('id', id);
      if (error) throw error;
      get().fetchGoals();

      // Notify if achieved
      if (updates.status === 'achieved' && prevGoal?.status !== 'achieved') {
        const { addNotification } = await import('./useNotificationStore').then(m => m.useNotificationStore.getState());
        addNotification(
          'Meta Concluída! 🏆',
          `Parabéns! A meta "${prevGoal?.name}" foi batida!`,
          'success'
        );
      }
    } catch (error) {
      console.error('Error updating goal:', error);
    }
  },

  toggleCheckItem: async (goalId, itemId) => {
    const goal = get().goals.find(g => g.id === goalId);
    if (!goal || !goal.checklist) return;

    const item = goal.checklist.find(i => i.id === itemId);
    if (!item) return;

    const newChecked = !item.checked;

    try {
      // Update item in DB
      const { error: itemError } = await supabase
        .from('goal_checklist_items')
        .update({ checked: newChecked })
        .eq('id', itemId);
      if (itemError) throw itemError;

      // Calculate new progress locally to update Goal
      const newChecklist = goal.checklist.map(i => i.id === itemId ? { ...i, checked: newChecked } : i);
      const newGoal = { ...goal, checklist: newChecklist };
      const newProgress = calculateProgress(newGoal);
      const newStatus = newProgress >= 100 ? 'achieved' : 'in_progress';

      await get().updateGoal(goalId, { progress: newProgress, status: newStatus as any });

    } catch (error) {
      console.error('Error toggling check item:', error);
    }
  },

  updateNumericProgress: async (goalId, newValue) => {
    const goal = get().goals.find(g => g.id === goalId);
    if (!goal) return;

    try {
      const newGoal = { ...goal, currentValue: newValue };
      const newProgress = calculateProgress(newGoal);
      const newStatus = newProgress >= 100 ? 'achieved' : 'in_progress';

      await get().updateGoal(goalId, {
        currentValue: newValue,
        progress: newProgress,
        status: newStatus as any
      });
    } catch (error) {
      console.error('Error updating numeric progress:', error);
    }
  }
}));