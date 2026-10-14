/**
 * F8-4a (DEC-F8-023) - Regras puras de publicacao pela versao aprovada (sem rede, sem banco).
 * Base: contrato docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md (comportamento observado na F8-0b).
 * Piloto: somente Instagram (D-F84-4). Antecedencia minima de 5 min com fuso explicito (D-F84-2).
 * Depois de PUBLISHING nao ha reagendamento nem cancelamento (D-F84-3).
 */

import type { ContentFormat, ContentMediaKind } from './content-model.js';

export const PUBLICATION_STATES = [
  'PENDING', // pedido gravado na caixa de saida, nada enviado ao provedor
  'DRAFTED', // rascunho criado no provedor
  'SCHEDULED', // agendado no provedor
  'PROVIDER_RETRY', // o provedor voltou a "scheduled" depois de uma falha (retentativa dele)
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'AMBIGUOUS', // sem confirmacao (timeout): so reconciliacao, nunca reenvio cego
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLICATION_MIN_LEAD_MINUTES = 5;
/** Teto do Instagram por conta em 24 h (contando agendados), observado no servidor. */
export const INSTAGRAM_DAILY_CAP = 25;
/** Limite de legenda observado para instagram_login quando a conta nao informar outro. */
export const INSTAGRAM_DEFAULT_CAPTION_LIMIT = 2200;
export const PUBLISH_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const PUBLISH_MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const PUBLISH_CAROUSEL_MIN = 2;
export const PUBLISH_CAROUSEL_MAX = 10;
/** Tipos verificados para publicacao (MOV ainda nao verificado: fica fora ate confirmacao real). */
export const PUBLISHABLE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] as const;

/** Piloto exclusivamente Instagram (D-F84-4); arquitetura segue aberta a outras redes. */
export function isPilotPlatform(platform: string | null | undefined): boolean {
  return typeof platform === 'string' && /^instagram(_login)?$/i.test(platform.trim());
}

export type PublicationProblemCode =
  | 'SCHEDULE_TIMEZONE_REQUIRED'
  | 'SCHEDULE_INVALID'
  | 'SCHEDULE_TOO_SOON'
  | 'PLATFORM_NOT_IN_PILOT'
  | 'MEDIA_COUNT_INVALID'
  | 'MEDIA_KIND_INVALID'
  | 'MEDIA_TYPE_NOT_PUBLISHABLE'
  | 'MEDIA_TOO_LARGE'
  | 'CAPTION_TOO_LONG'
  | 'DAILY_CAP_REACHED';

export interface PublicationProblem {
  code: PublicationProblemCode;
  message: string;
}

/** Horario sempre com fuso explicito ("Z" ou "+hh:mm"/"-hh:mm"). */
export function parseScheduledAt(value: unknown): { ok: true; at: Date } | { ok: false; problem: PublicationProblem } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    return {
      ok: false,
      problem: { code: 'SCHEDULE_TIMEZONE_REQUIRED', message: 'Informe data e hora com fuso horário explícito (ex.: 2026-10-20T14:00:00-03:00).' },
    };
  }
  const at = new Date(value.trim());
  if (Number.isNaN(at.getTime())) return { ok: false, problem: { code: 'SCHEDULE_INVALID', message: 'Data e hora inválidas.' } };
  return { ok: true, at };
}

/** Antecedencia minima (D-F84-2): o provedor nao valida horario futuro e publica horario passado em ~15 s. */
export function checkScheduleLead(at: Date, now: Date = new Date(), minLeadMinutes = PUBLICATION_MIN_LEAD_MINUTES): PublicationProblem | null {
  if (at.getTime() < now.getTime() + minLeadMinutes * 60_000) {
    return { code: 'SCHEDULE_TOO_SOON', message: `O agendamento precisa de pelo menos ${minLeadMinutes} minutos de antecedência.` };
  }
  return null;
}

export interface PublishableMedia {
  kind: ContentMediaKind;
  mimeType: string;
  sizeBytes: number;
}

/** Validacoes que o provedor NAO faz na criacao do rascunho (carrossel, legenda) e limites de arquivo. */
export function validatePublicationContent(input: {
  format: ContentFormat;
  media: readonly PublishableMedia[];
  caption: string;
  captionLimit?: number | null;
}): PublicationProblem[] {
  const problems: PublicationProblem[] = [];
  const n = input.media.length;
  const kinds = input.media.map((m) => m.kind);
  switch (input.format) {
    case 'FEED_IMAGE':
      if (n !== 1) problems.push({ code: 'MEDIA_COUNT_INVALID', message: 'Post de feed exige exatamente 1 imagem.' });
      if (kinds.some((k) => k !== 'IMAGE')) problems.push({ code: 'MEDIA_KIND_INVALID', message: 'Post de feed aceita somente imagem.' });
      break;
    case 'CAROUSEL':
      if (n < PUBLISH_CAROUSEL_MIN || n > PUBLISH_CAROUSEL_MAX) {
        problems.push({ code: 'MEDIA_COUNT_INVALID', message: `Carrossel exige de ${PUBLISH_CAROUSEL_MIN} a ${PUBLISH_CAROUSEL_MAX} arquivos.` });
      }
      break;
    case 'REEL':
      if (n !== 1 || kinds[0] !== 'VIDEO') problems.push({ code: 'MEDIA_KIND_INVALID', message: 'Reel exige exatamente 1 vídeo.' });
      break;
    case 'STORY':
      if (n !== 1) problems.push({ code: 'MEDIA_COUNT_INVALID', message: 'Story exige exatamente 1 arquivo.' });
      break;
  }
  for (const m of input.media) {
    if (!(PUBLISHABLE_MIMES as readonly string[]).includes(m.mimeType)) {
      problems.push({ code: 'MEDIA_TYPE_NOT_PUBLISHABLE', message: 'Tipo de arquivo ainda não verificado para publicação (use JPG, PNG, WebP ou MP4).' });
      break;
    }
  }
  if (input.media.some((m) => m.kind === 'IMAGE' && m.sizeBytes > PUBLISH_MAX_IMAGE_BYTES)) {
    problems.push({ code: 'MEDIA_TOO_LARGE', message: 'Imagem acima de 20 MB não é aceita pelo provedor de publicação.' });
  }
  if (input.media.some((m) => m.kind === 'VIDEO' && m.sizeBytes > PUBLISH_MAX_VIDEO_BYTES)) {
    problems.push({ code: 'MEDIA_TOO_LARGE', message: 'Vídeo acima de 1 GB não é aceito pelo provedor de publicação.' });
  }
  const limit = input.captionLimit ?? INSTAGRAM_DEFAULT_CAPTION_LIMIT;
  if ([...input.caption].length > limit) {
    problems.push({ code: 'CAPTION_TOO_LONG', message: `A legenda excede o limite de ${limit} caracteres da conta.` });
  }
  return problems;
}

export function checkDailyCap(activeInWindow: number, cap = INSTAGRAM_DAILY_CAP): PublicationProblem | null {
  return activeInWindow >= cap ? { code: 'DAILY_CAP_REACHED', message: `A conta já tem ${cap} publicações nas 24 horas em torno deste horário.` } : null;
}

/** D-F84-3: depois de PUBLISHING so acompanhamento. AMBIGUOUS exige reconciliacao antes de qualquer acao. */
export function canReschedulePublication(state: PublicationState): boolean {
  return state === 'PENDING' || state === 'DRAFTED' || state === 'SCHEDULED' || state === 'PROVIDER_RETRY';
}
export function canCancelPublication(state: PublicationState): boolean {
  return canReschedulePublication(state);
}
/** Estados em que a publicacao ocupa a vaga "uma ativa por versao + conta". */
export function isActivePublication(state: PublicationState): boolean {
  return state !== 'CANCELLED' && state !== 'FAILED';
}

export interface RemotePostState {
  status: string | null;
  publishedAt?: string | null;
  platformPostId?: string | null;
}

/**
 * Estado do Hub a partir do estado do provedor. Desconhecido falha fechado (AMBIGUOUS).
 * "scheduled" depois de uma tentativa (estava PUBLISHING/PROVIDER_RETRY) = retentativa do provedor.
 * "published" so conta com published_at e platform_post_id.
 */
export function mapRemoteState(remote: RemotePostState, current: PublicationState): PublicationState {
  switch (remote.status) {
    case 'draft':
      return 'DRAFTED';
    case 'scheduled':
      return current === 'PUBLISHING' || current === 'PROVIDER_RETRY' ? 'PROVIDER_RETRY' : 'SCHEDULED';
    case 'publishing':
      return 'PUBLISHING';
    case 'published':
      return remote.publishedAt && remote.platformPostId ? 'PUBLISHED' : 'PUBLISHING';
    case 'failed':
      return 'FAILED';
    default:
      return 'AMBIGUOUS';
  }
}

/** Chave de upload derivada do conteudo (o provedor deduplica por nome+tamanho, nao pelo conteudo). */
export function mediaUploadIdempotencyKey(sha256Hex: string, socialAccountId: string): string {
  return `hub-media-${sha256Hex.slice(0, 40)}-${socialAccountId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;
}
export function draftIdempotencyKey(publicationId: string): string {
  return `hub-draft-${publicationId}`;
}
