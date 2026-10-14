import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ADMIN_DEFAULTS, MANAGER_DEFAULTS, MEMBER_DEFAULTS } from '@zafira/domain';
import { resolveAuthorizationContext } from '../modules/authorization/resolver.js';
import { applyRbacSync, computeRbacSyncPlan, loadRbacState, reportIndividualExceptions, type RbacDefaults } from '../modules/authorization/rbac-sync.js';
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

const prisma = new PrismaClient();
const defaults: RbacDefaults = { ADMIN: ADMIN_DEFAULTS, MANAGER: MANAGER_DEFAULTS, MEMBER: MEMBER_DEFAULTS };

/**
 * HM-1 / H1 (P22) - Bootstrap RBAC com banco no FORMATO ANTIGO: o MEMBER ainda tem deliverables.complete
 * (anterior a F6-IMP.7B), existe um codigo obsoleto em MANAGER e falta uma permissao padrao.
 * Prova: remocao do obsoleto, acrescimo do que faltava, excecoes individuais preservadas, isolamento entre
 * organizacoes, idempotencia e verificacao pre-deploy. O estado global e restaurado ao final.
 */
test('Integration Gate: Bootstrap RBAC com dados legados (HM-1/H1, P22) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const LEGACY_CODE = `legacy.f6_removed_${run}`;
  const missingDefault = MEMBER_DEFAULTS.find((c) => c !== 'deliverables.complete')!;

  const orgA = await prisma.organization.create({ data: { slug: `ci-rbacsync-a-${run}`, name: 'CI RBAC Sync A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-rbacsync-b-${run}`, name: 'CI RBAC Sync B' } });
  const mk = async (label: string, organizationId: string) => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-rbacsync-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role: 'MEMBER' } });
    return { user, member };
  };
  const plain = await mk('plain-a', orgA.id); // sem excecao: depende so do papel
  const withGrant = await mk('grant-a', orgA.id); // excecao CONCEDENTE de deliverables.complete
  const withDeny = await mk('deny-a', orgA.id); // excecao NEGANDO uma permissao padrao
  const otherOrg = await mk('plain-b', orgB.id);
  const DENIED_DEFAULT = MEMBER_DEFAULTS.find((c) => c !== missingDefault && c !== 'deliverables.complete')!;

  t.after(async () => {
    // restaura o estado global dos papeis e remove tudo o que o teste criou
    await applyRbacSync(prisma, PERMISSIONS, defaults).catch(() => undefined);
    await prisma.permission.deleteMany({ where: { code: LEGACY_CODE } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await prisma.$disconnect();
  });

  // --- estado legado ---
  await prisma.permission.create({ data: { code: LEGACY_CODE, area: 'legacy', description: 'codigo obsoleto de teste' } });
  await prisma.rolePermission.createMany({
    data: [
      { role: 'MEMBER', permissionCode: 'deliverables.complete' }, // P22
      { role: 'MANAGER', permissionCode: LEGACY_CODE },
    ],
    skipDuplicates: true,
  });
  await prisma.rolePermission.delete({ where: { role_permissionCode: { role: 'MEMBER', permissionCode: missingDefault } } });
  await prisma.organizationMemberPermission.createMany({
    data: [
      { organizationId: orgA.id, organizationMemberId: withGrant.member.id, permissionCode: 'deliverables.complete', allowed: true },
      { organizationId: orgA.id, organizationMemberId: withDeny.member.id, permissionCode: DENIED_DEFAULT, allowed: false },
    ],
  });
  const exceptionsBefore = await prisma.organizationMemberPermission.findMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
    orderBy: [{ organizationMemberId: 'asc' }, { permissionCode: 'asc' }],
  });
  const membersBefore = await prisma.organizationMember.count({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  const can = (who: { user: { id: string } }, org: string, code: string) =>
    resolveAuthorizationContext({ userId: who.user.id, activeOrganizationId: org, permissionCode: code as any });

  await t.test('1. Antes: o problema do P22 existe (MEMBER legado conclui entregas) e a verificacao aponta a divergencia', async () => {
    const before = await can(plain, orgA.id, 'deliverables.complete');
    assert.strictEqual(before.allowed, true, 'comportamento legado reproduzido');
    assert.strictEqual(before.reason, 'GRANTED_BY_ROLE_PERMISSION');
    const plan = computeRbacSyncPlan(PERMISSIONS, defaults, await loadRbacState(prisma));
    assert.strictEqual(plan.inSync, false);
    assert.ok(plan.grantsToRemove.some((g) => g.role === 'MEMBER' && g.permissionCode === 'deliverables.complete'));
    assert.ok(plan.grantsToRemove.some((g) => g.role === 'MANAGER' && g.permissionCode === LEGACY_CODE));
    assert.ok(plan.grantsToAdd.some((g) => g.role === 'MEMBER' && g.permissionCode === missingDefault));
    assert.ok(plan.catalogObsolete.includes(LEGACY_CODE));
  });

  await t.test('2. A verificacao (somente leitura) nao altera nada', async () => {
    const rolesBefore = await prisma.rolePermission.count();
    const catalogBefore = await prisma.permission.count();
    computeRbacSyncPlan(PERMISSIONS, defaults, await loadRbacState(prisma));
    await reportIndividualExceptions(prisma);
    assert.strictEqual(await prisma.rolePermission.count(), rolesBefore);
    assert.strictEqual(await prisma.permission.count(), catalogBefore);
  });

  await t.test('3. Bootstrap: remove o obsoleto e o P22, acrescenta o que faltava, preserva excecoes e organizacoes', async () => {
    const { result } = await applyRbacSync(prisma, PERMISSIONS, defaults);
    assert.ok(result.removed >= 2, `removidas ${result.removed}`);
    assert.ok(result.added >= 1, `acrescentadas ${result.added}`);

    const memberRows = await prisma.rolePermission.findMany({ where: { role: 'MEMBER' }, select: { permissionCode: true } });
    const memberCodes = new Set(memberRows.map((r) => r.permissionCode));
    assert.strictEqual(memberCodes.has('deliverables.complete'), false, 'MEMBER perde deliverables.complete');
    assert.strictEqual(memberCodes.has(missingDefault), true, 'padrao ausente foi acrescentado');
    assert.deepStrictEqual([...memberCodes].sort(), [...MEMBER_DEFAULTS].sort(), 'MEMBER exatamente igual aos padroes');
    assert.strictEqual(await prisma.rolePermission.count({ where: { permissionCode: LEGACY_CODE } }), 0);
    assert.ok(await prisma.permission.findUnique({ where: { code: LEGACY_CODE } }), 'catalogo obsoleto nunca e removido pelo bootstrap');

    // excecoes individuais intactas (mesmas linhas, mesmos valores)
    const exceptionsAfter = await prisma.organizationMemberPermission.findMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
      orderBy: [{ organizationMemberId: 'asc' }, { permissionCode: 'asc' }],
    });
    assert.deepStrictEqual(
      exceptionsAfter.map((e) => [e.organizationMemberId, e.permissionCode, e.allowed]),
      exceptionsBefore.map((e) => [e.organizationMemberId, e.permissionCode, e.allowed])
    );
    assert.strictEqual(await prisma.organizationMember.count({ where: { organizationId: { in: [orgA.id, orgB.id] } } }), membersBefore);
  });

  await t.test('4. Efeito nas decisoes de acesso: papel sem excecao nega; excecoes continuam valendo; sem vazamento entre organizacoes', async () => {
    const plainNow = await can(plain, orgA.id, 'deliverables.complete');
    assert.strictEqual(plainNow.allowed, false);
    assert.strictEqual(plainNow.reason, 'DENIED_BY_DEFAULT');
    const grant = await can(withGrant, orgA.id, 'deliverables.complete');
    assert.strictEqual(grant.allowed, true);
    assert.strictEqual(grant.reason, 'GRANTED_BY_OVERRIDE', 'excecao concedente preservada');
    const deny = await can(withDeny, orgA.id, DENIED_DEFAULT);
    assert.strictEqual(deny.allowed, false);
    assert.strictEqual(deny.reason, 'DENIED_BY_OVERRIDE', 'excecao negando preservada');
    assert.strictEqual((await can(plain, orgA.id, missingDefault)).allowed, true, 'padrao reposto vale');
    const cross = await can(plain, orgB.id, 'clients.view');
    assert.strictEqual(cross.allowed, false);
    assert.strictEqual(cross.reason, 'NO_MEMBERSHIP_IN_ACTIVE_ORGANIZATION');
    assert.strictEqual((await can(otherOrg, orgB.id, 'deliverables.complete')).allowed, false);
  });

  await t.test('5. Idempotencia: segunda execucao nao altera nada e a verificacao fica em sincronia (exceto o catalogo obsoleto, so relatado)', async () => {
    const { result } = await applyRbacSync(prisma, PERMISSIONS, defaults);
    assert.deepStrictEqual(result, { created: 0, added: 0, removed: 0 });
    const plan = computeRbacSyncPlan(PERMISSIONS, defaults, await loadRbacState(prisma));
    assert.strictEqual(plan.inSync, true);
    assert.ok(plan.catalogObsolete.includes(LEGACY_CODE), 'obsoleto continua apenas relatado');
    const exc = await reportIndividualExceptions(prisma);
    assert.ok(exc.total >= 2);
    assert.ok((exc.grantsByCode['deliverables.complete'] ?? 0) >= 1, 'concessao individual contada, sem dado pessoal');
  });
});
