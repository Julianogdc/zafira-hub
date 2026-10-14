import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, ADMIN_DEFAULTS, MANAGER_DEFAULTS, MEMBER_DEFAULTS } from '@zafira/domain';
import {
  RbacDefaultsInvalidError,
  assertRbacDefaultsSane,
  computeRbacSyncPlan,
  formatRbacSyncReport,
  type RbacDefaults,
  type RbacState,
} from '../rbac-sync.js';

// HM-1 / H1 (P22): sincronizacao das permissoes padrao dos papeis, sem tocar em excecoes individuais.

const real: RbacDefaults = { ADMIN: ADMIN_DEFAULTS, MANAGER: MANAGER_DEFAULTS, MEMBER: MEMBER_DEFAULTS };
const cleanState = (): RbacState => ({
  catalogCodes: [...PERMISSIONS],
  rolePermissions: [
    ...ADMIN_DEFAULTS.map((c) => ({ role: 'ADMIN', permissionCode: c })),
    ...MANAGER_DEFAULTS.map((c) => ({ role: 'MANAGER', permissionCode: c })),
    ...MEMBER_DEFAULTS.map((c) => ({ role: 'MEMBER', permissionCode: c })),
  ],
});

test('banco em sincronia: nada a fazer', () => {
  const plan = computeRbacSyncPlan(PERMISSIONS, real, cleanState());
  assert.equal(plan.inSync, true);
  assert.deepEqual([plan.catalogToCreate, plan.grantsToAdd, plan.grantsToRemove, plan.catalogObsolete], [[], [], [], []]);
  assert.equal(plan.unchanged, ADMIN_DEFAULTS.length + MANAGER_DEFAULTS.length + MEMBER_DEFAULTS.length);
});

test('formato antigo: MEMBER com deliverables.complete (P22) e codigo obsoleto sao removidos', () => {
  const state = cleanState();
  state.rolePermissions = [
    ...state.rolePermissions,
    { role: 'MEMBER', permissionCode: 'deliverables.complete' },
    { role: 'MANAGER', permissionCode: 'legacy.removed_code' },
  ];
  state.catalogCodes = [...state.catalogCodes, 'legacy.removed_code'];
  const plan = computeRbacSyncPlan(PERMISSIONS, real, state);
  assert.deepEqual(plan.grantsToRemove, [
    { role: 'MANAGER', permissionCode: 'legacy.removed_code' },
    { role: 'MEMBER', permissionCode: 'deliverables.complete' },
  ]);
  assert.deepEqual(plan.catalogObsolete, ['legacy.removed_code'], 'catalogo obsoleto so e relatado');
  assert.deepEqual(plan.grantsToAdd, []);
  assert.equal(plan.inSync, false);
});

test('permissao nova no catalogo e nos padroes: criada e acrescentada, sem remover nada', () => {
  const state = cleanState();
  state.catalogCodes = state.catalogCodes.filter((c) => c !== 'content.schedule');
  state.rolePermissions = state.rolePermissions.filter((r) => r.permissionCode !== 'content.schedule');
  const plan = computeRbacSyncPlan(PERMISSIONS, real, state);
  assert.deepEqual(plan.catalogToCreate, ['content.schedule']);
  assert.ok(plan.grantsToAdd.every((g) => g.permissionCode === 'content.schedule'));
  assert.deepEqual(plan.grantsToRemove, []);
});

test('papel desconhecido nunca e alterado, so contado', () => {
  const state = cleanState();
  state.rolePermissions = [...state.rolePermissions, { role: 'OWNER', permissionCode: 'clients.view' }];
  const plan = computeRbacSyncPlan(PERMISSIONS, real, state);
  assert.equal(plan.unknownRoleRows, 1);
  assert.equal(plan.grantsToRemove.length, 0);
  assert.equal(plan.inSync, true);
});

test('o plano nao e destrutivo para o que ja esta correto (idempotencia do calculo)', () => {
  const first = computeRbacSyncPlan(PERMISSIONS, real, { catalogCodes: [], rolePermissions: [] });
  // aplica o plano em memoria
  const state: RbacState = {
    catalogCodes: first.catalogToCreate,
    rolePermissions: first.grantsToAdd.map((g) => ({ role: g.role, permissionCode: g.permissionCode })),
  };
  const second = computeRbacSyncPlan(PERMISSIONS, real, state);
  assert.equal(second.inSync, true);
  assert.deepEqual(second.grantsToRemove, []);
});

test('trava de seguranca: padroes vazios, fora do catalogo ou incoerentes bloqueiam qualquer mudanca', () => {
  assert.throws(() => assertRbacDefaultsSane(PERMISSIONS, { ...real, MEMBER: [] }), RbacDefaultsInvalidError);
  assert.throws(() => assertRbacDefaultsSane(PERMISSIONS, { ...real, MEMBER: ['nao.existe'] }), /fora do catalogo/);
  assert.throws(() => assertRbacDefaultsSane([], real), /Catalogo canonico/);
  assert.throws(() => assertRbacDefaultsSane(PERMISSIONS, { ...real, ADMIN: ADMIN_DEFAULTS.slice(1), MEMBER: MEMBER_DEFAULTS }), /ADMIN nao tem/);
  assert.doesNotThrow(() => assertRbacDefaultsSane(PERMISSIONS, real));
});

test('relatorio: lista remocoes, excecoes preservadas e nao inclui segredos', () => {
  const state = cleanState();
  state.rolePermissions = [...state.rolePermissions, { role: 'MEMBER', permissionCode: 'deliverables.complete' }];
  const plan = computeRbacSyncPlan(PERMISSIONS, real, state);
  const text = formatRbacSyncReport(plan, { total: 3, grantsByCode: { 'deliverables.complete': 2 } }, 'check');
  assert.match(text, /- MEMBER deliverables\.complete/);
  assert.match(text, /2 concessão\(ões\) individual\(is\) de deliverables\.complete/);
  assert.match(text, /DIVERGENTE/);
  assert.doesNotMatch(text, /postgres(ql)?:\/\//i);
});
