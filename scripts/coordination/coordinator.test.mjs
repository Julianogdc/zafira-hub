import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXECUTION_ENABLED, readPolicy, chooseTask, chooseAgent, inspectRepository, acquireLease, releaseLease,
  requestStop, resetStop, checkpoint, simulate, officialContext, runtimeFor } from './coordinator.mjs';

const moduleUrl = new URL('./coordinator.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('./coordinator.mjs', import.meta.url));
const baseTask = { id: 'GOV-MA-READ', status: 'ready', kind: 'read-only', objective: 'Auditoria ficticia',
  decision: 'DEC-GOV-008', ownerDecisionRequired: false, dependsOn: [], requiredGates: [] };
const policy = (tasks = [baseTask]) => ({ version: 1, applicationBaseline: 'aaaaaaa', homologationBaseline: 'bbbbbbb', tasks: structuredClone(tasks) });
const block = (p) => '```zafira-coordination\n' + JSON.stringify(p) + '\n```';
const register = '### DEC-GOV-008 — Teste\nAutorizacao ficticia.\n';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zafira-coordination-test-'));
  t.after(() => {
    assert.ok(path.basename(root).startsWith('zafira-coordination-test-'));
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function repository(t) {
  const root = temporary(t);
  const emptyConfig = path.join(root, 'empty-global-config'); fs.writeFileSync(emptyConfig, '');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: '0' } }).trim();
  const write = (p, value) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), value); };
  git('init', '-b', 'hub-2.1'); git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'coordinator@zafira.invalid');
  write('.gitignore', '.zafira-context/coordination-*/\n');
  write('application.txt', 'synthetic\n'); git('add', '.'); git('commit', '-m', 'synthetic baseline'); const base = git('rev-parse', 'HEAD');
  const p = { ...policy(), applicationBaseline: base, homologationBaseline: base };
  write('AGENTS.md', 'Baselines `' + base + '`\ngit log --oneline ' + base + '..origin/hub-2.1 -- . :exclude-docs\ngit log --oneline ' + base + '..origin/hub-2.1 -- deploy/homologation/\n');
  write('CLAUDE.md', '@AGENTS.md'); write('GEMINI.md', 'Leia AGENTS.md');
  write('docs/ESTADO_ATUAL.md', '| **Sessão ativa** | nenhuma |\n' + block(p));
  write('docs/REGISTRO.md', register + '\n### 2026-10-16 — Handoff ficticio\nSessão liberada: nenhuma.\n');
  write('docs/MAPA_MESTRE.md', '# Escopo ficticio\n');
  for (const dir of ['governance', 'operations', 'propostas']) write('docs/' + dir + '/test.md', 'Referencia ficticia\n');
  git('remote', 'add', 'origin', 'https://github.com/Julianogdc/zafira-hub-internal.git'); // local config only, no fetch/push
  const commit = () => { git('add', '.'); git('commit', '-m', 'synthetic documents'); git('update-ref', 'refs/remotes/origin/hub-2.1', git('rev-parse', 'HEAD')); };
  commit();
  return { root, git, write, commit, base };
}

test('policy requires one unambiguous block and valid baselines', () => {
  assert.deepEqual(readPolicy(block(policy())), policy());
  for (const text of ['', block(policy()) + '\n' + block(policy()), block({ ...policy(), applicationBaseline: 'main' })]) assert.throws(() => readPolicy(text));
});
test('cycles and unknown dependencies fail closed', () => {
  const a = { ...baseTask, id: 'A', dependsOn: ['B'] }, b = { ...baseTask, id: 'B', dependsOn: ['A'] };
  assert.throws(() => readPolicy(block(policy([a, b]))), /CYCLE/);
  assert.throws(() => readPolicy(block(policy([a]))), /DEPENDENCY/);
});
test('reserved owner decisions and CI gates cannot be selected', () => {
  for (const change of [{ ownerDecisionRequired: true }, { requiredGates: ['official-ci'] }, { kind: 'implementation' }, { kind: 'technical-acceptance' }, { status: 'blocked' }, { decision: 'DEC-GOV-999' }]) {
    assert.equal(chooseTask(policy([{ ...baseTask, ...change }]), register), null);
  }
});
test('dependencies and agent availability must be proven', () => {
  assert.equal(chooseTask(policy(), register).id, baseTask.id);
  assert.equal(chooseTask(policy([{ ...baseTask, dependsOn: ['unknown'] }]), register), null);
  assert.equal(chooseAgent([{ installed: true, authenticated: true, available: false, headless: true }]), null);
  assert.equal(chooseAgent([{ name: 'synthetic', installed: true, authenticated: true, available: true, headless: true }]).name, 'synthetic');
});
test('atomic lease rejects a second process; only its owner can release', (t) => {
  const runtime = path.join(temporary(t), 'runtime'), lease = acquireLease(runtime);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {acquireLease} from ' + JSON.stringify(moduleUrl) + ';try{acquireLease(process.argv[1]);process.exitCode=9}catch(e){console.log(e.message)}', runtime],
  { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(child.status, 0); assert.match(child.stdout, /LEASE_BUSY/);
  assert.throws(() => releaseLease(runtime, { token: 'foreign' }), /OWNERSHIP/);
  assert.ok(fs.existsSync(path.join(runtime, 'lease.json')));
  releaseLease(runtime, lease);
  const second = acquireLease(runtime); releaseLease(runtime, second);
});
test('stale leases never expire into automatic takeover', (t) => {
  const runtime = path.join(temporary(t), 'runtime'), lease = acquireLease(runtime);
  const file = path.join(runtime, 'lease.json'), data = JSON.parse(fs.readFileSync(file)); data.startedAt = '2000-01-01'; data.pid = 999999;
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => acquireLease(runtime), /LEASE_BUSY/); releaseLease(runtime, lease);
});
test('stop is persistent; reset serializes with the lease', (t) => {
  const runtime = path.join(temporary(t), 'runtime'); requestStop(runtime);
  assert.throws(() => checkpoint(runtime, Date.now() + 1000), /STOP_REQUESTED/);
  const lease = acquireLease(runtime); assert.throws(() => resetStop(runtime), /LEASE_BUSY/); releaseLease(runtime, lease);
  resetStop(runtime); checkpoint(runtime, Date.now() + 1000);
  assert.throws(() => checkpoint(runtime, Date.now() - 1), /TIME_LIMIT/);
});
test('runtime rejects a junction/symlink rather than following it', (t) => {
  const root = temporary(t), target = path.join(root, 'target'), link = path.join(root, 'link'); fs.mkdirSync(target);
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => acquireLease(link), /BOUNDARY/); assert.equal(fs.readdirSync(target).length, 0);
});
test('runtime identity is shared across different TEMP environments', (t) => {
  const r = repository(t), before = runtimeFor(r.root), old = process.env.TEMP;
  try { process.env.TEMP = path.join(r.root, 'synthetic-other-temp'); assert.equal(runtimeFor(r.root), before); }
  finally { if (old === undefined) delete process.env.TEMP; else process.env.TEMP = old; }
  assert.ok(before.startsWith(path.join(r.root, '.zafira-context')));
});
test('clean synthetic repository yields a read-only proposal, never execution', (t) => {
  const r = repository(t), result = inspectRepository(r.root);
  assert.deepEqual(result.reasons, []); assert.equal(result.observedNext.id, baseTask.id);
  assert.equal(result.executionEnabled, false); assert.equal(EXECUTION_ENABLED, false);
  assert.equal(result.remoteFreshness, 'not-queried');
});
test('active or ambiguous sessions block transfer', (t) => {
  const r = repository(t);
  for (const session of ['| **Sessão ativa** | Claude Code |', '| **Sessão ativa** | nenhuma |\n| **Sessão ativa** | nenhuma |']) {
    r.write('docs/ESTADO_ATUAL.md', session + '\n' + block({ ...policy(), applicationBaseline: r.base, homologationBaseline: r.base }));
    assert.ok(inspectRepository(r.root).reasons.includes('ACTIVE_OR_AMBIGUOUS_SESSION'));
  }
});
test('unknown working changes are preserved and block transfer', (t) => {
  const r = repository(t); r.write('unrelated.txt', 'do not overwrite');
  assert.ok(inspectRepository(r.root).reasons.includes('DIRTY_TREE')); assert.equal(fs.readFileSync(path.join(r.root, 'unrelated.txt'), 'utf8'), 'do not overwrite');
});
test('both integrity scopes remain independently blocking', (t) => {
  const r = repository(t); r.write('application.txt', 'changed'); r.commit();
  let result = inspectRepository(r.root); assert.ok(result.reasons.includes('APPLICATION_INTEGRITY')); assert.deepEqual(result.homologation.HEAD, []);
  r.write('deploy/homologation/test.txt', 'changed package'); r.commit();
  result = inspectRepository(r.root); assert.ok(result.reasons.includes('APPLICATION_INTEGRITY')); assert.ok(result.reasons.includes('HOMOLOGATION_INTEGRITY'));
});
test('branch, remote and local upstream divergence all block', (t) => {
  const r = repository(t); r.git('checkout', '-b', 'synthetic-other'); r.git('remote', 'set-url', 'origin', 'https://example.invalid/repo.git');
  r.write('docs/change.md', 'synthetic'); r.git('add', '.'); r.git('commit', '-m', 'synthetic divergence');
  const result = inspectRepository(r.root);
  for (const reason of ['BRANCH', 'REMOTE', 'UNSYNCHRONIZED']) assert.ok(result.reasons.includes(reason));
});
test('missing handoff and baseline/protocol mismatch block', (t) => {
  const r = repository(t); r.write('docs/REGISTRO.md', register); r.write('AGENTS.md', 'missing baseline');
  const result = inspectRepository(r.root); assert.ok(result.reasons.includes('HANDOFF_MISSING')); assert.ok(result.reasons.includes('BASELINE_PROTOCOL_MISMATCH'));
});
test('a hash mentioned elsewhere cannot change one protected scope', (t) => {
  const r = repository(t), head = r.git('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(r.root, 'AGENTS.md'), '\nUnrelated `' + head + '`\n');
  r.write('docs/ESTADO_ATUAL.md', '| **Sessão ativa** | nenhuma |\n' + block({ ...policy(), applicationBaseline: r.base, homologationBaseline: head }));
  assert.ok(inspectRepository(r.root).reasons.includes('BASELINE_PROTOCOL_MISMATCH'));
});
test('all three instruction bridges use the same official protocol', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(Buffer.byteLength(agents) < 32768);
  for (const name of ['Codex', 'Claude Code', 'Antigravity']) assert.ok(agents.includes(name));
  assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m);
  assert.match(fs.readFileSync(path.join(root, 'GEMINI.md'), 'utf8'), /AGENTS\.md/);
  const modern = fs.readFileSync(path.join(root, '.agents/rules/zafira-governance.md'), 'utf8');
  assert.match(modern, /^trigger: always_on$/m); assert.ok(modern.length < 12000);
  assert.equal(modern, fs.readFileSync(path.join(root, '.agent/rules/zafira-governance.md'), 'utf8'));
});
test('context includes complete official texts and hashes with no inference', (t) => {
  const r = repository(t), context = officialContext(r.root);
  assert.equal(context.mode, 'context-only-no-inference'); assert.equal(context.sources.length, 9);
  for (const source of context.sources) { assert.match(source.sha256, /^[a-f0-9]{64}$/); assert.equal(source.content, fs.readFileSync(path.join(r.root, source.path), 'utf8')); }
});
test('simulation leaves Git unchanged, releases lease and emits sanitized events', async (t) => {
  const r = repository(t), runtime = runtimeFor(r.root); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const head = r.git('rev-parse', 'HEAD'); const result = await simulate(r.root);
  assert.equal(result.launched, false); assert.equal(result.repositoryUnchanged, true);
  assert.equal(r.git('rev-parse', 'HEAD'), head); assert.equal(r.git('status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(runtime, 'lease.json')), false);
  const events = fs.readFileSync(path.join(runtime, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((e) => e.type), ['lease-acquired', 'simulation-validated', 'lease-released']);
  assert.ok(events.every((e) => Object.keys(e).sort().join(',') === 'at,pid,runId,type'));
});
test('blocked simulation and stopped simulation cannot leave a writer', async (t) => {
  const r = repository(t), runtime = runtimeFor(r.root); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  r.write('foreign.txt', 'sentinel'); const result = await simulate(r.root); assert.ok(result.blocked.includes('DIRTY_TREE')); assert.equal(result.launched, false);
  requestStop(runtime); await assert.rejects(simulate(r.root), /STOP_REQUESTED/);
  assert.equal(fs.existsSync(path.join(runtime, 'lease.json')), false);
});
test('write/run commands and unsupported options are rejected without Git changes', (t) => {
  const r = repository(t), head = r.git('rev-parse', 'HEAD');
  for (const args of [['run'], ['write'], ['simulate', '--write'], ['inspect', '--bypass'], ['stop', '--probe']]) {
    const child = spawnSync(process.execPath, [cli, ...args], { cwd: r.root, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(child.status, 1); assert.match(child.stderr, /COORDINATOR_REFUSED/);
  }
  assert.equal(r.git('rev-parse', 'HEAD'), head); assert.equal(r.git('status', '--porcelain'), '');
});
