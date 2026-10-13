import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname_test = dirname(__filename);
// tests ficam em src/lib/__tests__/ — subir dois niveis ate src/
const SRC_DIR = resolve(__dirname_test, '../..');
const ROUTES_DIR = resolve(SRC_DIR, 'modules');

/**
 * Percorre todos os arquivos *.routes.ts e falha se encontrar requireRole(
 * Objetivo: impedir que requireRole volte a aparecer silenciosamente em arquivos de rotas.
 */
function findRoutesFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findRoutesFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.routes.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// --- Teste Estatico Anti-requireRole ---
test('ESTATICO: Nenhum arquivo *.routes.ts deve conter requireRole(', () => {
  const routeFiles = findRoutesFiles(ROUTES_DIR);
  assert.ok(routeFiles.length > 0, 'Deve existir pelo menos um arquivo .routes.ts para inspecionar');

  const violations: string[] = [];
  for (const file of routeFiles) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('requireRole(') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        violations.push(`${file}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  if (violations.length > 0) {
    assert.fail(
      `requireRole() encontrado em arquivo(s) de rota. ` +
      `Isso viola a politica deny-by-default. Violations:\n${violations.join('\n')}`
    );
  }
});

// --- Testes API Key ---
test('API KEY: nao deve conter role ADMIN na interface AuthApiKeyContext', () => {
  const authFile = resolve(SRC_DIR, 'middleware/auth.ts');
  const content = readFileSync(authFile, 'utf-8');
  // role: 'ADMIN' nao deve existir na interface de api_key (apenas em AuthUserContext.memberships)
  const apiKeyBlock = content.match(/export interface AuthApiKeyContext[\s\S]*?\}/);
  assert.ok(apiKeyBlock, 'AuthApiKeyContext deve estar definida em auth.ts');
  // Filtrar linhas de comentario antes de verificar
  const blockLines = apiKeyBlock![0].split('\n').filter(l => !l.trim().startsWith('/') && !l.trim().startsWith('*'));
  const blockNoComments = blockLines.join('\n');
  assert.ok(!blockNoComments.includes("role: 'ADMIN'"),
    'AuthApiKeyContext NAO deve possuir role: ADMIN — credencial de maquina nao representa administrador humano');
});

test('API KEY: requirePermission deve conter logica de bloqueio para api_key', () => {
  const authFile = resolve(SRC_DIR, 'middleware/auth.ts');
  const content = readFileSync(authFile, 'utf-8');
  assert.ok(
    content.includes('MACHINE_CREDENTIAL_NOT_ALLOWED'),
    'requirePermission deve negar API key com MACHINE_CREDENTIAL_NOT_ALLOWED'
  );
});

test('API KEY: requireRole deve conter logica de bloqueio para api_key', () => {
  const authFile = resolve(SRC_DIR, 'middleware/auth.ts');
  const content = readFileSync(authFile, 'utf-8');
  // Deve ter 2 ocorrencias de MACHINE_CREDENTIAL_NOT_ALLOWED (uma em requireRole, outra em requirePermission)
  const count = (content.match(/MACHINE_CREDENTIAL_NOT_ALLOWED/g) || []).length;
  assert.ok(count >= 2, `MACHINE_CREDENTIAL_NOT_ALLOWED deve aparecer ao menos 2 vezes em auth.ts (encontrado: ${count})`);
});

test('API KEY: requirePermission nao deve conter full privileges sem allowlist', () => {
  const authFile = resolve(SRC_DIR, 'middleware/auth.ts');
  const content = readFileSync(authFile, 'utf-8');
  assert.ok(!content.includes('full privileges'),
    'auth.ts NAO deve conter o padrao "full privileges" — API key sem allowlist nao pode ter acesso total');
});

// --- Testes Financial ---
test('FINANCIAL: todas as 52 rotas devem usar requirePermission', () => {
  const financialFile = resolve(SRC_DIR, 'modules/financial/financial.routes.ts');
  const content = readFileSync(financialFile, 'utf-8');
  const routeCount = (content.match(/app\.(get|post|patch|put|delete)\(/g) || []).length;
  const permCount = (content.match(/requirePermission\(/g) || []).length;
  const roleCount = (content.match(/requireRole\(/g) || []).length;

  assert.strictEqual(roleCount, 0, `requireRole deve ser 0 em financial.routes.ts (encontrado: ${roleCount})`);
  assert.strictEqual(routeCount, permCount,
    `Todas as ${routeCount} rotas devem ter requirePermission. Encontrado: ${permCount}`);
});

test('FINANCIAL: financial.view_summary deve existir para overview', () => {
    const content = readFileSync(resolve(SRC_DIR, 'modules/financial/financial.routes.ts'), 'utf-8');
  assert.ok(content.includes("requirePermission('financial.view_summary')"),
    "financial.view_summary deve estar presente");
});

test('FINANCIAL: financial.view_details deve existir para transactions/categories', () => {
    const content = readFileSync(resolve(SRC_DIR, 'modules/financial/financial.routes.ts'), 'utf-8');
  assert.ok(content.includes("requirePermission('financial.view_details')"),
    "financial.view_details deve estar presente");
});

test('FINANCIAL: financial.edit deve existir para criacao/edicao', () => {
    const content = readFileSync(resolve(SRC_DIR, 'modules/financial/financial.routes.ts'), 'utf-8');
  assert.ok(content.includes("requirePermission('financial.edit')"),
    "financial.edit deve estar presente");
});

test('FINANCIAL: financial.reconcile deve existir para confirmacao de transferencia', () => {
    const content = readFileSync(resolve(SRC_DIR, 'modules/financial/financial.routes.ts'), 'utf-8');
  assert.ok(content.includes("requirePermission('financial.reconcile')"),
    "financial.reconcile deve estar presente para /transfers/:id/confirm");
});

test('FINANCIAL: integrations.sync deve existir para sincronizacoes', () => {
    const content = readFileSync(resolve(SRC_DIR, 'modules/financial/financial.routes.ts'), 'utf-8');
  assert.ok(content.includes("requirePermission('integrations.sync')"),
    "integrations.sync deve estar presente para rotas de sync");
});

test('FINANCIAL: resolveFinancialContext nao deve conter gate ADMIN/MANAGER', () => {
    const content = readFileSync(resolve(SRC_DIR, 'modules/financial/financial.routes.ts'), 'utf-8');
  // O bloco if(!['ADMIN','MANAGER'].includes(...)) nao deve mais existir no resolveFinancialContext
  const resolveBlock = content.match(/const resolveFinancialContext[\s\S]*?app\.addHook\('preHandler', resolveFinancialContext\)/);
  assert.ok(resolveBlock, 'resolveFinancialContext deve existir no arquivo');
  assert.ok(
    !resolveBlock![0].includes("'ADMIN', 'MANAGER'") ||
    !resolveBlock![0].includes("!['ADMIN', 'MANAGER'].includes"),
    'resolveFinancialContext NAO deve conter gate de role ADMIN/MANAGER'
  );
});

// --- Testes Dinamicos HTTP / Hardening (ETAPA L) ---
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwtPlugin from '@fastify/jwt';
import { authenticate, requirePermission, requireRole } from '../../middleware/auth.js';

test('DINAMICO / HARDENING: 1. Rota HUMAN sem auth => 401', async () => {
  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwtPlugin, { secret: 'test_jwt_secret_32bytes_long' });

  app.get('/test/protected', {
    preHandler: [authenticate, requirePermission('financial.view_summary')]
  }, async () => ({ ok: true }));

  await app.ready();

  const res = await app.inject({
    method: 'GET',
    url: '/test/protected'
  });

  assert.strictEqual(res.statusCode, 401);
  await app.close();
});

test('DINAMICO / HARDENING: 2. Rota HUMAN com API key valida => 403 MACHINE_CREDENTIAL_NOT_ALLOWED', async () => {
  const originalKey = process.env.HUB_INTERNAL_API_KEY;
  process.env.HUB_INTERNAL_API_KEY = 'valid_secret_key_123';

  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwtPlugin, { secret: 'test_jwt_secret_32bytes_long' });

  app.get('/test/human-only', {
    preHandler: [authenticate, requirePermission('financial.view_summary')]
  }, async () => ({ ok: true }));

  await app.ready();

  const res = await app.inject({
    method: 'GET',
    url: '/test/human-only',
    headers: {
      'x-api-key': 'valid_secret_key_123'
    }
  });

  assert.strictEqual(res.statusCode, 403);
  const body = res.json();
  assert.strictEqual(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');

  process.env.HUB_INTERNAL_API_KEY = originalKey;
  await app.close();
});

test('DINAMICO / HARDENING: 3. Rota HUMAN com authContext de usuário + Permission => alcanca handler (200)', async () => {
  const _gp = globalThis as any;
  const originalMember = _gp.prisma?.organizationMember;
  const originalRolePermission = _gp.prisma?.rolePermission;

  if (_gp.prisma) {
    _gp.prisma.organizationMember = {
      findUnique: async () => ({
        id: 'mem_1',
        organizationId: 'org_1',
        userId: 'usr_1',
        role: 'ADMIN',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        permissions: [],
      }),
    };
    _gp.prisma.rolePermission = {
      findUnique: async () => ({
        role: 'ADMIN',
        permissionCode: 'financial.view_summary',
      }),
    };
  }

  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwtPlugin, { secret: 'test_jwt_secret_32bytes_long' });

  // Simular middleware com contexto autenticado e permissao concedida
  app.get('/test/allowed', {
    preHandler: [
      async (req) => {
        req.authContext = {
          type: 'user',
          userId: 'usr_1',
          email: 'admin@zafira.com',
          activeOrganizationId: 'org_1',
          memberships: [{ organizationId: 'org_1', organizationSlug: 'zafira', role: 'ADMIN' }]
        };
      },
      requirePermission('financial.view_summary')
    ]
  }, async () => ({ data: 'success_payload' }));

  await app.ready();

  const res = await app.inject({
    method: 'GET',
    url: '/test/allowed'
  });

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.json(), { data: 'success_payload' });

  if (_gp.prisma) {
    if (originalMember) _gp.prisma.organizationMember = originalMember;
    if (originalRolePermission) _gp.prisma.rolePermission = originalRolePermission;
  }
  await app.close();
});

test('DINAMICO / HARDENING: 4. JWT pertence a Org A e Client pertence a Org B => acesso negado (404/403)', async () => {
  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwtPlugin, { secret: 'test_jwt_secret_32bytes_long' });

  // Simula endpoint tenant-isolated
  app.get('/test/clients/:clientId/data', {
    preHandler: [
      async (req) => {
        req.authContext = {
          type: 'user',
          userId: 'usr_org_a',
          email: 'user@orga.com',
          memberships: [{ organizationId: 'org_A', organizationSlug: 'org-a', role: 'ADMIN' }]
        };
      }
    ]
  }, async (req, reply) => {
    const activeOrgId = req.authContext?.type === 'user' ? req.authContext.memberships[0].organizationId : null;
    const clientDb = { id: 'cli_1', organizationId: 'org_B' }; // Pertence a Org B
    if (clientDb.organizationId !== activeOrgId) {
      return reply.status(404).send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente não encontrado nesta organização' });
    }
    return { client: clientDb };
  });

  await app.ready();

  const res = await app.inject({
    method: 'GET',
    url: '/test/clients/cli_1/data'
  });

  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.json().error, 'CLIENT_NOT_FOUND');
  await app.close();
});

test('DINAMICO / HARDENING: 5. API key nao se transforma em ADMIN em requireRole', async () => {
  const originalKey = process.env.HUB_INTERNAL_API_KEY;
  process.env.HUB_INTERNAL_API_KEY = 'valid_secret_key_123';

  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwtPlugin, { secret: 'test_jwt_secret_32bytes_long' });

  app.get('/test/role-protected', {
    preHandler: [authenticate, requireRole(['ADMIN'])]
  }, async () => ({ ok: true }));

  await app.ready();

  const res = await app.inject({
    method: 'GET',
    url: '/test/role-protected',
    headers: {
      'x-api-key': 'valid_secret_key_123'
    }
  });

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.json().code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');

  process.env.HUB_INTERNAL_API_KEY = originalKey;
  await app.close();
});
