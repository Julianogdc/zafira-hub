import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Lead, LeadStatus, LeadTemplate, CRMTask } from '../types/crm';
import { STATUS_TRANSLATIONS } from '../constants/crm';

interface CRMState {
    leads: Lead[];
    loading: boolean;
    initialized: boolean;

    fetchLeads: () => Promise<void>;
    addLead: (lead: Omit<Lead, 'id' | 'history' | 'updatedAt' | 'createdAt'> & { createdAt?: string }) => Promise<void>;
    updateLead: (id: string, data: Partial<Lead>) => Promise<void>;
    deleteLead: (id: string) => Promise<void>;
    moveLead: (leadId: string, newStatus: LeadStatus, lostReason?: string) => Promise<void>;

    // Activities
    currentLeadActivities: import('../types/crm').LeadActivity[];
    fetchLeadActivities: (leadId: string) => Promise<void>;
    addActivity: (leadId: string, type: import('../types/crm').ActivityType, content: string) => Promise<void>;

    // Templates
    templates: LeadTemplate[];
    fetchTemplates: () => Promise<void>;
    createTemplate: (title: string, content: string) => Promise<void>;
    updateTemplate: (id: string, title: string, content: string) => Promise<void>;
    deleteTemplate: (id: string) => Promise<void>;

    // Tasks
    tasks: CRMTask[];
    fetchTasks: (leadId?: string) => Promise<void>;
    addTask: (leadId: string, title: string, dueDate?: string) => Promise<void>;
    toggleTask: (taskId: string, completed: boolean) => Promise<void>;
    deleteTask: (taskId: string) => Promise<void>;

    // Tags
    addTag: (leadId: string, tag: string) => Promise<void>;
    removeTag: (leadId: string, tag: string) => Promise<void>;
}

export const useCRMStore = create<CRMState>((set, get) => ({
    leads: [],
    loading: false,
    initialized: false,

    fetchLeads: async () => {
        set({ loading: true });
        try {
            const { data: leadsData, error } = await supabase
                .from('leads')
                .select(`
                    *,
                    history:lead_history(*)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mappedLeads: Lead[] = (leadsData || []).map((l: any) => ({
                id: l.id,
                name: l.name,
                company: l.company,
                value: l.value,
                phone: l.phone,
                city: l.city,
                niche: l.niche,
                description: l.description,
                source: l.source,
                status: l.status,
                createdAt: l.created_at,
                updatedAt: l.updated_at,
                ownerId: l.owner_id,
                lostReason: l.lost_reason,
                tags: l.tags || [],
                history: (l.history || []).map((h: any) => ({
                    id: h.id,
                    date: h.date,
                    fromStatus: h.from_status,
                    toStatus: h.to_status
                }))
            }));

            set({ leads: mappedLeads, initialized: true });
        } catch (error) {
            console.error('Error fetching leads:', error);
        } finally {
            set({ loading: false });
        }
    },

    addLead: async (leadData) => {
        try {
            const { data: user } = await supabase.auth.getUser();
            const payload = {
                name: leadData.name,
                company: leadData.company,
                value: leadData.value,
                phone: leadData.phone,
                city: leadData.city,
                niche: leadData.niche,
                description: leadData.description,
                source: leadData.source,
                status: leadData.status,
                owner_id: user.user?.id,
                // created_at is default now() but can be overridden if needed
            };
            if (leadData.createdAt) {
                (payload as any).created_at = leadData.createdAt;
            }

            const { error } = await supabase.from('leads').insert(payload);
            if (error) throw error;
            get().fetchLeads();
        } catch (error) {
            console.error('Error adding lead:', error);
            throw error;
        }
    },

    updateLead: async (id, data) => {
        try {
            // Map partial data to snake_case
            const payload: any = {};
            if (data.name) payload.name = data.name;
            if (data.company !== undefined) payload.company = data.company;
            if (data.value !== undefined) payload.value = data.value;
            if (data.phone !== undefined) payload.phone = data.phone;
            if (data.city !== undefined) payload.city = data.city;
            if (data.niche !== undefined) payload.niche = data.niche;
            if (data.description !== undefined) payload.description = data.description;
            if (data.source) payload.source = data.source;
            if (data.status) payload.status = data.status;
            if (data.tags) payload.tags = data.tags;
            payload.updated_at = new Date().toISOString();

            const { error } = await supabase.from('leads').update(payload).eq('id', id);
            if (error) throw error;

            // Optimistic update or refresh? Refresh is safer.
            get().fetchLeads();
        } catch (error) {
            console.error('Error updating lead:', error);
        }
    },

    deleteLead: async (id) => {
        try {
            const { error } = await supabase.from('leads').delete().eq('id', id);
            if (error) throw error;
            set(state => ({ leads: state.leads.filter(l => l.id !== id) }));
        } catch (error) {
            console.error('Error deleting lead:', error);
        }
    },

    moveLead: async (leadId, newStatus, lostReason) => {
        const lead = get().leads.find(l => l.id === leadId);
        if (!lead || lead.status === newStatus) return;

        // Snapshot current state for rollback
        const previousLeads = get().leads;

        // Optimistic Update: Update local state immediately
        set(state => ({
            leads: state.leads.map(l =>
                l.id === leadId
                    ? { ...l, status: newStatus, lostReason: lostReason || l.lostReason, updatedAt: new Date().toISOString() }
                    : l
            )
        }));

        try {
            // Update status in Supabase
            const updatePayload: any = { status: newStatus, updated_at: new Date().toISOString() };
            if (lostReason) updatePayload.lost_reason = lostReason;

            const { error: updateError } = await supabase
                .from('leads')
                .update(updatePayload)
                .eq('id', leadId);

            if (updateError) throw updateError;

            // Insert history
            const { error: historyError } = await supabase.from('lead_history').insert({
                lead_id: leadId,
                from_status: lead.status,
                to_status: newStatus,
                date: new Date().toISOString()
            });

            if (historyError) console.error('Error saving history:', historyError);

            // AUTO-LOG ACTIVITY (The "Dossier" feature)
            try {
                const { data: userData } = await supabase.auth.getUser();

                let logContent = `Mudou de fase: ${STATUS_TRANSLATIONS[lead.status] || lead.status} ➔ ${STATUS_TRANSLATIONS[newStatus] || newStatus}`;
                if (lostReason) logContent += ` | Motivo: ${lostReason}`;

                await supabase.from('lead_activities').insert({
                    lead_id: leadId,
                    type: 'note',
                    content: logContent,
                    created_by: userData.user?.id
                });
            } catch (logError) {
                console.error('Error logging activity move:', logError);
            }

            // Background Refetch (Silent) - verifies data consistency without blocking
            get().fetchLeads();
            // Also refresh activities if we happen to be looking at this lead
            get().fetchLeadActivities(leadId);

            // Notify if closed
            if (newStatus === 'closed') {
                const { addNotification } = await import('./useNotificationStore').then(m => m.useNotificationStore.getState());
                addNotification(
                    'Venda Fechada! 🚀',
                    `Parabéns! O lead ${lead.name} foi fechado com sucesso.`,
                    'success'
                );
            }
        } catch (error) {
            console.error('Error moving lead:', error);
            // Revert to previous state on error
            set({ leads: previousLeads });
        }
    },

    // --- Activities (Timeline) ---
    currentLeadActivities: [],

    fetchLeadActivities: async (leadId) => {
        try {
            const { data, error } = await supabase
                .from('lead_activities')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mappedActivities = (data || []).map((a: any) => ({
                id: a.id,
                leadId: a.lead_id,
                type: a.type,
                content: a.content,
                createdAt: a.created_at,
                createdBy: a.created_by
            }));

            set({ currentLeadActivities: mappedActivities });
        } catch (error) {
            console.error('Error fetching activities:', error);
        }
    },

    addActivity: async (leadId, type, content) => {
        try {
            const { data: userData } = await supabase.auth.getUser();
            const { error } = await supabase.from('lead_activities').insert({
                lead_id: leadId,
                type,
                content,
                created_by: userData.user?.id
            });

            if (error) throw error;

            // Refresh activities
            get().fetchLeadActivities(leadId);
        } catch (error) {
            console.error('Error adding activity:', error);
            throw error;
        }
    },

    // Templates Actions
    templates: [],

    fetchTemplates: async () => {
        try {
            const { data, error } = await supabase
                .from('crm_templates')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mappedTemplates: LeadTemplate[] = (data || []).map((t: any) => ({
                id: t.id,
                title: t.title,
                content: t.content,
                createdAt: t.created_at,
                createdBy: t.created_by
            }));

            set({ templates: mappedTemplates });
        } catch (error) {
            console.error('Error fetching templates:', error);
        }
    },

    createTemplate: async (title, content) => {
        try {
            const { data: userData } = await supabase.auth.getUser();
            const { error } = await supabase.from('crm_templates').insert({
                title,
                content,
                created_by: userData.user?.id
            });

            if (error) throw error;
            get().fetchTemplates();
        } catch (error) {
            console.error('Error creating template:', error);
        }
    },

    updateTemplate: async (id, title, content) => {
        try {
            const { error } = await supabase
                .from('crm_templates')
                .update({ title, content })
                .eq('id', id);

            if (error) throw error;
            get().fetchTemplates();
        } catch (error) {
            console.error('Error updating template:', error);
        }
    },

    deleteTemplate: async (id) => {
        try {
            const { error } = await supabase.from('crm_templates').delete().eq('id', id);
            if (error) throw error;
            // Optimistic update
            set(state => ({ templates: state.templates.filter(t => t.id !== id) }));
        } catch (error) {
            console.error('Error deleting template:', error);
        }
    },

    // --- Tasks Implementation ---
    tasks: [],

    fetchTasks: async (leadId) => {
        try {
            let query = supabase
                .from('crm_tasks')
                .select('*')
                .order('due_date', { ascending: true });

            if (leadId) {
                query = query.eq('lead_id', leadId);
            }

            const { data, error } = await query;

            if (error) throw error;

            const mappedTasks: CRMTask[] = (data || []).map((t: any) => ({
                id: t.id,
                leadId: t.lead_id,
                title: t.title,
                description: t.description,
                dueDate: t.due_date,
                completed: t.completed,
                createdAt: t.created_at,
                createdBy: t.created_by
            }));

            // Force update tasks state
            // If leadId is provided, we might want to filter or just replace related tasks? 
            // For simplicity, we are storing all fetched tasks. 
            // If we fetch for a specific lead, we might want to append or replace just those.
            // But let's keep it simple: unique ID based merge or just replace if we only view one lead.
            // Actually, usually we view tasks for one lead or all.
            // Let's just set tasks.
            set({ tasks: mappedTasks });
        } catch (error) {
            console.error('Error fetching tasks:', error);
        }
    },

    addTask: async (leadId, title, dueDate) => {
        try {
            const { data: userData } = await supabase.auth.getUser();
            const { error } = await supabase.from('crm_tasks').insert({
                lead_id: leadId,
                title,
                due_date: dueDate,
                created_by: userData.user?.id
            });

            if (error) throw error;
            get().fetchTasks(leadId);
        } catch (error) {
            console.error('Error adding task:', error);
        }
    },

    toggleTask: async (taskId, completed) => {
        try {
            // Optimistic
            set(state => ({
                tasks: state.tasks.map(t => t.id === taskId ? { ...t, completed } : t)
            }));

            const { error } = await supabase
                .from('crm_tasks')
                .update({ completed })
                .eq('id', taskId);

            if (error) throw error;
        } catch (error) {
            console.error('Error toggling task:', error);
            // Revert on error? Skipping for now.
        }
    },

    deleteTask: async (taskId) => {
        try {
            const { error } = await supabase.from('crm_tasks').delete().eq('id', taskId);
            if (error) throw error;
            set(state => ({ tasks: state.tasks.filter(t => t.id !== taskId) }));
        } catch (error) {
            console.error('Error deleting task:', error);
        }
    },

    // --- Tags Implementation ---
    addTag: async (leadId, tag) => {
        const lead = get().leads.find(l => l.id === leadId);
        if (!lead) return;

        const newTags = [...(lead.tags || []), tag];
        // Deduplicate
        const uniqueTags = Array.from(new Set(newTags));

        // Optimistic
        set(state => ({
            leads: state.leads.map(l => l.id === leadId ? { ...l, tags: uniqueTags } : l)
        }));

        try {
            const { error } = await supabase
                .from('leads')
                .update({ tags: uniqueTags })
                .eq('id', leadId);
            if (error) throw error;
        } catch (error) {
            console.error('Error adding tag:', error);
        }
    },

    removeTag: async (leadId, tag) => {
        const lead = get().leads.find(l => l.id === leadId);
        if (!lead) return;

        const newTags = (lead.tags || []).filter(t => t !== tag);

        // Optimistic
        set(state => ({
            leads: state.leads.map(l => l.id === leadId ? { ...l, tags: newTags } : l)
        }));

        try {
            const { error } = await supabase
                .from('leads')
                .update({ tags: newTags })
                .eq('id', leadId);
            if (error) throw error;
        } catch (error) {
            console.error('Error removing tag:', error);
        }
    }
}));
