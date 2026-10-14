import test from 'node:test';
import assert from 'node:assert/strict';
import { TestDatabaseGuardError, assertDisposableTestData, assertTestDatabase, parseDatabaseTarget } from '../test-database-guard.js';

// HM-1 / H3 (P18): protecao contra operacoes destrutivas em bancos reais, compartilhados ou de producao.

const ok = {
  NODE_ENV: 'test',
  ZAFIRA_TEST_DATABASE: '1',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/zafira_hub_ci?schema=public',
} as NodeJS.ProcessEnv;

const rejects = (env: Partial<NodeJS.ProcessEnv>, re: RegExp) =>
  assert.throws(() => assertTestDatabase({ ...ok, ...env } as NodeJS.ProcessEnv), (e: unknown) => e instanceof TestDatabaseGuardError && re.test(e.message));

test('aceita o banco de testes dedicado em host local', () => {
  assert.deepEqual(assertTestDatabase(ok), { host: 'localhost', port: '5432', database: 'zafira_hub_ci' });
  assert.equal(assertTestDatabase({ ...ok, DATABASE_URL: 'postgres://u:p@127.0.0.1/zafira_hub_ci' }).host, '127.0.0.1');
});

test('recusa producao, ausencia da marca de teste e URL invalida', () => {
  rejects({ NODE_ENV: 'production' }, /PRODUÇÃO/);
  rejects({ ZAFIRA_TEST_DATABASE: undefined }, /ZAFIRA_TEST_DATABASE=1/);
  rejects({ ZAFIRA_TEST_DATABASE: 'true' }, /ZAFIRA_TEST_DATABASE=1/);
  rejects({ DATABASE_URL: undefined }, /ausente ou inválida/);
  rejects({ DATABASE_URL: 'nao-e-url' }, /ausente ou inválida/);
  rejects({ DATABASE_URL: 'mysql://u:p@localhost/zafira_hub_ci' }, /ausente ou inválida/);
});

test('o nome do banco e exato: sufixos, prefixos e truques de URL sao recusados', () => {
  for (const name of ['zafira_hub_ci_prod', 'zafira_hub_cinema', 'prod_zafira_hub_ci', 'zafira_hub_v2', 'zafira_hub_21_staging', 'postgres']) {
    rejects({ DATABASE_URL: `postgresql://u:p@localhost:5432/${name}` }, /exatamente/);
  }
  // nome certo so no parametro, nao no caminho
  rejects({ DATABASE_URL: 'postgresql://u:p@localhost:5432/zafira_hub_v2?x=/zafira_hub_ci' }, /exatamente/);
  rejects({ DATABASE_URL: 'postgresql://u:p@localhost:5432/' }, /exatamente/);
});

test('host remoto ou compartilhado e recusado; lista explicita permite servico de CI', () => {
  rejects({ DATABASE_URL: 'postgresql://u:p@db.interno.exemplo:5432/zafira_hub_ci' }, /lista de hosts/);
  rejects({ DATABASE_URL: 'postgresql://u:p@10.0.0.5:5432/zafira_hub_ci' }, /lista de hosts/);
  const allowed = { ...ok, DATABASE_URL: 'postgresql://u:p@postgres-ci:5432/zafira_hub_ci', ZAFIRA_TEST_DB_ALLOWED_HOSTS: 'postgres-ci, outro' } as NodeJS.ProcessEnv;
  assert.equal(assertTestDatabase(allowed).host, 'postgres-ci');
});

test('a mensagem de erro nunca contem a senha nem a URL completa', () => {
  try {
    assertTestDatabase({ ...ok, DATABASE_URL: 'postgresql://usuario:segredo123@db.exemplo:5432/zafira_hub_v2' } as NodeJS.ProcessEnv);
    assert.fail('deveria recusar');
  } catch (e) {
    const msg = (e as Error).message;
    assert.doesNotMatch(msg, /segredo123|usuario|postgresql:\/\//);
  }
  assert.equal(parseDatabaseTarget('postgresql://u:p@h:1/d')?.port, '1');
});

test('verificacao de conteudo: so organizacoes ci-* permitem limpeza destrutiva', async () => {
  const reader = (slugs: string[]) => ({ organization: { findMany: async () => slugs.map((slug) => ({ slug })) } });
  await assert.doesNotReject(assertDisposableTestData(reader(['ci-org-a', 'ci-org-b', 'ci-pub-a-1234'])));
  await assert.doesNotReject(assertDisposableTestData(reader([])));
  await assert.rejects(assertDisposableTestData(reader(['ci-org-a', 'cliente-real'])), /fora do padrão/);
});
