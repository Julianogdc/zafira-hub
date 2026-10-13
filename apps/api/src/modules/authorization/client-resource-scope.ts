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

export interface ClientInScopeResult {
  id: string;
  name: string;
}

/**
 * Consulta um cliente por ID aplicando estritamente o Client Resource Scope.
 * Retorna { id, name } se o cliente pertencer à organização e estiver no escopo do membro.
 * Retorna null se não encontrado, pertencente a outra organização ou fora da carteira do membro.
 */
export async function findClientInResourceScope(
  prisma: { client: { findFirst: (args: any) => Promise<any> } },
  ctx: ClientScopeContext,
  clientId: string
): Promise<ClientInScopeResult | null> {
  if (!clientId || typeof clientId !== 'string') {
    return null;
  }

  const scopeWhere = buildClientResourceScopeWhere(ctx);
  const client = await prisma.client.findFirst({
    where: {
      AND: [
        scopeWhere,
        { id: clientId },
      ],
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!client) {
    return null;
  }

  return {
    id: client.id,
    name: client.name,
  };
}
