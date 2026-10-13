import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { User } from '@/types/auth';

interface AdminStore {
    users: User[];
    loading: boolean;
    fetchUsers: () => Promise<void>;
    updateUserStatus: (userId: string, status: 'active' | 'suspended') => Promise<void>;
    updateUserRole: (userId: string, role: string) => Promise<void>;
    deleteUser: (userId: string) => Promise<void>; // Soft delete or Hard delete logic
}

export const useAdminStore = create<AdminStore>((set, get) => ({
    users: [],
    loading: false,

    fetchUsers: async () => {
        set({ loading: true });
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Map profiles to User type
            const users: User[] = data.map((p: any) => ({
                id: p.id,
                name: p.full_name || 'Desconhecido',
                email: p.email || '', // Profiles might not have email if not synced. 
                // NOTE: We might need to fetch emails from auth.users via an Edge Function if strict, 
                // but usually for simple apps we dup email to profiles or just show name.
                // For this MVP, we assume profiles might have email or we just use what's there.
                // Checking previous files, profiles structure was ambiguous on email. 
                // Let's assume we rely on what's available.
                role: p.role,
                avatar: p.avatar_url,
                organizationId: p.organization_id,
                status: p.status || 'active',
                lastSeen: p.last_seen
            }));

            set({ users, loading: false });
        } catch (error) {
            console.error('Error fetching users:', error);
            set({ loading: false });
        }
    },

    updateUserStatus: async (userId: string, status: 'active' | 'suspended') => {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ status })
                .eq('id', userId);

            if (error) throw error;

            // Update local state
            set((state) => ({
                users: state.users.map((u) =>
                    u.id === userId ? { ...u, status } : u
                )
            }));
        } catch (error) {
            console.error('Error updating status:', error);
            throw error;
        }
    },

    updateUserRole: async (userId: string, role: string) => {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ role })
                .eq('id', userId);

            if (error) throw error;

            set((state) => ({
                users: state.users.map((u) =>
                    u.id === userId ? { ...u, role } : u
                )
            }));
        } catch (error) {
            console.error('Error updating role:', error);
            throw error;
        }
    },

    deleteUser: async (userId: string) => {
        // Soft delete implementation (just suspend)
        // If hard delete is needed, we'd use supabase.auth.admin.deleteUser (Edge Function needed)
        // For client-side admin, we usually just "Suspend" access.

        await get().updateUserStatus(userId, 'suspended');
    }
}));
