import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3FileStorage, StorageIntegrityError, StorageStreamInterruptedError } from '../file-storage.js';

/**
 * HM-3 (ajuste complementar) - regressao: S3FileStorage.openStream com streams encerrados prematuramente.
 * Usa um cliente S3 injetado (sem rede, sem bucket real) e um diretorio temporario proprio para provar que nenhum
 * spool residual fica no disco em nenhum dos cenarios.
 */

const ORG = '11111111-2222-4333-8444-555555555555';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const keyFor = (b: Buffer) => `org/${ORG}/sha256/${sha(b)}`;

const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

type Handler = (command: unknown) => Promise<unknown>;

const clientWith = (handler: Handler) => ({ send: handler }) as unknown as ConstructorParameters<typeof S3FileStorage>[0];

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zafira-hm3-s3-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const residues = async (dir: string) => (await readdir(dir)).filter((n) => n.endsWith('.tmp'));

/** Corpo S3 que emite `chunks` e depois executa `finish(stream)` (destroy sem erro, erro, ou fim limpo). */
function bodyThat(chunks: Buffer[], finish: (s: Readable) => void): Readable {
  let i = 0;
  const s: Readable = new Readable({
    read() {
      if (i < chunks.length) {
        this.push(chunks[i++]);
      } else {
        // adia para o proximo ciclo para os chunks emitidos serem entregues antes do encerramento
        setImmediate(() => finish(s));
      }
    },
  });
  return s;
}

const getOnly = (body: Readable): Handler => async (command) => {
  if (command instanceof GetObjectCommand) return { Body: body };
  throw new Error('comando inesperado');
};

test('S3 openStream (HM-3) — close SEM end nem error rejeita como interrompido e nao deixa spool', async () => {
  await withTempDir(async (dir) => {
    const full = Buffer.alloc(256 * 1024, 0x61);
    const body = bodyThat([full.subarray(0, 64 * 1024), full.subarray(64 * 1024, 128 * 1024)], (s) => s.destroy());
    const storage = new S3FileStorage(clientWith(getOnly(body)), 'bucket-teste', '', dir);

    await assert.rejects(() => storage.openStream(keyFor(full)), StorageStreamInterruptedError);
    assert.deepEqual(await residues(dir), [], 'nenhum spool residual apos close sem end');
  });
});

test('S3 openStream (HM-3) — erro no meio do download rejeita com o erro original e nao deixa spool', async () => {
  await withTempDir(async (dir) => {
    const full = Buffer.alloc(256 * 1024, 0x62);
    const body = bodyThat([full.subarray(0, 64 * 1024)], (s) => s.destroy(new Error('ECONNRESET simulado')));
    const storage = new S3FileStorage(clientWith(getOnly(body)), 'bucket-teste', '', dir);

    await assert.rejects(() => storage.openStream(keyFor(full)), /ECONNRESET simulado/);
    assert.deepEqual(await residues(dir), []);
  });
});

test('S3 openStream (HM-3) — corpo curto com end limpo falha na integridade e nao deixa spool', async () => {
  await withTempDir(async (dir) => {
    const full = Buffer.alloc(256 * 1024, 0x63);
    const body = bodyThat([full.subarray(0, 100 * 1024)], (s) => s.push(null));
    const storage = new S3FileStorage(clientWith(getOnly(body)), 'bucket-teste', '', dir);

    await assert.rejects(() => storage.openStream(keyFor(full)), StorageIntegrityError);
    assert.deepEqual(await residues(dir), []);
  });
});

test('S3 openStream (HM-3) — caminho feliz: spool some quando o stream fecha, cleanup e idempotente', async () => {
  await withTempDir(async (dir) => {
    const full = Buffer.alloc(300 * 1024, 0x64);
    const body = bodyThat([full.subarray(0, 150 * 1024), full.subarray(150 * 1024)], (s) => s.push(null));
    const storage = new S3FileStorage(clientWith(getOnly(body)), 'bucket-teste', '', dir);

    const res = await storage.openStream(keyFor(full));
    assert.equal(res.sizeBytes, full.length);
    assert.equal((await residues(dir)).length, 1, 'spool existe enquanto o stream esta aberto');

    const received: Buffer[] = [];
    for await (const c of res.stream) received.push(Buffer.from(c));
    assert.deepEqual(Buffer.concat(received), full);

    // sem chamar cleanup: o fechamento do stream remove o spool
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await residues(dir), [], 'spool removido ao fechar o stream');

    await res.cleanup?.();
    await res.cleanup?.(); // idempotente: nao lanca
  });
});

test('S3 openStream (HM-3) — consumidor que desiste (destroy) remove o spool', async () => {
  await withTempDir(async (dir) => {
    const full = Buffer.alloc(512 * 1024, 0x65);
    const body = bodyThat([full.subarray(0, 256 * 1024), full.subarray(256 * 1024)], (s) => s.push(null));
    const storage = new S3FileStorage(clientWith(getOnly(body)), 'bucket-teste', '', dir);

    const res = await storage.openStream(keyFor(full));
    assert.equal((await residues(dir)).length, 1);
    (res.stream as Readable).destroy(); // cliente HTTP desistiu
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await residues(dir), []);
  });
});

test('S3 putFromPath (HM-3) — falha no envio fecha o stream do arquivo temporario (sem descritor vazado)', async () => {
  await withTempDir(async (dir) => {
    const payload = Buffer.alloc(128 * 1024, 0x66);
    const src = path.join(dir, 'origem.tmp');
    await writeFile(src, payload);

    let captured: Readable | null = null;
    const storage = new S3FileStorage(
      clientWith(async (command) => {
        if (command instanceof HeadObjectCommand) throw notFound();
        if (command instanceof PutObjectCommand) {
          captured = (command.input as { Body: Readable }).Body;
          throw new Error('falha de rede simulada');
        }
        throw new Error('comando inesperado');
      }),
      'bucket-teste',
      '',
      dir
    );

    await assert.rejects(
      () => storage.putFromPath(keyFor(payload), src, { sizeBytes: payload.length, sha256: sha(payload) }),
      /falha de rede simulada/
    );
    assert.ok(captured, 'o corpo foi entregue ao cliente como stream (PutObjectCommand)');
    assert.equal((captured as unknown as Readable).destroyed, true, 'stream do arquivo temporario destruido no finally');
  });
});

test('S3 putFromPath (HM-3) — envia o arquivo como stream via PutObjectCommand (nao Buffer integral)', async () => {
  await withTempDir(async (dir) => {
    const payload = Buffer.alloc(64 * 1024, 0x67);
    const src = path.join(dir, 'origem.tmp');
    await writeFile(src, payload);

    let bodyKind = '';
    let contentLength = -1;
    const storage = new S3FileStorage(
      clientWith(async (command) => {
        if (command instanceof HeadObjectCommand) throw notFound();
        if (command instanceof PutObjectCommand) {
          const input = command.input as { Body: unknown; ContentLength: number };
          bodyKind = input.Body instanceof Readable ? 'stream' : Buffer.isBuffer(input.Body) ? 'buffer' : typeof input.Body;
          contentLength = input.ContentLength;
          for await (const _ of input.Body as Readable) void _; // consome como o SDK faria
          return {};
        }
        throw new Error('comando inesperado');
      }),
      'bucket-teste',
      '',
      dir
    );

    await storage.putFromPath(keyFor(payload), src, { sizeBytes: payload.length, sha256: sha(payload) });
    assert.equal(bodyKind, 'stream');
    assert.equal(contentLength, payload.length);
  });
});
