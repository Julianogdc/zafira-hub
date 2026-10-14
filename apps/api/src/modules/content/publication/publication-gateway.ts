import { BrightBeanApiError, BrightBeanClient } from '../../integrations/brightbean/brightbean.client.js';
import { resolveBrightBeanApiUrl } from '../../integrations/brightbean/brightbean.config.js';
import { integrationConnectionService } from '../../integrations/connections/integration-connection.service.js';
import { prisma } from '../../../lib/prisma.js';

/**
 * F8-4a (DEC-F8-023) - Porta estreita do despachante para o provedor de publicacao.
 * Implementacoes: BrightBeanPublicationGateway (real; so montada com o despachante LIGADO) e o simulador
 * (publication-simulator.ts) usado nos testes. Nada aqui e chamado com a configuracao padrao.
 */

export interface RemotePost {
  id: string;
  status: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  permalink: string | null;
  publishError: string | null;
}

export interface RemoteAccount {
  id: string;
  platform: string;
  connectionStatus: string | null;
  charLimit: number | null;
}

export interface PublicationGateway {
  me(): Promise<{ permissions: string[]; accounts: RemoteAccount[] }>;
  uploadMedia(input: { filename: string; mimeType: string; buffer: Buffer; idempotencyKey: string }): Promise<{ id: string; processingStatus: string | null }>;
  getMedia(id: string): Promise<{ id: string; processingStatus: string | null }>;
  createDraft(input: { socialAccountId: string; caption: string; mediaIds: string[]; postType: 'story' | 'reel' | null; idempotencyKey: string }): Promise<RemotePost>;
  getPost(id: string): Promise<RemotePost | null>;
  schedule(id: string, scheduledAtIso: string): Promise<RemotePost>;
  reschedule(id: string, scheduledAtIso: string): Promise<RemotePost>;
  cancel(id: string): Promise<void>;
}

export type GatewayErrorKind = 'TIMEOUT' | 'CONFLICT' | 'INVALID' | 'RATE_LIMIT' | 'AUTH' | 'NOT_FOUND' | 'SERVER';

export class GatewayError extends Error {
  constructor(
    public readonly kind: GatewayErrorKind,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** Classifica erros do cliente HTTP do BrightBean sem expor corpo bruto nem segredo. */
export function toGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof BrightBeanApiError) {
    const s = error.statusCode;
    const detail = String(error.detail ?? error.message ?? '').slice(0, 200);
    if (s === 409) return new GatewayError('CONFLICT', detail);
    if (s === 422 || s === 400) return new GatewayError('INVALID', detail);
    if (s === 429) return new GatewayError('RATE_LIMIT', detail, error.retryAfterSeconds);
    if (s === 401 || s === 403) return new GatewayError('AUTH', 'Credencial ou permissao recusada pelo provedor.');
    if (s === 404) return new GatewayError('NOT_FOUND', detail);
    return new GatewayError('SERVER', `Provedor respondeu ${s}.`);
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new GatewayError('TIMEOUT', 'Sem resposta do provedor.');
  return new GatewayError('TIMEOUT', 'Falha de rede sem confirmacao do provedor.');
}

type RawPost = {
  id: string;
  status?: string | null;
  scheduled_at?: string | null;
  platform_posts?: { status?: string | null; scheduled_at?: string | null; published_at?: string | null; platform_post_id?: string | null; permalink_url?: string | null; publish_error?: string | null }[];
};

export function mapRawPost(raw: RawPost): RemotePost {
  const child = raw.platform_posts?.[0] ?? {};
  return {
    id: raw.id,
    status: child.status ?? raw.status ?? null,
    scheduledAt: child.scheduled_at ?? raw.scheduled_at ?? null,
    publishedAt: child.published_at ?? null,
    platformPostId: child.platform_post_id || null,
    permalink: child.permalink_url || null,
    publishError: child.publish_error ? String(child.publish_error).slice(0, 300) : null,
  };
}

export class BrightBeanPublicationGateway implements PublicationGateway {
  constructor(private readonly client: BrightBeanClient) {}

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toGatewayError(error);
    }
  }

  async me() {
    const raw = (await this.call(() => this.client.getMe())) as unknown as {
      permissions?: string[];
      allowlisted_accounts?: { id: string; platform: string; connection_status?: string | null; char_limit?: number | null }[];
    };
    return {
      permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
      accounts: (raw.allowlisted_accounts ?? []).map((a) => ({ id: a.id, platform: a.platform, connectionStatus: a.connection_status ?? null, charLimit: a.char_limit ?? null })),
    };
  }
  async uploadMedia(input: { filename: string; mimeType: string; buffer: Buffer; idempotencyKey: string }) {
    const raw = (await this.call(() => this.client.uploadMedia(input))) as unknown as { id: string; processing_status?: string | null };
    return { id: raw.id, processingStatus: raw.processing_status ?? null };
  }
  async getMedia(id: string) {
    const raw = (await this.call(() => this.client.getMedia(id))) as unknown as { id: string; processing_status?: string | null };
    return { id: raw.id, processingStatus: raw.processing_status ?? null };
  }
  async createDraft(input: { socialAccountId: string; caption: string; mediaIds: string[]; postType: 'story' | 'reel' | null; idempotencyKey: string }) {
    const payload = {
      social_account_id: input.socialAccountId,
      caption: input.caption,
      media_asset_ids: input.mediaIds,
      action: 'draft',
      ...(input.postType ? { post_type: input.postType } : {}),
    };
    const raw = await this.call(() => this.client.createPost(payload as never, input.idempotencyKey));
    return mapRawPost(raw as unknown as RawPost);
  }
  async getPost(id: string) {
    const raw = await this.call(() => this.client.getPost(id));
    return raw ? mapRawPost(raw as unknown as RawPost) : null;
  }
  async schedule(id: string, scheduledAtIso: string) {
    return mapRawPost((await this.call(() => this.client.schedulePost(id, scheduledAtIso))) as unknown as RawPost);
  }
  async reschedule(id: string, scheduledAtIso: string) {
    return mapRawPost((await this.call(() => this.client.updatePostSchedule(id, scheduledAtIso))) as unknown as RawPost);
  }
  async cancel(id: string) {
    await this.call(() => this.client.cancelPost(id));
  }
}

/**
 * Monta o gateway real a partir da conexao organizacional ativa do BrightBean.
 * So e chamado pelo despachante quando PUBLICATION_DISPATCH_ENABLED=true.
 */
export async function resolveBrightBeanGateway(organizationId: string): Promise<PublicationGateway> {
  const connections = await prisma.integrationConnection.findMany({
    where: { organizationId, provider: 'BRIGHTBEAN', clientId: null, status: 'ACTIVE' },
    select: { id: true },
  });
  if (connections.length !== 1) {
    throw new GatewayError('AUTH', connections.length === 0 ? 'Sem conexao ativa do BrightBean.' : 'Mais de uma conexao ativa do BrightBean.');
  }
  const apiKey = await integrationConnectionService.resolveCredential(organizationId, connections[0].id);
  return new BrightBeanPublicationGateway(new BrightBeanClient({ apiBaseUrl: resolveBrightBeanApiUrl(), apiKey }));
}
