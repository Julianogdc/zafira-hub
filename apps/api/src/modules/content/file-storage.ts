import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * F8-1 (D1, DEC-F8-002/003) - Abstracao de armazenamento de arquivos.
 *  - driver "local": EXCLUSIVO para desenvolvimento e testes; recusado em producao;
 *  - driver S3-compativel privado (HM-2, DEC-HML-003): bucket privado de qualquer fornecedor compativel (Cloudflare R2 preferencial),
 *    configurado so por variaveis de ambiente; integridade SHA-256 conferida na escrita e na leitura.
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
  constructor(message = 'O armazenamento de arquivos não está configurado neste ambiente.') {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}

/** Conteudo lido ou gravado diverge do hash da chave (corrupcao ou troca de objeto): nunca devolve os bytes. */
export class StorageIntegrityError extends Error {
  constructor(message = 'Integridade do arquivo não confere (SHA-256 diferente do registrado).') {
    super(message);
    this.name = 'StorageIntegrityError';
  }
}

/** O hash SHA-256 da chave (ultimo segmento). A chave ja foi validada por KEY_PATTERN. */
const hashOfKey = (key: string) => key.slice(key.lastIndexOf('/') + 1);
const sha256Hex = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

type S3Like = Pick<S3Client, 'send'>;

const isNotFound = (e: unknown) => {
  const x = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return x?.name === 'NotFound' || x?.name === 'NoSuchKey' || x?.Code === 'NoSuchKey' || x?.$metadata?.httpStatusCode === 404;
};

/**
 * Driver S3-compativel (Cloudflare R2, AWS S3, MinIO, Garage...). Bucket PRIVADO: o acesso aos arquivos e sempre
 * mediado pela API (sessao, carteira ou link de aprovacao); nenhum URL pre-assinado e emitido.
 * Mesmas chaves do driver local (org/<organizacao>/sha256/<hash>), com prefixo opcional por ambiente.
 * Escrita idempotente e imutavel (HEAD antes de PUT; mesma chave = mesmos bytes). Sem exclusao.
 */
export class S3FileStorage implements FileStorage {
  readonly driver = 's3';
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
    private readonly prefix = ''
  ) {}

  private objectKey(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Chave de arquivo invalida.');
    return `${this.prefix}${key}`;
  }

  async exists(key: string): Promise<boolean> {
    const Key = this.objectKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e; // credencial, rede ou permissao: nunca vira "nao existe"
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const Key = this.objectKey(key);
    // a chave e o hash do conteudo: nunca grava bytes que nao correspondam a ela
    const digest = sha256Hex(data);
    if (digest !== hashOfKey(key)) throw new StorageIntegrityError('Conteúdo não corresponde ao hash da chave de armazenamento.');
    if (await this.exists(key)) return;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key,
        Body: data,
        ContentType: 'application/octet-stream',
        ContentLength: data.length,
        Metadata: { sha256: digest },
      })
    );
  }

  async get(key: string): Promise<Buffer> {
    const Key = this.objectKey(key);
    let out;
    try {
      out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
    } catch (e) {
      if (isNotFound(e)) {
        const err = new Error('Arquivo não encontrado no armazenamento.') as Error & { code: string };
        err.code = 'ENOENT'; // mesmo codigo do driver local
        throw err;
      }
      throw e;
    }
    if (!out.Body) throw new Error('Resposta do armazenamento sem conteúdo.');
    const bytes = Buffer.from(await out.Body.transformToByteArray());
    if (sha256Hex(bytes) !== hashOfKey(key)) throw new StorageIntegrityError();
    return bytes;
  }
}

export interface S3StorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
}

/**
 * Le e valida a configuracao S3 do ambiente (somente variaveis de ambiente; nada e lido de arquivo nem do banco).
 * As mensagens de erro nunca incluem valores de credenciais.
 */
export function readS3Config(env: NodeJS.ProcessEnv): S3StorageConfig {
  const production = env.NODE_ENV === 'production';
  const need = (name: string) => {
    const v = (env[name] ?? '').trim();
    if (!v) throw new StorageNotConfiguredError(`Armazenamento S3 não configurado: variável ${name} ausente.`);
    return v;
  };
  const bucket = need('FILE_STORAGE_S3_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new StorageNotConfiguredError('Armazenamento S3 não configurado: nome de bucket inválido.');
  }
  const accessKeyId = need('FILE_STORAGE_S3_ACCESS_KEY_ID');
  const secretAccessKey = need('FILE_STORAGE_S3_SECRET_ACCESS_KEY');
  const endpointRaw = (env.FILE_STORAGE_S3_ENDPOINT ?? '').trim();
  let endpoint: string | undefined;
  if (endpointRaw) {
    let u: URL;
    try {
      u = new URL(endpointRaw);
    } catch {
      throw new StorageNotConfiguredError('Armazenamento S3 não configurado: endpoint inválido.');
    }
    const insecureAllowed = env.FILE_STORAGE_S3_ALLOW_INSECURE === 'true';
    if (insecureAllowed && production) {
      throw new StorageNotConfiguredError('Armazenamento S3 inseguro (http) não é permitido em produção.');
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && insecureAllowed)) {
      throw new StorageNotConfiguredError('Armazenamento S3 não configurado: o endpoint deve usar https.');
    }
    if (u.username || u.password) {
      throw new StorageNotConfiguredError('Armazenamento S3 não configurado: o endpoint não pode conter credenciais.');
    }
    endpoint = u.origin;
  } else if (production && (env.FILE_STORAGE_S3_REGION ?? '').trim() === '') {
    throw new StorageNotConfiguredError('Armazenamento S3 não configurado: informe o endpoint ou a região.');
  }
  const region = (env.FILE_STORAGE_S3_REGION ?? '').trim() || 'auto';
  let prefix = (env.FILE_STORAGE_S3_PREFIX ?? '').trim().replace(/^\/+/, '');
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  if (prefix && !/^[A-Za-z0-9._/-]+$/.test(prefix)) {
    throw new StorageNotConfiguredError('Armazenamento S3 não configurado: prefixo inválido.');
  }
  // Com endpoint proprio o padrao e estilo de caminho (compativel com R2, MinIO e emuladores); FILE_STORAGE_S3_FORCE_PATH_STYLE=false desliga.
  const forcePathStyle = (env.FILE_STORAGE_S3_FORCE_PATH_STYLE ?? '').trim() === 'false' ? false : Boolean(endpoint);
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, prefix };
}

let cachedS3: { signature: string; storage: S3FileStorage } | null = null;

function buildS3Storage(env: NodeJS.ProcessEnv): S3FileStorage {
  const cfg = readS3Config(env);
  const signature = createHash('sha256')
    .update(JSON.stringify([cfg.endpoint, cfg.region, cfg.bucket, cfg.accessKeyId, cfg.secretAccessKey, cfg.prefix, cfg.forcePathStyle]))
    .digest('hex');
  if (cachedS3?.signature === signature) return cachedS3.storage;
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Compatibilidade com R2 e outros S3-compativeis: nao enviar nem validar checksums opcionais (CRC32 por padrao nas versoes recentes do SDK)
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
  const storage = new S3FileStorage(client, cfg.bucket, cfg.prefix);
  cachedS3 = { signature, storage };
  return storage;
}

/**
 * Seleciona o driver pelo ambiente. Em producao o driver local e recusado (nao e solucao definitiva).
 * FILE_STORAGE_DRIVER=local (padrao fora de producao) | s3 (S3-compativel; ver readS3Config).
 */
export function resolveFileStorage(env: NodeJS.ProcessEnv = process.env): FileStorage {
  const production = env.NODE_ENV === 'production';
  const driver = (env.FILE_STORAGE_DRIVER ?? (production ? '' : 'local')).toLowerCase();
  if (driver === 'local' && !production) {
    return new LocalFileStorage(env.FILE_STORAGE_LOCAL_DIR || path.join(tmpdir(), 'zafira-hub-files'));
  }
  if (driver === 's3') return buildS3Storage(env);
  throw new StorageNotConfiguredError();
}
