import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../clients/clients.service.js';
import { LoginRequest, SessionResponse, CapabilitiesResponse } from '@zafira/contracts';
import { resolveAuthorizationContext } from '../authorization/resolver.js';
import { resolveTimeZone, type PermissionCode } from '@zafira/domain';

const CALENDAR_CAPABILITY_CODES = [
  'calendar.view',
  'calendar.link',
  'calendar.manage_connections',
  'calendar.view_all',
] as const satisfies readonly PermissionCode[];

const ONBOARDING_CAPABILITY_CODES = [
  'onboarding.view',
  'onboarding.manage_templates',
  'onboarding.manage_functions',
  'onboarding.start',
  'onboarding.execute',
  'onboarding.override',
  'onboarding.cancel',
] as const satisfies readonly PermissionCode[];

const CONTENT_CAPABILITY_CODES = ['content.view', 'content.create', 'content.send_to_client'] as const satisfies readonly PermissionCode[];
const AUTOMATION_CAPABILITY_CODES = ['automation.manage', 'automation.view'] as const satisfies readonly PermissionCode[];

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

    const activeMemberships = user.memberships.filter((m) => m.status === 'ACTIVE');

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
            organization: { include: { config: { select: { timezone: true } } } },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new AppError(401, 'Usuário inativo ou não encontrado');
    }

    const activeMemberships = user.memberships.filter((m) => m.status === 'ACTIVE');

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
      // DEC-F6-005: fuso da organização (padrão São Paulo)
      timezone: resolveTimeZone((m.organization as { config?: { timezone?: string } | null }).config?.timezone),
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

  /**
   * Resolve as capacidades RBAC efetivas do usuário para a organização ativa.
   * Não presume permissão por cargo: consulta sempre a autoridade do resolver.
   */
  async getEffectiveCapabilities(userId: string, organizationId: string): Promise<CapabilitiesResponse> {
    const resolve = (permissionCode: PermissionCode) =>
      resolveAuthorizationContext({ userId, activeOrganizationId: organizationId, permissionCode });
    const [
      projectsView,
      deliverablesView,
      deliverablesPlan,
      deliverablesRegister,
      deliverablesAdjust,
      deliverablesComplete,
      deliverablesReopen,
      projectsSync,
      onboardingFlags,
      calendarFlags,
      automationFlags,
      contentFlags,
    ] = await Promise.all([
      resolveAuthorizationContext({
        userId,
        activeOrganizationId: organizationId,
        permissionCode: 'projects.view',
      }),
      resolveAuthorizationContext({
        userId,
        activeOrganizationId: organizationId,
        permissionCode: 'deliverables.view',
      }),
      resolveAuthorizationContext({
        userId,
        activeOrganizationId: organizationId,
        permissionCode: 'deliverables.plan',
      }),
      resolve('deliverables.register'),
      resolve('deliverables.adjust_target'),
      resolve('deliverables.complete'),
      resolve('deliverables.reopen'),
      resolve('projects.sync'),
      Promise.all(ONBOARDING_CAPABILITY_CODES.map((code) => resolve(code))),
      Promise.all(CALENDAR_CAPABILITY_CODES.map((code) => resolve(code))),
      Promise.all(AUTOMATION_CAPABILITY_CODES.map((code) => resolve(code))),
      Promise.all(CONTENT_CAPABILITY_CODES.map((code) => resolve(code))),
    ]);

    if (
      projectsView.reason === 'MEMBERSHIP_NOT_ACTIVE' ||
      projectsView.reason === 'NO_MEMBERSHIP_IN_ACTIVE_ORGANIZATION'
    ) {
      throw new AppError(403, 'Membership inativa ou usuário não pertence à organização ativa');
    }

    if (projectsView.reason === 'USER_NOT_ACTIVE') {
      throw new AppError(401, 'Usuário inativo');
    }

    return {
      organizationId,
      permissions: {
        'projects.view': Boolean(projectsView.allowed),
        'projects.sync': Boolean(projectsSync.allowed),
        'deliverables.view': Boolean(deliverablesView.allowed),
        'deliverables.plan': Boolean(deliverablesPlan.allowed),
        'deliverables.register': Boolean(deliverablesRegister.allowed),
        'deliverables.adjust_target': Boolean(deliverablesAdjust.allowed),
        'deliverables.complete': Boolean(deliverablesComplete.allowed),
        'deliverables.reopen': Boolean(deliverablesReopen.allowed),
        'onboarding.view': Boolean(onboardingFlags[0].allowed),
        'onboarding.manage_templates': Boolean(onboardingFlags[1].allowed),
        'onboarding.manage_functions': Boolean(onboardingFlags[2].allowed),
        'onboarding.start': Boolean(onboardingFlags[3].allowed),
        'onboarding.execute': Boolean(onboardingFlags[4].allowed),
        'onboarding.override': Boolean(onboardingFlags[5].allowed),
        'onboarding.cancel': Boolean(onboardingFlags[6].allowed),
        'calendar.view': Boolean(calendarFlags[0].allowed),
        'calendar.link': Boolean(calendarFlags[1].allowed),
        'calendar.manage_connections': Boolean(calendarFlags[2].allowed),
        'calendar.view_all': Boolean(calendarFlags[3].allowed),
        'content.view': Boolean(contentFlags[0].allowed),
        'content.create': Boolean(contentFlags[1].allowed),
        'content.send_to_client': Boolean(contentFlags[2].allowed),
        'automation.manage': Boolean(automationFlags[0].allowed),
        'automation.view': Boolean(automationFlags[1].allowed),
      },
    };
  }
}

