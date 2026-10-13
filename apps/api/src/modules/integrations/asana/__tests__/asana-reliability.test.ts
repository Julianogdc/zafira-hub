import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../../../lib/prisma.js';
import { AsanaService, AsanaIntegrationError } from '../asana.service.js';
import { encryptIntegrationCredential } from '../../../../lib/crypto.js';

describe('Asana Reliability, Freshness & Partial Failure Hardening Suite (F6-IMP.2)', () => {
  const testOrgId = 'org-reliability-test-01';
  const otherOrgId = 'org-reliability-test-02';
  const testClientId = 'client-reliability-01';
  const testClientNoProjectsId = 'client-reliability-no-proj';
  const sensitiveToken = 'sensitive_asana_bearer_token_999xyz';

  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;
  let originalClientFindFirst: typeof prisma.client.findFirst;
  let originalConnectionFindFirst: typeof prisma.integrationConnection.findFirst;
  let originalLegacyFindUnique: typeof prisma.organizationIntegration.findUnique;

  let asanaService: AsanaService;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.INTEGRATION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.NODE_ENV = 'test';

    originalFetch = globalThis.fetch;
    originalClientFindFirst = prisma.client.findFirst;
    originalConnectionFindFirst = prisma.integrationConnection.findFirst;
    originalLegacyFindUnique = prisma.organizationIntegration.findUnique;
    prisma.organizationIntegration.deleteMany = (async () => ({ count: 0 })) as any;

    asanaService = new AsanaService();
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    prisma.client.findFirst = originalClientFindFirst;
    prisma.integrationConnection.findFirst = originalConnectionFindFirst;
    prisma.organizationIntegration.findUnique = originalLegacyFindUnique;
  });

  function setupActiveConnectionMock() {
    const credPayload = JSON.stringify({
      accessToken: sensitiveToken,
      refreshToken: 'refresh-token-xyz',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      workspaceId: 'ws-mock-01',
    });
    const ciphertext = encryptIntegrationCredential(credPayload);

    prisma.integrationConnection.findFirst = (async (args: any) => {
      if (args?.where?.organizationId === testOrgId && args?.where?.provider === 'ASANA') {
        return {
          id: 'conn-active-01',
          organizationId: testOrgId,
          provider: 'ASANA',
          status: 'ACTIVE',
          credentialCiphertext: ciphertext,
          externalScopeId: 'ws-mock-01',
        } as any;
      }
      return null;
    }) as any;
  }

  function setupDisconnectedConnectionMock() {
    prisma.integrationConnection.findFirst = (async (args: any) => {
      if (args?.where?.organizationId === testOrgId) {
        return {
          id: 'conn-disc-01',
          organizationId: testOrgId,
          provider: 'ASANA',
          status: 'DISCONNECTED',
          credentialCiphertext: null,
        } as any;
      }
      return null;
    }) as any;
  }

  function setupClientWithProjectsMock(integrations: Array<{ id: string; externalId: string; projectName?: string }>) {
    prisma.client.findFirst = (async (args: any) => {
      if (args?.where?.id === testClientId && args?.where?.organizationId === testOrgId) {
        return {
          id: testClientId,
          name: 'Cliente Confiabilidade Ltda',
          organizationId: testOrgId,
          integrations: integrations.map((it) => ({
            id: it.id,
            clientId: testClientId,
            provider: 'ASANA',
            externalId: it.externalId,
            metadata: { projectName: it.projectName || `Projeto ${it.externalId}` },
            createdAt: new Date('2026-01-01T00:00:00Z'),
          })),
        } as any;
      }

      if (args?.where?.id === testClientNoProjectsId && args?.where?.organizationId === testOrgId) {
        return {
          id: testClientNoProjectsId,
          name: 'Cliente Sem Projetos',
          organizationId: testOrgId,
          integrations: [],
        } as any;
      }

      return null;
    }) as any;
  }

  // =========================================================================
  // CENÁRIO A: Projeto com tarefas reais simuladas e consulta bem-sucedida
  // =========================================================================
  it('Cenário A: deve retornar LIVE com métricas precisas e timestamp quando consulta tem tarefas', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([{ id: 'int-01', externalId: 'proj-live-01', projectName: 'Projeto Live' }]);

    const pastDate = '2020-01-01';
    const futureDate = '2030-01-01';

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/projects/proj-live-01?')) {
        return new Response(JSON.stringify({ data: { name: 'Projeto Live Oficial', color: 'blue' } }), { status: 200 });
      }
      if (urlStr.includes('/projects/proj-live-01/tasks?')) {
        return new Response(
          JSON.stringify({
            data: [
              { gid: 't1', name: 'Tarefa Concluída', completed: true },
              { gid: 't2', name: 'Tarefa Pendente No Prazo', completed: false, due_on: futureDate },
              { gid: 't3', name: 'Tarefa Em Atraso', completed: false, due_on: pastDate },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const projects = await asanaService.getClientProjects(testClientId, testOrgId);

    assert.strictEqual(projects.length, 1);
    const p = projects[0];
    assert.strictEqual(p.metricsStatus, 'LIVE');
    assert.strictEqual(p.totalTasks, 3);
    assert.strictEqual(p.completedTasks, 1);
    assert.strictEqual(p.pendingTasks, 2);
    assert.strictEqual(p.overdueTasks, 1);
    assert.ok(p.metricsUpdatedAt !== null && typeof p.metricsUpdatedAt === 'string');
    assert.strictEqual(p.metricsError, null);
    assert.strictEqual(p.projectName, 'Projeto Live Oficial');
  });

  // =========================================================================
  // CENÁRIO B: Projeto com zero tarefas confirmado pela API
  // =========================================================================
  it('Cenário B: deve retornar LIVE com totalTasks=0 quando a API do Asana confirma projeto vazio', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([{ id: 'int-02', externalId: 'proj-empty-02', projectName: 'Projeto Vazio' }]);

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/projects/proj-empty-02?')) {
        return new Response(JSON.stringify({ data: { name: 'Projeto Vazio', color: null } }), { status: 200 });
      }
      if (urlStr.includes('/projects/proj-empty-02/tasks?')) {
        // Retorna array vazio confirmado pela API
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const projects = await asanaService.getClientProjects(testClientId, testOrgId);

    assert.strictEqual(projects.length, 1);
    const p = projects[0];
    assert.strictEqual(p.metricsStatus, 'LIVE');
    assert.strictEqual(p.totalTasks, 0, 'Zero tarefas deve ser número 0 confirmado, não null nem omitido');
    assert.strictEqual(p.completedTasks, 0);
    assert.strictEqual(p.pendingTasks, 0);
    assert.strictEqual(p.overdueTasks, 0);
    assert.ok(p.metricsUpdatedAt !== null);
    assert.strictEqual(p.metricsError, null);
  });

  // =========================================================================
  // CENÁRIO C: Integração desconectada
  // =========================================================================
  it('Cenário C: getClientProjects retorna UNAVAILABLE e contadores null; getClientTasks lança 400', async () => {
    setupDisconnectedConnectionMock();
    setupClientWithProjectsMock([{ id: 'int-03', externalId: 'proj-disc-03', projectName: 'Projeto Desconectado' }]);

    // Em getClientProjects: não deve lançar, deve retornar o vínculo com UNAVAILABLE
    const projects = await asanaService.getClientProjects(testClientId, testOrgId);
    assert.strictEqual(projects.length, 1);
    const p = projects[0];
    assert.strictEqual(p.metricsStatus, 'UNAVAILABLE');
    assert.strictEqual(p.totalTasks, null, 'Contador não pode ser zerado falsamente quando desconectado');
    assert.strictEqual(p.completedTasks, null);
    assert.strictEqual(p.pendingTasks, null);
    assert.strictEqual(p.overdueTasks, null);
    assert.strictEqual(p.metricsUpdatedAt, null, 'Timestamp não pode ser forjado');
    assert.strictEqual(p.metricsError, null);

    // Em getClientTasks: deve lançar erro explícito de desconexão
    await assert.rejects(
      async () => {
        await asanaService.getClientTasks(testClientId, testOrgId);
      },
      (err: any) => {
        assert.ok(err instanceof AsanaIntegrationError);
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes('desconectada'));
        return true;
      }
    );
  });

  // =========================================================================
  // CENÁRIO D: Token indisponível ou conexão inexistente
  // =========================================================================
  it('Cenário D: deve retornar UNAVAILABLE com contadores null quando não há credencial', async () => {
    prisma.integrationConnection.findFirst = (async () => null) as any;
    prisma.organizationIntegration.findUnique = (async () => null) as any;
    setupClientWithProjectsMock([{ id: 'int-04', externalId: 'proj-no-token', projectName: 'Sem Token' }]);

    const projects = await asanaService.getClientProjects(testClientId, testOrgId);
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].metricsStatus, 'UNAVAILABLE');
    assert.strictEqual(projects[0].totalTasks, null);
    assert.strictEqual(projects[0].metricsUpdatedAt, null);

    await assert.rejects(
      async () => {
        await asanaService.getClientTasks(testClientId, testOrgId);
      },
      (err: any) => {
        assert.ok(err instanceof AsanaIntegrationError);
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  // =========================================================================
  // CENÁRIO E: Asana retornando HTTP 401, 403, 429 e 5xx
  // =========================================================================
  for (const status of [401, 403, 429, 500, 503]) {
    it(`Cenário E: Asana retornando HTTP ${status} marca ERROR em projetos e lança em tasks`, async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-err', externalId: 'proj-err', projectName: 'Projeto Falha' }]);

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ errors: [{ message: `Erro simulado Asana status ${status}` }] }),
          { status }
        );
      };

      // getClientProjects: não falha toda a listagem, mas marca o projeto como ERROR
      const projects = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(projects.length, 1);
      const p = projects[0];
      assert.strictEqual(p.metricsStatus, 'ERROR');
      assert.strictEqual(p.totalTasks, null, `Erro ${status} não pode ser convertido em zero tarefas`);
      assert.strictEqual(p.completedTasks, null);
      assert.strictEqual(p.pendingTasks, null);
      assert.strictEqual(p.overdueTasks, null);
      assert.strictEqual(p.metricsUpdatedAt, null);
      assert.ok(p.metricsError !== null);
      assert.ok(p.metricsError.includes(String(status)) || p.metricsError.includes('Erro simulado'));

      // getClientTasks: deve falhar com o código correto
      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, status);
          assert.ok(!err.message.includes(sensitiveToken), 'Não pode conter o token na mensagem de erro');
          return true;
        }
      );
    });
  }

  // =========================================================================
  // CENÁRIO F: Timeout ou falha de rede
  // =========================================================================
  it('Cenário F: Timeout ou falha de rede deve marcar ERROR em projetos e lançar 502 em tasks', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([{ id: 'int-net', externalId: 'proj-net', projectName: 'Projeto Rede' }]);

    globalThis.fetch = async () => {
      throw new Error('ETIMEDOUT: Connection to app.asana.com timed out');
    };

    const projects = await asanaService.getClientProjects(testClientId, testOrgId);
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].metricsStatus, 'ERROR');
    assert.strictEqual(projects[0].totalTasks, null);
    assert.strictEqual(projects[0].metricsUpdatedAt, null);
    assert.ok(projects[0].metricsError !== null);

    await assert.rejects(
      async () => {
        await asanaService.getClientTasks(testClientId, testOrgId);
      },
      (err: any) => {
        assert.ok(err instanceof AsanaIntegrationError);
        assert.strictEqual(err.statusCode, 502);
        assert.ok(err.message.includes('Falha ao carregar tarefas'));
        return true;
      }
    );
  });

  // =========================================================================
  // CENÁRIO G: Múltiplos projetos — um responde corretamente e outro falha
  // =========================================================================
  it('Cenário G: Múltiplos projetos com falha parcial — getClientProjects diferencia LIVE/ERROR; getClientTasks rejeita resultado parcial', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([
      { id: 'int-ok', externalId: 'proj-ok', projectName: 'Projeto OK' },
      { id: 'int-fail', externalId: 'proj-fail', projectName: 'Projeto Quebrador' },
    ]);

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/proj-ok?')) {
        return new Response(JSON.stringify({ data: { name: 'Projeto OK' } }), { status: 200 });
      }
      if (urlStr.includes('/proj-ok/tasks?')) {
        return new Response(
          JSON.stringify({
            data: [{ gid: 'tok1', name: 'Tarefa do OK', completed: false }],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/proj-fail')) {
        return new Response(JSON.stringify({ errors: [{ message: 'Rate limit excedido' }] }), { status: 429 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    // getClientProjects: projeto 1 LIVE, projeto 2 ERROR
    const projects = await asanaService.getClientProjects(testClientId, testOrgId);
    assert.strictEqual(projects.length, 2);

    const projOk = projects.find((p) => p.projectGid === 'proj-ok');
    const projFail = projects.find((p) => p.projectGid === 'proj-fail');

    assert.ok(projOk);
    assert.strictEqual(projOk.metricsStatus, 'LIVE');
    assert.strictEqual(projOk.totalTasks, 1);
    assert.ok(projOk.metricsUpdatedAt !== null);

    assert.ok(projFail);
    assert.strictEqual(projFail.metricsStatus, 'ERROR');
    assert.strictEqual(projFail.totalTasks, null);
    assert.strictEqual(projFail.metricsUpdatedAt, null);
    assert.ok(projFail.metricsError?.includes('429') || projFail.metricsError?.includes('Rate limit'));

    // getClientTasks: NÃO pode retornar lista parcial contendo apenas o projeto OK!
    await assert.rejects(
      async () => {
        await asanaService.getClientTasks(testClientId, testOrgId);
      },
      (err: any) => {
        assert.ok(err instanceof AsanaIntegrationError);
        assert.strictEqual(err.statusCode, 429);
        assert.ok(err.message.includes('Projeto Quebrador'));
        return true;
      }
    );
  });

  // =========================================================================
  // CENÁRIO H: Todos os projetos respondem corretamente
  // =========================================================================
  it('Cenário H: Todos os projetos respondem corretamente — retorna lista consolidada ordenada', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([
      { id: 'int-p1', externalId: 'proj-1', projectName: 'Projeto 1' },
      { id: 'int-p2', externalId: 'proj-2', projectName: 'Projeto 2' },
    ]);

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/proj-1/tasks?')) {
        return new Response(
          JSON.stringify({
            data: [
              { gid: 't1', name: 'Z - Tarefa Pendente', completed: false, due_on: '2026-12-01' },
              { gid: 't2', name: 'A - Tarefa Concluída', completed: true },
            ],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/proj-2/tasks?')) {
        return new Response(
          JSON.stringify({
            data: [{ gid: 't3', name: 'B - Tarefa Pendente Mais Cedo', completed: false, due_on: '2026-11-01' }],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: { name: 'Projeto' } }), { status: 200 });
    };

    const tasks = await asanaService.getClientTasks(testClientId, testOrgId);
    assert.strictEqual(tasks.length, 3);
    // Ordenação: primeiro pendentes (t3 antes de t1), depois concluídas (t2 por último)
    assert.strictEqual(tasks[0].gid, 't3');
    assert.strictEqual(tasks[1].gid, 't1');
    assert.strictEqual(tasks[2].gid, 't2');
  });

  // =========================================================================
  // CENÁRIO I: Cliente sem projetos vinculados
  // =========================================================================
  it('Cenário I: Cliente sem projetos vinculados retorna lista vazia legítima []', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([]);

    const projects = await asanaService.getClientProjects(testClientNoProjectsId, testOrgId);
    assert.deepStrictEqual(projects, []);

    const tasks = await asanaService.getClientTasks(testClientNoProjectsId, testOrgId);
    assert.deepStrictEqual(tasks, []);
  });

  // =========================================================================
  // CENÁRIO J: Cliente de outra organização ou fora do escopo autorizado
  // =========================================================================
  it('Cenário J: Cliente de outra organização retorna 404 seguro', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([]);

    await assert.rejects(
      async () => {
        await asanaService.getClientProjects('client-alien-999', testOrgId);
      },
      (err: any) => {
        assert.ok(err instanceof AsanaIntegrationError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.message, 'Cliente não encontrado.');
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await asanaService.getClientTasks('client-alien-999', testOrgId);
      },
      (err: any) => {
        assert.ok(err instanceof AsanaIntegrationError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.message, 'Cliente não encontrado.');
        return true;
      }
    );
  });

  // =========================================================================
  // CENÁRIO K: Nenhum dado sensível registrado nos erros
  // =========================================================================
  it('Cenário K: Garantia de que tokens ou segredos nunca vazam nas mensagens de erro', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([{ id: 'int-sec', externalId: 'proj-sec', projectName: 'Projeto Segredo' }]);

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ errors: [{ message: 'Acesso negado para Authorization: Bearer ' + sensitiveToken }] }),
        { status: 403 }
      );
    };

    try {
      await asanaService.getClientTasks(testClientId, testOrgId);
      assert.fail('Deveria ter lançado erro');
    } catch (err: any) {
      assert.ok(err instanceof AsanaIntegrationError);
      const serialized = JSON.stringify({ message: err.message, details: err.details });
      // Se a mensagem do Asana continha o token, deve ser tratada ou sanitizada
      assert.ok(
        !serialized.includes(sensitiveToken),
        'Token sensível jamais pode constar na resposta ou nos detalhes do erro'
      );
    }
  });

  // =========================================================================
  // CENÁRIO L: Consumidores existentes recebem formatos compatíveis
  // =========================================================================
  it('Cenário L: Objeto retornado mantém todas as propriedades legadas e novos campos de confiabilidade', async () => {
    setupActiveConnectionMock();
    setupClientWithProjectsMock([{ id: 'int-compat', externalId: 'proj-compat', projectName: 'Projeto Compat' }]);

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/tasks?')) {
        return new Response(JSON.stringify({ data: [{ gid: 'tc1', completed: false }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { name: 'Projeto Compat', color: 'red' } }), { status: 200 });
    };

    const [proj] = await asanaService.getClientProjects(testClientId, testOrgId);

    // Propriedades legadas
    assert.strictEqual(typeof proj.integrationId, 'string');
    assert.strictEqual(typeof proj.clientId, 'string');
    assert.strictEqual(typeof proj.projectGid, 'string');
    assert.strictEqual(typeof proj.projectName, 'string');
    assert.ok('color' in proj);
    assert.ok('totalTasks' in proj);
    assert.ok('completedTasks' in proj);
    assert.ok('pendingTasks' in proj);
    assert.ok('overdueTasks' in proj);
    assert.ok('createdAt' in proj);

    // Novos campos do Contrato de Confiabilidade
    assert.strictEqual(proj.metricsStatus, 'LIVE');
    assert.strictEqual(typeof proj.metricsUpdatedAt, 'string');
    assert.strictEqual(proj.metricsError, null);
  });

  // =========================================================================
  // F6-IMP.2A: PAGINAÇÃO E COMPLETUDE DAS CONSULTAS ASANA (CENÁRIOS A a N)
  // =========================================================================
  describe('F6-IMP.2A: Paginação e Completude das Consultas Asana', () => {
    // A. Projeto com 0 tarefas — zero confirmado
    it('Cenário A: Projeto com 0 tarefas confirma LIVE e totalTasks=0', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-p0', externalId: 'proj-0', projectName: 'Projeto Zero' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          assert.ok(urlStr.includes('limit=100'), 'Deve solicitar limit=100 explicitamente');
          return new Response(JSON.stringify({ data: [], next_page: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Zero' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.metricsStatus, 'LIVE');
      assert.strictEqual(p.totalTasks, 0);
      assert.strictEqual(p.completedTasks, 0);
      assert.strictEqual(p.pendingTasks, 0);
      assert.strictEqual(p.overdueTasks, 0);
      assert.ok(p.metricsUpdatedAt !== null);

      const tasks = await asanaService.getClientTasks(testClientId, testOrgId);
      assert.deepStrictEqual(tasks, []);
    });

    // B. Projeto com 35 tarefas — página única
    it('Cenário B: Projeto com 35 tarefas em página única consolida integralmente', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-p35', externalId: 'proj-35', projectName: 'Projeto 35' }]);

      const mockTasks = Array.from({ length: 35 }, (_, i) => ({
        gid: `t35_${i}`,
        name: `Tarefa ${i}`,
        completed: i % 2 === 0,
      }));

      let fetchCallCount = 0;
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          fetchCallCount++;
          return new Response(JSON.stringify({ data: mockTasks, next_page: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto 35' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(fetchCallCount, 1);
      assert.strictEqual(p.metricsStatus, 'LIVE');
      assert.strictEqual(p.totalTasks, 35);
      assert.strictEqual(p.completedTasks, 18);
      assert.strictEqual(p.pendingTasks, 17);

      const tasks = await asanaService.getClientTasks(testClientId, testOrgId);
      assert.strictEqual(tasks.length, 35);
    });

    // C. Projeto com 150 tarefas — duas páginas
    it('Cenário C: Projeto com 150 tarefas em duas páginas (100 + 50) consolida todas', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-p150', externalId: 'proj-150', projectName: 'Projeto 150' }]);

      const page1Tasks = Array.from({ length: 100 }, (_, i) => ({
        gid: `t150_p1_${i}`,
        name: `Tarefa P1 ${i}`,
        completed: true,
      }));
      const page2Tasks = Array.from({ length: 50 }, (_, i) => ({
        gid: `t150_p2_${i}`,
        name: `Tarefa P2 ${i}`,
        completed: false,
      }));

      const requestedUrls: string[] = [];
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          requestedUrls.push(urlStr);
          if (urlStr.includes('offset=cursor_page_2')) {
            return new Response(JSON.stringify({ data: page2Tasks, next_page: null }), { status: 200 });
          }
          return new Response(
            JSON.stringify({
              data: page1Tasks,
              next_page: { offset: 'cursor_page_2' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto 150' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(requestedUrls.length, 2, 'Deve ter feito exatamente 2 requisições para 2 páginas');
      assert.ok(requestedUrls[0].includes('limit=100'));
      assert.ok(!requestedUrls[0].includes('offset='));
      assert.ok(requestedUrls[1].includes('offset=cursor_page_2'));

      assert.strictEqual(p.metricsStatus, 'LIVE');
      assert.strictEqual(p.totalTasks, 150);
      assert.strictEqual(p.completedTasks, 100);
      assert.strictEqual(p.pendingTasks, 50);

      const tasks = await asanaService.getClientTasks(testClientId, testOrgId);
      assert.strictEqual(tasks.length, 150);
    });

    // D. Projeto com 250 tarefas — três páginas
    it('Cenário D: Projeto com 250 tarefas em três páginas (100 + 100 + 50) consolida todas', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-p250', externalId: 'proj-250', projectName: 'Projeto 250' }]);

      const p1 = Array.from({ length: 100 }, (_, i) => ({ gid: `t250_1_${i}`, name: `P1 ${i}`, completed: false }));
      const p2 = Array.from({ length: 100 }, (_, i) => ({ gid: `t250_2_${i}`, name: `P2 ${i}`, completed: false }));
      const p3 = Array.from({ length: 50 }, (_, i) => ({ gid: `t250_3_${i}`, name: `P3 ${i}`, completed: true }));

      const requestedOffsets: Array<string | null> = [];
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          const match = urlStr.match(/offset=([^&]+)/);
          requestedOffsets.push(match ? match[1] : null);

          if (match && match[1] === 'c_p3') {
            return new Response(JSON.stringify({ data: p3, next_page: null }), { status: 200 });
          }
          if (match && match[1] === 'c_p2') {
            return new Response(JSON.stringify({ data: p2, next_page: { offset: 'c_p3' } }), { status: 200 });
          }
          return new Response(JSON.stringify({ data: p1, next_page: { offset: 'c_p2' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto 250' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.deepStrictEqual(requestedOffsets, [null, 'c_p2', 'c_p3']);
      assert.strictEqual(p.metricsStatus, 'LIVE');
      assert.strictEqual(p.totalTasks, 250);
      assert.strictEqual(p.completedTasks, 50);
      assert.strictEqual(p.pendingTasks, 200);

      const tasks = await asanaService.getClientTasks(testClientId, testOrgId);
      assert.strictEqual(tasks.length, 250);
    });

    // E. Primeira página OK e segunda página com HTTP 429
    it('Cenário E: Primeira página OK e segunda com HTTP 429 marca ERROR e lança sem resultado parcial', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-p429', externalId: 'proj-429', projectName: 'Projeto 429' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          if (urlStr.includes('offset=cursor_p2')) {
            return new Response(JSON.stringify({ errors: [{ message: 'Rate limit excedido na página 2' }] }), {
              status: 429,
            });
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 't1', name: 'Tarefa 1', completed: true }],
              next_page: { offset: 'cursor_p2' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto 429' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.metricsStatus, 'ERROR', 'Não pode marcar LIVE se a 2ª página falhou');
      assert.strictEqual(p.totalTasks, null, 'Não pode conter contadores parciais da 1ª página');
      assert.strictEqual(p.metricsUpdatedAt, null);
      assert.ok(p.metricsError?.includes('429') || p.metricsError?.includes('Rate limit'));

      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, 429);
          return true;
        }
      );
    });

    // F. Primeira página OK e segunda página com HTTP 500
    it('Cenário F: Primeira página OK e segunda com HTTP 500 marca ERROR e lança sem resultado parcial', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-p500', externalId: 'proj-500', projectName: 'Projeto 500' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          if (urlStr.includes('offset=cursor_p2')) {
            return new Response(JSON.stringify({ errors: [{ message: 'Internal Server Error no Asana' }] }), {
              status: 500,
            });
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 't1', name: 'Tarefa 1', completed: false }],
              next_page: { offset: 'cursor_p2' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto 500' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.metricsStatus, 'ERROR');
      assert.strictEqual(p.totalTasks, null);
      assert.strictEqual(p.metricsUpdatedAt, null);

      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, 500);
          return true;
        }
      );
    });

    // G. Falha de rede ou timeout em página posterior
    it('Cenário G: Timeout ou falha de rede na página 2 marca ERROR e lança 502', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-pnet', externalId: 'proj-net-p2', projectName: 'Projeto Rede P2' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          if (urlStr.includes('offset=cursor_p2')) {
            throw new Error('ETIMEDOUT: Connection closed during page 2');
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 't1', name: 'Tarefa 1', completed: false }],
              next_page: { offset: 'cursor_p2' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Rede' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.metricsStatus, 'ERROR');
      assert.strictEqual(p.totalTasks, null);
      assert.strictEqual(p.metricsUpdatedAt, null);

      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, 502);
          return true;
        }
      );
    });

    // H. HTTP 200 com payload inesperado ou inválido (sem array data)
    it('Cenário H: Resposta HTTP 200 malformada (sem array data) não é convertida em zero confirmado', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-pmal', externalId: 'proj-mal', projectName: 'Projeto Malformado' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          // Payload sem propriedade data
          return new Response(JSON.stringify({ status: 'ok', items_count: 50 }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Malformado' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.metricsStatus, 'ERROR', 'Payload inválido deve resultar em ERROR, nunca zero');
      assert.strictEqual(p.totalTasks, null);
      assert.strictEqual(p.metricsUpdatedAt, null);
      assert.ok(p.metricsError?.includes('malformada') || p.metricsError?.includes('inválido'));

      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, 502);
          return true;
        }
      );
    });

    // I. Cursor de paginação repetido, prevenindo loop infinito
    it('Cenário I: Cursor repetido é detectado como ciclo de paginação gerando erro explícito', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-ploop', externalId: 'proj-loop', projectName: 'Projeto Loop' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          // Sempre devolve o mesmo cursor, tentando induzir loop infinito
          return new Response(
            JSON.stringify({
              data: [{ gid: 't_loop', name: 'Tarefa', completed: false }],
              next_page: { offset: 'cursor_repetido_loop' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Loop' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.metricsStatus, 'ERROR');
      assert.strictEqual(p.totalTasks, null);
      assert.ok(p.metricsError?.includes('Ciclo de paginação'));

      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, 502);
          assert.ok(err.message.includes('Ciclo de paginação'));
          return true;
        }
      );
    });

    // J. Múltiplos projetos: um com paginação bem-sucedida e outro com falha na 2ª página
    it('Cenário J: Múltiplos projetos com um paginado e outro quebrado — diferenciação em projetos e rejeição total em tasks', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([
        { id: 'int-p_ok', externalId: 'proj-pag-ok', projectName: 'Projeto Paginado OK' },
        { id: 'int-p_err', externalId: 'proj-pag-err', projectName: 'Projeto Paginado Quebrado' },
      ]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/proj-pag-ok/tasks?')) {
          if (urlStr.includes('offset=p2_ok')) {
            return new Response(
              JSON.stringify({
                data: [{ gid: 'tok_2', name: 'Tarefa OK 2', completed: false }],
                next_page: null,
              }),
              { status: 200 }
            );
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 'tok_1', name: 'Tarefa OK 1', completed: false }],
              next_page: { offset: 'p2_ok' },
            }),
            { status: 200 }
          );
        }

        if (urlStr.includes('/proj-pag-err/tasks?')) {
          if (urlStr.includes('offset=p2_err')) {
            return new Response(JSON.stringify({ errors: [{ message: 'Falha fatal na página 2' }] }), {
              status: 500,
            });
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 'terr_1', name: 'Tarefa Err 1', completed: false }],
              next_page: { offset: 'p2_err' },
            }),
            { status: 200 }
          );
        }

        return new Response(JSON.stringify({ data: { name: 'Projeto' } }), { status: 200 });
      };

      const projects = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(projects.length, 2);

      const projOk = projects.find((p) => p.projectGid === 'proj-pag-ok');
      const projErr = projects.find((p) => p.projectGid === 'proj-pag-err');

      assert.ok(projOk);
      assert.strictEqual(projOk.metricsStatus, 'LIVE');
      assert.strictEqual(projOk.totalTasks, 2);
      assert.ok(projOk.metricsUpdatedAt !== null);

      assert.ok(projErr);
      assert.strictEqual(projErr.metricsStatus, 'ERROR');
      assert.strictEqual(projErr.totalTasks, null);
      assert.strictEqual(projErr.metricsUpdatedAt, null);

      // getClientTasks deve rejeitar integralmente
      await assert.rejects(
        async () => {
          await asanaService.getClientTasks(testClientId, testOrgId);
        },
        (err: any) => {
          assert.ok(err instanceof AsanaIntegrationError);
          assert.strictEqual(err.statusCode, 500);
          assert.ok(err.message.includes('Projeto Paginado Quebrado'));
          return true;
        }
      );
    });

    // K. Confirmação de que LIVE nunca aparece para consulta incompleta
    it('Cenário K: Confirmação invariante de que LIVE nunca aparece se a leitura não for 100% íntegra', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-pincomp', externalId: 'proj-incomp', projectName: 'Projeto Incompleto' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          if (urlStr.includes('offset=cursor_final')) {
            return new Response(JSON.stringify({ errors: [{ message: 'Queda de conexão' }] }), { status: 503 });
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 't1', name: 'Tarefa 1', completed: false }],
              next_page: { offset: 'cursor_final' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Incompleto' } }), { status: 200 });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.notStrictEqual(p.metricsStatus, 'LIVE');
      assert.strictEqual(p.metricsStatus, 'ERROR');
      assert.strictEqual(p.totalTasks, null);
      assert.strictEqual(p.metricsUpdatedAt, null);
    });

    // L. Continuidade da sanitização de mensagens e ausência de exposição de credenciais em falha paginada
    it('Cenário L: Continuidade da sanitização — mensagens de erro na página 2 nunca vazam tokens', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-psec', externalId: 'proj-sec-p2', projectName: 'Projeto Segredo P2' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          if (urlStr.includes('offset=cursor_p2')) {
            return new Response(
              JSON.stringify({
                errors: [{ message: `Acesso negado na página 2 para Bearer ${sensitiveToken}` }],
              }),
              { status: 401 }
            );
          }
          return new Response(
            JSON.stringify({
              data: [{ gid: 't1', name: 'Tarefa 1', completed: false }],
              next_page: { offset: 'cursor_p2' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Segredo P2' } }), { status: 200 });
      };

      try {
        await asanaService.getClientTasks(testClientId, testOrgId);
        assert.fail('Deveria ter lançado erro');
      } catch (err: any) {
        assert.ok(err instanceof AsanaIntegrationError);
        const serialized = JSON.stringify({ message: err.message, details: err.details });
        assert.ok(
          !serialized.includes(sensitiveToken),
          'Token sensível jamais pode constar nos detalhes ou mensagens de erro paginadas'
        );
      }
    });

    // N. Compatibilidade dos consumidores de ClientAsanaProject e ClientAsanaTask em resposta paginada
    it('Cenário N: Compatibilidade de consumidores — estruturas de ClientAsanaProject e ClientAsanaTask consolidadas', async () => {
      setupActiveConnectionMock();
      setupClientWithProjectsMock([{ id: 'int-pcomp', externalId: 'proj-compat-pag', projectName: 'Projeto Paginado Compat' }]);

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tasks?')) {
          if (urlStr.includes('offset=cp2')) {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    gid: 'tk2',
                    name: 'Tarefa 2',
                    completed: true,
                    due_on: '2026-12-31',
                    assignee: { gid: 'u2', name: 'User 2', photo: { image_60x60: 'https://img.test/u2' } },
                    memberships: [{ section: { gid: 'sec2', name: 'Concluído' } }],
                    permalink_url: 'https://app.asana.com/0/proj-compat-pag/tk2',
                  },
                ],
                next_page: null,
              }),
              { status: 200 }
            );
          }
          return new Response(
            JSON.stringify({
              data: [
                {
                  gid: 'tk1',
                  name: 'Tarefa 1',
                  completed: false,
                  due_on: '2026-11-30',
                  assignee: { gid: 'u1', name: 'User 1', photo: { image_60x60: 'https://img.test/u1' } },
                  memberships: [{ section: { gid: 'sec1', name: 'Em Progresso' } }],
                  permalink_url: 'https://app.asana.com/0/proj-compat-pag/tk1',
                },
              ],
              next_page: { offset: 'cp2' },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: { name: 'Projeto Paginado Compat', color: 'green' } }), {
          status: 200,
        });
      };

      const [p] = await asanaService.getClientProjects(testClientId, testOrgId);
      assert.strictEqual(p.totalTasks, 2);
      assert.strictEqual(p.completedTasks, 1);
      assert.strictEqual(p.pendingTasks, 1);
      assert.strictEqual(p.metricsStatus, 'LIVE');

      const tasks = await asanaService.getClientTasks(testClientId, testOrgId);
      assert.strictEqual(tasks.length, 2);
      assert.strictEqual(tasks[0].gid, 'tk1');
      assert.strictEqual(tasks[0].sectionName, 'Em Progresso');
      assert.strictEqual(tasks[0].assignee?.name, 'User 1');
      assert.strictEqual(tasks[1].gid, 'tk2');
      assert.strictEqual(tasks[1].sectionName, 'Concluído');
    });
  });
});
