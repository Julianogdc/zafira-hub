export type LeadSource = 'indicação' | 'prospecção_ativa' | 'comercial' | 'anuncio';

export type LeadStatus = 'prospect' | 'contact' | 'proposal' | 'negotiation' | 'closed' | 'lost';

export type ActivityType = 'note' | 'whatsapp' | 'call' | 'email' | 'meeting';

export interface LeadActivity {
    id: string;
    leadId: string;
    type: ActivityType;
    content: string;
    createdAt: string;
    createdBy: string;
}

export interface LeadTemplate {
    id: string;
    title: string;
    content: string;
    createdBy?: string;
    createdAt?: string;
    lostReason?: string;
}

export interface CRMTask {
    id: string;
    leadId: string;
    title: string;
    description?: string;
    dueDate?: string;
    completed: boolean;
    createdBy?: string;
    createdAt?: string;
}

export interface LeadHistory {
    id: string;
    date: string; // ISO String
    fromStatus: LeadStatus;
    toStatus: LeadStatus;
}

export interface Lead {
    id: string;
    name: string;
    company?: string;
    value: number;
    phone?: string;
    city?: string;
    niche?: string;
    description?: string;
    source: LeadSource;
    status: LeadStatus;
    history: LeadHistory[];
    createdAt: string;
    ownerId?: string;
    activities?: LeadActivity[];
    lostReason?: string;
    tags?: string[];
}

export interface PipelineColumn {
    id: LeadStatus;
    title: string;
    leads: Lead[];
}
