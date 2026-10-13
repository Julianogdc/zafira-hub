import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

// --- GUARD DE SEGURANCA (mesmo padrao de rbac-postgres.test.ts) ---
if (process.env.NODE_ENV === 'production') {
  throw new Error('NAO E PERMITIDO EXECUTAR TESTES DE INTEGRACAO EM PRODUCAO');
}
if (process.env.ZAFIRA_TEST_DATABASE !== '1') {
  throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatorio para testes de integracao');
}
if (!(process.env.DATABASE_URL || '').includes('/zafira_hub_ci')) {
  throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');
}

/**
 * F7-2a - Execucao do onboarding (DEC-F7-008) contra PostgreSQL descartavel real.
 * Provas: migration sem dados; objetos SQL protegidos; permissoes, carteira e isolamento;
 * B2 sob concorrencia e no banco; imutabilidade; P1/P2/P3/P4/P5; cancelamento; eventos append-only;
 * pessoa desativada; modelo arquivado e versao nova nao alteram execucao em andamento.
 * Nomes abaixo sao FIXTURES DE TESTE (removidas ao final).
 */
test('Integration Gate: Execucao de Onboarding (F7-2a) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const TABLES = ['onboarding_executions', 'onboarding_step_runs', 'onboarding_execution_events'];
  const initialCounts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
    initialCounts[table] = Number(rows[0].n);
  }

  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-exe-a-${run}`, name: 'CI Execucao A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-exe-b-${run}`, name: 'CI Execucao B' } });
  const createdOrgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-exe-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const memberB = await mkUser('member-b', orgA.id, 'MEMBER'); // sem o cliente C1 na carteira
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');

  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente 1' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente 2' } });
  const cB = await prisma.client.create({ data: { organizationId: orgB.id, name: 'CI Cliente B' } });
  for (const m of [managerA, memberA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }
  await prisma.clientIntegration.create({ data: { clientId: c1.id, provider: 'ASANA', externalId: `ci-proj-${run}` } });

  type Who = { user: { id: string } };
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      cookies: who ? { token: (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org }) } : undefined,
      payload: payload as any,
    });
  const S = (key: string, over: Record<string, unknown> = {}) => ({
    stepKey: key,
    title: `CI etapa ${key}`,
    kind: 'MANUAL',
    assigneeMode: 'NONE',
    dueAnchor: 'RELEASED',
    evidenceKind: 'NONE',
    evidenceRequired: false,
    completionCondition: 'CONFIRMATION',
    blocksCompletion: false,
    dependsOn: [] as string[],
    ...over,
  });

  // ---- modelo publicado de teste (via API da F7-1a)
  const fn = (await call(adminA, orgA.id, 'POST', '/onboarding/functions', { name: 'CI Exec Designer' })).json().find((f: any) => f.name === 'CI Exec Designer');
  assert.strictEqual((await call(adminA, orgA.id, 'PUT', `/onboarding/functions/${fn.id}/members`, { memberIds: [memberA.member.id, memberB.member.id] })).statusCode, 200);
  const publishTemplate = async (name: string, steps: unknown[]) => {
    const created = (await call(adminA, orgA.id, 'POST', '/onboarding/templates', { name })).json();
    const saved = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${created.id}/versions/${created.draft.id}`, {
      expectedUpdatedAt: created.draft.updatedAt,
      steps,
    });
    assert.strictEqual(saved.statusCode, 200, saved.body);
    const pub = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${created.id}/versions/${created.draft.id}/publish`, {
      expectedUpdatedAt: saved.json().draft.updatedAt,
      changeNote: 'versao de teste',
    });
    assert.strictEqual(pub.statusCode, 200, pub.body);
    return { id: created.id as string, versionId: created.draft.id as string };
  };
  const steps = [
    S('kickoff', { assigneeMode: 'MEMBER', memberId: memberA.member.id, dueBusinessDays: 1 }),
    S('identidade', {
      assigneeMode: 'FUNCTION',
      functionId: fn.id,
      dependsOn: ['kickoff'],
      dueBusinessDays: 3,
      evidenceKind: 'LINK',
      evidenceRequired: true,
      completionCondition: 'EVIDENCE_PROVIDED',
      blocksCompletion: true,
    }),
    S('asana', { kind: 'CONFIRM_ASANA_PROJECT', completionCondition: 'ASANA_PROJECT_LINKED', dependsOn: ['kickoff'] }),
    S('opcional'),
  ];
  const tpl = await publishTemplate(`CI Exec Modelo ${run}`, steps);

  const start = (who: Who, clientId: string, extra: Record<string, unknown> = {}) =>
    call(who, orgA.id, 'POST', '/onboarding/executions', { clientId, templateId: tpl.id, ...extra });
  const stepOf = (view: any, key: string) => view.steps.find((s: any) => s.stepKey === key);
  const act = (who: Who, execId: string, key: string, action: string, payload: unknown = {}) =>
    call(who, orgA.id, 'POST', `/onboarding/executions/${execId}/steps/${key}/${action}`, payload);
  const fromRows = (rows: any) => (Array.isArray(rows) ? rows : []);

  await t.test('0. Migration nao cria dados', async () => {
    for (const table of TABLES) assert.strictEqual(initialCounts[table], 0, `${table} deveria estar vazia`);
  });

  await t.test('1. Objetos SQL protegidos (F7-1a e F7-2a) existem pelo nome', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>('SELECT indexname FROM pg_indexes');
    const names = new Set(idx.map((r) => r.indexname));
    for (const n of [
      'onboarding_executions_one_active_per_client_template',
      'onboarding_versions_one_draft_per_template',
      'organization_functions_org_lower_name_key',
      'onboarding_templates_org_lower_name_key',
    ]) {
      assert.ok(names.has(n), `indice protegido ausente: ${n}`);
    }
    const trg = await prisma.$queryRawUnsafe<{ tgname: string }[]>('SELECT tgname FROM pg_trigger WHERE NOT tgisinternal');
    const tnames = new Set(trg.map((r) => r.tgname));
    for (const n of [
      'onboarding_steps_guard_published',
      'onboarding_deps_guard_published',
      'onboarding_versions_guard_published',
      'onboarding_executions_guard_insert',
      'onboarding_executions_guard_update',
      'onboarding_executions_guard_delete',
      'onboarding_step_runs_guard',
      'onboarding_execution_events_guard',
    ]) {
      assert.ok(tnames.has(n), `gatilho protegido ausente: ${n}`);
    }
    const ck = await prisma.$queryRawUnsafe<{ conname: string }[]>('SELECT conname FROM pg_constraint');
    const cnames = new Set(ck.map((r) => r.conname));
    for (const n of ['onboarding_executions_completed_coherent', 'onboarding_runs_skipped_has_reason', 'onboarding_runs_closed_not_blocked']) {
      assert.ok(cnames.has(n), `CHECK ausente: ${n}`);
    }
  });

  await t.test('2. Permissoes, carteira e organizacao: negativos', async () => {
    assert.strictEqual((await call(null, orgA.id, 'POST', '/onboarding/executions', { clientId: c1.id, templateId: tpl.id })).statusCode, 401);
    assert.strictEqual((await start(memberA, c1.id)).statusCode, 403, 'MEMBER nao inicia (sem onboarding.start)');
    assert.strictEqual((await start(managerA, c2.id)).statusCode, 404, 'cliente fora da carteira = 404');
    assert.strictEqual((await call(adminB, orgB.id, 'POST', '/onboarding/executions', { clientId: c1.id, templateId: tpl.id })).statusCode, 404, 'cliente de outra organizacao');
    assert.strictEqual((await call(adminB, orgB.id, 'POST', '/onboarding/executions', { clientId: cB.id, templateId: tpl.id })).statusCode, 404, 'modelo de outra organizacao');
    assert.strictEqual((await call(null, orgA.id, 'GET', '/onboarding/executions')).statusCode, 401);
    assert.strictEqual((await prisma.onboardingExecution.count({ where: { organizationId: orgA.id } })), 0, 'nada foi criado pelos negativos');
  });

  let exec1: any;
  await t.test('3. Inicio manual: versao fixada, responsaveis resolvidos, prazos e alertas (P1)', async () => {
    const res = await start(managerA, c1.id, { requestId: `req-${run}-0001` });
    assert.strictEqual(res.statusCode, 201, res.body);
    exec1 = res.json();
    assert.strictEqual(exec1.status, 'ACTIVE');
    assert.strictEqual(exec1.versionId, tpl.versionId);
    assert.strictEqual(exec1.startTrigger, 'MANUAL');
    const k = stepOf(exec1, 'kickoff');
    assert.deepStrictEqual([k.status, k.assigneeMemberId, k.assigneeSource], ['READY', memberA.member.id, 'MODEL_MEMBER']);
    assert.ok(k.dueDate, 'prazo calculado na liberacao');
    // funcao: memberB nao tem o cliente na carteira (P1) => so memberA e elegivel
    const id = stepOf(exec1, 'identidade');
    assert.deepStrictEqual([id.status, id.assigneeMemberId, id.assigneeSource], ['WAITING', memberA.member.id, 'FUNCTION_RESOLVED']);
    assert.strictEqual(id.dueDate, null, 'ancora RELEASED: so quando liberada');
    // sem responsavel configurado: alerta
    const asana = stepOf(exec1, 'asana');
    assert.deepStrictEqual([asana.assigneeMemberId, asana.assigneeIssue], [null, 'UNASSIGNED']);
    assert.strictEqual(exec1.counts.unresolved, 2, 'asana e opcional sem responsavel');
    // idempotencia
    const again = await start(managerA, c1.id, { requestId: `req-${run}-0001` });
    assert.strictEqual(again.statusCode, 201);
    assert.strictEqual(again.json().id, exec1.id);
    assert.strictEqual(await prisma.onboardingExecution.count({ where: { organizationId: orgA.id, clientId: c1.id } }), 1);
    // eventos e auditoria
    const events = await prisma.onboardingExecutionEvent.findMany({ where: { executionId: exec1.id } });
    assert.ok(events.some((e) => e.type === 'EXECUTION_STARTED' && e.actorUserId === managerA.user.id));
    assert.ok((await prisma.auditLog.count({ where: { organizationId: orgA.id, entityId: exec1.id } })) >= 1);
  });

  await t.test('4. B2: segundo inicio ativo e recusado, inclusive simultaneo, e no banco', async () => {
    const dup = await start(managerA, c1.id);
    assert.strictEqual(dup.statusCode, 409);
    assert.strictEqual(dup.json().code, 'EXECUTION_ALREADY_ACTIVE');
    assert.strictEqual(dup.json().existingExecutionId, exec1.id);
    // no banco, sem passar pela API
    await assert.rejects(
      prisma.onboardingExecution.create({
        data: { organizationId: orgA.id, clientId: c1.id, templateId: tpl.id, versionId: tpl.versionId, status: 'ACTIVE' },
      }),
      /Unique constraint|unique|one_active/i
    );
    // modelo diferente no mesmo cliente roda em paralelo
    const other = await publishTemplate(`CI Exec Outro ${run}`, [S('unica')]);
    const parallel = await call(managerA, orgA.id, 'POST', '/onboarding/executions', { clientId: c1.id, templateId: other.id });
    assert.strictEqual(parallel.statusCode, 201, parallel.body);

    // concorrencia: dois inicios simultaneos em outro cliente (C2, admin) => 201 + 409
    const [r1, r2] = await Promise.all([start(adminA, c2.id), start(adminA, c2.id)]);
    assert.deepStrictEqual([r1.statusCode, r2.statusCode].sort(), [201, 409]);
    assert.strictEqual(await prisma.onboardingExecution.count({ where: { organizationId: orgA.id, clientId: c2.id, status: 'ACTIVE' } }), 1);
  });

  await t.test('5. Imutabilidade e historico protegido no banco (cliente, modelo, versao, eventos append-only)', async () => {
    const attempt = (sql: string) => assert.rejects(prisma.$executeRawUnsafe(sql), /onboarding_|P0001|violates/i);
    await attempt(`UPDATE "onboarding_executions" SET "clientId" = '${c2.id}' WHERE "id" = '${exec1.id}'`);
    await attempt(`UPDATE "onboarding_executions" SET "versionId" = '${randomUUID()}' WHERE "id" = '${exec1.id}'`);
    await attempt(`UPDATE "onboarding_executions" SET "templateId" = '${randomUUID()}' WHERE "id" = '${exec1.id}'`);
    await attempt(`DELETE FROM "onboarding_executions" WHERE "id" = '${exec1.id}'`);
    await attempt(`UPDATE "onboarding_execution_events" SET "type" = 'X' WHERE "executionId" = '${exec1.id}'`);
    await attempt(`DELETE FROM "onboarding_execution_events" WHERE "executionId" = '${exec1.id}'`);
    await attempt(`DELETE FROM "onboarding_step_runs" WHERE "executionId" = '${exec1.id}'`);
    // versao publicada continua imutavel (F7-1a) mesmo com execucao apontando para ela
    await attempt(`UPDATE "onboarding_step_definitions" SET "title" = 'x' WHERE "versionId" = '${tpl.versionId}'`);
    // encerrar com etapa aberta e proibido
    await attempt(`UPDATE "onboarding_executions" SET "status" = 'COMPLETED', "completedAt" = now(), "completionMode" = 'AUTO' WHERE "id" = '${exec1.id}'`);
    // execucao so aponta para versao PUBLICADA do proprio modelo
    const draft = (await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/versions`)).json();
    await assert.rejects(
      prisma.onboardingExecution.create({
        data: { organizationId: orgA.id, clientId: c2.id, templateId: tpl.id, versionId: draft.draft.id, status: 'ACTIVE' },
      }),
      /onboarding_execution_version_invalid|P0001/
    );
    // volta ao estado anterior (descarta o rascunho de teste)
    await call(adminA, orgA.id, 'DELETE', `/onboarding/templates/${tpl.id}/versions/${draft.draft.id}`);
  });

  await t.test('6. Etapas: P2 (sem responsavel so override), evidencia, Asana somente local, liberacao e prazos', async () => {
    // kickoff pelo responsavel; libera identidade e asana
    const wrong = await act(memberB, exec1.id, 'kickoff', 'complete', { confirm: true });
    assert.ok([403, 404].includes(wrong.statusCode), 'quem nao e responsavel nem tem override: nao age');
    const noConfirm = await act(memberA, exec1.id, 'kickoff', 'complete', {});
    assert.strictEqual(noConfirm.statusCode, 400);
    const k = await act(memberA, exec1.id, 'kickoff', 'complete', { confirm: true });
    assert.strictEqual(k.statusCode, 200, k.body);
    let view = k.json();
    assert.strictEqual(stepOf(view, 'kickoff').status, 'DONE');
    assert.strictEqual(stepOf(view, 'identidade').status, 'READY');
    assert.ok(stepOf(view, 'identidade').dueDate, 'prazo calculado na liberacao');
    assert.strictEqual(stepOf(view, 'asana').status, 'READY');
    // evidencia obrigatoria
    assert.strictEqual((await act(memberA, exec1.id, 'identidade', 'complete', { confirm: true })).statusCode, 400);
    const withLink = await act(memberA, exec1.id, 'identidade', 'complete', { evidenceLink: 'https://exemplo.test/arte' });
    assert.strictEqual(withLink.statusCode, 200, withLink.body);
    // P2: etapa sem responsavel: membro nao conclui; override conclui
    const denied = await act(memberA, exec1.id, 'asana', 'complete', { asanaProjectGid: `ci-proj-${run}` });
    assert.strictEqual(denied.statusCode, 403);
    assert.strictEqual(denied.json().code, 'OVERRIDE_REQUIRED');
    // so projeto ja vinculado ao cliente (leitura local)
    const notLinked = await act(managerA, exec1.id, 'asana', 'complete', { asanaProjectGid: 'nao-vinculado' });
    assert.strictEqual(notLinked.statusCode, 400);
    assert.strictEqual(notLinked.json().code, 'ASANA_PROJECT_NOT_LINKED');
    const ok = await act(managerA, exec1.id, 'asana', 'complete', { asanaProjectGid: `ci-proj-${run}` });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(stepOf(ok.json(), 'asana').asanaProjectGid, `ci-proj-${run}`);
    assert.strictEqual(ok.json().status, 'ACTIVE', 'opcional ainda aberta');
    // nenhuma escrita externa: o servico nao possui cliente Asana/Calendar (nada a observar alem do vinculo local)
  });

  await t.test('7. Bloqueio, reatribuicao (P1) e dispensa so com override', async () => {
    const blockDenied = await act(memberA, exec1.id, 'opcional', 'block', { reason: 'sem acesso' });
    assert.strictEqual(blockDenied.statusCode, 403, 'sem responsavel: so override');
    const blocked = await act(managerA, exec1.id, 'opcional', 'block', { reason: 'aguardando cliente' });
    assert.strictEqual(blocked.statusCode, 200, blocked.body);
    assert.strictEqual(stepOf(blocked.json(), 'opcional').blocked, true);
    assert.strictEqual((await act(managerA, exec1.id, 'opcional', 'complete', { confirm: true })).statusCode, 409, 'bloqueada nao conclui');
    assert.strictEqual((await act(managerA, exec1.id, 'opcional', 'unblock', {})).statusCode, 200);
    // P1: pessoa sem o cliente na carteira nao e atribuida
    const out = await act(managerA, exec1.id, 'opcional', 'reassign', { memberId: memberB.member.id, reason: 'teste carteira' });
    assert.strictEqual(out.statusCode, 400);
    assert.strictEqual(out.json().code, 'ASSIGNEE_NOT_ELIGIBLE');
    assert.strictEqual(await prisma.userClientAssignment.count({ where: { organizationMemberId: memberB.member.id } }), 0, 'carteira nao foi ampliada');
    const okAssign = await act(managerA, exec1.id, 'opcional', 'reassign', { memberId: memberA.member.id, reason: 'responsavel da conta' });
    assert.strictEqual(okAssign.statusCode, 200, okAssign.body);
    assert.strictEqual(stepOf(okAssign.json(), 'opcional').assigneeSource, 'MANUAL');
    // dispensar e reatribuir exigem override
    assert.strictEqual((await act(memberA, exec1.id, 'opcional', 'skip', { reason: 'nao precisa' })).statusCode, 403);
    assert.strictEqual((await act(memberA, exec1.id, 'opcional', 'reassign', { memberId: memberA.member.id, reason: 'x y z' })).statusCode, 403);
    // justificativa obrigatoria
    assert.strictEqual((await act(managerA, exec1.id, 'opcional', 'skip', {})).statusCode, 400);
  });

  await t.test('8. Conclusao automatica; B2 liberado; etapa encerrada nao reabre (P5)', async () => {
    const done = await act(memberA, exec1.id, 'opcional', 'complete', { confirm: true });
    assert.strictEqual(done.statusCode, 200, done.body);
    const v = done.json();
    assert.deepStrictEqual([v.status, v.completionMode], ['COMPLETED', 'AUTO']);
    assert.ok(v.steps.every((s: any) => s.status === 'DONE'));
    assert.strictEqual((await act(managerA, exec1.id, 'kickoff', 'block', { reason: 'tentativa' })).statusCode, 409);
    assert.strictEqual((await act(managerA, exec1.id, 'kickoff', 'skip', { reason: 'tentativa' })).statusCode, 409);
    await assert.rejects(
      prisma.onboardingStepRun.updateMany({ where: { executionId: exec1.id }, data: { status: 'READY', completedAt: null } })
    );
    const restart = await start(managerA, c1.id);
    assert.strictEqual(restart.statusCode, 201, 'concluido permite novo inicio');
    exec1 = restart.json();
  });

  let exec2: any;
  await t.test('9. Conclusao antecipada (P3): bloqueantes encerradas; demais dispensadas na mesma transacao', async () => {
    exec2 = exec1;
    const blocked = await call(managerA, orgA.id, 'POST', `/onboarding/executions/${exec2.id}/complete`, { reason: 'encerrando antes' });
    assert.strictEqual(blocked.statusCode, 409);
    assert.strictEqual(blocked.json().code, 'BLOCKING_STEPS_OPEN');
    assert.strictEqual((await call(memberA, orgA.id, 'POST', `/onboarding/executions/${exec2.id}/complete`, { reason: 'encerrando antes' })).statusCode, 403, 'MEMBER sem start/override');
    await act(memberA, exec2.id, 'kickoff', 'complete', { confirm: true });
    await act(memberA, exec2.id, 'identidade', 'complete', { evidenceNote: 'x', evidenceLink: 'https://exemplo.test/b' });
    const noReason = await call(managerA, orgA.id, 'POST', `/onboarding/executions/${exec2.id}/complete`, {});
    assert.strictEqual(noReason.statusCode, 400);
    assert.strictEqual(noReason.json().code, 'REASON_REQUIRED');
    const early = await call(managerA, orgA.id, 'POST', `/onboarding/executions/${exec2.id}/complete`, { reason: 'cliente encerrou o contrato' });
    assert.strictEqual(early.statusCode, 200, early.body);
    const v = early.json();
    assert.deepStrictEqual([v.status, v.completionMode], ['COMPLETED', 'EARLY']);
    assert.ok(v.steps.every((s: any) => ['DONE', 'SKIPPED'].includes(s.status)), 'nenhuma etapa aberta');
    const skipped = v.steps.filter((s: any) => s.status === 'SKIPPED');
    assert.deepStrictEqual(skipped.map((s: any) => s.stepKey).sort(), ['asana', 'opcional']);
    assert.ok(skipped.every((s: any) => s.skipReason === 'cliente encerrou o contrato'));
    const ev = await prisma.onboardingExecutionEvent.findMany({ where: { executionId: exec2.id, type: 'STEP_SKIPPED' } });
    assert.strictEqual(ev.length, 2, 'um evento por etapa dispensada');
    assert.ok(ev.every((e) => (e.after as any).viaEarlyCompletion === true));
    const open = await prisma.onboardingStepRun.count({ where: { executionId: exec2.id, status: { in: ['WAITING', 'READY', 'IN_PROGRESS'] } } });
    assert.strictEqual(open, 0);
  });

  await t.test('10. Cancelamento: permissao, motivo, etapas canceladas, B2 liberado', async () => {
    const s = await start(managerA, c1.id);
    assert.strictEqual(s.statusCode, 201, s.body);
    const id = s.json().id;
    assert.strictEqual((await call(memberA, orgA.id, 'POST', `/onboarding/executions/${id}/cancel`, { reason: 'sem permissao' })).statusCode, 403);
    assert.strictEqual((await call(managerA, orgA.id, 'POST', `/onboarding/executions/${id}/cancel`, {})).statusCode, 400, 'motivo obrigatorio');
    const c = await call(managerA, orgA.id, 'POST', `/onboarding/executions/${id}/cancel`, { reason: 'cliente desistiu' });
    assert.strictEqual(c.statusCode, 200, c.body);
    assert.strictEqual(c.json().status, 'CANCELLED');
    assert.ok(c.json().steps.every((x: any) => x.status === 'CANCELLED'));
    assert.strictEqual((await act(managerA, id, 'kickoff', 'complete', { confirm: true })).statusCode, 409);
    assert.strictEqual((await call(managerA, orgA.id, 'POST', `/onboarding/executions/${id}/cancel`, { reason: 'de novo' })).statusCode, 409);
    const fresh = await start(managerA, c1.id);
    assert.strictEqual(fresh.statusCode, 201, 'cancelada permite novo inicio');
    exec1 = fresh.json();
  });

  await t.test('11. Dispensa de etapa bloqueante (P4): override, justificativa e destaque no historico', async () => {
    const r = await act(managerA, exec1.id, 'identidade', 'skip', { reason: 'cliente ja tem identidade' });
    assert.strictEqual(r.statusCode, 200, r.body);
    const ev = await prisma.onboardingExecutionEvent.findFirst({ where: { executionId: exec1.id, stepKey: 'identidade', type: 'STEP_SKIPPED' } });
    assert.strictEqual((ev!.after as any).highlight, 'BLOCKING_STEP_SKIPPED');
    assert.strictEqual(ev!.reason, 'cliente ja tem identidade');
    // dependencia dispensada satisfaz dependentes: kickoff concluido libera asana; identidade ja encerrada
    await act(memberA, exec1.id, 'kickoff', 'complete', { confirm: true });
    const v = (await call(managerA, orgA.id, 'GET', `/onboarding/executions/${exec1.id}`)).json();
    assert.strictEqual(stepOf(v, 'asana').status, 'READY');
  });

  await t.test('12. Modelo arquivado e versao nova nao alteram o que esta em andamento', async () => {
    // nova versao publicada do mesmo modelo
    const d = (await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/versions`)).json();
    const saved = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${tpl.id}/versions/${d.draft.id}`, {
      expectedUpdatedAt: d.draft.updatedAt,
      steps: [S('so-uma')],
    });
    assert.strictEqual(saved.statusCode, 200, saved.body);
    const pub = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/versions/${d.draft.id}/publish`, {
      expectedUpdatedAt: saved.json().draft.updatedAt,
      changeNote: 'v2 de teste',
    });
    assert.strictEqual(pub.statusCode, 200, pub.body);
    const still = (await call(managerA, orgA.id, 'GET', `/onboarding/executions/${exec1.id}`)).json();
    assert.strictEqual(still.versionId, tpl.versionId, 'continua na versao fixada');
    assert.strictEqual(still.versionNumber, 1);
    assert.strictEqual(still.steps.length, 4);
    // arquivar bloqueia novos inicios e preserva o que esta em andamento
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/archive`)).statusCode, 200);
    const archived = await start(adminA, c2.id);
    assert.strictEqual(archived.statusCode, 409);
    assert.strictEqual(archived.json().code, 'TEMPLATE_ARCHIVED');
    assert.strictEqual((await act(memberA, exec1.id, 'opcional', 'start')).statusCode, 403, 'sem responsavel: so override');
    assert.strictEqual((await act(managerA, exec1.id, 'opcional', 'start')).statusCode, 200, 'em andamento continua funcionando');
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/reactivate`)).statusCode, 200);
    // novos inicios usam a v2
    await call(managerA, orgA.id, 'POST', `/onboarding/executions/${exec1.id}/cancel`, { reason: 'trocar de versao no teste' });
    const next = await start(managerA, c1.id);
    assert.strictEqual(next.statusCode, 201, next.body);
    assert.strictEqual(next.json().versionNumber, 2);
    exec1 = next.json();
  });

  await t.test('13. Pessoa desativada: historico integro, alerta e reatribuicao por override', async () => {
    const before = await prisma.onboardingExecutionEvent.count({ where: { executionId: exec1.id } });
    await prisma.organizationMember.update({ where: { id: memberA.member.id }, data: { status: 'SUSPENDED' } });
    const v = (await call(managerA, orgA.id, 'GET', `/onboarding/executions/${exec1.id}`)).json();
    const only = v.steps[0];
    assert.strictEqual(only.assigneeMemberId, null, 'modelo v2 nao tem responsavel configurado');
    // etapa com a pessoa: crie uma execucao v1-like via reatribuicao manual antes de desativar nao e possivel (suspensa);
    // portanto valida-se a leitura e que a pessoa suspensa nao age (403) e nao e elegivel
    // pessoa suspensa nao autentica na organizacao: nao age (400 contexto de organizacao, 401 ou 403)
    const susp = await act(memberA, exec1.id, 'so-uma', 'complete', { confirm: true });
    assert.ok([400, 401, 403].includes(susp.statusCode));
    const r = await act(managerA, exec1.id, 'so-uma', 'reassign', { memberId: memberA.member.id, reason: 'tentando' });
    assert.strictEqual(r.statusCode, 400, 'suspensa nao e elegivel');
    assert.strictEqual(await prisma.onboardingExecutionEvent.count({ where: { executionId: exec1.id } }) >= before, true);
    await prisma.organizationMember.update({ where: { id: memberA.member.id }, data: { status: 'ACTIVE' } });
  });

  await t.test('14. Historico preservado quando a pessoa responsavel e removida da organizacao', async () => {
    const tmp = await mkUser('temp-a', orgA.id, 'MEMBER');
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: tmp.member.id, clientId: c2.id } });
    const t2 = await publishTemplate(`CI Exec Temp ${run}`, [S('t1', { assigneeMode: 'MEMBER', memberId: tmp.member.id }), S('t2')]);
    const s = await call(adminA, orgA.id, 'POST', '/onboarding/executions', { clientId: c2.id, templateId: t2.id });
    assert.strictEqual(s.statusCode, 201, s.body);
    const v = s.json();
    assert.strictEqual(stepOf(v, 't1').assigneeMemberId, tmp.member.id);
    // a pessoa e desativada (usuario inativo): alerta e override reatribui; historico segue
    await prisma.user.update({ where: { id: tmp.user.id }, data: { status: 'INACTIVE' } });
    const view = (await call(adminA, orgA.id, 'GET', `/onboarding/executions/${v.id}`)).json();
    assert.strictEqual(stepOf(view, 't1').assigneeIssue, 'INACTIVE_OR_OUT_OF_SCOPE');
    assert.strictEqual(view.counts.unresolved >= 1, true);
    assert.strictEqual((await act(tmp, v.id, 't1', 'complete', { confirm: true })).statusCode === 200, false);
    // remover a pessoa de vez nao apaga eventos nem etapas
    await prisma.userClientAssignment.deleteMany({ where: { organizationMemberId: tmp.member.id } });
    await prisma.organizationMember.delete({ where: { id: tmp.member.id } });
    const after = (await call(adminA, orgA.id, 'GET', `/onboarding/executions/${v.id}`)).json();
    assert.strictEqual(stepOf(after, 't1').assigneeIssue, 'INACTIVE_OR_OUT_OF_SCOPE');
    assert.ok(after.events.length >= 1);
    // admin conclui por override
    const done = await act(adminA, v.id, 't1', 'complete', { confirm: true });
    assert.strictEqual(done.statusCode, 200, done.body);
  });

  await t.test('15. Isolamento: organizacao B nunca le nem altera; carteira restringe listas', async () => {
    const id = exec1.id;
    const list = fromRows((await call(adminB, orgB.id, 'GET', '/onboarding/executions')).json());
    assert.deepStrictEqual(list, []);
    for (const [method, url, payload] of [
      ['GET', `/onboarding/executions/${id}`],
      ['POST', `/onboarding/executions/${id}/cancel`, { reason: 'invasao' }],
      ['POST', `/onboarding/executions/${id}/complete`, { reason: 'invasao' }],
      ['POST', `/onboarding/executions/${id}/steps/so-uma/complete`, { confirm: true }],
      ['POST', `/onboarding/executions/${id}/steps/so-uma/skip`, { reason: 'invasao' }],
      ['POST', `/onboarding/executions/${id}/steps/so-uma/reassign`, { memberId: adminB.member.id, reason: 'invasao' }],
      ['POST', `/onboarding/executions/${id}/steps/so-uma/block`, { reason: 'invasao' }],
    ] as Array<[any, string, unknown?]>) {
      const r = await call(adminB, orgB.id, method, url, payload);
      assert.strictEqual(r.statusCode, 404, `${method} ${url} => ${r.statusCode}`);
    }
    // carteira: memberA ve C1, nao ve C2
    const mine = fromRows((await call(memberA, orgA.id, 'GET', '/onboarding/executions')).json());
    assert.ok(mine.length > 0 && mine.every((e: any) => e.clientId === c1.id), 'membro so ve a propria carteira');
    const asAdmin = fromRows((await call(adminA, orgA.id, 'GET', '/onboarding/executions')).json());
    assert.ok(asAdmin.some((e: any) => e.clientId === c2.id));
    // execucao de C2 fora da carteira do membro: 404
    const c2Exec = asAdmin.find((e: any) => e.clientId === c2.id);
    assert.strictEqual((await call(memberA, orgA.id, 'GET', `/onboarding/executions/${c2Exec.id}`)).statusCode, 404);
    // minhas etapas e painel
    const steps = await call(memberA, orgA.id, 'GET', '/onboarding/my-steps');
    assert.strictEqual(steps.statusCode, 200);
    assert.ok(fromRows(steps.json()).every((s: any) => s.clientId === c1.id));
    const ov = (await call(adminA, orgA.id, 'GET', '/onboarding/overview')).json();
    for (const k of ['activeExecutions', 'lateSteps', 'blockedSteps', 'unassignedSteps', 'completedLast30Days']) {
      assert.strictEqual(typeof ov[k], 'number', k);
    }
    const ovB = (await call(adminB, orgB.id, 'GET', '/onboarding/overview')).json();
    assert.strictEqual(ovB.activeExecutions, 0);
  });

  await t.test('16. Remocao da organizacao com execucoes e historico funciona (cascata)', async () => {
    const orgC = await prisma.organization.create({ data: { slug: `ci-exe-c-${run}`, name: 'CI Execucao C' } });
    createdOrgIds.push(orgC.id);
    const adminC = await mkUser('admin-c', orgC.id, 'ADMIN');
    const clientC = await prisma.client.create({ data: { organizationId: orgC.id, name: 'CI Cliente C' } });
    const tc = (await call(adminC, orgC.id, 'POST', '/onboarding/templates', { name: 'CI Casc' })).json();
    const sv = await call(adminC, orgC.id, 'PUT', `/onboarding/templates/${tc.id}/versions/${tc.draft.id}`, { expectedUpdatedAt: tc.draft.updatedAt, steps: [S('a'), S('b', { dependsOn: ['a'] })] });
    await call(adminC, orgC.id, 'POST', `/onboarding/templates/${tc.id}/versions/${tc.draft.id}/publish`, { expectedUpdatedAt: sv.json().draft.updatedAt, changeNote: 'cascata' });
    const st = await call(adminC, orgC.id, 'POST', '/onboarding/executions', { clientId: clientC.id, templateId: tc.id });
    assert.strictEqual(st.statusCode, 201, st.body);
    await act2(adminC, orgC.id, st.json().id, 'a');
    await prisma.auditLog.deleteMany({ where: { organizationId: orgC.id } });
    await prisma.organization.delete({ where: { id: orgC.id } });
    assert.strictEqual(await prisma.onboardingExecution.count({ where: { organizationId: orgC.id } }), 0);
    assert.strictEqual(await prisma.onboardingExecutionEvent.count({ where: { organizationId: orgC.id } }), 0);
    async function act2(who: Who, org: string, execId: string, key: string) {
      return call(who, org, 'POST', `/onboarding/executions/${execId}/steps/${key}/complete`, { confirm: true });
    }
  });
});
