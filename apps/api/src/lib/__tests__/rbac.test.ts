import test from 'node:test';
import assert from 'node:assert';
import { resolveAuthorizationContext } from '../../modules/authorization/resolver.js';
import { evaluatePermission, roleHasDefaultPermission } from '@zafira/domain';

test('RBAC Backend Resolver e Engine Puros', async (t) => {
  await t.test('usuário sem activeOrganizationId é negado', async () => {
    const result = await resolveAuthorizationContext({
      userId: 'user-123',
      activeOrganizationId: '',
      permissionCode: 'clients.view'
    });
    
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'NO_ACTIVE_ORGANIZATION');
  });

  await t.test('ADMIN possui clients.edit na matriz de defaults', () => {
    const hasDefault = roleHasDefaultPermission('ADMIN', 'clients.edit');
    assert.strictEqual(hasDefault, true);
  });

  await t.test('MANAGER possui clients.edit na matriz de defaults', () => {
    const hasDefault = roleHasDefaultPermission('MANAGER', 'clients.edit');
    assert.strictEqual(hasDefault, true);
  });

  await t.test('MEMBER não possui clients.edit na matriz de defaults', () => {
    const hasDefault = roleHasDefaultPermission('MEMBER', 'clients.edit');
    assert.strictEqual(hasDefault, false);
  });

  await t.test('evaluatePermission com roleGrant true concede acesso', () => {
    const result = evaluatePermission({
      roleGrant: true
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'GRANTED_BY_ROLE_PERMISSION');
  });

  await t.test('evaluatePermission com roleGrant false nega acesso por default', () => {
    const result = evaluatePermission({
      roleGrant: false
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'DENIED_BY_DEFAULT');
  });

  await t.test('override grant funciona mesmo com roleGrant false', () => {
    const result = evaluatePermission({
      override: true,
      roleGrant: false
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'GRANTED_BY_OVERRIDE');
  });

  await t.test('override deny funciona mesmo com roleGrant true', () => {
    const result = evaluatePermission({
      override: false,
      roleGrant: true
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'DENIED_BY_OVERRIDE');
  });
});
