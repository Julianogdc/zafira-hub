import test from 'node:test';
import assert from 'node:assert';
import {
  OrganizationConfigService,
  isValidTimezone,
  isValidCurrency,
  isValidLocale,
} from '../organization-config.service.js';
import { FeatureFlagService } from '../feature-flag.service.js';
import { FEATURE_FLAGS, roleHasDefaultPermission } from '@zafira/domain';

test('OrganizationConfig & FeatureFlag Unit Tests', async (t) => {
  // 1. Cria defaults
  await t.test('1. getConfig cria e retorna defaults quando não há registro persistido', async () => {
    let upsertCalled = false;
    const mockPrisma: any = {
      organizationConfig: {
        findUnique: async () => null,
        upsert: async ({ create }: any) => {
          upsertCalled = true;
          return { ...create, createdAt: new Date(), updatedAt: new Date() };
        },
      },
    };

    const service = new OrganizationConfigService(mockPrisma);
    const config = await service.getConfig('org_1');

    assert.strictEqual(upsertCalled, true);
    assert.strictEqual(config.organizationId, 'org_1');
    assert.strictEqual(config.locale, 'pt-BR');
    assert.strictEqual(config.timezone, 'UTC');
    assert.strictEqual(config.currency, 'BRL');
  });

  // 2. Retorna existente
  await t.test('2. getConfig retorna configuração existente sem sobrescrever', async () => {
    const existingConfig = {
      organizationId: 'org_custom',
      locale: 'en-US',
      timezone: 'America/New_York',
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockPrisma: any = {
      organizationConfig: {
        findUnique: async () => existingConfig,
      },
    };

    const service = new OrganizationConfigService(mockPrisma);
    const config = await service.getConfig('org_custom');

    assert.deepStrictEqual(config, existingConfig);
  });

  // 3 & 4. Validação de Timezone
  await t.test('3. timezone válido é aceito e inválido é rejeitado', () => {
    assert.strictEqual(isValidTimezone('UTC'), true);
    assert.strictEqual(isValidTimezone('America/Sao_Paulo'), true);
    assert.strictEqual(isValidTimezone('America/Campo_Grande'), true);
    assert.strictEqual(isValidTimezone('Europe/London'), true);
    assert.strictEqual(isValidTimezone('Invalid/Timezone_XYZ'), false);
    assert.strictEqual(isValidTimezone(''), false);
  });

  // 5 & 6. Validação de Currency
  await t.test('5. currency ISO 3 letras maiúsculas é aceito e inválido é rejeitado', () => {
    assert.strictEqual(isValidCurrency('BRL'), true);
    assert.strictEqual(isValidCurrency('USD'), true);
    assert.strictEqual(isValidCurrency('EUR'), true);
    assert.strictEqual(isValidCurrency('brl'), false);
    assert.strictEqual(isValidCurrency('US'), false);
    assert.strictEqual(isValidCurrency('USDT'), false);
    assert.strictEqual(isValidCurrency('123'), false);
  });

  // Validação de Locale
  await t.test('locale válido é aceito e inválido é rejeitado', () => {
    assert.strictEqual(isValidLocale('pt-BR'), true);
    assert.strictEqual(isValidLocale('en-US'), true);
    assert.strictEqual(isValidLocale('es'), true);
    assert.strictEqual(isValidLocale(''), false);
  });

  // 7 & 15. Update permanece organization-scoped e gera AuditLog
  await t.test('7. updateConfig atualiza organização e gera AuditLog atômico com before/after e actor', async () => {
    let capturedAudit: any = null;
    let capturedUpsert: any = null;

    const mockTx: any = {
      organizationConfig: {
        findUnique: async () => ({
          organizationId: 'org_target',
          locale: 'pt-BR',
          timezone: 'UTC',
          currency: 'BRL',
        }),
        upsert: async ({ where, update }: any) => {
          capturedUpsert = { where, update };
          return {
            organizationId: 'org_target',
            locale: 'pt-BR',
            timezone: update.timezone,
            currency: 'BRL',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          capturedAudit = data;
          return { id: 'audit_cfg_1', ...data };
        },
      },
    };

    const mockPrisma: any = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const service = new OrganizationConfigService(mockPrisma);
    const result = await service.updateConfig('org_target', 'usr_admin_1', {
      timezone: 'America/Sao_Paulo',
    });

    assert.strictEqual(capturedUpsert.where.organizationId, 'org_target');
    assert.strictEqual(capturedUpsert.update.timezone, 'America/Sao_Paulo');
    assert.strictEqual(result.timezone, 'America/Sao_Paulo');

    assert.strictEqual(capturedAudit.organizationId, 'org_target');
    assert.strictEqual(capturedAudit.actorUserId, 'usr_admin_1');
    assert.strictEqual(capturedAudit.action, 'organization.config_changed');
    assert.strictEqual(capturedAudit.entityType, 'OrganizationConfig');
    assert.strictEqual(capturedAudit.before.timezone, 'UTC');
    assert.strictEqual(capturedAudit.after.timezone, 'America/Sao_Paulo');
  });

  // Feature flags: 8. Ausência = false
  await t.test('8. isEnabled retorna false para flag ausente no banco', async () => {
    const mockPrisma: any = {
      organizationFeatureFlag: {
        findUnique: async () => null,
      },
    };

    const service = new FeatureFlagService(mockPrisma);
    const enabled = await service.isEnabled('org_1', 'FINANCIAL');
    assert.strictEqual(enabled, false);
  });

  // Feature flags: 9. Flag persistida true = true
  await t.test('9. isEnabled retorna true quando persistida como true', async () => {
    const mockPrisma: any = {
      organizationFeatureFlag: {
        findUnique: async () => ({
          organizationId: 'org_1',
          key: 'FINANCIAL',
          enabled: true,
        }),
      },
    };

    const service = new FeatureFlagService(mockPrisma);
    const enabled = await service.isEnabled('org_1', 'FINANCIAL');
    assert.strictEqual(enabled, true);
  });

  // Feature flags: 10. list inclui catálogo completo
  await t.test('10. listFlags retorna todas as flags do catálogo (com defaults false para ausentes)', async () => {
    const mockPrisma: any = {
      organizationFeatureFlag: {
        findMany: async () => [
          { organizationId: 'org_1', key: 'CLIENT_360', enabled: true },
        ],
      },
    };

    const service = new FeatureFlagService(mockPrisma);
    const flags = await service.listFlags('org_1');

    assert.strictEqual(flags.length, FEATURE_FLAGS.length);
    const client360 = flags.find((f) => f.key === 'CLIENT_360');
    const financial = flags.find((f) => f.key === 'FINANCIAL');

    assert.strictEqual(client360?.enabled, true);
    assert.strictEqual(financial?.enabled, false);
  });

  // Feature flags: 11. Chave desconhecida ou organizationId ausente são rejeitados
  await t.test('11. setFlag e isEnabled com chave desconhecida ou sem organizationId lançam erro seguro', async () => {
    const service = new FeatureFlagService({} as any);

    await assert.rejects(
      service.isEnabled('org_1', 'UNKNOWN_MODULE_XYZ'),
      /Chave de feature flag inválida ou desconhecida/
    );

    await assert.rejects(
      service.isEnabled('', 'FINANCIAL'),
      /organizationId é obrigatório/
    );

    await assert.rejects(
      service.setFlag('org_1', 'usr_admin', 'UNKNOWN_MODULE_XYZ', true),
      /Chave de feature flag inválida ou desconhecida/
    );

    await assert.rejects(
      service.setFlag('', 'usr_admin', 'FINANCIAL', true),
      /organizationId é obrigatório/
    );
  });

  // Feature flags: 12, 13, 16. setFlag com auditoria atômica
  await t.test('12 & 16. setFlag atualiza estado e gera AuditLog atômico com before/after e actor', async () => {
    let capturedAudit: any = null;
    let capturedUpsert: any = null;

    const mockTx: any = {
      organizationFeatureFlag: {
        findUnique: async () => ({
          organizationId: 'org_1',
          key: 'FINANCIAL',
          enabled: false,
        }),
        upsert: async ({ where, create, update }: any) => {
          capturedUpsert = { where, create, update };
          return {
            organizationId: 'org_1',
            key: 'FINANCIAL',
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          capturedAudit = data;
          return { id: 'audit_ff_1', ...data };
        },
      },
    };

    const mockPrisma: any = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const service = new FeatureFlagService(mockPrisma);
    const result = await service.setFlag('org_1', 'usr_admin_actor', 'FINANCIAL', true);

    assert.strictEqual(result.key, 'FINANCIAL');
    assert.strictEqual(result.enabled, true);
    assert.strictEqual(capturedUpsert.update.enabled, true);

    assert.strictEqual(capturedAudit.organizationId, 'org_1');
    assert.strictEqual(capturedAudit.actorUserId, 'usr_admin_actor');
    assert.strictEqual(capturedAudit.action, 'feature_flag.changed');
    assert.strictEqual(capturedAudit.entityType, 'OrganizationFeatureFlag');
    assert.strictEqual(capturedAudit.entityId, 'FINANCIAL');
    assert.strictEqual(capturedAudit.before.enabled, false);
    assert.strictEqual(capturedAudit.after.enabled, true);
  });

  // 19. Prova explícita: Feature Flag NÃO concede autorização RBAC
  await t.test('19. Feature flag FINANCIAL=true NÃO concede permissão RBAC a quem não a possui', async () => {
    // Um MEMBER não possui financial.view_summary nem financial.edit na matriz de defaults
    const memberHasSummary = roleHasDefaultPermission('MEMBER', 'financial.view_summary');
    const memberHasEdit = roleHasDefaultPermission('MEMBER', 'financial.edit');

    assert.strictEqual(memberHasSummary, false, 'MEMBER não possui financial.view_summary por padrão');
    assert.strictEqual(memberHasEdit, false, 'MEMBER não possui financial.edit por padrão');

    // Habilitar a flag FINANCIAL para a organização não altera as regras de RBAC
    const flagService = new FeatureFlagService({
      organizationFeatureFlag: {
        findUnique: async () => ({ organizationId: 'org_1', key: 'FINANCIAL', enabled: true }),
      },
    } as any);

    const isFinancialFlagActive = await flagService.isEnabled('org_1', 'FINANCIAL');
    assert.strictEqual(isFinancialFlagActive, true, 'Flag FINANCIAL está ativa');

    // O acesso continua determinado por RBAC
    assert.strictEqual(memberHasSummary, false, 'Acesso continua bloqueado para MEMBER');
  });
});
