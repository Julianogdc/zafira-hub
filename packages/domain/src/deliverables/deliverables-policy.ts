import type {
  DeliverablePlanStatus,
  DeliverableItemStatus,
  DeliverableLinkType,
  DeliverableEventType
} from '@zafira/contracts';

/* ==========================================================================
   1. ERROS DE DOMÍNIO
   ========================================================================== */

export class DeliverableDomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DeliverableDomainError';
  }
}

/* ==========================================================================
   2. ISOLAMENTO MULTI-TENANT
   ========================================================================== */

export interface TenantEntity {
  organizationId: string;
}

/**
 * Garante que todas as entidades envolvidas pertencem estritamente à mesma organização.
 */
export function assertSameOrganization(
  expectedOrganizationId: string,
  entities: Array<{ name: string; organizationId: string }>
): void {
  for (const entity of entities) {
    if (entity.organizationId !== expectedOrganizationId) {
      throw new DeliverableDomainError(
        `Isolamento multi-tenant violado: ${entity.name} pertence à organização ${entity.organizationId}, esperado ${expectedOrganizationId}`,
        'TENANT_MISMATCH'
      );
    }
  }
}

/**
 * Valida que o cliente pertence estritamente à mesma organização do plano de entregas.
 */
export function validatePlanClientTenant(
  plan: { organizationId: string; clientId?: string },
  client: { organizationId: string; id: string }
): void {
  if (plan.organizationId !== client.organizationId) {
    throw new DeliverableDomainError(
      `Isolamento multi-tenant violado: Client ${client.id} (org: ${client.organizationId}) não pertence à organização do plano (org: ${plan.organizationId})`,
      'TENANT_MISMATCH'
    );
  }
}

/**
 * Valida que o usuário que executa/fecha a entrega pertence como membro ativo à organização informada.
 */
export function validateUserTenantMembership(
  expectedOrganizationId: string,
  member: { organizationId: string; userId: string; status?: string }
): void {
  if (member.organizationId !== expectedOrganizationId) {
    throw new DeliverableDomainError(
      `Isolamento multi-tenant violado: Usuário ${member.userId} pertence à organização ${member.organizationId}, esperado ${expectedOrganizationId}`,
      'TENANT_MISMATCH'
    );
  }

  if (member.status && member.status !== 'ACTIVE') {
    throw new DeliverableDomainError(
      `Acesso negado: Membro ${member.userId} não está ativo na organização ${expectedOrganizationId} (status: ${member.status})`,
      'INACTIVE_MEMBERSHIP'
    );
  }
}

/**
 * Valida que o item pertence à mesma organização e ao mesmo plano especificado.
 */
export function validateItemPlanTenant(
  plan: { organizationId: string; id: string },
  item: { organizationId: string; planId: string; id?: string }
): void {
  if (plan.organizationId !== item.organizationId) {
    throw new DeliverableDomainError(
      `Isolamento multi-tenant violado: DeliverableItem pertence à organização ${item.organizationId}, esperado ${plan.organizationId}`,
      'TENANT_MISMATCH'
    );
  }

  if (plan.id !== item.planId) {
    throw new DeliverableDomainError(
      `Integridade violada: DeliverableItem está vinculado ao plano ${item.planId}, esperado ${plan.id}`,
      'PLAN_MISMATCH'
    );
  }
}

/**
 * Valida que o ator do evento pertence à organização do evento/plano.
 */
export function validateEventActorTenant(
  event: { organizationId: string },
  actorMember: { organizationId: string; userId: string; status?: string }
): void {
  validateUserTenantMembership(event.organizationId, actorMember);
}


/* ==========================================================================
   3. VALIDAÇÃO DE ESTADO E IMUTABILIDADE DO PLANO
   ========================================================================== */

/**
 * Verifica se um plano permite alterações (não pode estar CLOSED nem CANCELLED).
 */
export function assertPlanMutable(plan: { status: DeliverablePlanStatus; id?: string }): void {
  if (plan.status === 'CLOSED') {
    throw new DeliverableDomainError(
      'O plano de entregas está encerrado (CLOSED). Reabra o plano formalmente antes de fazer alterações.',
      'PLAN_CLOSED_IMMUTABLE'
    );
  }
  if (plan.status === 'CANCELLED') {
    throw new DeliverableDomainError(
      'O plano de entregas está cancelado (CANCELLED) e não aceita modificações.',
      'PLAN_CANCELLED_IMMUTABLE'
    );
  }
}

/**
 * Valida a reabertura de um plano fechado.
 * Exige permissão deliverables.reopen e justificativa auditável.
 */
export function validatePlanReopen(params: {
  currentStatus: DeliverablePlanStatus;
  userPermissions: readonly string[];
  reason?: string | null;
}): void {
  if (params.currentStatus !== 'CLOSED') {
    throw new DeliverableDomainError(
      `Apenas planos com status CLOSED podem ser reabertos. Status atual: ${params.currentStatus}`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  if (!params.userPermissions.includes('deliverables.reopen')) {
    throw new DeliverableDomainError(
      'Usuário não possui a permissão necessária para reabrir plano de entregas (deliverables.reopen).',
      'PERMISSION_DENIED'
    );
  }

  if (!params.reason || params.reason.trim().length < 3) {
    throw new DeliverableDomainError(
      'Reabertura de plano exige justificativa auditável com no mínimo 3 caracteres.',
      'REASON_REQUIRED'
    );
  }
}

/**
 * Valida o fechamento de um plano de entregas.
 * Exige permissão deliverables.complete.
 */
export function validatePlanClosure(params: {
  currentStatus: DeliverablePlanStatus;
  userPermissions: readonly string[];
}): void {
  if (params.currentStatus === 'CLOSED') {
    throw new DeliverableDomainError('O plano já se encontra fechado.', 'ALREADY_CLOSED');
  }

  if (params.currentStatus === 'CANCELLED') {
    throw new DeliverableDomainError('Um plano cancelado não pode ser fechado.', 'INVALID_STATUS_TRANSITION');
  }

  if (!params.userPermissions.includes('deliverables.complete')) {
    throw new DeliverableDomainError(
      'Usuário não possui a permissão necessária para fechar plano de entregas (deliverables.complete).',
      'PERMISSION_DENIED'
    );
  }
}

/* ==========================================================================
   4. AJUSTE DE METAS (AUDITABILIDADE E PERMISSÃO)
   ========================================================================== */

export interface TargetAdjustmentParams {
  currentTargetQuantity: number;
  newTargetQuantity: number;
  userPermissions: readonly string[];
  reason?: string | null;
  planStatus: DeliverablePlanStatus;
}

/**
 * Valida a alteração de meta contratada de um item.
 * Exige permissão deliverables.adjust_target e justificativa obrigatória.
 */
export function validateTargetAdjustment(params: TargetAdjustmentParams): void {
  assertPlanMutable({ status: params.planStatus });

  if (!Number.isInteger(params.newTargetQuantity) || params.newTargetQuantity < 1) {
    throw new DeliverableDomainError(
      'A meta de entregas deve ser um número inteiro maior ou igual a 1.',
      'INVALID_TARGET_QUANTITY'
    );
  }

  if (params.currentTargetQuantity === params.newTargetQuantity) {
    return; // Nenhuma alteração efetiva
  }

  if (!params.userPermissions.includes('deliverables.adjust_target')) {
    throw new DeliverableDomainError(
      'Usuário não possui permissão para ajustar metas contratuais (deliverables.adjust_target).',
      'PERMISSION_DENIED'
    );
  }

  if (!params.reason || params.reason.trim().length < 3) {
    throw new DeliverableDomainError(
      'Ajuste de meta contratada exige justificativa auditável com no mínimo 3 caracteres.',
      'REASON_REQUIRED'
    );
  }
}

/* ==========================================================================
   5. CÁLCULO E SEGREGAÇÃO DE MÉTRICAS (CONTRATADO VS EXTRA)
   ========================================================================== */

export interface DeliverableItemSummary {
  targetQuantity: number;
  deliveredQuantity: number;
  isExtra: boolean;
  status: DeliverableItemStatus;
}

export interface PlanMetricsResult {
  contractedTargetCount: number;
  contractedDeliveredCount: number;
  contractedPendingCount: number;
  contractedProgressPercent: number;
  extraDeliveredCount: number;
  totalDeliveredCount: number;
  isFullyDelivered: boolean;
}

/**
 * Calcula as métricas consolidadas do plano com estrita segregação de itens extras.
 * Regra do Mapa Mestre: itens extras NUNCA compensam nem mascaram déficits de metas contratadas.
 * DEC-F6-002: cada linha conta no máximo até a própria meta; o excedente de uma linha é extra
 * e não cobre o déficit de outra.
 */
export function calculatePlanMetrics(items: readonly DeliverableItemSummary[]): PlanMetricsResult {
  let contractedTargetCount = 0;
  let contractedDeliveredCount = 0;
  let extraDeliveredCount = 0;

  for (const item of items) {
    if (item.status === 'CANCELLED') {
      continue;
    }

    if (item.isExtra) {
      extraDeliveredCount += Math.max(0, item.deliveredQuantity);
    } else {
      const target = Math.max(0, item.targetQuantity);
      const delivered = Math.max(0, item.deliveredQuantity);
      contractedTargetCount += target;
      contractedDeliveredCount += Math.min(delivered, target);
      extraDeliveredCount += Math.max(0, delivered - target);
    }
  }

  const contractedPendingCount = Math.max(0, contractedTargetCount - contractedDeliveredCount);

  let contractedProgressPercent = 0;
  if (contractedTargetCount > 0) {
    contractedProgressPercent = Math.min(
      100,
      Math.round((contractedDeliveredCount / contractedTargetCount) * 100)
    );
  } else if (contractedDeliveredCount > 0) {
    contractedProgressPercent = 100;
  }

  const totalDeliveredCount = contractedDeliveredCount + extraDeliveredCount;
  const isFullyDelivered = contractedTargetCount > 0 && contractedDeliveredCount >= contractedTargetCount;

  return {
    contractedTargetCount,
    contractedDeliveredCount,
    contractedPendingCount,
    contractedProgressPercent,
    extraDeliveredCount,
    totalDeliveredCount,
    isFullyDelivered,
  };
}

/* ==========================================================================
   6. VÍNCULOS DE EVIDÊNCIA (ASANA E EXTERNOS)
   ========================================================================== */

export interface DeliverableEvidenceParams {
  planStatus: DeliverablePlanStatus;
  linkType: DeliverableLinkType;
  title: string;
  externalId?: string | null;
  url?: string | null;
}

/**
 * Valida o vínculo de evidência para um item de entrega.
 * Garante que o plano está ativo e que o Asana atua exclusivamente como evidência.
 */
export function validateDeliverableEvidence(params: DeliverableEvidenceParams): void {
  assertPlanMutable({ status: params.planStatus });

  if (!params.title || params.title.trim().length === 0) {
    throw new DeliverableDomainError('Título da evidência é obrigatório.', 'TITLE_REQUIRED');
  }

  if (params.linkType === 'ASANA_TASK' && !params.externalId) {
    throw new DeliverableDomainError(
      'Vínculo do tipo ASANA_TASK exige a identificação externa da tarefa (externalId / GID).',
      'ASANA_GID_REQUIRED'
    );
  }

  if (params.linkType === 'EXTERNAL_URL' && !params.url) {
    throw new DeliverableDomainError(
      'Vínculo do tipo EXTERNAL_URL exige o fornecimento de uma URL válida.',
      'URL_REQUIRED'
    );
  }
}
