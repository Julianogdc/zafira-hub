import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../clients/clients.service.js';
import { LoginInput } from './auth.schemas.js';

export class AuthService {
  /**
   * Valida as credenciais do usuário com Argon2 e atualiza lastLoginAt.
   * Não revela se o e-mail existe em caso de falha.
   */
  async validateUser(input: LoginInput) {
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      throw new AppError(401, 'Credenciais inválidas');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, input.password);

    if (!isPasswordValid) {
      throw new AppError(401, 'Credenciais inválidas');
    }

    // Atualiza data do último login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status,
    };
  }

  /**
   * Retorna o perfil completo do usuário autenticado com suas organizações e papéis.
   */
  async getUserProfile(userId: string) {
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

    const organizations = user.memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    }));

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status,
      organizations,
    };
  }
}
