import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './http.js';

/* ==========================================================================
   1. ENUMS E VALIDADORES BÁSICOS
   ========================================================================== */

export const DeliverablePlanStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'CLOSED',
  'CANCELLED'
]);
export type DeliverablePlanStatus = z.infer<typeof DeliverablePlanStatusSchema>;

export const DeliverableItemStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'DELIVERED',
  'CANCELLED'
]);
export type DeliverableItemStatus = z.infer<typeof DeliverableItemStatusSchema>;

export const DeliverableLinkTypeSchema = z.enum([
  'ASANA_TASK',
  'CONTENT_ITEM',
  'EXTERNAL_URL',
  'OTHER'
]);
export type DeliverableLinkType = z.infer<typeof DeliverableLinkTypeSchema>;

export const DeliverableEventTypeSchema = z.enum([
  'PLAN_CREATED',
  'STATUS_CHANGED',
  'TARGET_ADJUSTED',
  'ITEM_ADDED',
  'ITEM_REMOVED',
  'LINK_ATTACHED',
  'LINK_DETACHED',
  'PLAN_CLOSED',
  'PLAN_REOPENED',
  'ITEM_DELIVERED',
  'PIECE_ADDED',
  'PIECE_ADVANCED',
  'PIECE_REVERTED',
  'PIECE_CANCELLED'
]);
export type DeliverableEventType = z.infer<typeof DeliverableEventTypeSchema>;

/**
 * Taxonomia de serviços da Zafira (DEC-F6-002).
 * CONTEUDO_SOCIAL é um pacote único: qualquer formato de CONTENT_FORMATS conta para a mesma meta.
 */
export const DELIVERABLE_SERVICE_TYPES = [
  'CONTEUDO_SOCIAL',
  'CRIATIVO_ADS',
  'RELATORIO_MENSAL',
  'CAPTACAO',
  'GESTAO_TRAFEGO',
  'OUTRO',
] as const;
export const DeliverableServiceTypeSchema = z.enum(DELIVERABLE_SERVICE_TYPES);
export type DeliverableServiceType = z.infer<typeof DeliverableServiceTypeSchema>;

export const DELIVERABLE_CONTENT_FORMATS = ['FEED', 'CARROSSEL', 'REELS', 'STORIES'] as const;
export const DeliverableContentFormatSchema = z.enum(DELIVERABLE_CONTENT_FORMATS);
export type DeliverableContentFormat = z.infer<typeof DeliverableContentFormatSchema>;

/** Etapas de cada peça: produzida → aprovada → entregue/postada (DEC-F6-002). */
export const DeliverablePieceStageSchema = z.enum(['PRODUCED', 'APPROVED', 'DELIVERED', 'CANCELLED']);
export type DeliverablePieceStage = z.infer<typeof DeliverablePieceStageSchema>;

export const PeriodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DeliverablePeriodSchema = z
  .string()
  .regex(PeriodPattern, 'Período deve estar no formato YYYY-MM');

/* ==========================================================================
   2. SCHEMAS DE ENTIDADES PRINCIPAIS
   ========================================================================== */

export const DeliverableLinkSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  itemId: IdSchema,
  linkType: DeliverableLinkTypeSchema,
  externalId: z.string().nullable().optional(),
  url: z.string().url('URL inválida').nullable().optional(),
  title: z.string().min(1, 'Título do link é obrigatório'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: IsoDateTimeSchema,
});
export type DeliverableLink = z.infer<typeof DeliverableLinkSchema>;

export const DeliverablePieceSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  itemId: IdSchema,
  title: z.string().min(1),
  format: DeliverableContentFormatSchema.nullable().optional(),
  stage: DeliverablePieceStageSchema,
  url: z.string().nullable().optional(),
  producedAt: IsoDateTimeSchema,
  producedByName: z.string().nullable().optional(),
  approvedAt: IsoDateTimeSchema.nullable().optional(),
  approvedByName: z.string().nullable().optional(),
  deliveredAt: IsoDateTimeSchema.nullable().optional(),
  deliveredByName: z.string().nullable().optional(),
  cancelledAt: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type DeliverablePiece = z.infer<typeof DeliverablePieceSchema>;

export const DeliverableItemSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  planId: IdSchema,
  serviceType: z.string().min(1, 'Tipo de serviço é obrigatório'),
  title: z.string().min(1, 'Título do item é obrigatório'),
  description: z.string().nullable().optional(),
  targetQuantity: z.number().int().min(1, 'Meta deve ser um número inteiro >= 1'),
  deliveredQuantity: z.number().int().min(0, 'Quantidade entregue deve ser >= 0'),
  isExtra: z.boolean().default(false),
  status: DeliverableItemStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  links: z.array(DeliverableLinkSchema).optional(),
  pieces: z.array(DeliverablePieceSchema).optional(),
});
export type DeliverableItem = z.infer<typeof DeliverableItemSchema>;

export const DeliverablePlanSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  clientId: IdSchema,
  period: DeliverablePeriodSchema,
  title: z.string().min(1, 'Título do plano é obrigatório'),
  description: z.string().nullable().optional(),
  status: DeliverablePlanStatusSchema,
  closedAt: IsoDateTimeSchema.nullable().optional(),
  closedByUserId: IdSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  items: z.array(DeliverableItemSchema).optional(),
});
export type DeliverablePlan = z.infer<typeof DeliverablePlanSchema>;

export const DeliverableEventSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  planId: IdSchema,
  itemId: IdSchema.nullable().optional(),
  eventType: DeliverableEventTypeSchema,
  actorUserId: IdSchema,
  reason: z.string().nullable().optional(),
  before: z.unknown().nullable().optional(),
  after: z.unknown().nullable().optional(),
  createdAt: IsoDateTimeSchema,
});
export type DeliverableEvent = z.infer<typeof DeliverableEventSchema>;

export const DeliverableTemplateSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  title: z.string().min(1, 'Título do template é obrigatório'),
  serviceType: z.string().min(1, 'Tipo de serviço é obrigatório'),
  defaultQuantity: z.number().int().min(1, 'Quantidade padrão deve ser >= 1'),
  active: z.boolean().default(true),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type DeliverableTemplate = z.infer<typeof DeliverableTemplateSchema>;

/* ==========================================================================
   3. SCHEMAS DE AÇÕES E MUTATIONS (CONTRATOS DE API)
   ========================================================================== */

const TrimmedText = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const ReasonSchema = z.string().trim().min(3, 'Justificativa obrigatória (mínimo 3 caracteres)').max(1000);
const OptionalHttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url('URL inválida')
  .refine((value) => /^https:\/\//i.test(value), 'A URL deve começar com https://')
  .optional();

export const CreateDeliverableItemRequestSchema = z.object({
  serviceType: DeliverableServiceTypeSchema,
  title: TrimmedText(200, 'Título do item é obrigatório'),
  description: z.string().trim().max(2000).optional(),
  targetQuantity: z.number().int().min(1, 'Meta deve ser um número inteiro >= 1').max(500),
  isExtra: z.boolean().optional().default(false),
});
export type CreateDeliverableItemRequest = z.infer<typeof CreateDeliverableItemRequestSchema>;

export const CreateDeliverablePlanRequestSchema = z.object({
  period: DeliverablePeriodSchema,
  title: TrimmedText(200, 'Título do plano é obrigatório'),
  description: z.string().trim().max(2000).optional(),
  items: z.array(CreateDeliverableItemRequestSchema).min(1, 'O plano precisa de ao menos uma linha contratada').max(30),
});
export type CreateDeliverablePlanRequest = z.infer<typeof CreateDeliverablePlanRequestSchema>;

export const CreateDeliverablePieceRequestSchema = z.object({
  title: TrimmedText(200, 'Título da peça é obrigatório'),
  format: DeliverableContentFormatSchema.optional(),
  url: OptionalHttpsUrl,
});
export type CreateDeliverablePieceRequest = z.infer<typeof CreateDeliverablePieceRequestSchema>;

/** expectedStage: etapa que a tela mostrava; se a peça já mudou (clique duplo, outra pessoa), a API recusa com 409. */
export const AdvanceDeliverablePieceRequestSchema = z.object({
  expectedStage: DeliverablePieceStageSchema.optional(),
  url: OptionalHttpsUrl,
});
export type AdvanceDeliverablePieceRequest = z.infer<typeof AdvanceDeliverablePieceRequestSchema>;

export const RevertDeliverablePieceRequestSchema = z.object({
  expectedStage: DeliverablePieceStageSchema.optional(),
  reason: ReasonSchema,
});
export type RevertDeliverablePieceRequest = z.infer<typeof RevertDeliverablePieceRequestSchema>;

export const CancelDeliverablePieceRequestSchema = z.object({
  expectedStage: DeliverablePieceStageSchema.optional(),
  reason: ReasonSchema,
});
export type CancelDeliverablePieceRequest = z.infer<typeof CancelDeliverablePieceRequestSchema>;

export const AdjustDeliverableTargetRequestSchema = z.object({
  newTargetQuantity: z.number().int().min(1, 'Nova meta deve ser um número inteiro >= 1').max(500),
  reason: ReasonSchema,
});
export type AdjustDeliverableTargetRequest = z.infer<typeof AdjustDeliverableTargetRequestSchema>;

export const CloseDeliverablePlanRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type CloseDeliverablePlanRequest = z.infer<typeof CloseDeliverablePlanRequestSchema>;

export const ReopenDeliverablePlanRequestSchema = z.object({
  reason: ReasonSchema,
});
export type ReopenDeliverablePlanRequest = z.infer<typeof ReopenDeliverablePlanRequestSchema>;

export const AttachDeliverableEvidenceRequestSchema = z.object({
  linkType: DeliverableLinkTypeSchema,
  title: z.string().min(1, 'Título da evidência é obrigatório'),
  externalId: z.string().optional(),
  url: z.string().url('URL inválida').optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AttachDeliverableEvidenceRequest = z.infer<typeof AttachDeliverableEvidenceRequestSchema>;
