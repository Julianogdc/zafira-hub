export interface User {
    id: string;
    name: string;
    email: string;
    role: string; // 'admin' | 'manager' | 'member' basically
    avatar?: string;
    organizationId?: string;
    status?: 'active' | 'suspended';
    lastSeen?: string;
    asanaAccessToken?: string;
    asanaRefreshToken?: string;
    city?: string;
    bio?: string;
}

export interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    login: (user: User) => void;
    logout: () => void;
    updateUser: (data: Partial<User>) => void;
    checkSession?: () => Promise<void>;
}
