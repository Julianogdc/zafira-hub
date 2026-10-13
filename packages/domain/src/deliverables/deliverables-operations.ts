import {
  DELIVERABLE_CONTENT_FORMATS,
  DELIVERABLE_SERVICE_TYPES,
  type DeliverableContentFormat,
  type DeliverableItemStatus,
  type DeliverablePieceStage,
  type DeliverableServiceType,
} from '@zafira/contracts';
import { DeliverableDomainError } from './deliverables-policy.js';

/* ==========================================================================
   OPERAÇÃO DE ENTREGAS (F6-IMP.7B — DEC-F6-002)
   Peças passam por PRODUCED → APPROVED → DELIVERED e só contam como entregues
   na última etapa. Registro manual, sem prova obrigatória (até F8/Postiz).
   ========================================================================== */

export function isDeliverableServiceType(value: string): value is DeliverableServiceType {
  return (DELIVERABLE_SERVICE_TYPES as readonly string[]).includes(value);
}

/**
 * Formato da peça: obrigatório e restrito a CONTENT_FORMATS para o pacote de conteúdos;
 * proibido para os demais serviços. Itens antigos com tipo fora da taxonomia aceitam formato vazio.
 */
export function validatePieceFormat(
  serviceType: string,
  format: string | null | undefined
): DeliverableContentFormat | null {
  if (serviceType === 'CONTEUDO_SOCIAL') {
    if (!format || !(DELIVERABLE_CONTENT_FORMATS as readonly string[]).includes(format)) {
      throw new DeliverableDomainError(
        'Conteúdo para redes exige o formato: feed, carrossel, Reels ou Stories.',
        'FORMAT_REQUIRED'
      );
    }
    return format as DeliverableContentFormat;
  }
  if (format) {
    throw new DeliverableDomainError('Formato só se aplica a conteúdos para redes.', 'FORMAT_NOT_ALLOWED');
  }
  return null;
}

const NEXT_STAGE: Partial<Record<DeliverablePieceStage, DeliverablePieceStage>> = {
  PRODUCED: 'APPROVED',
  APPROVED: 'DELIVERED',
};

const PREVIOUS_STAGE: Partial<Record<DeliverablePieceStage, DeliverablePieceStage>> = {
  APPROVED: 'PRODUCED',
  DELIVERED: 'APPROVED',
};

/** Próxima etapa da peça. Peça entregue ou cancelada não avança. */
export function nextPieceStage(stage: DeliverablePieceStage): DeliverablePieceStage {
  const next = NEXT_STAGE[stage];
  if (!next) {
    throw new DeliverableDomainError(
      stage === 'DELIVERED' ? 'A peça já está entregue.' : 'Peça cancelada não pode avançar.',
      'INVALID_STAGE_TRANSITION'
    );
  }
  return next;
}

function assertReason(reason: string | null | undefined, action: string): void {
  if (!reason || reason.trim().length < 3) {
    throw new DeliverableDomainError(`${action} exige justificativa com no mínimo 3 caracteres.`, 'REASON_REQUIRED');
  }
}

/** Volta uma etapa (correção de engano), sempre com justificativa. */
export function previousPieceStage(stage: DeliverablePieceStage, reason: string | null | undefined): DeliverablePieceStage {
  const previous = PREVIOUS_STAGE[stage];
  if (!previous) {
    throw new DeliverableDomainError(
      stage === 'PRODUCED' ? 'A peça já está na primeira etapa.' : 'Peça cancelada não pode voltar etapa.',
      'INVALID_STAGE_TRANSITION'
    );
  }
  assertReason(reason, 'Voltar etapa');
  return previous;
}

/** Cancela uma peça (não conta mais), sempre com justificativa. */
export function validatePieceCancel(stage: DeliverablePieceStage, reason: string | null | undefined): void {
  if (stage === 'CANCELLED') {
    throw new DeliverableDomainError('A peça já está cancelada.', 'INVALID_STAGE_TRANSITION');
  }
  assertReason(reason, 'Cancelar peça');
}

/**
 * Situação derivada de uma linha do plano a partir das suas peças.
 * deliveredQuantity = peças na etapa DELIVERED (podem passar da meta: o excedente é extra).
 */
export function deriveItemProgress(
  targetQuantity: number,
  stages: readonly DeliverablePieceStage[]
): { deliveredQuantity: number; status: DeliverableItemStatus } {
  const deliveredQuantity = stages.filter((stage) => stage === 'DELIVERED').length;
  const active = stages.filter((stage) => stage !== 'CANCELLED').length;
  let status: DeliverableItemStatus = 'PENDING';
  if (deliveredQuantity >= targetQuantity && targetQuantity > 0) status = 'DELIVERED';
  else if (active > 0) status = 'IN_PROGRESS';
  return { deliveredQuantity, status };
}
