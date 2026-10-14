import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CreateApprovalLinkRequest, PublicApprovalDecisionRequest } from '@zafira/contracts';
import {
  APPROVAL_N1_NOTICE,
  approvalStatusOf,
  clampApprovalDays,
  linkState,
  validateApprovalInput,
  validateMediaSet,
  type ApprovalDecisionKind,
  type ApprovalStatus,
  type ContentFormat,
  type ContentMediaKind,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { buildClientResourceScopeWhere } from '../authorization/client-resource-scope.js';
import { ContentContext, ContentError } from './content.service.js';
import { resolveFileStorage, StorageNotConfiguredError, type FileStorage } from './file-storage.js';

/**
 * F8-2 (DEC-F8-004) - Aprovacao do cliente por link seguro.
 *  - token de 256 bits; so o HASH e guardado; o token em claro aparece uma unica vez, na criacao;
 *  - N1: identificacao DECLARADA (nome, contato, declaracao de autoridade): nao e identidade autenticada;
 *  - decisao unica por versao, validada tambem no banco (link ativo, versao enviada e integra);
 *  - respostas publicas genericas para link invalido, expirado ou revogado.
 */

type Tx = Prisma.TransactionClient;

export class PublicLinkUnavailableError extends Error {
  constructor() {
    super('Este link não está disponível.');
    this.name = 'PublicLinkUnavailableError';
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const MEDIA_TOKEN_TTL_SECONDS = 600;

/** Segredo efemero (por processo) so fora de producao; em producao exige segredo configurado. */
const EPHEMERAL_SECRET = randomBytes(32).toString('hex');

function secret(): string {
  const s = process.env.APPROVAL_MEDIA_SECRET || process.env.JWT_SECRET || process.env.COOKIE_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new ContentError(500, 'SERVER_MISCONFIGURED', 'Configuração de segurança ausente.');
  }
  return EPHEMERAL_SECRET;
}

const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');

export function hashContent(caption: string, shas: string[]): string {
  return createHash('sha256').update(JSON.stringify({ caption, media: shas })).digest('hex');
}

export class ApprovalService {
  constructor(private readonly storageFactory: () => FileStorage = () => resolveFileStorage()) {}

  private scope(ctx: ContentContext) {
    return { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role };
  }

  private async event(db: Tx, orgId: string, itemId: string, versionId: string, type: string, actorUserId: string | null, data?: Prisma.InputJsonValue) {
    await db.contentEvent.create({ data: { organizationId: orgId, itemId, versionId, type, actorUserId, data } });
    await new AuditService(db as never).record({
      organizationId: orgId,
      actorUserId: actorUserId ?? undefined,
      action: `content.${type.toLowerCase()}`,
      entityType: 'ContentItem',
      entityId: itemId,
      metadata: { versionId },
    });
  }

  private async loadItem(db: Tx | typeof prisma, ctx: ContentContext, id: string) {
    const item = await db.contentItem.findFirst({
      where: { id, organizationId: ctx.organizationId, client: buildClientResourceScopeWhere(this.scope(ctx)) },
      select: { id: true, format: true, clientId: true },
    });
    if (!item) throw new ContentError(404, 'NOT_FOUND', 'Conteúdo não encontrado.');
    return item;
  }

  /* ------------------------------ interno ------------------------------ */

  async createLink(ctx: ContentContext, itemId: string, input: CreateApprovalLinkRequest) {
    const days = clampApprovalDays(input.expiresInDays);
    const token = randomBytes(32).toString('base64url');
    let reissued = false;
    const result = await prisma.$transaction(async (tx) => {
      const item = await this.loadItem(tx, ctx, itemId);
      const version = await tx.contentVersion.findFirst({ where: { itemId }, orderBy: { number: 'desc' } });
      if (!version) throw new ContentError(500, 'VERSION_MISSING', 'Conteúdo sem versão.');
      await tx.$queryRaw`SELECT "id" FROM "content_versions" WHERE "id" = ${version.id} FOR UPDATE`;
      const decision = await tx.approvalDecision.findUnique({ where: { versionId: version.id } });
      if (decision) {
        throw new ContentError(409, 'ALREADY_DECIDED', 'Esta versão já recebeu uma decisão do cliente. Crie uma nova versão para enviar de novo.');
      }
      const media = await tx.contentMedia.findMany({ where: { versionId: version.id, removedAt: null }, orderBy: { position: 'asc' } });
      const problems = validateMediaSet(item.format as ContentFormat, media.map((m) => m.kind as ContentMediaKind));
      if (problems.length > 0) {
        throw new ContentError(409, 'CONTENT_INCOMPLETE', `O conteúdo ainda não está completo para envio: ${problems[0].message}`);
      }
      const now = new Date();
      const revoked = await tx.approvalLink.updateMany({
        where: { versionId: version.id, revokedAt: null },
        data: { revokedAt: now, revokedByUserId: ctx.userId, revokeReason: 'REISSUED' },
      });
      reissued = revoked.count > 0;
      if (!version.sentForApprovalAt) {
        await tx.contentVersion.update({ where: { id: version.id }, data: { sentForApprovalAt: now } });
      }
      const expiresAt = new Date(now.getTime() + days * 86_400_000);
      const link = await tx.approvalLink.create({
        data: {
          organizationId: ctx.organizationId,
          itemId,
          versionId: version.id,
          tokenHash: sha256(token),
          expiresAt,
          recipientLabel: input.recipientLabel || null,
          channel: input.channel,
          contentHashAtSend: version.contentHash,
          createdByUserId: ctx.userId,
          createdAt: now,
        },
      });
      await this.event(tx, ctx.organizationId, itemId, version.id, reissued ? 'APPROVAL_LINK_REISSUED' : 'APPROVAL_LINK_CREATED', ctx.userId, {
        linkId: link.id,
        expiresAt: expiresAt.toISOString(),
        channel: input.channel,
      });
      return { link, versionNumber: version.number };
    });
    return {
      token, // exibido uma unica vez
      path: `/aprovacao#${token}`,
      reissued,
      link: this.linkView(result.link),
      versionNumber: result.versionNumber,
    };
  }

  private linkView(l: {
    id: string; versionId: string; expiresAt: Date; revokedAt: Date | null; revokeReason: string | null; recipientLabel: string | null;
    channel: string; identificationLevel: string; createdAt: Date; accessCount: number; lastAccessedAt: Date | null;
  }) {
    return {
      id: l.id,
      versionId: l.versionId,
      state: linkState(l),
      expiresAt: l.expiresAt.toISOString(),
      revokedAt: l.revokedAt?.toISOString() ?? null,
      revokeReason: l.revokeReason,
      recipientLabel: l.recipientLabel,
      channel: l.channel,
      identificationLevel: l.identificationLevel,
      createdAt: l.createdAt.toISOString(),
      accessCount: l.accessCount,
      lastAccessedAt: l.lastAccessedAt?.toISOString() ?? null,
    };
  }

  async revokeLink(ctx: ContentContext, itemId: string, linkId: string, reason?: string | null) {
    await prisma.$transaction(async (tx) => {
      await this.loadItem(tx, ctx, itemId);
      const link = await tx.approvalLink.findFirst({ where: { id: linkId, itemId, organizationId: ctx.organizationId } });
      if (!link) throw new ContentError(404, 'NOT_FOUND', 'Link não encontrado.');
      if (link.revokedAt) throw new ContentError(409, 'ALREADY_REVOKED', 'Este link já foi revogado.');
      await tx.approvalLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date(), revokedByUserId: ctx.userId, revokeReason: reason || 'REVOKED' },
      });
      await this.event(tx, ctx.organizationId, itemId, link.versionId, 'APPROVAL_LINK_REVOKED', ctx.userId, { linkId });
    });
    return this.status(ctx, itemId);
  }

  /** Acompanhamento interno: status da versao atual, links (sem token) e decisoes. */
  async status(ctx: ContentContext, itemId: string) {
    await this.loadItem(prisma, ctx, itemId);
    const [versions, links, decisions] = await Promise.all([
      prisma.contentVersion.findMany({ where: { itemId }, orderBy: { number: 'asc' } }),
      prisma.approvalLink.findMany({ where: { itemId, organizationId: ctx.organizationId }, orderBy: { createdAt: 'desc' } }),
      prisma.approvalDecision.findMany({ where: { itemId, organizationId: ctx.organizationId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const current = versions[versions.length - 1];
    const numberOf = new Map(versions.map((v) => [v.id, v.number]));
    const currentLinks = links.filter((l) => l.versionId === current?.id);
    const decision = decisions.find((d) => d.versionId === current?.id) ?? null;
    const active = currentLinks.find((l) => !l.revokedAt) ?? null;
    return {
      status: approvalStatusOf({
        sentForApprovalAt: current?.sentForApprovalAt ?? null,
        decision: (decision?.decision as ApprovalDecisionKind) ?? null,
        activeLink: active,
        lastLink: currentLinks[0] ?? null,
      }),
      currentVersionNumber: current?.number ?? 1,
      identificationNotice: APPROVAL_N1_NOTICE,
      links: links.map((l) => ({ ...this.linkView(l), versionNumber: numberOf.get(l.versionId) ?? null })),
      decisions: decisions.map((d) => ({
        id: d.id,
        versionId: d.versionId,
        versionNumber: numberOf.get(d.versionId) ?? null,
        decision: d.decision,
        comment: d.comment,
        approverName: d.approverName,
        approverContact: d.approverContact,
        channel: d.channel,
        identificationLevel: d.identificationLevel,
        authorityDeclared: d.authorityDeclared,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  /** Status de aprovacao da versao atual de varios conteudos (lista). */
  async statusMap(ctx: ContentContext, itemIds: string[]): Promise<Map<string, ApprovalStatus>> {
    const out = new Map<string, ApprovalStatus>();
    if (itemIds.length === 0) return out;
    const versions = await prisma.contentVersion.findMany({
      where: { itemId: { in: itemIds }, organizationId: ctx.organizationId },
      orderBy: { number: 'desc' },
    });
    const latest = new Map<string, (typeof versions)[number]>();
    for (const v of versions) if (!latest.has(v.itemId)) latest.set(v.itemId, v);
    const vIds = [...latest.values()].map((v) => v.id);
    const [links, decisions] = await Promise.all([
      prisma.approvalLink.findMany({ where: { versionId: { in: vIds } }, orderBy: { createdAt: 'desc' } }),
      prisma.approvalDecision.findMany({ where: { versionId: { in: vIds } } }),
    ]);
    for (const [itemId, v] of latest) {
      const vLinks = links.filter((l) => l.versionId === v.id);
      const d = decisions.find((x) => x.versionId === v.id);
      out.set(
        itemId,
        approvalStatusOf({
          sentForApprovalAt: v.sentForApprovalAt,
          decision: (d?.decision as ApprovalDecisionKind) ?? null,
          activeLink: vLinks.find((l) => !l.revokedAt) ?? null,
          lastLink: vLinks[0] ?? null,
        })
      );
    }
    return out;
  }

  /* ------------------------------ publico (sem sessao) ------------------------------ */

  private async resolveLink(token: string) {
    const link = await prisma.approvalLink.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        version: true,
        item: { select: { id: true, format: true, client: { select: { name: true } } } },
        decisions: true,
      },
    });
    if (!link) throw new PublicLinkUnavailableError();
    if (linkState(link) !== 'ACTIVE') throw new PublicLinkUnavailableError();
    return link;
  }

  private signMedia(linkId: string, mediaId: string): string {
    const payload = `${linkId}.${mediaId}.${Math.floor(Date.now() / 1000) + MEDIA_TOKEN_TTL_SECONDS}`;
    return `${Buffer.from(payload).toString('base64url')}.${hmac(payload)}`;
  }

  async view(token: string) {
    const link = await this.resolveLink(token);
    await prisma.approvalLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() } });
    const media = await prisma.contentMedia.findMany({
      where: { versionId: link.versionId, removedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, kind: true, position: true },
    });
    const decision = link.decisions[0] ?? null;
    return {
      status: decision ? decision.decision : 'PENDING',
      brandName: link.item.client.name,
      format: link.item.format,
      caption: link.version.caption,
      versionNumber: link.version.number,
      contentHash: link.version.contentHash,
      expiresAt: link.expiresAt.toISOString(),
      identificationNotice: APPROVAL_N1_NOTICE,
      media: media.map((m) => ({ kind: m.kind, position: m.position, path: `/public/approval/media?t=${this.signMedia(link.id, m.id)}` })),
      decision: decision
        ? { decision: decision.decision, decidedAt: decision.createdAt.toISOString(), approverName: decision.approverName, comment: decision.comment }
        : null,
    };
  }

  async decide(token: string, input: PublicApprovalDecisionRequest, evidence: { ip: string; userAgent: string }) {
    const problems = validateApprovalInput(input);
    if (problems.length > 0) {
      throw new ContentError(400, 'INVALID_REQUEST', problems[0].message, { field: problems[0].field });
    }
    const link = await this.resolveLink(token);
    if (link.decisions.length > 0) {
      throw new ContentError(409, 'ALREADY_DECIDED', 'Esta versão já recebeu uma resposta.');
    }
    // integridade: o que o cliente viu e o que esta guardado (legenda + hashes dos arquivos + existencia no storage)
    let storage: FileStorage;
    try {
      storage = this.storageFactory();
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) throw new ContentError(503, 'STORAGE_NOT_CONFIGURED', 'Serviço indisponível no momento.');
      throw e;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "content_versions" WHERE "id" = ${link.versionId} FOR UPDATE`;
        const version = await tx.contentVersion.findUniqueOrThrow({ where: { id: link.versionId } });
        const media = await tx.contentMedia.findMany({ where: { versionId: version.id, removedAt: null }, orderBy: { position: 'asc' } });
        const recomputed = hashContent(version.caption, media.map((m) => m.sha256));
        if (
          recomputed !== version.contentHash ||
          version.contentHash !== link.contentHashAtSend ||
          input.contentHash !== version.contentHash
        ) {
          throw new ContentError(409, 'INTEGRITY_MISMATCH', 'O conteúdo mudou. Recarregue a página para ver a versão atual.');
        }
        for (const m of media) {
          if (!(await storage.exists(m.storageKey))) {
            throw new ContentError(409, 'INTEGRITY_MISMATCH', 'Não foi possível validar os arquivos. Tente novamente em instantes.');
          }
        }
        await tx.approvalDecision.create({
          data: {
            organizationId: link.organizationId,
            itemId: link.itemId,
            versionId: link.versionId,
            linkId: link.id,
            decision: input.decision,
            comment: input.comment?.trim() || null,
            approverName: input.approverName.trim(),
            approverContact: input.approverContact.trim(),
            authorityDeclared: true,
            channel: link.channel,
            identificationLevel: link.identificationLevel,
            contentHashAtDecision: version.contentHash,
            ipHash: evidence.ip ? hmac(`ip:${evidence.ip}`) : null,
            userAgentHash: evidence.userAgent ? hmac(`ua:${evidence.userAgent}`) : null,
          },
        });
        await this.event(
          tx,
          link.organizationId,
          link.itemId,
          link.versionId,
          input.decision === 'APPROVED' ? 'CLIENT_APPROVED' : 'CLIENT_CHANGES_REQUESTED',
          null,
          { linkId: link.id, identificationLevel: link.identificationLevel }
        );
      });
    } catch (error) {
      if (error instanceof ContentError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ContentError(409, 'ALREADY_DECIDED', 'Esta versão já recebeu uma resposta.');
      }
      const msg = String((error as Error)?.message ?? '');
      if (/approval_link_revoked|approval_link_expired|approval_link_mismatch/.test(msg)) throw new PublicLinkUnavailableError();
      if (/approval_integrity/.test(msg)) {
        throw new ContentError(409, 'INTEGRITY_MISMATCH', 'O conteúdo mudou. Recarregue a página para ver a versão atual.');
      }
      throw error;
    }
    return this.view(token);
  }

  /** Midia por URL curta assinada (10 min): vale so enquanto o link estiver ativo; nunca expoe storageKey. */
  async readMedia(mediaToken: string) {
    const [encoded, sig] = mediaToken.split('.');
    if (!encoded || !sig) throw new PublicLinkUnavailableError();
    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      throw new PublicLinkUnavailableError();
    }
    const expected = Buffer.from(hmac(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new PublicLinkUnavailableError();
    const [linkId, mediaId, exp] = payload.split('.');
    if (!linkId || !mediaId || Number(exp) < Math.floor(Date.now() / 1000)) throw new PublicLinkUnavailableError();
    const link = await prisma.approvalLink.findUnique({ where: { id: linkId } });
    if (!link || linkState(link) !== 'ACTIVE') throw new PublicLinkUnavailableError();
    const media = await prisma.contentMedia.findFirst({ where: { id: mediaId, versionId: link.versionId, removedAt: null } });
    if (!media) throw new PublicLinkUnavailableError();
    const storage = this.storageFactory();
    return { data: await storage.get(media.storageKey), mimeType: media.mimeType };
  }

  /** Midia por URL curta assinada (10 min) via streaming: sem buffers integrais na heap. */
  async openMediaStream(mediaToken: string) {
    const [encoded, sig] = mediaToken.split('.');
    if (!encoded || !sig) throw new PublicLinkUnavailableError();
    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      throw new PublicLinkUnavailableError();
    }
    const expected = Buffer.from(hmac(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new PublicLinkUnavailableError();
    const [linkId, mediaId, exp] = payload.split('.');
    if (!linkId || !mediaId || Number(exp) < Math.floor(Date.now() / 1000)) throw new PublicLinkUnavailableError();
    const link = await prisma.approvalLink.findUnique({ where: { id: linkId } });
    if (!link || linkState(link) !== 'ACTIVE') throw new PublicLinkUnavailableError();
    const media = await prisma.contentMedia.findFirst({ where: { id: mediaId, versionId: link.versionId, removedAt: null } });
    if (!media) throw new PublicLinkUnavailableError();
    const storage = this.storageFactory();
    const res = await storage.openStream(media.storageKey);
    return {
      stream: res.stream,
      sizeBytes: res.sizeBytes,
      mimeType: media.mimeType,
      cleanup: res.cleanup,
    };
  }
}

export const approvalService = new ApprovalService();
