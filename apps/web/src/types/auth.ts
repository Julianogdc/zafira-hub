export type UserRole = 'ADMIN' | 'MANAGER' | 'MEMBER' | 'admin' | 'manager' | 'member';

export interface UserOrganization {
  id: string;
  name: string;
  slug: string;
  role: 'ADMIN' | 'MANAGER' | 'MEMBER';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string; // 'admin' | 'manager' | 'member'
  avatar?: string;
  avatarUrl?: string | null;
  organizationId?: string;
  status?: string;
  lastSeen?: string;
  asanaAccessToken?: string;
  asanaRefreshToken?: string;
  city?: string;
  bio?: string;
  organizations?: UserOrganization[];
}

export interface AuthState {
  user: User | null;
  organizations: UserOrganization[];
  currentOrganization: UserOrganization | null;
  role: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  isLoading: boolean;
  checkSession: () => Promise<void>;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
}

