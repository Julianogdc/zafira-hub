import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { PrismaClient, Prisma, OrganizationConfig } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 100) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrency(cur: string): boolean {
  return typeof cur === 'string' && /^[A-Z]{3}$/.test(cur.trim());
}

export function isValidLocale(loc: string): boolean {
  if (typeof loc !== 'string' || !loc.trim() || loc.length > 35) return false;
  return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})*$/.test(loc.trim());
}

export interface UpdateConfigInput {
  locale?: string;
  timezone?: string;
  currency?: string;
}

export class OrganizationConfigService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /**
   * Obtém ou inicializa deterministicamente a configuração padrão da organização.
   */
  async getConfig(organizationId: string): Promise<OrganizationConfig> {
    if (!organizationId) {
      throw new Error('organizationId é obrigatório para obter configuração');
    }

    const existing = await this.prisma.organizationConfig.findUnique({
      where: { organizationId },
    });

    if (existing) {
      return existing;
    }

    // Upsert idempotente de configuração padrão
    return this.prisma.organizationConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        locale: 'pt-BR',
        timezone: 'UTC',
        currency: 'BRL',
      },
      update: {},
    });
  }

  /**
   * Atualiza as configurações da organização com auditoria atômica via transaction.
   */
  async updateConfig(
    organizationId: string,
    actorUserId: string | null | undefined,
    input: UpdateConfigInput
  ): Promise<OrganizationConfig> {
    if (!organizationId) {
      throw new Error('organizationId é obrigatório para atualizar configuração');
    }

    if (input.locale !== undefined) {
      if (!isValidLocale(input.locale)) {
        throw new Error('Formato de locale inválido');
      }
    }

    if (input.timezone !== undefined) {
      if (!isValidTimezone(input.timezone)) {
        throw new Error('Timezone IANA inválido');
      }
    }

    if (input.currency !== undefined) {
      if (!isValidCurrency(input.currency)) {
        throw new Error('Código de moeda ISO inválido (deve conter 3 letras maiúsculas)');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Obter estado anterior
      const before = await tx.organizationConfig.findUnique({
        where: { organizationId },
      });

      const beforeState = before
        ? {
            locale: before.locale,
            timezone: before.timezone,
            currency: before.currency,
          }
        : {
            locale: 'pt-BR',
            timezone: 'UTC',
            currency: 'BRL',
          };

      // 2. Atualizar ou criar configuração
      const updated = await tx.organizationConfig.upsert({
        where: { organizationId },
        create: {
          organizationId,
          locale: input.locale ? input.locale.trim() : 'pt-BR',
          timezone: input.timezone ? input.timezone.trim() : 'UTC',
          currency: input.currency ? input.currency.trim().toUpperCase() : 'BRL',
        },
        update: {
          ...(input.locale !== undefined ? { locale: input.locale.trim() } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone.trim() } : {}),
          ...(input.currency !== undefined ? { currency: input.currency.trim().toUpperCase() } : {}),
        },
      });

      // 3. Registrar AuditLog atômico
      const audit = new AuditService(tx);
      await audit.record({
        organizationId,
        actorUserId: actorUserId || null,
        action: 'organization.config_changed',
        entityType: 'OrganizationConfig',
        entityId: organizationId,
        before: beforeState,
        after: {
          locale: updated.locale,
          timezone: updated.timezone,
          currency: updated.currency,
        },
      });

      return updated;
    });
  }
}

export const organizationConfigService = new OrganizationConfigService();
