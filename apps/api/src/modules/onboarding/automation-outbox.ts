import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AutomationEventType } from '@zafira/contracts';

/**
 * F7-4a - Caixa de saida transacional das automacoes n8n (DEC-F7-016).
 * O pedido e gravado NA MESMA TRANSACAO que libera a etapa (persistido antes de qualquer envio).
 * A chave de idempotencia e deterministica e estavel em reenvios; so uma nova GERACAO a altera.
 * Garantia do Hub: um pedido por (execucao, etapa, fluxo, tipo, geracao). A execucao "exatamente uma vez"
 * no sistema externo depende de o fluxo n8n respeitar a chave.
 */

type Tx = Prisma.TransactionClient;

export function idempotencyKeyFor(p: {
  organizationId: string;
  executionId: string;
  stepKey: string | null;
  flowKey: string;
  eventType: AutomationEventType;
  generation: number;
}): string {
  return createHash('sha256')
    .update(['zafira-automation-v1', p.organizationId, p.executionId, p.stepKey ?? '', p.flowKey, p.eventType, String(p.generation)].join('|'))
    .digest('hex');
}

/** Etapa AUTOMATION liberada: um pedido (geracao 1). Repetir a liberacao nao duplica (ON CONFLICT DO NOTHING). */
export async function enqueueStepAutomation(
  tx: Tx,
  p: { organizationId: string; executionId: string; stepKey: string; flowKey: string }
): Promise<void> {
  await tx.automationOutbox.createMany({
    data: [
      {
        organizationId: p.organizationId,
        executionId: p.executionId,
        stepKey: p.stepKey,
        flowKey: p.flowKey,
        eventType: 'STEP_AUTOMATION',
        generation: 1,
        idempotencyKey: idempotencyKeyFor({ ...p, eventType: 'STEP_AUTOMATION', generation: 1 }),
      },
    ],
    skipDuplicates: true,
  });
}

/** Notificacoes informativas (inicio, conclusao, cancelamento) aos fluxos inscritos e habilitados. */
export async function enqueueLifecycle(
  tx: Tx,
  p: { organizationId: string; executionId: string; eventType: Exclude<AutomationEventType, 'STEP_AUTOMATION'> }
): Promise<void> {
  const flows = await tx.automationFlow.findMany({
    where: { organizationId: p.organizationId, enabled: true, subscribeLifecycle: true },
    select: { key: true },
  });
  if (flows.length === 0) return;
  await tx.automationOutbox.createMany({
    data: flows.map((f) => ({
      organizationId: p.organizationId,
      executionId: p.executionId,
      stepKey: null,
      flowKey: f.key,
      eventType: p.eventType,
      generation: 1,
      idempotencyKey: idempotencyKeyFor({ ...p, stepKey: null, flowKey: f.key, generation: 1 }),
    })),
    skipDuplicates: true,
  });
}
