export type LeadSource = 'indicação' | 'prospecção_ativa' | 'comercial' | 'anuncio';

export type LeadStatus = 'prospect' | 'contact' | 'proposal' | 'negotiation' | 'closed' | 'lost';

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
    updatedAt: string;
    ownerId?: string;
}

export interface PipelineColumn {
    id: LeadStatus;
    title: string;
    leads: Lead[];
}
