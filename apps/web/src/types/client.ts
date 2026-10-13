export type ClientStatus = 'active' | 'inactive';

export interface PaymentRecord {
  month: string; // "MM/YYYY"
  status: 'pending' | 'paid';
  paidAt?: string;
}

export interface ClientContract {
  id: string;
  fileName: string;
  fileData: string; // Conteúdo Base64
  uploadDate: string;
}

export interface Client {
  id: string;
  name: string;
  status: ClientStatus;
  contractValue: number;
  contractStart?: string; // Data Início
  contractEnd?: string;   // Data Vencimento
  notes: string;
  contracts: ClientContract[];
  paymentHistory: PaymentRecord[];
  churnedAt?: string;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
}

export interface ClientStats {
  totalClients: number;
  activeClients: number;
  inactiveClients: number;
  totalContractValue: number;
  newClientsThisMonth: number; // Novo KPI
  churnRate: string; // Churn Rate em %
}