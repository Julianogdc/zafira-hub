import test from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

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

/**
 * F7-1a — Construtor de onboarding (DEC-F7-005) contra PostgreSQL descartável real.
 * Provas: migration sem dados; permissões por papel; isolamento entre organizações;
 * funções independentes do RBAC; versionamento e imutabilidade (API e banco); stepKey estável;
 * unicidade e concorrência no banco; automação indisponível; eventos e auditoria.
 * Os nomes de modelos/etapas/funções abaixo são FIXTURES DE TESTE (removidas ao final).
 */
test('Integration Gate: Construtor de Onboarding (F7-1a) em PostgreSQL', { concurrency: 1 }, async (t) => {
  const run = randomUUID().slice(0, 8);
  const TABLES = [
    'organization_functions',
    'organization_function_members',
    'onboarding_templates',
    'onboarding_template_versions',
    'onboarding_step_definitions',
    'onboarding_step_dependencies',
    'onboarding_events',
  ];

  // Prova: a migration não cria nenhuma linha (banco de CI recém migrado)
  const initialCounts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
    initialCounts[table] = Number(rows[0].n);
  }

  const app: FastifyInstance = buildApp();
  await app.ready();

  const orgA = await prisma.organization.create({ data: { slug: `ci-onb-a-${run}`, name: 'CI Onboarding A' } });
  const orgB = await prisma.organization.create({ data: { slug: `ci-onb-b-${run}`, name: 'CI Onboarding B' } });
  const mkUser = async (label: string, organizationId: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    const user = await prisma.user.create({ data: { name: `CI ${label}`, email: `ci-onb-${label}-${run}@zafira.test` } });
    const member = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
    return { user, member };
  };
  const adminA = await mkUser('admin-a', orgA.id, 'ADMIN');
  const managerA = await mkUser('manager-a', orgA.id, 'MANAGER');
  const memberA = await mkUser('member-a', orgA.id, 'MEMBER');
  const adminB = await mkUser('admin-b', orgB.id, 'ADMIN');
  const memberB = await mkUser('member-b', orgB.id, 'MEMBER');

  const createdOrgIds = [orgA.id, orgB.id];
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@zafira.test` } } });
    await app.close();
    await prisma.$disconnect();
  });

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

  await t.test('0. Migration não cria dados (fixtures de teste não existem antes do teste)', async () => {
    for (const table of TABLES) {
      assert.strictEqual(initialCounts[table], 0, `${table} deveria estar vazia logo após a migration`);
    }
  });

  await t.test('1. Matriz de permissões por papel (e prefixo /api; sem sessão = 401)', async () => {
    assert.strictEqual((await call(null, orgA.id, 'GET', '/onboarding/templates')).statusCode, 401);
    for (const [label, who] of [['ADMIN', adminA], ['MANAGER', managerA], ['MEMBER', memberA]] as const) {
      const list = await call(who, orgA.id, 'GET', '/onboarding/templates');
      assert.strictEqual(list.statusCode, 200, `${label} lista modelos`);
      assert.deepStrictEqual(list.json(), [], `${label} vê lista vazia (nada pré-criado)`);
      assert.strictEqual((await call(who, orgA.id, 'GET', '/api/onboarding/functions')).statusCode, 200, `${label} lista funções (/api)`);
    }
    for (const [label, who] of [['MANAGER', managerA], ['MEMBER', memberA]] as const) {
      const body = { name: `CI proibido ${label}` };
      assert.strictEqual((await call(who, orgA.id, 'POST', '/onboarding/templates', body)).statusCode, 403, `${label} não cria modelo`);
      assert.strictEqual((await call(who, orgA.id, 'POST', '/onboarding/functions', body)).statusCode, 403, `${label} não cria função`);
    }
    assert.strictEqual(await prisma.onboardingTemplate.count({ where: { organizationId: orgA.id } }), 0, 'nada foi criado pelas tentativas negadas');
  });

  let templateId = '';
  let v1Id = '';
  let fnDesignerId = '';

  await t.test('2. Funções: criar, nome único sem diferenciar maiúsculas, membros ativos; independentes do RBAC', async () => {
    const created = await call(adminA, orgA.id, 'POST', '/onboarding/functions', { name: 'CI Designer' });
    assert.strictEqual(created.statusCode, 201);
    fnDesignerId = created.json().find((f: any) => f.name === 'CI Designer').id;
    assert.strictEqual((await call(adminA, orgA.id, 'POST', '/onboarding/functions', { name: 'ci designer' })).statusCode, 409);
    // a mesma função em outra organização é permitida (unicidade é por organização)
    assert.strictEqual((await call(adminB, orgB.id, 'POST', '/onboarding/functions', { name: 'CI Designer' })).statusCode, 201);

    const before = await prisma.organizationMemberPermission.count({ where: { organizationMemberId: memberA.member.id } });
    const set = await call(adminA, orgA.id, 'PUT', `/onboarding/functions/${fnDesignerId}/members`, { memberIds: [memberA.member.id] });
    assert.strictEqual(set.statusCode, 200);
    assert.deepStrictEqual(set.json().find((f: any) => f.id === fnDesignerId).memberIds, [memberA.member.id]);

    // ser da função NÃO concede nada: o membro continua sem gerir modelos nem funções
    assert.strictEqual((await call(memberA, orgA.id, 'POST', '/onboarding/templates', { name: 'CI via função' })).statusCode, 403);
    assert.strictEqual((await call(memberA, orgA.id, 'POST', '/onboarding/functions', { name: 'CI via função' })).statusCode, 403);
    assert.strictEqual(await prisma.organizationMemberPermission.count({ where: { organizationMemberId: memberA.member.id } }), before);

    // pessoa de outra organização não entra na função
    const foreign = await call(adminA, orgA.id, 'PUT', `/onboarding/functions/${fnDesignerId}/members`, { memberIds: [memberB.member.id] });
    assert.strictEqual(foreign.statusCode, 400);
  });

  await t.test('3. Modelo: criar (nasce com rascunho v1 vazio), nome único e edição de metadados', async () => {
    const res = await call(adminA, orgA.id, 'POST', '/onboarding/templates', {
      name: 'CI Modelo Alfa',
      scopeKind: 'SERVICE',
      scopeLabel: 'Serviço de teste',
    });
    assert.strictEqual(res.statusCode, 201);
    const body = res.json();
    templateId = body.id;
    assert.strictEqual(body.status, 'ACTIVE');
    assert.strictEqual(body.published, null);
    assert.deepStrictEqual([body.draft.versionNumber, body.draft.steps.length], [1, 0]);
    v1Id = body.draft.id;

    assert.strictEqual((await call(adminA, orgA.id, 'POST', '/onboarding/templates', { name: 'ci modelo ALFA' })).statusCode, 409);
    const patched = await call(adminA, orgA.id, 'PATCH', `/onboarding/templates/${templateId}`, { description: 'Descrição de teste' });
    assert.strictEqual(patched.statusCode, 200);
    assert.strictEqual(patched.json().description, 'Descrição de teste');
  });

  await t.test('4. Isolamento: organização B não vê nem altera nada da A (e o inverso)', async () => {
    assert.deepStrictEqual((await call(adminB, orgB.id, 'GET', '/onboarding/templates')).json(), []);
    const urls: Array<[string, string, unknown?]> = [
      ['GET', `/onboarding/templates/${templateId}`],
      ['PATCH', `/onboarding/templates/${templateId}`, { name: 'invadido' }],
      ['POST', `/onboarding/templates/${templateId}/duplicate`],
      ['POST', `/onboarding/templates/${templateId}/archive`],
      ['POST', `/onboarding/templates/${templateId}/versions`],
      ['PUT', `/onboarding/templates/${templateId}/versions/${v1Id}`, { expectedUpdatedAt: new Date().toISOString(), steps: [] }],
      ['POST', `/onboarding/templates/${templateId}/versions/${v1Id}/validate`],
      ['POST', `/onboarding/templates/${templateId}/versions/${v1Id}/publish`, { expectedUpdatedAt: new Date().toISOString(), changeNote: 'invasão' }],
      ['DELETE', `/onboarding/templates/${templateId}/versions/${v1Id}`],
      ['PATCH', `/onboarding/functions/${fnDesignerId}`, { name: 'invadida' }],
      ['PUT', `/onboarding/functions/${fnDesignerId}/members`, { memberIds: [] }],
    ];
    for (const [method, url, payload] of urls) {
      const res = await call(adminB, orgB.id, method as any, url, payload);
      assert.strictEqual(res.statusCode, 404, `${method} ${url}`);
    }
    // token com organização ativa alheia não passa
    const forged = await call(adminB, orgA.id, 'GET', `/onboarding/templates/${templateId}`);
    assert.notStrictEqual(forged.statusCode, 200);
    // recurso da A referenciado num rascunho da B é recusado
    const own = (await call(adminB, orgB.id, 'POST', '/onboarding/templates', { name: 'CI Modelo B' })).json();
    const save = await call(adminB, orgB.id, 'PUT', `/onboarding/templates/${own.id}/versions/${own.draft.id}`, {
      expectedUpdatedAt: own.draft.updatedAt,
      steps: [S('b1', { assigneeMode: 'FUNCTION', functionId: fnDesignerId })],
    });
    assert.strictEqual(save.statusCode, 400);
    assert.ok(save.json().problems.some((p: any) => p.code === 'ASSIGNEE_FUNCTION_INVALID'));
    // dados da A intactos
    const check = await prisma.onboardingTemplate.findUniqueOrThrow({ where: { id: templateId } });
    assert.strictEqual(check.name, 'CI Modelo Alfa');
  });

  await t.test('5. Rascunho: aceita incompleto e ciclo; rejeita integridade quebrada', async () => {
    const detail = (await call(adminA, orgA.id, 'GET', `/onboarding/templates/${templateId}`)).json();
    const base = { expectedUpdatedAt: detail.draft.updatedAt };

    const broken = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${templateId}/versions/${v1Id}`, {
      ...base,
      steps: [S('x', { dependsOn: ['nao-existe'] }), S('x')],
    });
    assert.strictEqual(broken.statusCode, 400);
    const codes = broken.json().problems.map((p: any) => p.code);
    assert.ok(codes.includes('UNKNOWN_DEPENDENCY') && codes.includes('DUPLICATE_STEP_KEY'));

    // ciclo e título vazio podem ser SALVOS (rascunho), mas não publicados
    const cyclic = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${templateId}/versions/${v1Id}`, {
      ...base,
      steps: [S('a', { title: '', dependsOn: ['b'] }), S('b', { dependsOn: ['a'] })],
    });
    assert.strictEqual(cyclic.statusCode, 200);
    const validation = (await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${v1Id}/validate`)).json();
    assert.strictEqual(validation.publishable, false);
    const vc = validation.problems.map((p: any) => p.code);
    assert.ok(vc.includes('DEPENDENCY_CYCLE') && vc.includes('TITLE_REQUIRED'));
    const publishCyclic = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${v1Id}/publish`, {
      expectedUpdatedAt: cyclic.json().draft.updatedAt,
      changeNote: 'tentativa com ciclo',
    });
    assert.strictEqual(publishCyclic.statusCode, 400);
    assert.strictEqual(publishCyclic.json().code, 'NOT_PUBLISHABLE');
    assert.strictEqual((await prisma.onboardingTemplateVersion.findUniqueOrThrow({ where: { id: v1Id } })).status, 'DRAFT');
  });

  let v2Id = '';

  await t.test('6. Versionamento: publicar v1; publicada é imutável na API e no banco; v2 preserva stepKey', async () => {
    const fresh = (await call(adminA, orgA.id, 'GET', `/onboarding/templates/${templateId}`)).json();
    const steps = [
      S('abertura', { assigneeMode: 'FUNCTION', functionId: fnDesignerId, dueBusinessDays: 2 }),
      S('projeto', { kind: 'CONFIRM_ASANA_PROJECT', completionCondition: 'ASANA_PROJECT_LINKED', dependsOn: ['abertura'] }),
      S('evidencia', {
        completionCondition: 'EVIDENCE_PROVIDED', evidenceKind: 'LINK', evidenceRequired: true, dependsOn: ['abertura'], blocksCompletion: true,
      }),
    ];
    const saved = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${templateId}/versions/${v1Id}`, {
      expectedUpdatedAt: fresh.draft.updatedAt,
      steps,
    });
    assert.strictEqual(saved.statusCode, 200, saved.body);
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${v1Id}/validate`)).json().publishable, true);

    const noNote = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${v1Id}/publish`, {
      expectedUpdatedAt: saved.json().draft.updatedAt,
      changeNote: '',
    });
    assert.strictEqual(noNote.statusCode, 400);

    const published = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${v1Id}/publish`, {
      expectedUpdatedAt: saved.json().draft.updatedAt,
      changeNote: 'Primeira versão de teste',
    });
    assert.strictEqual(published.statusCode, 200, published.body);
    const pj = published.json();
    assert.strictEqual(pj.published.versionNumber, 1);
    assert.strictEqual(pj.draft, null);
    const v1Snapshot = JSON.stringify(pj.published.steps);

    // API: escrita em versão publicada → 409
    const putPublished = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${templateId}/versions/${v1Id}`, {
      expectedUpdatedAt: new Date().toISOString(),
      steps: [],
    });
    assert.strictEqual(putPublished.statusCode, 409);
    assert.strictEqual(putPublished.json().code, 'VERSION_PUBLISHED');
    assert.strictEqual((await call(adminA, orgA.id, 'DELETE', `/onboarding/templates/${templateId}/versions/${v1Id}`)).statusCode, 409);

    // BANCO: mesmo sem passar pela API, a versão publicada não muda (gatilho)
    const stepRow = await prisma.onboardingStepDefinition.findFirstOrThrow({ where: { versionId: v1Id, stepKey: 'abertura' } });
    const immutable = /onboarding_version_published_immutable/;
    await assert.rejects(prisma.onboardingStepDefinition.update({ where: { id: stepRow.id }, data: { title: 'adulterado' } }), immutable);
    await assert.rejects(prisma.onboardingStepDefinition.delete({ where: { id: stepRow.id } }), immutable);
    await assert.rejects(
      prisma.onboardingStepDefinition.create({
        data: { organizationId: orgA.id, versionId: v1Id, stepKey: 'intruso', position: 99, title: 'intruso' },
      }),
      immutable
    );
    await assert.rejects(
      prisma.onboardingStepDependency.create({
        data: { organizationId: orgA.id, versionId: v1Id, stepKey: 'projeto', dependsOnStepKey: 'evidencia' },
      }),
      immutable
    );
    await assert.rejects(prisma.onboardingTemplateVersion.update({ where: { id: v1Id }, data: { changeNote: 'adulterada' } }), immutable);
    await assert.rejects(prisma.onboardingTemplateVersion.update({ where: { id: v1Id }, data: { status: 'DRAFT', publishedAt: null } }), immutable);
    await assert.rejects(prisma.onboardingTemplateVersion.delete({ where: { id: v1Id } }), immutable);

    // v2: nova versão a partir da publicada, com os MESMOS stepKey
    const draft2 = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions`);
    assert.strictEqual(draft2.statusCode, 201);
    const d2 = draft2.json().draft;
    v2Id = d2.id;
    assert.strictEqual(d2.versionNumber, 2);
    assert.deepStrictEqual(d2.steps.map((s: any) => s.stepKey), ['abertura', 'projeto', 'evidencia']);
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions`)).statusCode, 409, 'segundo rascunho');

    // edita a v2: remove 'evidencia', adiciona 'revisao', mantém as demais chaves
    const edited = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${templateId}/versions/${v2Id}`, {
      expectedUpdatedAt: d2.updatedAt,
      steps: [
        S('abertura', { title: 'Abertura (v2)', assigneeMode: 'FUNCTION', functionId: fnDesignerId, dueBusinessDays: 3 }),
        S('projeto', { kind: 'CONFIRM_ASANA_PROJECT', completionCondition: 'ASANA_PROJECT_LINKED', dependsOn: ['abertura'] }),
        S('revisao', { dependsOn: ['projeto'] }),
      ],
    });
    assert.strictEqual(edited.statusCode, 200);
    const pub2 = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${v2Id}/publish`, {
      expectedUpdatedAt: edited.json().draft.updatedAt,
      changeNote: 'Remove evidência, adiciona revisão',
    });
    assert.strictEqual(pub2.statusCode, 200, pub2.body);
    const after = pub2.json();
    assert.strictEqual(after.published.versionNumber, 2);
    assert.deepStrictEqual(after.versions.map((v: any) => [v.versionNumber, v.status]), [[2, 'PUBLISHED'], [1, 'PUBLISHED']]);
    assert.strictEqual(after.versions.find((v: any) => v.versionNumber === 2).basedOnVersionId, v1Id);

    // a v1 continua exatamente como foi publicada (execuções futuras da v1 não mudam)
    const v1After = JSON.stringify((await prisma.onboardingStepDefinition.findMany({ where: { versionId: v1Id }, orderBy: { position: 'asc' } })).map((s) => s.stepKey));
    assert.strictEqual(v1After, JSON.stringify(['abertura', 'projeto', 'evidencia']));
    assert.strictEqual(JSON.stringify(JSON.parse(v1Snapshot).map((s: any) => s.title)), JSON.stringify(['CI etapa abertura', 'CI etapa projeto', 'CI etapa evidencia']));
    // o usuário que publicou pode ser removido sem violar a imutabilidade
    await prisma.onboardingTemplateVersion.update({ where: { id: v1Id }, data: { publishedByUserId: null } });
  });

  await t.test('7. Concorrência: rascunho duplicado, publicação simultânea e salvamento desatualizado', async () => {
    // dois "criar rascunho" simultâneos: só um vence
    const [c1, c2] = await Promise.all([
      call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions`),
      call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions`),
    ]);
    assert.deepStrictEqual([c1.statusCode, c2.statusCode].sort(), [201, 409]);
    const draftWinner = (c1.statusCode === 201 ? c1 : c2).json().draft;
    assert.strictEqual(await prisma.onboardingTemplateVersion.count({ where: { templateId, status: 'DRAFT' } }), 1);

    // salvamento desatualizado → 409, sem sobrescrever
    const stale = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${templateId}/versions/${draftWinner.id}`, {
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      steps: [S('zzz')],
    });
    assert.strictEqual(stale.statusCode, 409);
    assert.strictEqual(stale.json().code, 'STALE_DRAFT');
    assert.strictEqual(await prisma.onboardingStepDefinition.count({ where: { versionId: draftWinner.id, stepKey: 'zzz' } }), 0);

    // duas publicações simultâneas do mesmo rascunho: só uma passa
    const [p1, p2] = await Promise.all([
      call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${draftWinner.id}/publish`, {
        expectedUpdatedAt: draftWinner.updatedAt, changeNote: 'publicação concorrente 1',
      }),
      call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/versions/${draftWinner.id}/publish`, {
        expectedUpdatedAt: draftWinner.updatedAt, changeNote: 'publicação concorrente 2',
      }),
    ]);
    assert.deepStrictEqual([p1.statusCode, p2.statusCode].sort(), [200, 409]);
    const numbers = (await prisma.onboardingTemplateVersion.findMany({ where: { templateId }, orderBy: { versionNumber: 'asc' } })).map((v) => v.versionNumber);
    assert.deepStrictEqual(numbers, [1, 2, 3], 'numeração sem buracos nem repetição');
  });

  await t.test('8. Regras no banco, sem passar pela API: unicidade, exclusão mútua e checagens', async () => {
    const [vTpl] = await Promise.all([prisma.onboardingTemplate.findUniqueOrThrow({ where: { id: templateId } })]);

    // segundo rascunho direto no banco → índice parcial
    await prisma.onboardingTemplateVersion.create({ data: { organizationId: orgA.id, templateId: vTpl.id, versionNumber: 4, status: 'DRAFT' } });
    await assert.rejects(
      prisma.onboardingTemplateVersion.create({ data: { organizationId: orgA.id, templateId: vTpl.id, versionNumber: 5, status: 'DRAFT' } })
    );
    // número de versão repetido
    await assert.rejects(
      prisma.onboardingTemplateVersion.create({
        data: { organizationId: orgA.id, templateId: vTpl.id, versionNumber: 3, status: 'PUBLISHED', publishedAt: new Date() },
      })
    );
    // publicada sem data / rascunho com data (checagem)
    await prisma.onboardingTemplateVersion.deleteMany({ where: { templateId: vTpl.id, versionNumber: 4 } });
    await assert.rejects(
      prisma.onboardingTemplateVersion.create({ data: { organizationId: orgA.id, templateId: vTpl.id, versionNumber: 9, status: 'PUBLISHED' } })
    );
    // função: nome repetido com outra caixa, direto no banco
    await assert.rejects(prisma.organizationFunction.create({ data: { organizationId: orgA.id, name: 'CI DESIGNER' } }));
    // etapa com função E pessoa ao mesmo tempo
    const draft = await prisma.onboardingTemplateVersion.create({
      data: { organizationId: orgA.id, templateId: vTpl.id, versionNumber: 4, status: 'DRAFT' },
    });
    await assert.rejects(
      prisma.onboardingStepDefinition.create({
        data: {
          organizationId: orgA.id, versionId: draft.id, stepKey: 'k', position: 0, title: 't',
          assigneeMode: 'FUNCTION', functionId: fnDesignerId, memberId: memberA.member.id,
        },
      })
    );
    // prazo fora da faixa e auto-dependência
    await assert.rejects(
      prisma.onboardingStepDefinition.create({
        data: { organizationId: orgA.id, versionId: draft.id, stepKey: 'k2', position: 1, title: 't', dueBusinessDays: 9999 },
      })
    );
    await prisma.onboardingStepDefinition.create({
      data: { organizationId: orgA.id, versionId: draft.id, stepKey: 'k3', position: 2, title: 't' },
    });
    await assert.rejects(
      prisma.onboardingStepDependency.create({ data: { organizationId: orgA.id, versionId: draft.id, stepKey: 'k3', dependsOnStepKey: 'k3' } })
    );
    // dependência para etapa de OUTRA versão não existe (FK composta)
    await assert.rejects(
      prisma.onboardingStepDependency.create({ data: { organizationId: orgA.id, versionId: draft.id, stepKey: 'k3', dependsOnStepKey: 'abertura' } })
    );
    await prisma.onboardingTemplateVersion.delete({ where: { id: draft.id } });
  });

  await t.test('9. Arquivar bloqueia edição e publicação; reativar libera; duplicar cria rascunho v1 com os mesmos stepKey', async () => {
    const dup = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/duplicate`);
    assert.strictEqual(dup.statusCode, 201);
    const copy = dup.json();
    assert.notStrictEqual(copy.id, templateId);
    assert.strictEqual(copy.name, 'CI Modelo Alfa (cópia)');
    assert.deepStrictEqual([copy.draft.versionNumber, copy.published], [1, null]);
    const sourceLatest = (await call(adminA, orgA.id, 'GET', `/onboarding/templates/${templateId}`)).json().published.steps.map((s: any) => s.stepKey);
    assert.deepStrictEqual(copy.draft.steps.map((s: any) => s.stepKey), sourceLatest);
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${templateId}/duplicate`)).json().name, 'CI Modelo Alfa (cópia 2)');

    const archived = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${copy.id}/archive`);
    assert.strictEqual(archived.statusCode, 200);
    assert.strictEqual(archived.json().status, 'ARCHIVED');
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${copy.id}/archive`)).statusCode, 409);
    const blockedSave = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${copy.id}/versions/${copy.draft.id}`, {
      expectedUpdatedAt: copy.draft.updatedAt, steps: [],
    });
    assert.strictEqual(blockedSave.statusCode, 409);
    assert.strictEqual(blockedSave.json().code, 'TEMPLATE_ARCHIVED');
    assert.strictEqual((await call(adminA, orgA.id, 'POST', `/onboarding/templates/${copy.id}/reactivate`)).statusCode, 200);

    // descartar rascunho (permitido) e modelo sem versões continua existindo
    const discarded = await call(adminA, orgA.id, 'DELETE', `/onboarding/templates/${copy.id}/versions/${copy.draft.id}`);
    assert.strictEqual(discarded.statusCode, 200);
    assert.strictEqual(discarded.json().draft, null);
  });

  await t.test('10. Eventos e auditoria: cada ação relevante deixa trilha com autor, só na organização A', async () => {
    const events = await prisma.onboardingEvent.findMany({ where: { organizationId: orgA.id } });
    const types = new Set(events.map((e) => e.type));
    for (const expected of ['TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'VERSION_PUBLISHED', 'DRAFT_CREATED', 'TEMPLATE_DUPLICATED', 'TEMPLATE_ARCHIVED', 'TEMPLATE_REACTIVATED', 'DRAFT_DISCARDED']) {
      assert.ok(types.has(expected), `evento ${expected}`);
    }
    assert.ok(events.every((e) => e.actorUserId === adminA.user.id), 'autor registrado');
    const published = events.filter((e) => e.type === 'VERSION_PUBLISHED');
    assert.ok(published.every((e) => e.reason && e.reason.length >= 3), 'nota da versão guardada');
    const audits = await prisma.auditLog.count({ where: { organizationId: orgA.id, action: { startsWith: 'onboarding.' } } });
    assert.ok(audits >= events.length, 'AuditLog acompanha os eventos');
    assert.strictEqual(await prisma.onboardingEvent.count({ where: { organizationId: orgB.id, templateId } }), 0);
    assert.strictEqual(await prisma.auditLog.count({ where: { organizationId: orgB.id, entityId: templateId } }), 0);
  });

  await t.test('11. Remoção da organização (cascata) funciona mesmo com versões publicadas', async () => {
    const orgC = await prisma.organization.create({ data: { slug: `ci-onb-c-${run}`, name: 'CI Onboarding C' } });
    const adminC = await mkUser('admin-c', orgC.id, 'ADMIN');
    createdOrgIds.push(orgC.id);
    const tpl = (await call(adminC, orgC.id, 'POST', '/onboarding/templates', { name: 'CI Modelo C' })).json();
    const saved = await call(adminC, orgC.id, 'PUT', `/onboarding/templates/${tpl.id}/versions/${tpl.draft.id}`, {
      expectedUpdatedAt: tpl.draft.updatedAt,
      steps: [S('c1'), S('c2', { dependsOn: ['c1'] })],
    });
    const pub = await call(adminC, orgC.id, 'POST', `/onboarding/templates/${tpl.id}/versions/${tpl.draft.id}/publish`, {
      expectedUpdatedAt: saved.json().draft.updatedAt, changeNote: 'publicada para teste de cascata',
    });
    assert.strictEqual(pub.statusCode, 200, pub.body);
    assert.ok((await prisma.onboardingStepDefinition.count({ where: { organizationId: orgC.id } })) === 2);
    await prisma.auditLog.deleteMany({ where: { organizationId: orgC.id } });
    await prisma.organization.delete({ where: { id: orgC.id } });
    for (const table of ['onboarding_templates', 'onboarding_template_versions', 'onboarding_step_definitions', 'onboarding_step_dependencies', 'onboarding_events']) {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${table}" WHERE "organizationId" = '${orgC.id}'`);
      assert.strictEqual(Number(rows[0].n), 0, `${table} limpa pela cascata`);
    }
  });

  await t.test('12. Histórico publicado não impede remover a pessoa; função em uso não pode ser apagada', async () => {
    const extra = await mkUser('extra-a', orgA.id, 'MEMBER');
    const tpl = (await call(adminA, orgA.id, 'POST', '/onboarding/templates', { name: 'CI Modelo Histórico' })).json();
    const saved = await call(adminA, orgA.id, 'PUT', `/onboarding/templates/${tpl.id}/versions/${tpl.draft.id}`, {
      expectedUpdatedAt: tpl.draft.updatedAt,
      steps: [S('h1', { assigneeMode: 'MEMBER', memberId: extra.member.id }), S('h2', { assigneeMode: 'FUNCTION', functionId: fnDesignerId })],
    });
    assert.strictEqual(saved.statusCode, 200, saved.body);
    const pub = await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/versions/${tpl.draft.id}/publish`, {
      expectedUpdatedAt: saved.json().draft.updatedAt, changeNote: 'histórico com pessoa e função',
    });
    assert.strictEqual(pub.statusCode, 200, pub.body);

    // a pessoa sai da organização: a versão publicada continua intacta
    await prisma.organizationMember.delete({ where: { id: extra.member.id } });
    const stillThere = await prisma.onboardingStepDefinition.findFirstOrThrow({ where: { versionId: tpl.draft.id, stepKey: 'h1' } });
    assert.strictEqual(stillThere.memberId, extra.member.id);

    // pessoa removida não pode ser usada em novo rascunho/publicação
    const draft = (await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/versions`)).json().draft;
    const validation = (await call(adminA, orgA.id, 'POST', `/onboarding/templates/${tpl.id}/versions/${draft.id}/validate`)).json();
    assert.strictEqual(validation.publishable, false);
    assert.ok(validation.problems.some((p: any) => p.code === 'ASSIGNEE_MEMBER_INVALID'));

    // função em uso por versão publicada: o banco impede apagá-la
    await assert.rejects(prisma.organizationFunction.delete({ where: { id: fnDesignerId } }));
  });

  await t.test('13. Pessoas para responsáveis (F7-1b): só ativas da própria organização, sem e-mail; função desativada preserva o histórico', async () => {
    // lista da A: ativas, id/nome/papel apenas
    const mine = await call(memberA, orgA.id, 'GET', '/onboarding/members');
    assert.strictEqual(mine.statusCode, 200);
    const people = mine.json() as Array<Record<string, unknown>>;
    assert.ok(people.some((p) => p.id === adminA.member.id));
    assert.ok(people.every((p) => Object.keys(p).sort().join(',') === 'id,name,role'), 'sem e-mail nem outros campos');
    assert.ok(!people.some((p) => p.id === adminB.member.id), 'nada da organização B');
    // a lista da B não traz ninguém da A
    const theirs = (await call(adminB, orgB.id, 'GET', '/onboarding/members')).json() as Array<{ id: string }>;
    assert.ok(theirs.every((p) => p.id !== adminA.member.id));
    // sem sessão = 401
    assert.strictEqual((await call(null, orgA.id, 'GET', '/onboarding/members')).statusCode, 401);

    // pessoa suspensa some da lista
    const sleeper = await mkUser('suspensa-a', orgA.id, 'MEMBER');
    await prisma.organizationMember.update({ where: { id: sleeper.member.id }, data: { status: 'SUSPENDED' } });
    const after = (await call(adminA, orgA.id, 'GET', '/onboarding/members')).json() as Array<{ id: string }>;
    assert.ok(!after.some((p) => p.id === sleeper.member.id));

    // função desativada continua listada (para exibir o histórico) e a versão publicada não muda
    const fns = (await call(adminA, orgA.id, 'GET', '/onboarding/functions')).json() as Array<{ id: string; isActive: boolean }>;
    const fn = fns.find((x) => x.id === fnDesignerId);
    assert.ok(fn, 'função listada');
    const off = await call(adminA, orgA.id, 'PATCH', `/onboarding/functions/${fnDesignerId}`, { isActive: false });
    assert.strictEqual(off.statusCode, 200, off.body);
    const still = (await call(adminA, orgA.id, 'GET', '/onboarding/functions')).json() as Array<{ id: string; isActive: boolean }>;
    assert.strictEqual(still.find((x) => x.id === fnDesignerId)?.isActive, false);
    const rows = await prisma.onboardingStepDefinition.count({ where: { functionId: fnDesignerId } });
    assert.ok(rows > 0, 'etapas publicadas continuam apontando para a função desativada');
  });
});
