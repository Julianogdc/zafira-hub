/**
 * HM-1 / H3 (P18, DEC-HML-001) - Guarda unica dos testes de integracao e dos scripts de preparacao de CI.
 * Substitui as verificacoes por trecho de texto (`includes('/zafira_hub_ci')`) copiadas em cada arquivo.
 *
 * Um banco so e aceito para operacoes de teste (inclusive destrutivas) quando TODAS as condicoes valem:
 *  1. NODE_ENV diferente de "production";
 *  2. ZAFIRA_TEST_DATABASE exatamente "1";
 *  3. DATABASE_URL valida, protocolo postgres/postgresql;
 *  4. nome do banco EXATAMENTE "zafira_hub_ci" (nao aceita sufixos, prefixos nem parametros enganosos);
 *  5. host local ou da lista explicita de hosts de teste (padrao: localhost, 127.0.0.1, ::1);
 *  6. (verificacao assincrona, antes de qualquer limpeza) toda organizacao existente tem slug "ci-*".
 * Nenhuma mensagem imprime senha ou a URL completa.
 */

export const TEST_DATABASE_NAME = 'zafira_hub_ci';
const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestDatabaseGuardError';
  }
}

export interface TestDatabaseTarget {
  host: string;
  port: string;
  database: string;
}

export function parseDatabaseTarget(rawUrl: string | undefined): TestDatabaseTarget | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') return null;
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  return { host: u.hostname.toLowerCase(), port: u.port || '5432', database };
}

/** Lanca TestDatabaseGuardError se o ambiente nao for um banco de testes dedicado. Retorna o alvo validado. */
export function assertTestDatabase(env: NodeJS.ProcessEnv = process.env): TestDatabaseTarget {
  if (env.NODE_ENV === 'production') {
    throw new TestDatabaseGuardError('NÃO É PERMITIDO EXECUTAR TESTES DE INTEGRAÇÃO EM PRODUÇÃO (NODE_ENV=production).');
  }
  if (env.ZAFIRA_TEST_DATABASE !== '1') {
    throw new TestDatabaseGuardError('ZAFIRA_TEST_DATABASE=1 obrigatório para testes de integração.');
  }
  const target = parseDatabaseTarget(env.DATABASE_URL);
  if (!target) {
    throw new TestDatabaseGuardError('DATABASE_URL ausente ou inválida (esperado postgresql://…).');
  }
  if (target.database !== TEST_DATABASE_NAME) {
    throw new TestDatabaseGuardError(`O banco alvo deve se chamar exatamente "${TEST_DATABASE_NAME}" (encontrado "${target.database}"). URL rejeitada.`);
  }
  const extra = (env.ZAFIRA_TEST_DB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_HOSTS, ...extra]);
  if (!allowed.has(target.host)) {
    throw new TestDatabaseGuardError(`Host "${target.host}" não está na lista de hosts de teste (localhost, 127.0.0.1, ::1 ou ZAFIRA_TEST_DB_ALLOWED_HOSTS). URL rejeitada.`);
  }
  return target;
}

interface OrgReader {
  organization: { findMany(args: { select: { slug: true } }): Promise<{ slug: string }[]> };
}

/**
 * Verificacao de conteudo, obrigatoria antes de qualquer limpeza destrutiva: o banco so contem organizacoes de CI.
 * Protege contra um banco "zafira_hub_ci" que, por engano, tenha recebido dados reais.
 */
export async function assertDisposableTestData(db: OrgReader): Promise<void> {
  const orgs = await db.organization.findMany({ select: { slug: true } });
  const foreign = orgs.filter((o) => !o.slug.startsWith('ci-'));
  if (foreign.length > 0) {
    throw new TestDatabaseGuardError(
      `O banco de teste contém ${foreign.length} organização(ões) fora do padrão "ci-*"; limpeza destrutiva recusada.`
    );
  }
}
