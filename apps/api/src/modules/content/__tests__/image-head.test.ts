import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_DIMENSIONS_MAX_READ_BYTES, identifyImageDimensions, readFileHead } from '../image-head.js';

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

test('Guard de codigo (HM-3) — content.service.ts nao le o arquivo temporario inteiro', async () => {
  const source = await readFile(path.join(here, '..', 'content.service.ts'), 'utf8');
  assert.ok(!/import\s*\{[^}]*\breadFile\b[^}]*\}\s*from\s*'node:fs(\/promises)?'/.test(source), 'readFile de node:fs nao deve ser importado');
  assert.ok(!/readFile\(\s*spooled/.test(source), 'sem readFile(spooled.tempFilePath)');
  assert.ok(!/readFile\(\s*[^)]*tempFilePath/.test(source), 'sem leitura integral do tempFilePath');
  assert.match(source, /identifyImageDimensions\(spooled\)/, 'usa a leitura limitada');
});
