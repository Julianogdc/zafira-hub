import { PrismaClient, Prisma } from '@prisma/client';
import { prisma as globalPrisma } from '../../lib/prisma.js';
import { AsaasService } from '../integrations/asaas/asaas.service.js';
import { resolveAuthorizationContext } from '../authorization/resolver.js';
import { buildClientResourceScopeWhere } from '../authorization/client-resource-scope.js';
import { RoleType } from '@zafira/domain';
import {
  DashboardAdminQuery,
  DashboardAdminSummaryResponse,
  DashboardFinancialSummary,
  DashboardPeriod,
  MrrMetric,
} from '@zafira/contracts';

export class DashboardError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}

export interface GetAdminSummaryParams {
  organizationId: string;
  membershipId: string;
  role: RoleType;
  userId: string | null;
  query: DashboardAdminQuery;
  referenceDate?: Date;
}

/**
 * Mapeia os períodos '7d', '30d', '90d' para janelas de datas reais determinísticas de dias civis (inclusivas).
 * Semântica oficial:
 * 7d  = HOJE + 6 dias anteriores (total: 7 datas civis)
 * 30d = HOJE + 29 dias anteriores (total: 30 datas civis)
 * 90d = HOJE + 89 dias anteriores (total: 90 datas civis)
 */
export function calculateDashboardDateRange(
  period: DashboardPeriod = '30d',
  referenceDate: Date = new Date()
): { start: Date; end: Date } {
  const end = new Date(referenceDate);
  const start = new Date(referenceDate);

  if (period === '7d') {
    start.setDate(start.getDate() - 6);
  } else if (period === '90d') {
    start.setDate(start.getDate() - 89);
  } else {
    // Padrão: 30d
    start.setDate(start.getDate() - 29);
  }

  return { start, end };
}

export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient = globalPrisma,
    private readonly asaasService: AsaasService = new AsaasService(globalPrisma)
  ) {}

  async getAdminSummary({
    organizationId,
    membershipId,
    role,
    userId,
    query,
    referenceDate,
  }: GetAdminSummaryParams): Promise<DashboardAdminSummaryResponse> {
    if (!organizationId) {
      throw new DashboardError(400, 'ORG_REQUIRED', 'Organização é obrigatória');
    }

    // 1. Constrói o Resource Scope canônico (Direto + Equipes)
    // Para ADMIN: escopo irrestrito na organização ativa.
    // Para MANAGER / MEMBER com override: união de UserClientAssignment e TeamClientAssignment.
    const scopeWhere = buildClientResourceScopeWhere({
      organizationId,
      membershipId,
      role,
    });

    // 2. Validação estrita de Tenant Isolation E Resource Scope para clientId
    if (query.clientId) {
      const clientInScope = await this.prisma.client.findFirst({
        where: {
          AND: [
            scopeWhere,
            { id: query.clientId },
          ],
        },
        select: { id: true },
      });

      // Se cliente não existe na organização OU não pertence ao scope do membro: falha fechado com 404 genérico
      if (!clientInScope) {
        throw new DashboardError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado na organização');
      }
    }

    // 3. Resolução segura de permissão financeira (financial.view_summary)
    let hasFinancialPermission = false;
    if (userId) {
      const finAuth = await resolveAuthorizationContext({
        userId,
        activeOrganizationId: organizationId,
        permissionCode: 'financial.view_summary',
      });
      hasFinancialPermission = finAuth.allowed;
    }

    // 4. Cláusula de consulta de clientes aplicando compulsoriamente o Resource Scope
    const clientWhere: Prisma.ClientWhereInput = {
      AND: [
        scopeWhere,
        ...(query.clientId ? [{ id: query.clientId }] : []),
      ],
    };

    // 5. Executa consultas no PostgreSQL em paralelo para evitar N+1 e latência sequencial
    const activeCountPromise = this.prisma.client.count({
      where: {
        ...clientWhere,
        status: 'ACTIVE',
      },
    });

    const statusGroupPromise = this.prisma.client.groupBy({
      by: ['status'],
      where: clientWhere,
      _count: {
        id: true,
      },
    });

    // C) Clientes ativos com contractValue para cálculo do MRR: consultados SOMENTE se o usuário possui permissão financeira
    const activeClientsWithContractPromise = hasFinancialPermission
      ? this.prisma.client.findMany({
          where: {
            ...clientWhere,
            status: 'ACTIVE',
          },
          select: {
            contractValue: true,
          },
        })
      : Promise.resolve(null);

    // D) Opções de clientes permitidos no Resource Scope completo (sem limitar pelo query.clientId selecionado)
    const clientOptionsPromise = this.prisma.client.findMany({
      where: scopeWhere,
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    const [activeCount, statusGroup, activeClientsWithContract, clientOptions] = await Promise.all([
      activeCountPromise,
      statusGroupPromise,
      activeClientsWithContractPromise,
      clientOptionsPromise,
    ]);

    // 6. Cálculo do MRR no escopo (Fail-closed quando sem permissão financeira; null != zero quando autorizado)
    let mrrMetric: MrrMetric;
    if (!hasFinancialPermission || !activeClientsWithContract) {
      mrrMetric = {
        available: false,
        knownValue: null,
        activeClientsCount: null,
        missingContractValueCount: null,
        isComplete: null,
        reason: 'INSUFFICIENT_PERMISSIONS',
        source: 'HUB_CALCULATED',
      };
    } else {
      const activeClientsCount = activeClientsWithContract.length;
      let sumContractValue = 0;
      let knownValuesCount = 0;
      let missingContractValueCount = 0;

      for (const c of activeClientsWithContract) {
        if (c.contractValue === null || c.contractValue === undefined) {
          missingContractValueCount++;
        } else {
          sumContractValue += Number(c.contractValue);
          knownValuesCount++;
        }
      }

      const knownValue = knownValuesCount > 0 ? sumContractValue : null;
      const isComplete = activeClientsCount > 0 && missingContractValueCount === 0;

      mrrMetric = {
        available: true,
        knownValue,
        activeClientsCount,
        missingContractValueCount,
        isComplete,
        source: 'HUB_CALCULATED',
      };
    }

    // 7. Distribuição real de clientes no escopo por status
    const statusMap = {
      ACTIVE: 0,
      PAUSED: 0,
      INACTIVE: 0,
      LEAD: 0,
    };

    for (const g of statusGroup) {
      if (g.status in statusMap) {
        statusMap[g.status as keyof typeof statusMap] = g._count.id;
      }
    }

    const totalClients = statusMap.ACTIVE + statusMap.PAUSED + statusMap.INACTIVE + statusMap.LEAD;

    // 8. Resumo Financeiro Asaas com Resource Scope e proteção RBAC
    let financialSummary: DashboardFinancialSummary;
    if (!hasFinancialPermission) {
      // Se não possui financial.view_summary: NUNCA chama getFinancialOverview
      financialSummary = {
        available: false,
        receivedInPeriod: null,
        pending: null,
        overdue: null,
        overdueCount: null,
        reason: 'INSUFFICIENT_PERMISSIONS',
        source: 'PROVIDER_DIRECT',
      };
    } else {
      const { start: startDate, end: endDate } = calculateDashboardDateRange(query.period, referenceDate);

      // Para membros que não são ADMIN, resolve os clientes autorizados no seu resource scope
      // para filtragem estrita ou cálculo da interseção segura no AsaasService
      let allowedClientIds: string[] | undefined = undefined;
      if (role !== 'ADMIN') {
        const scopedClients = await this.prisma.client.findMany({
          where: scopeWhere,
          select: { id: true },
        });
        allowedClientIds = scopedClients.map((c) => c.id);
      }

      const asaasOverview = await this.asaasService.getFinancialOverview(organizationId, {
        period: 'custom',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        clientId: query.clientId,
        clientIds: allowedClientIds,
      });

      financialSummary = {
        available: true,
        receivedInPeriod: asaasOverview.kpis.receivedMonth,
        pending: asaasOverview.kpis.pending,
        overdue: asaasOverview.kpis.overdue,
        overdueCount: asaasOverview.kpis.overdueCount,
        source: 'PROVIDER_DIRECT',
      };
    }

    // 9. Metadados do payload
    const now = referenceDate || new Date();
    const meta = {
      period: query.period,
      clientId: query.clientId || null,
      organizationId,
      generatedAt: now.toISOString(),
    };

    return {
      activeClients: {
        count: activeCount,
        source: 'HUB_REGISTERED',
      },
      mrr: mrrMetric,
      clientsByStatus: {
        active: statusMap.ACTIVE,
        paused: statusMap.PAUSED,
        inactive: statusMap.INACTIVE,
        lead: statusMap.LEAD,
        total: totalClients,
        source: 'HUB_CALCULATED',
      },
      financial: financialSummary,
      clientOptions: clientOptions.map((c) => ({
        id: c.id,
        name: c.name,
      })),
      meta,
    };
  }
}

export const dashboardService = new DashboardService();
