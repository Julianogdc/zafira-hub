/**
 * F8-5p.1 (DEC-F8-031, P35) - Largura e altura de imagens a partir do cabecalho (JPEG, PNG, WebP).
 * Puro, sem dependencias: opera sobre bytes. Retorna null quando nao for possivel ler com seguranca
 * (arquivo truncado, cabecalho invalido ou dimensao zero) - quem chama trata nulo como "desconhecido".
 * Limite do provedor observado na F8-0b (U9): acima de 30 megapixels a imagem e recusada.
 */

export const PUBLISH_MAX_IMAGE_PIXELS = 30_000_000;

export interface ImageDimensions {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
const ok = (width: number, height: number): ImageDimensions | null =>
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;

/** Marcadores SOF (inicio de quadro) que carregam as dimensoes; exclui DHT (C4), JPG (C8) e DAC (CC). */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  let i = 2; // depois de FFD8
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null; // fora de sincronia: nao adivinha
    let marker = b[i + 1];
    while (marker === 0xff && i + 2 < b.length) {
      i += 1; // bytes de preenchimento
      marker = b[i + 1];
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fim da imagem ou dados antes de achar o quadro
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2; // marcadores sem tamanho
      continue;
    }
    if (i + 3 >= b.length) return null;
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (i + 8 >= b.length) return null;
      return ok(u16be(b, i + 7), u16be(b, i + 5));
    }
    i += 2 + len;
  }
  return null;
}

function pngDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return ok(u32be(b, 16), u32be(b, 20));
}

function webpDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  return null;
}

/** Dimensoes pelo conteudo real (a extensao e o tipo declarado sao ignorados). */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpegDimensions(bytes);
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return pngDimensions(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpDimensions(bytes);
  return null;
}

export type ImagePixelProblemCode = 'MEDIA_DIMENSIONS_UNKNOWN' | 'MEDIA_TOO_MANY_PIXELS';

/** Problema de publicacao de uma imagem pelas dimensoes; null quando dentro do limite. Desconhecido falha fechado. */
export function imagePixelProblem(dims: { widthPx: number | null | undefined; heightPx: number | null | undefined }): {
  code: ImagePixelProblemCode;
  message: string;
} | null {
  const { widthPx: w, heightPx: h } = dims;
  if (!w || !h || w <= 0 || h <= 0) {
    return { code: 'MEDIA_DIMENSIONS_UNKNOWN', message: 'Não foi possível ler as dimensões da imagem. Reenvie o arquivo em JPG, PNG ou WebP.' };
  }
  if (w * h > PUBLISH_MAX_IMAGE_PIXELS) {
    return {
      code: 'MEDIA_TOO_MANY_PIXELS',
      message: `Imagem de ${w}×${h} (${(Math.round((w * h) / 100_000) / 10).toLocaleString('pt-BR')} MP) acima do limite de 30 megapixels do provedor de publicação.`,
    };
  }
  return null;
}
