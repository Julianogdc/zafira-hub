import { Prisma } from '@prisma/client';
import {
  checkPilotSend,
  draftIdempotencyKey,
  isPilotPlatform,
  parsePilotPolicy,
  type ContentFormat,
  mapRemoteState,
  mediaUploadIdempotencyKey,
  type PublicationState,
} from '@zafira/domain';
import { prisma } from '../../../lib/prisma.js';
import { resolveFileStorage, type FileStorage } from '../file-storage.js';
import { GatewayError, resolveBrightBeanGateway, type PublicationGateway, type RemotePost } from './publication-gateway.js';

/**
 * F8-4a (DEC-F8-023) - Despachante da caixa de saida de publicacoes.
 * DESLIGADO por padrao: so atua com PUBLICATION_DISPATCH_ENABLED=true (nenhuma publicacao real com a
 * configuracao padrao). Cada passo le o estado no provedor antes de agir; agendar/reagendar/cancelar sao
 * idempotentes pelo estado; upload e rascunho usam chave de idempotencia estavel; timeout depois de criar
 * vira AMBIGUOUS e so se resolve repetindo a MESMA chave (replay) ou lendo o estado, nunca recriando.
 */

export const publicationDispatchEnabled = (env: NodeJS.ProcessEnv = process.env) => env.PUBLICATION_DISPATCH_ENABLED === 'true';

/** F8-5p.3 (DEC-F8-031, P39): politica do piloto (organizacoes e formatos); ausente, vazia ou invalida = nada e enviado. */
export const publicationPilotPolicy = (env: NodeJS.ProcessEnv = process.env) =>
  parsePilotPolicy({ organizationIds: env.PUBLICATION_PILOT_ORGANIZATION_IDS, formats: env.PUBLICATION_PILOT_FORMATS });

/** Codigos das barreiras do piloto: bloqueiam o envio sem nunca tocar no provedor. */
const BARRIER_CODES = new Set(['PILOT_POLICY_INVALID', 'PILOT_ORGANIZATION_NOT_AUTHORIZED', 'PILOT_FORMAT_NOT_AUTHORIZED', 'ACCOUNT_UNLINKED']);

const CLAIM_LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 8;
const BACKOFF_S = [15, 60, 300, 900, 3600];
/** No momento do envio o horario ainda precisa estar a pelo menos 1 min (o provedor publica horario passado). */
const DISPATCH_MIN_LEAD_MS = 60_000;
const REQUIRED_PERMISSIONS = ['create_posts', 'upload_media', 'publish_directly'];
const RECONCILE_STATES: PublicationState[] = ['DRAFTED', 'SCHEDULED', 'PROVIDER_RETRY', 'PUBLISHING', 'AMBIGUOUS'];

const safe = (t: unknown) => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);

type GatewayFactory = (organizationId: string) => Promise<PublicationGateway>;
type JobResult = 'DONE' | 'RETRY' | 'FAILED' | 'SKIPPED';

class Stop extends Error {
  constructor(public readonly result: JobResult, public readonly code: string, message: string, public readonly retryAfterS?: number) {
    super(message);
  }
}

export class PublicationDispatcher {
  constructor(
    private readonly gatewayFor: GatewayFactory = resolveBrightBeanGateway,
    private readonly storageFactory: () => FileStorage = () => resolveFileStorage(),
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  isEnabled() {
    return publicationDispatchEnabled(this.env);
  }

  /* ------------------------------ estado da publicacao ------------------------------ */
  private async setState(publicationId: string, data: Prisma.ContentPublicationUpdateInput & { state?: PublicationState }) {
    const before = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    const after = await prisma.contentPublication.update({ where: { id: publicationId }, data });
    if (data.state && data.state !== before.state) {
      await prisma.contentEvent.create({
        data: {
          organizationId: after.organizationId,
          itemId: after.itemId,
          versionId: after.versionId,
          type: 'PUBLICATION_STATE_CHANGED',
          actorUserId: null,
          data: { publicationId, from: before.state, to: data.state, code: (data.failureCode as string | undefined) ?? null },
        },
      });
    }
    return after;
  }

  private async applyRemote(publicationId: string, remote: RemotePost | null, now: Date) {
    const p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    if (!remote) {
      return this.setState(p.id, { state: 'AMBIGUOUS', failureCode: 'REMOTE_NOT_FOUND', failureMessage: 'Post não encontrado no provedor; conferência necessária.', lastSyncedAt: now });
    }
    const state = mapRemoteState({ status: remote.status, publishedAt: remote.publishedAt, platformPostId: remote.platformPostId }, p.state as PublicationState);
    return this.setState(p.id, {
      state,
      lastSyncedAt: now,
      ...(remote.publishedAt ? { publishedAt: new Date(remote.publishedAt) } : {}),
      ...(remote.platformPostId ? { platformPostId: remote.platformPostId } : {}),
      ...(remote.permalink ? { permalink: remote.permalink } : {}),
      ...(state === 'FAILED' ? { failureCode: 'PROVIDER_FAILED', failureMessage: safe(remote.publishError) || 'O provedor informou falha na publicação.' } : {}),
    });
  }

  /* ------------------------------ ciclo ------------------------------ */
  async dispatchDue(opts: { limit?: number; now?: Date } = {}) {
    if (!this.isEnabled()) return { enabled: false as const, claimed: 0, results: [] as string[] };
    const now = opts.now ?? new Date();
    const limit = opts.limit ?? 20;
    const due = await prisma.publicationOutbox.findMany({
      where: { status: { in: ['PENDING', 'RETRYING'] }, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit * 3,
    });
    const seen = new Set<string>();
    const claimed: string[] = [];
    for (const row of due) {
      if (claimed.length >= limit || seen.has(row.publicationId)) continue;
      seen.add(row.publicationId);
      // um pedido por publicacao, na ordem: nao processa um mais novo enquanto houver um mais antigo aberto
      const older = await prisma.publicationOutbox.count({
        where: { publicationId: row.publicationId, status: { in: ['PENDING', 'RETRYING'] }, createdAt: { lt: row.createdAt } },
      });
      if (older > 0) continue;
      const won = await prisma.publicationOutbox.updateMany({
        where: { id: row.id, status: row.status, nextAttemptAt: row.nextAttemptAt },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
      });
      if (won.count === 1) claimed.push(row.id);
    }
    const results: string[] = [];
    for (const id of claimed) results.push(await this.processOne(id, now));
    return { enabled: true as const, claimed: claimed.length, results };
  }

  /** Leitura periodica (sem webhooks): atualiza estado, publicacao, permalink e falha. */
  async reconcileDue(opts: { now?: Date; limit?: number } = {}) {
    if (!this.isEnabled()) return { enabled: false as const, checked: 0 };
    const now = opts.now ?? new Date();
    const rows = await prisma.contentPublication.findMany({
      where: { state: { in: RECONCILE_STATES }, externalPostId: { not: null } },
      orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      take: opts.limit ?? 50,
    });
    let checked = 0;
    for (const p of rows) {
      // nao concorre com um pedido aberto da mesma publicacao
      const open = await prisma.publicationOutbox.count({ where: { publicationId: p.id, status: { in: ['PENDING', 'RETRYING'] } } });
      if (open > 0) continue;
      try {
        const gw = await this.gatewayFor(p.organizationId);
        await this.applyRemote(p.id, await gw.getPost(p.externalPostId!), now);
        checked += 1;
      } catch {
        /* leitura falhou: tenta no proximo ciclo */
      }
    }
    return { enabled: true as const, checked };
  }

  private async processOne(outboxId: string, now: Date): Promise<string> {
    const job = await prisma.publicationOutbox.findUnique({ where: { id: outboxId } });
    if (!job) return 'MISSING';
    let result: JobResult;
    let error: string | null = null;
    let retryAfterS: number | undefined;
    try {
      // F8-5p.3 (P39): barreiras ANTES de montar o gateway; cancelar segue sempre permitido (so reduz exposicao)
      if (job.kind !== 'CANCEL') await this.assertSendAllowed(job.publicationId, job.organizationId);
      const gw = await this.gatewayFor(job.organizationId);
      if (job.kind === 'PUBLISH') await this.runPublish(job.publicationId, gw, now);
      else if (job.kind === 'RESCHEDULE') await this.runReschedule(job.publicationId, gw, now);
      else await this.runCancel(job.publicationId, gw, now);
      result = 'DONE';
    } catch (e) {
      const stop = e instanceof Stop ? e : this.classify(e);
      result = stop.result;
      error = `${stop.code}: ${safe(stop.message)}`;
      retryAfterS = stop.retryAfterS;
      if (stop.result === 'FAILED') await this.failPublication(job.publicationId, job.kind, stop.code, stop.message);
    }
    if (result === 'RETRY' && job.attempts >= MAX_ATTEMPTS) {
      result = 'FAILED';
      await this.exhausted(job.publicationId, error ?? 'tentativas esgotadas');
    }
    const backoff = retryAfterS ?? BACKOFF_S[Math.min(job.attempts - 1, BACKOFF_S.length - 1)] ?? 60;
    await prisma.publicationOutbox.update({
      where: { id: job.id },
      data:
        result === 'RETRY'
          ? { status: 'RETRYING', lastError: error, nextAttemptAt: new Date(now.getTime() + backoff * 1000) }
          : { status: result === 'FAILED' ? 'FAILED' : 'DONE', lastError: error, finishedAt: now },
    });
    return `${job.kind}:${result}`;
  }

  private classify(e: unknown): Stop {
    if (e instanceof GatewayError) {
      switch (e.kind) {
        case 'RATE_LIMIT':
          return new Stop('RETRY', 'RATE_LIMIT', e.message, e.retryAfterSeconds ?? 60);
        case 'TIMEOUT':
        case 'SERVER':
          return new Stop('RETRY', e.kind, e.message);
        case 'CONFLICT':
          return new Stop('RETRY', 'CONFLICT', e.message, 15); // estado mudou: reler no proximo ciclo
        case 'INVALID':
          return new Stop('FAILED', 'PROVIDER_REJECTED', e.message);
        case 'AUTH':
          return new Stop('FAILED', 'PROVIDER_AUTH', e.message);
        case 'NOT_FOUND':
          return new Stop('FAILED', 'REMOTE_NOT_FOUND', e.message);
      }
    }
    return new Stop('RETRY', 'UNEXPECTED', (e as Error)?.message ?? 'erro');
  }

  /**
   * F8-5p.3 (DEC-F8-031, P39): imediatamente antes do envio, reconfere a politica do piloto (organizacao e formato)
   * e o vinculo ativo entre cliente, conta Instagram e organizacao. Qualquer falha bloqueia sem chamar o provedor.
   */
  private async assertSendAllowed(publicationId: string, organizationId: string) {
    const p = await prisma.contentPublication.findUniqueOrThrow({
      where: { id: publicationId },
      select: { organizationId: true, clientId: true, socialAccountId: true, item: { select: { format: true } } },
    });
    if (p.organizationId !== organizationId) throw new Stop('FAILED', 'PILOT_ORGANIZATION_NOT_AUTHORIZED', 'Pedido e publicação de organizações diferentes.');
    const blocked = checkPilotSend(publicationPilotPolicy(this.env), { organizationId: p.organizationId, format: p.item.format as ContentFormat });
    if (blocked) throw new Stop('FAILED', blocked.code, blocked.message);
    const link = await prisma.clientIntegration.findFirst({
      where: { clientId: p.clientId, provider: 'BRIGHTBEAN', externalId: p.socialAccountId, client: { organizationId: p.organizationId } },
      select: { metadata: true },
    });
    const platform = ((link?.metadata ?? {}) as Record<string, unknown>).platform;
    if (!link || !isPilotPlatform(typeof platform === 'string' ? platform : '')) {
      throw new Stop('FAILED', 'ACCOUNT_UNLINKED', 'A conta Instagram não está mais vinculada a este cliente: nada foi enviado.');
    }
  }

  private async failPublication(publicationId: string, kind: string, code: string, message: string) {
    const p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    if (BARRIER_CODES.has(code)) {
      // barreira do piloto: nada foi enviado nesta tentativa; sem rascunho no provedor encerra como FAILED,
      // com rascunho (nunca publica sozinho) mantem o estado e registra o motivo; sempre auditado no historico
      await prisma.contentEvent.create({
        data: { organizationId: p.organizationId, itemId: p.itemId, versionId: p.versionId, type: 'PUBLICATION_BLOCKED', data: { publicationId: p.id, kind, code } },
      });
      if (kind === 'PUBLISH' && !p.externalPostId) await this.setState(p.id, { state: 'FAILED', failureCode: code, failureMessage: safe(message) });
      else await this.setState(p.id, { failureCode: code, failureMessage: safe(message) });
      return;
    }
    if (kind !== 'PUBLISH') {
      // reagendar/cancelar recusados: a publicacao segue no estado do provedor; registra o motivo
      await this.setState(p.id, { failureCode: code, failureMessage: safe(message) });
      return;
    }
    const state: PublicationState = p.externalPostId || code === 'REMOTE_NOT_FOUND' ? 'AMBIGUOUS' : 'FAILED';
    await this.setState(p.id, { state, failureCode: code, failureMessage: safe(message) });
  }

  private async exhausted(publicationId: string, message: string) {
    const p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    // sem confirmacao do provedor: nunca vira "falhou" se algo pode ter sido criado
    const state: PublicationState = p.externalPostId || p.state === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'FAILED';
    await this.setState(p.id, { state, failureCode: 'ATTEMPTS_EXHAUSTED', failureMessage: safe(message) });
  }

  /* ------------------------------ passos ------------------------------ */
  private async checkAccount(gw: PublicationGateway, socialAccountId: string, caption: string) {
    const me = await gw.me();
    const missing = REQUIRED_PERMISSIONS.filter((p) => !me.permissions.includes(p));
    if (missing.length) throw new Stop('FAILED', 'PROVIDER_PERMISSION', `Permissões ausentes no provedor: ${missing.join(', ')}.`);
    const acc = me.accounts.find((a) => a.id === socialAccountId);
    if (!acc) throw new Stop('FAILED', 'PROVIDER_ACCOUNT', 'Conta social fora da lista permitida da chave do provedor.');
    if (!isPilotPlatform(acc.platform)) throw new Stop('FAILED', 'PLATFORM_NOT_IN_PILOT', 'Conta fora da rede do piloto.');
    if (acc.connectionStatus && acc.connectionStatus !== 'connected') throw new Stop('RETRY', 'ACCOUNT_DISCONNECTED', 'Conta social desconectada no provedor.');
    if (acc.charLimit && [...caption].length > acc.charLimit) throw new Stop('FAILED', 'CAPTION_TOO_LONG', `Legenda acima do limite de ${acc.charLimit} caracteres da conta.`);
  }

  private async runPublish(publicationId: string, gw: PublicationGateway, now: Date) {
    let p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    if (p.state === 'CANCELLED' || p.cancelRequestedAt) return;
    if (['SCHEDULED', 'PROVIDER_RETRY', 'PUBLISHING', 'PUBLISHED', 'FAILED'].includes(p.state)) return;
    const version = await prisma.contentVersion.findUniqueOrThrow({
      where: { id: p.versionId },
      include: { item: { select: { format: true } }, media: { where: { removedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    });
    await this.checkAccount(gw, p.socialAccountId, version.caption);

    if (!p.externalPostId) {
      // 1. upload (chave derivada do conteudo) e espera de processamento
      const remote: string[] = Array.isArray(p.remoteMediaIds) ? (p.remoteMediaIds as string[]) : [];
      const storage = this.storageFactory();
      for (let i = remote.length; i < version.media.length; i += 1) {
        const m = version.media[i];
        const ext = m.mimeType.split('/')[1] ?? 'bin';
        const up = await gw.uploadMedia({
          filename: `hub-${m.sha256.slice(0, 16)}.${ext}`,
          mimeType: m.mimeType,
          buffer: await storage.get(m.storageKey),
          idempotencyKey: mediaUploadIdempotencyKey(m.sha256, p.socialAccountId),
        });
        remote.push(up.id);
        await prisma.contentPublication.update({ where: { id: p.id }, data: { remoteMediaIds: remote } });
      }
      for (const id of remote) {
        const st = await gw.getMedia(id);
        if (st.processingStatus && st.processingStatus !== 'completed') throw new Stop('RETRY', 'MEDIA_PROCESSING', 'Mídia ainda em processamento no provedor.', 15);
      }
      // 2. rascunho (chave estavel por publicacao: repetir apos timeout devolve o MESMO post)
      p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
      if (p.cancelRequestedAt) return;
      const postType = version.item.format === 'STORY' ? 'story' : version.item.format === 'REEL' ? 'reel' : null;
      let draft: RemotePost;
      try {
        draft = await gw.createDraft({ socialAccountId: p.socialAccountId, caption: version.caption, mediaIds: remote, postType, idempotencyKey: draftIdempotencyKey(p.id) });
      } catch (e) {
        if (e instanceof GatewayError && (e.kind === 'TIMEOUT' || e.kind === 'SERVER')) {
          await this.setState(p.id, { state: 'AMBIGUOUS', failureCode: 'CREATE_UNCONFIRMED', failureMessage: 'Sem confirmação do provedor ao criar o rascunho; nova tentativa com a mesma chave.' });
        }
        throw e;
      }
      const fresh = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
      if (fresh.cancelRequestedAt || fresh.state === 'CANCELLED') {
        // cancelado durante a criacao: guarda a referencia, mantem CANCELADO e nao agenda (rascunho fica inerte)
        await prisma.contentPublication.update({ where: { id: p.id }, data: { externalPostId: draft.id, lastSyncedAt: now } });
        if (fresh.state !== 'CANCELLED') await this.setState(p.id, { state: 'CANCELLED' });
        return;
      }
      p = await this.setState(p.id, { state: 'DRAFTED', externalPostId: draft.id, failureCode: null, failureMessage: null, lastSyncedAt: now });
    }

    // 3. agendar (pelo estado lido no provedor)
    p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    if (p.cancelRequestedAt) return;
    const remote = await gw.getPost(p.externalPostId!);
    if (!remote) throw new Stop('FAILED', 'REMOTE_NOT_FOUND', 'Rascunho não encontrado no provedor.');
    if (remote.status !== 'draft') {
      await this.applyRemote(p.id, remote, now);
      return;
    }
    if (p.scheduledAt.getTime() < now.getTime() + DISPATCH_MIN_LEAD_MS) {
      await this.setState(p.id, { state: 'DRAFTED', failureCode: 'SCHEDULE_WINDOW_MISSED', failureMessage: 'O horário passou antes do envio ao provedor; reagende.' });
      throw new Stop('FAILED', 'SCHEDULE_WINDOW_MISSED', 'Horário passou antes do envio.');
    }
    const scheduled = await gw.schedule(p.externalPostId!, p.scheduledAt.toISOString());
    await this.applyRemote(p.id, scheduled, now);
  }

  private async runReschedule(publicationId: string, gw: PublicationGateway, now: Date) {
    const p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    if (p.cancelRequestedAt || p.state === 'CANCELLED' || !p.externalPostId) return;
    const remote = await gw.getPost(p.externalPostId);
    if (!remote) throw new Stop('FAILED', 'REMOTE_NOT_FOUND', 'Post não encontrado no provedor.');
    if (remote.status === 'publishing' || remote.status === 'published' || remote.status === 'failed') {
      await this.applyRemote(p.id, remote, now);
      await this.setState(p.id, { failureCode: 'RESCHEDULE_NOT_APPLIED', failureMessage: 'Reagendamento não aplicado: a publicação já tinha iniciado ou encerrado.' });
      return;
    }
    if (p.scheduledAt.getTime() < now.getTime() + DISPATCH_MIN_LEAD_MS) {
      throw new Stop('FAILED', 'SCHEDULE_WINDOW_MISSED', 'O novo horário passou antes do envio; reagende.');
    }
    const after = remote.status === 'draft' ? await gw.schedule(p.externalPostId, p.scheduledAt.toISOString()) : await gw.reschedule(p.externalPostId, p.scheduledAt.toISOString());
    await this.applyRemote(p.id, after, now);
  }

  private async runCancel(publicationId: string, gw: PublicationGateway, now: Date) {
    const p = await prisma.contentPublication.findUniqueOrThrow({ where: { id: publicationId } });
    if (p.state === 'CANCELLED') return;
    if (!p.externalPostId) {
      await this.setState(p.id, { state: 'CANCELLED' });
      return;
    }
    const remote = await gw.getPost(p.externalPostId);
    if (!remote) throw new Stop('FAILED', 'REMOTE_NOT_FOUND', 'Post não encontrado no provedor.');
    if (remote.status === 'scheduled') {
      await gw.cancel(p.externalPostId);
      await this.setState(p.id, { state: 'CANCELLED', lastSyncedAt: now });
      return;
    }
    if (remote.status === 'draft') {
      // ja nao esta na fila; o rascunho fica no provedor (nao e apagavel pela API)
      await this.setState(p.id, { state: 'CANCELLED', lastSyncedAt: now });
      return;
    }
    await this.applyRemote(p.id, remote, now);
    await this.setState(p.id, { failureCode: 'CANCEL_NOT_APPLIED', failureMessage: 'Cancelamento não aplicado: a publicação já tinha iniciado ou encerrado.' });
  }
}

export const publicationDispatcher = new PublicationDispatcher();
