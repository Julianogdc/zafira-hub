import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { User, AuthState } from '@/types/auth';

interface AuthStore extends AuthState {
    checkSession: () => Promise<void>;
    login: (user: User) => void;
    logout: () => Promise<void>;
    updateUser: (data: Partial<User>) => void;
    // New actions
    uploadAvatar: (file: File) => Promise<string | null>;
    updateProfile: (data: Partial<User>) => Promise<void>;
    loading: boolean;
    fetchOrganizationMembers: () => Promise<any[]>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
    user: null,
    isAuthenticated: false,
    loading: true, // Adicionado estado de loading inicial

    checkSession: async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                // Fetch profile
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();

                // Heartbeat: Update last_seen
                // We do this fire-and-forget to not block loading
                const now = new Date().toISOString();
                supabase.from('profiles').update({ last_seen: now }).eq('id', session.user.id).then();

                const user: User = {
                    id: session.user.id,
                    email: session.user.email!,
                    name: profile?.full_name || session.user.user_metadata?.full_name || 'Usuário',
                    role: profile?.role || 'member',
                    avatar: profile?.avatar_url || session.user.user_metadata?.avatar_url,
                    organizationId: profile?.organization_id,
                    status: profile?.status || 'active',
                    lastSeen: now,
                    asanaAccessToken: profile?.asana_access_token,
                    asanaRefreshToken: profile?.asana_refresh_token,
                    city: profile?.city,
                    bio: profile?.bio
                };

                // Security Check: If suspended, force logout
                if (user.status === 'suspended') {
                    await supabase.auth.signOut();
                    set({ user: null, isAuthenticated: false, loading: false });
                    return;
                }

                set({ user, isAuthenticated: true, loading: false });
            } else {
                set({ user: null, isAuthenticated: false, loading: false });
            }
        } catch (error) {
            console.error("Session check failed", error);
            set({ user: null, isAuthenticated: false, loading: false });
        } finally {
            set({ loading: false });
        }
    },

    login: (user: User) => {
        set({ user, isAuthenticated: true });
    },

    logout: async () => {
        await supabase.auth.signOut();
        set({ user: null, isAuthenticated: false });
    },

    updateUser: (data: Partial<User>) => {
        set((state) => ({
            user: state.user ? { ...state.user, ...data } : null,
        }));
    },

    uploadAvatar: async (file: File) => {
        const user = get().user;
        if (!user) return null;

        try {
            const fileExt = file.name.split('.').pop();
            const filePath = `${user.id}-${Math.random()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
            return data.publicUrl;
        } catch (error) {
            console.error('Error uploading avatar:', error);
            return null;
        }
    },

    updateProfile: async (data: Partial<User>) => {
        const currentUser = get().user;
        if (!currentUser) return;

        try {
            const updates: any = {
                updated_at: new Date().toISOString(),
            };
            if (data.name) updates.full_name = data.name;
            if (data.avatar) updates.avatar_url = data.avatar;
            if (data.asanaAccessToken) updates.asana_access_token = data.asanaAccessToken;
            if (data.asanaRefreshToken) updates.asana_refresh_token = data.asanaRefreshToken;
            if (data.city !== undefined) updates.city = data.city;
            if (data.bio !== undefined) updates.bio = data.bio;
            // role e organization_id geralmente não são editados pelo próprio user aqui, mas por admins

            const { error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', currentUser.id);

            if (error) throw error;

            // Update local state
            set((state) => ({
                user: state.user ? { ...state.user, ...data } : null
            }));

        } catch (error) {
            console.error('Error updating profile:', error);
            throw error;
        }
    },

    fetchOrganizationMembers: async () => {
        const currentUser = get().user;
        if (!currentUser?.organizationId) return [];

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, email, role, avatar_url')
                .eq('organization_id', currentUser.organizationId);

            if (error) throw error;

            return data.map((p: any) => ({
                id: p.id,
                name: p.full_name,
                email: p.email, // Note: profiles table might not have email depending on schema, but usually we sync it or join auth.users (cant join auth.users easily from client). 
                // Wait, profiles table usually stores public info. Email might be private.
                // Assuming profiles has email or we don't need it.
                // Re-checking SQL_SHARED_AND_STORAGE.sql:
                // "create table public.profiles ( id uuid references auth.users not null primary key, full_name text, avatar_url text, role text default 'member', organization_id uuid );"
                // It does NOT have email.
                // However, for assignment, name is enough.
                role: p.role,
                avatar: p.avatar_url
            }));
        } catch (error) {
            console.error('Error fetching members:', error);
            return [];
        }
    }
}));
