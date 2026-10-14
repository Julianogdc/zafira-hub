import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { capabilitiesService } from '@/services/capabilities';
import type { PublicationView } from '@/lib/publication-view';

/**
 * F8-1 (DEC-F8-003) - Cliente da API de conteudo (arquivos finais versionados).
 * Pauta, revisao e aprovacao internas ficam no Asana. Nada e enviado ao BrightBean nesta fatia.
 * Capacidades so decidem o que MOSTRAR; cada rota valida a permissao e a carteira de novo.
 */

export type ContentFormat = 'FEED_IMAGE' | 'CAROUSEL' | 'REEL' | 'STORY';
export type ContentMediaKind = 'IMAGE' | 'VIDEO';

export type ApprovalStatus = 'NOT_SENT' | 'AWAITING_CLIENT' | 'APPROVED' | 'CHANGES_REQUESTED' | 'LINK_EXPIRED' | 'LINK_REVOKED';

export interface ApprovalLinkView {
  id: string;
  versionId: string;
  versionNumber: number | null;
  state: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  recipientLabel: string | null;
  channel: 'WHATSAPP' | 'EMAIL' | 'OTHER';
  identificationLevel: string;
  createdAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
}

export interface ApprovalDecisionView {
  id: string;
  versionId: string;
  versionNumber: number | null;
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  comment: string | null;
  approverName: string;
  approverContact: string;
  channel: string;
  identificationLevel: string;
  authorityDeclared: boolean;
  createdAt: string;
}

export interface ApprovalOverview {
  status: ApprovalStatus;
  currentVersionNumber: number;
  identificationNotice: string;
  links: ApprovalLinkView[];
  decisions: ApprovalDecisionView[];
}

export interface CreatedApprovalLink {
  token: string;
  path: string;
  reissued: boolean;
  versionNumber: number;
  link: ApprovalLinkView;
}

export interface ContentListItem {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  format: ContentFormat;
  asanaTaskGid: string | null;
  deliverablePieceId: string | null;
  archivedAt: string | null;
  updatedAt: string;
  versionNumber: number;
  mediaCount: number;
  editable: boolean;
  approvalStatus?: ApprovalStatus;
}

export interface ContentMediaView {
  id: string;
  position: number;
  kind: ContentMediaKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalFilename: string;
  createdAt: string;
  removedAt: string | null;
}

export interface ContentVersionView {
  id: string;
  number: number;
  caption: string;
  contentHash: string;
  sentForApprovalAt: string | null;
  updatedAt: string;
  media: ContentMediaView[];
}

export interface ContentEventView {
  id: string;
  type: string;
  versionId: string | null;
  actorUserId: string | null;
  data: unknown;
  createdAt: string;
}

export interface ContentDetail {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  format: ContentFormat;
  asanaTaskGid: string | null;
  deliverablePieceId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  editable: boolean;
  currentVersionNumber: number;
  problems: { code: string; message: string }[];
  publishCompatibilityNote: string;
  versions: ContentVersionView[];
  events: ContentEventView[];
}

export interface CreateContentInput {
  clientId: string;
  title: string;
  format: ContentFormat;
  caption: string;
  asanaTaskGid?: string | null;
  deliverablePieceId?: string | null;
}

export interface UpdateContentInput {
  title?: string;
  format?: ContentFormat;
  caption?: string;
  asanaTaskGid?: string | null;
  deliverablePieceId?: string | null;
  expectedUpdatedAt?: string;
}

export interface PublicationTarget {
  socialAccountId: string;
  platform: string;
  label: string;
  charLimit: number | null;
}

export interface PublicationSettings {
  dispatchEnabled: boolean;
  minLeadMinutes: number;
  pilot: 'instagram';
  dailyCap: number;
}

const enc = encodeURIComponent;
const apiBase = () => (import.meta.env.DEV ? '/api' : '/hub-api');

export const contentService = {
  list: (clientId?: string) => api.get<ContentListItem[]>(`/content/items${clientId ? `?clientId=${enc(clientId)}` : ''}`),
  get: (id: string) => api.get<ContentDetail>(`/content/items/${enc(id)}`),
  create: (body: CreateContentInput) => api.post<ContentDetail>('/content/items', body),
  update: (id: string, body: UpdateContentInput) => api.patch<ContentDetail>(`/content/items/${enc(id)}`, body),
  upload: (id: string, file: File, replaceMediaId?: string) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<ContentDetail>(
      `/content/items/${enc(id)}/media${replaceMediaId ? `?replace=${enc(replaceMediaId)}` : ''}`,
      form
    );
  },
  removeMedia: (id: string, mediaId: string) => api.delete<ContentDetail>(`/content/items/${enc(id)}/media/${enc(mediaId)}`),
  approval: (id: string) => api.get<ApprovalOverview>(`/content/items/${enc(id)}/approval`),
  createApprovalLink: (id: string, body: { expiresInDays?: number; recipientLabel?: string | null; channel: 'WHATSAPP' | 'EMAIL' | 'OTHER' }) =>
    api.post<CreatedApprovalLink>(`/content/items/${enc(id)}/approval-links`, body),
  revokeApprovalLink: (id: string, linkId: string, reason?: string) =>
    api.post<ApprovalOverview>(`/content/items/${enc(id)}/approval-links/${enc(linkId)}/revoke`, { reason: reason || null }),
  // F8-4b (DEC-F8-027): agendamento no Instagram pela versao aprovada; o envio real e do despachante.
  publications: (id: string) => api.get<PublicationView[]>(`/content/items/${enc(id)}/publications`),
  publicationTargets: (id: string) => api.get<PublicationTarget[]>(`/content/items/${enc(id)}/publication-targets`),
  publicationSettings: () => api.get<PublicationSettings>('/content/publication-settings'),
  requestPublication: (id: string, body: { socialAccountId: string; scheduledAt: string }) =>
    api.post<PublicationView>(`/content/items/${enc(id)}/publications`, body),
  reschedulePublication: (publicationId: string, scheduledAt: string) =>
    api.post<PublicationView>(`/content/publications/${enc(publicationId)}/reschedule`, { scheduledAt }),
  cancelPublication: (publicationId: string) => api.post<PublicationView>(`/content/publications/${enc(publicationId)}/cancel`, {}),
  newVersion: (id: string) => api.post<ContentDetail>(`/content/items/${enc(id)}/versions`, {}),
  /** Arquivo autorizado por sessao/carteira, devolvido como blob para pre-visualizacao. */
  async fileBlobUrl(id: string, mediaId: string): Promise<string> {
    const res = await fetch(`${apiBase()}/content/items/${enc(id)}/media/${enc(mediaId)}/file`, { credentials: 'include' });
    if (!res.ok) throw new Error('Arquivo indisponível.');
    return URL.createObjectURL(await res.blob());
  },
};

export interface ContentCapabilities {
  loading: boolean;
  error: boolean;
  view: boolean;
  create: boolean;
  send: boolean;
  schedule: boolean;
}

export function useContentCapabilities(organizationId?: string | null): ContentCapabilities {
  const [state, setState] = useState<ContentCapabilities>({ loading: true, error: false, view: false, create: false, send: false, schedule: false });
  useEffect(() => {
    let alive = true;
    capabilitiesService
      .getEffectiveCapabilities(organizationId ?? undefined)
      .then((c) => {
        if (!alive) return;
        const p = c.permissions as Record<string, boolean>;
        setState({ loading: false, error: false, view: Boolean(p['content.view']), create: Boolean(p['content.create']), send: Boolean(p['content.send_to_client']), schedule: Boolean(p['content.schedule']) });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: true, view: false, create: false, send: false, schedule: false });
      });
    return () => {
      alive = false;
    };
  }, [organizationId]);
  return state;
}

export function contentErrorInfo(error: unknown): { status: number; code?: string; message: string; existingId?: string } {
  const e = error as { status?: number; message?: string; data?: { code?: string; existingId?: string } } | null;
  return {
    status: e?.status ?? 0,
    code: e?.data?.code,
    message: e?.message || 'Nao foi possivel concluir a operacao.',
    existingId: e?.data?.existingId,
  };
}
