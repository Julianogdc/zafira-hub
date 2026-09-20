import test from 'node:test';
import assert from 'node:assert';
import {
  evaluatePermission,
  roleHasDefaultPermission,
  isValidPermissionCode
} from '../authorization/index.js';

test('ADMIN possui todo catálogo default', () => {
  assert.strictEqual(roleHasDefaultPermission('ADMIN', 'admin.configure_organization'), true);
  assert.strictEqual(roleHasDefaultPermission('ADMIN', 'clients.edit'), true);
});

test('MANAGER não possui admin.configure_organization', () => {
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'admin.configure_organization'), false);
});

test('MANAGER não possui financial.edit', () => {
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'financial.edit'), false);
});

test('MEMBER possui clients.view', () => {
  assert.strictEqual(roleHasDefaultPermission('MEMBER', 'clients.view'), true);
});

test('MEMBER não possui clients.edit', () => {
  assert.strictEqual(roleHasDefaultPermission('MEMBER', 'clients.edit'), false);
});

test('override true concede permissão não default', () => {
  const result = evaluatePermission({ role: 'MEMBER', permission: 'clients.edit', override: true });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, 'GRANTED_BY_OVERRIDE');
});

test('override false remove permissão default', () => {
  const result = evaluatePermission({ role: 'ADMIN', permission: 'clients.edit', override: false });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'DENIED_BY_OVERRIDE');
});

test('ausência de grant = deny', () => {
  const result = evaluatePermission({ role: 'MEMBER', permission: 'clients.edit' });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'DENIED_BY_DEFAULT');
});

test('permission code inválido não pode ser tratado como válido', () => {
  assert.strictEqual(isValidPermissionCode('invalid.permission'), false);
  assert.strictEqual(isValidPermissionCode('clients.edit'), true);
});
