import { create } from 'zustand';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { User, AuthState, UserOrganization } from '@/types/auth';

interface ExtendedAuthStore extends AuthState {
  uploadAvatar: (file: File) => Promise<string | null>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  fetchOrganizationMembers: () => Promise<any[]>;
}

export const useAuthStore = create<ExtendedAuthStore>((set, get) => ({
  user: null,
  organizations: [],
  currentOrganization: null,
  role: null,
  isAuthenticated: false,
  loading: true,
  isLoading: true,

  /**
   * Consulta a sessão ativa na nova API Hub 2.0 via GET /auth/me
   */
  checkSession: async () => {
    try {
      set({ loading: true, isLoading: true });

      const profile = await api.get('/auth/me');

      if (profile && profile.id) {
        const orgs: UserOrganization[] = profile.organizations || [];
        const currentOrg = orgs.find((o) => o.slug === 'zafira') || orgs[0] || null;
        const normalizedRole = currentOrg?.role?.toLowerCase() || 'member';

        const user: User = {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          role: normalizedRole,
          avatar: profile.avatarUrl || undefined,
          avatarUrl: profile.avatarUrl || null,
          organizationId: currentOrg?.id,
          status: profile.status || 'active',
          organizations: orgs,
        };

        set({
          user,
          organizations: orgs,
          currentOrganization: currentOrg,
          role: normalizedRole,
          isAuthenticated: true,
          loading: false,
          isLoading: false,
        });
      } else {
        set({
          user: null,
          organizations: [],
          currentOrganization: null,
          role: null,
          isAuthenticated: false,
          loading: false,
          isLoading: false,
        });
      }
    } catch (error) {
      // 401 ou erro de sessão -> desloga localmente
      set({
        user: null,
        organizations: [],
        currentOrganization: null,
        role: null,
        isAuthenticated: false,
        loading: false,
        isLoading: false,
      });
    }
  },

  /**
   * Autentica com email e senha na API Hub 2.0 via POST /auth/login
   */
  login: async (credentials: { email: string; password: string }) => {
    set({ loading: true, isLoading: true });
    try {
      await api.post('/auth/login', credentials);
      // Após o login bem-sucedido, carrega a sessão via /auth/me
      await get().checkSession();
    } catch (error) {
      set({ loading: false, isLoading: false });
      throw error;
    }
  },

  /**
   * Encerra a sessão via POST /auth/logout
   */
  logout: async () => {
    try {
      await api.post('/auth/logout').catch(() => {});
      // Desconecta também do Supabase legado se houver sessão ativa
      await supabase.auth.signOut().catch(() => {});
    } finally {
      set({
        user: null,
        organizations: [],
        currentOrganization: null,
        role: null,
        isAuthenticated: false,
        loading: false,
        isLoading: false,
      });
    }
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

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', currentUser.id);

      if (error) throw error;

      set((state) => ({
        user: state.user ? { ...state.user, ...data } : null,
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
        email: p.email,
        role: p.role,
        avatar: p.avatar_url,
      }));
    } catch (error) {
      console.error('Error fetching members:', error);
      return [];
    }
  },
}));
