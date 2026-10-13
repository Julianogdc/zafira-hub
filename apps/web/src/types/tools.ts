export type ToolType = 'component' | 'iframe' | 'webhook' | 'link_external';
export type ToolStatus = 'active' | 'development' | 'inactive';
export type ToolCategory = 'operacional' | 'comercial' | 'marketing' | 'ia' | 'outros';

export interface Tool {
  id: string;
  name: string;
  description: string;
  icon?: string; // Icon name (Lucide)
  type: ToolType;
  // 'source' armazena a URL (para iframe/link), endpoint (webhook) ou chave de referência (componente)
  source: string;
  category: ToolCategory;
  status: ToolStatus;
  version?: string;
  createdAt: string;
  visibility?: 'admin' | 'all' | 'member';
}

export interface ToolHistoryLog {
  id: string;
  toolId: string;
  toolName: string;
  timestamp: string;
  status: 'success' | 'error';
  message?: string;
}