import { z } from 'zod';
import { IdSchema } from './http.js';

/* ==========================================================================
   F8-1 (DEC-F8-003) - Conteudo: arquivos finais versionados no Hub.
   Pauta, revisao e aprovacao internas permanecem no Asana (DEC-F8-001).
   ========================================================================== */

export const ContentFormatSchema = z.enum(['FEED_IMAGE', 'CAROUSEL', 'REEL', 'STORY']);
export type ContentFormat = z.infer<typeof ContentFormatSchema>;

export const ContentMediaKindSchema = z.enum(['IMAGE', 'VIDEO']);
export type ContentMediaKind = z.infer<typeof ContentMediaKindSchema>;

const TitleSchema = z.string().trim().min(1).max(200);
const CaptionSchema = z.string().max(5000);
const AsanaTaskGidSchema = z.string().trim().regex(/^[0-9]{1,32}$/, 'Identificador de tarefa do Asana invalido.');

export const CreateContentItemRequestSchema = z.object({
  clientId: IdSchema,
  title: TitleSchema,
  format: ContentFormatSchema,
  caption: CaptionSchema.default(''),
  asanaTaskGid: AsanaTaskGidSchema.nullable().optional(),
  deliverablePieceId: IdSchema.nullable().optional(),
});
export type CreateContentItemRequest = z.infer<typeof CreateContentItemRequestSchema>;

export const UpdateContentItemRequestSchema = z.object({
  title: TitleSchema.optional(),
  format: ContentFormatSchema.optional(),
  caption: CaptionSchema.optional(),
  asanaTaskGid: AsanaTaskGidSchema.nullable().optional(),
  deliverablePieceId: IdSchema.nullable().optional(),
  /** Controle otimista: updatedAt da versao atual vista pela tela. */
  expectedUpdatedAt: z.string().min(1).optional(),
});
export type UpdateContentItemRequest = z.infer<typeof UpdateContentItemRequestSchema>;

/* ==========================================================================
   F8-2 (DEC-F8-004) - Aprovacao do cliente por link seguro (N1: identificacao declarada)
   ========================================================================== */

export const ApprovalChannelSchema = z.enum(['WHATSAPP', 'EMAIL', 'OTHER']);
export const ApprovalDecisionKindSchema = z.enum(['APPROVED', 'CHANGES_REQUESTED']);

export const CreateApprovalLinkRequestSchema = z.object({
  /** 1 a 30 dias; padrao 7 (D3). */
  expiresInDays: z.number().int().min(1).max(30).optional(),
  recipientLabel: z.string().trim().max(120).nullable().optional(),
  channel: ApprovalChannelSchema.default('OTHER'),
});
export type CreateApprovalLinkRequest = z.infer<typeof CreateApprovalLinkRequestSchema>;

export const RevokeApprovalLinkRequestSchema = z.object({
  reason: z.string().trim().max(300).nullable().optional(),
});
export type RevokeApprovalLinkRequest = z.infer<typeof RevokeApprovalLinkRequestSchema>;

/** Corpo das chamadas PUBLICAS: o token vai no corpo (nunca na URL da API), para nao aparecer em logs de acesso. */
export const PublicApprovalViewRequestSchema = z.object({ token: z.string().min(20).max(200) });

export const PublicApprovalDecisionRequestSchema = z.object({
  token: z.string().min(20).max(200),
  decision: ApprovalDecisionKindSchema,
  comment: z.string().trim().max(2000).nullable().optional(),
  approverName: z.string().trim().max(120),
  approverContact: z.string().trim().max(160),
  authorityDeclared: z.boolean(),
  /** Hash do conteudo que a pessoa viu; o servidor recusa se a versao mudou. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PublicApprovalDecisionRequest = z.infer<typeof PublicApprovalDecisionRequestSchema>;

/* ==========================================================================
   F8-3 (DEC-F8-007) - Contador de Entregas por estagio (somente leitura).
   Publicados: sem confirmacao confiavel nesta fatia -> null (NOT_INTEGRATED), nunca 0.
   ========================================================================== */

export const ContentStageSchema = z.enum(['RECEIVED', 'SENT', 'APPROVED']);
export type ContentStage = z.infer<typeof ContentStageSchema>;

export const ContentStagesQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competencia invalida (use AAAA-MM).'),
});

export interface ContentStageItem {
  id: string;
  title: string;
  format: ContentFormat;
  stage: ContentStage;
  periodSource: 'PLAN' | 'FIRST_FILE';
  receivedAt: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  /** F8-5b: primeira publicacao confirmada (null sem publicacao ou com o envio desligado). */
  publishedAt: string | null;
  /** Situacao da versao atual (ex.: nova versao em preparacao depois de aprovada). */
  currentStatus: 'NOT_SENT' | 'AWAITING_CLIENT' | 'APPROVED' | 'CHANGES_REQUESTED' | 'LINK_EXPIRED' | 'LINK_REVOKED';
}

export interface ContentStagesResponse {
  clientId: string;
  period: string;
  timeZone: string;
  counts: {
    received: number;
    sent: number;
    approved: number;
    /** F8-5b (D-F85-2): so publicacao confirmada; null (nunca 0) com o envio desligado no ambiente. */
    published: number | null;
    publishedSource: 'NOT_INTEGRATED' | 'CONFIRMED_PUBLICATION';
  };
  items: ContentStageItem[];
}

/* ==========================================================================
   F8-4a (DEC-F8-023) - Agendamento pela versao aprovada (piloto: Instagram).
   Horario sempre com fuso explicito; antecedencia minima validada no dominio.
   ========================================================================== */

const ScheduledAtSchema = z.string().trim().min(16).max(40);

export const RequestPublicationSchema = z.object({
  socialAccountId: z.string().trim().min(1).max(100),
  scheduledAt: ScheduledAtSchema,
});
export type RequestPublication = z.infer<typeof RequestPublicationSchema>;

export const ReschedulePublicationSchema = z.object({ scheduledAt: ScheduledAtSchema });
export type ReschedulePublication = z.infer<typeof ReschedulePublicationSchema>;
