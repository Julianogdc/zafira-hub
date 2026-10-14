import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLISH_MAX_IMAGE_PIXELS, imageDimensions, imagePixelProblem } from '../content/image-dimensions.js';
import { validatePublicationContent } from '../content/publication-model.js';

// F8-5p.1 (DEC-F8-031, P35): dimensoes pelo cabecalho e limite de 30 megapixels.

const bytes = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function jpeg(width: number, height: number, sof = 0xc0, exifBytes = 0) {
  const app1 = exifBytes ? [0xff, 0xe1, ...be16(exifBytes + 2), ...new Array(exifBytes).fill(0x45)] : [];
  const dht = [0xff, 0xc4, ...be16(4), 0x00, 0x00]; // C4 nao e quadro: deve ser ignorado
  const frame = [0xff, sof, ...be16(17), 8, ...be16(height), ...be16(width), 3, ...new Array(9).fill(1)];
  return bytes([0xff, 0xd8], [0xff, 0xff, 0xe0, ...be16(4), 0, 0], app1, dht, frame, [0xff, 0xda, 0, 2, 0xff, 0xd9]);
}
function png(width: number, height: number) {
  return bytes([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(width), be32(height), [8, 6, 0, 0, 0]);
}
function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number) {
  const head = bytes(ascii('RIFF'), be32(0), ascii('WEBP'), ascii(kind), le24(10), [0]);
  if (kind === 'VP8X') return bytes(head, [0, 0, 0, 0], le24(width - 1), le24(height - 1));
  if (kind === 'VP8L') {
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    return bytes(head, [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff], [0, 0, 0, 0, 0]);
  }
  return bytes(head, [0, 0, 0], [0x9d, 0x01, 0x2a], le16(width), le16(height), [0, 0]);
}

test('JPEG: SOF0 e SOF2 (progressivo), depois de EXIF grande e de preenchimento; DHT ignorado', () => {
  assert.deepEqual(imageDimensions(jpeg(1080, 1350)), { width: 1080, height: 1350 });
  assert.deepEqual(imageDimensions(jpeg(4000, 3000, 0xc2, 60_000)), { width: 4000, height: 3000 });
});

test('PNG e WebP (VP8, VP8L, VP8X)', () => {
  assert.deepEqual(imageDimensions(png(6000, 6000)), { width: 6000, height: 6000 });
  assert.deepEqual(imageDimensions(webp('VP8 ', 1080, 1920)), { width: 1080, height: 1920 });
  assert.deepEqual(imageDimensions(webp('VP8L', 2048, 1536)), { width: 2048, height: 1536 });
  assert.deepEqual(imageDimensions(webp('VP8X', 7000, 5000)), { width: 7000, height: 5000 });
});

test('truncado, invalido, dimensao zero ou formato desconhecido: nulo (nunca adivinha)', () => {
  const full = jpeg(1080, 1350, 0xc0, 2000);
  assert.equal(imageDimensions(full.slice(0, 1500)), null, 'cortado dentro do EXIF');
  assert.equal(imageDimensions(png(100, 100).slice(0, 20)), null);
  assert.equal(imageDimensions(png(0, 100)), null);
  assert.equal(imageDimensions(webp('VP8 ', 100, 100).slice(0, 25)), null);
  assert.equal(imageDimensions(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2])), null, 'dados antes de qualquer quadro');
  assert.equal(imageDimensions(bytes(ascii('GIF89a'), [1, 0, 1, 0])), null);
  assert.equal(imageDimensions(new Uint8Array()), null);
});

test('limite exato de 30 MP aceito; um pixel a mais recusado; desconhecido recusado', () => {
  assert.equal(PUBLISH_MAX_IMAGE_PIXELS, 30_000_000);
  assert.equal(imagePixelProblem({ widthPx: 6000, heightPx: 5000 }), null);
  assert.equal(imagePixelProblem({ widthPx: 30_000_001, heightPx: 1 })?.code, 'MEDIA_TOO_MANY_PIXELS');
  assert.match(imagePixelProblem({ widthPx: 6000, heightPx: 6000 })?.message ?? '', /6000×6000/);
  assert.equal(imagePixelProblem({ widthPx: null, heightPx: 100 })?.code, 'MEDIA_DIMENSIONS_UNKNOWN');
  assert.equal(imagePixelProblem({ widthPx: undefined, heightPx: undefined })?.code, 'MEDIA_DIMENSIONS_UNKNOWN');
});

test('agendamento: imagem acima do limite ou sem dimensoes bloqueia; video nao exige dimensoes', () => {
  const base = { format: 'FEED_IMAGE' as const, caption: 'x' };
  const img = (w: number | null, h: number | null) => ({ kind: 'IMAGE' as const, mimeType: 'image/jpeg', sizeBytes: 1000, widthPx: w, heightPx: h });
  assert.deepEqual(validatePublicationContent({ ...base, media: [img(6000, 5000)] }), []);
  assert.equal(validatePublicationContent({ ...base, media: [img(6000, 6000)] })[0]?.code, 'MEDIA_TOO_MANY_PIXELS');
  assert.equal(validatePublicationContent({ ...base, media: [img(null, null)] })[0]?.code, 'MEDIA_DIMENSIONS_UNKNOWN');
  const reel = validatePublicationContent({ format: 'REEL', caption: 'x', media: [{ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 1000 }] });
  assert.deepEqual(reel, []);
});

// F8-5p.4 (DEC-F8-031, P37): o aviso reflete os limites e nao sugere homologacao que nao houve.
import { PUBLISH_COMPATIBILITY_NOTE } from '../content/content-model.js';
test('aviso de publicacao: limites tecnicos e formatos ainda sem publicacao real', () => {
  for (const t of ['JPG, PNG, WebP ou MP4', '20 MB', '30 megapixels', '1 GB', 'MOV ainda não verificado', 'Nem todos os formatos foram homologados']) {
    assert.ok(PUBLISH_COMPATIBILITY_NOTE.includes(t), t);
  }
  assert.ok(!/homologad[oa] para publica/i.test(PUBLISH_COMPATIBILITY_NOTE));
});
