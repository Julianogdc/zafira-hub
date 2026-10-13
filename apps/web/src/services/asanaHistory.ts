import { api } from '@/lib/api';
import type { AsanaHistoryResponse } from '@/lib/asana-history-view';

/**
 * F6-IMP.8 — Histórico do Asana guardado no Hub (DEC-F6-003). Nada aqui escreve no Asana.
 * Erros da API são propagados para a tela (sem dados de demonstração).
 */
export const asanaHistoryService = {
  async getClientHistory(clientId: string, days = 30): Promise<AsanaHistoryResponse> {
    return api.get<AsanaHistoryResponse>(
      `/clients/${encodeURIComponent(clientId)}/asana/history?days=${encodeURIComponent(String(days))}`
    );
  },

  /** "Atualizar agora": confere no Asana (somente leitura) os projetos deste cliente. */
  async refreshClientHistory(clientId: string): Promise<{
    status?: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    projects: number;
    succeeded: number;
    failed: number;
    history: AsanaHistoryResponse | null;
  }> {
    return api.post(`/clients/${encodeURIComponent(clientId)}/asana/history/refresh`, {});
  },
};
