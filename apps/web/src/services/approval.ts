/**
 * F8-2 - Cliente da aprovacao por link (pagina publica, SEM sessao).
 * O token vai no corpo da requisicao (nunca na URL da API) e as chamadas nao enviam cookies.
 */
export type ApprovalViewStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';

export interface PublicApprovalView {
  status: ApprovalViewStatus;
  brandName: string;
  format: 'FEED_IMAGE' | 'CAROUSEL' | 'REEL' | 'STORY';
  caption: string;
  versionNumber: number;
  contentHash: string;
  expiresAt: string;
  identificationNotice: string;
  media: { kind: 'IMAGE' | 'VIDEO'; position: number; path: string }[];
  decision: { decision: 'APPROVED' | 'CHANGES_REQUESTED'; decidedAt: string; approverName: string; comment: string | null } | null;
}

export interface PublicDecisionInput {
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  comment?: string;
  approverName: string;
  approverContact: string;
  authorityDeclared: boolean;
  contentHash: string;
}

export interface PublicResult<T> {
  ok: boolean;
  data: T | null;
  unavailable: boolean;
  status: number;
  code?: string;
  message: string;
}

const base = () => (import.meta.env.DEV ? '/api' : '/hub-api');
export const publicMediaUrl = (path: string) => `${base()}${path}`;

async function post<T>(path: string, body: unknown): Promise<PublicResult<T>> {
  try {
    const res = await fetch(`${base()}${path}`, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T, unavailable: false, status: res.status, message: '' };
    return {
      ok: false,
      data: null,
      unavailable: res.status === 404 && data?.code === 'LINK_UNAVAILABLE',
      status: res.status,
      code: data?.code,
      message: data?.message || 'Não foi possível concluir a operação.',
    };
  } catch {
    return { ok: false, data: null, unavailable: false, status: 0, message: 'Sem conexão com o servidor. Tente novamente.' };
  }
}

export const publicApprovalService = {
  view: (token: string) => post<PublicApprovalView>('/public/approval/view', { token }),
  decide: (token: string, input: PublicDecisionInput) => post<PublicApprovalView>('/public/approval/decision', { token, ...input }),
};

/** O token fica no fragmento da URL (#...): nao e enviado ao servidor nem ao cabecalho Referer. */
export function tokenFromHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[A-Za-z0-9_-]{20,200}$/.test(raw) ? raw : '';
}
