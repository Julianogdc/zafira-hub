import { open } from 'node:fs/promises';
import { imageDimensions, PUBLISH_MAX_IMAGE_BYTES } from '@zafira/domain';
import type { FileStorage, StorageStreamResult } from './file-storage.js';

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

/**
 * Le no maximo `maxBytes` de um stream de leitura, encerrando-o assim que atingir a cota
 * sem esgotar o restante do fluxo nem acumular dados excedentes na memoria.
 */
export async function readStreamHead(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  if (maxBytes <= 0) {
    if (typeof (stream as any).destroy === 'function') {
      (stream as any).destroy();
    }
    return Buffer.alloc(0);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        reject(err);
      } else {
        const full = Buffer.concat(chunks);
        resolve(full.length > maxBytes ? full.subarray(0, maxBytes) : full);
      }
    };

    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
      if (total >= maxBytes) {
        if (typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
        finish();
      }
    };

    const onEnd = () => finish();
    const onClose = () => finish();
    const onError = (err: Error) => finish(err);

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('close', onClose);

    if (typeof (stream as any).resume === 'function') {
      (stream as any).resume();
    }
  });
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

/**
 * HM-3 (ajuste complementar) - Identifica dimensoes de imagem armazenada atraves de stream
 * limitado a no maximo IMAGE_DIMENSIONS_MAX_READ_BYTES (1 MiB).
 * Nunca le o arquivo integralmente em memoria (evita buffers de ate 20 MB na heap).
 * Se o arquivo for ilegivel, corrompido, exceder 20 MB ou as dimensoes nao forem encontradas dentro de 1 MiB,
 * devolve null (desconhecidas), garantindo fail closed (agendamento bloqueado).
 * O spool temporario (no caso do S3) ou o descritor de arquivo e sempre liberado via cleanup/destroy.
 */
export async function readImageDimensionsFromStorage(
  storage: FileStorage,
  storageKey: string,
  sizeBytes?: number
): Promise<ReturnType<typeof imageDimensions>> {
  if (sizeBytes !== undefined && sizeBytes > PUBLISH_MAX_IMAGE_BYTES) {
    return null;
  }

  let opened: StorageStreamResult | null = null;
  try {
    opened = await storage.openStream(storageKey);
    const maxToRead = Math.min(opened.sizeBytes, IMAGE_DIMENSIONS_MAX_READ_BYTES);
    const head = await readStreamHead(opened.stream, maxToRead);
    return imageDimensions(head);
  } catch {
    return null; // armazenamento indisponivel, chave inexistente ou stream quebrado: segue desconhecida
  } finally {
    if (opened) {
      if (typeof (opened.stream as any).destroy === 'function') {
        (opened.stream as any).destroy();
      }
      if (opened.cleanup) {
        try {
          await opened.cleanup();
        } catch {
          // limpeza silenciosa de spool temporario
        }
      }
    }
  }
}

