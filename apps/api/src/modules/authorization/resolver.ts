import { prisma } from '../../lib/prisma.js';
import { evaluatePermission, PermissionCode, RoleType } from '@zafira/domain';

export interface ResolveAuthorizationContextParams {
  userId: string;
  activeOrganizationId: string;
  permissionCode: PermissionCode;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
  membershipId?: string;
  organizationId?: string;
  role?: RoleType;
}

export async function resolveAuthorizationContext({
  userId,
  activeOrganizationId,
  permissionCode
}: ResolveAuthorizationContextParams): Promise<AuthorizationResult> {
  if (!activeOrganizationId) {
    return { allowed: false, reason: 'NO_ACTIVE_ORGANIZATION' };
  }

  // Find membership mapping this exact user to this exact active organization
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: activeOrganizationId,
        userId: userId
      }
    },
    include: {
      permissions: {
        where: { permissionCode }
      }
    }
  });

  if (!membership) {
    return { allowed: false, reason: 'NO_MEMBERSHIP_IN_ACTIVE_ORGANIZATION' };
  }

  const role = membership.role as RoleType;
  const override = membership.permissions.length > 0 ? membership.permissions[0].allowed : undefined;

  const evaluation = evaluatePermission({
    role,
    permission: permissionCode,
    override
  });

  return {
    allowed: evaluation.allowed,
    reason: evaluation.reason,
    membershipId: membership.id,
    organizationId: membership.organizationId,
    role
  };
}
