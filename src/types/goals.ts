export type GoalType = 'monetary' | 'numeric' | 'checklist';

export type GoalValueType = "absolute" | "percentage";
export type GoalPeriod = "monthly" | "yearly";
export type GoalStatus = "in_progress" | "achieved" | "off_track";

export type GoalCategory =
  | "financeiro"
  | "comercial"
  | "marketing"
  | "operacional";

// Se for do tipo financeiro, usa isso.
// Se for do tipo financeiro ou comercial, usa isso.
export type AutomationBinding =
  | "revenue_monthly"
  | "revenue_yearly"
  | "expenses_monthly"
  | "cash_balance"
  | "profit_margin"
  | "growth_rate"
  // CRM Bindings
  | "crm_total_sales"      // Valor total vendido (R$)
  | "crm_deals_closed"     // Quantidade de vendas (Fechados)
  | "crm_leads_created";   // Quantidade de leads novos

// Item individual de um checklist
export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface Goal {
  id: string;
  name: string;
  category: GoalCategory;

  // ✅ NOVO: Define o comportamento da meta
  type: GoalType;

  // ✅ OPCIONAIS: Dependem do tipo da meta
  targetValue?: number;      // Para Monetary e Numeric
  currentValue?: number;     // Para Monetary e Numeric
  automationBinding?: AutomationBinding; // Para Monetary e Numeric (Auto-tracking)
  checklist?: ChecklistItem[]; // Apenas Checklist

  // Campos Comuns
  period: GoalPeriod;
  status: GoalStatus;
  startDate: number;
  endDate: number;
  createdAt: number;
  active: boolean;

  // Campo auxiliar para mostrar progresso % (0-100)
  progress: number;
  ownerId?: string;
  assignedTo?: string; // New: RBAC
}