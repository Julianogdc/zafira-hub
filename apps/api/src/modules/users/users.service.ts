import { PrismaClient } from '@prisma/client';
import { prisma as globalPrisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { isValidPermissionCode } from '@zafira/domain';
import {
  ListUsersQuery,
  InviteUserRequest,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  AssignClientsRequest,
  UpdateUserPermissionsRequest,
} from '@zafira/contracts';

export class UserAdminError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'UserAdminError';
  }
}

export class UsersService {
  constructor(private readonly db: PrismaClient = globalPrisma) {}

  async listMembers(organizationId: string, query: ListUsersQuery) {
    const limit = Math.min(Math.max(query.limit || 50, 1), 100);
    const where: any = { organizationId };

    if (query.role) {
      where.role = query.role;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.user = {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    if (query.cursor) {
      try {
        const decoded = Buffer.from(query.cursor, 'base64').toString('utf8');
        const [createdAtIso, id] = decoded.split('|');
        const cursorDate = new Date(createdAtIso);
        if (!isNaN(cursorDate.getTime()) && id) {
          where.AND = [
            ...(where.AND || []),
            {
              OR: [
                { createdAt: { lt: cursorDate } },
                {
                  createdAt: cursorDate,
                  id: { lt: id },
                },
              ],
            },
          ];
        }
      } catch {
        // Ignora cursor inválido
      }
    }

    const members = await this.db.organizationMember.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            status: true,
          },
        },
        _count: {
          select: {
            clientAssignments: true,
          },
        },
      },
    });

    const hasMore = members.length > limit;
    const itemsToReturn = hasMore ? members.slice(0, limit) : members;
    let nextCursor: string | null = null;
    if (hasMore && itemsToReturn.length > 0) {
      const last = itemsToReturn[itemsToReturn.length - 1];
      nextCursor = Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64');
    }

    const items = itemsToReturn.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      accountStatus: m.user.status,
      role: m.role,
      membershipStatus: m.status,
      createdAt: (m.createdAt || new Date()).toISOString(),
      updatedAt: (m.updatedAt || m.createdAt || new Date()).toISOString(),
      clientAssignmentCount: m._count?.clientAssignments ?? 0,
    }));

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  async getMemberDetail(organizationId: string, membershipId: string) {
    const member = await this.db.organizationMember.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: membershipId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        clientAssignments: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        permissions: {
          select: {
            permissionCode: true,
            allowed: true,
          },
        },
      },
    });

    if (!member) {
      throw new UserAdminError(404, 'USER_NOT_FOUND', 'Membro não encontrado nesta organização');
    }

    const [allPermissions, rolePermissions] = await Promise.all([
      this.db.permission.findMany({ orderBy: { code: 'asc' } }),
      this.db.rolePermission.findMany({ where: { role: member.role } }),
    ]);

    const rolePermMap = new Map<string, boolean>();
    for (const rp of rolePermissions) {
      rolePermMap.set(rp.permissionCode, rp.granted);
    }

    const memberOverrideMap = new Map<string, boolean>();
    for (const p of member.permissions) {
      memberOverrideMap.set(p.permissionCode, p.allowed);
    }

    const permissionsMatrix = allPermissions.map((p) => {
      const roleGranted = rolePermMap.get(p.code) ?? false;
      const override = memberOverrideMap.has(p.code) ? memberOverrideMap.get(p.code)! : null;
      const effective = override !== null ? override : roleGranted;

      return {
        code: p.code,
        area: p.area,
        description: p.description || undefined,
        roleGranted,
        override,
        effective,
      };
    });

    return {
      membershipId: member.id,
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      avatarUrl: member.user.avatarUrl,
      accountStatus: member.user.status,
      role: member.role,
      membershipStatus: member.status,
      createdAt: (member.createdAt || new Date()).toISOString(),
      updatedAt: (member.updatedAt || member.createdAt || new Date()).toISOString(),
      assignedClients: member.clientAssignments.map((ca) => ({
        id: ca.client.id,
        name: ca.client.name,
      })),
      overrides: member.permissions.map((op) => ({
        permissionCode: op.permissionCode,
        allowed: op.allowed,
      })),
      permissions: permissionsMatrix,
    };
  }

  async inviteUser(organizationId: string, actorUserId: string | null, data: InviteUserRequest) {
    return await this.db.$transaction(async (tx) => {
      const auditService = new AuditService(tx as PrismaClient);
      const email = data.email.trim().toLowerCase();
      const name = data.name.trim();

      const existingUser = await tx.user.findUnique({
        where: { email },
        include: {
          memberships: {
            where: { organizationId },
          },
        },
      });

      if (existingUser) {
        if (existingUser.status === 'INACTIVE') {
          throw new UserAdminError(409, 'USER_GLOBALLY_INACTIVE', 'Usuário inativo globalmente no sistema');
        }

        const existingMembership = existingUser.memberships[0];
        if (existingMembership) {
          if (existingMembership.status === 'ACTIVE') {
            throw new UserAdminError(409, 'USER_ALREADY_MEMBER', 'Usuário já é membro ativo desta organização');
          }
          if (existingMembership.status === 'INVITED') {
            throw new UserAdminError(409, 'INVITATION_ALREADY_PENDING', 'Já existe um convite pendente para este usuário nesta organização');
          }
          if (existingMembership.status === 'SUSPENDED') {
            throw new UserAdminError(409, 'USER_MEMBERSHIP_SUSPENDED', 'A participação deste usuário nesta organização está suspensa');
          }
        }

        const membership = await tx.organizationMember.create({
          data: {
            organizationId,
            userId: existingUser.id,
            role: 'MEMBER',
            status: 'INVITED',
          },
        });

        await auditService.record({
          organizationId,
          actorUserId,
          action: 'user.invited',
          entityType: 'OrganizationMember',
          entityId: membership.id,
          before: null,
          after: {
            userId: existingUser.id,
            email,
            role: 'MEMBER',
            status: 'INVITED',
          },
        });

        return {
          membershipId: membership.id,
          userId: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          role: membership.role,
          membershipStatus: membership.status,
          createdAt: membership.createdAt.toISOString(),
        };
      }

      const newUser = await tx.user.create({
        data: {
          name,
          email,
          status: 'INVITED',
          passwordHash: null,
        },
      });

      const membership = await tx.organizationMember.create({
        data: {
          organizationId,
          userId: newUser.id,
          role: 'MEMBER',
          status: 'INVITED',
        },
      });

      await auditService.record({
        organizationId,
        actorUserId,
        action: 'user.invited',
        entityType: 'OrganizationMember',
        entityId: membership.id,
        before: null,
        after: {
          userId: newUser.id,
          email,
          role: 'MEMBER',
          status: 'INVITED',
        },
      });

      return {
        membershipId: membership.id,
        userId: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: membership.role,
        membershipStatus: membership.status,
        createdAt: membership.createdAt.toISOString(),
      };
    });
  }

  async updateRole(
    organizationId: string,
    actorUserId: string | null,
    membershipId: string,
    data: UpdateUserRoleRequest
  ) {
    return await this.db.$transaction(async (tx) => {
      const auditService = new AuditService(tx as PrismaClient);
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_id: {
            organizationId,
            id: membershipId,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!member) {
        throw new UserAdminError(404, 'USER_NOT_FOUND', 'Membro não encontrado nesta organização');
      }

      if (member.role === 'ADMIN' && data.role !== 'ADMIN') {
        if (member.status === 'ACTIVE' && member.user.status === 'ACTIVE') {
          const activeAdminCount = await tx.organizationMember.count({
            where: {
              organizationId,
              role: 'ADMIN',
              status: 'ACTIVE',
              user: {
                status: 'ACTIVE',
              },
            },
          });

          if (activeAdminCount <= 1) {
            throw new UserAdminError(
              409,
              'LAST_ACTIVE_ADMIN',
              'Não é possível alterar a função do único administrador ativo da organização'
            );
          }
        }
      }

      const updated = await tx.organizationMember.update({
        where: { id: member.id },
        data: { role: data.role },
      });

      await auditService.record({
        organizationId,
        actorUserId,
        action: 'user.role_changed',
        entityType: 'OrganizationMember',
        entityId: member.id,
        before: { role: member.role },
        after: { role: data.role },
      });

      return {
        membershipId: updated.id,
        role: updated.role,
      };
    });
  }

  async updatePermissions(
    organizationId: string,
    actorUserId: string | null,
    membershipId: string,
    data: UpdateUserPermissionsRequest
  ) {
    return await this.db.$transaction(async (tx) => {
      const auditService = new AuditService(tx as PrismaClient);
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_id: {
            organizationId,
            id: membershipId,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              status: true,
            },
          },
          permissions: true,
        },
      });

      if (!member) {
        throw new UserAdminError(404, 'USER_NOT_FOUND', 'Membro não encontrado nesta organização');
      }

      for (const change of data.changes) {
        if (!isValidPermissionCode(change.permissionCode)) {
          throw new UserAdminError(
            400,
            'INVALID_PERMISSION_CODE',
            `Código de permissão inválido: ${change.permissionCode}`
          );
        }
      }

      const isDenyingUsersEditPermissions = data.changes.some(
        (c) => c.permissionCode === 'users.edit_permissions' && c.allowed === false
      );

      if (
        isDenyingUsersEditPermissions &&
        member.role === 'ADMIN' &&
        member.status === 'ACTIVE' &&
        member.user.status === 'ACTIVE'
      ) {
        const activeAdminCount = await tx.organizationMember.count({
          where: {
            organizationId,
            role: 'ADMIN',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
          },
        });

        if (activeAdminCount <= 1) {
          throw new UserAdminError(
            409,
            'LAST_ACTIVE_ADMIN_LOCKOUT',
            'Não é possível revogar users.edit_permissions do último administrador ativo da organização'
          );
        }
      }

      const beforeOverrides = member.permissions.map((p) => ({
        permissionCode: p.permissionCode,
        allowed: p.allowed,
      }));

      for (const change of data.changes) {
        if (change.allowed === null) {
          await tx.organizationMemberPermission.deleteMany({
            where: {
              organizationMemberId: member.id,
              permissionCode: change.permissionCode,
            },
          });
        } else {
          await tx.organizationMemberPermission.upsert({
            where: {
              organizationMemberId_permissionCode: {
                organizationMemberId: member.id,
                permissionCode: change.permissionCode,
              },
            },
            create: {
              organizationId,
              organizationMemberId: member.id,
              permissionCode: change.permissionCode,
              allowed: change.allowed,
            },
            update: {
              allowed: change.allowed,
            },
          });
        }
      }

      const finalOverrides = await tx.organizationMemberPermission.findMany({
        where: { organizationMemberId: member.id },
        select: { permissionCode: true, allowed: true },
      });

      await auditService.record({
        organizationId,
        actorUserId,
        action: 'permission.override_changed',
        entityType: 'OrganizationMember',
        entityId: member.id,
        before: { overrides: beforeOverrides },
        after: { overrides: finalOverrides },
      });

      return {
        membershipId: member.id,
        overrides: finalOverrides,
      };
    });
  }

  async assignClients(
    organizationId: string,
    actorUserId: string | null,
    membershipId: string,
    data: AssignClientsRequest
  ) {
    return await this.db.$transaction(async (tx) => {
      const auditService = new AuditService(tx as PrismaClient);
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_id: {
            organizationId,
            id: membershipId,
          },
        },
        include: {
          clientAssignments: true,
        },
      });

      if (!member) {
        throw new UserAdminError(404, 'USER_NOT_FOUND', 'Membro não encontrado nesta organização');
      }

      if (data.clientIds.length > 0) {
        const validClients = await tx.client.findMany({
          where: {
            organizationId,
            id: { in: data.clientIds },
          },
          select: { id: true },
        });

        if (validClients.length !== data.clientIds.length) {
          throw new UserAdminError(
            400,
            'CLIENT_NOT_IN_ORGANIZATION',
            'Um ou mais clientes não pertencem a esta organização ou não existem'
          );
        }
      }

      const beforeClientIds = member.clientAssignments.map((a) => a.clientId);

      await tx.userClientAssignment.deleteMany({
        where: { organizationMemberId: member.id },
      });

      if (data.clientIds.length > 0) {
        await tx.userClientAssignment.createMany({
          data: data.clientIds.map((clientId) => ({
            organizationId,
            organizationMemberId: member.id,
            clientId,
          })),
        });
      }

      await auditService.record({
        organizationId,
        actorUserId,
        action: 'client.assignment_changed',
        entityType: 'OrganizationMember',
        entityId: member.id,
        before: { clientIds: beforeClientIds },
        after: { clientIds: data.clientIds },
      });

      return {
        membershipId: member.id,
        clientIds: data.clientIds,
      };
    });
  }

  async updateStatus(
    organizationId: string,
    actorUserId: string | null,
    membershipId: string,
    data: UpdateUserStatusRequest
  ) {
    return await this.db.$transaction(async (tx) => {
      const auditService = new AuditService(tx as PrismaClient);
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_id: {
            organizationId,
            id: membershipId,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!member) {
        throw new UserAdminError(404, 'USER_NOT_FOUND', 'Membro não encontrado nesta organização');
      }

      if (member.status === 'INVITED') {
        throw new UserAdminError(
          409,
          'INVITATION_NOT_ACCEPTED',
          'Convite pendente não pode ser ativado ou suspenso diretamente'
        );
      }

      if (member.status === data.status) {
        return {
          membershipId: member.id,
          status: member.status,
        };
      }

      if (member.status === 'ACTIVE' && data.status === 'SUSPENDED') {
        if (member.role === 'ADMIN' && member.user.status === 'ACTIVE') {
          const activeAdminCount = await tx.organizationMember.count({
            where: {
              organizationId,
              role: 'ADMIN',
              status: 'ACTIVE',
              user: { status: 'ACTIVE' },
            },
          });

          if (activeAdminCount <= 1) {
            throw new UserAdminError(
              409,
              'LAST_ACTIVE_ADMIN',
              'Não é possível suspender o único administrador ativo da organização'
            );
          }
        }

        const updated = await tx.organizationMember.update({
          where: { id: member.id },
          data: { status: 'SUSPENDED' },
        });

        await auditService.record({
          organizationId,
          actorUserId,
          action: 'user.suspended',
          entityType: 'OrganizationMember',
          entityId: member.id,
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED' },
        });

        return {
          membershipId: updated.id,
          status: updated.status,
        };
      }

      if (member.status === 'SUSPENDED' && data.status === 'ACTIVE') {
        const updated = await tx.organizationMember.update({
          where: { id: member.id },
          data: { status: 'ACTIVE' },
        });

        await auditService.record({
          organizationId,
          actorUserId,
          action: 'user.reactivated',
          entityType: 'OrganizationMember',
          entityId: member.id,
          before: { status: 'SUSPENDED' },
          after: { status: 'ACTIVE' },
        });

        return {
          membershipId: updated.id,
          status: updated.status,
        };
      }

      return {
        membershipId: member.id,
        status: member.status,
      };
    });
  }

  async removeMember(organizationId: string, actorUserId: string | null, membershipId: string) {
    return await this.db.$transaction(async (tx) => {
      const auditService = new AuditService(tx as PrismaClient);
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_id: {
            organizationId,
            id: membershipId,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              status: true,
            },
          },
          clientAssignments: {
            select: {
              clientId: true,
            },
          },
        },
      });

      if (!member) {
        throw new UserAdminError(404, 'USER_NOT_FOUND', 'Membro não encontrado nesta organização');
      }

      if (member.role === 'ADMIN' && member.status === 'ACTIVE' && member.user.status === 'ACTIVE') {
        const activeAdminCount = await tx.organizationMember.count({
          where: {
            organizationId,
            role: 'ADMIN',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
          },
        });

        if (activeAdminCount <= 1) {
          throw new UserAdminError(
            409,
            'LAST_ACTIVE_ADMIN',
            'Não é possível remover o único administrador ativo da organização'
          );
        }
      }

      const beforeState = {
        userId: member.userId,
        email: member.user.email,
        role: member.role,
        status: member.status,
        clientIds: member.clientAssignments.map((a) => a.clientId),
      };

      await tx.userClientAssignment.deleteMany({
        where: { organizationMemberId: member.id },
      });
      await tx.teamMember.deleteMany({
        where: { organizationMemberId: member.id },
      });
      await tx.organizationMemberPermission.deleteMany({
        where: { organizationMemberId: member.id },
      });

      await tx.client.updateMany({
        where: {
          organizationId,
          responsibleUserId: member.userId,
        },
        data: {
          responsibleUserId: null,
        },
      });

      await tx.organizationMember.delete({
        where: { id: member.id },
      });

      await auditService.record({
        organizationId,
        actorUserId,
        action: 'user.removed',
        entityType: 'OrganizationMember',
        entityId: member.id,
        before: beforeState,
        after: null,
      });

      return { success: true };
    });
  }
}

export const usersService = new UsersService();
