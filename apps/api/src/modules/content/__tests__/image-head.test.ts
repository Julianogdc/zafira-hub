import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PUBLISH_MAX_IMAGE_BYTES } from '@zafira/domain';
import {
  IMAGE_DIMENSIONS_MAX_READ_BYTES,
  identifyImageDimensions,
  readFileHead,
  readStreamHead,
  readImageDimensionsFromStorage,
} from '../image-head.js';
import { ensureImageDimensions } from '../content.service.js';
import { prisma } from '../../../lib/prisma.js';
import type { FileStorage } from '../file-storage.js';

/**
 * HM-3 (ajuste complementar) - dimensoes de imagem somente por leitura LIMITADA (nunca o arquivo inteiro).
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** JPEG sintetico: SOI + `appSegments` segmentos APP1 de ~64 KiB + SOF0 (width x height) + dados. */
function jpegWithPadding(appSegments: number, width: number, height: number): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  for (let i = 0; i < appSegments; i++) {
    const seg = Buffer.alloc(2 + 0xffff); // marcador APP1 (2 bytes) + comprimento maximo de segmento (0xFFFF, inclui os 2 bytes do tamanho)
    seg[0] = 0xff;
    seg[1] = 0xe1;
    seg.writeUInt16BE(0xffff, 2);
    parts.push(seg.subarray(0, 2 + 0xffff));
  }
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof, Buffer.alloc(1024, 0x00));
  return Buffer.concat(parts);
}

async function withTempFile<T>(content: Buffer, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zafira-hm3-img-'));
  const file = path.join(dir, 'imagem.tmp');
  await writeFile(file, content);
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mockStorage(opts: {
  streamContent?: Buffer;
  streamError?: Error;
  sizeBytes?: number;
  throwOnGet?: boolean;
}) {
  let getCalled = 0;
  let openStreamCalled = 0;
  let cleanupCalled = 0;
  let streamDestroyed = false;

  const storage: FileStorage = {
    driver: 'mock',
    async put() {},
    async exists() { return true; },
    async putFromPath() {},
    async get() {
      getCalled++;
      if (opts.throwOnGet !== false) {
        throw new Error('VIOLAÇÃO HM-3: storage.get() foi chamado durante identificação de dimensões!');
      }
      return opts.streamContent ?? Buffer.alloc(0);
    },
    async openStream() {
      openStreamCalled++;
      if (opts.streamError) {
        throw opts.streamError;
      }
      const data = opts.streamContent ?? Buffer.alloc(0);
      let offset = 0;
      const readable = new Readable({
        read(size) {
          if (offset >= data.length) {
            this.push(null);
            return;
          }
          const chunk = data.subarray(offset, offset + size);
          offset += chunk.length;
          this.push(chunk);
        },
        destroy(err, cb) {
          streamDestroyed = true;
          cb(err);
        },
      });

      return {
        stream: readable,
        sizeBytes: opts.sizeBytes ?? data.length,
        cleanup: async () => {
          cleanupCalled++;
        },
      };
    },
  };

  return {
    storage,
    get getCalled() { return getCalled; },
    get openStreamCalled() { return openStreamCalled; },
    get cleanupCalled() { return cleanupCalled; },
    get streamDestroyed() { return streamDestroyed; },
  };
}

test('image-head (HM-3) — JPEG com ~200 KiB de metadados antes do SOF: achado pela leitura limitada', async () => {
  const file = jpegWithPadding(3, 4032, 3024); // ~192 KiB antes do SOF (acima dos 64 KiB do cabecalho capturado)
  const header = file.subarray(0, 64 * 1024);
  await withTempFile(file, async (tempFilePath) => {
    const dims = await identifyImageDimensions({ headerBuffer: header, tempFilePath, sizeBytes: file.length });
    assert.deepEqual(dims, { width: 4032, height: 3024 });
  });
});

test('image-head (HM-3) — cabecalho de 64 KiB ja basta: nao abre o arquivo', async () => {
  const file = jpegWithPadding(0, 800, 600);
  const dims = await identifyImageDimensions({
    headerBuffer: file,
    tempFilePath: path.join(tmpdir(), 'arquivo-que-nao-existe.tmp'),
    sizeBytes: file.length,
  });
  assert.deepEqual(dims, { width: 800, height: 600 });
});

test('image-head (HM-3) — mais de 1 MiB de metadados antes do SOF: desconhecida (null), sem ler o arquivo inteiro', async () => {
  const segments = Math.ceil(IMAGE_DIMENSIONS_MAX_READ_BYTES / 0xffff) + 2; // ultrapassa o teto com folga
  const file = jpegWithPadding(segments, 1000, 1000);
  assert.ok(file.length > IMAGE_DIMENSIONS_MAX_READ_BYTES + 64 * 1024);
  await withTempFile(file, async (tempFilePath) => {
    const dims = await identifyImageDimensions({ headerBuffer: file.subarray(0, 64 * 1024), tempFilePath, sizeBytes: file.length });
    assert.equal(dims, null, 'fora do teto de leitura: desconhecida, o agendamento segue bloqueado');
  });
});

test('image-head (HM-3) — arquivo ausente ou ilegivel vira null (falha fechado), nunca excecao', async () => {
  const file = jpegWithPadding(3, 100, 100);
  const dims = await identifyImageDimensions({
    headerBuffer: file.subarray(0, 64 * 1024),
    tempFilePath: path.join(tmpdir(), `inexistente-${Date.now()}.tmp`),
    sizeBytes: file.length,
  });
  assert.equal(dims, null);
});

test('image-head (HM-3) — cabecalho que ja e o arquivo inteiro e invalido: null sem releitura', async () => {
  const lixo = Buffer.from('nao sou uma imagem');
  const dims = await identifyImageDimensions({
    headerBuffer: lixo,
    tempFilePath: path.join(tmpdir(), 'nao-deve-ser-aberto.tmp'),
    sizeBytes: lixo.length,
  });
  assert.equal(dims, null);
});

test('readFileHead (HM-3) — nunca devolve mais que maxBytes, mesmo com arquivo maior', async () => {
  const big = Buffer.alloc(3 * 1024 * 1024, 0x7a);
  await withTempFile(big, async (file) => {
    const head = await readFileHead(file, 200 * 1024);
    assert.equal(head.length, 200 * 1024);
    const smaller = await readFileHead(file, big.length + 999);
    assert.equal(smaller.length, big.length, 'limitado ao tamanho real quando menor que o teto');
    const zero = await readFileHead(file, 0);
    assert.equal(zero.length, 0);
  });
});

test('readStreamHead (HM-3) — consome apenas ate maxBytes e encerra o stream chamando destroy() sem ler o restante', async () => {
  let chunksProduced = 0;
  let streamDestroyed = false;
  const chunk = Buffer.alloc(64 * 1024, 0x41);
  const stream = new Readable({
    read() {
      chunksProduced++;
      this.push(chunk);
    },
    destroy(err, cb) {
      streamDestroyed = true;
      cb(err);
    },
  });

  const head = await readStreamHead(stream, 150 * 1024);
  assert.equal(head.length, 150 * 1024, 'devolve exatamente a cota requisitada');
  assert.ok(streamDestroyed, 'stream foi destruido ao atingir maxBytes');
  assert.ok(chunksProduced <= 4, 'produziu apenas os chunks necessarios para suprir a cota');
});

test('readStreamHead (HM-3) — stream menor que maxBytes e lido integralmente', async () => {
  const data = Buffer.from('pequeno stream');
  const stream = Readable.from([data]);
  const head = await readStreamHead(stream, 1024 * 1024);
  assert.deepEqual(head, data);
});

test('readStreamHead (HM-3) — maxBytes <= 0 devolve buffer vazio imediatamente e destroi o stream', async () => {
  let destroyed = false;
  const stream = new Readable({
    read() { this.push(Buffer.from('dados')); },
    destroy(err, cb) { destroyed = true; cb(err); },
  });
  const head = await readStreamHead(stream, 0);
  assert.equal(head.length, 0);
  assert.ok(destroyed);
});

test('readStreamHead (HM-3) — erro no stream rejeita a promise', async () => {
  const stream = new Readable({
    read() {
      this.destroy(new Error('falha de rede simulada'));
    },
  });
  await assert.rejects(readStreamHead(stream, 1024), /falha de rede simulada/);
});

test('readImageDimensionsFromStorage (HM-3) — le ate 1 MiB por stream, identifica dimensoes e garante cleanup', async () => {
  const file = jpegWithPadding(3, 4032, 3024); // ~192 KiB
  const mock = mockStorage({ streamContent: file, sizeBytes: file.length });

  const dims = await readImageDimensionsFromStorage(mock.storage, 'org/test/sha256/key', file.length);
  assert.deepEqual(dims, { width: 4032, height: 3024 });
  assert.equal(mock.getCalled, 0, 'storage.get() JAMAIS deve ser chamado');
  assert.equal(mock.openStreamCalled, 1, 'openStream foi chamado');
  assert.equal(mock.cleanupCalled, 1, 'cleanup foi invocado');
  assert.ok(mock.streamDestroyed, 'stream foi destruido');
});

test('readImageDimensionsFromStorage (HM-3) — imagem com metadados alem de 1 MiB: desconhecida (null), cleanup garantido, sem ler todo o stream', async () => {
  const segments = Math.ceil(IMAGE_DIMENSIONS_MAX_READ_BYTES / 0xffff) + 2;
  const file = jpegWithPadding(segments, 1000, 1000); // > 1 MiB antes do SOF
  const mock = mockStorage({ streamContent: file, sizeBytes: file.length });

  const dims = await readImageDimensionsFromStorage(mock.storage, 'org/test/sha256/key', file.length);
  assert.equal(dims, null, 'fora do teto: desconhecida (null)');
  assert.equal(mock.getCalled, 0, 'storage.get() nao foi chamado');
  assert.equal(mock.openStreamCalled, 1);
  assert.equal(mock.cleanupCalled, 1, 'cleanup garantido no finally');
  assert.ok(mock.streamDestroyed, 'stream destruido');
});

test('readImageDimensionsFromStorage (HM-3) — tamanho acima de 20 MB (PUBLISH_MAX_IMAGE_BYTES): rejeitado antecipadamente sem abrir stream', async () => {
  const mock = mockStorage({ streamContent: Buffer.alloc(100), sizeBytes: 25 * 1024 * 1024 });

  const dims = await readImageDimensionsFromStorage(mock.storage, 'org/test/sha256/key', 25 * 1024 * 1024);
  assert.equal(dims, null);
  assert.equal(mock.getCalled, 0);
  assert.equal(mock.openStreamCalled, 0, 'rejeitado antecipadamente sem I/O');
});

test('readImageDimensionsFromStorage (HM-3) — erro no openStream: devolve null (falha fechado) e cleanup', async () => {
  const mock = mockStorage({ streamError: new Error('S3 indisponivel') });

  const dims = await readImageDimensionsFromStorage(mock.storage, 'org/test/sha256/key', 1000);
  assert.equal(dims, null, 'falha no storage devolve null sem estourar excecao');
  assert.equal(mock.getCalled, 0);
  assert.equal(mock.openStreamCalled, 1);
});

test('ensureImageDimensions (HM-3) — NUNCA chama storage.get() para preencher dimensoes de imagens sem dimensoes', async () => {
  const file = jpegWithPadding(1, 1920, 1080);
  const mock = mockStorage({ streamContent: file, sizeBytes: file.length });

  const originalUpdateMany = prisma.contentMedia.updateMany;
  const updates: any[] = [];
  prisma.contentMedia.updateMany = (async (args: any) => {
    updates.push(args);
    return { count: 1 };
  }) as any;

  try {
    const pendingMedia = [
      {
        id: 'media-sem-dim-1',
        kind: 'IMAGE',
        storageKey: 'org/test-org/sha256/mock-sha-1',
        sizeBytes: file.length,
        widthPx: null,
        heightPx: null,
      },
    ];

    const result = await ensureImageDimensions(pendingMedia, () => mock.storage);

    assert.equal(mock.getCalled, 0, 'storage.get() PROIBIDO em ensureImageDimensions');
    assert.equal(mock.openStreamCalled, 1, 'abriu stream');
    assert.equal(mock.cleanupCalled, 1, 'executou cleanup');
    assert.equal(result.length, 1);
    assert.equal(result[0].widthPx, 1920);
    assert.equal(result[0].heightPx, 1080);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      where: { id: 'media-sem-dim-1', widthPx: null },
      data: { widthPx: 1920, heightPx: 1080 },
    });
  } finally {
    prisma.contentMedia.updateMany = originalUpdateMany;
  }
});

test('ensureImageDimensions (HM-3) — imagens que ja tem dimensoes ou sao de outro tipo nao acionam openStream', async () => {
  const mock = mockStorage({});

  const mediaList = [
    { id: 'm-com-dims', kind: 'IMAGE', storageKey: 'k1', sizeBytes: 500, widthPx: 1080, heightPx: 1080 },
    { id: 'm-video', kind: 'VIDEO', storageKey: 'k2', sizeBytes: 5000, widthPx: null, heightPx: null },
    { id: 'm-acima-20mb', kind: 'IMAGE', storageKey: 'k3', sizeBytes: 25 * 1024 * 1024, widthPx: null, heightPx: null },
  ];

  const result = await ensureImageDimensions(mediaList, () => mock.storage);

  assert.equal(mock.getCalled, 0);
  assert.equal(mock.openStreamCalled, 0, 'nenhum I/O disparado para arquivos fora do escopo');
  assert.deepEqual(result, mediaList);
});

test('ensureImageDimensions (HM-3) / Reabertura pos-upload — imagem com dimensoes fora do teto de 1 MiB permanece desconhecida (null), sem burlar limite no get()', async () => {
  const segments = Math.ceil(IMAGE_DIMENSIONS_MAX_READ_BYTES / 0xffff) + 2;
  const file = jpegWithPadding(segments, 1080, 1080); // metadados > 1 MiB antes do SOF
  const mock = mockStorage({ streamContent: file, sizeBytes: file.length });

  const originalUpdateMany = prisma.contentMedia.updateMany;
  let updateCalled = false;
  prisma.contentMedia.updateMany = (async () => {
    updateCalled = true;
    return { count: 0 };
  }) as any;

  try {
    const postUploadMedia = [
      {
        id: 'media-upload-grande',
        kind: 'IMAGE',
        storageKey: 'org/test-org/sha256/mock-sha-grande',
        sizeBytes: file.length,
        widthPx: null,
        heightPx: null,
      },
    ];

    // Simula a chamada que o get() subsequente ao upload executa atraves de withDimensions
    const result = await ensureImageDimensions(postUploadMedia, () => mock.storage);

    assert.equal(mock.getCalled, 0, 'storage.get() nao foi chamado');
    assert.equal(mock.openStreamCalled, 1, 'openStream foi chamado com leitura limitada');
    assert.equal(mock.cleanupCalled, 1, 'cleanup foi executado');
    assert.equal(updateCalled, false, 'banco nao foi atualizado com dimensoes');
    assert.equal(result[0].widthPx, null, 'dimensoes permanecem null (desconhecidas)');
    assert.equal(result[0].heightPx, null);
  } finally {
    prisma.contentMedia.updateMany = originalUpdateMany;
  }
});

test('Guard de codigo (HM-3) — content.service.ts nao le o arquivo temporario inteiro e ensureImageDimensions nao chama storage.get', async () => {
  const source = await readFile(path.join(here, '..', 'content.service.ts'), 'utf8');
  assert.ok(!/import\s*\{[^}]*\breadFile\b[^}]*\}\s*from\s*'node:fs(\/promises)?'/.test(source), 'readFile de node:fs nao deve ser importado');
  assert.ok(!/readFile\(\s*spooled/.test(source), 'sem readFile(spooled.tempFilePath)');
  assert.ok(!/readFile\(\s*[^)]*tempFilePath/.test(source), 'sem leitura integral do tempFilePath');
  assert.match(source, /identifyImageDimensions\(spooled\)/, 'usa a leitura limitada no upload');

  // Guard estrito sobre ensureImageDimensions
  const ensureIdx = source.indexOf('export async function ensureImageDimensions');
  assert.ok(ensureIdx !== -1, 'ensureImageDimensions deve existir');
  const ensureBody = source.slice(ensureIdx, source.indexOf('export interface ContentContext', ensureIdx));
  assert.ok(!ensureBody.includes('storage().get('), 'ensureImageDimensions NUNCA deve chamar storage().get(');
  assert.ok(!ensureBody.includes('storage.get('), 'ensureImageDimensions NUNCA deve chamar storage.get(');
  assert.match(ensureBody, /readImageDimensionsFromStorage/, 'ensureImageDimensions deve usar readImageDimensionsFromStorage');
});

