import { z } from 'zod';
import { IdSchema } from './http.js';
import { StepKeySchema } from './onboarding.js';

/* ==========================================================================
   F7-2a — Execução do onboarding por cliente (DEC-F7-008).
   Gatilho de contrato assinado: reservado (F9). Hoje só MANUAL.
   ========================================================================== */

export const OnboardingExecutionStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export type OnboardingExecutionStatus = z.infer<typeof OnboardingExecutionStatusSchema>;

export const OnboardingStepRunStatusSchema = z.enum(['WAITING', 'READY', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'CANCELLED']);
export type OnboardingStepRunStatus = z.infer<typeof OnboardingStepRunStatusSchema>;

export const OnboardingStartTriggerSchema = z.enum(['MANUAL']);
export type OnboardingStartTrigger = z.infer<typeof OnboardingStartTriggerSchema>;

export const OnboardingAssigneeSourceSchema = z.enum(['NONE', 'MODEL_MEMBER', 'FUNCTION_RESOLVED', 'MANUAL']);
export type OnboardingAssigneeSource = z.infer<typeof OnboardingAssigneeSourceSchema>;

const ReasonSchema = z.string().trim().min(3, 'Justificativa obrigatória (mínimo 3 caracteres)').max(500);

export const StartOnboardingExecutionRequestSchema = z.object({
  clientId: IdSchema,
  templateId: IdSchema,
  /** Idempotência opcional: repetir devolve a mesma execução. */
  requestId: z.string().trim().min(8).max(64).optional(),
  /** Escolha do gestor para etapas de função com 0 ou vários candidatos. */
  assignments: z.record(StepKeySchema, IdSchema).default({}),
});
export type StartOnboardingExecutionRequest = z.infer<typeof StartOnboardingExecutionRequestSchema>;

export const CompleteOnboardingStepRequestSchema = z.object({
  confirm: z.boolean().default(false),
  evidenceLink: z.string().trim().url('Informe um link válido').max(2000).nullable().optional(),
  evidenceNote: z.string().trim().max(2000).nullable().optional(),
  asanaProjectGid: z.string().trim().max(128).nullable().optional(),
  /** Evento do Calendar JA vinculado localmente ao cliente (F7-3c). */
  calendarEventId: z.string().trim().max(64).nullable().optional(),
});
export type CompleteOnboardingStepRequest = z.infer<typeof CompleteOnboardingStepRequestSchema>;

export const BlockOnboardingStepRequestSchema = z.object({ reason: ReasonSchema });
export const UnblockOnboardingStepRequestSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() });
export const SkipOnboardingStepRequestSchema = z.object({ reason: ReasonSchema });
export const ReassignOnboardingStepRequestSchema = z.object({ memberId: IdSchema, reason: ReasonSchema });
export const CancelOnboardingExecutionRequestSchema = z.object({ reason: ReasonSchema });
/** `reason` é a justificativa aplicada às etapas abertas dispensadas na conclusão antecipada (P3). */
export const CompleteOnboardingExecutionRequestSchema = z.object({ reason: ReasonSchema.optional() });

export type BlockOnboardingStepRequest = z.infer<typeof BlockOnboardingStepRequestSchema>;
export type UnblockOnboardingStepRequest = z.infer<typeof UnblockOnboardingStepRequestSchema>;
export type SkipOnboardingStepRequest = z.infer<typeof SkipOnboardingStepRequestSchema>;
export type ReassignOnboardingStepRequest = z.infer<typeof ReassignOnboardingStepRequestSchema>;
export type CancelOnboardingExecutionRequest = z.infer<typeof CancelOnboardingExecutionRequestSchema>;
export type CompleteOnboardingExecutionRequest = z.infer<typeof CompleteOnboardingExecutionRequestSchema>;
