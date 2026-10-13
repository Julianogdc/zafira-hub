// ==============================================================================
// Simulador do n8n (F7-4a, DEC-F7-016). NENHUM n8n real, nenhuma conta, nenhum dado real.
//  - importavel: createN8nMock({ secret }) devolve um `fetch` em memoria (o Hub envia pedidos para ele);
//  - executavel: `node n8n-mock.mjs` sobe um servidor HTTP local (PORT, padrao 8092) que registra pedidos.
// Verifica a assinatura HMAC dos pedidos recebidos, registra tudo (sem segredo) e permite
// roteirizar respostas (200/202/429/5xx/4xx/rede/lento) e gerar callbacks validos, forjados, repetidos ou tardios.
// ==============================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const sign = (secret, ts, body) => createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

export function createN8nMock({ secret }) {
  const state = {
    /** respostas consumidas, uma por requisicao: numero HTTP, 'network' (erro de rede) ou 'redirect' */
    script: [],
    defaultStatus: 200,
    /** pedidos recebidos: { url, headers, body, signatureValid } */
    requests: [],
  };

  const verify = (headers, body) => {
    const ts = Number(headers['x-zafira-timestamp']);
    const given = String(headers['x-zafira-signature'] ?? '').replace(/^sha256=/, '');
    const expected = sign(secret, ts, body);
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const handle = async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init.body === 'string' ? init.body : '';
    state.requests.push({
      url: String(url),
      method: init.method ?? 'GET',
      redirect: init.redirect,
      headers,
      body,
      signatureValid: verify(headers, body),
    });
    const next = state.script.length > 0 ? state.script.shift() : state.defaultStatus;
    if (next === 'network') throw new TypeError('fetch failed');
    if (next === 'redirect') return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } });
    return new Response(JSON.stringify({ accepted: next < 300 }), { status: next, headers: { 'Content-Type': 'application/json' } });
  };

  /** Corpo + cabecalhos de um callback do fluxo para o Hub (assinado com o segredo da organizacao). */
  const callback = (payload, opts = {}) => {
    const body = JSON.stringify(payload);
    const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-zafira-timestamp': String(ts),
        'x-zafira-signature': `sha256=${sign(opts.secret ?? secret, ts, body)}`,
      },
    };
  };

  return { fetch: handle, state, callback };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 8092;
  const secret = process.env.N8N_MOCK_SECRET || '';
  if (secret.length < 32) {
    console.error('[n8n-mock] defina N8N_MOCK_SECRET (>= 32 caracteres) para verificar assinaturas');
    process.exit(1);
  }
  const mock = createN8nMock({ secret });
  createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = `http://${req.headers.host}${req.url}`;
      if (req.method === 'GET' && req.url === '/__requests') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify(
            mock.state.requests.map((r) => {
              let payload = null;
              try {
                payload = JSON.parse(r.body);
              } catch {
                /* corpo invalido */
              }
              return {
                url: r.url,
                method: r.method,
                signatureValid: r.signatureValid,
                event: r.headers['x-zafira-event'] ?? null,
                idempotencyKey: r.headers['x-zafira-idempotency-key'] ?? null,
                payload,
                hasSecretLikeHeader: Object.keys(r.headers).some((k) => ['authorization', 'x-api-key', 'cookie'].includes(k)),
              };
            })
          )
        );
      }
      if (req.method === 'POST' && req.url === '/__control') {
        // roteiro de respostas para os proximos pedidos: { script: [200|'network'|503...], defaultStatus, reset }
        try {
          const c = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (c.reset) mock.state.requests.length = 0;
          if (Array.isArray(c.script)) mock.state.script = c.script;
          if (typeof c.defaultStatus === 'number') mock.state.defaultStatus = c.defaultStatus;
        } catch {
          /* ignora */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      try {
        const r = await mock.fetch(url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(await r.text());
      } catch {
        req.socket.destroy();
      }
    });
  }).listen(port, '0.0.0.0', () => console.log(`[n8n-mock] ouvindo em ${port}`));
}
