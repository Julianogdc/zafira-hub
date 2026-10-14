import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { AutomationService } from '../modules/onboarding/automation.service.js';
import { createN8nMock } from '../../../../scripts/homologation/n8n-mock.mjs';
import { assertTestDatabase } from '../lib/test-database-guard.js';

// --- GUARD DE SEGURANÇA (HM-1/H3): banco de testes dedicado, nome exato, host local; ver lib/test-database-guard.ts ---
assertTestDatabase();

/**
 * F7-4a - Automacoes n8n do onboarding (DEC-F7-016) contra PostgreSQL real e SIMULADOR do n8n.
 * Nenhum n8n real, nenhuma conta real. Segredos abaixo sao valores de TESTE gerados na execucao.
 */
test('Integration Gate: Automacoes n8n (F7-4a) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'ci-integration-encryption-key-0123456789';
  process.env.N8N_ALLOWED_HOSTS = 'n8n.mock';
  process.env.N8N_CALLBACK_BASE_URL = 'https://hub.mock';
  delete process.env.N8N_ALLOW_INSECURE_HTTP;
  process.env.N8N_DISPATCH_ENABLED = 'false';

  const secretA = `ci-n8n-secret-a-${run}-${randomUUID()}`;
  const secretB = `ci-n8n-secret-b-${run}-${randomUUID()}`;
  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-aut-a-${run}`, name: 'CI Aut A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-aut-b-${run}`, name: 'CI Aut B' } });
  const orgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.webhookEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-aut-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const c1 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Aut 1' } });
  const c2 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Aut 2' } });
  const c3 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Aut 3' } });
  const c4 = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Aut 4' } });
  for (const m of [managerA, memberA]) {
    await prisma.userClientAssignment.create({ data: { organizationId: orgA.id, organizationMemberId: m.member.id, clientId: c1.id } });
  }

  type Who = { user: { id: string } };
  const call = (who: Who | null, org: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      cookies: who ? { token: (app as any).jwt.sign({ sub: who.user.id, email: 'ci@zafira.test', activeOrganizationId: org }) } : undefined,
      payload: payload as any,
    });
  const A = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => call(who, orgA.id, method, url, payload);
  const B = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => call(who, orgB.id, method, url, payload);

  const mockA = createN8nMock({ secret: secretA });
  const mockB = createN8nMock({ secret: secretB });
  const svcA = new AutomationService(mockA.fetch as typeof fetch);
  const HOUR = 3_600_000;

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
  const autoStep = (over: Record<string, unknown> = {}) =>
    S('auto', { kind: 'AUTOMATION', completionCondition: 'AUTOMATION_SUCCEEDED', automationKey: 'boas-vindas', ...over });

  const callbackOf = (orgId: string, payload: unknown, opts: Parameters<typeof mockA.callback>[1] = {}, mock = mockA) => {
    const c = mock.callback(payload, opts);
    return app.inject({ method: 'POST', url: `/integrations/n8n/callback/${orgId}`, headers: c.headers, payload: c.body });
  };

  /* ------------------------------ 1. conexao ------------------------------ */
  await t.test('1. Conexao: so ADMIN configura; segredo nunca volta e fica cifrado', async () => {
    assert.strictEqual((await A(managerA, 'PUT', '/automation/connection', { secret: secretA })).statusCode, 403);
    assert.strictEqual((await A(memberA, 'GET', '/automation/connection')).statusCode, 403);
    assert.strictEqual((await A(adminA, 'PUT', '/automation/connection', { secret: 'curto' })).statusCode, 400);
    const ok = await A(adminA, 'PUT', '/automation/connection', { secret: secretA });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.ok(!ok.body.includes(secretA), 'segredo nao pode voltar na resposta');
    assert.strictEqual(ok.json().configured, true);
    assert.strictEqual(ok.json().dispatcherEnabled, false);
    assert.strictEqual(ok.json().timeoutHours, 24);
    assert.strictEqual(ok.json().maxAttempts, 6);
    const row = await prisma.integrationConnection.findFirstOrThrow({ where: { organizationId: orgA.id, provider: 'N8N' } });
    assert.ok(!JSON.stringify(row).includes(secretA), 'segredo cifrado em repouso');
    const get = await A(adminA, 'GET', '/automation/connection');
    assert.ok(!get.body.includes(secretA));
    assert.strictEqual((await B(adminB, 'PUT', '/automation/connection', { secret: secretB })).statusCode, 200);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: orgA.id, action: 'automation.connection_configured' } });
    assert.ok(audit.length >= 1);
    assert.ok(!JSON.stringify(audit).includes(secretA), 'auditoria sem segredo');
  });

  /* ------------------------------ 2. fluxos ------------------------------ */
  let flowId = '';
  await t.test('2. Fluxos: destino so https e em host permitido; URL com caminho nao volta', async () => {
    const mk = (over: Record<string, unknown>) =>
      A(adminA, 'POST', '/automation/flows', {
        key: 'boas-vindas',
        name: 'Boas-vindas',
        webhookUrl: 'https://n8n.mock/webhook/segredo-do-caminho',
        enabled: true,
        subscribeLifecycle: false,
        includeClientName: false,
        ...over,
      });
    assert.strictEqual((await mk({ webhookUrl: 'http://n8n.mock/webhook/x' })).statusCode, 400);
    assert.strictEqual((await mk({ webhookUrl: 'https://evil.example/webhook/x' })).statusCode, 400);
    assert.strictEqual((await mk({ webhookUrl: 'https://169.254.169.254/latest' })).statusCode, 400);
    assert.strictEqual((await mk({ webhookUrl: 'https://user:pass@n8n.mock/webhook/x' })).statusCode, 400);
    assert.strictEqual((await A(managerA, 'POST', '/automation/flows', { key: 'k', name: 'n', webhookUrl: 'https://n8n.mock/x' })).statusCode, 403);
    const ok = await mk({});
    assert.strictEqual(ok.statusCode, 201, ok.body);
    assert.ok(!ok.body.includes('segredo-do-caminho'), 'caminho do webhook nao volta');
    assert.strictEqual(ok.json().webhookHost, 'n8n.mock');
    flowId = ok.json().id;
    assert.strictEqual((await mk({})).statusCode, 409);
    const list = await A(managerA, 'GET', '/automation/flows');
    assert.strictEqual(list.statusCode, 200);
    assert.strictEqual(list.json().length, 1);
    assert.strictEqual((await B(adminB, 'GET', '/automation/flows')).json().length, 0, 'isolamento entre organizacoes');
    assert.strictEqual((await B(adminB, 'PATCH', `/automation/flows/${flowId}`, { enabled: false })).statusCode, 404);
  });

  /* ------------------------------ 3. modelo ------------------------------ */
  let templateId = '';
  await t.test('3. Modelo: etapa AUTOMATION exige fluxo habilitado; conclusao manual e proibida', async () => {
    const created = (await A(adminA, 'POST', '/onboarding/templates', { name: `CI Aut Modelo ${run}` })).json();
    const put = async (steps: unknown[]) => {
      const fresh = (await A(adminA, 'GET', `/onboarding/templates/${created.id}`)).json();
      return A(adminA, 'PUT', `/onboarding/templates/${created.id}/versions/${created.draft.id}`, {
        expectedUpdatedAt: fresh.draft.updatedAt,
        steps,
      });
    };
    // rascunho aceita incompleto; a validacao de publicacao aponta o problema
    const check = async (steps: unknown[]) => {
      const saved = await put(steps);
      assert.strictEqual(saved.statusCode, 200, saved.body);
      const v = await A(adminA, 'POST', `/onboarding/templates/${created.id}/versions/${created.draft.id}/validate`);
      assert.strictEqual(v.json().publishable, false);
      return v.json().problems.map((p: any) => p.code) as string[];
    };
    assert.ok((await check([autoStep({ automationKey: null })])).includes('AUTOMATION_KEY_REQUIRED'));
    assert.ok((await check([autoStep({ automationKey: 'nao-existe' })])).includes('AUTOMATION_FLOW_INVALID'));
    assert.ok((await check([autoStep({ completionCondition: 'CONFIRMATION' })])).includes('CONDITION_MISMATCH'));
    const ok = await put([autoStep(), S('depois', { dependsOn: ['auto'], title: 'Depois da automacao' })]);
    assert.strictEqual(ok.statusCode, 200, ok.body);
    const pub = await A(adminA, 'POST', `/onboarding/templates/${created.id}/versions/${created.draft.id}/publish`, {
      expectedUpdatedAt: ok.json().draft.updatedAt,
      changeNote: 'modelo com automacao',
    });
    assert.strictEqual(pub.statusCode, 200, pub.body);
    templateId = created.id;
  });

  const start = async (clientId: string) => {
    const s = await A(adminA, 'POST', '/onboarding/executions', { clientId, templateId });
    assert.strictEqual(s.statusCode, 201, s.body);
    return s.json() as any;
  };
  const stepOf = (v: any, key = 'auto') => v.steps.find((s: any) => s.stepKey === key);
  const outboxOf = (executionId: string, stepKey = 'auto') =>
    prisma.automationOutbox.findMany({ where: { executionId, stepKey, eventType: 'STEP_AUTOMATION' }, orderBy: { generation: 'asc' } });
  const view = async (id: string) => (await A(adminA, 'GET', `/onboarding/executions/${id}`)).json() as any;

  const markSent = (id: string) =>
    prisma.automationOutbox.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: 1 } });

  /* ------------------------------ 4. persistencia antes do envio ------------------------------ */
  let exec1: any;
  await t.test('4. Pedido persistido ao liberar a etapa; despachante desligado nunca conclui', async () => {
    exec1 = await start(c1.id);
    const rows = await outboxOf(exec1.id);
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].status, rows[0].generation, rows[0].attempts], ['PENDING', 1, 0]);
    assert.strictEqual(rows[0].organizationId, orgA.id);
    const st = stepOf(exec1);
    assert.strictEqual(st.automation.status, 'PENDING');
    assert.strictEqual(st.automation.dispatcherEnabled, false);
    assert.ok(!st.actions.includes('complete'), 'sem conclusao manual');
    assert.strictEqual(st.assigneeIssue, null, 'etapa automatica nao conta como sem responsavel');
    const listed = (await A(adminA, 'GET', '/onboarding/executions')).json().find((x: any) => x.id === exec1.id);
    assert.strictEqual(listed.counts.unassigned, 1, 'so a etapa manual conta como sem responsavel');
    const manual = await A(adminA, 'POST', `/onboarding/executions/${exec1.id}/steps/auto/complete`, {});
    assert.strictEqual(manual.statusCode, 409);
    assert.strictEqual(manual.json().code, 'AUTOMATION_MANUAL_COMPLETION_NOT_ALLOWED');
    const off = await svcA.dispatchDue();
    assert.strictEqual(off.enabled, false);
    assert.strictEqual(mockA.state.requests.length, 0, 'nada enviado com o despachante desligado');
    assert.strictEqual(stepOf(await view(exec1.id)).status, 'READY');
    // idempotente: reiniciar a liberacao nao duplica
    const dup = await prisma.automationOutbox.createMany({
      data: [{ organizationId: orgA.id, executionId: exec1.id, stepKey: 'auto', flowKey: 'boas-vindas', eventType: 'STEP_AUTOMATION', generation: 1, idempotencyKey: `dup-${run}` }],
      skipDuplicates: true,
    }).catch((e) => e);
    assert.ok(dup instanceof Error || (dup as any).count === 0, 'indice unico impede segundo pedido da mesma geracao');
    assert.strictEqual((await outboxOf(exec1.id)).length, 1);
  });

  /* ------------------------------ 5. envio, falha de rede, retentativas ------------------------------ */
  await t.test('5. Envio assinado; falha de rede/5xx reagenda sem concluir; chave estavel', async () => {
    process.env.N8N_DISPATCH_ENABLED = 'true';
    mockA.state.script.push('network', 503, 200);
    const t0 = new Date();
    let r = await svcA.dispatchDue({ now: t0, organizationId: orgA.id });
    assert.strictEqual(r.enabled, true);
    let row = (await outboxOf(exec1.id))[0];
    assert.strictEqual(row.status, 'RETRYING');
    assert.strictEqual(row.attempts, 1);
    assert.strictEqual(stepOf(await view(exec1.id)).status, 'READY', 'falha de rede nunca conclui');
    // ainda nao venceu: nada e enviado
    r = await svcA.dispatchDue({ now: new Date(t0.getTime() + 1000), organizationId: orgA.id });
    assert.strictEqual((r as any).claimed, 0);
    r = await svcA.dispatchDue({ now: new Date(t0.getTime() + 2 * 60_000), organizationId: orgA.id });
    row = (await outboxOf(exec1.id))[0];
    assert.strictEqual(row.status, 'RETRYING');
    assert.strictEqual(row.attempts, 2);
    r = await svcA.dispatchDue({ now: new Date(t0.getTime() + 2 * HOUR), organizationId: orgA.id });
    row = (await outboxOf(exec1.id))[0];
    assert.strictEqual(row.status, 'SENT');
    assert.strictEqual(row.attempts, 3);
    assert.ok(row.sentAt);
    const reqs = mockA.state.requests;
    assert.strictEqual(reqs.length, 3);
    assert.ok(reqs.every((q: any) => q.signatureValid), 'assinatura valida em todos os envios');
    assert.ok(reqs.every((q: any) => q.redirect === 'manual'), 'sem seguir redirecionamentos');
    assert.ok(reqs.every((q: any) => q.headers['x-zafira-idempotency-key'] === row.idempotencyKey), 'chave estavel nos reenvios');
    const sent = JSON.parse(reqs[2].body);
    assert.strictEqual(sent.organizationId, orgA.id);
    assert.strictEqual(sent.clientId, c1.id);
    assert.strictEqual(sent.stepKey, 'auto');
    assert.strictEqual(sent.callbackUrl, `https://hub.mock/integrations/n8n/callback/${orgA.id}`);
    assert.ok(!('clientName' in sent), 'nome do cliente so se o fluxo permitir');
    const all = JSON.stringify(reqs);
    assert.ok(!all.includes(secretA) && !all.includes('HUB_INTERNAL_API_KEY'), 'segredos nao viajam');
    assert.strictEqual(stepOf(await view(exec1.id)).status, 'READY', 'enviado nao e concluido');
    assert.strictEqual(stepOf(await view(exec1.id)).automation.status, 'SENT');
  });

  /* ------------------------------ 6. callback: seguranca ------------------------------ */
  await t.test('6. Callback: assinatura, janela de tempo, organizacao e pedido', async () => {
    const row = (await outboxOf(exec1.id))[0];
    const payload = { idempotencyKey: row.idempotencyKey, callbackId: `cb-${run}-1`, status: 'SUCCEEDED' };
    const forged = await callbackOf(orgA.id, payload, { secret: 'segredo-errado-0123456789-0123456789' });
    assert.strictEqual(forged.statusCode, 401);
    const stale = await callbackOf(orgA.id, payload, { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    assert.strictEqual(stale.statusCode, 401);
    const noHeaders = await app.inject({ method: 'POST', url: `/integrations/n8n/callback/${orgA.id}`, payload });
    assert.strictEqual(noHeaders.statusCode, 401);
    // segredo da organizacao B contra a URL da organizacao A
    const cross = await callbackOf(orgA.id, payload, {}, mockB);
    assert.strictEqual(cross.statusCode, 401);
    // organizacao B assinando corretamente, mas com a chave do pedido da A: pedido nao existe na B
    const otherOrg = await callbackOf(orgB.id, payload, {}, mockB);
    assert.strictEqual(otherOrg.statusCode, 404);
    // organizacao inexistente
    const none = await callbackOf(randomUUID(), payload);
    assert.strictEqual(none.statusCode, 401);
    // corpo invalido, mas assinado
    const bad = await callbackOf(orgA.id, { idempotencyKey: row.idempotencyKey, status: 'TALVEZ' });
    assert.strictEqual(bad.statusCode, 400);
    const after = (await outboxOf(exec1.id))[0];
    assert.strictEqual(after.status, 'SENT', 'nenhum pedido invalido altera o estado');
    assert.strictEqual(stepOf(await view(exec1.id)).status, 'READY');
    // dados do callback invalido nao vazam segredo
    assert.ok(!forged.body.includes(secretA));
  });

  /* ------------------------------ 7. resultado valido conclui uma vez ------------------------------ */
  await t.test('7. Resultado SUCCEEDED conclui a etapa uma vez; repeticao e tardio sao ignorados', async () => {
    const row = (await outboxOf(exec1.id))[0];
    const payload = {
      idempotencyKey: row.idempotencyKey,
      callbackId: `cb-${run}-ok`,
      status: 'SUCCEEDED',
      resultCode: 'OK',
      message: 'Concluido pelo fluxo',
      externalRefs: [{ type: 'n8n', label: 'Execucao 123', url: 'https://n8n.mock/execution/123' }],
    };
    const ok = await callbackOf(orgA.id, payload);
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(ok.json().applied, true);
    const v = await view(exec1.id);
    assert.strictEqual(stepOf(v).status, 'DONE');
    assert.strictEqual(stepOf(v).completedBySystem, true);
    assert.strictEqual(stepOf(v).automation.status, 'SUCCEEDED');
    assert.strictEqual(stepOf(v, 'depois').status, 'READY', 'dependente liberada');
    const events = await prisma.onboardingExecutionEvent.findMany({ where: { executionId: exec1.id, stepKey: 'auto', type: 'STEP_COMPLETED' } });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].actorUserId, null, 'autoria do sistema');
    const refs = (await outboxOf(exec1.id))[0];
    assert.ok(refs.appliedAt);
    // repeticao do mesmo resultado
    const replay = await callbackOf(orgA.id, payload);
    assert.strictEqual(replay.statusCode, 200);
    assert.strictEqual(replay.json().applied, false);
    // mesmo pedido, novo callbackId, depois de concluido: ignorado, nao regride
    const late = await callbackOf(orgA.id, { ...payload, callbackId: `cb-${run}-late`, status: 'FAILED', message: 'tarde' });
    assert.strictEqual(late.statusCode, 200);
    assert.strictEqual(late.json().applied, false);
    const again = await outboxOf(exec1.id);
    assert.strictEqual(again[0].status, 'SUCCEEDED');
    assert.strictEqual((await prisma.onboardingExecutionEvent.count({ where: { executionId: exec1.id, stepKey: 'auto', type: 'STEP_COMPLETED' } })), 1);
  });

  /* ------------------------------ 8. etapa bloqueada ------------------------------ */
  await t.test('8. Etapa bloqueada: resultado fica registrado e e aplicado ao desbloquear', async () => {
    const e = await start(c2.id);
    const blk = await A(adminA, 'POST', `/onboarding/executions/${e.id}/steps/auto/block`, { reason: 'aguardando cliente' });
    assert.strictEqual(blk.statusCode, 200, blk.body);
    const row = (await outboxOf(e.id))[0];
    await markSent(row.id);
    const res = await callbackOf(orgA.id, { idempotencyKey: row.idempotencyKey, callbackId: `cb-${run}-blk`, status: 'SUCCEEDED' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().reason, 'PENDING_UNBLOCK');
    let v = await view(e.id);
    assert.notStrictEqual(stepOf(v).status, 'DONE');
    assert.strictEqual(stepOf(v).automation.status, 'SUCCEEDED');
    assert.strictEqual(stepOf(v).automation.appliedAt, null);
    const unb = await A(adminA, 'POST', `/onboarding/executions/${e.id}/steps/auto/unblock`, { reason: 'liberado' });
    assert.strictEqual(unb.statusCode, 200, unb.body);
    v = await view(e.id);
    assert.strictEqual(stepOf(v).status, 'DONE');
    assert.ok(stepOf(v).automation.appliedAt);
  });

  /* ------------------------------ 9. falha definitiva, reenvio e nova geracao ------------------------------ */
  await t.test('9. Falha: sem conclusao manual; reenvio RETRY (mesma chave) e REDO (nova geracao, antiga ignorada)', async () => {
    const e = await start(c3.id);
    const row = (await outboxOf(e.id))[0];
    await markSent(row.id);
    const fail = await callbackOf(orgA.id, { idempotencyKey: row.idempotencyKey, callbackId: `cb-${run}-f1`, status: 'FAILED', resultCode: 'E1', message: 'erro do fluxo' });
    assert.strictEqual(fail.json().applied, true);
    let v = await view(e.id);
    assert.strictEqual(stepOf(v).automation.status, 'FAILED');
    assert.strictEqual(stepOf(v).automation.canResend, true);
    assert.notStrictEqual(stepOf(v).status, 'DONE');
    const manual = await A(adminA, 'POST', `/onboarding/executions/${e.id}/steps/auto/complete`, {});
    assert.strictEqual(manual.statusCode, 409);
    // permissao e justificativa
    const resendUrl = `/onboarding/executions/${e.id}/steps/auto/automation/resend`;
    assert.strictEqual((await A(memberA, 'POST', resendUrl, { mode: 'RETRY', reason: 'tentar de novo' })).statusCode, 403);
    assert.strictEqual((await A(adminA, 'POST', resendUrl, { mode: 'RETRY', reason: 'x' })).statusCode, 400);
    // RETRY: mesma chave
    const retry = await A(adminA, 'POST', resendUrl, { mode: 'RETRY', reason: 'instabilidade do fluxo' });
    assert.strictEqual(retry.statusCode, 200, retry.body);
    let rows = await outboxOf(e.id);
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].status, rows[0].attempts, rows[0].idempotencyKey], ['PENDING', 0, row.idempotencyKey]);
    // nao reenvia o que nao falhou
    assert.strictEqual((await A(adminA, 'POST', resendUrl, { mode: 'RETRY', reason: 'de novo sem falha' })).statusCode, 409);
    // falha de novo, depois REDO: nova geracao e nova chave
    await callbackOf(orgA.id, { idempotencyKey: row.idempotencyKey, callbackId: `cb-${run}-f2`, status: 'FAILED' }).catch(() => undefined);
    await prisma.automationOutbox.update({ where: { id: rows[0].id }, data: { status: 'FAILED', finishedAt: new Date() } });
    const redo = await A(adminA, 'POST', resendUrl, { mode: 'REDO', reason: 'refazer do zero' });
    assert.strictEqual(redo.statusCode, 200, redo.body);
    rows = await outboxOf(e.id);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1].generation, 2);
    assert.notStrictEqual(rows[1].idempotencyKey, rows[0].idempotencyKey);
    // resultado tardio da geracao antiga nao conclui a etapa
    await prisma.automationOutbox.update({ where: { id: rows[0].id }, data: { status: 'SENT' } });
    const old = await callbackOf(orgA.id, { idempotencyKey: rows[0].idempotencyKey, callbackId: `cb-${run}-old`, status: 'SUCCEEDED' });
    assert.strictEqual(old.json().applied, false);
    v = await view(e.id);
    assert.notStrictEqual(stepOf(v).status, 'DONE', 'geracao substituida nao conclui');
    // a nova geracao conclui
    await markSent(rows[1].id);
    const okNew = await callbackOf(orgA.id, { idempotencyKey: rows[1].idempotencyKey, callbackId: `cb-${run}-new`, status: 'SUCCEEDED' });
    assert.strictEqual(okNew.json().applied, true);
    assert.strictEqual(stepOf(await view(e.id)).status, 'DONE');
    // dispensa justificada continua possivel para etapa que falha (coberta pelas regras gerais de skip)
  });

  /* ------------------------------ 10. prazo ------------------------------ */
  await t.test('10. Prazo: sem resultado dentro do limite vira TIMED_OUT e nunca conclui', async () => {
    const e = await start(c4.id);
    const row = (await outboxOf(e.id))[0];
    await prisma.automationOutbox.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date(Date.now() - 30 * HOUR), attempts: 1 },
    });
    const n = await svcA.sweepTimeouts(new Date());
    assert.ok(n >= 1);
    const after = (await outboxOf(e.id))[0];
    assert.strictEqual(after.status, 'TIMED_OUT');
    const v = await view(e.id);
    assert.strictEqual(stepOf(v).automation.status, 'TIMED_OUT');
    assert.strictEqual(stepOf(v).automation.canResend, true);
    assert.notStrictEqual(stepOf(v).status, 'DONE');
    // resultado valido depois do prazo nao e aplicado (a etapa pede reenvio)
    const late = await callbackOf(orgA.id, { idempotencyKey: row.idempotencyKey, callbackId: `cb-${run}-to`, status: 'SUCCEEDED' });
    assert.strictEqual(late.json().applied, false);
    assert.notStrictEqual(stepOf(await view(e.id)).status, 'DONE');
  });

  /* ------------------------------ 11. isolamento ------------------------------ */
  await t.test('11. Isolamento entre organizacoes e carteira', async () => {
    const e = await start(c1.id).catch(() => null);
    const id = (e as any)?.id ?? exec1.id;
    assert.strictEqual((await B(adminB, 'GET', `/onboarding/executions/${id}/automation`)).json().length ?? 0, 0);
    const resendB = await B(adminB, 'POST', `/onboarding/executions/${id}/steps/auto/automation/resend`, { mode: 'RETRY', reason: 'tentativa indevida' });
    assert.ok([404, 409].includes(resendB.statusCode), resendB.body);
    const hist = await A(managerA, 'GET', `/onboarding/executions/${exec1.id}/automation`);
    assert.strictEqual(hist.statusCode, 200);
    assert.ok(hist.json().length >= 1);
    assert.ok(!hist.body.includes(secretA));
    // gerente sem carteira no cliente c2 nao reenvia
    const c2exec = await prisma.onboardingExecution.findFirstOrThrow({ where: { organizationId: orgA.id, clientId: c2.id } });
    const denied = await A(managerA, 'POST', `/onboarding/executions/${c2exec.id}/steps/auto/automation/resend`, { mode: 'RETRY', reason: 'sem carteira' });
    assert.ok([403, 404].includes(denied.statusCode), denied.body);
  });

  /* ------------------------------ 12. ciclo de vida opcional ------------------------------ */
  await t.test('12. Notificacao de ciclo de vida: opcional por fluxo, informativa e sem concluir etapa', async () => {
    await A(adminA, 'POST', '/automation/flows', {
      key: 'avisos',
      name: 'Avisos',
      webhookUrl: 'https://n8n.mock/webhook/avisos',
      enabled: true,
      subscribeLifecycle: true,
      includeClientName: true,
    });
    const client = await prisma.client.create({ data: { organizationId: orgA.id, name: 'CI Cliente Aut 5' } });
    const e = await start(client.id);
    const life = await prisma.automationOutbox.findMany({ where: { executionId: e.id, eventType: 'EXECUTION_STARTED' } });
    assert.strictEqual(life.length, 1);
    assert.strictEqual(life[0].flowKey, 'avisos');
    mockA.state.requests.length = 0;
    await svcA.dispatchDue({ now: new Date(), organizationId: orgA.id });
    const lifeReq = mockA.state.requests.find((q: any) => q.headers['x-zafira-event'] === 'EXECUTION_STARTED');
    assert.ok(lifeReq, 'evento enviado');
    assert.strictEqual(JSON.parse(lifeReq.body).clientName, 'CI Cliente Aut 5');
    const done = await prisma.automationOutbox.findFirstOrThrow({ where: { id: life[0].id } });
    assert.strictEqual(done.status, 'SUCCEEDED');
    assert.strictEqual(stepOf(await view(e.id)).status, 'READY', 'aviso nao conclui etapa');
  });

  /* ------------------------------ 13. regras do banco ------------------------------ */
  await t.test('13. Regras no banco: identidade imutavel, SUCCEEDED definitivo, historico protegido, indices', async () => {
    const row = (await outboxOf(exec1.id))[0];
    await assert.rejects(prisma.automationOutbox.update({ where: { id: row.id }, data: { status: 'FAILED' } }), /automation_outbox_final/);
    await assert.rejects(prisma.automationOutbox.update({ where: { id: row.id }, data: { generation: 9 } }), /automation_outbox_immutable/);
    await assert.rejects(prisma.automationOutbox.update({ where: { id: row.id }, data: { idempotencyKey: 'outra' } }), /automation_outbox_immutable/);
    await assert.rejects(prisma.automationOutbox.delete({ where: { id: row.id } }), /automation_outbox_history_protected/);
    await assert.rejects(
      prisma.automationOutbox.create({
        data: { organizationId: orgA.id, executionId: exec1.id, stepKey: 'auto', flowKey: 'boas-vindas', eventType: 'STEP_AUTOMATION', generation: 1, idempotencyKey: `outra-${run}` },
      }),
      /Unique constraint|automation_outbox_unique_request/
    );
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname IN ('automation_outbox_unique_request','calendar_events_attendee_hashes_gin')`;
    assert.strictEqual(idx.length, 2, 'indices protegidos presentes (inclui o GIN do calendario)');
  });

  /* ------------------------------ 14. desconexao ------------------------------ */
  await t.test('14. Desconectar o n8n: pedidos novos falham sem concluir; callbacks deixam de ser aceitos', async () => {
    const del = await A(adminA, 'DELETE', '/automation/connection');
    assert.strictEqual(del.statusCode, 200, del.body);
    assert.strictEqual(del.json().configured, false);
    const row = (await outboxOf(exec1.id))[0];
    const cb = await callbackOf(orgA.id, { idempotencyKey: row.idempotencyKey, callbackId: `cb-${run}-x`, status: 'SUCCEEDED' });
    assert.strictEqual(cb.statusCode, 401);
    process.env.N8N_DISPATCH_ENABLED = 'false';
  });
});
