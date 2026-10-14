import { randomUUID } from 'node:crypto';
import { GatewayError, type PublicationGateway, type RemoteAccount, type RemotePost, type RemotePostMetrics } from './publication-gateway.js';

/**
 * F8-4a (DEC-F8-023) - Simulador do BrightBean para testes (sem rede, sem conta real).
 * Reproduz o comportamento OBSERVADO na F8-0b (R0, R1, R1+, T30):
 *  - idempotencia por chave: mesma chave + mesmo corpo -> mesma resposta; corpo diferente -> 422 (INVALID);
 *    no upload o "corpo" e nome + tamanho (nao o conteudo);
 *  - story exige 1 midia; reel exige video; carrossel NAO e validado (11 aceito);
 *  - schedule so a partir de draft (senao 409); cancel so de scheduled (senao 409); PATCH de horario so em scheduled;
 *  - publicador: scheduled vencido -> publishing -> published (published_at, platform_post_id, permalink).
 * Modos programaveis (substituem T33/T34 como testes reais): falha transitoria com retentativa do provedor
 * (volta a scheduled, ate 3), falha definitiva, timeout depois de criar (cria e nao responde), 429 com
 * retry_after, credencial recusada, midia em processamento.
 */

interface SimPost extends RemotePost {
  socialAccountId: string;
  caption: string;
  mediaIds: string[];
  postType: 'story' | 'reel' | null;
  providerRetries: number;
}

export interface SimulatorOptions {
  permissions?: string[];
  accounts?: RemoteAccount[];
}

export class PublicationSimulator implements PublicationGateway {
  readonly calls: { op: string; id?: string; key?: string }[] = [];
  readonly posts = new Map<string, SimPost>();
  private readonly media = new Map<string, { id: string; mimeType: string; pendingReads: number }>();
  private readonly uploadKeys = new Map<string, { fingerprint: string; id: string }>();
  private readonly createKeys = new Map<string, { fingerprint: string; id: string }>();
  permissions: string[];
  accounts: RemoteAccount[];

  // modos de falha (consumidos uma vez cada, salvo indicado)
  timeoutAfterCreate = 0;
  rateLimitNext: number | null = null;
  authFailure = false;
  mediaPendingReads = 0;
  transientPublishFailures = 0; // falhas transitorias antes de publicar (retentativas do provedor, max. 3)
  permanentPublishFailure = false;
  holdInPublishing = false;
  // F8-5a: metricas. Sem coleta registrada o provedor devolve zeros com captured_at nulo (T30).
  readonly metricsCollections = new Map<string, { capturedAt: string; values: Record<string, number> }[]>();
  metricsUnavailable: string | null = null; // analytics_available false com este motivo
  metricsErrorNext = 0; // erros temporarios na leitura de metricas

  constructor(opts: SimulatorOptions = {}) {
    this.permissions = opts.permissions ?? ['create_posts', 'upload_media', 'publish_directly', 'view_analytics'];
    this.accounts = opts.accounts ?? [{ id: 'sim-ig-1', platform: 'instagram_login', connectionStatus: 'connected', charLimit: 2200 }];
  }

  private gate(op: string, extra: { id?: string; key?: string } = {}) {
    this.calls.push({ op, ...extra });
    if (this.authFailure) throw new GatewayError('AUTH', 'Credencial ou permissao recusada pelo provedor.');
    if (this.rateLimitNext !== null && op !== 'me' && op !== 'getPost' && op !== 'getMedia') {
      const s = this.rateLimitNext;
      this.rateLimitNext = null;
      throw new GatewayError('RATE_LIMIT', 'Limite de requisicoes.', s);
    }
  }
  count(op: string) {
    return this.calls.filter((c) => c.op === op).length;
  }

  async me() {
    this.gate('me');
    return { permissions: [...this.permissions], accounts: this.accounts.map((a) => ({ ...a })) };
  }

  async uploadMedia(input: { filename: string; mimeType: string; buffer: Buffer; idempotencyKey: string }) {
    this.gate('uploadMedia', { key: input.idempotencyKey });
    const fingerprint = `${input.filename}|${input.buffer.length}`;
    const prev = this.uploadKeys.get(input.idempotencyKey);
    if (prev) {
      if (prev.fingerprint !== fingerprint) throw new GatewayError('INVALID', 'idempotency_key reused with a different request body');
      return { id: prev.id, processingStatus: this.statusOfMedia(prev.id, false) };
    }
    const id = `sim-media-${randomUUID()}`;
    this.media.set(id, { id, mimeType: input.mimeType, pendingReads: this.mediaPendingReads });
    this.uploadKeys.set(input.idempotencyKey, { fingerprint, id });
    return { id, processingStatus: this.statusOfMedia(id, false) };
  }
  private statusOfMedia(id: string, consume: boolean) {
    const m = this.media.get(id);
    if (!m) return null;
    if (m.pendingReads > 0) {
      if (consume) m.pendingReads -= 1;
      return 'pending';
    }
    return 'completed';
  }
  async getMedia(id: string) {
    this.gate('getMedia', { id });
    if (!this.media.has(id)) throw new GatewayError('NOT_FOUND', 'media not found');
    return { id, processingStatus: this.statusOfMedia(id, true) };
  }

  async createDraft(input: { socialAccountId: string; caption: string; mediaIds: string[]; postType: 'story' | 'reel' | null; idempotencyKey: string }) {
    this.gate('createDraft', { key: input.idempotencyKey });
    const fingerprint = JSON.stringify([input.socialAccountId, input.caption, input.mediaIds, input.postType]);
    const prev = this.createKeys.get(input.idempotencyKey);
    if (prev) {
      if (prev.fingerprint !== fingerprint) throw new GatewayError('INVALID', 'idempotency_key reused with a different request body');
      return this.view(this.posts.get(prev.id)!);
    }
    if (!this.accounts.some((a) => a.id === input.socialAccountId)) throw new GatewayError('AUTH', "SocialAccount is not in this key's allowlist.");
    if (!this.permissions.includes('create_posts')) throw new GatewayError('AUTH', 'Permission denied: create_posts');
    if (input.postType === 'story' && input.mediaIds.length !== 1) throw new GatewayError('INVALID', "post_type 'story' requires exactly 1 media asset");
    if (input.postType === 'reel' && !input.mediaIds.every((id) => this.media.get(id)?.mimeType.startsWith('video/'))) {
      throw new GatewayError('INVALID', "post_type 'reel' requires a video asset");
    }
    const id = `sim-post-${randomUUID()}`;
    this.posts.set(id, {
      id, status: 'draft', scheduledAt: null, publishedAt: null, platformPostId: null, permalink: null, publishError: null,
      socialAccountId: input.socialAccountId, caption: input.caption, mediaIds: input.mediaIds, postType: input.postType, providerRetries: 0,
    });
    this.createKeys.set(input.idempotencyKey, { fingerprint, id });
    if (this.timeoutAfterCreate > 0) {
      this.timeoutAfterCreate -= 1;
      throw new GatewayError('TIMEOUT', 'Sem resposta do provedor.'); // criou, mas a resposta "se perdeu"
    }
    return this.view(this.posts.get(id)!);
  }

  private view(p: SimPost): RemotePost {
    return { id: p.id, status: p.status, scheduledAt: p.scheduledAt, publishedAt: p.publishedAt, platformPostId: p.platformPostId, permalink: p.permalink, publishError: p.publishError };
  }
  private must(id: string) {
    const p = this.posts.get(id);
    if (!p) throw new GatewayError('NOT_FOUND', 'post not found');
    return p;
  }
  async getPost(id: string) {
    this.gate('getPost', { id });
    const p = this.posts.get(id);
    return p ? this.view(p) : null;
  }
  async schedule(id: string, scheduledAtIso: string) {
    this.gate('schedule', { id });
    if (!this.permissions.includes('publish_directly')) throw new GatewayError('AUTH', 'Permission denied: publish_directly');
    const p = this.must(id);
    if (p.status !== 'draft') throw new GatewayError('CONFLICT', 'No draft platform posts to schedule.');
    p.status = 'scheduled';
    p.scheduledAt = new Date(scheduledAtIso).toISOString();
    return this.view(p);
  }
  async reschedule(id: string, scheduledAtIso: string) {
    this.gate('reschedule', { id });
    const p = this.must(id);
    if (p.status === 'publishing' || p.status === 'published') throw new GatewayError('CONFLICT', `Post is not editable in status ${p.status}.`);
    if (p.status === 'scheduled') {
      if (!this.permissions.includes('publish_directly')) throw new GatewayError('AUTH', 'Permission denied: publish_directly');
      p.scheduledAt = new Date(scheduledAtIso).toISOString();
    }
    return this.view(p);
  }
  async cancel(id: string) {
    this.gate('cancel', { id });
    const p = this.must(id);
    if (p.status !== 'scheduled') throw new GatewayError('CONFLICT', 'No scheduled platform posts to cancel.');
    p.status = 'draft';
    p.scheduledAt = null;
  }

  /** F8-5a: registra uma coleta do provedor para o post (o que a rotina horaria do BrightBean faria). */
  collectMetrics(postId: string, capturedAt: Date, values: Record<string, number>) {
    const list = this.metricsCollections.get(postId) ?? [];
    list.push({ capturedAt: capturedAt.toISOString(), values });
    this.metricsCollections.set(postId, list);
  }

  async getPostMetrics(id: string): Promise<RemotePostMetrics | null> {
    this.gate('getPostMetrics', { id });
    if (this.metricsErrorNext > 0) {
      this.metricsErrorNext -= 1;
      throw new GatewayError('SERVER', 'Provedor respondeu 503.');
    }
    const p = this.posts.get(id);
    if (!p) return null;
    if (this.metricsUnavailable) return { analyticsAvailable: false, unavailableReason: this.metricsUnavailable, capturedAt: null, tiles: [] };
    const last = this.metricsCollections.get(id)?.at(-1);
    const keys = ['reach', 'views', 'likes', 'comments', 'saves', 'shares'];
    const tiles = [
      ...keys.map((key) => ({ key, kind: 'count', value: last?.values[key] ?? 0 })),
      { key: 'engagement', kind: 'percent', value: last?.values.engagement ?? 0 },
    ];
    return { analyticsAvailable: true, unavailableReason: null, capturedAt: last?.capturedAt ?? null, tiles };
  }

  /** Avanca o "publicador" do provedor ate `now` (equivale aos ciclos de ~15 s); opcionalmente so um post. */
  advance(now: Date = new Date(), onlyPostId?: string | null) {
    for (const p of this.posts.values()) {
      if (onlyPostId && p.id !== onlyPostId) continue;
      if (p.status === 'scheduled' && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now.getTime()) {
        p.status = 'publishing';
        continue;
      }
      if (p.status === 'publishing' && !this.holdInPublishing) {
        if (this.permanentPublishFailure) {
          p.status = 'failed';
          p.publishError = 'Media rejected by the platform.';
        } else if (this.transientPublishFailures > 0 && p.providerRetries < 3) {
          this.transientPublishFailures -= 1;
          p.providerRetries += 1;
          p.status = 'scheduled';
          p.scheduledAt = new Date(now.getTime() + 60_000).toISOString();
        } else if (this.transientPublishFailures > 0) {
          p.status = 'failed';
          p.publishError = 'Exceeded retries.';
        } else {
          p.status = 'published';
          p.publishedAt = now.toISOString();
          p.platformPostId = `ig-${p.id.slice(-8)}`;
          p.permalink = `https://simulador.invalid/p/${p.id.slice(-8)}`;
        }
      }
    }
  }
}
