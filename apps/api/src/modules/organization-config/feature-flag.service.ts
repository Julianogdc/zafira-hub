import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { PrismaClient } from '@prisma/client';
import { FEATURE_FLAGS, isValidFeatureFlagKey, FeatureFlagKey } from '@zafira/domain';
import { AuditService } from '../audit/audit.service.js';

export interface FeatureFlagItem {
  key: FeatureFlagKey;
  enabled: boolean;
}

export class FeatureFlagService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /**
   * Lista todas as feature flags do catálogo para a organização.
   * Chaves não persistidas retornam enabled: false.
   */
  async listFlags(organizationId: string): Promise<FeatureFlagItem[]> {
    if (!organizationId) {
      throw new Error('organizationId é obrigatório para listar feature flags');
    }

    const persisted = await this.prisma.organizationFeatureFlag.findMany({
      where: { organizationId },
    });

    const persistedMap = new Map<string, boolean>();
    for (const flag of persisted) {
      persistedMap.set(flag.key, flag.enabled);
    }

    return FEATURE_FLAGS.map((key) => ({
      key,
      enabled: persistedMap.get(key) ?? false,
    }));
  }

  /**
   * Consulta se uma feature flag específica está habilitada para a organização.
   */
  async isEnabled(organizationId: string, key: string): Promise<boolean> {
    if (!organizationId || !isValidFeatureFlagKey(key)) {
      return false;
    }

    const flag = await this.prisma.organizationFeatureFlag.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key,
        },
      },
    });

    return flag?.enabled ?? false;
  }

  /**
   * Define o estado de uma feature flag com validação de catálogo e auditoria atômica.
   */
  async setFlag(
    organizationId: string,
    actorUserId: string | null | undefined,
    key: string,
    enabled: boolean
  ): Promise<FeatureFlagItem> {
    if (!organizationId) {
      throw new Error('organizationId é obrigatório para alterar feature flag');
    }

    if (!isValidFeatureFlagKey(key)) {
      throw new Error(`Chave de feature flag inválida ou desconhecida: "${key}"`);
    }

    if (typeof enabled !== 'boolean') {
      throw new Error('O valor de "enabled" deve ser booleano');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Estado anterior
      const existing = await tx.organizationFeatureFlag.findUnique({
        where: {
          organizationId_key: {
            organizationId,
            key,
          },
        },
      });

      const beforeState = {
        key,
        enabled: existing ? existing.enabled : false,
      };

      // 2. Gravação ou atualização da flag
      const updated = await tx.organizationFeatureFlag.upsert({
        where: {
          organizationId_key: {
            organizationId,
            key,
          },
        },
        create: {
          organizationId,
          key,
          enabled,
        },
        update: {
          enabled,
        },
      });

      // 3. Auditoria atômica (Etapa I)
      const audit = new AuditService(tx);
      await audit.record({
        organizationId,
        actorUserId: actorUserId || null,
        action: 'feature_flag.changed',
        entityType: 'OrganizationFeatureFlag',
        entityId: key,
        before: beforeState,
        after: {
          key: updated.key,
          enabled: updated.enabled,
        },
      });

      return {
        key: updated.key as FeatureFlagKey,
        enabled: updated.enabled,
      };
    });
  }
}

export const featureFlagService = new FeatureFlagService();
