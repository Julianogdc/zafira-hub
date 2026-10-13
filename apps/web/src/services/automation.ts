import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { capabilitiesService } from '@/services/capabilities';

/**
 * F7-4b - Cliente da API de automacoes n8n (DEC-F7-016/017).
 * A interface nunca recebe nem guarda segredo: o servidor devolve so a impressao digital.
 * Capacidades so decidem o que MOSTRAR; cada rota valida a permissao de novo.
 */

export type AutomationOutboxStatus = 'PENDING' | 'SENT' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'DEAD';

export interface AutomationConnectionView {
  configured: boolean;
  hasSecret: boolean;
  secretFingerprint: string | null;
  timeoutHours: number;
  maxAttempts: number;
  dispatcherEnabled: boolean;
  callbackPath: string;
}

export interface AutomationFlowView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  webhookHost: string;
  enabled: boolean;
  subscribeLifecycle: boolean;
  includeClientName: boolean;
}

export interface AutomationFlowInput {
  key: string;
  name: string;
  description?: string | null;
  webhookUrl: string;
  enabled: boolean;
  subscribeLifecycle: boolean;
  includeClientName: boolean;
}

export interface AutomationHistoryItem {
  id: string;
  stepKey: string | null;
  flowKey: string;
  eventType: string;
  generation: number;
  status: AutomationOutboxStatus;
  attempts: number;
  sentAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  resultCode: string | null;
  externalRefs: { type: string; label: string; url: string }[];
}

export const automationService = {
  connection: () => api.get<AutomationConnectionView>('/automation/connection'),
  saveConnection: (body: { secret: string; timeoutHours: number; maxAttempts: number }) =>
    api.put<AutomationConnectionView>('/automation/connection', body),
  removeConnection: () => api.delete<AutomationConnectionView>('/automation/connection'),
  flows: () => api.get<AutomationFlowView[]>('/automation/flows'),
  createFlow: (body: AutomationFlowInput) => api.post<AutomationFlowView>('/automation/flows', body),
  updateFlow: (id: string, body: Partial<Omit<AutomationFlowInput, 'key'>>) =>
    api.patch<AutomationFlowView>(`/automation/flows/${encodeURIComponent(id)}`, body),
  history: (executionId: string) =>
    api.get<AutomationHistoryItem[]>(`/onboarding/executions/${encodeURIComponent(executionId)}/automation`),
  resend: (executionId: string, stepKey: string, mode: 'RETRY' | 'REDO', reason: string) =>
    api.post<{ ok: boolean; mode: string }>(
      `/onboarding/executions/${encodeURIComponent(executionId)}/steps/${encodeURIComponent(stepKey)}/automation/resend`,
      { mode, reason }
    ),
};

export interface AutomationCapabilities {
  loading: boolean;
  error: boolean;
  manage: boolean;
  view: boolean;
}

export function useAutomationCapabilities(organizationId?: string | null): AutomationCapabilities {
  const [state, setState] = useState<AutomationCapabilities>({ loading: true, error: false, manage: false, view: false });
  useEffect(() => {
    let alive = true;
    capabilitiesService
      .getEffectiveCapabilities(organizationId ?? undefined)
      .then((c) => {
        if (!alive) return;
        const p = c.permissions as Record<string, boolean>;
        setState({ loading: false, error: false, manage: Boolean(p['automation.manage']), view: Boolean(p['automation.view']) });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: true, manage: false, view: false });
      });
    return () => {
      alive = false;
    };
  }, [organizationId]);
  return state;
}

export function automationErrorInfo(error: unknown): { status: number; code?: string; message: string } {
  const e = error as { status?: number; message?: string; data?: { code?: string } } | null;
  return { status: e?.status ?? 0, code: e?.data?.code, message: e?.message || 'Nao foi possivel concluir a operacao.' };
}
