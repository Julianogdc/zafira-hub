import { create } from 'zustand';
import { Client, ClientContract } from '../types/client';
import { supabase } from '../lib/supabase';

interface ClientState {
  clients: Client[];
  loading: boolean;
  initialized: boolean;

  // Actions
  fetchClients: () => Promise<void>;
  addClient: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'contracts' | 'paymentHistory'>) => Promise<string>;
  updateClient: (id: string, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  addContract: (clientId: string, fileName: string, fileData: string) => Promise<void>;
  setPaymentStatus: (clientId: string, month: string, status: 'paid' | 'pending') => Promise<void>;
  toggleChurn: (clientId: string) => Promise<void>;
}

export const useClientStore = create<ClientState>((set, get) => ({
  clients: [],
  loading: false,
  initialized: false,

  fetchClients: async () => {
    set({ loading: true });
    try {
      const { data: clientsData, error } = await supabase
        .from('clients')
        .select(`
          *,
          contracts:client_contracts(*),
          paymentHistory:client_payments(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mappedClients: Client[] = (clientsData || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        contractValue: c.contract_value,
        contractStart: c.contract_start,
        contractEnd: c.contract_end,
        notes: c.notes,
        churnedAt: c.churned_at,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        ownerId: c.owner_id,
        contracts: c.contracts.map((ct: any) => ({
          id: ct.id,
          fileName: ct.file_name,
          fileData: ct.file_data,
          uploadDate: ct.upload_date
        })),
        paymentHistory: c.paymentHistory.map((p: any) => ({
          month: p.month,
          status: p.status,
          paidAt: p.paid_at
        }))
      }));

      set({ clients: mappedClients, initialized: true });
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      set({ loading: false });
    }
  },

  addClient: async (clientData) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        throw new Error('Usuário não autenticado. Por favor, faça login novamente.');
      }

      const payload = {
        name: clientData.name,
        status: clientData.status,
        contract_value: clientData.contractValue,
        contract_start: clientData.contractStart || null,
        contract_end: clientData.contractEnd || null,
        notes: clientData.notes,
        owner_id: user.user.id
      };

      const { data, error } = await supabase.from('clients').insert(payload).select().single();
      if (error) throw error;

      // Refresh list to update UI
      get().fetchClients();
      return data.id;
    } catch (error) {
      console.error('Error adding client:', error);
      throw error;
    }
  },

  updateClient: async (id, data) => {
    try {
      const payload: any = {};
      if (data.name) payload.name = data.name;
      if (data.status) payload.status = data.status;
      if (data.contractValue) payload.contract_value = data.contractValue;
      if (data.contractStart !== undefined) payload.contract_start = data.contractStart || null;
      if (data.contractEnd !== undefined) payload.contract_end = data.contractEnd || null;
      if (data.notes) payload.notes = data.notes;
      if (data.churnedAt) payload.churned_at = data.churnedAt;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase.from('clients').update(payload).eq('id', id);
      if (error) throw error;

      get().fetchClients();
    } catch (error) {
      console.error('Error updating client:', error);
    }
  },

  deleteClient: async (id) => {
    try {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      set(state => ({ clients: state.clients.filter(c => c.id !== id) }));
    } catch (error) {
      console.error('Error deleting client:', error);
    }
  },

  addContract: async (clientId, fileName, fileData) => {
    try {
      // In a real scenario we should upload to Storage, but here we save base64 to DB as requested for now
      const { error } = await supabase.from('client_contracts').insert({
        client_id: clientId,
        file_name: fileName,
        file_data: fileData
      });
      if (error) throw error;
      get().fetchClients();
    } catch (error) {
      console.error('Error adding contract:', error);
    }
  },

  setPaymentStatus: async (clientId, month, status) => {
    try {
      // First check if exists to update, or insert new
      // We can use upsert? 
      // But we need to know the ID if we want to update precisely, or we assume (client_id + month) is unique.
      // My schema didn't enforce unique constraint on (client_id, month), but functionality implies it.
      // I'll search first.

      const { data: existing } = await supabase
        .from('client_payments')
        .select('id')
        .eq('client_id', clientId)
        .eq('month', month)
        .maybeSingle();

      if (existing) {
        await supabase.from('client_payments').update({
          status,
          paid_at: status === 'paid' ? new Date().toISOString() : null
        }).eq('id', existing.id);
      } else {
        await supabase.from('client_payments').insert({
          client_id: clientId,
          month,
          status,
          paid_at: status === 'paid' ? new Date().toISOString() : null
        });
      }
      get().fetchClients();
    } catch (error) {
      console.error('Error setting payment:', error);
    }
  },

  toggleChurn: async (clientId) => {
    const client = get().clients.find(c => c.id === clientId);
    if (!client) return;

    const isActive = client.status === 'active';
    const newStatus = isActive ? 'inactive' : 'active';
    const churnedAt = isActive ? new Date().toISOString() : null;

    try {
      await get().updateClient(clientId, { status: newStatus, churnedAt });
    } catch (error) {
      console.error('Error toggling churn:', error);
    }
  }
}));