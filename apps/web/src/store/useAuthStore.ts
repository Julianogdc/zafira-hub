import { create } from 'zustand';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { User, AuthState, UserOrganization } from '@/types/auth';
import { SessionResponse } from '@zafira/contracts';

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
   * Consulta a sessão ativa na nova API Hub 2.1 via GET /api/v1/auth/session
   */
  checkSession: async () => {
    try {
      set({ loading: true, isLoading: true });

      const response = await api.get<SessionResponse>('/api/v1/auth/session');

      if (response && response.authenticated) {
        const orgs: UserOrganization[] = response.organizations || [];
        const currentOrg = response.activeOrganizationId 
            ? orgs.find((o) => o.id === response.activeOrganizationId) || null 
            : null;
        const normalizedRole = currentOrg?.role?.toLowerCase() || 'member';

        const user: User = {
          id: response.user.id,
          name: response.user.name,
          email: response.user.email,
          role: normalizedRole,
          avatar: response.user.avatarUrl || undefined,
          avatarUrl: response.user.avatarUrl || null,
          organizationId: currentOrg?.id,
          status: response.user.status || 'ACTIVE',
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
   * Autentica com email e senha na API Hub 2.1 via POST /api/v1/auth/login
   */
  login: async (credentials: { email: string; password: string }) => {
    set({ loading: true, isLoading: true });
    try {
      await api.post('/api/v1/auth/login', credentials);
      // Após o login bem-sucedido, carrega a sessão
      await get().checkSession();
      if (!get().isAuthenticated) {
        throw new Error('Não foi possível estabelecer a sessão após o login.');
      }
    } catch (error) {
      set({ loading: false, isLoading: false });
      throw error;
    }
  },

  /**
   * Encerra a sessão via POST /api/v1/auth/logout
   */
  logout: async () => {
    try {
      await api.post('/api/v1/auth/logout').catch(() => {});
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
