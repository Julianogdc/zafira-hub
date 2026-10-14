import { z } from 'zod';
import { IdSchema } from './http.js';

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: IdSchema.optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const OrganizationSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']),
  /** Fuso IANA da organização (DEC-F6-005); padrão America/Sao_Paulo. */
  timezone: z.string().optional(),
});

export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const AuthUserSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable().optional(),
  status: z.string(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionSchema = z.object({
  authenticated: z.literal(true),
  user: AuthUserSchema,
  organizations: z.array(OrganizationSummarySchema),
  activeOrganizationId: IdSchema.nullable(),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const UnauthenticatedSessionSchema = z.object({
  authenticated: z.literal(false),
});

export type UnauthenticatedSession = z.infer<typeof UnauthenticatedSessionSchema>;

export const SessionResponseSchema = z.discriminatedUnion('authenticated', [
  AuthSessionSchema,
  UnauthenticatedSessionSchema,
]);

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const EffectiveCapabilitiesPermissionsSchema = z.object({
  'projects.view': z.boolean(),
  // F6-IMP.8 (DEC-F6-003): botão "Atualizar agora" do histórico do Asana
  'projects.sync': z.boolean(),
  'deliverables.view': z.boolean(),
  'deliverables.plan': z.boolean(),
  // F6-IMP.7B (DEC-F6-002)
  'deliverables.register': z.boolean(),
  'deliverables.adjust_target': z.boolean(),
  'deliverables.complete': z.boolean(),
  'deliverables.reopen': z.boolean(),
  // F7-1b (DEC-F7-005): apenas para a interface; a autorização real é sempre do backend
  'onboarding.view': z.boolean(),
  'onboarding.manage_templates': z.boolean(),
  'onboarding.manage_functions': z.boolean(),
  'onboarding.start': z.boolean(),
  'onboarding.execute': z.boolean(),
  'onboarding.override': z.boolean(),
  'onboarding.cancel': z.boolean(),
  // F7-3b (DEC-F7-013): apenas para a interface; a autorizacao real e sempre do backend
  'calendar.view': z.boolean(),
  'calendar.link': z.boolean(),
  'calendar.manage_connections': z.boolean(),
  'calendar.view_all': z.boolean(),
  // F7-4b (DEC-F7-017): apenas para a interface; a autorizacao real e sempre do backend
  'content.view': z.boolean(),
  'content.create': z.boolean(),
  'content.send_to_client': z.boolean(),
  'content.schedule': z.boolean(),
  'automation.manage': z.boolean(),
  'automation.view': z.boolean(),
});

export type EffectiveCapabilitiesPermissions = z.infer<typeof EffectiveCapabilitiesPermissionsSchema>;

export const CapabilitiesResponseSchema = z.object({
  organizationId: IdSchema,
  permissions: EffectiveCapabilitiesPermissionsSchema,
});

export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

