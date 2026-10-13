import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './http.js';

/* ==========================================================================
   F7-1a — Construtor de onboarding configurável (DEC-F7-004, DEC-F7-005)
   Catálogo FECHADO de condições de conclusão (B1). Nada de motor livre de regras.
   ========================================================================== */

export const OnboardingTemplateScopeKindSchema = z.enum(['GENERAL', 'SERVICE', 'PACKAGE', 'CLIENT_TYPE']);
export type OnboardingTemplateScopeKind = z.infer<typeof OnboardingTemplateScopeKindSchema>;

export const OnboardingTemplateStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type OnboardingTemplateStatus = z.infer<typeof OnboardingTemplateStatusSchema>;

export const OnboardingVersionStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);
export type OnboardingVersionStatus = z.infer<typeof OnboardingVersionStatusSchema>;

/** AUTOMATION fica reservado e indisponível; CALENDAR_EVENT só na F7-3. */
export const OnboardingStepKindSchema = z.enum(['MANUAL', 'CONFIRM_ASANA_PROJECT', 'CALENDAR_EVENT', 'AUTOMATION']);
export type OnboardingStepKind = z.infer<typeof OnboardingStepKindSchema>;

export const OnboardingAssigneeModeSchema = z.enum(['NONE', 'FUNCTION', 'MEMBER']);
export type OnboardingAssigneeMode = z.infer<typeof OnboardingAssigneeModeSchema>;

export const OnboardingDueAnchorSchema = z.enum(['START', 'RELEASED']);
export type OnboardingDueAnchor = z.infer<typeof OnboardingDueAnchorSchema>;

export const OnboardingEvidenceKindSchema = z.enum(['NONE', 'LINK', 'NOTE']);
export type OnboardingEvidenceKind = z.infer<typeof OnboardingEvidenceKindSchema>;

/** Catálogo fechado (B1). Novas condições só por nova DEC e nova versão do produto. */
export const OnboardingCompletionConditionSchema = z.enum([
  'CONFIRMATION',
  'EVIDENCE_PROVIDED',
  'ASANA_PROJECT_LINKED',
  'CALENDAR_EVENT_LINKED',
  // F7-4a (DEC-F7-016): so resultado SUCCEEDED autenticado de pedido autorizado conclui a etapa AUTOMATION
  'AUTOMATION_SUCCEEDED',
]);
export type OnboardingCompletionCondition = z.infer<typeof OnboardingCompletionConditionSchema>;

export const StepKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador de etapa inválido (use letras, números, _ ou -; até 64).');

export const OnboardingStepInputSchema = z.object({
  stepKey: StepKeySchema,
  title: z.string().trim().max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: OnboardingStepKindSchema.default('MANUAL'),
  assigneeMode: OnboardingAssigneeModeSchema.default('NONE'),
  functionId: IdSchema.nullable().optional(),
  memberId: IdSchema.nullable().optional(),
  dueBusinessDays: z.number().int().min(0).max(365).nullable().optional(),
  dueAnchor: OnboardingDueAnchorSchema.default('RELEASED'),
  evidenceKind: OnboardingEvidenceKindSchema.default('NONE'),
  evidenceRequired: z.boolean().default(false),
  completionCondition: OnboardingCompletionConditionSchema.default('CONFIRMATION'),
  blocksCompletion: z.boolean().default(false),
  dependsOn: z.array(StepKeySchema).max(50).default([]),
  /** Fluxo (da lista da organizacao) acionado por etapa AUTOMATION (F7-4a). */
  automationKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Identificador de fluxo invalido (minusculas, numeros, _ ou -).')
    .nullable()
    .optional(),
});
export type OnboardingStepInput = z.infer<typeof OnboardingStepInputSchema>;

export const CreateOnboardingTemplateRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nome do modelo é obrigatório').max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  scopeKind: OnboardingTemplateScopeKindSchema.default('GENERAL'),
  scopeLabel: z.string().trim().max(120).nullable().optional(),
});
export type CreateOnboardingTemplateRequest = z.infer<typeof CreateOnboardingTemplateRequestSchema>;

export const UpdateOnboardingTemplateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable(),
    scopeKind: OnboardingTemplateScopeKindSchema,
    scopeLabel: z.string().trim().max(120).nullable(),
  })
  .partial();
export type UpdateOnboardingTemplateRequest = z.infer<typeof UpdateOnboardingTemplateRequestSchema>;

/** Substitui todas as etapas do RASCUNHO. A ordem do array define a posição. */
export const SaveOnboardingDraftRequestSchema = z.object({
  expectedUpdatedAt: IsoDateTimeSchema,
  steps: z.array(OnboardingStepInputSchema).max(100),
});
export type SaveOnboardingDraftRequest = z.infer<typeof SaveOnboardingDraftRequestSchema>;

export const PublishOnboardingVersionRequestSchema = z.object({
  expectedUpdatedAt: IsoDateTimeSchema,
  changeNote: z.string().trim().min(3, 'Nota da versão obrigatória (mínimo 3 caracteres)').max(500),
});
export type PublishOnboardingVersionRequest = z.infer<typeof PublishOnboardingVersionRequestSchema>;

export const CreateOrganizationFunctionRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nome da função é obrigatório').max(80),
});
export type CreateOrganizationFunctionRequest = z.infer<typeof CreateOrganizationFunctionRequestSchema>;

export const UpdateOrganizationFunctionRequestSchema = z
  .object({ name: z.string().trim().min(1).max(80), isActive: z.boolean() })
  .partial();
export type UpdateOrganizationFunctionRequest = z.infer<typeof UpdateOrganizationFunctionRequestSchema>;

export const SetFunctionMembersRequestSchema = z.object({
  memberIds: z.array(IdSchema).max(200),
});
export type SetFunctionMembersRequest = z.infer<typeof SetFunctionMembersRequestSchema>;
