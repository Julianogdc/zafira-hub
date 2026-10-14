import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startFakeS3, type FakeS3 } from '../../../lib/__tests__/support/fake-s3-server.js';
import {
  LocalFileStorage,
  S3FileStorage,
  StorageIntegrityError,
  StorageNotConfiguredError,
  readS3Config,
  resolveFileStorage,
} from '../file-storage.js';

// HM-2 (DEC-HML-003): driver S3-compativel contra um emulador local; nenhum servico externo.

const ORG = '11111111-2222-4333-8444-555555555555';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const keyFor = (b: Buffer, org = ORG) => `org/${org}/sha256/${sha(b)}`;

const envFor = (s3: FakeS3, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  FILE_STORAGE_DRIVER: 's3',
  FILE_STORAGE_S3_ENDPOINT: s3.endpoint,
  FILE_STORAGE_S3_ALLOW_INSECURE: 'true',
  FILE_STORAGE_S3_REGION: 'auto',
  FILE_STORAGE_S3_BUCKET: s3.bucket,
  FILE_STORAGE_S3_ACCESS_KEY_ID: 'AKIATESTEXAMPLE0001',
  FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'segredo-de-teste-nao-real-0123456789',
  ...extra,
});

test('put, get e exists: ida e volta com o mesmo conteudo; assinatura SigV4 e sem checksums opcionais', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());
  const storage = resolveFileStorage(envFor(s3));
  assert.equal(storage.driver, 's3');
  const data = Buffer.from('conteudo-final-da-peca');
  const key = keyFor(data);

  assert.equal(await storage.exists(key), false);
  await storage.put(key, data);
  assert.equal(await storage.exists(key), true);
  assert.deepEqual(await storage.get(key), data);

  const put = s3.requests.find((r) => r.method === 'PUT')!;
  assert.equal(put.path, `/${s3.bucket}/${key}`, 'estilo de caminho, bucket e chave por organizacao');
  assert.ok(s3.requests.every((r) => r.hasSigV4), 'todas as chamadas assinadas');
  assert.match(put.credentialScope ?? '', /^\d{8}\/auto\/s3\/aws4_request$/);
  // compatibilidade com R2: nada de checksum opcional nem aws-chunked
  assert.deepEqual(put.checksumHeaders, []);
  assert.ok(!(put.contentEncoding ?? '').includes('aws-chunked'));
  assert.equal(put.bodyBytes, data.length);
  assert.equal(s3.objects.get(key)!.meta.sha256, sha(data), 'metadado com o SHA-256');
});

test('idempotencia: segunda gravacao da mesma chave nao reenvia o objeto', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());
  const storage = resolveFileStorage(envFor(s3));
  const data = Buffer.from('mesmo-conteudo');
  const key = keyFor(data);
  await storage.put(key, data);
  await storage.put(key, data);
  await storage.put(key, data);
  assert.equal(s3.count('PUT'), 1);
  assert.equal(s3.objects.size, 1);
});

test('integridade: conteudo que nao bate com o hash da chave nunca e gravado nem devolvido', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());
  const storage = resolveFileStorage(envFor(s3));
  const data = Buffer.from('original');
  const key = keyFor(data);
  await assert.rejects(storage.put(key, Buffer.from('outro-conteudo')), StorageIntegrityError);
  assert.equal(s3.count('PUT'), 0, 'nada enviado');
  await storage.put(key, data);
  s3.tamper(key); // adulteracao no provedor
  await assert.rejects(storage.get(key), StorageIntegrityError);
});

test('chave invalida e recusada antes de qualquer chamada; isolamento por organizacao nas chaves', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());
  const storage = resolveFileStorage(envFor(s3));
  for (const bad of ['../../etc/passwd', `org/${ORG}/sha256/xyz`, `org/${ORG}/../sha256/${'a'.repeat(64)}`, '/org/x']) {
    await assert.rejects(storage.get(bad), /Chave de arquivo invalida/);
    await assert.rejects(storage.exists(bad), /Chave de arquivo invalida/);
  }
  assert.equal(s3.requests.length, 0);
  const data = Buffer.from('mesmo-arquivo-duas-organizacoes');
  const other = '99999999-2222-4333-8444-555555555555';
  await storage.put(keyFor(data, ORG), data);
  assert.equal(await storage.exists(keyFor(data, other)), false, 'a outra organizacao nao enxerga o objeto');
});

test('arquivo inexistente: ENOENT (igual ao driver local); erro de acesso nunca vira "nao existe"', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());
  const storage = resolveFileStorage(envFor(s3));
  const key = keyFor(Buffer.from('nao-gravado'));
  await assert.rejects(storage.get(key), (e: any) => e.code === 'ENOENT');
  s3.denyAll = true;
  await assert.rejects(storage.exists(key), (e: any) => e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403);
  await assert.rejects(storage.get(key));
});

test('prefixo por ambiente e aplicado a todas as chaves', async (t) => {
  const s3 = await startFakeS3();
  t.after(() => s3.close());
  const storage = resolveFileStorage(envFor(s3, { FILE_STORAGE_S3_PREFIX: '/homologacao' }));
  const data = Buffer.from('com-prefixo');
  const key = keyFor(data);
  await storage.put(key, data);
  assert.ok(s3.objects.has(`homologacao/${key}`));
  assert.deepEqual(await storage.get(key), data);
});

test('driver S3 recebe o cliente por injecao (contrato da interface)', async () => {
  const sent: string[] = [];
  const fake = { send: async (cmd: { constructor: { name: string } }) => { sent.push(cmd.constructor.name); return {}; } };
  const storage = new S3FileStorage(fake as never, 'b', 'p/');
  assert.equal(await storage.exists(`org/${ORG}/sha256/${'a'.repeat(64)}`), true);
  assert.deepEqual(sent, ['HeadObjectCommand']);
});

test('configuracao: producao continua recusando o driver local; S3 exige bucket, credenciais e https', () => {
  // protecao existente preservada
  assert.throws(() => resolveFileStorage({ NODE_ENV: 'production' }), StorageNotConfiguredError);
  assert.throws(() => resolveFileStorage({ NODE_ENV: 'production', FILE_STORAGE_DRIVER: 'local' }), StorageNotConfiguredError);
  assert.ok(resolveFileStorage({ NODE_ENV: 'test' }) instanceof LocalFileStorage);

  const base = {
    NODE_ENV: 'production',
    FILE_STORAGE_DRIVER: 's3',
    FILE_STORAGE_S3_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
    FILE_STORAGE_S3_BUCKET: 'zafira-hml-files',
    FILE_STORAGE_S3_ACCESS_KEY_ID: 'AKIATESTEXAMPLE0001',
    FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'segredo-de-teste-nao-real-0123456789',
  } as NodeJS.ProcessEnv;
  assert.equal(resolveFileStorage(base).driver, 's3');
  const cfg = readS3Config(base);
  assert.deepEqual([cfg.region, cfg.forcePathStyle, cfg.prefix], ['auto', true, '']);

  const secret = base.FILE_STORAGE_S3_SECRET_ACCESS_KEY!;
  const bad: [Record<string, string | undefined>, RegExp][] = [
    [{ FILE_STORAGE_S3_BUCKET: undefined }, /FILE_STORAGE_S3_BUCKET/],
    [{ FILE_STORAGE_S3_ACCESS_KEY_ID: '' }, /ACCESS_KEY_ID/],
    [{ FILE_STORAGE_S3_SECRET_ACCESS_KEY: undefined }, /SECRET_ACCESS_KEY/],
    [{ FILE_STORAGE_S3_BUCKET: 'Nome Invalido!' }, /bucket inválido/],
    [{ FILE_STORAGE_S3_ENDPOINT: 'http://conta.r2.cloudflarestorage.com' }, /https/],
    [{ FILE_STORAGE_S3_ENDPOINT: 'nao-e-url' }, /endpoint inválido/],
    [{ FILE_STORAGE_S3_ENDPOINT: 'https://usuario:senha@host.exemplo' }, /credenciais/],
    [{ FILE_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000', FILE_STORAGE_S3_ALLOW_INSECURE: 'true' }, /produção/],
    [{ FILE_STORAGE_S3_PREFIX: 'a b/../c' }, /prefixo inválido/],
  ];
  for (const [patch, re] of bad) {
    const env = { ...base, ...patch } as NodeJS.ProcessEnv;
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete env[k];
    assert.throws(
      () => resolveFileStorage(env),
      (e: unknown) => e instanceof StorageNotConfiguredError && re.test(e.message) && !e.message.includes(secret) && !e.message.includes('AKIA'),
      JSON.stringify(patch)
    );
  }
  // http so fora de producao e com permissao explicita (emulador local)
  const dev = { ...base, NODE_ENV: 'test', FILE_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000', FILE_STORAGE_S3_ALLOW_INSECURE: 'true' } as NodeJS.ProcessEnv;
  assert.equal(resolveFileStorage(dev).driver, 's3');
});
