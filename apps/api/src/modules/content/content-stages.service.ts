import type { ContentStagesResponse } from '@zafira/contracts';
import {
  CONTENT_PERIOD_PATTERN,
  contentPeriodOf,
  contentStageOf,
  countContentStages,
  type ContentFormat,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { findClientInResourceScope } from '../authorization/client-resource-scope.js';
import { getOrganizationTimeZone } from '../organization-config/organization-config.service.js';
import { approvalService } from './approval.service.js';
import { ContentContext, ContentError } from './content.service.js';

/**
 * F8-3 (DEC-F8-007) - Contador de Entregas por estagio. SOMENTE LEITURA.
 * Derivado dos registros reais da F8-1/F8-2 (arquivos, envio da versao, decisao do cliente).
 * Nao grava nada: meta contratual, pecas e etapas manuais de Entregas ficam intactas.
 * Publicados: sem confirmacao confiavel nesta fatia -> null (NOT_INTEGRATED), nunca 0.
 */
export class ContentStagesService {
  async forClientPeriod(ctx: ContentContext, clientId: string, period: string): Promise<ContentStagesResponse> {
    if (!CONTENT_PERIOD_PATTERN.test(period)) {
      throw new ContentError(400, 'INVALID_PERIOD', 'Competência inválida (use AAAA-MM).');
    }
    const client = await findClientInResourceScope(
      prisma,
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role },
      clientId
    );
    if (!client) throw new ContentError(404, 'NOT_FOUND', 'Cliente não encontrado.');

    const orgId = ctx.organizationId;
    const timeZone = await getOrganizationTimeZone(orgId);
    const items = await prisma.contentItem.findMany({
      where: { organizationId: orgId, clientId, archivedAt: null },
      select: { id: true, title: true, format: true, deliverablePieceId: true },
    });
    const itemIds = items.map((i) => i.id);
    const pieceIds = [...new Set(items.map((i) => i.deliverablePieceId).filter((p): p is string => Boolean(p)))];

    const [pieces, firstMedia, firstSent, firstApproved] = await Promise.all([
      pieceIds.length
        ? prisma.deliverablePiece.findMany({
            // so pecas da mesma organizacao e do mesmo cliente valem para a competencia
            where: { organizationId: orgId, id: { in: pieceIds }, item: { plan: { clientId } } },
            select: { id: true, item: { select: { plan: { select: { period: true } } } } },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.contentMedia.groupBy({
            by: ['itemId'],
            where: { organizationId: orgId, itemId: { in: itemIds } }, // inclui arquivos removidos depois
            _min: { createdAt: true },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.contentVersion.groupBy({
            by: ['itemId'],
            where: { organizationId: orgId, itemId: { in: itemIds }, sentForApprovalAt: { not: null } },
            _min: { sentForApprovalAt: true },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.approvalDecision.groupBy({
            by: ['itemId'],
            where: { organizationId: orgId, itemId: { in: itemIds }, decision: 'APPROVED' },
            _min: { createdAt: true },
          })
        : Promise.resolve([]),
    ]);

    const planPeriodByPiece = new Map(pieces.map((p) => [p.id, p.item.plan.period]));
    const receivedBy = new Map(firstMedia.map((r) => [r.itemId, r._min.createdAt]));
    const sentBy = new Map(firstSent.map((r) => [r.itemId, r._min.sentForApprovalAt]));
    const approvedBy = new Map(firstApproved.map((r) => [r.itemId, r._min.createdAt]));

    const inPeriod = items.flatMap((item) => {
      const dates = {
        receivedAt: receivedBy.get(item.id) ?? null,
        sentAt: sentBy.get(item.id) ?? null,
        approvedAt: approvedBy.get(item.id) ?? null,
      };
      const stage = contentStageOf(dates);
      if (!stage) return [];
      const linkedPlanPeriod = item.deliverablePieceId ? (planPeriodByPiece.get(item.deliverablePieceId) ?? null) : null;
      const competence = contentPeriodOf({ linkedPlanPeriod, receivedAt: dates.receivedAt }, timeZone);
      if (!competence || competence.period !== period) return [];
      return [{ item, dates, stage, periodSource: competence.source }];
    });

    const status = await approvalService.statusMap(ctx, inPeriod.map((r) => r.item.id));
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return {
      clientId,
      period,
      timeZone,
      counts: countContentStages(inPeriod.map((r) => r.stage)),
      items: inPeriod.map(({ item, dates, stage, periodSource }) => ({
        id: item.id,
        title: item.title,
        format: item.format as ContentFormat,
        stage,
        periodSource,
        receivedAt: iso(dates.receivedAt),
        sentAt: iso(dates.sentAt),
        approvedAt: iso(dates.approvedAt),
        currentStatus: status.get(item.id) ?? 'NOT_SENT',
      })),
    };
  }
}

export const contentStagesService = new ContentStagesService();
