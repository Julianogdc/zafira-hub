import test from 'node:test';
import assert from 'node:assert';
import {
  evaluatePermission,
  roleHasDefaultPermission,
  isValidPermissionCode
} from '../authorization/index.js';

// --- Testes da Matriz Estática (Bootstrap / Catálogo Versionado) ---
test('ADMIN possui todo catálogo default', () => {
  assert.strictEqual(roleHasDefaultPermission('ADMIN', 'admin.configure_organization'), true);
  assert.strictEqual(roleHasDefaultPermission('ADMIN', 'clients.edit'), true);
  assert.strictEqual(roleHasDefaultPermission('ADMIN', 'users.view'), true);
  assert.strictEqual(roleHasDefaultPermission('ADMIN', 'users.edit_permissions'), true);
});

test('MANAGER não possui admin.configure_organization', () => {
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'admin.configure_organization'), false);
});

test('MANAGER possui users.view mas não possui users.edit_permissions nem users.invite', () => {
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.view'), true);
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.assign_clients'), true);
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.edit_permissions'), false);
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.invite'), false);
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.edit_role'), false);
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.suspend'), false);
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'users.remove'), false);
});

test('MANAGER não possui financial.edit', () => {
  assert.strictEqual(roleHasDefaultPermission('MANAGER', 'financial.edit'), false);
});

test('MEMBER possui clients.view', () => {
  assert.strictEqual(roleHasDefaultPermission('MEMBER', 'clients.view'), true);
});

test('MEMBER não possui users.view nem users.edit_permissions', () => {
  assert.strictEqual(roleHasDefaultPermission('MEMBER', 'users.view'), false);
  assert.strictEqual(roleHasDefaultPermission('MEMBER', 'users.edit_permissions'), false);
});

test('MEMBER não possui clients.edit', () => {
  assert.strictEqual(roleHasDefaultPermission('MEMBER', 'clients.edit'), false);
});

test('permission code inválido não pode ser tratado como válido', () => {
  assert.strictEqual(isValidPermissionCode('invalid.permission'), false);
  assert.strictEqual(isValidPermissionCode('clients.edit'), true);
  assert.strictEqual(isValidPermissionCode('users.view'), true);
  assert.strictEqual(isValidPermissionCode('users.edit_permissions'), true);
});

// --- Testes do Policy Engine Puro de Runtime ---
test('evaluatePermission: override true + roleGrant false => ALLOW (GRANTED_BY_OVERRIDE)', () => {
  const result = evaluatePermission({ override: true, roleGrant: false });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, 'GRANTED_BY_OVERRIDE');
});

test('evaluatePermission: override false + roleGrant true => DENY (DENIED_BY_OVERRIDE)', () => {
  const result = evaluatePermission({ override: false, roleGrant: true });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'DENIED_BY_OVERRIDE');
});

test('evaluatePermission: sem override + roleGrant true => ALLOW (GRANTED_BY_ROLE_PERMISSION)', () => {
  const result = evaluatePermission({ roleGrant: true });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, 'GRANTED_BY_ROLE_PERMISSION');
});

test('evaluatePermission: sem override + roleGrant false => DENY (DENIED_BY_DEFAULT)', () => {
  const result = evaluatePermission({ roleGrant: false });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'DENIED_BY_DEFAULT');
});

test('evaluatePermission: false individual sempre ganha mesmo com roleGrant true', () => {
  const result = evaluatePermission({ override: false, roleGrant: true });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'DENIED_BY_OVERRIDE');
});

test('evaluatePermission: true individual sempre ganha mesmo com roleGrant false', () => {
  const result = evaluatePermission({ override: true, roleGrant: false });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, 'GRANTED_BY_OVERRIDE');
});
