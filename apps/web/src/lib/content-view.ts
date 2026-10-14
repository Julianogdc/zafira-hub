import type { ApprovalStatus, ContentFormat, ContentMediaKind } from '@/services/content';

/**
 * F8-1 - Apresentacao pura de conteudo (sem React, sem rede).
 * O servidor e a autoridade; aqui so se orienta a tela e se evita pedir o que ele recusaria.
 */

export const FORMAT_OPTIONS: { value: ContentFormat; label: string; hint: string }[] = [
  { value: 'FEED_IMAGE', label: 'Feed (imagem)', hint: 'Uma imagem. Vídeo no feed do Instagram é publicado como Reel.' },
  { value: 'CAROUSEL', label: 'Carrossel', hint: 'De 2 a 10 arquivos (imagens e/ou vídeos).' },
  { value: 'REEL', label: 'Reel', hint: 'Um único vídeo.' },
  { value: 'STORY', label: 'Story', hint: 'Uma imagem ou um vídeo.' },
];

export const formatLabel = (f: ContentFormat) => FORMAT_OPTIONS.find((o) => o.value === f)?.label ?? f;

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
export const ACCEPTED_LABEL = 'JPG, PNG, WebP, MP4 ou MOV, até 100 MB por arquivo';

export function mediaLimits(format: ContentFormat): { min: number; max: number } {
  return format === 'CAROUSEL' ? { min: 2, max: 10 } : { min: 1, max: 1 };
}

export function allowedKinds(format: ContentFormat): ContentMediaKind[] {
  if (format === 'FEED_IMAGE') return ['IMAGE'];
  if (format === 'REEL') return ['VIDEO'];
  return ['IMAGE', 'VIDEO'];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Aviso local antes de enviar (o servidor valida o tipo real). */
export function localFileProblem(file: { size: number }): string | null {
  if (file.size <= 0) return 'O arquivo está vazio.';
  if (file.size > MAX_FILE_BYTES) return 'O arquivo excede o limite de 100 MB.';
  return null;
}

const EVENT_LABEL: Record<string, string> = {
  CONTENT_CREATED: 'Conteúdo cadastrado',
  CONTENT_UPDATED: 'Dados atualizados',
  MEDIA_ADDED: 'Arquivo adicionado',
  MEDIA_REPLACED: 'Arquivo substituído',
  MEDIA_REMOVED: 'Arquivo removido',
  VERSION_CREATED: 'Nova versão criada',
  APPROVAL_LINK_CREATED: 'Link de aprovação gerado',
  APPROVAL_LINK_REISSUED: 'Link de aprovação reemitido (o anterior foi revogado)',
  APPROVAL_LINK_REVOKED: 'Link de aprovação revogado',
  CLIENT_APPROVED: 'Cliente aprovou',
  CLIENT_CHANGES_REQUESTED: 'Cliente solicitou alteração',
  // F8-4/F8-5p.3: trilha da publicacao (auditoria)
  PUBLICATION_REQUESTED: 'Agendamento registrado no Hub',
  PUBLICATION_RESCHEDULE_REQUESTED: 'Reagendamento solicitado',
  PUBLICATION_CANCEL_REQUESTED: 'Cancelamento solicitado',
  PUBLICATION_STATE_CHANGED: 'Situação da publicação atualizada',
  PUBLICATION_BLOCKED: 'Envio bloqueado pelas regras do piloto (nada foi enviado)',
};
export const contentEventLabel = (type: string) => EVENT_LABEL[type] ?? type;

/** Proporcao do quadro de pre-visualizacao simples por formato. */
export function previewAspect(format: ContentFormat): string {
  if (format === 'REEL' || format === 'STORY') return '9 / 16';
  if (format === 'CAROUSEL') return '4 / 5';
  return '1 / 1';
}

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; help: string }> = {
  NOT_SENT: { label: 'Não enviado ao cliente', tone: 'neutral', help: 'Ainda não há link de aprovação para esta versão.' },
  AWAITING_CLIENT: { label: 'Aguardando o cliente', tone: 'info', help: 'O link está ativo e aguarda a resposta do cliente.' },
  APPROVED: { label: 'Aprovado pelo cliente', tone: 'success', help: 'O cliente aprovou esta versão.' },
  CHANGES_REQUESTED: { label: 'Alteração solicitada', tone: 'warning', help: 'O cliente pediu alterações. Crie uma nova versão, ajuste os arquivos e envie de novo.' },
  LINK_EXPIRED: { label: 'Link expirado', tone: 'danger', help: 'O link venceu sem resposta. Gere um novo link.' },
  LINK_REVOKED: { label: 'Link revogado', tone: 'danger', help: 'O link foi revogado. Gere um novo link para enviar ao cliente.' },
};

export const CHANNEL_LABEL: Record<'WHATSAPP' | 'EMAIL' | 'OTHER', string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', OTHER: 'Outro canal' };

/** URL completa do link, montada no navegador; o token fica no fragmento (#) e nunca vai a servidores. */
export function approvalUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`;
}

export function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 7;
  return Math.min(30, Math.max(1, Math.floor(n)));
}

/** Legenda truncada como no feed: ate `limit` caracteres, cortando em espaco quando possivel. */
export function truncateCaption(caption: string, limit = 125): { text: string; truncated: boolean } {
  if (caption.length <= limit) return { text: caption, truncated: false };
  const cut = caption.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return { text: (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd(), truncated: true };
}
