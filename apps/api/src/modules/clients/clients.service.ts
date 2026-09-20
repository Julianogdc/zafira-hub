import { prisma } from '../../lib/prisma.js';
import { CreateClientInput, ListClientsQuery, UpdateClientInput } from './clients.schemas.js';
import { RoleType } from '@zafira/domain';

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ClientServiceContext {
  organizationId: string;
  membershipId: string;
  role: RoleType;
}

export class ClientsService {
  /**
   * Valida se um usuário é membro da organização especificada.
   */
  private async validateMember(organizationId: string, userId: string) {
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new AppError(400, 'O responsável informado não é membro da organização');
    }
  }

  private getMemberScopeFilter(ctx: ClientServiceContext) {
    if (ctx.role === 'MEMBER') {
      return {
        assignedMembers: {
          some: {
            organizationMemberId: ctx.membershipId
          }
        }
      };
    }
    return {};
  }

  /**
   * Lista todos os clientes da organização com filtros opcionais e escopo de permissão.
   */
  async listClients(ctx: ClientServiceContext, filters: ListClientsQuery) {
    const where: any = {
      organizationId: ctx.organizationId,
      ...this.getMemberScopeFilter(ctx)
    };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { legalName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        responsibleUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            integrations: true,
          },
        },
      },
    });

    return clients;
  }

  /**
   * Busca um cliente por ID dentro da organização com escopo de permissão.
   */
  async getClientById(ctx: ClientServiceContext, id: string) {
    const client = await prisma.client.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...this.getMemberScopeFilter(ctx)
      },
      include: {
        responsibleUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        integrations: {
          select: {
            id: true,
            provider: true,
            externalId: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!client) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    return client;
  }

  /**
   * Cria um novo cliente vinculado à organização ativa.
   */
  async createClient(ctx: ClientServiceContext, data: CreateClientInput) {
    if (data.responsibleUserId) {
      await this.validateMember(ctx.organizationId, data.responsibleUserId);
    }

    const client = await prisma.client.create({
      data: {
        organizationId: ctx.organizationId,
        name: data.name,
        legalName: data.legalName,
        document: data.document,
        email: data.email || null,
        phone: data.phone,
        status: data.status ?? 'ACTIVE',
        responsibleUserId: data.responsibleUserId,
        contractValue: data.contractValue !== undefined ? data.contractValue : null,
        startDate: data.startDate,
        endDate: data.endDate,
        notes: data.notes,
      },
      include: {
        responsibleUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return client;
  }

  /**
   * Atualiza parcialmente um cliente existente.
   */
  async updateClient(ctx: ClientServiceContext, id: string, data: UpdateClientInput) {
    // Verifica se o cliente existe na organização e se tem permissão (escopo)
    const existing = await prisma.client.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        ...this.getMemberScopeFilter(ctx)
      },
    });

    if (!existing) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    // Se informou ou alterou o responsável, valida a associação
    if (data.responsibleUserId) {
      await this.validateMember(ctx.organizationId, data.responsibleUserId);
    }

    // Valida datas combinadas com os dados existentes se apenas uma for enviada
    const finalStartDate = data.startDate !== undefined ? data.startDate : existing.startDate;
    const finalEndDate = data.endDate !== undefined ? data.endDate : existing.endDate;

    if (finalStartDate && finalEndDate && finalEndDate < finalStartDate) {
      throw new AppError(400, 'A data final deve ser posterior ou igual à data de início');
    }

    const client = await prisma.client.update({
      where: { id },
      data: {
        name: data.name,
        legalName: data.legalName,
        document: data.document,
        email: data.email !== undefined ? (data.email || null) : undefined,
        phone: data.phone,
        status: data.status,
        responsibleUserId: data.responsibleUserId,
        contractValue: data.contractValue,
        startDate: data.startDate,
        endDate: data.endDate,
        notes: data.notes,
      },
      include: {
        responsibleUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        integrations: true,
      },
    });

    return client;
  }
}
