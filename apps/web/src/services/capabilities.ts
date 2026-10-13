import { api } from '@/lib/api';
import { CapabilitiesResponse } from '@zafira/contracts';

export const capabilitiesService = {
  /**
   * Consulta as capacidades RBAC efetivas do usuário humano na organização ativa.
   * Não presume permissão por cargo e não grava em storage permanente do navegador.
   * Respeita Cache-Control: no-store enviado pelo backend.
   */
  async getEffectiveCapabilities(organizationId?: string): Promise<CapabilitiesResponse> {
    const headers: Record<string, string> = {};
    if (organizationId) {
      headers['x-organization-id'] = organizationId;
    }
    return api.get<CapabilitiesResponse>('/api/v1/auth/capabilities', { headers });
  },
};
