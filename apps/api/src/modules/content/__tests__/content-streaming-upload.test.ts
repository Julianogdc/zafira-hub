import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import fastify from 'fastify';
import multipart from '@fastify/multipart';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { MemoryProbe, logMemoryReport } from '../../../lib/__tests__/support/memory-probe.js';
import { spoolMultipartUpload } from '../upload-spooler.js';
import { ContentError } from '../content.service.js';
import { LocalFileStorage, S3FileStorage } from '../file-storage.js';

/**
 * HM-3 (ajuste complementar) - upload/download em streaming: limites, interrupcao, limpeza e MEDICAO de memoria.
 * A medicao usa MemoryProbe (ver metodo e limitacoes no cabecalho de memory-probe.ts): heapUsed, external, arrayBuffers,
 * rss e pico sao registrados SEPARADAMENTE em linhas `[HM-3 MEMORIA]`. Os comparativos "legado" (buffer integral) sao
 * reproducoes sinteticas medidas aqui com a mesma sonda - nao sao numeros da implementacao anterior em producao.
 */

const MIB = 1024 * 1024;
const CHUNK = 64 * 1024;
const PAYLOAD_BYTES = 50 * MIB;
const MAX_UPLOAD = 100 * MIB;

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zafira-hm3-up-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const tmpResidues = async (dir: string) => (await readdir(dir)).filter((n) => n.endsWith('.tmp'));

const fakePart = (file: Readable, extra: Record<string, unknown> = {}): any => ({
  file,
  filename: 'video.mp4',
  mimetype: 'video/mp4',
  truncated: false,
  ...extra,
});

/** Fonte sintetica sem retencao: reaproveita o mesmo bloco, calcula o hash e amostra a memoria a cada bloco. */
function syntheticSource(chunks: number, hash?: ReturnType<typeof createHash>, probe?: MemoryProbe): Readable {
  const block = Buffer.alloc(CHUNK, 0x5a);
  block.write('\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41', 0, 'binary');
  let sent = 0;
  return new Readable({
    read() {
      probe?.sample();
      if (sent < chunks) {
        sent++;
        hash?.update(block);
        this.push(block);
      } else {
        this.push(null);
      }
    },
  });
}

/** Cria um arquivo em disco por streaming (sem buffer integral) e devolve caminho e SHA-256. */
async function makeFile(dir: string, bytes: number): Promise<{ file: string; sha256: string }> {
  const file = path.join(dir, `fonte-${randomUUID()}.bin`);
  const hash = createHash('sha256');
  const out = createWriteStream(file);
  for await (const chunk of syntheticSource(bytes / CHUNK, hash)) {
    if (!out.write(chunk)) await once(out, 'drain');
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  return { file, sha256: hash.digest('hex') };
}

test('Upload streaming (HM-3) — 25 MiB: tamanho e SHA-256 exatos, memoria separada por metrica, temp removido', async () => {
  await withTempDir(async (tempDir) => {
    const chunks = 400; // 400 x 64 KiB = 25 MiB
    const total = chunks * CHUNK;
    const hash = createHash('sha256');
    const probe = new MemoryProbe('upload-spooler-25MiB', total).start();
    const spooled = await spoolMultipartUpload(fakePart(syntheticSource(chunks, hash, probe)), MAX_UPLOAD, { tempDir });
    const report = probe.stop();
    logMemoryReport(report);

    try {
      assert.equal(spooled.sizeBytes, total);
      assert.equal(spooled.sha256, hash.digest('hex'));
      assert.equal(spooled.filename, 'video.mp4');
      assert.equal(spooled.headerBuffer.length, CHUNK, 'cabecalho capturado limitado a 64 KiB');
      assert.equal((await stat(spooled.tempFilePath)).size, total);
      // o pico (heapUsed+external) deve ficar muito abaixo do arquivo: um buffer integral custaria >= 25 MiB
      assert.ok(
        report.raw.deltaPeakHeapPlusExternal < total * 0.5,
        `pico heap+external (${report.deltaPeakHeapPlusExternalMiB} MiB) deve ser menor que metade do arquivo (25 MiB)`
      );
    } finally {
      await spooled.cleanup();
    }
    await assert.rejects(() => stat(spooled.tempFilePath), (e: any) => e.code === 'ENOENT');
    assert.deepEqual(await tmpResidues(tempDir), []);
  });
});

test('Upload streaming (HM-3) — interrupcao no meio (erro do cliente) rejeita e nao deixa temp', async () => {
  await withTempDir(async (tempDir) => {
    let emitted = 0;
    const interrupted = new Readable({
      read() {
        if (emitted < 5) {
          emitted++;
          this.push(Buffer.alloc(CHUNK, 0x42));
        } else {
          this.destroy(new Error('ECONNRESET: Conexão interrompida pelo cliente'));
        }
      },
    });
    await assert.rejects(() => spoolMultipartUpload(fakePart(interrupted), MAX_UPLOAD, { tempDir }), /ECONNRESET/);
    assert.deepEqual(await tmpResidues(tempDir), []);
  });
});

test('Upload streaming (HM-3) — close SEM end nem error vira UPLOAD_INTERRUPTED e nao deixa temp', async () => {
  await withTempDir(async (tempDir) => {
    let emitted = 0;
    const abruptClose = new Readable({
      read() {
        if (emitted < 3) {
          emitted++;
          this.push(Buffer.alloc(CHUNK, 0x43));
        } else {
          setImmediate(() => this.destroy()); // fecha sem erro e sem fim
        }
      },
    });
    await assert.rejects(
      () => spoolMultipartUpload(fakePart(abruptClose), MAX_UPLOAD, { tempDir }),
      (e: any) => e instanceof ContentError && e.code === 'UPLOAD_INTERRUPTED'
    );
    assert.deepEqual(await tmpResidues(tempDir), []);
  });
});

test('Upload streaming (HM-3) — acima de 100 MiB e rejeitado com 413 e o temp parcial e removido', async () => {
  await withTempDir(async (tempDir) => {
    const chunk1MiB = Buffer.alloc(MIB, 0x41);
    let count = 0;
    const excess = new Readable({
      read() {
        if (count < 101) {
          count++;
          this.push(chunk1MiB);
        } else {
          this.push(null);
        }
      },
    });
    await assert.rejects(
      () => spoolMultipartUpload(fakePart(excess, { filename: 'arquivo-101mb.bin' }), MAX_UPLOAD, { tempDir }),
      (e: any) => e.status === 413 && e.code === 'FILE_TOO_LARGE'
    );
    assert.deepEqual(await tmpResidues(tempDir), []);
  });
});

test('Upload streaming (HM-3) — exatamente 100 MiB e aceito (limite inclusivo)', async () => {
  await withTempDir(async (tempDir) => {
    const spooled = await spoolMultipartUpload(fakePart(syntheticSource(MAX_UPLOAD / CHUNK)), MAX_UPLOAD, { tempDir });
    try {
      assert.equal(spooled.sizeBytes, MAX_UPLOAD);
    } finally {
      await spooled.cleanup();
    }
    assert.deepEqual(await tmpResidues(tempDir), []);
  });
});

test('Upload streaming (HM-3) — stream JA truncado antes do try/finally: 413 sem criar temp e sem descritor pendente', async () => {
  await withTempDir(async (tempDir) => {
    // (a) marcado truncado no proprio stream do arquivo
    const viaStream = syntheticSource(4);
    (viaStream as any).truncated = true;
    await assert.rejects(
      () => spoolMultipartUpload(fakePart(viaStream), MAX_UPLOAD, { tempDir }),
      (e: any) => e.status === 413 && e.code === 'FILE_TOO_LARGE'
    );
    // (b) marcado truncado no objeto multipart
    await assert.rejects(
      () => spoolMultipartUpload(fakePart(syntheticSource(4), { truncated: true }), MAX_UPLOAD, { tempDir }),
      (e: any) => e.status === 413 && e.code === 'FILE_TOO_LARGE'
    );
    // da tempo de qualquer abertura assincrona de arquivo (se existisse) concluir: nada pode aparecer no diretorio
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await readdir(tempDir), [], 'nenhum arquivo criado nem orfao');
    assert.equal(viaStream.readableFlowing, true, 'stream truncado e escoado (resume), nao fica pendurado');
  });
});

test('Upload streaming (HM-3) — cleanup concorrente com a abertura do arquivo nao deixa orfao', async () => {
  await withTempDir(async (tempDir) => {
    // erro imediato: a rejeicao ocorre quando o descritor do WriteStream mal terminou de abrir
    const failing = new Readable({
      read() {
        this.destroy(new Error('falha imediata'));
      },
    });
    await assert.rejects(() => spoolMultipartUpload(fakePart(failing), MAX_UPLOAD, { tempDir }), /falha imediata/);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await readdir(tempDir), []);
  });
});

// ---------- fim a fim: Fastify + @fastify/multipart com socket real e backpressure ----------

const BOUNDARY = '----zafira-hm3-boundary';

async function postMultipart(
  port: number,
  route: string,
  payloadBytes: number,
  hash: ReturnType<typeof createHash>,
  probe?: MemoryProbe
): Promise<{ status: number; body: any }> {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  const block = Buffer.alloc(CHUNK, 0x5a);
  return new Promise((resolve, reject) => {
    let finished = false;
    let unblockSend: (() => void) | null = null;
    let resReceived = false;
    let statusCode = 0;
    const parts: Buffer[] = [];
    const parseBody = () => {
      try {
        return JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch {
        return Buffer.concat(parts).toString('utf8');
      }
    };
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: route,
        headers: {
          'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
          'content-length': head.length + payloadBytes + tail.length,
          connection: 'close',
        },
      },
      (res) => {
        resReceived = true;
        statusCode = res.statusCode ?? 0;
        if (unblockSend) {
          unblockSend();
          unblockSend = null;
        }
        res.on('data', (d) => parts.push(d));
        res.on('error', (_e: any) => {
          if (!finished) {
            finished = true;
            const b = parseBody();
            resolve({ status: statusCode || 413, body: b && typeof b === 'object' && (b as any).code ? b : { code: 'FILE_TOO_LARGE' } });
          }
        });
        res.on('end', () => {
          if (!finished) {
            finished = true;
            resolve({ status: statusCode, body: parseBody() });
          }
        });
      }
    );
    req.on('socket', (socket) => {
      socket.on('error', () => {});
    });
    req.on('error', (e: any) => {
      if (resReceived || e.code === 'ECONNRESET') {
        if (!finished) {
          finished = true;
          const b = parseBody();
          resolve({ status: statusCode || 413, body: b && typeof b === 'object' && (b as any).code ? b : { code: 'FILE_TOO_LARGE' } });
        }
        return;
      }
      if (!finished) {
        finished = true;
        reject(e);
      }
    });
    const send = async (b: Buffer) => {
      if (finished || req.destroyed) return;
      if (!req.write(b)) {
        await new Promise<void>((r) => {
          unblockSend = r;
          req.once('drain', () => {
            unblockSend = null;
            r();
          });
        });
      }
    };
    (async () => {
      await send(head);
      for (let sent = 0; sent < payloadBytes; sent += CHUNK) {
        if (finished || req.destroyed) break;
        const piece = block.subarray(0, Math.min(CHUNK, payloadBytes - sent));
        hash.update(piece);
        probe?.sample();
        await send(piece);
      }
      if (!finished && !req.destroyed) req.end(tail);
    })().catch((e) => {
      if (!finished) reject(e);
    });
  });
}

async function buildApp(tempDir: string, fileSize = MAX_UPLOAD) {
  const app = fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize, files: 1 } });
  app.setErrorHandler((err: any, _req, reply) => {
    const code = err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413 ? 'FILE_TOO_LARGE' : (err.code ?? 'ERRO');
    reply.header('connection', 'close').status(err.status ?? err.statusCode ?? 500).send({ code });
  });
  app.post('/novo', async (req) => {
    const part = await req.file();
    if (!part) throw new ContentError(400, 'FILE_REQUIRED', 'Nenhum arquivo enviado.');
    if (part.truncated || (part.file as any)?.truncated) {
      throw new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.');
    }
    const spooled = await spoolMultipartUpload(part as any, MAX_UPLOAD, { tempDir });
    try {
      return { size: spooled.sizeBytes, sha256: spooled.sha256 };
    } finally {
      await spooled.cleanup();
    }
  });
  app.post('/legado', async (req) => {
    const part = await req.file();
    const buf = await part!.toBuffer(); // implementacao anterior: buffer integral na memoria
    return { size: buf.length, sha256: sha(buf) };
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, port: (app.server.address() as AddressInfo).port };
}

test('Upload e2e (HM-3) — Fastify+multipart 50 MiB: spooler novo vs buffer integral legado, medidos com a mesma sonda', async () => {
  await withTempDir(async (tempDir) => {
    const { app, port } = await buildApp(tempDir);
    try {
      const hashNovo = createHash('sha256');
      const probeNovo = new MemoryProbe('e2e-upload-novo-spooler-50MiB', PAYLOAD_BYTES).start();
      const novo = await postMultipart(port, '/novo', PAYLOAD_BYTES, hashNovo, probeNovo);
      const repNovo = probeNovo.stop();
      logMemoryReport(repNovo);
      assert.equal(novo.status, 200);
      assert.equal(novo.body.size, PAYLOAD_BYTES);
      assert.equal(novo.body.sha256, hashNovo.digest('hex'));
      assert.deepEqual(await tmpResidues(tempDir), []);

      const hashLegado = createHash('sha256');
      const probeLegado = new MemoryProbe('e2e-upload-legado-toBuffer-50MiB (referencia sintetica)', PAYLOAD_BYTES).start();
      const legado = await postMultipart(port, '/legado', PAYLOAD_BYTES, hashLegado, probeLegado);
      const repLegado = probeLegado.stop();
      logMemoryReport(repLegado);
      assert.equal(legado.status, 200);
      assert.equal(legado.body.size, PAYLOAD_BYTES);

      // Comprovacao objetiva: nas mesmas condicoes de medicao e runtime, o spooler evita carregar o buffer
      // integral na heap/external e mantem pico inferior ao da implementacao legada (toBuffer)
      assert.ok(
        repNovo.raw.deltaPeakHeapPlusExternal < repLegado.raw.deltaPeakHeapPlusExternal,
        `o spooler (${repNovo.deltaPeakHeapPlusExternalMiB} MiB) deve ter pico menor que o buffer integral legado (${repLegado.deltaPeakHeapPlusExternalMiB} MiB)`
      );
    } finally {
      await app.close();
    }
  });
});

test('Upload e2e (HM-3) — limite do multipart excedido: 413, sem temp residual', async () => {
  await withTempDir(async (tempDir) => {
    const { app, port } = await buildApp(tempDir, 1 * MIB); // limite do multipart reduzido para o teste
    try {
      const res = await postMultipart(port, '/novo', 3 * MIB, createHash('sha256'));
      assert.equal(res.status, 413);
      assert.equal(res.body.code, 'FILE_TOO_LARGE');
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(await tmpResidues(tempDir), []);
    } finally {
      await app.close();
    }
  });
});

// ---------- download: medicao por driver ----------

const drain = async (stream: NodeJS.ReadableStream): Promise<number> => {
  let n = 0;
  for await (const c of stream) n += (c as Buffer).length;
  return n;
};

test('Download (HM-3) — LocalFileStorage.openStream 50 MiB: bytes integros, memoria separada por metrica', async () => {
  await withTempDir(async (dir) => {
    const { file, sha256 } = await makeFile(dir, PAYLOAD_BYTES);
    const storage = new LocalFileStorage(path.join(dir, 'store'));
    const key = `org/11111111-2222-4333-8444-555555555555/sha256/${sha256}`;
    await storage.putFromPath(key, file, { sizeBytes: PAYLOAD_BYTES, sha256 });

    const probe = new MemoryProbe('download-local-openStream-50MiB', PAYLOAD_BYTES).start();
    const res = await storage.openStream(key);
    const bytes = await drain(res.stream);
    const report = probe.stop();
    logMemoryReport(report);

    assert.equal(bytes, PAYLOAD_BYTES);
    assert.ok(
      report.raw.deltaPeakHeapPlusExternal < PAYLOAD_BYTES * 0.9,
      `pico heap+external do download local (${report.deltaPeakHeapPlusExternalMiB} MiB) deve ser menor que 0.9x o arquivo`
    );
  });
});

test('Download (HM-3) — S3.openStream 50 MiB (spool + SHA integral) vs S3.get legado (buffer integral)', async () => {
  await withTempDir(async (dir) => {
    const { file, sha256 } = await makeFile(dir, PAYLOAD_BYTES);
    const spoolDir = path.join(dir, 'spool');
    await (await import('node:fs/promises')).mkdir(spoolDir);
    const key = `org/11111111-2222-4333-8444-555555555555/sha256/${sha256}`;

    // cliente S3 injetado: o corpo e um stream do arquivo (como o SDK entrega o corpo da resposta), sem rede real
    const client = {
      send: async (command: unknown) => {
        if (!(command instanceof GetObjectCommand)) throw new Error('comando inesperado');
        const body: any = createReadStream(file);
        body.transformToByteArray = async () => new Uint8Array(await readFile(file));
        return { Body: body };
      },
    } as unknown as ConstructorParameters<typeof S3FileStorage>[0];
    const storage = new S3FileStorage(client, 'bucket-teste', '', spoolDir);

    const probeNovo = new MemoryProbe('download-s3-openStream-spool-50MiB', PAYLOAD_BYTES).start();
    const res = await storage.openStream(key);
    assert.equal(res.sizeBytes, PAYLOAD_BYTES);
    const bytes = await drain(res.stream);
    const repNovo = probeNovo.stop();
    logMemoryReport(repNovo);
    await res.cleanup?.();
    assert.deepEqual(await tmpResidues(spoolDir), [], 'spool removido apos a entrega');

    const probeLegado = new MemoryProbe('download-s3-get-legado-buffer-50MiB (referencia sintetica)', PAYLOAD_BYTES).start();
    const buf = await storage.get(key);
    assert.equal(buf.length, PAYLOAD_BYTES);
    const repLegado = probeLegado.stop();
    logMemoryReport(repLegado);

    assert.ok(
      repNovo.raw.deltaPeakHeapPlusExternal < PAYLOAD_BYTES * 0.9,
      `pico heap+external do download S3 (${repNovo.deltaPeakHeapPlusExternalMiB} MiB) deve ser menor que 0.9x o arquivo`
    );
    assert.ok(
      repNovo.raw.deltaPeakHeapPlusExternal < repLegado.raw.deltaPeakHeapPlusExternal,
      `o download S3 com spool (${repNovo.deltaPeakHeapPlusExternalMiB} MiB) deve ter pico menor que o get legado com buffer integral (${repLegado.deltaPeakHeapPlusExternalMiB} MiB)`
    );
  });
});
