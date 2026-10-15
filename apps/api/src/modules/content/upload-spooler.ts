import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import { ContentError } from './content.service.js';

export interface SpooledUpload {
  readonly tempFilePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly filename: string;
  readonly headerBuffer: Buffer;
  cleanup: () => Promise<void>;
}

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MiB (104.857.600 bytes)
const HEADER_CAPTURE_BYTES = 64 * 1024; // 64 KiB para deteccao de tipo e dimensoes sem carregar o arquivo na heap

/**
 * HM-3 - Recebe upload multipart via streaming direto para spool temporario em disco.
 * Evita carregar arquivos de ate 100 MiB integralmente na memoria (heap) da API.
 * Calcula SHA-256 e tamanho de forma incremental com backpressure e limpeza garantida.
 *
 * Ajuste complementar: o arquivo temporario so e criado DEPOIS de confirmado que o stream nao chegou truncado
 * (nada para limpar nesse caso) e o cleanup espera o descritor fechar antes do unlink (a abertura de um
 * WriteStream e assincrona: sem isso, um unlink precoce deixaria o arquivo criado depois, orfao).
 * `options.tempDir` existe para os testes inspecionarem residuos; em producao e o diretorio temporario do SO.
 */
export async function spoolMultipartUpload(
  multipartFile: MultipartFile,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
  options: { tempDir?: string } = {}
): Promise<SpooledUpload> {
  if (!multipartFile || !multipartFile.file) {
    throw new ContentError(400, 'FILE_REQUIRED', 'Nenhum arquivo enviado.');
  }

  const fileStream = multipartFile.file;

  const isTruncated = () =>
    Boolean(
      (multipartFile as any)?.truncated ||
      (multipartFile.file as any)?.truncated ||
      (fileStream as any)?.truncated
    );

  // Antes de qualquer recurso em disco: stream ja truncado nao cria temp, nao abre descritor e e descartado.
  if (isTruncated()) {
    fileStream.resume();
    throw new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.');
  }

  const tempFilePath = path.join(options.tempDir ?? tmpdir(), `zafira-up-${randomUUID()}.tmp`);
  const writeStream = createWriteStream(tempFilePath, { flags: 'wx' });
  const hash = createHash('sha256');

  let totalBytes = 0;
  const headerChunks: Buffer[] = [];
  let capturedHeaderBytes = 0;
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    // espera o descritor fechar (inclusive se a abertura ainda estiver em andamento) antes de apagar
    await new Promise<void>((resolve) => {
      if (writeStream.closed) return resolve();
      writeStream.once('close', () => resolve());
      writeStream.destroy();
    });
    await unlink(tempFilePath).catch(() => {});
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let aborted = false;

      const abortWith = (err: Error) => {
        if (aborted) return;
        aborted = true;
        fileStream.destroy();
        writeStream.destroy();
        cleanup().finally(() => reject(err));
      };

      fileStream.on('limit', () => {
        abortWith(new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.'));
      });

      fileStream.on('data', (chunk: Buffer) => {
        if (aborted) return;

        totalBytes += chunk.length;
        if (totalBytes > maxBytes || isTruncated()) {
          abortWith(new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.'));
          return;
        }

        hash.update(chunk);

        if (capturedHeaderBytes < HEADER_CAPTURE_BYTES) {
          const needed = HEADER_CAPTURE_BYTES - capturedHeaderBytes;
          const toCapture = chunk.length > needed ? chunk.subarray(0, needed) : chunk;
          headerChunks.push(Buffer.from(toCapture));
          capturedHeaderBytes += toCapture.length;
        }

        if (!writeStream.write(chunk)) {
          fileStream.pause();
          writeStream.once('drain', () => {
            if (!aborted) fileStream.resume();
          });
        }
      });

      fileStream.on('end', () => {
        if (aborted) return;
        if (isTruncated() || totalBytes > maxBytes) {
          abortWith(new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.'));
          return;
        }
        writeStream.end(() => resolve());
      });

      fileStream.on('error', (err) => {
        abortWith(err);
      });

      fileStream.on('close', () => {
        // Se fechou sem disparar 'end' e ainda nao terminou
        if (!writeStream.writableEnded && !aborted) {
          if (isTruncated()) {
            abortWith(new ContentError(413, 'FILE_TOO_LARGE', 'O arquivo excede o limite de 100 MB.'));
          } else {
            abortWith(new ContentError(400, 'UPLOAD_INTERRUPTED', 'Upload interrompido pelo cliente.'));
          }
        }
      });

      writeStream.on('error', (err) => {
        abortWith(err);
      });
    });

    const sha256 = hash.digest('hex');
    const headerBuffer = Buffer.concat(headerChunks);

    return {
      tempFilePath,
      sizeBytes: totalBytes,
      sha256,
      filename: String(multipartFile.filename || 'arquivo'),
      headerBuffer,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
