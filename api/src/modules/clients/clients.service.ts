import { prisma } from '../../lib/prisma.js';
import { CreateClientInput, ListClientsQuery, UpdateClientInput } from './clients.schemas.js';

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class ClientsService {
  /**
   * Obtém a organização padrão Zafira ou garante sua existência.
   */
  private async getZafiraOrganization() {
    let org = await prisma.organization.findUnique({
      where: { slug: 'zafira' },
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: 'Zafira',
          slug: 'zafira',
        },
      });
    }

    return org;
  }

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
      throw new AppError(400, 'O responsável informado não é membro da organização Zafira');
    }
  }

  /**
   * Lista todos os clientes da organização com filtros opcionais.
   */
  async listClients(filters: ListClientsQuery) {
    const org = await this.getZafiraOrganization();

    const where: any = {
      organizationId: org.id,
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
   * Busca um cliente por ID dentro da organização Zafira.
   */
  async getClientById(id: string) {
    const org = await this.getZafiraOrganization();

    const client = await prisma.client.findFirst({
      where: {
        id,
        organizationId: org.id,
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
   * Cria um novo cliente vinculado à organização Zafira.
   */
  async createClient(data: CreateClientInput) {
    const org = await this.getZafiraOrganization();

    if (data.responsibleUserId) {
      await this.validateMember(org.id, data.responsibleUserId);
    }

    const client = await prisma.client.create({
      data: {
        organizationId: org.id,
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
  async updateClient(id: string, data: UpdateClientInput) {
    const org = await this.getZafiraOrganization();

    // Verifica se o cliente existe na organização
    const existing = await prisma.client.findFirst({
      where: {
        id,
        organizationId: org.id,
      },
    });

    if (!existing) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    // Se informou ou alterou o responsável, valida a associação
    if (data.responsibleUserId) {
      await this.validateMember(org.id, data.responsibleUserId);
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
