import { z } from 'zod';
import { IdSchema } from './http.js';

export const InviteUserRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  email: z.string().trim().email('E-mail inválido'),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const UpdateUserRoleRequestSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']),
});
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequestSchema>;

export const UpdateUserStatusRequestSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusRequestSchema>;

export const AssignClientsRequestSchema = z.object({
  clientIds: z.array(z.string().min(1)).refine(
    (items) => new Set(items).size === items.length,
    { message: 'clientIds não pode conter duplicatas' }
  ),
});
export type AssignClientsRequest = z.infer<typeof AssignClientsRequestSchema>;

export const PermissionChangeItemSchema = z.object({
  permissionCode: z.string().min(1),
  allowed: z.boolean().nullable(),
});
export type PermissionChangeItem = z.infer<typeof PermissionChangeItemSchema>;

export const UpdateUserPermissionsRequestSchema = z.object({
  changes: z.array(PermissionChangeItemSchema).min(1).refine(
    (items) => new Set(items.map((i) => i.permissionCode)).size === items.length,
    { message: 'permissionCode não pode ser duplicado' }
  ),
});
export type UpdateUserPermissionsRequest = z.infer<typeof UpdateUserPermissionsRequestSchema>;

export const ListUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']).optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const UserSummarySchema = z.object({
  membershipId: IdSchema,
  userId: IdSchema,
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable().optional(),
  accountStatus: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']),
  membershipStatus: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  clientAssignmentCount: z.number().int().nonnegative(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const ListUsersResponseSchema = z.object({
  items: z.array(UserSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

export const AssignedClientItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
});
export type AssignedClientItem = z.infer<typeof AssignedClientItemSchema>;

export const UserPermissionMatrixItemSchema = z.object({
  code: z.string(),
  area: z.string(),
  description: z.string().optional(),
  roleGranted: z.boolean(),
  override: z.boolean().nullable(),
  effective: z.boolean(),
});
export type UserPermissionMatrixItem = z.infer<typeof UserPermissionMatrixItemSchema>;

export const UserDetailSchema = z.object({
  membershipId: IdSchema,
  userId: IdSchema,
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable().optional(),
  accountStatus: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']),
  membershipStatus: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  assignedClients: z.array(AssignedClientItemSchema),
  overrides: z.array(
    z.object({
      permissionCode: z.string(),
      allowed: z.boolean(),
    })
  ),
  permissions: z.array(UserPermissionMatrixItemSchema),
});
export type UserDetail = z.infer<typeof UserDetailSchema>;
