import test from 'node:test';
import assert from 'node:assert';
import { resolveAuthorizationContext } from '../../modules/authorization/resolver.js';
import { evaluatePermission } from '@zafira/domain';

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

  await t.test('ADMIN recebe clients.edit default', () => {
    const result = evaluatePermission({
      role: 'ADMIN',
      permission: 'clients.edit'
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'GRANTED_BY_ROLE_DEFAULT');
  });

  await t.test('MANAGER recebe clients.edit default', () => {
    const result = evaluatePermission({
      role: 'MANAGER',
      permission: 'clients.edit'
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'GRANTED_BY_ROLE_DEFAULT');
  });

  await t.test('MEMBER não recebe clients.edit default', () => {
    const result = evaluatePermission({
      role: 'MEMBER',
      permission: 'clients.edit'
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'DENIED_BY_DEFAULT');
  });

  await t.test('override grant para MEMBER funciona', () => {
    const result = evaluatePermission({
      role: 'MEMBER',
      permission: 'clients.edit',
      override: true
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'GRANTED_BY_OVERRIDE');
  });

  await t.test('override deny para ADMIN/MANAGER funciona', () => {
    const result = evaluatePermission({
      role: 'ADMIN',
      permission: 'clients.edit',
      override: false
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'DENIED_BY_OVERRIDE');
  });
});
