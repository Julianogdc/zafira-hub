import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { AsanaMirrorService, MirrorDependencies } from '../modules/integrations/asana/mirror/asana-mirror.service.js';
import { acquireLease, releaseLease } from '../lib/scheduler-lease.js';

// --- GUARD DE SEGURANÇA (mesmo padrão de rbac-postgres.test.ts) ---
if (process.env.NODE_ENV === 'production') {
  throw new Error('NÃO É PERMITIDO EXECUTAR TESTES DE INTEGRAÇÃO EM PRODUÇÃO');
}
if (process.env.ZAFIRA_TEST_DATABASE !== '1') {
  throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatório para testes de integração');
}
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) {
  throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');
}
// Nenhuma chamada real ao Asana: sem token de desenvolvimento, a rota de atualização só registra a falha.
delete process.env.ASANA_DEV_PAT;
delete process.env.ASANA_ACCESS_TOKEN;

/**
 * F6-IMP.8 — Espelho e fotos diárias do Asana (DEC-F6-003) contra PostgreSQL descartável real.
 * O Asana é substituído por um leitor falso (somente leitura); banco, transações e travas são reais.
 */
test('Integration Gate: espelho do Asana (F6-IMP.8) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const projectGid = `p-${run}`;

  // "Asana" falso, controlado pelo teste
  let clock = new Date('2026-10-15T15:00:00Z');
  let remoteTasks: any[] = [];
  let failFetch = false;
  let failToken = false;
  let fetchDelayMs = 0;
  const fetchCalls: string[] = [];
  const deps: MirrorDependencies = {
    getToken: async () => {
      if (failToken) throw new Error('Asana não conectado (token: segredo-que-nao-pode-vazar)');
      return 'token-falso';
    },
    fetchProjectTasks: async (gid) => {
      fetchCalls.push(gid);
      if (fetchDelayMs) await new Promise((r) => setTimeout(r, fetchDelayMs));
      if (failFetch) throw new Error('Asana fora do ar (502)');
      return remoteTasks;
    },
    fetchProjectName: async () => 'Social Media (fictício)',
    now: () => clock,
  };
  const service = new AsanaMirrorService(deps);
  const T = (gid: string, over: Record<string, unknown> = {}) => ({
    gid,
    name: `Tarefa ${gid}`,
    completed: false,
    due_on: '2026-10-20',
    assignee: { gid: 'u1', name: 'Ana' },
    memberships: [{ project: { gid: projectGid }, section: { gid: 's1', name: 'Produção' } }],
    permalink_url: `https://app.asana.com/0/${projectGid}/${gid}`,
    ...over,
  });

  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-mirror-a-${run}`, name: 'CI Espelho A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-mirror-b-${run}`, name: 'CI Espelho B' } });
  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-mirror-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const outsiderA = await mkUser('outsider-a', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const clientA = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Espelho A' } });
  const clientB = await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Cliente Espelho B' } });
  await prisma.userClientAssignment.create({
    data: { organizationId: orgA.id, organizationMemberId: memberA.member.id, clientId: clientA.id },
  });
  // O MESMO projeto do Asana vinculado a clientes de duas organizações: os dados não podem se misturar.
  await prisma.clientIntegration.createMany({
    data: [
      { clientId: clientA.id, provider: 'ASANA', externalId: projectGid, metadata: { projectName: 'Projeto A' } },
      { clientId: clientB.id, provider: 'ASANA', externalId: projectGid, metadata: { projectName: 'Projeto B' } },
    ],
  });

  t.after(async () => {
    await prisma.syncRun.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await prisma.schedulerLease.deleteMany({ where: { name: { in: [`asana-mirror:${orgA.id}`, `asana-mirror:${orgB.id}`] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const tasksA = () => prisma.asanaTaskMirror.findMany({ where: { organizationId: orgA.id }, orderBy: { taskGid: 'asc' } });
  const changesA = () => prisma.asanaTaskChange.findMany({ where: { organizationId: orgA.id }, orderBy: { taskGid: 'asc' } });
  const snapsA = () => prisma.asanaProjectSnapshot.findMany({ where: { organizationId: orgA.id }, orderBy: { snapshotDate: 'asc' } });

  await t.test('1ª conferência: cria espelho, foto do dia e ponto de partida, sem histórico falso', async () => {
    remoteTasks = [T('a'), T('b', { completed: true }), T('c', { due_on: '2026-10-01' })];
    const result = await service.syncOrganization(orgA.id, 'manual');
    assert.deepStrictEqual([result.skipped, result.status, result.succeeded, result.failed], [false, 'SUCCESS', 1, 0]);
    assert.strictEqual((await tasksA()).length, 3);
    assert.strictEqual((await changesA()).length, 0, 'primeira conferência não gera "criada" para tudo');
    const snaps = await snapsA();
    assert.strictEqual(snaps.length, 1);
    assert.deepStrictEqual(
      [snaps[0].snapshotDate, snaps[0].totalTasks, snaps[0].completedTasks, snaps[0].pendingTasks, snaps[0].overdueTasks],
      ['2026-10-15', 3, 1, 2, 1]
    );
    const mirror = await prisma.asanaProjectMirror.findFirstOrThrow({ where: { organizationId: orgA.id } });
    assert.strictEqual(mirror.lastSyncStatus, 'SUCCESS');
    assert.ok(mirror.baselineAt);
    const syncRun = await prisma.syncRun.findUniqueOrThrow({ where: { id: result.syncRunId! } });
    assert.deepStrictEqual([syncRun.operation, syncRun.status, syncRun.itemsSucceeded], ['asana.mirror.sync', 'SUCCESS', 1]);
  });

  await t.test('2ª conferência no mesmo dia: mudanças registradas e a foto do dia é atualizada (não duplicada)', async () => {
    clock = new Date('2026-10-15T21:00:00Z');
    remoteTasks = [
      T('a', { completed: true }), // concluída
      T('b', { completed: true, name: 'Tarefa b renomeada' }), // nome
      T('c', { due_on: '2026-10-30', assignee: { gid: 'u2', name: 'Bruno' } }), // prazo + responsável
      T('d', { memberships: [{ project: { gid: projectGid }, section: { gid: 's2', name: 'Revisão' } }] }), // nova
    ];
    await service.syncOrganization(orgA.id, 'schedule');
    const fields = (await changesA()).map((c) => `${c.taskGid}:${c.field}`).sort();
    assert.deepStrictEqual(fields, ['a:completed', 'b:name', 'c:assignee', 'c:due', 'd:created']);
    const snaps = await snapsA();
    assert.strictEqual(snaps.length, 1, 'uma foto por dia');
    assert.deepStrictEqual([snaps[0].totalTasks, snaps[0].completedTasks, snaps[0].overdueTasks], [4, 2, 0]);
  });

  await t.test('dia seguinte: nova foto; tarefa que sumiu é marcada como removida, não apagada', async () => {
    clock = new Date('2026-10-16T15:00:00Z');
    remoteTasks = [T('a', { completed: true }), T('b', { completed: true, name: 'Tarefa b renomeada' }), T('d')];
    await service.syncOrganization(orgA.id, 'schedule');
    const c = (await tasksA()).find((x) => x.taskGid === 'c')!;
    assert.ok(c.removedAt, 'c foi marcada como removida');
    assert.strictEqual((await tasksA()).length, 4, 'nada é apagado');
    assert.ok((await changesA()).some((x) => x.taskGid === 'c' && x.field === 'removed'));
    assert.deepStrictEqual((await snapsA()).map((s) => s.snapshotDate), ['2026-10-15', '2026-10-16']);
  });

  await t.test('falha do Asana: mantém o último estado válido, não grava foto e marca o projeto como FAILED', async () => {
    const tasksBefore = JSON.stringify(await tasksA());
    const snapsBefore = JSON.stringify(await snapsA());
    clock = new Date('2026-10-17T15:00:00Z');
    failFetch = true;
    const result = await service.syncOrganization(orgA.id, 'schedule');
    failFetch = false;
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(JSON.stringify(await tasksA()), tasksBefore);
    assert.strictEqual(JSON.stringify(await snapsA()), snapsBefore, 'sem foto do dia 17: ausência não vira zero');
    const mirror = await prisma.asanaProjectMirror.findFirstOrThrow({ where: { organizationId: orgA.id } });
    assert.strictEqual(mirror.lastSyncStatus, 'FAILED');
    assert.match(mirror.lastSyncError ?? '', /fora do ar/);
    assert.strictEqual(mirror.lastSyncedAt?.toISOString(), '2026-10-16T15:00:00.000Z', 'última conferência boa preservada');

    failToken = true;
    const noToken = await service.syncOrganization(orgA.id, 'schedule');
    failToken = false;
    assert.strictEqual(noToken.status, 'FAILED');
    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: noToken.syncRunId! } });
    assert.ok(!(run.errorSummary ?? '').includes('segredo-que-nao-pode-vazar'), 'credencial nunca vai para o registro');
    assert.strictEqual(JSON.stringify(await tasksA()), tasksBefore);
  });

  await t.test('execução única: com a trava ocupada, a conferência é pulada e nada é lido do Asana', async () => {
    const holder = await acquireLease(`asana-mirror:${orgA.id}`, 60_000);
    assert.ok(holder);
    const callsBefore = fetchCalls.length;
    const result = await service.syncOrganization(orgA.id, 'webhook', { projectGids: [projectGid] });
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(fetchCalls.length, callsBefore);
    await releaseLease(`asana-mirror:${orgA.id}`, holder!);

    // Duas conferências simultâneas da mesma organização (Asana lento): só uma roda.
    fetchDelayMs = 300;
    const [x, y] = await Promise.all([service.syncOrganization(orgA.id, 'schedule'), service.syncOrganization(orgA.id, 'webhook')]);
    fetchDelayMs = 0;
    assert.deepStrictEqual([x.skipped, y.skipped].sort(), [false, true]);
  });

  await t.test('isolamento: o mesmo projeto em outra organização tem espelho e histórico próprios', async () => {
    remoteTasks = [T('z')];
    await service.syncOrganization(orgB.id, 'manual');
    const bTasks = await prisma.asanaTaskMirror.findMany({ where: { organizationId: orgB.id } });
    assert.deepStrictEqual(bTasks.map((x) => x.taskGid), ['z']);
    assert.ok(!(await tasksA()).some((x) => x.taskGid === 'z'));
    assert.strictEqual(await prisma.asanaTaskChange.count({ where: { organizationId: orgB.id } }), 0);
  });

  await t.test('fuso da organização (DEC-F6-005): a foto diária usa o dia da própria organização', async () => {
    await prisma.organizationConfig.create({ data: { organizationId: orgB.id, timezone: 'Asia/Tokyo' } });
    clock = new Date('2026-10-17T20:00:00Z'); // 17/10 17:00 em São Paulo; 18/10 05:00 em Tóquio
    remoteTasks = [T('z', { due_on: '2026-10-17' })];
    await service.syncOrganization(orgB.id, 'manual');
    const snap = await prisma.asanaProjectSnapshot.findFirstOrThrow({
      where: { organizationId: orgB.id },
      orderBy: { snapshotDate: 'desc' },
    });
    assert.strictEqual(snap.snapshotDate, '2026-10-18');
    assert.strictEqual(snap.overdueTasks, 1, 'em Tóquio já é 18/10: prazo de 17/10 está atrasado');
  });

  const call = (who: { user: { id: string } }, org: string, method: 'GET' | 'POST', url: string) =>
    app.inject({
      method,
      url,
      cookies: { token: (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org }) },
    });

  await t.test('rota de histórico: carteira, organização e permissões', async () => {
    const ok = await call(memberA, orgA.id, 'GET', `/clients/${clientA.id}/asana/history?days=30`);
    assert.strictEqual(ok.statusCode, 200);
    const body = ok.json();
    assert.strictEqual(body.projects.length, 1);
    assert.strictEqual(body.projects[0].name, 'Social Media (fictício)');
    assert.ok(['SUCCESS', 'FAILED'].includes(body.projects[0].lastSyncStatus));
    assert.ok(body.changes.length >= 5);
    assert.ok(!ok.body.includes('Tarefa z'), 'nada da organização B');

    assert.strictEqual((await call(outsiderA, orgA.id, 'GET', `/clients/${clientA.id}/asana/history`)).statusCode, 404);
    assert.strictEqual((await call(adminB, orgB.id, 'GET', `/clients/${clientA.id}/asana/history`)).statusCode, 404);
    assert.strictEqual((await call(adminA, orgA.id, 'GET', `/clients/${clientA.id}/asana/history?days=0`)).statusCode, 400);
    assert.strictEqual(
      (await app.inject({ method: 'GET', url: `/clients/${clientA.id}/asana/history` })).statusCode,
      401
    );
  });

  await t.test('"Atualizar agora": membro sem projects.sync recebe 403; admin sem Asana conectado registra falha sem apagar nada', async () => {
    assert.strictEqual((await call(memberA, orgA.id, 'POST', `/clients/${clientA.id}/asana/history/refresh`)).statusCode, 403);
    const tasksBefore = JSON.stringify(await tasksA());
    const res = await call(adminA, orgA.id, 'POST', `/clients/${clientA.id}/asana/history/refresh`);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().status, 'FAILED');
    assert.strictEqual(res.json().history.projects[0].lastSyncStatus, 'FAILED');
    assert.strictEqual(JSON.stringify(await tasksA()), tasksBefore);
  });

  await t.test('retenção: descarta só o que passou de 13 meses', async () => {
    const old = new Date('2025-08-01T12:00:00Z');
    await prisma.asanaTaskChange.create({
      data: { organizationId: orgA.id, clientId: clientA.id, projectGid, taskGid: 'velha', taskName: 'Velha', field: 'completed', detectedAt: old },
    });
    await prisma.asanaProjectSnapshot.create({
      data: { organizationId: orgA.id, clientId: clientA.id, projectGid, snapshotDate: '2025-08-01', totalTasks: 1, completedTasks: 0, pendingTasks: 1, overdueTasks: 0 },
    });
    await prisma.asanaTaskMirror.create({
      data: { organizationId: orgA.id, clientId: clientA.id, projectGid, taskGid: 'velha', name: 'Velha', removedAt: old },
    });
    clock = new Date('2026-10-17T15:00:00Z');
    const purged = await service.purgeExpired();
    assert.ok(purged.changes >= 1 && purged.snapshots >= 1 && purged.removedTasks >= 1);
    assert.strictEqual(await prisma.asanaTaskChange.count({ where: { organizationId: orgA.id, taskGid: 'velha' } }), 0);
    assert.strictEqual(await prisma.asanaProjectSnapshot.count({ where: { organizationId: orgA.id, snapshotDate: '2025-08-01' } }), 0);
    assert.deepStrictEqual((await snapsA()).map((s) => s.snapshotDate), ['2026-10-15', '2026-10-16', '2026-10-17'], 'fotos recentes preservadas');
    assert.ok((await changesA()).length >= 5, 'histórico recente preservado');
  });
});
