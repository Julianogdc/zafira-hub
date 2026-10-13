import { api } from '@/lib/api';
import {
  DashboardAdminSummaryResponse,
  DashboardAdminSummaryResponseSchema,
  DashboardPeriod,
} from '@zafira/contracts';

export interface GetDashboardAdminSummaryParams {
  period?: DashboardPeriod;
  clientId?: string | null;
}

export async function getDashboardAdminSummary(
  params: GetDashboardAdminSummaryParams = {}
): Promise<DashboardAdminSummaryResponse> {
  const queryParams = new URLSearchParams();

  if (params.period) {
    queryParams.set('period', params.period);
  }

  if (params.clientId && params.clientId !== 'all') {
    queryParams.set('clientId', params.clientId);
  }

  const queryString = queryParams.toString();
  const endpoint = `/api/v1/dashboard/admin/summary${queryString ? `?${queryString}` : ''}`;

  const response = await api.get<{ status: string; data: unknown }>(endpoint);

  const parsed = DashboardAdminSummaryResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error('Falha na validação do contrato do Dashboard Admin');
  }

  return parsed.data;
}
