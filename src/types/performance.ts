export type ResultType = 'Lead' | 'Compra' | 'Mensagem' | 'Visualização' | 'Outro';

export interface PerformanceCampaign {
    id: string; // Internal ID or hash
    name: string;
    spend: number;
    impressions: number;
    reach: number;
    frequency: number;
    clicks: number;
    ctr: number;
    cpc: number;
    cpm: number;
    results: number;
    costPerResult: number;
    resultType: string;
    status?: string;
    objective?: string;
    accountName?: string;
    notes?: string;
}

export interface PerformanceReport {
    id: string;
    clientId: string;
    month: string; // YYYY-MM
    uploadDate: string;
    fileName: string;
    campaigns: PerformanceCampaign[];
    totalSpend: number;
    avgCtr: number;
    avgCpc: number;
    totalResults: number;
    startDate?: string;
    endDate?: string;
}

export interface PerformanceAlert {
    id: string;
    type: 'critical' | 'warning' | 'info';
    campaignName?: string;
    message: string;
    suggestion: string;
    metric?: string;
    value?: number;
    threshold?: number;
}

export interface PerformanceClientHealth {
    clientId: string;
    clientName: string;
    status: 'healthy' | 'warning' | 'critical';
    score: number; // 0-100
    alertCount: number;
    mainMetricTrend: 'up' | 'down' | 'stable';
    lastUploadDate: string;
}
