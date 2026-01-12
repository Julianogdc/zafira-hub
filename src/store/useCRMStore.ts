import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Lead, LeadStatus } from '../types/crm';

interface CRMState {
    leads: Lead[];
    loading: boolean;
    initialized: boolean;

    fetchLeads: () => Promise<void>;
    addLead: (lead: Omit<Lead, 'id' | 'history' | 'updatedAt' | 'createdAt'> & { createdAt?: string }) => Promise<void>;
    updateLead: (id: string, data: Partial<Lead>) => Promise<void>;
    deleteLead: (id: string) => Promise<void>;
    moveLead: (leadId: string, newStatus: LeadStatus) => Promise<void>;
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

    moveLead: async (leadId, newStatus) => {
        const lead = get().leads.find(l => l.id === leadId);
        if (!lead || lead.status === newStatus) return;

        try {
            // Update status
            const { error: updateError } = await supabase
                .from('leads')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
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

            get().fetchLeads();

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
        }
    }
}));
