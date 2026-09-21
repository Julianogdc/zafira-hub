import test from 'node:test';
import assert from 'node:assert';
import { AuditService, sanitizeAuditPayload } from '../audit.service.js';

test('AuditService - Sanitização e Serviço de Auditoria', async (t) => {
  // 1. Sanitiza passwordHash
  await t.test('1. sanitiza passwordHash e variantes case-insensitive', () => {
    const input = {
      name: 'Admin',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$secret_hash',
      password_hash: 'secret_hash_2',
      PASSWORD: 'plain_password',
    };
    const sanitized = sanitizeAuditPayload(input) as any;
    assert.strictEqual(sanitized.name, 'Admin');
    assert.strictEqual(sanitized.passwordHash, '[REDACTED]');
    assert.strictEqual(sanitized.password_hash, '[REDACTED]');
    assert.strictEqual(sanitized.PASSWORD, '[REDACTED]');
  });

  // 2. Sanitiza token nested
  await t.test('2. sanitiza token nested em múltiplos níveis', () => {
    const input = {
      user: {
        profile: {
          accessToken: 'eyJh...token1',
          refreshToken: 'refresh...token2',
        },
      },
    };
    const sanitized = sanitizeAuditPayload(input) as any;
    assert.strictEqual(sanitized.user.profile.accessToken, '[REDACTED]');
    assert.strictEqual(sanitized.user.profile.refreshToken, '[REDACTED]');
  });

  // 3. Sanitiza API key em array/object
  await t.test('3. sanitiza API key e secrets em arrays e objetos', () => {
    const input = {
      integrations: [
        { provider: 'ASANA', apiKey: 'secret_key_1', clientSecret: 'cs_1' },
        { provider: 'POSTIZ', api_key: 'secret_key_2', privateKey: 'pk_1' },
      ],
      jwt: 'jwt_val',
      authorization: 'Bearer token',
      cookie: 'session=123',
    };
    const sanitized = sanitizeAuditPayload(input) as any;
    assert.strictEqual(sanitized.integrations[0].apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.integrations[0].clientSecret, '[REDACTED]');
    assert.strictEqual(sanitized.integrations[1].api_key, '[REDACTED]');
    assert.strictEqual(sanitized.integrations[1].privateKey, '[REDACTED]');
    assert.strictEqual(sanitized.jwt, '[REDACTED]');
    assert.strictEqual(sanitized.authorization, '[REDACTED]');
    assert.strictEqual(sanitized.cookie, '[REDACTED]');
  });

  // 4. Preserva campos não sensíveis
  await t.test('4. preserva integralmente campos não sensíveis', () => {
    const input = {
      id: 'cat_123',
      name: 'Marketing e Publicidade',
      type: 'EXPENSE',
      color: '#6366f1',
      amount: 1500.5,
      active: true,
      tags: ['marketing', 'ads'],
    };
    const sanitized = sanitizeAuditPayload(input) as any;
    assert.deepStrictEqual(sanitized, input);
  });

  // 5. null / primitive / Date funcionam
  await t.test('5. trata null, undefined, primitivos e Date de forma segura', () => {
    assert.strictEqual(sanitizeAuditPayload(null), null);
    assert.strictEqual(sanitizeAuditPayload(undefined), undefined);
    assert.strictEqual(sanitizeAuditPayload(123), 123);
    assert.strictEqual(sanitizeAuditPayload('test_str'), 'test_str');
    assert.strictEqual(sanitizeAuditPayload(true), true);

    const d = new Date('2026-09-21T10:00:00.000Z');
    assert.strictEqual(sanitizeAuditPayload(d), '2026-09-21T10:00:00.000Z');
  });

  // 6. record usa organizationId informado
  await t.test('6. record cria registro com organizationId e campos informados', async () => {
    let capturedData: any = null;
    const mockPrisma: any = {
      auditLog: {
        create: async ({ data }: any) => {
          capturedData = data;
          return { id: 'audit_1', ...data, createdAt: new Date() };
        },
      },
    };

    const service = new AuditService(mockPrisma);
    const result = await service.record({
      organizationId: 'org_test_1',
      actorUserId: 'usr_actor_1',
      action: 'financial_category.created',
      entityType: 'FinancialCategory',
      entityId: 'cat_1',
      after: { name: 'Receita', type: 'INCOME' },
    });

    assert.strictEqual(capturedData.organizationId, 'org_test_1');
    assert.strictEqual(capturedData.actorUserId, 'usr_actor_1');
    assert.strictEqual(capturedData.action, 'financial_category.created');
    assert.strictEqual(capturedData.entityType, 'FinancialCategory');
    assert.strictEqual(capturedData.entityId, 'cat_1');
    assert.strictEqual(result.id, 'audit_1');
  });

  // 7. record não expõe segredo
  await t.test('7. record sanitiza dados antes de persistir no banco', async () => {
    let capturedData: any = null;
    const mockPrisma: any = {
      auditLog: {
        create: async ({ data }: any) => {
          capturedData = data;
          return { id: 'audit_2', ...data, createdAt: new Date() };
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.record({
      organizationId: 'org_test_1',
      action: 'user.created',
      entityType: 'User',
      before: { passwordHash: '$argon2id$...secret' },
      after: { apiKey: 'super_secret_key', email: 'user@zafira.com' },
      metadata: { token: 'bearer_token_xyz' },
    });

    assert.strictEqual(capturedData.before.passwordHash, '[REDACTED]');
    assert.strictEqual(capturedData.after.apiKey, '[REDACTED]');
    assert.strictEqual(capturedData.after.email, 'user@zafira.com');
    assert.strictEqual(capturedData.metadata.token, '[REDACTED]');
  });

  // 8. list sempre filtra organizationId
  await t.test('8. list sempre filtra estritamente por organizationId', async () => {
    let capturedWhere: any = null;
    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ where }: any) => {
          capturedWhere = where;
          return [];
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.list({ organizationId: 'org_safe_tenant' });

    assert.strictEqual(capturedWhere.organizationId, 'org_safe_tenant');
  });

  // 9. limit default 50
  await t.test('9. limit default é 50 (take 51 para cursor)', async () => {
    let capturedTake: number | null = null;
    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ take }: any) => {
          capturedTake = take;
          return [];
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.list({ organizationId: 'org_1' });

    assert.strictEqual(capturedTake, 51); // 50 + 1 para checagem de nextCursor
  });

  // 10. limit > 100 é limitado a 100
  await t.test('10. limit acima de 100 é limitado ao máximo de 100', async () => {
    let capturedTake: number | null = null;
    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ take }: any) => {
          capturedTake = take;
          return [];
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.list({ organizationId: 'org_1', limit: 500 });

    assert.strictEqual(capturedTake, 101); // 100 + 1
  });

  // 11. filtro action
  await t.test('11. list aplica filtro opcional por action', async () => {
    let capturedWhere: any = null;
    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ where }: any) => {
          capturedWhere = where;
          return [];
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.list({ organizationId: 'org_1', action: 'user.suspended' });

    assert.strictEqual(capturedWhere.organizationId, 'org_1');
    assert.strictEqual(capturedWhere.action, 'user.suspended');
  });

  // 12. filtro entityType
  await t.test('12. list aplica filtro opcional por entityType e actorUserId', async () => {
    let capturedWhere: any = null;
    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ where }: any) => {
          capturedWhere = where;
          return [];
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.list({
      organizationId: 'org_1',
      entityType: 'FinancialCategory',
      actorUserId: 'usr_actor_99',
    });

    assert.strictEqual(capturedWhere.organizationId, 'org_1');
    assert.strictEqual(capturedWhere.entityType, 'FinancialCategory');
    assert.strictEqual(capturedWhere.actorUserId, 'usr_actor_99');
  });
});
