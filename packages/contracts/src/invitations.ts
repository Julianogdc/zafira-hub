import { z } from 'zod';
import { IdSchema } from './http.js';

export const InvitationDetailsSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
  acceptPath: z.string(),
});
export type InvitationDetails = z.infer<typeof InvitationDetailsSchema>;

export const InspectInvitationRequestSchema = z.object({
  token: z.string().trim().min(1, 'Token é obrigatório'),
});
export type InspectInvitationRequest = z.infer<typeof InspectInvitationRequestSchema>;

export const InspectInvitationResponseSchema = z.object({
  valid: z.literal(true),
  organization: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  invitedUser: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']),
  expiresAt: z.string(),
  requiresPassword: z.boolean(),
});
export type InspectInvitationResponse = z.infer<typeof InspectInvitationResponseSchema>;

export const AcceptInvitationRequestSchema = z.object({
  token: z.string().trim().min(1, 'Token é obrigatório'),
  password: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres').optional(),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const AcceptInvitationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

export const ReissueInvitationResponseSchema = z.object({
  membershipId: IdSchema,
  invitation: InvitationDetailsSchema,
});
export type ReissueInvitationResponse = z.infer<typeof ReissueInvitationResponseSchema>;
