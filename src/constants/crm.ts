import { LeadStatus } from "../types/crm";

export const STATUS_TRANSLATIONS: Record<LeadStatus, string> = {
    prospect: 'Prospecção',
    contact: 'Contato',
    proposal: 'Proposta',
    negotiation: 'Negociação',
    closed: 'Fechado',
    lost: 'Perdido'
};
