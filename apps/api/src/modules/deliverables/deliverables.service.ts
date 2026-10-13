import { prisma } from '../../lib/prisma.js';

/**
 * Leitura do plano de Entregas de um cliente em um período (F6-IMP.7).
 *
 * Leitura do plano. As escritas ficam em deliverables-operations.service.ts (F6-IMP.7B).
 * Toda consulta é filtrada pelo `organizationId` da sessão autenticada; o escopo
 * do cliente é validado pela rota antes de chegar aqui.
 *
 * Os nomes do banco (Prisma) são traduzidos para o contrato `@zafira/contracts`:
 *   item.type -> serviceType, link.type -> linkType, link.targetUrl -> url, plan.notes -> description.
 */

const toIso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

export interface DeliverableLinkView {
  id: string;
  organizationId: string;
  itemId: string;
  linkType: string;
  externalId: string | null;
  url: string | null;
  title: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeliverablePieceView {
  id: string;
  organizationId: string;
  itemId: string;
  title: string;
  format: string | null;
  stage: string;
  url: string | null;
  producedAt: string;
  producedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  deliveredAt: string | null;
  deliveredByName: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliverableItemView {
  id: string;
  organizationId: string;
  planId: string;
  serviceType: string;
  title: string;
  description: string | null;
  targetQuantity: number;
  deliveredQuantity: number;
  isExtra: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  links: DeliverableLinkView[];
  pieces: DeliverablePieceView[];
}

export interface DeliverableEventView {
  id: string;
  organizationId: string;
  planId: string | null;
  itemId: string | null;
  eventType: string;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface DeliverablePlanView {
  id: string;
  organizationId: string;
  clientId: string;
  period: string;
  title: string;
  description: string | null;
  status: string;
  closedAt: string | null;
  closedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  items: DeliverableItemView[];
  events: DeliverableEventView[];
}

const LINK_DEFAULT_TITLES: Record<string, string> = {
  ASANA_TASK: 'Tarefa no Asana',
  CONTENT_ITEM: 'Conteúdo vinculado',
  EXTERNAL_URL: 'Link externo',
  OTHER: 'Evidência',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DeliverablesService {
  async getClientPlan(
    organizationId: string,
    clientId: string,
    period: string
  ): Promise<DeliverablePlanView | null> {
    const plan = await prisma.deliverablePlan.findFirst({
      where: { organizationId, clientId, period },
      include: {
        items: {
          where: { organizationId },
          orderBy: [{ isExtra: 'asc' }, { createdAt: 'asc' }],
          include: {
            links: {
              where: { organizationId },
              orderBy: { createdAt: 'asc' },
            },
            pieces: {
              where: { organizationId },
              orderBy: { createdAt: 'asc' },
              include: {
                producedByUser: { select: { name: true } },
                approvedByUser: { select: { name: true } },
                deliveredByUser: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!plan) return null;

    const itemIds = plan.items.map((item) => item.id);
    // Eventos do plano e dos seus itens, sempre restritos à organização da sessão.
    const events = await prisma.deliverableEvent.findMany({
      where: {
        organizationId,
        OR: [{ planId: plan.id }, ...(itemIds.length > 0 ? [{ itemId: { in: itemIds } }] : [])],
      },
      orderBy: { createdAt: 'desc' },
      include: { actorUser: { select: { name: true } } },
    });

    return {
      id: plan.id,
      organizationId: plan.organizationId,
      clientId: plan.clientId,
      period: plan.period,
      title: plan.title,
      description: plan.notes ?? null,
      status: plan.status,
      closedAt: toIso(plan.closedAt),
      closedByUserId: plan.closedByUserId ?? null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      items: plan.items.map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        planId: item.planId,
        serviceType: item.type,
        title: item.title,
        description: item.description ?? null,
        targetQuantity: item.targetQuantity,
        deliveredQuantity: item.deliveredQuantity,
        isExtra: item.isExtra,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        links: item.links.map((link) => ({
          id: link.id,
          organizationId: link.organizationId,
          itemId: link.itemId,
          linkType: link.type,
          externalId: link.externalId ?? null,
          url: link.targetUrl ?? null,
          title: link.title || LINK_DEFAULT_TITLES[link.type] || 'Evidência',
          metadata: isPlainObject(link.metadata) ? link.metadata : null,
          createdAt: link.createdAt.toISOString(),
        })),
        pieces: item.pieces.map((piece) => ({
          id: piece.id,
          organizationId: piece.organizationId,
          itemId: piece.itemId,
          title: piece.title,
          format: piece.format ?? null,
          stage: piece.stage,
          url: piece.url ?? null,
          producedAt: piece.producedAt.toISOString(),
          producedByName: piece.producedByUser?.name ?? null,
          approvedAt: toIso(piece.approvedAt),
          approvedByName: piece.approvedByUser?.name ?? null,
          deliveredAt: toIso(piece.deliveredAt),
          deliveredByName: piece.deliveredByUser?.name ?? null,
          cancelledAt: toIso(piece.cancelledAt),
          createdAt: piece.createdAt.toISOString(),
          updatedAt: piece.updatedAt.toISOString(),
        })),
      })),
      events: events.map((event) => ({
        id: event.id,
        organizationId: event.organizationId,
        planId: event.planId ?? null,
        itemId: event.itemId ?? null,
        eventType: event.eventType,
        actorUserId: event.actorUserId ?? null,
        actorName: event.actorUser?.name ?? null,
        reason: event.reason ?? null,
        before: event.before ?? null,
        after: event.after ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}
