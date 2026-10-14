import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// F8-5p.4 (DEC-F8-031, P37): nenhuma tela chama as escritas legadas do social-publisher (as rotas respondem 410).
const SRC = path.resolve(process.cwd(), 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

test('sem chamadas a upload, criacao, agendamento ou cancelamento legados', () => {
  const forbidden = [/\/api\/v1\/social\/upload/, /social\/content\/\$\{[^}]+\}\/schedule/, /social\/content\/\$\{[^}]+\}\/cancel/, /social\/content`,\s*payload/];
  const hits = files(SRC).flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    return forbidden.filter((re) => re.test(text)).map((re) => `${path.relative(SRC, f)} ${re}`);
  });
  assert.deepEqual(hits, []);
});

test('vinculo e desvinculo de contas e leitura legada continuam disponiveis', () => {
  const svc = readFileSync(path.join(SRC, 'services', 'social-publisher.ts'), 'utf8');
  for (const m of ['linkAccount', 'unlinkAccount', 'getClientAccounts', 'getAllClientContent', 'getClientPost']) assert.ok(svc.includes(`async ${m}(`), m);
});
