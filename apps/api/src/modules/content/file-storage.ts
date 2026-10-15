import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * F8-1 (D1, DEC-F8-002/003) - Abstracao de armazenamento de arquivos.
 *  - driver "local": EXCLUSIVO para desenvolvimento e testes; recusado em producao;
 *  - driver S3-compativel privado (HM-2, DEC-HML-003): bucket privado de qualquer fornecedor compativel (Cloudflare R2 preferencial),
 *    configurado so por variaveis de ambiente; integridade SHA-256 conferida na escrita e na leitura.
 *  - HM-3: o recebimento (upload) usa spool temporario em disco, sem buffer integral na heap; no S3 o envio usa PutObjectCommand
 *    com stream do arquivo temporario (nao ha multipart nem @aws-sdk/lib-storage). A leitura (download) do S3 NAO e streaming direto
 *    S3 -> socket: o objeto e baixado para um spool temporario em disco, o SHA-256 integral e conferido, e so entao o arquivo
 *    temporario e entregue por stream HTTP (bytes corrompidos ou incompletos nunca chegam ao cliente).
 * Chaves enderecadas por hash e isoladas por organizacao (storageKeyFor): escrita idempotente e imutavel.
 */
export interface PutFromPathOptions {
  sizeBytes: number;
  sha256: string;
  contentType?: string;
}

export interface StorageStreamResult {
  stream: NodeJS.ReadableStream;
  sizeBytes: number;
  cleanup?: () => Promise<void>;
}

export interface FileStorage {
  readonly driver: string;
  /** Grava o arquivo; se a chave ja existe (mesmo hash), nao reescreve. */
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Grava o arquivo a partir de arquivo temporario em disco sem carregar na memoria RAM. */
  putFromPath(key: string, filePath: string, options: PutFromPathOptions): Promise<void>;
  /**
   * Abre stream de leitura somente depois de conferir o SHA-256 INTEGRAL. No driver S3 isso implica baixar o objeto para um
   * spool temporario em disco antes da entrega (sem buffer integral na heap, mas sem streaming direto S3 -> socket).
   * O `cleanup` e idempotente; o spool tambem e removido quando o stream devolvido fecha (fim, erro ou destruicao).
   */
  openStream(key: string): Promise<StorageStreamResult>;
}

const KEY_PATTERN = /^org\/[0-9a-fA-F-]{8,64}\/sha256\/[0-9a-f]{64}$/;

/** Calcula o SHA-256 de um arquivo via streaming com consumo de memoria constante O(1). */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

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

  async putFromPath(key: string, filePath: string, options: PutFromPathOptions): Promise<void> {
    if (options.sha256 !== hashOfKey(key)) {
      throw new StorageIntegrityError('Conteúdo não corresponde ao hash da chave de armazenamento.');
    }
    const target = this.resolve(key);
    if (await this.exists(key)) return;
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    await copyFile(filePath, tmp);
    await rename(tmp, target);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async openStream(key: string): Promise<StorageStreamResult> {
    const full = this.resolve(key);
    let s;
    try {
      s = await stat(full);
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        const err = new Error('Arquivo não encontrado no armazenamento.') as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      throw e;
    }
    const digest = await computeFileSha256(full);
    if (digest !== hashOfKey(key)) {
      throw new StorageIntegrityError('Integridade do arquivo local corrompida (SHA-256 diverge da chave).');
    }
    return {
      stream: createReadStream(full),
      sizeBytes: s.size,
    };
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

/** A leitura do armazenamento terminou antes do fim do objeto (conexao fechada sem `end` nem `error`): nunca devolve bytes parciais. */
export class StorageStreamInterruptedError extends Error {
  constructor(message = 'Leitura do armazenamento interrompida antes do fim do objeto.') {
    super(message);
    this.name = 'StorageStreamInterruptedError';
  }
}

/**
 * Fecha o stream de arquivo (esperando o descritor realmente fechar, inclusive se a abertura ainda estiver em andamento)
 * e so entao apaga o arquivo. No Windows, apagar com o descritor aberto falha; em qualquer SO evita o arquivo orfao.
 */
async function closeThenUnlink(stream: ReadStream | WriteStream, filePath: string): Promise<void> {
  const closable: NodeJS.EventEmitter & { closed: boolean; destroy: () => unknown } = stream;
  await new Promise<void>((resolve) => {
    if (closable.closed) return resolve();
    closable.once('close', () => resolve());
    closable.destroy();
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await unlink(filePath);
      return;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return;
      if (attempt < 4 && (e?.code === 'EPERM' || e?.code === 'EBUSY')) {
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
    }
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
  /** `tempDir` so e trocado em testes (para inspecionar residuos); em producao e o diretorio temporario do SO. */
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
    private readonly prefix = '',
    private readonly tempDir = tmpdir()
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

  async putFromPath(key: string, filePath: string, options: PutFromPathOptions): Promise<void> {
    const Key = this.objectKey(key);
    if (options.sha256 !== hashOfKey(key)) {
      throw new StorageIntegrityError('Conteúdo não corresponde ao hash da chave de armazenamento.');
    }
    if (await this.exists(key)) return;
    const bodyStream = createReadStream(filePath);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key,
          Body: bodyStream,
          ContentType: options.contentType || 'application/octet-stream',
          ContentLength: options.sizeBytes,
          Metadata: { sha256: options.sha256 },
        })
      );
    } finally {
      // falha do envio (rede, credencial, permissao) nao pode deixar o descritor do arquivo temporario aberto
      bodyStream.destroy();
    }
  }

  async openStream(key: string): Promise<StorageStreamResult> {
    const Key = this.objectKey(key);
    let out;
    try {
      out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
    } catch (e) {
      if (isNotFound(e)) {
        const err = new Error('Arquivo não encontrado no armazenamento.') as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      throw e;
    }
    if (!out.Body) throw new Error('Resposta do armazenamento sem conteúdo.');

    // O objeto e baixado para spool temporario com `pipeline`: erro, destruicao ou `close` SEM `end` em qualquer ponto do
    // encadeamento rejeitam (ERR_STREAM_PREMATURE_CLOSE) e destroem todos os streams; nada fica pendurado nem sem apagar.
    const source = out.Body as Readable;
    const tmpPath = path.join(this.tempDir, `zafira-s3-dl-${randomUUID()}.tmp`);
    const writeStream = createWriteStream(tmpPath, { flags: 'wx' });
    const hash = createHash('sha256');
    let totalBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, meter, writeStream);
    } catch (err) {
      await closeThenUnlink(writeStream, tmpPath);
      if ((err as NodeJS.ErrnoException)?.code === 'ERR_STREAM_PREMATURE_CLOSE') throw new StorageStreamInterruptedError();
      throw err;
    }

    if (hash.digest('hex') !== hashOfKey(key)) {
      await closeThenUnlink(writeStream, tmpPath);
      throw new StorageIntegrityError('Conteúdo baixado do S3 não confere com o hash da chave.');
    }

    let readStream: ReadStream;
    try {
      readStream = createReadStream(tmpPath);
    } catch (err) {
      await closeThenUnlink(writeStream, tmpPath);
      throw err;
    }
    let cleanupPromise: Promise<void> | null = null;
    const cleanup = () => {
      if (!cleanupPromise) {
        cleanupPromise = closeThenUnlink(readStream, tmpPath);
      }
      return cleanupPromise;
    };
    // fim normal, erro ou destruicao pelo consumidor (cliente HTTP que desistiu): o spool e sempre removido
    readStream.once('close', () => {
      void cleanup();
    });
    return { stream: readStream, sizeBytes: totalBytes, cleanup };
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
