import { api, apiFetch } from '@/lib/api';
import type {
  AdjustDeliverableTargetRequest,
  AdvanceDeliverablePieceRequest,
  CancelDeliverablePieceRequest,
  ContentStagesResponse,
  CreateDeliverableItemRequest,
  CreateDeliverablePieceRequest,
  CreateDeliverablePlanRequest,
  DeliverableEvent,
  DeliverableItem,
  DeliverablePlan,
  ReopenDeliverablePlanRequest,
  RevertDeliverablePieceRequest,
} from '@zafira/contracts';

/** Evento de auditoria como devolvido pela API (inclui o nome de quem agiu, quando conhecido). */
export type DeliverableEventView = Omit<DeliverableEvent, 'actorUserId' | 'planId'> & {
  planId: string | null;
  actorUserId: string | null;
  actorName?: string | null;
};

export interface DeliverablePlanDetails extends DeliverablePlan {
  items: DeliverableItem[];
  events: DeliverableEventView[];
}

export interface GetDeliverablesResponse {
  plan: DeliverablePlanDetails | null;
  period: string;
  clientId: string;
}

/**
 * Leitura de Entregas (F6-IMP.7) — somente leitura.
 *
 * Nunca devolve dados de demonstração: se a API falhar, o erro é propagado para a tela,
 * que mostra o estado de erro ou de permissão. `plan: null` significa que não há plano
 * cadastrado para o cliente no período.
 */
export const deliverablesService = {
  async getClientDeliverables(
    clientId: string,
    period: string
  ): Promise<{ plan: DeliverablePlanDetails | null }> {
    if (!clientId) return { plan: null };

    const response = await apiFetch<GetDeliverablesResponse>(
      `/clients/${encodeURIComponent(clientId)}/deliverables?period=${encodeURIComponent(period)}`
    );
    return { plan: response?.plan ?? null };
  },
};

/**
 * Operação de Entregas (F6-IMP.7B — DEC-F6-002). Escreve SOMENTE no Hub.
 * Cada chamada devolve o plano atualizado; erros da API são propagados para a tela.
 */
const base = (clientId: string) => `/clients/${encodeURIComponent(clientId)}/deliverables`;
const planBase = (clientId: string, planId: string) => `${base(clientId)}/${encodeURIComponent(planId)}`;
const toPlan = (response: GetDeliverablesResponse | null | undefined) => response?.plan ?? null;

export const deliverablesOperations = {
  async createPlan(clientId: string, body: CreateDeliverablePlanRequest) {
    return toPlan(await api.post<GetDeliverablesResponse>(base(clientId), body));
  },
  async addItem(clientId: string, planId: string, body: CreateDeliverableItemRequest) {
    return toPlan(await api.post<GetDeliverablesResponse>(`${planBase(clientId, planId)}/items`, body));
  },
  async adjustTarget(clientId: string, planId: string, itemId: string, body: AdjustDeliverableTargetRequest) {
    return toPlan(
      await api.patch<GetDeliverablesResponse>(
        `${planBase(clientId, planId)}/items/${encodeURIComponent(itemId)}/target`,
        body
      )
    );
  },
  async addPiece(clientId: string, planId: string, itemId: string, body: CreateDeliverablePieceRequest) {
    return toPlan(
      await api.post<GetDeliverablesResponse>(
        `${planBase(clientId, planId)}/items/${encodeURIComponent(itemId)}/pieces`,
        body
      )
    );
  },
  async advancePiece(clientId: string, planId: string, pieceId: string, body: AdvanceDeliverablePieceRequest) {
    return toPlan(
      await api.post<GetDeliverablesResponse>(
        `${planBase(clientId, planId)}/pieces/${encodeURIComponent(pieceId)}/advance`,
        body
      )
    );
  },
  async revertPiece(clientId: string, planId: string, pieceId: string, body: RevertDeliverablePieceRequest) {
    return toPlan(
      await api.post<GetDeliverablesResponse>(
        `${planBase(clientId, planId)}/pieces/${encodeURIComponent(pieceId)}/revert`,
        body
      )
    );
  },
  async cancelPiece(clientId: string, planId: string, pieceId: string, body: CancelDeliverablePieceRequest) {
    return toPlan(
      await api.post<GetDeliverablesResponse>(
        `${planBase(clientId, planId)}/pieces/${encodeURIComponent(pieceId)}/cancel`,
        body
      )
    );
  },
  async closePlan(clientId: string, planId: string) {
    return toPlan(await api.post<GetDeliverablesResponse>(`${planBase(clientId, planId)}/close`, {}));
  },
  async reopenPlan(clientId: string, planId: string, body: ReopenDeliverablePlanRequest) {
    return toPlan(await api.post<GetDeliverablesResponse>(`${planBase(clientId, planId)}/reopen`, body));
  },
};

/**
 * F8-3 (DEC-F8-007) - Contador de Entregas por estágio (somente leitura).
 * Exige deliverables.view e content.view; erros (403/404) são propagados para a tela.
 */
export const contentStagesService = {
  async get(clientId: string, period: string): Promise<ContentStagesResponse> {
    return apiFetch<ContentStagesResponse>(
      `${base(clientId)}/content-stages?period=${encodeURIComponent(period)}`
    );
  },
};
