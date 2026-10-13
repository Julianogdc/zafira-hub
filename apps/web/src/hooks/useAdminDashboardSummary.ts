import { useQuery } from '@tanstack/react-query';
import { DashboardPeriod, DashboardAdminSummaryResponse } from '@zafira/contracts';
import { getDashboardAdminSummary } from '@/services/dashboard';

export interface UseAdminDashboardSummaryOptions {
  period: DashboardPeriod;
  clientId?: string | null;
  enabled?: boolean;
}

export function useAdminDashboardSummary({
  period,
  clientId = 'all',
  enabled = true,
}: UseAdminDashboardSummaryOptions) {
  const selectedClientId = clientId || 'all';

  return useQuery<DashboardAdminSummaryResponse, Error>({
    queryKey: ['dashboard', 'admin', 'summary', period, selectedClientId],
    queryFn: () => getDashboardAdminSummary({ period, clientId: selectedClientId }),
    staleTime: 60_000,
    enabled,
  });
}
