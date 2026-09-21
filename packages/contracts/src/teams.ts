import { z } from 'zod';
import { IdSchema } from './http.js';

export const CreateTeamRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nome da equipe é obrigatório'),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const UpdateTeamRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nome da equipe não pode ser vazio').optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>;

export const ReplaceTeamMembersRequestSchema = z.object({
  membershipIds: z.array(z.string().min(1)).refine(
    (items) => new Set(items).size === items.length,
    { message: 'membershipIds não pode conter duplicatas' }
  ),
});
export type ReplaceTeamMembersRequest = z.infer<typeof ReplaceTeamMembersRequestSchema>;

export const ReplaceTeamClientsRequestSchema = z.object({
  clientIds: z.array(z.string().min(1)).refine(
    (items) => new Set(items).size === items.length,
    { message: 'clientIds não pode conter duplicatas' }
  ),
});
export type ReplaceTeamClientsRequest = z.infer<typeof ReplaceTeamClientsRequestSchema>;

export const TeamSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  memberCount: z.number().int().nonnegative(),
  clientCount: z.number().int().nonnegative(),
});
export type TeamSummary = z.infer<typeof TeamSummarySchema>;

export const TeamMemberItemSchema = z.object({
  membershipId: IdSchema,
  userId: IdSchema,
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']),
  membershipStatus: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']),
});
export type TeamMemberItem = z.infer<typeof TeamMemberItemSchema>;

export const TeamClientItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  status: z.string(),
});
export type TeamClientItem = z.infer<typeof TeamClientItemSchema>;

export const TeamDetailSchema = z.object({
  id: IdSchema,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  members: z.array(TeamMemberItemSchema),
  clients: z.array(TeamClientItemSchema),
});
export type TeamDetail = z.infer<typeof TeamDetailSchema>;
