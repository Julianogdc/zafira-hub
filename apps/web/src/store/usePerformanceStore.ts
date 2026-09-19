import { create } from 'zustand';

export interface TrafficMetric {
    date: string;
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    sales: number;
}

export interface TrafficAd {
    id: string;
    name: string;
    status: 'active' | 'paused' | 'ended';
    imageUrl?: string;
    copy?: string;
    metrics: {
        ctr: number;
        cpc: number;
        roas: number;
        leads: number;
        costPerLead: number;
    };
}

export interface TrafficCampaign {
    id: string;
    name: string;
    status: 'active' | 'paused' | 'ended';
    budget: number;
    spent: number;
    ads: TrafficAd[];
}

export interface TrafficClient {
    id: string;
    name: string;
    platform: 'meta' | 'google' | 'tiktok' | 'linkedin'; // Primary platform or list
    status: 'active' | 'paused';
    metrics: TrafficMetric[]; // Historical data
    campaigns: TrafficCampaign[];
    notes?: string;
}

interface PerformanceState {
    trafficClients: TrafficClient[];
    selectedClientId: string | null;
    loading: boolean;

    // Actions
    selectClient: (id: string | null) => void;
    addClient: (client: TrafficClient) => void;
    updateClient: (id: string, updates: Partial<TrafficClient>) => void;
    addCampaign: (clientId: string, campaign: TrafficCampaign) => void; // New action
    initMockData: () => void;
    importCampaignsFromCsv: (clientId: string, campaigns: TrafficCampaign[]) => void;
}

// MOCK DATA GENERATOR
const generateMockData = (): TrafficClient[] => [
    // ... existing mock data kept for reference if needed, but not used by default
];

export const usePerformanceStore = create<PerformanceState>((set) => ({
    trafficClients: [], // Initialized empty
    selectedClientId: null,
    loading: false,

    selectClient: (id) => set({ selectedClientId: id }),

    addClient: (client) => set((state) => ({
        trafficClients: [...state.trafficClients, client]
    })),

    updateClient: (id, updates) => set((state) => ({
        trafficClients: state.trafficClients.map(c =>
            c.id === id ? { ...c, ...updates } : c
        )
    })),

    addCampaign: (clientId, campaign) => set((state) => ({
        trafficClients: state.trafficClients.map(c => {
            if (c.id !== clientId) return c;
            return {
                ...c,
                campaigns: [...c.campaigns, campaign]
            };
        })
    })),

    initMockData: () => set({ trafficClients: [] }), // Reset to empty

    importCampaignsFromCsv: (clientId, campaigns) => set((state) => ({
        trafficClients: state.trafficClients.map(c => {
            if (c.id !== clientId) return c;
            return {
                ...c,
                campaigns: [...c.campaigns, ...campaigns]
            };
        })
    }))
}));
