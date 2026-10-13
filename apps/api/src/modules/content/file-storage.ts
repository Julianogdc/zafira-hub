import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * F8-1 (D1, DEC-F8-002/003) - Abstracao de armazenamento de arquivos.
 *  - driver "local": EXCLUSIVO para desenvolvimento e testes; recusado em producao;
 *  - driver S3-compativel privado: arquitetura prevista (provedor definido antes da homologacao); ainda nao implementado.
 * Chaves enderecadas por hash e isoladas por organizacao (storageKeyFor): escrita idempotente e imutavel.
 */
export interface FileStorage {
  readonly driver: string;
  /** Grava o arquivo; se a chave ja existe (mesmo hash), nao reescreve. */
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

const KEY_PATTERN = /^org\/[0-9a-fA-F-]{8,64}\/sha256\/[0-9a-f]{64}$/;

export class LocalFileStorage implements FileStorage {
  readonly driver = 'local';
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Chave de arquivo invalida.');
    const full = path.resolve(this.baseDir, ...key.split('/'));
    if (!full.startsWith(path.resolve(this.baseDir) + path.sep)) throw new Error('Chave de arquivo invalida.');
    return full;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    if (await this.exists(key)) return;
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, data, { flag: 'wx' });
    await rename(tmp, target);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('O armazenamento de arquivos não está configurado neste ambiente.');
    this.name = 'StorageNotConfiguredError';
  }
}

/**
 * Seleciona o driver pelo ambiente. Em producao o driver local e recusado (nao e solucao definitiva).
 * FILE_STORAGE_DRIVER=local (padrao fora de producao) | s3 (previsto, ainda nao implementado).
 */
export function resolveFileStorage(env: NodeJS.ProcessEnv = process.env): FileStorage {
  const production = env.NODE_ENV === 'production';
  const driver = (env.FILE_STORAGE_DRIVER ?? (production ? '' : 'local')).toLowerCase();
  if (driver === 'local' && !production) {
    return new LocalFileStorage(env.FILE_STORAGE_LOCAL_DIR || path.join(tmpdir(), 'zafira-hub-files'));
  }
  throw new StorageNotConfiguredError();
}
