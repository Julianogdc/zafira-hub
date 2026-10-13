import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * F7-4a - Configuracao e primitivas de seguranca das automacoes n8n (DEC-F7-016).
 *  - despachante DESLIGADO por padrao (N8N_DISPATCH_ENABLED=true para ligar);
 *  - destinos somente em hosts permitidos (N8N_ALLOWED_HOSTS), https (http so em ensaio, explicitamente);
 *  - assinatura HMAC-SHA256 por organizacao sobre "timestamp.corpo".
 */

export const dispatcherEnabled = (env: NodeJS.ProcessEnv = process.env) => env.N8N_DISPATCH_ENABLED === 'true';

export const dispatchIntervalSeconds = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.N8N_DISPATCH_INTERVAL_SECONDS);
  return Number.isFinite(n) && n >= 15 && n <= 3600 ? Math.floor(n) : 60;
};

export const allowedHosts = (env: NodeJS.ProcessEnv = process.env): string[] =>
  (env.N8N_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

/** Impede SSRF: so hosts da lista; sem credenciais na URL; sem fragmento; https (http so com N8N_ALLOW_INSECURE_HTTP=true). */
export function checkWebhookUrl(raw: string, env: NodeJS.ProcessEnv = process.env): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'URL invalida.' };
  }
  const hosts = allowedHosts(env);
  if (hosts.length === 0) return { ok: false, message: 'Nenhum host do n8n esta permitido neste ambiente.' };
  if (url.username || url.password) return { ok: false, message: 'A URL nao pode conter credenciais.' };
  if (url.hash) return { ok: false, message: 'A URL nao pode conter fragmento.' };
  const insecureOk = env.N8N_ALLOW_INSECURE_HTTP === 'true';
  if (url.protocol !== 'https:' && !(insecureOk && url.protocol === 'http:')) {
    return { ok: false, message: 'Somente URLs https sao permitidas.' };
  }
  if (!hosts.includes(url.hostname.toLowerCase()) && !hosts.includes(url.host.toLowerCase())) {
    return { ok: false, message: 'O host da URL nao esta na lista de hosts permitidos.' };
  }
  return { ok: true, url };
}

export function signBody(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

/** Comparacao em tempo constante; aceita "sha256=<hex>" ou "<hex>". */
export function verifySignature(secret: string, timestampSeconds: number, body: string, header: string | undefined): boolean {
  if (!header) return false;
  const given = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = signBody(secret, timestampSeconds, body);
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Impressao curta do segredo para exibicao (nunca o segredo). */
export const secretFingerprint = (secret: string) => createHash('sha256').update(secret).digest('hex').slice(0, 8);
