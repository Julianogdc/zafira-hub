import { z } from 'zod';

/* ==========================================================================
   F7-4a - Automacoes n8n do onboarding (DEC-F7-016). Infraestrutura generica.
   O Hub NUNCA escreve no Asana por estas automacoes (D1).
   ========================================================================== */

export const AutomationOutboxStatusSchema = z.enum(['PENDING', 'SENT', 'RETRYING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'DEAD']);
export type AutomationOutboxStatus = z.infer<typeof AutomationOutboxStatusSchema>;

export const AutomationEventTypeSchema = z.enum(['STEP_AUTOMATION', 'EXECUTION_STARTED', 'EXECUTION_COMPLETED', 'EXECUTION_CANCELLED']);
export type AutomationEventType = z.infer<typeof AutomationEventTypeSchema>;

export const AutomationFlowKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Identificador invalido (minusculas, numeros, _ ou -; ate 64).');

/** O segredo e informado pelo administrador (gerado no n8n); nunca e devolvido. */
export const SetupAutomationConnectionRequestSchema = z.object({
  secret: z.string().min(32, 'O segredo deve ter ao menos 32 caracteres').max(200),
  timeoutHours: z.number().int().min(1).max(168).default(24),
  maxAttempts: z.number().int().min(1).max(10).default(6),
});
export type SetupAutomationConnectionRequest = z.infer<typeof SetupAutomationConnectionRequestSchema>;

export const CreateAutomationFlowRequestSchema = z.object({
  key: AutomationFlowKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  webhookUrl: z.string().trim().url().max(500),
  enabled: z.boolean().default(true),
  subscribeLifecycle: z.boolean().default(false),
  includeClientName: z.boolean().default(false),
});
export type CreateAutomationFlowRequest = z.infer<typeof CreateAutomationFlowRequestSchema>;

export const UpdateAutomationFlowRequestSchema = CreateAutomationFlowRequestSchema.omit({ key: true }).partial();
export type UpdateAutomationFlowRequest = z.infer<typeof UpdateAutomationFlowRequestSchema>;

export const AutomationCallbackRequestSchema = z.object({
  idempotencyKey: z.string().min(16).max(128),
  callbackId: z.string().min(8).max(128),
  status: z.enum(['SUCCEEDED', 'FAILED']),
  resultCode: z.string().max(64).nullable().optional(),
  message: z.string().max(300).nullable().optional(),
  externalRefs: z
    .array(z.object({ type: z.string().max(40), label: z.string().max(120), url: z.string().url().max(1000) }))
    .max(5)
    .default([]),
});
export type AutomationCallbackRequest = z.infer<typeof AutomationCallbackRequestSchema>;

export const ResendAutomationRequestSchema = z.object({
  mode: z.enum(['RETRY', 'REDO']).default('RETRY'),
  reason: z.string().trim().min(3, 'Justificativa obrigatoria (minimo 3 caracteres)').max(500),
});
export type ResendAutomationRequest = z.infer<typeof ResendAutomationRequestSchema>;
