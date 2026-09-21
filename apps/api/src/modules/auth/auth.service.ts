import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../clients/clients.service.js';
import { LoginRequest, SessionResponse } from '@zafira/contracts';

export class AuthService {
  /**
   * Valida as credenciais do usuário com Argon2 e atualiza lastLoginAt.
   * Não revela se o e-mail existe em caso de falha.
   */
  async login(input: LoginRequest): Promise<{ user: any; activeOrganizationId: string | null; sessionData: SessionResponse }> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      throw new AppError(401, 'Credenciais inválidas');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, input.password);

    if (!isPasswordValid) {
      throw new AppError(401, 'Credenciais inválidas');
    }

    const activeMemberships = user.memberships.filter((m) => !m.status || m.status === 'ACTIVE');

    // Zero memberships ACTIVE: reject
    if (activeMemberships.length === 0) {
      throw new AppError(403, 'Usuário não possui organizações ativas associadas.');
    }

    let activeOrganizationId: string | null = null;

    if (input.organizationId) {
      const hasOrg = activeMemberships.find(m => m.organizationId === input.organizationId);
      if (!hasOrg) {
        throw new AppError(403, 'Organização inválida ou não autorizada.');
      }
      activeOrganizationId = input.organizationId;
    } else if (activeMemberships.length === 1) {
      activeOrganizationId = activeMemberships[0].organizationId;
    }
    // Se não informou organizationId e há múltiplas memberships ativas: activeOrganizationId permanece null

    // Atualiza data do último login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    const sessionData: SessionResponse = {
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
      organizations: activeMemberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role as any,
      })),
      activeOrganizationId,
    };

    return {
      user,
      activeOrganizationId,
      sessionData,
    };
  }

  /**
   * Retorna a sessão para um usuário já autenticado.
   */
  async resolveSession(userId: string, activeOrganizationIdFromToken?: string | null): Promise<SessionResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new AppError(401, 'Usuário inativo ou não encontrado');
    }

    const activeMemberships = user.memberships.filter((m) => !m.status || m.status === 'ACTIVE');

    if (activeMemberships.length === 0) {
      throw new AppError(403, 'Usuário não possui organizações ativas associadas.');
    }

    let activeOrganizationId: string | null = null;

    if (activeMemberships.length === 1) {
      activeOrganizationId = activeMemberships[0].organizationId;
    } else if (activeOrganizationIdFromToken) {
      const hasOrg = activeMemberships.find(m => m.organizationId === activeOrganizationIdFromToken);
      if (hasOrg) {
        activeOrganizationId = activeOrganizationIdFromToken;
      }
    }

    const organizations = activeMemberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role as any,
    }));

    return {
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
      organizations,
      activeOrganizationId,
    };
  }
}
