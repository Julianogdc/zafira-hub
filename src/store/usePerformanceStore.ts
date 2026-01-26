import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { PerformanceReport, PerformanceCampaign, PerformanceAlert, PerformanceClientHealth } from '../types/performance';
import { useClientStore } from './useClientStore';

interface PerformanceState {
    reports: PerformanceReport[];
    selectedClientId: string | null;
    selectedMonth: string | null;
    trackedClientIds: string[];
    loading: boolean;
    initialized: boolean;

    // Actions
    fetchReports: (clientId?: string) => Promise<void>;
    fetchTrackedClients: () => Promise<void>;
    addTrackedClient: (clientId: string) => Promise<void>;
    removeTrackedClient: (clientId: string) => Promise<void>;
    addReport: (report: Omit<PerformanceReport, 'id' | 'uploadDate'>) => Promise<void>;
    deleteReport: (id: string) => Promise<void>;
    selectClient: (id: string | null) => void;
    selectMonth: (month: string | null) => void;

    // Derived Data / Logic
    getHealthData: () => PerformanceClientHealth[];
    getClientAlerts: (clientId: string, month: string) => PerformanceAlert[];
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
    reports: [],
    selectedClientId: null,
    selectedMonth: new Date().toISOString().substring(0, 7), // Default to current month
    trackedClientIds: [],
    loading: false,
    initialized: false,

    fetchReports: async (clientId) => {
        set({ loading: true });
        try {
            let query = supabase.from('performance_reports').select('*');
            if (clientId) {
                query = query.eq('client_id', clientId);
            }

            const { data, error } = await query.order('month', { ascending: false });
            if (error) throw error;

            const mappedReports: PerformanceReport[] = (data || []).map(r => ({
                id: r.id,
                clientId: r.client_id,
                month: r.month,
                uploadDate: r.upload_date,
                fileName: r.file_name?.includes('|') ? r.file_name.split('|')[0] : r.file_name,
                startDate: r.file_name?.includes('|') ? r.file_name.split('|')[1] : undefined,
                endDate: r.file_name?.includes('|') ? r.file_name.split('|')[2] : undefined,
                campaigns: r.campaigns as PerformanceCampaign[],
                totalSpend: r.total_spend,
                totalResults: r.total_results,
                avgCtr: r.avg_ctr,
                avgCpc: r.avg_cpc
            }));

            set({ reports: mappedReports, initialized: true });
        } catch (error) {
            console.error('Error fetching performance reports:', error);
        } finally {
            set({ loading: false });
        }
    },

    fetchTrackedClients: async () => {
        try {
            const { data, error } = await supabase
                .from('performance_clients')
                .select('client_id');

            if (error) throw error;
            set({ trackedClientIds: (data || []).map(d => d.client_id) });
        } catch (error) {
            console.error('Error fetching tracked clients:', error);
        }
    },

    addTrackedClient: async (clientId) => {
        try {
            const { data: user } = await supabase.auth.getUser();
            if (!user.user) return;

            const { error } = await supabase
                .from('performance_clients')
                .insert({ client_id: clientId, owner_id: user.user.id });

            if (error) throw error;
            set(state => ({ trackedClientIds: [...state.trackedClientIds, clientId] }));
        } catch (error: any) {
            console.error('Error adding tracked client:', error);
            throw new Error(error.message || "Erro desconhecido ao acessar o banco de dados");
        }
    },

    removeTrackedClient: async (clientId) => {
        try {
            const { error } = await supabase
                .from('performance_clients')
                .delete()
                .eq('client_id', clientId);

            if (error) throw error;
            set(state => ({
                trackedClientIds: state.trackedClientIds.filter(id => id !== clientId),
                selectedClientId: state.selectedClientId === clientId ? null : state.selectedClientId
            }));
        } catch (error) {
            console.error('Error removing tracked client:', error);
            throw error;
        }
    },

    addReport: async (reportData) => {
        try {
            const { data: userData } = await supabase.auth.getUser();
            if (!userData.user) throw new Error("Usuário não autenticado");

            // 1. Verificar se já existe relatório para este cliente/mês
            const { data: existingReport, error: fetchError } = await supabase
                .from('performance_reports')
                .select('id, campaigns')
                .eq('client_id', reportData.clientId)
                .eq('month', reportData.month)
                .maybeSingle();

            if (fetchError) throw fetchError;

            if (existingReport) {
                // 2. Lógica de Merge (Smart Update)
                const existingCampaigns = existingReport.campaigns as PerformanceCampaign[];
                const newCampaigns = reportData.campaigns;

                // Mapa para acesso rápido por nome (normalizado)
                const campaignMap = new Map<string, PerformanceCampaign>();
                existingCampaigns.forEach(c => campaignMap.set(c.name.trim(), c));

                // Atualizar ou adicionar novas campanhas
                newCampaigns.forEach(newCamp => {
                    // Preservar o ID da campanha existente para manter consistência, se desejado
                    // Aqui optamos por manter o ID da existente e atualizar os dados
                    const existing = campaignMap.get(newCamp.name.trim());
                    if (existing) {
                        campaignMap.set(newCamp.name.trim(), { ...newCamp, id: existing.id });
                    } else {
                        campaignMap.set(newCamp.name.trim(), newCamp);
                    }
                });

                const mergedCampaigns = Array.from(campaignMap.values());

                // Recalcular Totais
                const totalSpend = mergedCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
                const totalResults = mergedCampaigns.reduce((sum, c) => sum + (c.results || 0), 0);

                // Recalcular médias (mantendo lógica de média simples do importador)
                const sumCtr = mergedCampaigns.reduce((sum, c) => sum + (c.ctr || 0), 0);
                const sumCpc = mergedCampaigns.reduce((sum, c) => sum + (c.cpc || 0), 0);
                const count = mergedCampaigns.length;

                const avgCtr = count > 0 ? sumCtr / count : 0;
                const avgCpc = count > 0 ? sumCpc / count : 0;

                // Nome do arquivo combinado
                const newFileName = reportData.startDate ?
                    `${reportData.fileName}|${reportData.startDate}|${reportData.endDate}` :
                    reportData.fileName;

                const { error: updateError } = await supabase
                    .from('performance_reports')
                    .update({
                        campaigns: mergedCampaigns,
                        total_spend: totalSpend,
                        total_results: totalResults,
                        avg_ctr: avgCtr,
                        avg_cpc: avgCpc,
                        file_name: newFileName
                    })
                    .eq('id', existingReport.id);

                if (updateError) throw updateError;

            } else {
                // 3. Insert Normal (Se não existir)
                const { error } = await supabase.from('performance_reports').insert({
                    client_id: reportData.clientId,
                    month: reportData.month,
                    file_name: reportData.startDate ? `${reportData.fileName}|${reportData.startDate}|${reportData.endDate}` : reportData.fileName,
                    campaigns: reportData.campaigns,
                    total_spend: reportData.totalSpend,
                    total_results: reportData.totalResults,
                    avg_ctr: reportData.avgCtr,
                    avg_cpc: reportData.avgCpc,
                    owner_id: userData.user.id
                });

                if (error) throw error;
            }

            get().fetchReports();
        } catch (error) {
            console.error('Error adding/updating report:', error);
            throw error;
        }
    },

    deleteReport: async (id) => {
        try {
            const { error } = await supabase.from('performance_reports').delete().eq('id', id);
            if (error) throw error;
            set(state => ({ reports: state.reports.filter(r => r.id !== id) }));
        } catch (error) {
            console.error('Error deleting report:', error);
        }
    },

    selectClient: (id) => set({ selectedClientId: id }),
    selectMonth: (month) => set({ selectedMonth: month }),

    getHealthData: () => {
        const { reports, trackedClientIds } = get();
        const clientStore = useClientStore.getState();
        const clients = clientStore.clients.filter(c => trackedClientIds.includes(c.id));

        return clients.map(client => {
            const clientReports = reports.filter(r => r.clientId === client.id);
            const lastReport = clientReports.sort((a, b) => b.month.localeCompare(a.month))[0];

            const alerts = lastReport ? get().getClientAlerts(client.id, lastReport.month) : [];
            const alertCount = alerts.length;

            let status: 'healthy' | 'warning' | 'critical' = 'healthy';
            let score = 100;

            if (!lastReport) {
                status = 'warning';
                score = 0;
            } else if (alertCount > 3) {
                status = 'critical';
                score = 40;
            } else if (alertCount > 0) {
                status = 'warning';
                score = 75;
            }

            return {
                clientId: client.id,
                clientName: client.name,
                status,
                score,
                alertCount,
                mainMetricTrend: 'stable',
                lastUploadDate: lastReport?.uploadDate || ''
            };
        });
    },

    getClientAlerts: (clientId, month) => {
        const report = get().reports.find(r => r.clientId === clientId && r.month === month);
        if (!report) return [];

        const alerts: PerformanceAlert[] = [];

        report.campaigns.forEach(c => {
            if (c.ctr < 0.5) {
                alerts.push({
                    id: crypto.randomUUID(),
                    type: 'warning',
                    campaignName: c.name,
                    message: 'CTR abaixo do esperado (0.5%)',
                    suggestion: 'Revise o criativo ou a segmentação do público.',
                    metric: 'CTR',
                    value: c.ctr,
                    threshold: 0.5
                });
            }
            if (c.frequency > 3) {
                alerts.push({
                    id: crypto.randomUUID(),
                    type: 'info',
                    campaignName: c.name,
                    message: 'Frequência alta detectada',
                    suggestion: 'Considere trocar os criativos para evitar fadiga.',
                    metric: 'Frequência',
                    value: c.frequency,
                    threshold: 3
                });
            }
            if (c.spend > 50 && c.results === 0) {
                alerts.push({
                    id: crypto.randomUUID(),
                    type: 'critical',
                    campaignName: c.name,
                    message: 'Gasto sem resultados',
                    suggestion: 'Pause a campanha e revise a oferta/LP.',
                    metric: 'Resultados',
                    value: 0,
                    threshold: 1
                });
            }
        });

        return alerts;
    }
}));
