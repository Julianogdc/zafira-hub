import test from 'node:test';
import assert from 'node:assert';
import { buildClientResourceScopeWhere } from '../client-resource-scope.js';
import { evaluatePermission } from '@zafira/domain';

test('Client Resource Scope e Separação de Permission vs Resource Scope', async (t) => {
  await t.test('1. ADMIN possui escopo organization-wide (sem filtro de atribuição)', () => {
    const scope = buildClientResourceScopeWhere({
      organizationId: 'org_123',
      membershipId: 'mem_admin',
      role: 'ADMIN',
    });

    assert.deepStrictEqual(scope, {
      organizationId: 'org_123',
    });
  });

  await t.test('2. MANAGER possui escopo por união de Direct Assignment + Active Team Assignment', () => {
    const scope = buildClientResourceScopeWhere({
      organizationId: 'org_123',
      membershipId: 'mem_mgr',
      role: 'MANAGER',
    });

    assert.strictEqual(scope.organizationId, 'org_123');
    assert.ok(Array.isArray(scope.OR));
    assert.strictEqual(scope.OR.length, 2);

    // Direct assignment check
    assert.deepStrictEqual(scope.OR[0], {
      assignedMembers: {
        some: {
          organizationMemberId: 'mem_mgr',
        },
      },
    });

    // Team assignment check
    assert.deepStrictEqual(scope.OR[1], {
      teamAssignments: {
        some: {
          team: {
            isActive: true,
            members: {
              some: {
                organizationMemberId: 'mem_mgr',
              },
            },
          },
        },
      },
    });
  });

  await t.test('3. MEMBER possui escopo por união de Direct Assignment + Active Team Assignment', () => {
    const scope = buildClientResourceScopeWhere({
      organizationId: 'org_456',
      membershipId: 'mem_user',
      role: 'MEMBER',
    });

    assert.strictEqual(scope.organizationId, 'org_456');
    assert.ok(Array.isArray(scope.OR));
    assert.strictEqual(scope.OR.length, 2);
    assert.deepStrictEqual(scope.OR[0], {
      assignedMembers: {
        some: {
          organizationMemberId: 'mem_user',
        },
      },
    });
    assert.deepStrictEqual(scope.OR[1], {
      teamAssignments: {
        some: {
          team: {
            isActive: true,
            members: {
              some: {
                organizationMemberId: 'mem_user',
              },
            },
          },
        },
      },
    });
  });

  await t.test('4. Team NÃO concede permission: override clients.view = false nega acesso mesmo se pertencer à equipe', () => {
    const evalResult = evaluatePermission({
      roleGrant: true,
      override: false,
    });

    assert.strictEqual(evalResult.allowed, false);
    assert.strictEqual(evalResult.reason, 'DENIED_BY_OVERRIDE');
    // Prova de que a permissão responde "o usuário pode executar a ação?" e falha antes de resource scope
  });
});
