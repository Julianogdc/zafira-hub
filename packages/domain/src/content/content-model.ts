/**
 * F8-1 (DEC-F8-003) - Regras puras de conteudo: formatos, arquivos aceitos e conjunto de midias.
 * Sem rede, sem banco, sem Node: opera sobre bytes (Uint8Array).
 * ACEITO PELO HUB != HOMOLOGADO PARA PUBLICACAO NO BRIGHTBEAN (matriz F8-0): a publicabilidade e "a verificar".
 */

import { dateInTimeZone } from '../time/organization-time.js';

export const CONTENT_FORMATS = ['FEED_IMAGE', 'CAROUSEL', 'REEL', 'STORY'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_MEDIA_KINDS = ['IMAGE', 'VIDEO'] as const;
export type ContentMediaKind = (typeof CONTENT_MEDIA_KINDS)[number];

/** Teto por arquivo (D4, DEC-F8-002). */
export const CONTENT_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const CAROUSEL_MIN_MEDIA = 2;
export const CAROUSEL_MAX_MEDIA = 10;
export const CONTENT_CAPTION_MAX = 5000;
export const CONTENT_TITLE_MAX = 200;

export const ACCEPTED_FILE_TYPES = [
  { mime: 'image/jpeg', kind: 'IMAGE', label: 'JPG' },
  { mime: 'image/png', kind: 'IMAGE', label: 'PNG' },
  { mime: 'image/webp', kind: 'IMAGE', label: 'WebP' },
  { mime: 'video/mp4', kind: 'VIDEO', label: 'MP4' },
  { mime: 'video/quicktime', kind: 'VIDEO', label: 'MOV' },
] as const satisfies readonly { mime: string; kind: ContentMediaKind; label: string }[];
export type AcceptedMime = (typeof ACCEPTED_FILE_TYPES)[number]['mime'];

export interface DetectedFileType {
  mime: AcceptedMime;
  kind: ContentMediaKind;
}

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));

/**
 * Detecta o tipo REAL pelos bytes iniciais (assinatura). A extensao e o Content-Type declarados sao ignorados.
 * Retorna null quando nao e um dos tipos aceitos.
 */
export function detectFileType(head: Uint8Array): DetectedFileType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: 'image/jpeg', kind: 'IMAGE' };
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) {
    return { mime: 'image/png', kind: 'IMAGE' };
  }
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', kind: 'IMAGE' };
  }
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4);
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'VIDEO' };
    // familias ISO base media (mp41, mp42, isom, iso2, avc1, M4V, ...): tratadas como MP4
    if (/^[A-Za-z0-9 ]{4}$/.test(brand)) {
      const mp4Brands = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'MSNV', 'mmp4'];
      if (mp4Brands.includes(brand)) return { mime: 'video/mp4', kind: 'VIDEO' };
    }
  }
  return null;
}

export type FileProblemCode = 'EMPTY_FILE' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE';

export function validateUploadedFile(
  head: Uint8Array,
  sizeBytes: number
): { ok: true; type: DetectedFileType } | { ok: false; code: FileProblemCode; message: string } {
  if (sizeBytes <= 0) return { ok: false, code: 'EMPTY_FILE', message: 'O arquivo está vazio.' };
  if (sizeBytes > CONTENT_MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: 'O arquivo excede o limite de 100 MB.' };
  }
  const type = detectFileType(head);
  if (!type) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Tipo de arquivo não aceito. Use JPG, PNG, WebP, MP4 ou MOV (verificamos o conteúdo, não a extensão).',
    };
  }
  return { ok: true, type };
}

/** Quantas midias cada formato admite (conforme a matriz F8-0). */
export function mediaLimits(format: ContentFormat): { min: number; max: number } {
  switch (format) {
    case 'CAROUSEL':
      return { min: CAROUSEL_MIN_MEDIA, max: CAROUSEL_MAX_MEDIA };
    default:
      return { min: 1, max: 1 };
  }
}

export type MediaSetProblemCode = 'MEDIA_MISSING' | 'MEDIA_TOO_FEW' | 'MEDIA_TOO_MANY' | 'MEDIA_KIND_NOT_ALLOWED';

export interface MediaSetProblem {
  code: MediaSetProblemCode;
  message: string;
}

/** Tipos de midia permitidos por formato: feed so imagem; reel so video; story imagem ou video; carrossel imagem/video. */
export function allowedKinds(format: ContentFormat): readonly ContentMediaKind[] {
  switch (format) {
    case 'FEED_IMAGE':
      return ['IMAGE'];
    case 'REEL':
      return ['VIDEO'];
    default:
      return ['IMAGE', 'VIDEO'];
  }
}

/** Um novo arquivo pode ser adicionado? (checa tipo e teto do formato). */
export function canAddMedia(
  format: ContentFormat,
  existingKinds: readonly ContentMediaKind[],
  kind: ContentMediaKind
): MediaSetProblem | null {
  if (!allowedKinds(format).includes(kind)) {
    return {
      code: 'MEDIA_KIND_NOT_ALLOWED',
      message:
        format === 'FEED_IMAGE'
          ? 'Post de feed aceita somente imagem.'
          : format === 'REEL'
            ? 'Reel aceita somente vídeo.'
            : 'Este tipo de arquivo não é permitido neste formato.',
    };
  }
  if (existingKinds.length >= mediaLimits(format).max) {
    return {
      code: 'MEDIA_TOO_MANY',
      message:
        mediaLimits(format).max === 1
          ? 'Este formato aceita um único arquivo. Substitua o arquivo atual.'
          : `Este formato aceita no máximo ${mediaLimits(format).max} arquivos.`,
    };
  }
  return null;
}

/** O conjunto atual esta completo para o formato? (usado como aviso; a F8-1 nao bloqueia o rascunho). */
export function validateMediaSet(format: ContentFormat, kinds: readonly ContentMediaKind[]): MediaSetProblem[] {
  const problems: MediaSetProblem[] = [];
  const { min, max } = mediaLimits(format);
  if (kinds.length === 0) problems.push({ code: 'MEDIA_MISSING', message: 'Envie os arquivos finais.' });
  else if (kinds.length < min) problems.push({ code: 'MEDIA_TOO_FEW', message: `Este formato exige ao menos ${min} arquivos.` });
  if (kinds.length > max) problems.push({ code: 'MEDIA_TOO_MANY', message: `Este formato aceita no máximo ${max} arquivo(s).` });
  const allowed = allowedKinds(format);
  if (kinds.some((k) => !allowed.includes(k))) {
    problems.push({ code: 'MEDIA_KIND_NOT_ALLOWED', message: 'Há arquivo de tipo não permitido neste formato.' });
  }
  return problems;
}

/** Mudar o formato mantendo arquivos exige que o conjunto atual ainda caiba. */
export function canChangeFormat(
  next: ContentFormat,
  kinds: readonly ContentMediaKind[]
): MediaSetProblem | null {
  const allowed = allowedKinds(next);
  if (kinds.some((k) => !allowed.includes(k))) {
    return { code: 'MEDIA_KIND_NOT_ALLOWED', message: 'Os arquivos atuais não são permitidos no novo formato. Remova-os antes de mudar.' };
  }
  if (kinds.length > mediaLimits(next).max) {
    return { code: 'MEDIA_TOO_MANY', message: 'Há mais arquivos do que o novo formato aceita. Remova o excedente antes de mudar.' };
  }
  return null;
}

/** Texto de status de publicabilidade (nunca "homologado" nesta fatia). */
export const PUBLISH_COMPATIBILITY_NOTE =
  'Aceito pelo Hub. A compatibilidade de publicação deste arquivo no BrightBean ainda não foi verificada.';

/** Versao editavel = ainda nao enviada para aprovacao do cliente (F8-2). */
export function isVersionEditable(version: { sentForApprovalAt: Date | string | null }): boolean {
  return version.sentForApprovalAt === null;
}

/** Identificador do arquivo no storage: enderecado por hash, isolado por organizacao. */
export function storageKeyFor(organizationId: string, sha256Hex: string): string {
  return `org/${organizationId}/sha256/${sha256Hex}`;
}

/** Tarefa do Asana: gid numerico (somente vinculo local). */
export const ASANA_TASK_GID_PATTERN = /^[0-9]{1,32}$/;

/* ==========================================================================
   F8-2 (DEC-F8-004) - Aprovacao do cliente por link seguro.
   N1: identificacao DECLARADA (nome, contato, declaracao de autoridade). Nao e identidade autenticada.
   ========================================================================== */

export const APPROVAL_DEFAULT_DAYS = 7;
export const APPROVAL_MAX_DAYS = 30;
export const APPROVAL_DECISIONS = ['APPROVED', 'CHANGES_REQUESTED'] as const;
export type ApprovalDecisionKind = (typeof APPROVAL_DECISIONS)[number];
export const APPROVAL_CHANNELS = ['WHATSAPP', 'EMAIL', 'OTHER'] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];
/** N2 (codigo enviado ao contato cadastrado) esta reservado: nao implementado. */
export const APPROVAL_IDENTIFICATION_LEVELS = ['N1'] as const;

export const APPROVAL_N1_NOTICE =
  'Identificação informada pelo próprio aprovador (nível N1). Não é identidade autenticada nem verificada.';

export type LinkState = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export function linkState(link: { revokedAt: Date | string | null; expiresAt: Date | string }, now: Date = new Date()): LinkState {
  if (link.revokedAt) return 'REVOKED';
  return new Date(link.expiresAt).getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
}

/** Dias de validade: padrao 7, entre 1 e 30. */
export function clampApprovalDays(days: number | null | undefined): number {
  if (days === null || days === undefined || !Number.isFinite(days)) return APPROVAL_DEFAULT_DAYS;
  return Math.min(APPROVAL_MAX_DAYS, Math.max(1, Math.floor(days)));
}

export type ApprovalInputProblem = { field: 'approverName' | 'approverContact' | 'authority' | 'comment' | 'decision'; message: string };

export function validateApprovalInput(input: {
  decision: string;
  approverName: string;
  approverContact: string;
  authorityDeclared: boolean;
  comment?: string | null;
}): ApprovalInputProblem[] {
  const problems: ApprovalInputProblem[] = [];
  if (!(APPROVAL_DECISIONS as readonly string[]).includes(input.decision)) {
    problems.push({ field: 'decision', message: 'Escolha aprovar ou solicitar alteração.' });
  }
  if (input.approverName.trim().length < 2) problems.push({ field: 'approverName', message: 'Informe seu nome.' });
  if (input.approverContact.trim().length < 3) problems.push({ field: 'approverContact', message: 'Informe um e-mail ou telefone para contato.' });
  if (!input.authorityDeclared) {
    problems.push({ field: 'authority', message: 'Confirme que você tem autoridade para aprovar este conteúdo.' });
  }
  if (input.decision === 'CHANGES_REQUESTED' && (input.comment ?? '').trim().length < 3) {
    problems.push({ field: 'comment', message: 'Descreva a alteração desejada.' });
  }
  return problems;
}

/* ==========================================================================
   F8-3 (DEC-F8-007) - Contador de Entregas por estagio, derivado dos registros reais.
   Unidade: o conteudo (uma peca), independentemente de versoes, links ou reenvios.
   Publicacao: F8-5b (DEC-F8-029) conta so publicacao confirmada; sem publicacao ativa no ambiente -> null, nunca zero.
   ========================================================================== */

export const CONTENT_STAGES = ['RECEIVED', 'SENT', 'APPROVED'] as const;
export type ContentStage = (typeof CONTENT_STAGES)[number];

export interface ContentStageDates {
  /** Primeiro arquivo enviado (inclusive se removido depois). */
  receivedAt: Date | string | null;
  /** Primeiro envio de uma versao ao cliente. */
  sentAt: Date | string | null;
  /** Primeira decisao APPROVED do cliente. */
  approvedAt: Date | string | null;
}

/** Estagio mais alto alcancado; null quando o conteudo ainda nao tem arquivo nem envio. */
export function contentStageOf(dates: ContentStageDates): ContentStage | null {
  if (dates.approvedAt) return 'APPROVED';
  if (dates.sentAt) return 'SENT';
  if (dates.receivedAt) return 'RECEIVED';
  return null;
}

export type ContentPeriodSource = 'PLAN' | 'FIRST_FILE';

/**
 * Competencia do conteudo (D1): a do plano da peca de Entregas vinculada; sem vinculo, o mes do
 * primeiro arquivo recebido no fuso da organizacao. Sem vinculo e sem arquivo: sem competencia.
 */
export function contentPeriodOf(
  input: { linkedPlanPeriod: string | null; receivedAt: Date | string | null },
  timeZone: unknown
): { period: string; source: ContentPeriodSource } | null {
  if (input.linkedPlanPeriod) return { period: input.linkedPlanPeriod, source: 'PLAN' };
  if (!input.receivedAt) return null;
  const day = dateInTimeZone(input.receivedAt, timeZone);
  return day ? { period: day.slice(0, 7), source: 'FIRST_FILE' } : null;
}

export type PublishedSource = 'NOT_INTEGRATED' | 'CONFIRMED_PUBLICATION';

export interface ContentStageCounts {
  received: number;
  sent: number;
  approved: number;
  /**
   * F8-5b (DEC-F8-029, D-F85-2): conteudos com publicacao CONFIRMADA (publishedAt + platformPostId).
   * Sem publicacao ativa no ambiente (envio desligado): null, nunca 0.
   */
  published: number | null;
  publishedSource: PublishedSource;
}

/**
 * Contagem cumulativa por estagio alcancado: recebidos >= enviados >= aprovados.
 * `publishedFlags` (um por conteudo, na mesma ordem) so e informado quando a publicacao esta ativa no ambiente;
 * sem ele, publicados fica indisponivel. Publicado so conta conteudo aprovado (uma peca por conteudo).
 */
export function countContentStages(stages: readonly (ContentStage | null)[], publishedFlags?: readonly boolean[] | null): ContentStageCounts {
  const rank = (s: ContentStage | null) => (s ? CONTENT_STAGES.indexOf(s) + 1 : 0);
  const integrated = Array.isArray(publishedFlags);
  return {
    received: stages.filter((s) => rank(s) >= 1).length,
    sent: stages.filter((s) => rank(s) >= 2).length,
    approved: stages.filter((s) => rank(s) >= 3).length,
    published: integrated ? stages.filter((s, i) => rank(s) >= 3 && publishedFlags![i] === true).length : null,
    publishedSource: integrated ? 'CONFIRMED_PUBLICATION' : 'NOT_INTEGRATED',
  };
}

/** Proporcao publicadas / recebidas para a barra; null enquanto nao houver dado confiavel ou recebidos. */
export function publishedRatio(counts: Pick<ContentStageCounts, 'received' | 'published'>): number | null {
  if (counts.published === null || counts.received <= 0) return null;
  return Math.min(1, Math.max(0, counts.published / counts.received));
}

export const CONTENT_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type ApprovalStatus = 'NOT_SENT' | 'AWAITING_CLIENT' | 'APPROVED' | 'CHANGES_REQUESTED' | 'LINK_EXPIRED' | 'LINK_REVOKED';

/** Estado de aprovacao da versao atual para o acompanhamento interno. */
export function approvalStatusOf(input: {
  sentForApprovalAt: Date | string | null;
  decision: ApprovalDecisionKind | null;
  activeLink: { revokedAt: Date | string | null; expiresAt: Date | string } | null;
  lastLink: { revokedAt: Date | string | null; expiresAt: Date | string } | null;
  now?: Date;
}): ApprovalStatus {
  if (input.decision) return input.decision;
  if (!input.sentForApprovalAt) return 'NOT_SENT';
  const now = input.now ?? new Date();
  if (input.activeLink && linkState(input.activeLink, now) === 'ACTIVE') return 'AWAITING_CLIENT';
  const last = input.lastLink ?? input.activeLink;
  if (last) return linkState(last, now) === 'REVOKED' ? 'LINK_REVOKED' : 'LINK_EXPIRED';
  return 'LINK_EXPIRED';
}
