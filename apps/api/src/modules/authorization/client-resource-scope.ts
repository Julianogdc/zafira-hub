import { Prisma } from '@prisma/client';
import { RoleType } from '@zafira/domain';

export interface ClientScopeContext {
  organizationId: string;
  membershipId: string;
  role: RoleType;
}

/**
 * Constrói a cláusula `where` do Prisma para aplicação de Resource Scope em Clientes.
 *
 * Regras:
 * - ADMIN: escopo irrestrito dentro da organização ativa.
 * - MANAGER / MEMBER: união entre Direct Assignment (UserClientAssignment) e
 *   Team Assignment (TeamClientAssignment) via Equipe ativa (isActive = true).
 */
export function buildClientResourceScopeWhere(ctx: ClientScopeContext): Prisma.ClientWhereInput {
  if (ctx.role === 'ADMIN') {
    return {
      organizationId: ctx.organizationId,
    };
  }

  return {
    organizationId: ctx.organizationId,
    OR: [
      {
        assignedMembers: {
          some: {
            organizationMemberId: ctx.membershipId,
          },
        },
      },
      {
        teamAssignments: {
          some: {
            team: {
              isActive: true,
              members: {
                some: {
                  organizationMemberId: ctx.membershipId,
                },
              },
            },
          },
        },
      },
    ],
  };
}
