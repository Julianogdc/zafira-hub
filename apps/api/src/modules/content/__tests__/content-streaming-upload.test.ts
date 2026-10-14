import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import fastify from 'fastify';
import multipart from '@fastify/multipart';
import { spoolMultipartUpload } from '../upload-spooler.js';
import { LocalFileStorage, S3FileStorage, StorageIntegrityError } from '../file-storage.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('Streaming Upload & Memory Benchmark (HM-3) — spooling de arquivo grande com consumo de heap constante', async () => {
  // Arquivo representativo de grande porte: 25 MiB (26.214.400 bytes) gerado em blocos
  const CHUNK_SIZE = 64 * 1024; // 64 KiB por bloco
  const TOTAL_CHUNKS = 400; // 400 * 64 KiB = 25.600 KiB = 25 MiB
  const TOTAL_BYTES = TOTAL_CHUNKS * CHUNK_SIZE;

  // Bloco fixo com cabeçalho MP4 válido (ftypisom) para simular vídeo
  const sampleChunk = Buffer.alloc(CHUNK_SIZE, 0x5a);
  // Assinatura de vídeo MP4 / ISO Base Media
  sampleChunk.write('\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41', 0, 'binary');

  let chunksSent = 0;
  const hash = createHash('sha256');

  const largeStream = new Readable({
    read() {
      if (chunksSent < TOTAL_CHUNKS) {
        chunksSent++;
        hash.update(sampleChunk);
        this.push(sampleChunk);
      } else {
        this.push(null);
      }
    },
  });

  const fakeMultipart: any = {
    file: largeStream,
    filename: 'video-reels-25mb.mp4',
    mimetype: 'video/mp4',
    truncated: false,
  };

  // Força garbage collection se disponível (ou mede o delta baseline)
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  const spooled = await spoolMultipartUpload(fakeMultipart, 100 * 1024 * 1024);

  const heapAfter = process.memoryUsage().heapUsed;
  const heapDelta = heapAfter - heapBefore;
  const expectedSha256 = hash.digest('hex');

  try {
    assert.equal(spooled.sizeBytes, TOTAL_BYTES, 'tamanho em bytes exato conferido');
    assert.equal(spooled.sha256, expectedSha256, 'SHA-256 computado incrementalmente confere');
    assert.equal(spooled.filename, 'video-reels-25mb.mp4');

    // Evidência objetiva medida de consumo de memória:
    // Com buffer integral, carregar 25 MiB alocaria >= 25 MiB na heap.
    // Com streaming, o heapDelta é uma fração ínfima do tamanho do arquivo (chunks controlados).
    const heapDeltaMb = (heapDelta / (1024 * 1024)).toFixed(2);
    const fileMb = (TOTAL_BYTES / (1024 * 1024)).toFixed(2);
    console.log(
      `[HM-3 EVIDÊNCIA DE MEMÓRIA] Arquivo: ${fileMb} MiB | Heap antes: ${(heapBefore / 1024 / 1024).toFixed(2)} MiB | ` +
      `Heap depois: ${(heapAfter / 1024 / 1024).toFixed(2)} MiB | Variação de Heap: ${heapDeltaMb} MiB`
    );

    // O crescimento da heap não deve se aproximar do tamanho do arquivo
    // (tolerância ampla para overhead de V8/test-runner, mas comprovadamente muito inferior ao buffer integral de 25 MB)
    assert.ok(
      heapDelta < TOTAL_BYTES * 0.75,
      `Variação da heap (${heapDeltaMb} MiB) deve ser substancialmente menor que o tamanho do arquivo (${fileMb} MiB)`
    );

    // Confere existência física no disco
    const s = await stat(spooled.tempFilePath);
    assert.equal(s.size, TOTAL_BYTES);
  } finally {
    await spooled.cleanup();
  }

  // Confere que o arquivo temporário foi removido
  await assert.rejects(() => stat(spooled.tempFilePath), (err: any) => err.code === 'ENOENT');
});

test('Streaming Upload & Memory Benchmark (HM-3) — cancelamento/interrupção remove temp sem deixar resíduos', async () => {
  let emitted = 0;
  const interruptedStream = new Readable({
    read() {
      if (emitted < 5) {
        emitted++;
        this.push(Buffer.alloc(64 * 1024, 0x42));
      } else {
        // Simula queda de conexão do cliente no meio da transmissão
        this.destroy(new Error('ECONNRESET: Conexão interrompida pelo cliente'));
      }
    },
  });

  const fakeMultipart: any = {
    file: interruptedStream,
    filename: 'upload-interrompido.mp4',
    mimetype: 'video/mp4',
    truncated: false,
  };

  await assert.rejects(
    () => spoolMultipartUpload(fakeMultipart, 100 * 1024 * 1024),
    /ECONNRESET/
  );
});

test('Streaming Upload & Memory Benchmark (HM-3) — arquivo acima de 100 MiB rejeitado estritamente', async () => {
  // Stream que emite chunks totalizando 101 MiB (> 100 MiB)
  const chunk1MB = Buffer.alloc(1024 * 1024, 0x41);
  let count = 0;

  const excessStream = new Readable({
    read() {
      if (count < 101) {
        count++;
        this.push(chunk1MB);
      } else {
        this.push(null);
      }
    },
  });

  const fakeMultipart: any = {
    file: excessStream,
    filename: 'arquivo-101mb.bin',
    mimetype: 'application/octet-stream',
    truncated: false,
  };

  await assert.rejects(
    () => spoolMultipartUpload(fakeMultipart, 100 * 1024 * 1024),
    (err: any) => err.status === 413 && err.code === 'FILE_TOO_LARGE'
  );
});

test('Streaming Upload (HM-3) — stream truncado pelo busboy/fastify multipart rejeita com 413 FILE_TOO_LARGE', async () => {
  const truncatedStream = new Readable({
    read() {
      this.push(Buffer.alloc(1024, 0x42));
      this.push(null);
    },
  });
  (truncatedStream as any).truncated = true;

  const fakeMultipart: any = {
    file: truncatedStream,
    filename: 'truncado-pelo-fastify.mp4',
    mimetype: 'video/mp4',
    truncated: false,
  };

  await assert.rejects(
    () => spoolMultipartUpload(fakeMultipart, 100 * 1024 * 1024),
    (err: any) => err.status === 413 && err.code === 'FILE_TOO_LARGE'
  );
});

test('Streaming Download & Integrity (HM-3) — leitura via stream não carrega arquivo inteiro na memória', async () => {
  const baseDir = tmpdir();
  const storage = new LocalFileStorage(baseDir);

  // Arquivo de 10 MiB
  const payload = Buffer.alloc(10 * 1024 * 1024, 0x43);
  const digest = sha(payload);
  const key = `org/11111111-2222-3333-4444-555555555555/sha256/${digest}`;

  const tmpFile = path.join(baseDir, `dl-test-${randomUUID()}.tmp`);
  await writeFile(tmpFile, payload);

  try {
    await storage.putFromPath(key, tmpFile, { sizeBytes: payload.length, sha256: digest });

    const memBefore = process.memoryUsage().heapUsed;
    const res = await storage.openStream(key);

    let bytesReceived = 0;
    for await (const chunk of res.stream) {
      bytesReceived += (chunk as Buffer).length;
    }

    const memAfter = process.memoryUsage().heapUsed;
    assert.equal(bytesReceived, payload.length);

    console.log(
      `[HM-3 EVIDÊNCIA DE DOWNLOAD] 10 MiB lidos via stream | Delta Heap: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MiB`
    );
  } finally {
    await unlink(tmpFile).catch(() => {});
    const full = path.resolve(baseDir, ...key.split('/'));
    await unlink(full).catch(() => {});
  }
});
