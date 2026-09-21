import { PrismaClient, Prisma } from '@prisma/client';
import { prisma as globalPrisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CreateTeamRequest,
  UpdateTeamRequest,
  ReplaceTeamMembersRequest,
  ReplaceTeamClientsRequest,
  TeamSummary,
  TeamDetail,
} from '@zafira/contracts';

export class TeamError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'TeamError';
  }
}

export interface TeamServiceContext {
  organizationId: string;
  actorUserId?: string;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class TeamService {
  constructor(private readonly db: PrismaClient = globalPrisma) {}

  async listTeams(organizationId: string): Promise<TeamSummary[]> {
    const teams = await this.db.team.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            members: true,
            clientAssignments: true,
          },
        },
      },
    });

    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      isActive: t.isActive,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      memberCount: t._count.members,
      clientCount: t._count.clientAssignments,
    }));
  }

  async getTeamDetail(organizationId: string, teamId: string): Promise<TeamDetail> {
    const team = await this.db.team.findFirst({
      where: { id: teamId, organizationId },
      include: {
        members: {
          include: {
            organizationMember: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        clientAssignments: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!team) {
      throw new TeamError(404, 'TEAM_NOT_FOUND', 'Equipe não encontrada');
    }

    return {
      id: team.id,
      name: team.name,
      isActive: team.isActive,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
      members: team.members.map((m) => ({
        membershipId: m.organizationMember.id,
        userId: m.organizationMember.user.id,
        name: m.organizationMember.user.name,
        email: m.organizationMember.user.email,
        role: m.organizationMember.role,
        membershipStatus: m.organizationMember.status,
      })),
      clients: team.clientAssignments.map((c) => ({
        id: c.client.id,
        name: c.client.name,
        status: c.client.status,
      })),
    };
  }

  async createTeam(ctx: TeamServiceContext, data: CreateTeamRequest): Promise<TeamSummary> {
    return await this.db.$transaction(async (tx) => {
      let team;
      try {
        team = await tx.team.create({
          data: {
            organizationId: ctx.organizationId,
            name: data.name,
            isActive: true,
          },
          include: {
            _count: {
              select: {
                members: true,
                clientAssignments: true,
              },
            },
          },
        });
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TeamError(
            409,
            'TEAM_NAME_ALREADY_EXISTS',
            'Já existe uma equipe com este nome nesta organização'
          );
        }
        throw err;
      }

      const auditService = new AuditService(tx);
      await auditService.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.actorUserId || ctx.actorId,
        action: 'team.created',
        entityType: 'Team',
        entityId: team.id,
        after: {
          name: team.name,
          isActive: team.isActive,
        },
      });

      return {
        id: team.id,
        name: team.name,
        isActive: team.isActive,
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
        memberCount: team._count.members,
        clientCount: team._count.clientAssignments,
      };
    });
  }

  async updateTeam(
    ctx: TeamServiceContext,
    teamId: string,
    data: UpdateTeamRequest
  ): Promise<TeamSummary> {
    return await this.db.$transaction(async (tx) => {
      const existing = await tx.team.findFirst({
        where: { id: teamId, organizationId: ctx.organizationId },
        include: {
          _count: {
            select: {
              members: true,
              clientAssignments: true,
            },
          },
        },
      });

      if (!existing) {
        throw new TeamError(404, 'TEAM_NOT_FOUND', 'Equipe não encontrada');
      }

      let updated;
      try {
        updated = await tx.team.update({
          where: { id: teamId },
          data: {
            name: data.name,
            isActive: data.isActive,
          },
          include: {
            _count: {
              select: {
                members: true,
                clientAssignments: true,
              },
            },
          },
        });
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TeamError(
            409,
            'TEAM_NAME_ALREADY_EXISTS',
            'Já existe uma equipe com este nome nesta organização'
          );
        }
        throw err;
      }

      const auditService = new AuditService(tx);
      await auditService.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.actorUserId || ctx.actorId,
        action: 'team.updated',
        entityType: 'Team',
        entityId: updated.id,
        before: {
          name: existing.name,
          isActive: existing.isActive,
        },
        after: {
          name: updated.name,
          isActive: updated.isActive,
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        memberCount: updated._count.members,
        clientCount: updated._count.clientAssignments,
      };
    });
  }

  async replaceMembers(
    ctx: TeamServiceContext,
    teamId: string,
    data: ReplaceTeamMembersRequest
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const team = await tx.team.findFirst({
        where: { id: teamId, organizationId: ctx.organizationId },
      });

      if (!team) {
        throw new TeamError(404, 'TEAM_NOT_FOUND', 'Equipe não encontrada');
      }

      if (data.membershipIds.length > 0) {
        const validMemberships = await tx.organizationMember.findMany({
          where: {
            id: { in: data.membershipIds },
            organizationId: ctx.organizationId,
          },
          select: { id: true },
        });

        if (validMemberships.length !== data.membershipIds.length) {
          throw new TeamError(
            400,
            'MEMBERSHIP_NOT_IN_ORGANIZATION',
            'Um ou mais membros não pertencem a esta organização ou não existem'
          );
        }
      }

      await tx.teamMember.deleteMany({
        where: {
          teamId,
          organizationId: ctx.organizationId,
        },
      });

      if (data.membershipIds.length > 0) {
        await tx.teamMember.createMany({
          data: data.membershipIds.map((membershipId) => ({
            organizationId: ctx.organizationId,
            teamId,
            organizationMemberId: membershipId,
          })),
        });
      }

      const auditService = new AuditService(tx);
      await auditService.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.actorUserId || ctx.actorId,
        action: 'team.members_changed',
        entityType: 'Team',
        entityId: team.id,
        after: {
          count: data.membershipIds.length,
          membershipIds: data.membershipIds,
        },
      });
    });
  }

  async replaceClients(
    ctx: TeamServiceContext,
    teamId: string,
    data: ReplaceTeamClientsRequest
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const team = await tx.team.findFirst({
        where: { id: teamId, organizationId: ctx.organizationId },
      });

      if (!team) {
        throw new TeamError(404, 'TEAM_NOT_FOUND', 'Equipe não encontrada');
      }

      if (data.clientIds.length > 0) {
        const validClients = await tx.client.findMany({
          where: {
            id: { in: data.clientIds },
            organizationId: ctx.organizationId,
          },
          select: { id: true },
        });

        if (validClients.length !== data.clientIds.length) {
          throw new TeamError(
            400,
            'CLIENT_NOT_IN_ORGANIZATION',
            'Um ou mais clientes não pertencem a esta organização ou não existem'
          );
        }
      }

      await tx.teamClientAssignment.deleteMany({
        where: {
          teamId,
          organizationId: ctx.organizationId,
        },
      });

      if (data.clientIds.length > 0) {
        await tx.teamClientAssignment.createMany({
          data: data.clientIds.map((clientId) => ({
            organizationId: ctx.organizationId,
            teamId,
            clientId,
          })),
        });
      }

      const auditService = new AuditService(tx);
      await auditService.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.actorUserId || ctx.actorId,
        action: 'team.clients_changed',
        entityType: 'Team',
        entityId: team.id,
        after: {
          count: data.clientIds.length,
          clientIds: data.clientIds,
        },
      });
    });
  }
}

export const teamService = new TeamService();
