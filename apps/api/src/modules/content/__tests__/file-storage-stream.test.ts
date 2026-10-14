import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { startFakeS3, type FakeS3 } from '../../../lib/__tests__/support/fake-s3-server.js';
import {
  LocalFileStorage,
  S3FileStorage,
  StorageIntegrityError,
  computeFileSha256,
  resolveFileStorage,
} from '../file-storage.js';
import { spoolMultipartUpload } from '../upload-spooler.js';

const ORG = '11111111-2222-4333-8444-555555555555';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const keyFor = (b: Buffer, org = ORG) => `org/${org}/sha256/${sha(b)}`;

async function streamToBuffer(readable: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test('FileStorage Streaming (HM-3) — LocalFileStorage: putFromPath e openStream', async () => {
  const baseDir = mkdtempSync(path.join(tmpdir(), 'zafira-local-fs-'));
  const storage = new LocalFileStorage(baseDir);

  const payload = Buffer.from('conteudo-para-streaming-local-12345');
  const digest = sha(payload);
  const key = keyFor(payload);

  // Cria arquivo temporário simulando spool de upload
  const srcTmp = path.join(baseDir, `src-${randomUUID()}.tmp`);
  await writeFile(srcTmp, payload);

  assert.equal(await storage.exists(key), false);

  // 1. Grava a partir do arquivo temporário
  await storage.putFromPath(key, srcTmp, { sizeBytes: payload.length, sha256: digest });
  assert.equal(await storage.exists(key), true);

  // 2. Abre stream de leitura
  const result = await storage.openStream(key);
  assert.equal(result.sizeBytes, payload.length);
  const readBytes = await streamToBuffer(result.stream);
  assert.deepEqual(readBytes, payload);

  // 3. Rejeita se o SHA-256 informado não bater com a chave
  assert.rejects(
    () => storage.putFromPath(key, srcTmp, { sizeBytes: payload.length, sha256: '0000000000000000000000000000000000000000000000000000000000000000' }),
    StorageIntegrityError
  );

  // 4. Detecção de corrupção: se alguém alterar o arquivo no disco, openStream recusa servir bytes
  const destPath = path.join(baseDir, ...key.split('/'));
  await writeFile(destPath, Buffer.from('conteudo-corrompido-adulterado'));
  await assert.rejects(
    () => storage.openStream(key),
    StorageIntegrityError
  );

  await unlink(srcTmp).catch(() => {});
});

const envFor = (s3: FakeS3, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  FILE_STORAGE_DRIVER: 's3',
  FILE_STORAGE_S3_ENDPOINT: s3.endpoint,
  FILE_STORAGE_S3_ALLOW_INSECURE: 'true',
  FILE_STORAGE_S3_REGION: 'auto',
  FILE_STORAGE_S3_BUCKET: s3.bucket,
  FILE_STORAGE_S3_ACCESS_KEY_ID: 'AKIATESTEXAMPLE0001',
  FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'segredo-de-teste-nao-real-0123456789',
  ...extra,
});

test('FileStorage Streaming (HM-3) — S3FileStorage: putFromPath e openStream com emulador S3', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());

  const storage = resolveFileStorage(envFor(s3));
  const payload = Buffer.from('bytes-para-teste-de-s3-streaming-45678');
  const digest = sha(payload);
  const key = keyFor(payload);

  const tmpFile = path.join(tmpdir(), `s3-src-${randomUUID()}.tmp`);
  await writeFile(tmpFile, payload);

  // 1. putFromPath
  await storage.putFromPath(key, tmpFile, { sizeBytes: payload.length, sha256: digest });
  assert.equal(await storage.exists(key), true);

  // 2. openStream com validação de hash e limpeza
  const res = await storage.openStream(key);
  assert.equal(res.sizeBytes, payload.length);
  const readData = await streamToBuffer(res.stream);
  assert.deepEqual(readData, payload);

  if (res.cleanup) await res.cleanup();

  // 3. Detecção de corrupção: se o objeto no S3 estiver corrompido, openStream apaga temp e lança erro
  s3.objects.get(key)!.body = Buffer.from('conteudo-s3-adulterado');
  await assert.rejects(
    () => storage.openStream(key),
    StorageIntegrityError
  );

  await unlink(tmpFile).catch(() => {});
});

test('Spooler de Upload (HM-3) — spoolMultipartUpload aplica limite estrito de 100 MiB e apaga temp', async () => {
  // Simula arquivo multipart excedendo o limite de 100 MiB
  const chunk10MB = Buffer.alloc(10 * 1024 * 1024, 0x61);

  // Cria um Readable stream que emite 11 chunks de 10 MB (110 MB no total > 100 MiB)
  let count = 0;
  const largeStream = new Readable({
    read() {
      if (count < 11) {
        count++;
        this.push(chunk10MB);
      } else {
        this.push(null);
      }
    },
  });

  const fakeMultipart: any = {
    file: largeStream,
    filename: 'video-muito-grande.mp4',
    mimetype: 'video/mp4',
    truncated: false,
  };

  // Deve falhar com FILE_TOO_LARGE
  await assert.rejects(
    async () => {
      const spooled = await spoolMultipartUpload(fakeMultipart, 100 * 1024 * 1024);
      await spooled.cleanup();
    },
    (err: any) => err.code === 'FILE_TOO_LARGE' && err.status === 413
  );
});

test('Spooler de Upload (HM-3) — spoolMultipartUpload com upload válido computa SHA-256 e tamanho', async () => {
  const content = Buffer.from('video-valido-de-reels-de-exemplo-0123456789');
  const expectedSha = sha(content);

  const validStream = Readable.from([content]);
  const fakeMultipart: any = {
    file: validStream,
    filename: 'post.mp4',
    mimetype: 'video/mp4',
    truncated: false,
  };

  const spooled = await spoolMultipartUpload(fakeMultipart, 100 * 1024 * 1024);
  try {
    assert.equal(spooled.sizeBytes, content.length);
    assert.equal(spooled.sha256, expectedSha);
    assert.equal(spooled.filename, 'post.mp4');

    // Confere arquivo em disco
    const onDisk = await readFile(spooled.tempFilePath);
    assert.deepEqual(onDisk, content);
  } finally {
    await spooled.cleanup();
  }

  // Verifica que o arquivo temporário foi removido no cleanup
  await assert.rejects(() => stat(spooled.tempFilePath), (err: any) => err.code === 'ENOENT');
});

test('computeFileSha256 (HM-3) — calcula hash incrementalmente com O(1) de memória', async () => {
  const sample = Buffer.from('teste-de-calculo-sha256-sem-heap-integral');
  const tmp = path.join(tmpdir(), `test-sha-${randomUUID()}.tmp`);
  await writeFile(tmp, sample);

  try {
    const computed = await computeFileSha256(tmp);
    assert.equal(computed, sha(sample));
  } finally {
    await unlink(tmp).catch(() => {});
  }
});
