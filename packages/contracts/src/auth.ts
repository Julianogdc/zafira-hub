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
