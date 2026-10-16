// H4-B.1: deliberately narrower than staging. No remotely configurable host allowlist.
// Pattern reused from lib/test-database-guard.ts: explicit opt-in + parsed exact target.
export const DATABASE_NAME = 'zafira_hub_navigable_ci';
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DISABLED_FLAGS = [
  'PUBLICATION_DISPATCH_ENABLED', 'PUBLICATION_METRICS_ENABLED',
  'N8N_DISPATCH_ENABLED', 'GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED', 'ASANA_MIRROR_SCHEDULE_ENABLED',
];

export class SyntheticSeedError extends Error {
  constructor(code) {
    super(`Synthetic seed refused (${code}).`);
    this.name = 'SyntheticSeedError';
    this.code = code;
  }
}

export function refuse(code) { throw new SyntheticSeedError(code); }

export function assertSafeDatabaseTarget(env) {
  if (env.HML_SYNTHETIC_SEED_ENABLED !== '1') refuse('OPT_IN_REQUIRED');
  if (env.NODE_ENV !== 'test' || env.HML_SEED_TARGET !== 'local-disposable') refuse('ENVIRONMENT');
  if (DISABLED_FLAGS.some((key) => env[key] !== undefined && env[key] !== 'false')) refuse('EXTERNAL_ACTIVITY');
  if (env.DIRECT_URL || env.SHADOW_DATABASE_URL) refuse('ALTERNATE_DATABASE');
  if (typeof env.DATABASE_URL !== 'string' || /[\s?#]/.test(env.DATABASE_URL)) refuse('DATABASE_URL');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { refuse('DATABASE_URL'); }
  // Forbid query-based routing (host, options, schema, pgBouncer overrides etc.).
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || url.search) refuse('DATABASE_URL');
  if (url.pathname !== `/${DATABASE_NAME}`) refuse('DATABASE_NAME');
  if (!HOSTS.has(url.hostname) || !/^[a-z_][a-z0-9_]*$/.test(url.username) || !url.password) refuse('DESTINATION');
  // Explicit confirmation of the full non-secret endpoint, including port and DB user.
  const port = url.port || '5432';
  const endpoint = `${url.hostname}:${port}/${DATABASE_NAME}`;
  if (env.HML_SEED_ALLOWED_TARGET !== endpoint || env.HML_SEED_DATABASE_USER !== url.username) refuse('TARGET_CONFIRMATION');
  return Object.freeze({ database: DATABASE_NAME, user: url.username });
}

// Same connection/transaction as the writes: never rely only on what the URL claims.
export async function assertConnectedDatabase(tx, target) {
  const rows = await tx.$queryRaw`SELECT current_database() AS database, current_user AS username, current_schema() AS schema`;
  if (rows.length !== 1 || rows[0].database !== target.database || rows[0].username !== target.user || rows[0].schema !== 'public') {
    refuse('DATABASE_IDENTITY');
  }
}
