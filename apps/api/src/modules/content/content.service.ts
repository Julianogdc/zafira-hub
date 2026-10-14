import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CreateContentItemRequest, UpdateContentItemRequest } from '@zafira/contracts';
import {
  PUBLISH_COMPATIBILITY_NOTE,
  PUBLISH_MAX_IMAGE_BYTES,
  canAddMedia,
  imageDimensions,
  imagePixelProblem,
  canChangeFormat,
  isVersionEditable,
  storageKeyFor,
  validateMediaSet,
  validateUploadedFile,
  type ContentFormat,
  type ContentMediaKind,
  type RoleType,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { buildClientResourceScopeWhere, findClientInResourceScope } from '../authorization/client-resource-scope.js';
import { resolveFileStorage, StorageNotConfiguredError, type FileStorage } from './file-storage.js';

/**
 * F8-1 (DEC-F8-003) - Conteudo: arquivos finais versionados.
 * Sem pauta/revisao/aprovacao interna (Asana). Nada e enviado ao BrightBean. Nada e apagado (D2/P28).
 */

type Tx = Prisma.TransactionClient;

/**
 * F8-5p.1 (DEC-F8-031, P35): calcula e grava UMA vez as dimensoes de imagens antigas (sem largura/altura),
 * lendo o proprio arquivo. Imagem acima de 20 MB nao e lida (ja e recusada para publicacao). Ilegivel segue nula
 * (desconhecida), o que bloqueia o agendamento. O banco so aceita a transicao nulo -> valor.
 */
export async function ensureImageDimensions<T extends { id: string; kind: string; storageKey: string; sizeBytes: number; widthPx: number | null; heightPx: number | null }>(
  media: T[],
  storage: () => FileStorage
): Promise<T[]> {
  const out: T[] = [];
  for (const m of media) {
    if (m.kind !== 'IMAGE' || (m.widthPx && m.heightPx) || m.sizeBytes > PUBLISH_MAX_IMAGE_BYTES) {
      out.push(m);
      continue;
    }
    try {
      const dims = imageDimensions(await storage().get(m.storageKey));
      if (!dims) {
        out.push(m);
        continue;
      }
      await prisma.contentMedia.updateMany({ where: { id: m.id, widthPx: null }, data: { widthPx: dims.width, heightPx: dims.height } });
      out.push({ ...m, widthPx: dims.width, heightPx: dims.height });
    } catch {
      out.push(m); // armazenamento indisponivel: segue desconhecida (bloqueia o agendamento, nunca libera)
    }
  }
  return out;
}

export interface ContentContext {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: RoleType;
}

export class ContentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

const hashOf = (caption: string, shas: string[]) =>
  createHash('sha256').update(JSON.stringify({ caption, media: shas })).digest('hex');

/**
 * F8-3 (D3): violacoes das regras de vinculo com Entregas garantidas pelo banco (indice unico parcial
 * e gatilho de escopo). Cobre a corrida entre a checagem do servico e a gravacao.
 */
function linkConflictOf(error: unknown): ContentError | null {
  const text = `${(error as { message?: string })?.message ?? ''} ${JSON.stringify((error as { meta?: unknown })?.meta ?? '')}`;
  const isUnique = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  if (isUnique && (text.includes('content_items_one_per_deliverable_piece') || text.includes('deliverablePieceId'))) {
    return new ContentError(409, 'PIECE_ALREADY_LINKED', 'Esta peça de Entregas já está vinculada a outro conteúdo.');
  }
  if (text.includes('content_piece_scope')) {
    return new ContentError(400, 'PIECE_NOT_FOUND', 'Peça de Entregas não encontrada para este cliente.');
  }
  return null;
}

export class ContentService {
  constructor(private readonly storageFactory: () => FileStorage = () => resolveFileStorage()) {}

  /** Dimensoes dos arquivos ativos da versao atual (calcula as antigas uma vez; sem armazenamento, segue como esta). */
  private async withDimensions<T extends { id: string; kind: string; storageKey: string; sizeBytes: number; widthPx: number | null; heightPx: number | null; removedAt: Date | null }>(media: T[]): Promise<T[]> {
    const pending = media.filter((m) => !m.removedAt && m.kind === 'IMAGE' && !(m.widthPx && m.heightPx));
    if (!pending.length) return media;
    const filled = new Map((await ensureImageDimensions(pending, () => this.storage())).map((m) => [m.id, m]));
    return media.map((m) => filled.get(m.id) ?? m);
  }

  private storage(): FileStorage {
    try {
      return this.storageFactory();
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) throw new ContentError(503, 'STORAGE_NOT_CONFIGURED', e.message);
      throw e;
    }
  }

  private scope(ctx: ContentContext) {
    return { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role };
  }

  private async event(
    db: Tx,
    ctx: ContentContext,
    itemId: string,
    type: string,
    data?: Prisma.InputJsonValue,
    versionId?: string
  ) {
    await db.contentEvent.create({
      data: { organizationId: ctx.organizationId, itemId, versionId: versionId ?? null, type, actorUserId: ctx.userId, data },
    });
    await new AuditService(db as never).record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: `content.${type.toLowerCase()}`,
      entityType: 'ContentItem',
      entityId: itemId,
      metadata: { versionId: versionId ?? null },
    });
  }

  /** Item na organizacao e na carteira do usuario; 404 caso contrario (sem revelar existencia). */
  private async loadItem(db: Tx | typeof prisma, ctx: ContentContext, id: string) {
    const item = await db.contentItem.findFirst({
      where: { id, organizationId: ctx.organizationId, client: buildClientResourceScopeWhere(this.scope(ctx)) },
      include: { client: { select: { name: true } } },
    });
    if (!item) throw new ContentError(404, 'NOT_FOUND', 'Conteúdo não encontrado.');
    return item;
  }

  private async currentVersion(db: Tx | typeof prisma, itemId: string) {
    const v = await db.contentVersion.findFirst({ where: { itemId }, orderBy: { number: 'desc' } });
    if (!v) throw new ContentError(500, 'VERSION_MISSING', 'Conteúdo sem versão.');
    return v;
  }

  private async lockVersion(tx: Tx, versionId: string) {
    await tx.$queryRaw`SELECT "id" FROM "content_versions" WHERE "id" = ${versionId} FOR UPDATE`;
  }

  private assertEditable(version: { sentForApprovalAt: Date | null }) {
    if (!isVersionEditable(version)) {
      throw new ContentError(409, 'VERSION_FROZEN', 'Esta versão já foi enviada para aprovação e não pode ser alterada. Crie uma nova versão.');
    }
  }

  private async validateLinks(
    db: Tx | typeof prisma,
    ctx: ContentContext,
    clientId: string,
    links: { asanaTaskGid?: string | null; deliverablePieceId?: string | null },
    selfItemId?: string
  ) {
    if (links.asanaTaskGid) {
      const task = await db.asanaTaskMirror.findFirst({
        where: { organizationId: ctx.organizationId, clientId, taskGid: links.asanaTaskGid, removedAt: null },
        select: { id: true },
      });
      if (!task) {
        throw new ContentError(
          400,
          'ASANA_TASK_NOT_FOUND',
          'Tarefa do Asana não encontrada para este cliente no espelho local. Sincronize o projeto ou confira o identificador.'
        );
      }
    }
    if (links.deliverablePieceId) {
      const piece = await db.deliverablePiece.findFirst({
        where: { id: links.deliverablePieceId, organizationId: ctx.organizationId, item: { plan: { clientId } } },
        select: { id: true },
      });
      if (!piece) throw new ContentError(400, 'PIECE_NOT_FOUND', 'Peça de Entregas não encontrada para este cliente.');
      // F8-3 (D3, DEC-F8-007): uma peça de Entregas por conteúdo
      const other = await db.contentItem.findFirst({
        where: { deliverablePieceId: links.deliverablePieceId, ...(selfItemId ? { id: { not: selfItemId } } : {}) },
        select: { id: true, organizationId: true },
      });
      if (other) {
        throw new ContentError(409, 'PIECE_ALREADY_LINKED', 'Esta peça de Entregas já está vinculada a outro conteúdo.', {
          ...(other.organizationId === ctx.organizationId ? { existingId: other.id } : {}),
        });
      }
    }
  }

  private mediaView(m: {
    id: string;
    position: number;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    originalFilename: string;
    createdAt: Date;
    removedAt: Date | null;
    widthPx?: number | null;
    heightPx?: number | null;
  }) {
    return {
      id: m.id,
      position: m.position,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      sha256: m.sha256,
      originalFilename: m.originalFilename,
      createdAt: m.createdAt.toISOString(),
      removedAt: m.removedAt?.toISOString() ?? null,
      widthPx: m.widthPx ?? null,
      heightPx: m.heightPx ?? null,
    };
  }

  /* ------------------------------ leitura ------------------------------ */

  async list(ctx: ContentContext, filters: { clientId?: string } = {}) {
    const items = await prisma.contentItem.findMany({
      where: {
        organizationId: ctx.organizationId,
        client: buildClientResourceScopeWhere(this.scope(ctx)),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
      },
      include: {
        client: { select: { name: true } },
        versions: {
          orderBy: { number: 'desc' },
          take: 1,
          include: { media: { where: { removedAt: null }, select: { id: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return items.map((i) => {
      const v = i.versions[0];
      return {
        id: i.id,
        clientId: i.clientId,
        clientName: i.client.name,
        title: i.title,
        format: i.format,
        asanaTaskGid: i.asanaTaskGid,
        deliverablePieceId: i.deliverablePieceId,
        archivedAt: i.archivedAt?.toISOString() ?? null,
        updatedAt: i.updatedAt.toISOString(),
        versionNumber: v?.number ?? 1,
        mediaCount: v?.media.length ?? 0,
        editable: v ? isVersionEditable(v) : true,
      };
    });
  }

  async get(ctx: ContentContext, id: string) {
    const item = await this.loadItem(prisma, ctx, id);
    const [versions, events] = await Promise.all([
      prisma.contentVersion.findMany({
        where: { itemId: id },
        orderBy: { number: 'asc' },
        include: { media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      }),
      prisma.contentEvent.findMany({ where: { itemId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    const current = versions[versions.length - 1];
    if (current) current.media = await this.withDimensions(current.media);
    const active = (current?.media ?? []).filter((m) => !m.removedAt);
    const activeKinds = active.map((m) => m.kind as ContentMediaKind);
    // F8-5p.1 (P35): aviso ja no upload, antes da aprovacao, quando a imagem nao poderia ser publicada
    const pixelProblems = active.flatMap((m) => (m.kind === 'IMAGE' ? [imagePixelProblem(m)].filter((p): p is NonNullable<typeof p> => p !== null) : []));
    return {
      id: item.id,
      clientId: item.clientId,
      clientName: item.client.name,
      title: item.title,
      format: item.format as ContentFormat,
      asanaTaskGid: item.asanaTaskGid,
      deliverablePieceId: item.deliverablePieceId,
      archivedAt: item.archivedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      editable: current ? isVersionEditable(current) : false,
      currentVersionNumber: current?.number ?? 1,
      problems: [...validateMediaSet(item.format as ContentFormat, activeKinds), ...pixelProblems],
      publishCompatibilityNote: PUBLISH_COMPATIBILITY_NOTE,
      versions: versions.map((v) => ({
        id: v.id,
        number: v.number,
        caption: v.caption,
        contentHash: v.contentHash,
        sentForApprovalAt: v.sentForApprovalAt?.toISOString() ?? null,
        updatedAt: v.updatedAt.toISOString(),
        media: v.media.map((m) => this.mediaView(m)),
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        versionId: e.versionId,
        actorUserId: e.actorUserId,
        data: e.data,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /* ------------------------------ escrita ------------------------------ */

  async create(ctx: ContentContext, input: CreateContentItemRequest) {
    const client = await findClientInResourceScope(prisma, this.scope(ctx), input.clientId);
    if (!client) throw new ContentError(404, 'NOT_FOUND', 'Cliente não encontrado.');
    await this.validateLinks(prisma, ctx, input.clientId, input);
    try {
      const id = await prisma.$transaction(async (tx) => {
        const item = await tx.contentItem.create({
          data: {
            organizationId: ctx.organizationId,
            clientId: input.clientId,
            title: input.title,
            format: input.format,
            asanaTaskGid: input.asanaTaskGid ?? null,
            deliverablePieceId: input.deliverablePieceId ?? null,
            createdByUserId: ctx.userId,
          },
        });
        const version = await tx.contentVersion.create({
          data: {
            organizationId: ctx.organizationId,
            itemId: item.id,
            number: 1,
            caption: input.caption,
            contentHash: hashOf(input.caption, []),
            createdByUserId: ctx.userId,
          },
        });
        await this.event(tx, ctx, item.id, 'CONTENT_CREATED', { format: input.format }, version.id);
        return item.id;
      });
      return this.get(ctx, id);
    } catch (error) {
      const linkConflict = linkConflictOf(error);
      if (linkConflict) throw linkConflict;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = input.asanaTaskGid
          ? await prisma.contentItem.findFirst({
              where: { organizationId: ctx.organizationId, clientId: input.clientId, asanaTaskGid: input.asanaTaskGid },
              select: { id: true },
            })
          : null;
        throw new ContentError(409, 'DUPLICATE_ASANA_TASK', 'Já existe um conteúdo vinculado a esta tarefa do Asana.', {
          existingId: existing?.id,
        });
      }
      throw error;
    }
  }

  async update(ctx: ContentContext, id: string, input: UpdateContentItemRequest) {
    await prisma.$transaction(async (tx) => {
      const item = await this.loadItem(tx, ctx, id);
      const version = await this.currentVersion(tx, id);
      await this.lockVersion(tx, version.id);
      const locked = await tx.contentVersion.findUniqueOrThrow({ where: { id: version.id } });
      this.assertEditable(locked);
      if (input.expectedUpdatedAt && input.expectedUpdatedAt !== locked.updatedAt.toISOString()) {
        throw new ContentError(409, 'CONFLICT', 'O conteúdo foi alterado por outra pessoa. Recarregue antes de salvar.');
      }
      const activeMedia = await tx.contentMedia.findMany({
        where: { versionId: locked.id, removedAt: null },
        orderBy: { position: 'asc' },
      });
      if (input.format && input.format !== item.format) {
        const problem = canChangeFormat(input.format, activeMedia.map((m) => m.kind as ContentMediaKind));
        if (problem) throw new ContentError(409, problem.code, problem.message);
      }
      const links: { asanaTaskGid?: string | null; deliverablePieceId?: string | null } = {};
      if (input.asanaTaskGid !== undefined && input.asanaTaskGid !== item.asanaTaskGid) links.asanaTaskGid = input.asanaTaskGid;
      if (input.deliverablePieceId !== undefined && input.deliverablePieceId !== item.deliverablePieceId) {
        links.deliverablePieceId = input.deliverablePieceId;
      }
      await this.validateLinks(tx, ctx, item.clientId, links, item.id);

      const changed: string[] = [];
      const itemData: Prisma.ContentItemUpdateInput = {};
      if (input.title !== undefined && input.title !== item.title) {
        itemData.title = input.title;
        changed.push('title');
      }
      if (input.format !== undefined && input.format !== item.format) {
        itemData.format = input.format;
        changed.push('format');
      }
      if ('asanaTaskGid' in links) {
        itemData.asanaTaskGid = links.asanaTaskGid ?? null;
        changed.push('asanaTaskGid');
      }
      if ('deliverablePieceId' in links) {
        itemData.deliverablePieceId = links.deliverablePieceId ?? null;
        changed.push('deliverablePieceId');
      }
      if (Object.keys(itemData).length > 0) {
        try {
          await tx.contentItem.update({ where: { id }, data: itemData });
        } catch (error) {
          const linkConflict = linkConflictOf(error);
          if (linkConflict) throw linkConflict;
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ContentError(409, 'DUPLICATE_ASANA_TASK', 'Já existe um conteúdo vinculado a esta tarefa do Asana.');
          }
          throw error;
        }
      }
      if (input.caption !== undefined && input.caption !== locked.caption) {
        await tx.contentVersion.update({
          where: { id: locked.id },
          data: { caption: input.caption, contentHash: hashOf(input.caption, activeMedia.map((m) => m.sha256)) },
        });
        changed.push('caption');
      }
      if (changed.length > 0) {
        await this.event(tx, ctx, id, 'CONTENT_UPDATED', { fields: changed }, locked.id);
        // toca a versao para o controle otimista refletir tambem a alteracao do item
        await tx.contentVersion.update({ where: { id: locked.id }, data: { updatedAt: new Date() } });
      }
    });
    return this.get(ctx, id);
  }

  async uploadMedia(
    ctx: ContentContext,
    id: string,
    file: { buffer: Buffer; filename: string },
    opts: { replaceMediaId?: string } = {}
  ) {
    const check = validateUploadedFile(file.buffer.subarray(0, 32), file.buffer.length);
    if (!check.ok) throw new ContentError(check.code === 'FILE_TOO_LARGE' ? 413 : 400, check.code, check.message);
    // F8-5p.1 (P35): dimensoes lidas do conteudo real; o arquivo e aceito mesmo acima do limite (aviso no detalhe)
    const dims = check.type.kind === 'IMAGE' ? imageDimensions(file.buffer) : null;
    const storage = this.storage();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = storageKeyFor(ctx.organizationId, sha256);

    await prisma.$transaction(async (tx) => {
      const item = await this.loadItem(tx, ctx, id);
      const version = await this.currentVersion(tx, id);
      await this.lockVersion(tx, version.id);
      const locked = await tx.contentVersion.findUniqueOrThrow({ where: { id: version.id } });
      this.assertEditable(locked);
      const rows = await tx.contentMedia.findMany({ where: { versionId: locked.id }, orderBy: { position: 'asc' } });
      let active = rows.filter((m) => !m.removedAt);
      const position = rows.reduce((max, m) => Math.max(max, m.position), -1) + 1;
      if (opts.replaceMediaId) {
        const old = active.find((m) => m.id === opts.replaceMediaId);
        if (!old) throw new ContentError(404, 'MEDIA_NOT_FOUND', 'Arquivo a substituir não encontrado.');
        await tx.contentMedia.update({ where: { id: old.id }, data: { removedAt: new Date(), removedByUserId: ctx.userId } });
        active = active.filter((m) => m.id !== old.id);
      }
      const problem = canAddMedia(item.format as ContentFormat, active.map((m) => m.kind as ContentMediaKind), check.type.kind);
      if (problem) throw new ContentError(409, problem.code, problem.message);

      await storage.put(storageKey, file.buffer);
      const media = await tx.contentMedia.create({
        data: {
          organizationId: ctx.organizationId,
          itemId: id,
          versionId: locked.id,
          position,
          kind: check.type.kind,
          mimeType: check.type.mime,
          sizeBytes: file.buffer.length,
          sha256,
          storageKey,
          originalFilename: file.filename.slice(0, 255),
          uploadedByUserId: ctx.userId,
          widthPx: dims?.width ?? null,
          heightPx: dims?.height ?? null,
        },
      });
      const shas = [...active, media].sort((a, b) => a.position - b.position).map((m) => m.sha256);
      await tx.contentVersion.update({ where: { id: locked.id }, data: { contentHash: hashOf(locked.caption, shas) } });
      await this.event(
        tx,
        ctx,
        id,
        opts.replaceMediaId ? 'MEDIA_REPLACED' : 'MEDIA_ADDED',
        { mediaId: media.id, mime: check.type.mime, sizeBytes: file.buffer.length, sha256, replaced: opts.replaceMediaId ?? null },
        locked.id
      );
    });
    return this.get(ctx, id);
  }

  async removeMedia(ctx: ContentContext, id: string, mediaId: string) {
    await prisma.$transaction(async (tx) => {
      await this.loadItem(tx, ctx, id);
      const version = await this.currentVersion(tx, id);
      await this.lockVersion(tx, version.id);
      const locked = await tx.contentVersion.findUniqueOrThrow({ where: { id: version.id } });
      this.assertEditable(locked);
      const media = await tx.contentMedia.findFirst({ where: { id: mediaId, versionId: locked.id, itemId: id, removedAt: null } });
      if (!media) throw new ContentError(404, 'MEDIA_NOT_FOUND', 'Arquivo não encontrado.');
      await tx.contentMedia.update({ where: { id: media.id }, data: { removedAt: new Date(), removedByUserId: ctx.userId } });
      const rest = await tx.contentMedia.findMany({ where: { versionId: locked.id, removedAt: null }, orderBy: { position: 'asc' } });
      await tx.contentVersion.update({
        where: { id: locked.id },
        data: { contentHash: hashOf(locked.caption, rest.map((m) => m.sha256)) },
      });
      await this.event(tx, ctx, id, 'MEDIA_REMOVED', { mediaId, sha256: media.sha256 }, locked.id);
    });
    return this.get(ctx, id);
  }

  /** Nova versao: so quando a atual ja foi congelada (F8-2). Copia legenda e referencias dos arquivos ativos. */
  async newVersion(ctx: ContentContext, id: string) {
    await prisma.$transaction(async (tx) => {
      await this.loadItem(tx, ctx, id);
      const current = await this.currentVersion(tx, id);
      await this.lockVersion(tx, current.id);
      if (isVersionEditable(current)) {
        throw new ContentError(409, 'VERSION_EDITABLE', 'A versão atual ainda é editável; altere-a diretamente.');
      }
      const media = await tx.contentMedia.findMany({
        where: { versionId: current.id, removedAt: null },
        orderBy: { position: 'asc' },
      });
      const next = await tx.contentVersion.create({
        data: {
          organizationId: ctx.organizationId,
          itemId: id,
          number: current.number + 1,
          caption: current.caption,
          contentHash: current.contentHash,
          createdByUserId: ctx.userId,
        },
      });
      for (const [index, m] of media.entries()) {
        await tx.contentMedia.create({
          data: {
            organizationId: ctx.organizationId,
            itemId: id,
            versionId: next.id,
            position: index,
            kind: m.kind,
            mimeType: m.mimeType,
            sizeBytes: m.sizeBytes,
            sha256: m.sha256,
            storageKey: m.storageKey,
            originalFilename: m.originalFilename,
            uploadedByUserId: ctx.userId,
            // F8-5p.1 (P35): o mesmo arquivo leva as mesmas dimensoes para a nova versao
            widthPx: m.widthPx ?? null,
            heightPx: m.heightPx ?? null,
          },
        });
      }
      await this.event(tx, ctx, id, 'VERSION_CREATED', { number: next.number, from: current.number }, next.id);
    });
    return this.get(ctx, id);
  }

  async readFile(ctx: ContentContext, id: string, mediaId: string) {
    await this.loadItem(prisma, ctx, id);
    const media = await prisma.contentMedia.findFirst({ where: { id: mediaId, itemId: id, organizationId: ctx.organizationId } });
    if (!media) throw new ContentError(404, 'MEDIA_NOT_FOUND', 'Arquivo não encontrado.');
    const data = await this.storage().get(media.storageKey);
    return { data, mimeType: media.mimeType, filename: media.originalFilename };
  }
}

export const contentService = new ContentService();
