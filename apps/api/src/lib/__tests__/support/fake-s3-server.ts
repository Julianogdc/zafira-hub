import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * HM-2 (DEC-HML-003) - Emulador S3 minimo e local para testes (sem rede externa, sem servico real).
 * Entende o que o driver usa: HEAD, GET e PUT de objeto em estilo de caminho (/<bucket>/<chave>).
 * Responde como S3/R2: 404 NoSuchKey, 403 AccessDenied, ETag, cabecalhos x-amz-meta-*.
 * Exige cabecalho Authorization SigV4 e registra cada requisicao para as asserções (sem guardar o valor da assinatura).
 */
export interface RecordedRequest {
  method: string;
  path: string;
  hasSigV4: boolean;
  credentialScope: string | null;
  contentEncoding: string | null;
  checksumHeaders: string[];
  amzContentSha256: string | null;
  bodyBytes: number;
}

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  objects: Map<string, { body: Buffer; meta: Record<string, string> }>;
  requests: RecordedRequest[];
  /** Falha todas as chamadas com 403 AccessDenied. */
  denyAll: boolean;
  /** Corrompe os bytes guardados de uma chave (simula adulteracao no provedor). */
  tamper(key: string): void;
  count(method: string): number;
  close(): Promise<void>;
}

export async function startFakeS3(bucket = 'zafira-test-bucket'): Promise<FakeS3> {
  const objects = new Map<string, { body: Buffer; meta: Record<string, string> }>();
  const requests: RecordedRequest[] = [];
  const state = { denyAll: false };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const auth = String(req.headers.authorization ?? '');
      const scope = /Credential=[^/]+\/(\d{8}\/[^/]+\/s3\/aws4_request)/.exec(auth)?.[1] ?? null;
      requests.push({
        method: req.method ?? '',
        path: url.pathname,
        hasSigV4: auth.startsWith('AWS4-HMAC-SHA256 '),
        credentialScope: scope,
        contentEncoding: (req.headers['content-encoding'] as string | undefined) ?? null,
        checksumHeaders: Object.keys(req.headers).filter((h) => h.startsWith('x-amz-checksum-') || h === 'x-amz-sdk-checksum-algorithm' || h === 'x-amz-trailer'),
        amzContentSha256: (req.headers['x-amz-content-sha256'] as string | undefined) ?? null,
        bodyBytes: body.length,
      });

      const xml = (status: number, code: string, message: string) => {
        res.writeHead(status, { 'content-type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`);
      };
      if (!auth.startsWith('AWS4-HMAC-SHA256 ')) return xml(403, 'AccessDenied', 'Missing authorization');
      if (state.denyAll) return xml(403, 'AccessDenied', 'Access Denied');

      const prefix = `/${bucket}/`;
      if (!url.pathname.startsWith(prefix)) return xml(404, 'NoSuchBucket', 'The specified bucket does not exist');
      const key = decodeURIComponent(url.pathname.slice(prefix.length));

      if (req.method === 'PUT') {
        const meta: Record<string, string> = {};
        for (const [h, v] of Object.entries(req.headers)) if (h.startsWith('x-amz-meta-')) meta[h.slice('x-amz-meta-'.length)] = String(v);
        objects.set(key, { body, meta });
        res.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
        return res.end();
      }
      const obj = objects.get(key);
      if (req.method === 'HEAD') {
        if (!obj) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'content-length': String(obj.body.length), etag: `"${createHash('md5').update(obj.body).digest('hex')}"` });
        return res.end();
      }
      if (req.method === 'GET') {
        if (!obj) return xml(404, 'NoSuchKey', 'The specified key does not exist.');
        const headers: Record<string, string> = { 'content-length': String(obj.body.length), 'content-type': 'application/octet-stream' };
        for (const [k, v] of Object.entries(obj.meta)) headers[`x-amz-meta-${k}`] = v;
        res.writeHead(200, headers);
        return res.end(obj.body);
      }
      return xml(405, 'MethodNotAllowed', 'Not allowed');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    objects,
    requests,
    get denyAll() {
      return state.denyAll;
    },
    set denyAll(v: boolean) {
      state.denyAll = v;
    },
    tamper(key: string) {
      const o = objects.get(key);
      if (o) o.body = Buffer.concat([o.body, Buffer.from('x')]);
    },
    count(method: string) {
      return requests.filter((r) => r.method === method).length;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
