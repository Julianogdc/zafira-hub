import { prisma } from '../../lib/prisma.js';
import { CreateClientInput, ListClientsQuery, UpdateClientInput } from './clients.schemas.js';
import { RoleType } from '@zafira/domain';
import { buildClientResourceScopeWhere } from '../authorization/client-resource-scope.js';

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

  /**
   * Lista todos os clientes da organização com filtros opcionais e escopo de recurso.
   */
  async listClients(ctx: ClientServiceContext, filters: ListClientsQuery) {
    const scopeWhere = buildClientResourceScopeWhere(ctx);
    const where: any = {
      AND: [scopeWhere],
    };

    if (filters.status) {
      where.AND.push({ status: filters.status });
    }

    if (filters.search) {
      where.AND.push({
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { legalName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
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
   * Busca um cliente por ID dentro da organização com escopo de recurso.
   */
  async getClientById(ctx: ClientServiceContext, id: string) {
    const scopeWhere = buildClientResourceScopeWhere(ctx);
    const client = await prisma.client.findFirst({
      where: {
        id,
        AND: [scopeWhere],
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
   * Se o criador for MANAGER ou MEMBER (não-ADMIN), cria automaticamente
   * UserClientAssignment para o criador na mesma transação.
   */
  async createClient(ctx: ClientServiceContext, data: CreateClientInput) {
    if (data.responsibleUserId) {
      await this.validateMember(ctx.organizationId, data.responsibleUserId);
    }

    return await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
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

      if (ctx.role !== 'ADMIN') {
        await tx.userClientAssignment.create({
          data: {
            organizationId: ctx.organizationId,
            organizationMemberId: ctx.membershipId,
            clientId: client.id,
          },
        });
      }

      return client;
    });
  }

  /**
   * Atualiza parcialmente um cliente existente com validação de escopo de recurso.
   */
  async updateClient(ctx: ClientServiceContext, id: string, data: UpdateClientInput) {
    const scopeWhere = buildClientResourceScopeWhere(ctx);
    const existing = await prisma.client.findFirst({
      where: {
        id,
        AND: [scopeWhere],
      },
    });

    if (!existing) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    if (data.responsibleUserId) {
      await this.validateMember(ctx.organizationId, data.responsibleUserId);
    }

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
