import { open } from 'node:fs/promises';
import { imageDimensions } from '@zafira/domain';

/**
 * HM-3 (ajuste complementar) - Dimensoes de imagem por leitura LIMITADA do inicio do arquivo.
 * Nunca le o arquivo inteiro: o teto de leitura e fixo (IMAGE_DIMENSIONS_MAX_READ_BYTES), mesmo para arquivos de 100 MiB.
 * Quando as dimensoes nao puderem ser identificadas com seguranca dentro desse teto, devolve null (desconhecidas):
 * quem chama grava os campos como nulos e o agendamento continua bloqueado (imagePixelProblem falha fechado).
 */

/** Teto da leitura adicional do cabecalho em disco (JPEG com EXIF/miniatura grande antes do marcador SOF). */
export const IMAGE_DIMENSIONS_MAX_READ_BYTES = 1024 * 1024; // 1 MiB

/** Le no maximo `maxBytes` a partir do inicio do arquivo, em um unico buffer limitado. */
export async function readFileHead(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.max(0, Math.min(size, maxBytes));
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export interface ImageHeadSource {
  /** Primeiros bytes ja capturados durante o recebimento (ate 64 KiB). */
  headerBuffer: Buffer;
  tempFilePath: string;
  sizeBytes: number;
}

/**
 * 1) tenta o cabecalho ja em memoria; 2) se nao bastar e o arquivo for maior que ele, le ate
 * IMAGE_DIMENSIONS_MAX_READ_BYTES do inicio do arquivo temporario; 3) senao, desconhecida (null).
 */
export async function identifyImageDimensions(source: ImageHeadSource): Promise<ReturnType<typeof imageDimensions>> {
  const fromHeader = imageDimensions(source.headerBuffer);
  if (fromHeader) return fromHeader;
  if (source.headerBuffer.length >= source.sizeBytes) return null; // o cabecalho ja era o arquivo inteiro
  try {
    const head = await readFileHead(source.tempFilePath, Math.min(source.sizeBytes, IMAGE_DIMENSIONS_MAX_READ_BYTES));
    return imageDimensions(head);
  } catch {
    return null; // leitura falhou: segue desconhecida (bloqueia o agendamento, nunca libera)
  }
}
