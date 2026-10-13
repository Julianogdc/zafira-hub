import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalFileStorage, StorageNotConfiguredError, resolveFileStorage } from '../file-storage.js';

const KEY = `org/11111111-1111-4111-8111-111111111111/sha256/${'a'.repeat(64)}`;

test('driver local grava de forma idempotente e le de volta', async () => {
  const storage = new LocalFileStorage(mkdtempSync(path.join(tmpdir(), 'zafira-fs-')));
  assert.equal(await storage.exists(KEY), false);
  await storage.put(KEY, Buffer.from('conteudo-1'));
  await storage.put(KEY, Buffer.from('conteudo-2')); // mesma chave (mesmo hash): nao reescreve
  assert.equal((await storage.get(KEY)).toString(), 'conteudo-1');
  assert.equal(await storage.exists(KEY), true);
});

test('chaves fora do padrao ou com traversal sao recusadas', async () => {
  const storage = new LocalFileStorage(mkdtempSync(path.join(tmpdir(), 'zafira-fs-')));
  for (const key of ['../../etc/passwd', 'org/x/sha256/zz', `org/../sha256/${'a'.repeat(64)}`, '/abs/path']) {
    await assert.rejects(storage.get(key), /invalida/);
  }
});

test('driver local e recusado em producao; fora dela e o padrao; s3 ainda nao implementado', () => {
  assert.throws(() => resolveFileStorage({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), StorageNotConfiguredError);
  assert.throws(() => resolveFileStorage({ NODE_ENV: 'production', FILE_STORAGE_DRIVER: 'local' } as NodeJS.ProcessEnv), StorageNotConfiguredError);
  assert.throws(() => resolveFileStorage({ NODE_ENV: 'development', FILE_STORAGE_DRIVER: 's3' } as NodeJS.ProcessEnv), StorageNotConfiguredError);
  assert.equal(resolveFileStorage({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).driver, 'local');
  assert.equal(resolveFileStorage({ NODE_ENV: 'test', FILE_STORAGE_LOCAL_DIR: tmpdir() } as NodeJS.ProcessEnv).driver, 'local');
});
