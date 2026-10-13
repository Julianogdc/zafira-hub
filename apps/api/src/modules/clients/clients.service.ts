import { prisma } from '../../lib/prisma.js';
import {
  CreateClientInput,
  ListClientsQuery,
  UpdateClientInput,
  ListMeetingsQuery,
  CreateClientContactRequest,
  UpdateClientContactRequest,
  CreateClientMeetingNoteRequest,
  UpdateClientMeetingNoteRequest,
} from './clients.schemas.js';
import {
  ClientPortfolioItem,
  ClientPortfolioItemSchema,
  ClientDetail,
  ClientDetailSchema,
  ClientContact,
  ClientContactSchema,
  ClientMeetingNote,
  ClientMeetingNoteSchema,
  ClientTimelineEvent,
  ClientTimelineEventSchema,
  ClientMutationResult,
  ClientMutationResultSchema,
} from '@zafira/contracts';
import { PermissionCode, RoleType } from '@zafira/domain';
import { buildClientResourceScopeWhere } from '../authorization/client-resource-scope.js';
import { resolveAuthorizationContext } from '../authorization/resolver.js';
import { AuditService } from '../audit/audit.service.js';

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ClientServiceContext {
  userId?: string;
  organizationId: string;
  membershipId: string;
  role: RoleType;
}

export class ClientsService {
  /**
   * Resolve o ID do usuário humano a partir do contexto ou da membership ativa na mesma organização.
   * Valida simultaneamente tenant (organizationId), status da membership (ACTIVE) e status global do usuário (ACTIVE).
   * Fail-closed e tenant-safe.
   */
  private async resolveUserId(ctx: ClientServiceContext): Promise<string | undefined> {
    if (ctx.userId) return ctx.userId;
    if (ctx.membershipId && ctx.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: {
          id: ctx.membershipId,
          organizationId: ctx.organizationId,
          status: 'ACTIVE',
          user: {
            status: 'ACTIVE',
          },
        },
        select: { userId: true },
      });
      return membership?.userId;
    }
    return undefined;
  }

  /**
   * Avalia permissão secundária ou condicional no contexto do usuário autenticado.
   * Proibido bypass de Role: permissão é avaliada estritamente via resolveAuthorizationContext.
   * Se o userId não puder ser resolvido de forma válida, opera em fail-closed absoluto (retorna false).
   */
  private async checkPermission(ctx: ClientServiceContext, permissionCode: PermissionCode): Promise<boolean> {
    const userId = await this.resolveUserId(ctx);
    if (!userId) {
      return false;
    }
    const result = await resolveAuthorizationContext({
      userId,
      activeOrganizationId: ctx.organizationId,
      permissionCode,
    });
    return result.allowed;
  }

  /**
   * Valida se um usuário é membro ativo da organização especificada e se o usuário global está ativo.
   */
  private async validateResponsibleUser(organizationId: string, userId: string) {
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        user: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE' || membership.user?.status !== 'ACTIVE') {
      throw new AppError(400, 'O responsável informado não é um membro ativo da organização');
    }
  }

  /**
   * Valida se todas as equipes informadas pertencem à organização ativa.
   */
  private async validateTeams(organizationId: string, teamIds: string[]) {
    if (teamIds.length === 0) return;
    const uniqueIds = Array.from(new Set(teamIds));
    const teams = await prisma.team.findMany({
      where: {
        organizationId,
        id: { in: uniqueIds },
      },
      select: { id: true },
    });

    if (teams.length !== uniqueIds.length) {
      throw new AppError(400, 'Uma ou mais equipes informadas são inválidas ou pertencem a outra organização');
    }
  }

  /**
   * Valida se um cliente existe na organização ativa e se está dentro do Resource Scope do usuário.
   */
  private async getClientInScope(ctx: ClientServiceContext, clientId: string) {
    const scopeWhere = buildClientResourceScopeWhere(ctx);
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        AND: [scopeWhere],
      },
    });

    if (!client) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    return client;
  }

  /**
   * Lista todos os clientes da organização com filtros e escopo de recurso.
   * DTO Sanitizado da Carteira: NUNCA expõe document, contractValue, notes, briefing, brandKit ou secrets.
   * Não executa N+1.
   */
  async listClients(ctx: ClientServiceContext, filters: ListClientsQuery): Promise<ClientPortfolioItem[]> {
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

    const [canViewTeams, canViewIntegrations, clients] = await Promise.all([
      this.checkPermission(ctx, 'teams.view'),
      this.checkPermission(ctx, 'integrations.view'),
      prisma.client.findMany({
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
          teamAssignments: {
            include: {
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          contacts: {
            where: {
              isPrimary: true,
            },
            select: {
              name: true,
              email: true,
              phone: true,
            },
            take: 1,
          },
          integrationConnections: {
            where: {
              status: 'ACTIVE',
              provider: {
                not: 'POSTIZ',
              },
            },
            select: {
              id: true,
            },
          },
        },
      }),
    ]);

    return clients.map((c) => {
      const primaryContact = c.contacts[0]
        ? {
            name: c.contacts[0].name || undefined,
            email: c.contacts[0].email || undefined,
            phone: c.contacts[0].phone || undefined,
          }
        : undefined;

      const item: ClientPortfolioItem = {
        id: c.id,
        name: c.name,
        legalName: c.legalName ?? null,
        status: c.status,
        responsibleUser: c.responsibleUser
          ? {
              id: c.responsibleUser.id,
              name: c.responsibleUser.name,
              email: c.responsibleUser.email,
              avatarUrl: c.responsibleUser.avatarUrl,
            }
          : null,
        squads: canViewTeams
          ? c.teamAssignments.map((ta) => ({
              id: ta.team.id,
              name: ta.team.name,
            }))
          : [],
        startDate: c.startDate ? c.startDate.toISOString() : null,
        activeIntegrationsCount: canViewIntegrations ? c.integrationConnections.length : 0,
        primaryContact,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };

      return ClientPortfolioItemSchema.parse(item);
    });
  }

  /**
   * Busca um cliente por ID dentro do escopo de recurso com proteções condicionais:
   * - document protegido por clients.view_sensitive
   * - contractValue protegido por financial.view_summary
   * - squads protegido por teams.view
   * - activeIntegrations protegido por integrations.view (exclui POSTIZ)
   */
  async getClientById(ctx: ClientServiceContext, id: string): Promise<ClientDetail> {
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
        teamAssignments: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        contacts: {
          orderBy: [
            { isPrimary: 'desc' },
            { createdAt: 'asc' },
          ],
        },
        meetingNotes: {
          orderBy: [
            { meetingDate: 'desc' },
            { id: 'desc' },
          ],
          include: {
            authorUser: {
              select: {
                name: true,
              },
            },
          },
          take: 100,
        },
        integrationConnections: {
          where: {
            status: 'ACTIVE',
            provider: {
              not: 'POSTIZ',
            },
          },
          select: {
            id: true,
            provider: true,
            status: true,
            displayName: true,
            lastValidatedAt: true,
          },
        },
      },
    });

    if (!client) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    const [canViewSensitive, canViewFinancial, canViewTeams, canViewIntegrations] = await Promise.all([
      this.checkPermission(ctx, 'clients.view_sensitive'),
      this.checkPermission(ctx, 'financial.view_summary'),
      this.checkPermission(ctx, 'teams.view'),
      this.checkPermission(ctx, 'integrations.view'),
    ]);

    const detail: ClientDetail = {
      id: client.id,
      organizationId: client.organizationId,
      name: client.name,
      legalName: client.legalName ?? null,
      document: canViewSensitive ? client.document : null,
      email: client.email ?? null,
      phone: client.phone ?? null,
      status: client.status,
      responsibleUserId: client.responsibleUserId ?? null,
      responsibleUser: client.responsibleUser
        ? {
            id: client.responsibleUser.id,
            name: client.responsibleUser.name,
            email: client.responsibleUser.email,
            avatarUrl: client.responsibleUser.avatarUrl,
          }
        : null,
      squads: canViewTeams
        ? client.teamAssignments.map((ta) => ({
            id: ta.team.id,
            name: ta.team.name,
          }))
        : [],
      contractValue: canViewFinancial && client.contractValue !== null ? Number(client.contractValue) : null,
      startDate: client.startDate ? client.startDate.toISOString() : null,
      endDate: client.endDate ? client.endDate.toISOString() : null,
      notes: client.notes ?? null,
      briefing: (client.briefing as any) ?? null,
      brandKit: (client.brandKit as any) ?? null,
      address:
        client.addressStreet ||
        client.addressNumber ||
        client.addressComplement ||
        client.addressDistrict ||
        client.addressCity ||
        client.addressState ||
        client.addressPostalCode ||
        client.addressCountryCode ||
        client.addressLatitude ||
        client.addressLongitude
          ? {
              street: client.addressStreet ?? null,
              number: client.addressNumber ?? null,
              complement: client.addressComplement ?? null,
              district: client.addressDistrict ?? null,
              city: client.addressCity ?? null,
              state: client.addressState ?? null,
              postalCode: client.addressPostalCode ?? null,
              countryCode: client.addressCountryCode ?? null,
              latitude: client.addressLatitude ? Number(client.addressLatitude) : null,
              longitude: client.addressLongitude ? Number(client.addressLongitude) : null,
            }
          : null,
      contacts: client.contacts.map((ct) => ({
        id: ct.id,
        organizationId: ct.organizationId,
        clientId: ct.clientId,
        name: ct.name,
        role: ct.role,
        email: ct.email,
        phone: ct.phone,
        isPrimary: ct.isPrimary,
        notes: ct.notes,
        createdAt: ct.createdAt.toISOString(),
        updatedAt: ct.updatedAt.toISOString(),
      })),
      meetingNotes: client.meetingNotes.map((mn) => ({
        id: mn.id,
        organizationId: mn.organizationId,
        clientId: mn.clientId,
        title: mn.title,
        meetingDate: mn.meetingDate.toISOString(),
        summary: mn.summary,
        actionItems: mn.actionItems,
        externalLink: mn.externalLink,
        authorUserId: mn.authorUserId,
        authorUserName: mn.authorUser?.name || null,
        createdAt: mn.createdAt.toISOString(),
        updatedAt: mn.updatedAt.toISOString(),
      })),
      activeIntegrations: canViewIntegrations
        ? client.integrationConnections.map((ic) => ({
            id: ic.id,
            provider: ic.provider,
            status: ic.status,
            displayName: ic.displayName,
            lastValidatedAt: ic.lastValidatedAt ? ic.lastValidatedAt.toISOString() : null,
          }))
        : [],
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    };

    return ClientDetailSchema.parse(detail);
  }

  /**
   * Cria um novo cliente vinculado à organização ativa com field-level authorization:
   * - responsibleUserId exige users.assign_clients
   * - contractValue exige financial.edit
   * - teamIds exige teams.manage
   * Transação atômica inclui criação de cliente, auto-assignment do criador (se não-ADMIN),
   * teamAssignments e gravação de AuditLog sanitizado.
   */
  async createClient(ctx: ClientServiceContext, data: CreateClientInput): Promise<ClientMutationResult> {
    if (data.responsibleUserId !== undefined && data.responsibleUserId !== null) {
      const allowed = await this.checkPermission(ctx, 'users.assign_clients');
      if (!allowed) {
        throw new AppError(403, 'Permissão insuficiente para definir responsável do cliente');
      }
      await this.validateResponsibleUser(ctx.organizationId, data.responsibleUserId);
    }

    if (data.contractValue !== undefined && data.contractValue !== null) {
      const allowed = await this.checkPermission(ctx, 'financial.edit');
      if (!allowed) {
        throw new AppError(403, 'Permissão insuficiente para definir valor contratual');
      }
    }

    if (data.teamIds !== undefined && data.teamIds.length > 0) {
      const allowed = await this.checkPermission(ctx, 'teams.manage');
      if (!allowed) {
        throw new AppError(403, 'Permissão insuficiente para associar equipes ao cliente');
      }
      await this.validateTeams(ctx.organizationId, data.teamIds);
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
          responsibleUserId: data.responsibleUserId || null,
          contractValue: data.contractValue !== undefined ? data.contractValue : null,
          startDate: data.startDate,
          endDate: data.endDate,
          notes: data.notes,
          briefing: (data.briefing as any) ?? undefined,
          brandKit: (data.brandKit as any) ?? undefined,
          addressStreet: data.address?.street,
          addressNumber: data.address?.number,
          addressComplement: data.address?.complement,
          addressDistrict: data.address?.district,
          addressCity: data.address?.city,
          addressState: data.address?.state,
          addressPostalCode: data.address?.postalCode,
          addressCountryCode: data.address?.countryCode,
          addressLatitude: data.address?.latitude,
          addressLongitude: data.address?.longitude,
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

      if (data.teamIds && data.teamIds.length > 0) {
        const uniqueTeamIds = Array.from(new Set(data.teamIds));
        await tx.teamClientAssignment.createMany({
          data: uniqueTeamIds.map((teamId) => ({
            organizationId: ctx.organizationId,
            teamId,
            clientId: client.id,
          })),
        });
      }

      const actorUserId = (await this.resolveUserId(ctx)) || null;

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.created',
        entityType: 'Client',
        entityId: client.id,
        after: {
          id: client.id,
          name: client.name,
          status: client.status,
          responsibleUserId: client.responsibleUserId,
          teamCount: data.teamIds?.length ?? 0,
        },
        metadata: {
          hasBriefing: Boolean(data.briefing),
          hasBrandKit: Boolean(data.brandKit),
        },
      });

      return ClientMutationResultSchema.parse({
        id: client.id,
        name: client.name,
        status: client.status,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
      });
    });
  }

  /**
   * Atualiza parcialmente um cliente existente com validação de escopo de recurso e field-level authorization:
   * - responsibleUserId exige users.assign_clients somente se materialmente alterado
   * - contractValue exige financial.edit somente se materialmente alterado
   * - teamIds exige teams.manage somente se o conjunto de equipes for materialmente alterado
   */
  async updateClient(ctx: ClientServiceContext, id: string, data: UpdateClientInput): Promise<ClientMutationResult> {
    const scopeWhere = buildClientResourceScopeWhere(ctx);
    const existing = await prisma.client.findFirst({
      where: {
        id,
        AND: [scopeWhere],
      },
      include: {
        teamAssignments: {
          select: {
            teamId: true,
          },
        },
      },
    });

    if (!existing) {
      throw new AppError(404, 'Cliente não encontrado');
    }

    const finalStartDate = data.startDate !== undefined ? data.startDate : existing.startDate;
    const finalEndDate = data.endDate !== undefined ? data.endDate : existing.endDate;

    if (finalStartDate && finalEndDate && finalEndDate < finalStartDate) {
      throw new AppError(400, 'A data final deve ser posterior ou igual à data de início');
    }

    // 1. Field-level auth: responsibleUserId
    const isResponsibleChanged =
      data.responsibleUserId !== undefined &&
      (existing.responsibleUserId ?? null) !== (data.responsibleUserId ?? null);

    if (isResponsibleChanged) {
      const allowed = await this.checkPermission(ctx, 'users.assign_clients');
      if (!allowed) {
        throw new AppError(403, 'Permissão insuficiente para alterar o responsável do cliente');
      }
      if (data.responsibleUserId !== null && data.responsibleUserId !== undefined) {
        await this.validateResponsibleUser(ctx.organizationId, data.responsibleUserId);
      }
    }

    // 2. Field-level auth: contractValue
    const currentContractNum = existing.contractValue !== null ? Number(existing.contractValue) : null;
    const newContractNum =
      data.contractValue !== undefined
        ? data.contractValue !== null
          ? Number(data.contractValue)
          : null
        : currentContractNum;
    const isContractChanged = data.contractValue !== undefined && currentContractNum !== newContractNum;

    if (isContractChanged) {
      const allowed = await this.checkPermission(ctx, 'financial.edit');
      if (!allowed) {
        throw new AppError(403, 'Permissão insuficiente para alterar o valor do contrato');
      }
    }

    // 3. Field-level auth: teamIds
    let isTeamsChanged = false;
    if (data.teamIds !== undefined) {
      const currentTeamSet = new Set(existing.teamAssignments.map((t) => t.teamId));
      const newTeamSet = new Set(data.teamIds);
      if (currentTeamSet.size !== newTeamSet.size) {
        isTeamsChanged = true;
      } else {
        for (const tId of newTeamSet) {
          if (!currentTeamSet.has(tId)) {
            isTeamsChanged = true;
            break;
          }
        }
      }

      if (isTeamsChanged) {
        const allowed = await this.checkPermission(ctx, 'teams.manage');
        if (!allowed) {
          throw new AppError(403, 'Permissão insuficiente para alterar as equipes do cliente');
        }
        await this.validateTeams(ctx.organizationId, data.teamIds);
      }
    }

    // 4. Material change: address
    let isAddressChanged = false;
    const addressUpdates: any = {};

    if (data.address === null) {
      if (
        existing.addressStreet ||
        existing.addressNumber ||
        existing.addressComplement ||
        existing.addressDistrict ||
        existing.addressCity ||
        existing.addressState ||
        existing.addressPostalCode ||
        existing.addressCountryCode ||
        existing.addressLatitude ||
        existing.addressLongitude
      ) {
        isAddressChanged = true;
      }
      addressUpdates.addressStreet = null;
      addressUpdates.addressNumber = null;
      addressUpdates.addressComplement = null;
      addressUpdates.addressDistrict = null;
      addressUpdates.addressCity = null;
      addressUpdates.addressState = null;
      addressUpdates.addressPostalCode = null;
      addressUpdates.addressCountryCode = null;
      addressUpdates.addressLatitude = null;
      addressUpdates.addressLongitude = null;
    } else if (data.address !== undefined) {
      if (data.address.street !== undefined && data.address.street !== existing.addressStreet) {
        isAddressChanged = true;
        addressUpdates.addressStreet = data.address.street;
      }
      if (data.address.number !== undefined && data.address.number !== existing.addressNumber) {
        isAddressChanged = true;
        addressUpdates.addressNumber = data.address.number;
      }
      if (data.address.complement !== undefined && data.address.complement !== existing.addressComplement) {
        isAddressChanged = true;
        addressUpdates.addressComplement = data.address.complement;
      }
      if (data.address.district !== undefined && data.address.district !== existing.addressDistrict) {
        isAddressChanged = true;
        addressUpdates.addressDistrict = data.address.district;
      }
      if (data.address.city !== undefined && data.address.city !== existing.addressCity) {
        isAddressChanged = true;
        addressUpdates.addressCity = data.address.city;
      }
      if (data.address.state !== undefined && data.address.state !== existing.addressState) {
        isAddressChanged = true;
        addressUpdates.addressState = data.address.state;
      }
      if (data.address.postalCode !== undefined && data.address.postalCode !== existing.addressPostalCode) {
        isAddressChanged = true;
        addressUpdates.addressPostalCode = data.address.postalCode;
      }
      if (data.address.countryCode !== undefined && data.address.countryCode !== existing.addressCountryCode) {
        isAddressChanged = true;
        addressUpdates.addressCountryCode = data.address.countryCode;
      }

      const latNum = existing.addressLatitude !== null ? Number(existing.addressLatitude) : null;
      if (data.address.latitude !== undefined && data.address.latitude !== latNum) {
        isAddressChanged = true;
        addressUpdates.addressLatitude = data.address.latitude;
      }

      const lngNum = existing.addressLongitude !== null ? Number(existing.addressLongitude) : null;
      if (data.address.longitude !== undefined && data.address.longitude !== lngNum) {
        isAddressChanged = true;
        addressUpdates.addressLongitude = data.address.longitude;
      }
    }

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      // Atualização de equipes transacional
      if (isTeamsChanged && data.teamIds !== undefined) {
        await tx.teamClientAssignment.deleteMany({
          where: {
            organizationId: ctx.organizationId,
            clientId: id,
          },
        });

        const uniqueTeamIds = Array.from(new Set(data.teamIds));
        if (uniqueTeamIds.length > 0) {
          await tx.teamClientAssignment.createMany({
            data: uniqueTeamIds.map((teamId) => ({
              organizationId: ctx.organizationId,
              teamId,
              clientId: id,
            })),
          });
        }

        await new AuditService(tx).record({
          organizationId: ctx.organizationId,
          actorUserId,
          action: 'client.teams_changed',
          entityType: 'Client',
          entityId: id,
          before: { teamIds: existing.teamAssignments.map((t) => t.teamId) },
          after: { teamIds: uniqueTeamIds },
        });
      }

      // Evento específico de mudança de responsável
      if (isResponsibleChanged) {
        await new AuditService(tx).record({
          organizationId: ctx.organizationId,
          actorUserId,
          action: 'client.responsible_changed',
          entityType: 'Client',
          entityId: id,
          before: { responsibleUserId: existing.responsibleUserId },
          after: { responsibleUserId: data.responsibleUserId },
        });
      }

      // Lista campos modificados gerais
      const changedFields: string[] = [];
      if (data.name !== undefined && data.name !== existing.name) changedFields.push('name');
      if (data.legalName !== undefined && data.legalName !== existing.legalName) changedFields.push('legalName');
      if (data.document !== undefined && data.document !== existing.document) changedFields.push('document');
      if (data.email !== undefined && data.email !== existing.email) changedFields.push('email');
      if (data.phone !== undefined && data.phone !== existing.phone) changedFields.push('phone');
      if (data.status !== undefined && data.status !== existing.status) changedFields.push('status');
      if (isContractChanged) changedFields.push('contractValue');
      if (data.startDate !== undefined) changedFields.push('startDate');
      if (data.endDate !== undefined) changedFields.push('endDate');
      if (data.notes !== undefined) changedFields.push('notes');
      if (data.briefing !== undefined) changedFields.push('briefing');
      if (data.brandKit !== undefined) changedFields.push('brandKit');
      if (isAddressChanged) changedFields.push('address');

      if (changedFields.length > 0) {
        await new AuditService(tx).record({
          organizationId: ctx.organizationId,
          actorUserId,
          action: 'client.updated',
          entityType: 'Client',
          entityId: id,
          metadata: { changedFields },
        });
      }

      const client = await tx.client.update({
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
          briefing: data.briefing !== undefined ? (data.briefing as any) : undefined,
          brandKit: data.brandKit !== undefined ? (data.brandKit as any) : undefined,
          ...addressUpdates,
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

      return ClientMutationResultSchema.parse({
        id: client.id,
        name: client.name,
        status: client.status,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
      });
    });
  }

  /* ==========================================================================
     SUB-RECURSO: CLIENT CONTACTS (Stakeholders)
     ========================================================================== */

  async listContacts(ctx: ClientServiceContext, clientId: string): Promise<ClientContact[]> {
    await this.getClientInScope(ctx, clientId);

    const contacts = await prisma.clientContact.findMany({
      where: {
        organizationId: ctx.organizationId,
        clientId,
      },
      orderBy: [
        { isPrimary: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    return contacts.map((c) =>
      ClientContactSchema.parse({
        id: c.id,
        organizationId: c.organizationId,
        clientId: c.clientId,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })
    );
  }

  async createContact(ctx: ClientServiceContext, clientId: string, data: CreateClientContactRequest): Promise<ClientContact> {
    await this.getClientInScope(ctx, clientId);

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      if (data.isPrimary === true) {
        await tx.clientContact.updateMany({
          where: {
            organizationId: ctx.organizationId,
            clientId,
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        });
      }

      const contact = await tx.clientContact.create({
        data: {
          organizationId: ctx.organizationId,
          clientId,
          name: data.name,
          role: data.role || null,
          email: data.email || null,
          phone: data.phone || null,
          isPrimary: data.isPrimary ?? false,
          notes: data.notes || null,
        },
      });

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.contact.created',
        entityType: 'ClientContact',
        entityId: contact.id,
        after: {
          id: contact.id,
          clientId,
          name: contact.name,
          isPrimary: contact.isPrimary,
        },
      });

      return ClientContactSchema.parse({
        id: contact.id,
        organizationId: contact.organizationId,
        clientId: contact.clientId,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
        notes: contact.notes,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      });
    });
  }

  async updateContact(
    ctx: ClientServiceContext,
    clientId: string,
    contactId: string,
    data: UpdateClientContactRequest
  ): Promise<ClientContact> {
    await this.getClientInScope(ctx, clientId);

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      const existing = await tx.clientContact.findFirst({
        where: {
          id: contactId,
          clientId,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new AppError(404, 'Contato não encontrado');
      }

      if (data.isPrimary === true) {
        await tx.clientContact.updateMany({
          where: {
            organizationId: ctx.organizationId,
            clientId,
            isPrimary: true,
            id: { not: contactId },
          },
          data: {
            isPrimary: false,
          },
        });
      }

      const contact = await tx.clientContact.update({
        where: { id: contactId },
        data: {
          name: data.name,
          role: data.role !== undefined ? (data.role || null) : undefined,
          email: data.email !== undefined ? (data.email || null) : undefined,
          phone: data.phone !== undefined ? (data.phone || null) : undefined,
          isPrimary: data.isPrimary,
          notes: data.notes !== undefined ? (data.notes || null) : undefined,
        },
      });

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.contact.updated',
        entityType: 'ClientContact',
        entityId: contact.id,
        before: { id: contact.id, isPrimary: existing.isPrimary },
        after: { id: contact.id, isPrimary: contact.isPrimary },
        metadata: { changedFields: Object.keys(data) },
      });

      return ClientContactSchema.parse({
        id: contact.id,
        organizationId: contact.organizationId,
        clientId: contact.clientId,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
        notes: contact.notes,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      });
    });
  }

  async deleteContact(ctx: ClientServiceContext, clientId: string, contactId: string): Promise<{ success: boolean }> {
    await this.getClientInScope(ctx, clientId);

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      const existing = await tx.clientContact.findFirst({
        where: {
          id: contactId,
          clientId,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new AppError(404, 'Contato não encontrado');
      }

      await tx.clientContact.delete({
        where: { id: contactId },
      });

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.contact.deleted',
        entityType: 'ClientContact',
        entityId: contactId,
        before: { id: contactId, clientId, name: existing.name },
      });

      return { success: true };
    });
  }

  /* ==========================================================================
     SUB-RECURSO: CLIENT MEETING NOTES (Memória do Relacionamento)
     ========================================================================== */

  async listMeetings(ctx: ClientServiceContext, clientId: string, query: ListMeetingsQuery): Promise<ClientMeetingNote[]> {
    await this.getClientInScope(ctx, clientId);

    const safeLimit = Math.max(1, Math.min(Number(query.limit) || 50, 100));

    const notes = await prisma.clientMeetingNote.findMany({
      where: {
        organizationId: ctx.organizationId,
        clientId,
      },
      take: safeLimit,
      orderBy: [
        { meetingDate: 'desc' },
        { id: 'desc' },
      ],
      include: {
        authorUser: {
          select: {
            name: true,
          },
        },
      },
    });

    return notes.map((n) =>
      ClientMeetingNoteSchema.parse({
        id: n.id,
        organizationId: n.organizationId,
        clientId: n.clientId,
        title: n.title,
        meetingDate: n.meetingDate.toISOString(),
        summary: n.summary,
        actionItems: n.actionItems,
        externalLink: n.externalLink,
        authorUserId: n.authorUserId,
        authorUserName: n.authorUser?.name || null,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })
    );
  }

  async createMeeting(
    ctx: ClientServiceContext,
    clientId: string,
    data: CreateClientMeetingNoteRequest
  ): Promise<ClientMeetingNote> {
    await this.getClientInScope(ctx, clientId);

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      const note = await tx.clientMeetingNote.create({
        data: {
          organizationId: ctx.organizationId,
          clientId,
          title: data.title,
          meetingDate: data.meetingDate,
          summary: data.summary,
          actionItems: data.actionItems || null,
          externalLink: data.externalLink || null,
          authorUserId: actorUserId,
        },
        include: {
          authorUser: {
            select: {
              name: true,
            },
          },
        },
      });

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.meeting.created',
        entityType: 'ClientMeetingNote',
        entityId: note.id,
        after: {
          id: note.id,
          clientId,
          title: note.title,
          meetingDate: note.meetingDate,
        },
      });

      return ClientMeetingNoteSchema.parse({
        id: note.id,
        organizationId: note.organizationId,
        clientId: note.clientId,
        title: note.title,
        meetingDate: note.meetingDate.toISOString(),
        summary: note.summary,
        actionItems: note.actionItems,
        externalLink: note.externalLink,
        authorUserId: note.authorUserId,
        authorUserName: note.authorUser?.name || null,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      });
    });
  }

  async updateMeeting(
    ctx: ClientServiceContext,
    clientId: string,
    meetingId: string,
    data: UpdateClientMeetingNoteRequest
  ): Promise<ClientMeetingNote> {
    await this.getClientInScope(ctx, clientId);

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      const existing = await tx.clientMeetingNote.findFirst({
        where: {
          id: meetingId,
          clientId,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new AppError(404, 'Ata de reunião não encontrada');
      }

      const note = await tx.clientMeetingNote.update({
        where: { id: meetingId },
        data: {
          title: data.title,
          meetingDate: data.meetingDate,
          summary: data.summary,
          actionItems: data.actionItems !== undefined ? (data.actionItems || null) : undefined,
          externalLink: data.externalLink !== undefined ? (data.externalLink || null) : undefined,
        },
        include: {
          authorUser: {
            select: {
              name: true,
            },
          },
        },
      });

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.meeting.updated',
        entityType: 'ClientMeetingNote',
        entityId: note.id,
        metadata: { changedFields: Object.keys(data) },
      });

      return ClientMeetingNoteSchema.parse({
        id: note.id,
        organizationId: note.organizationId,
        clientId: note.clientId,
        title: note.title,
        meetingDate: note.meetingDate.toISOString(),
        summary: note.summary,
        actionItems: note.actionItems,
        externalLink: note.externalLink,
        authorUserId: note.authorUserId,
        authorUserName: note.authorUser?.name || null,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      });
    });
  }

  async deleteMeeting(ctx: ClientServiceContext, clientId: string, meetingId: string): Promise<{ success: boolean }> {
    await this.getClientInScope(ctx, clientId);

    return await prisma.$transaction(async (tx) => {
      const actorUserId = (await this.resolveUserId(ctx)) || null;

      const existing = await tx.clientMeetingNote.findFirst({
        where: {
          id: meetingId,
          clientId,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new AppError(404, 'Ata de reunião não encontrada');
      }

      await tx.clientMeetingNote.delete({
        where: { id: meetingId },
      });

      await new AuditService(tx).record({
        organizationId: ctx.organizationId,
        actorUserId,
        action: 'client.meeting.deleted',
        entityType: 'ClientMeetingNote',
        entityId: meetingId,
        before: { id: meetingId, clientId, title: existing.title },
      });

      return { success: true };
    });
  }

  /* ==========================================================================
     SUB-RECURSO: TIMELINE CONTEXTUAL
     ========================================================================== */

  async getTimeline(ctx: ClientServiceContext, clientId: string): Promise<ClientTimelineEvent[]> {
    const client = await this.getClientInScope(ctx, clientId);

    const [meetings, auditLogs, canViewIntegrations] = await Promise.all([
      prisma.clientMeetingNote.findMany({
        where: {
          organizationId: ctx.organizationId,
          clientId,
        },
        include: {
          authorUser: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [
          { meetingDate: 'desc' },
          { id: 'desc' },
        ],
      }),
      prisma.auditLog.findMany({
        where: {
          organizationId: ctx.organizationId,
          entityType: 'Client',
          entityId: clientId,
          action: {
            in: ['client.responsible_changed', 'client.teams_changed'],
          },
        },
        include: {
          actorUser: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.checkPermission(ctx, 'integrations.view'),
    ]);

    let connections: any[] = [];
    if (canViewIntegrations) {
      connections = await prisma.integrationConnection.findMany({
        where: {
          organizationId: ctx.organizationId,
          clientId,
          status: 'ACTIVE',
          provider: {
            not: 'POSTIZ',
          },
        },
        select: {
          id: true,
          provider: true,
          displayName: true,
          createdAt: true,
        },
      });
    }

    const events: ClientTimelineEvent[] = [];

    // 1. Criação do cliente
    events.push({
      id: `client-${client.id}-created`,
      timestamp: client.createdAt.toISOString(),
      type: 'CLIENT_CREATED',
      title: 'Cliente cadastrado',
      description: 'Cliente cadastrado na plataforma',
      actorName: null,
    });

    // 2. Início de vigência (se houver startDate)
    if (client.startDate) {
      events.push({
        id: `client-${client.id}-startdate`,
        timestamp: client.startDate.toISOString(),
        type: 'DATA_UPDATED',
        title: 'Início de vigência',
        description: 'Início de vigência contratual do cliente',
        actorName: null,
      });
    }

    // 3. Atas de reunião
    for (const note of meetings) {
      events.push({
        id: `meeting-${note.id}`,
        timestamp: note.meetingDate.toISOString(),
        type: 'MEETING_RECORDED',
        title: `Reunião: ${note.title}`,
        description: note.summary.length > 100 ? `${note.summary.slice(0, 97)}...` : note.summary,
        actorName: note.authorUser?.name || null,
      });
    }

    // 4. Alterações registradas de responsável e equipes
    for (const log of auditLogs) {
      if (log.action === 'client.responsible_changed') {
        events.push({
          id: `audit-${log.id}`,
          timestamp: log.createdAt.toISOString(),
          type: 'RESPONSIBLE_CHANGED',
          title: 'Responsável alterado',
          description: 'Responsável pelo cliente foi atualizado',
          actorName: log.actorUser?.name || null,
        });
      } else if (log.action === 'client.teams_changed') {
        events.push({
          id: `audit-${log.id}`,
          timestamp: log.createdAt.toISOString(),
          type: 'TEAM_CHANGED',
          title: 'Equipes alteradas',
          description: 'Atribuição de equipes do cliente foi atualizada',
          actorName: log.actorUser?.name || null,
        });
      }
    }

    // 5. Conexões ativas de integração (excluindo POSTIZ)
    if (canViewIntegrations) {
      for (const conn of connections) {
        events.push({
          id: `integration-${conn.id}`,
          timestamp: conn.createdAt.toISOString(),
          type: 'INTEGRATION_CONNECTED',
          title: `Integração conectada: ${conn.provider}`,
          description: conn.displayName ? `Conexão ativa (${conn.displayName})` : `Conexão ativa com ${conn.provider}`,
          actorName: null,
        });
      }
    }

    // Ordenação cronológica decrescente
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return events.map((e) => ClientTimelineEventSchema.parse(e));
  }
}
