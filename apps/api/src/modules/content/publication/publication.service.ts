import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { RequestPublication, ReschedulePublication } from '@zafira/contracts';
import {
  canCancelPublication,
  canReschedulePublication,
  checkDailyCap,
  checkScheduleLead,
  isPilotPlatform,
  parseScheduledAt,
  validatePublicationContent,
  type ContentFormat,
  type ContentMediaKind,
  type PublicationState,
} from '@zafira/domain';
import { prisma } from '../../../lib/prisma.js';
import { AuditService } from '../../audit/audit.service.js';
import { buildClientResourceScopeWhere } from '../../authorization/client-resource-scope.js';
import { ContentContext, ContentError } from '../content.service.js';

/**
 * F8-4a (DEC-F8-023) - Pedidos de publicacao pela versao APROVADA. Nenhuma chamada externa aqui:
 * a publicacao e o pedido na caixa de saida sao gravados na mesma transacao; o despachante (desligado
 * por padrao) e quem fala com o provedor. Piloto: Instagram (D-F84-4). Antecedencia minima de 5 min (D-F84-2).
 */

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 3600_000;

function scopeOf(ctx: ContentContext) {
  return { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role };
}

export function publicationView(p: {
  id: string; itemId: string; versionId: string; socialAccountId: string; platform: string; state: string; scheduledAt: Date;
  externalPostId: string | null; platformPostId: string | null; permalink: string | null; publishedAt: Date | null;
  failureCode: string | null; failureMessage: string | null; cancelRequestedAt: Date | null; lastSyncedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: p.id,
    itemId: p.itemId,
    versionId: p.versionId,
    socialAccountId: p.socialAccountId,
    platform: p.platform,
    state: p.state as PublicationState,
    scheduledAt: p.scheduledAt.toISOString(),
    hasExternalPost: Boolean(p.externalPostId),
    platformPostId: p.platformPostId,
    permalink: p.permalink,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    failureCode: p.failureCode,
    failureMessage: p.failureMessage,
    cancelRequestedAt: p.cancelRequestedAt?.toISOString() ?? null,
    lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export class PublicationService {
  private async event(db: Tx, ctx: ContentContext, itemId: string, versionId: string, type: string, data: Prisma.InputJsonValue) {
    await db.contentEvent.create({ data: { organizationId: ctx.organizationId, itemId, versionId, type, actorUserId: ctx.userId, data } });
    await new AuditService(db as never).record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: `content.${type.toLowerCase()}`,
      entityType: 'ContentPublication',
      entityId: itemId,
      metadata: data as Record<string, unknown>,
    });
  }

  private async loadPublication(db: Tx | typeof prisma, ctx: ContentContext, publicationId: string) {
    const p = await db.contentPublication.findFirst({
      where: { id: publicationId, organizationId: ctx.organizationId, client: buildClientResourceScopeWhere(scopeOf(ctx)) },
    });
    if (!p) throw new ContentError(404, 'NOT_FOUND', 'Publicação não encontrada.');
    return p;
  }

  async list(ctx: ContentContext, itemId: string) {
    const item = await prisma.contentItem.findFirst({
      where: { id: itemId, organizationId: ctx.organizationId, client: buildClientResourceScopeWhere(scopeOf(ctx)) },
      select: { id: true },
    });
    if (!item) throw new ContentError(404, 'NOT_FOUND', 'Conteúdo não encontrado.');
    const rows = await prisma.contentPublication.findMany({ where: { organizationId: ctx.organizationId, itemId }, orderBy: { createdAt: 'desc' } });
    return rows.map(publicationView);
  }

  async request(ctx: ContentContext, itemId: string, input: RequestPublication, now: Date = new Date()) {
    const item = await prisma.contentItem.findFirst({
      where: { id: itemId, organizationId: ctx.organizationId, client: buildClientResourceScopeWhere(scopeOf(ctx)) },
      select: { id: true, clientId: true, format: true },
    });
    if (!item) throw new ContentError(404, 'NOT_FOUND', 'Conteúdo não encontrado.');

    // So a versao ATUAL, aprovada pelo cliente sobre o mesmo conteudo (o banco garante de novo)
    const current = await prisma.contentVersion.findFirst({
      where: { itemId },
      orderBy: { number: 'desc' },
      include: { decision: true, media: { where: { removedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!current || current.decision?.decision !== 'APPROVED' || current.decision.contentHashAtDecision !== current.contentHash) {
      throw new ContentError(409, 'VERSION_NOT_APPROVED', 'Somente a versão atual aprovada pelo cliente pode ser agendada.');
    }

    // Conta social vinculada a ESTE cliente (ClientIntegration) e da rede do piloto
    const link = await prisma.clientIntegration.findFirst({
      where: { clientId: item.clientId, provider: 'BRIGHTBEAN', externalId: input.socialAccountId, client: { organizationId: ctx.organizationId } },
    });
    if (!link) throw new ContentError(404, 'SOCIAL_ACCOUNT_NOT_LINKED', 'Conta social não vinculada a este cliente.');
    const meta = (link.metadata ?? {}) as Record<string, unknown>;
    const platform = typeof meta.platform === 'string' ? meta.platform : '';
    if (!isPilotPlatform(platform)) {
      throw new ContentError(422, 'PLATFORM_NOT_IN_PILOT', 'Nesta etapa a publicação está disponível somente para Instagram.');
    }
    const captionLimit = Number(meta.charLimit ?? meta.char_limit) || null;

    const parsed = parseScheduledAt(input.scheduledAt);
    if (!parsed.ok) throw new ContentError(422, parsed.problem.code, parsed.problem.message);
    const lead = checkScheduleLead(parsed.at, now);
    if (lead) throw new ContentError(422, lead.code, lead.message);
    const problems = validatePublicationContent({
      format: item.format as ContentFormat,
      media: current.media.map((m) => ({ kind: m.kind as ContentMediaKind, mimeType: m.mimeType, sizeBytes: m.sizeBytes })),
      caption: current.caption,
      captionLimit,
    });
    if (problems.length) throw new ContentError(422, problems[0].code, problems[0].message, { problems });

    const inWindow = await prisma.contentPublication.count({
      where: {
        organizationId: ctx.organizationId,
        socialAccountId: input.socialAccountId,
        state: { notIn: ['CANCELLED', 'FAILED'] },
        scheduledAt: { gt: new Date(parsed.at.getTime() - DAY_MS), lt: new Date(parsed.at.getTime() + DAY_MS) },
      },
    });
    const cap = checkDailyCap(inWindow);
    if (cap) throw new ContentError(422, cap.code, cap.message);

    const id = randomUUID();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.contentPublication.create({
          data: {
            id,
            organizationId: ctx.organizationId,
            clientId: item.clientId,
            itemId,
            versionId: current.id,
            socialAccountId: input.socialAccountId,
            platform,
            scheduledAt: parsed.at,
            createdByUserId: ctx.userId,
          },
        });
        await tx.publicationOutbox.create({
          data: { organizationId: ctx.organizationId, publicationId: id, kind: 'PUBLISH', idempotencyKey: `pub-${id}-publish` },
        });
        await this.event(tx, ctx, itemId, current.id, 'PUBLICATION_REQUESTED', { publicationId: id, scheduledAt: parsed.at.toISOString(), platform });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ContentError(409, 'PUBLICATION_ALREADY_ACTIVE', 'Já existe uma publicação ativa desta versão para esta conta.');
      }
      if (String((error as Error)?.message ?? '').includes('publication_requires_')) {
        throw new ContentError(409, 'VERSION_NOT_APPROVED', 'Somente a versão atual aprovada pelo cliente pode ser agendada.');
      }
      throw error;
    }
    return publicationView(await prisma.contentPublication.findUniqueOrThrow({ where: { id } }));
  }

  async reschedule(ctx: ContentContext, publicationId: string, input: ReschedulePublication, now: Date = new Date()) {
    const parsed = parseScheduledAt(input.scheduledAt);
    if (!parsed.ok) throw new ContentError(422, parsed.problem.code, parsed.problem.message);
    const lead = checkScheduleLead(parsed.at, now);
    if (lead) throw new ContentError(422, lead.code, lead.message);
    await prisma.$transaction(async (tx) => {
      const p0 = await this.loadPublication(tx, ctx, publicationId);
      await tx.$queryRaw`SELECT "id" FROM "content_publications" WHERE "id" = ${p0.id} FOR UPDATE`;
      const p = await tx.contentPublication.findUniqueOrThrow({ where: { id: p0.id } });
      if (!canReschedulePublication(p.state as PublicationState) || p.cancelRequestedAt) {
        throw new ContentError(409, 'PUBLICATION_LOCKED', 'Esta publicação não pode mais ser reagendada (já iniciada, encerrada ou em conferência).');
      }
      await tx.contentPublication.update({ where: { id: p.id }, data: { scheduledAt: parsed.at, failureCode: null, failureMessage: null } });
      if (p.externalPostId) {
        await tx.publicationOutbox.create({
          data: { organizationId: p.organizationId, publicationId: p.id, kind: 'RESCHEDULE', idempotencyKey: `pub-${p.id}-reschedule-${randomUUID()}`, payload: { scheduledAt: parsed.at.toISOString() } },
        });
      }
      await this.event(tx, ctx, p.itemId, p.versionId, 'PUBLICATION_RESCHEDULE_REQUESTED', { publicationId: p.id, scheduledAt: parsed.at.toISOString() });
    });
    return publicationView(await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } }));
  }

  async cancel(ctx: ContentContext, publicationId: string, now: Date = new Date()) {
    await prisma.$transaction(async (tx) => {
      const p0 = await this.loadPublication(tx, ctx, publicationId);
      await tx.$queryRaw`SELECT "id" FROM "content_publications" WHERE "id" = ${p0.id} FOR UPDATE`;
      const p = await tx.contentPublication.findUniqueOrThrow({ where: { id: p0.id } });
      if (!canCancelPublication(p.state as PublicationState) || p.cancelRequestedAt) {
        throw new ContentError(409, 'PUBLICATION_LOCKED', 'Esta publicação não pode mais ser cancelada (já iniciada, encerrada ou em conferência).');
      }
      if (p.state === 'PENDING' && !p.externalPostId) {
        // nada foi criado no provedor: encerra aqui e aborta os pedidos ainda nao enviados
        await tx.contentPublication.update({ where: { id: p.id }, data: { state: 'CANCELLED', cancelRequestedAt: now } });
        await tx.publicationOutbox.updateMany({
          where: { publicationId: p.id, status: { in: ['PENDING', 'RETRYING'] } },
          data: { status: 'DONE', finishedAt: now, lastError: 'Cancelado antes do envio.' },
        });
      } else {
        await tx.contentPublication.update({ where: { id: p.id }, data: { cancelRequestedAt: now } });
        await tx.publicationOutbox.create({
          data: { organizationId: p.organizationId, publicationId: p.id, kind: 'CANCEL', idempotencyKey: `pub-${p.id}-cancel` },
        });
      }
      await this.event(tx, ctx, p.itemId, p.versionId, 'PUBLICATION_CANCEL_REQUESTED', { publicationId: p.id });
    });
    return publicationView(await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } }));
  }
}

export const publicationService = new PublicationService();
