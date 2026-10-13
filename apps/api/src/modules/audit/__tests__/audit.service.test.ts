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

  // 3. Sanitiza API key em array/object e x-api-key
  await t.test('3. sanitiza API key, x-api-key e secrets em arrays e objetos', () => {
    const input = {
      integrations: [
        { provider: 'ASANA', apiKey: 'secret_key_1', clientSecret: 'cs_1' },
        { provider: 'POSTIZ', api_key: 'secret_key_2', privateKey: 'pk_1' },
      ],
      jwt: 'jwt_val',
      authorization: 'Bearer token',
      cookie: 'session=123',
      headers: {
        'x-api-key': 'secret_internal_key',
        'X-API-KEY': 'another_secret',
      },
    };
    const sanitized = sanitizeAuditPayload(input) as any;
    assert.strictEqual(sanitized.integrations[0].apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.integrations[0].clientSecret, '[REDACTED]');
    assert.strictEqual(sanitized.integrations[1].api_key, '[REDACTED]');
    assert.strictEqual(sanitized.integrations[1].privateKey, '[REDACTED]');
    assert.strictEqual(sanitized.jwt, '[REDACTED]');
    assert.strictEqual(sanitized.authorization, '[REDACTED]');
    assert.strictEqual(sanitized.cookie, '[REDACTED]');
    assert.strictEqual(sanitized.headers['x-api-key'], '[REDACTED]');
    assert.strictEqual(sanitized.headers['X-API-KEY'], '[REDACTED]');
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

  // 5.1. Normalização de undefined nested
  await t.test('5.1. normaliza undefined nested omitindo propriedades em objetos e convertendo para null em arrays', () => {
    const input = {
      title: 'Valid Field',
      emptyField: undefined,
      nested: {
        keepThis: 123,
        removeThis: undefined,
      },
      list: ['item1', undefined, 'item3'],
    };
    const sanitized = sanitizeAuditPayload(input) as any;
    assert.strictEqual(sanitized.title, 'Valid Field');
    assert.strictEqual('emptyField' in sanitized, false);
    assert.strictEqual(sanitized.nested.keepThis, 123);
    assert.strictEqual('removeThis' in sanitized.nested, false);
    assert.deepStrictEqual(sanitized.list, ['item1', null, 'item3']);
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
      metadata: { token: 'bearer_token_xyz', 'x-api-key': 'hdr_key_secret' },
    });

    assert.strictEqual(capturedData.before.passwordHash, '[REDACTED]');
    assert.strictEqual(capturedData.after.apiKey, '[REDACTED]');
    assert.strictEqual(capturedData.after.email, 'user@zafira.com');
    assert.strictEqual(capturedData.metadata.token, '[REDACTED]');
    assert.strictEqual(capturedData.metadata['x-api-key'], '[REDACTED]');
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

  // 13. Paginação Lossless (sem perda e sem duplicação de itens)
  await t.test('13. paginação lossless com cursor do último item retornado (sem pular registros)', async () => {
    // 3 registros no banco ordenados desc
    const allDbRecords = [
      { id: 'log_1', action: 'action.1', createdAt: new Date('2026-09-21T12:00:00Z') },
      { id: 'log_2', action: 'action.2', createdAt: new Date('2026-09-21T11:00:00Z') },
      { id: 'log_3', action: 'action.3', createdAt: new Date('2026-09-21T10:00:00Z') },
    ];

    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ take, cursor, skip }: any) => {
          let startIndex = 0;
          if (cursor) {
            const foundIndex = allDbRecords.findIndex((r) => r.id === cursor.id);
            startIndex = foundIndex !== -1 ? foundIndex + (skip || 0) : 0;
          }
          return allDbRecords.slice(startIndex, startIndex + take).map((r) => ({ ...r }));
        },
      },
    };

    const service = new AuditService(mockPrisma);

    // Página 1: limit 2 => busca 3, retorna log_1 e log_2, nextCursor = log_2
    const page1 = await service.list({ organizationId: 'org_1', limit: 2 });
    assert.strictEqual(page1.items.length, 2);
    assert.strictEqual(page1.items[0].id, 'log_1');
    assert.strictEqual(page1.items[1].id, 'log_2');
    assert.strictEqual(page1.nextCursor, 'log_2', 'nextCursor DEVE ser o ID do último item retornado (log_2)');

    // Página 2: usando nextCursor 'log_2' => com skip 1 no cursor, deve retornar log_3
    const page2 = await service.list({ organizationId: 'org_1', limit: 2, cursor: page1.nextCursor! });
    assert.strictEqual(page2.items.length, 1);
    assert.strictEqual(page2.items[0].id, 'log_3', 'Página 2 DEVE retornar exatamente log_3');
    assert.strictEqual(page2.nextCursor, null, 'nextCursor da última página DEVE ser null');

    // Prova de completude e unicidade: todos os itens vistos
    const allSeenIds = [...page1.items.map((i: any) => i.id), ...page2.items.map((i: any) => i.id)];
    assert.deepStrictEqual(allSeenIds, ['log_1', 'log_2', 'log_3'], 'Nenhum registro foi perdido nem duplicado');
  });

  // 14. Ordenação Determinística com tie-breaker id
  await t.test('14. list solicita ordenação determinística [createdAt desc, id desc]', async () => {
    let capturedOrderBy: any = null;
    const mockPrisma: any = {
      auditLog: {
        findMany: async ({ orderBy }: any) => {
          capturedOrderBy = orderBy;
          return [];
        },
      },
    };

    const service = new AuditService(mockPrisma);
    await service.list({ organizationId: 'org_1' });

    assert.deepStrictEqual(capturedOrderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
