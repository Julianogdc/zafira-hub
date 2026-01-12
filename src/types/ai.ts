// C:\Projetos\zafira-hub-v2\src\types\ai.ts

export type AIRole = 'user' | 'assistant' | 'system';
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'local' | 'custom';
export type AIModel = string;
export type AIAnalysisType = 'chat' | 'financas' | 'metas' | 'clientes' | 'geral';

export interface AIMessage {
  id: string;
  role: AIRole;
  content: string;
  timestamp: number;
  // CRÍTICO: Esta linha abaixo resolve os erros "property type does not exist"
  type?: string;
}

export interface AISession {
  id: string;
  title: string;
  messages: AIMessage[];
  updatedAt: number;
  model: AIModel;
  date?: string;
}

export interface AISettings {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: AIModel;
  systemPrompt: string;
  canReadFinance: boolean;
  canReadGoals: boolean;
  canReadClients: boolean;
  autoGenerateInsights: boolean;
}

export interface AIPermissions {
  canReadFinance: boolean;
  canReadGoals: boolean;
  canReadClients: boolean;
}

export interface AIPrompt {
  id: string;
  title: string;
  content: string;
  category: 'system' | 'user';
  tags?: string[];
}

export interface AIState {
  sessions: AISession[];
  currentSessionId: string | null;
  messages: AIMessage[];
  prompts: AIPrompt[];
  isTyping: boolean;
  isAnalyzing: boolean;
  settings: AISettings;
  addMessage: (message: Omit<AIMessage, 'id' | 'timestamp'>, sessionId?: string) => Promise<void>;
  createSession: () => Promise<string>;
  loadSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setTyping: (status: boolean) => void;
  setAnalyzing: (status: boolean) => void;
  updateSettings: (newSettings: Partial<AISettings>) => void;
  togglePermission: (key: keyof AISettings) => void;
  savePrompt: (prompt: Omit<AIPrompt, 'id'>) => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
  resetSession: () => void;
}

export type InsightDomain = 'finance' | 'clients' | 'goals' | 'general';
export type InsightRiskLevel = 'neutral' | 'opportunity' | 'warning' | 'critical';

export interface DashboardInsight {
  id: string;
  domain: InsightDomain;
  title: string;
  content: string;
  riskLevel: InsightRiskLevel;
  timestamp: number;
}

export interface SystemSnapshot {
  finance?: {
    balance: number;
    revenue: number;
    expenses: number;
    burnRate?: number;
    pendingContractsCount?: number;
  };
  goals?: {
    total: number;
    completed: number;
    atRisk: number;
    averageProgress: number;
  };
  clients?: {
    totalActive: number;
    churnRiskCount?: number;
    newClientsThisMonth: number;
  };
  timestamp: Date;
}

export interface AIPersona {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  icon: any; // Stored as string in DB, but used as component in UI. valid lucide icon string
  visibility?: 'private' | 'public';
  created_by?: string;
  is_active?: boolean;
}