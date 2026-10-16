// DEC-GOV-008: no inference, agent launch, repository mutation or remote Git operation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new Error(code); };
const SOURCES = ['AGENTS.md', 'docs/ESTADO_ATUAL.md', 'docs/REGISTRO.md', 'docs/MAPA_MESTRE.md'];
const EXCLUSIONS = ['.', ':(exclude)docs', ':(exclude)AGENTS.md', ':(exclude)CLAUDE.md', ':(exclude)GEMINI.md', ':(exclude)deploy/homologation/'];
export const EXECUTION_ENABLED = false;

function git(root, ...args) {
  return timedGit(root, Date.now() + 5000, ...args);
}

function timedGit(root, deadline, ...args) {
  if (Date.now() >= deadline) fail('TIME_LIMIT');
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8', timeout: Math.max(1, Math.min(5000, deadline - Date.now())), maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readInside(root, relative) {
  const file = fs.realpathSync(path.join(root, relative));
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || fs.statSync(file).size > 1024 * 1024) fail('SOURCE_BOUNDARY');
  return fs.readFileSync(file, 'utf8');
}

export function readPolicy(text) {
  const blocks = [...text.matchAll(/```zafira-coordination\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) fail('POLICY_MISSING_OR_AMBIGUOUS');
  const p = JSON.parse(blocks[0][1]);
  if (p.version !== 1 || !/^[a-f0-9]{7,40}$/.test(p.applicationBaseline) || !/^[a-f0-9]{7,40}$/.test(p.homologationBaseline) ||
    !Array.isArray(p.tasks) || !p.tasks.length || p.tasks.length > 20) fail('POLICY_INVALID');
  const ids = new Set();
  for (const t of p.tasks) {
    if (!t || !/^[A-Za-z0-9.-]{1,64}$/.test(t.id) || ids.has(t.id) || !['ready', 'blocked', 'completed'].includes(t.status) ||
      !['read-only', 'implementation', 'technical-acceptance'].includes(t.kind) || typeof t.objective !== 'string' || t.objective.length > 2000 ||
      !/^DEC-[A-Z]+-\d{3}$/.test(t.decision) || typeof t.ownerDecisionRequired !== 'boolean' ||
      !Array.isArray(t.dependsOn) || !Array.isArray(t.requiredGates) ||
      [...t.dependsOn, ...t.requiredGates].some((v) => typeof v !== 'string')) fail('TASK_INVALID');
    ids.add(t.id);
  }
  for (const t of p.tasks) if (t.dependsOn.some((id) => !ids.has(id) || id === t.id)) fail('DEPENDENCY_INVALID');
  const visiting = new Set(), visited = new Set();
  function visit(t) {
    if (visiting.has(t.id)) fail('DEPENDENCY_CYCLE');
    if (visited.has(t.id)) return;
    visiting.add(t.id); t.dependsOn.forEach((id) => visit(p.tasks.find((d) => d.id === id)));
    visiting.delete(t.id); visited.add(t.id);
  }
  p.tasks.forEach(visit);
  return p;
}

export function chooseTask(policy, register) {
  return policy.tasks.find((t) => t.status === 'ready' && t.kind === 'read-only' && !t.ownerDecisionRequired &&
    t.requiredGates.length === 0 && register.includes('### ' + t.decision + ' —') &&
    t.dependsOn.every((id) => policy.tasks.find((d) => d.id === id)?.status === 'completed')) ?? null;
}

export function chooseAgent(agents) {
  return agents.find((a) => a.installed === true && a.authenticated === true && a.available === true && a.headless === true) ?? null;
}

export function inspectRepository(directory, { deadline = Date.now() + 15000 } = {}) {
  const root = fs.realpathSync(directory);
  const git = (root, ...args) => timedGit(root, deadline, ...args);
  if (fs.realpathSync(git(root, 'rev-parse', '--show-toplevel')) !== root) fail('REPOSITORY_ROOT');
  const texts = Object.fromEntries(SOURCES.map((p) => [p, readInside(root, p)]));
  const state = texts[SOURCES[1]], register = texts[SOURCES[2]];
  const policy = readPolicy(state);
  const reasons = [];
  const sessions = [...state.matchAll(/^\|\s*\*\*Sessão ativa\*\*\s*\|\s*([^|]+)\|\s*$/gm)];
  if (sessions.length !== 1 || sessions[0][1].trim() !== 'nenhuma') reasons.push('ACTIVE_OR_AMBIGUOUS_SESSION');
  const branch = git(root, 'branch', '--show-current');
  const head = git(root, 'rev-parse', 'HEAD'), originHead = git(root, 'rev-parse', 'origin/hub-2.1');
  if (branch !== 'hub-2.1') reasons.push('BRANCH');
  const remote = git(root, 'remote', 'get-url', 'origin');
  if (!['https://github.com/Julianogdc/zafira-hub-internal.git', 'git@github.com:Julianogdc/zafira-hub-internal.git'].includes(remote)) reasons.push('REMOTE');
  if (head !== originHead) reasons.push('UNSYNCHRONIZED');
  if (git(root, 'status', '--porcelain=v1', '--untracked-files=all')) reasons.push('DIRTY_TREE');
  // Match each scope's authoritative command, not an unrelated hash mentioned in prose.
  const appRefs = [...texts['AGENTS.md'].matchAll(/^\s*git log --oneline ([a-f0-9]{7,40})\.\.origin\/hub-2\.1 -- \. /gm)];
  const packageRefs = [...texts['AGENTS.md'].matchAll(/^\s*git log --oneline ([a-f0-9]{7,40})\.\.origin\/hub-2\.1 -- deploy\/homologation\/\s*$/gm)];
  if (appRefs.length !== 1 || packageRefs.length !== 1 || appRefs[0][1] !== policy.applicationBaseline || packageRefs[0][1] !== policy.homologationBaseline) reasons.push('BASELINE_PROTOCOL_MISMATCH');
  for (const base of [policy.applicationBaseline, policy.homologationBaseline]) {
    for (const tip of ['HEAD', 'origin/hub-2.1']) {
      try { git(root, 'merge-base', '--is-ancestor', base, tip); } catch (e) { if (e.status !== 1) throw e; reasons.push('BASELINE_NOT_ANCESTOR'); }
    }
  }
  const application = {}, homologation = {};
  for (const tip of ['HEAD', 'origin/hub-2.1']) {
    application[tip] = git(root, 'log', '--format=%H', policy.applicationBaseline + '..' + tip, '--', ...EXCLUSIONS).split('\n').filter(Boolean);
    homologation[tip] = git(root, 'log', '--format=%H', policy.homologationBaseline + '..' + tip, '--', 'deploy/homologation/').split('\n').filter(Boolean);
  }
  if (Object.values(application).some((c) => c.length)) reasons.push('APPLICATION_INTEGRITY');
  if (Object.values(homologation).some((c) => c.length)) reasons.push('HOMOLOGATION_INTEGRITY');
  const firstHandoff = register.split(/^### \d{4}-\d{2}-\d{2} — /m)[1]?.split(/^### /m)[0] ?? '';
  if (!firstHandoff.includes('Sessão liberada: nenhuma.')) reasons.push('HANDOFF_MISSING');
  const next = chooseTask(policy, register);
  if (!next) reasons.push('NO_ELIGIBLE_READ_ONLY_TASK');
  return { root, head, originHead, branch, reasons: [...new Set(reasons)], application, homologation,
    observedNext: next, executionEnabled: EXECUTION_ENABLED, remoteFreshness: 'not-queried',
    sources: SOURCES.map((p) => ({ path: p, sha256: digest(texts[p]), bytes: Buffer.byteLength(texts[p]) })) };
}

// Filesystem and CLI status only; never read credential files or issue a model request.
export function discoverAgents(probe = false) {
  const directories = (process.env.PATH ?? '').split(path.delimiter);
  const find = (name, extra = []) => [...directories, ...extra].map((d) => path.join(d, name)).find((f) => {
    try { return fs.statSync(f).isFile(); } catch { return false; }
  });
  const agents = [
    { name: 'codex', executable: find(process.platform === 'win32' ? 'codex.exe' : 'codex') },
    { name: 'claude', executable: find(process.platform === 'win32' ? 'claude.exe' : 'claude', [path.join(os.homedir(), '.local', 'bin')]) },
    { name: 'antigravity', executable: find(process.platform === 'win32' ? 'agy.exe' : 'agy', process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'agy', 'bin')] : []) },
  ];
  for (const a of agents) {
    a.installed = Boolean(a.executable); a.authenticated = null; a.available = false; a.headless = false;
    if (!probe || !a.installed) continue;
    const call = (args) => spawnSync(a.executable, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 65536, windowsHide: true });
    const version = call(['--version']);
    a.version = version.status === 0 ? version.stdout.trim().match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null : null;
    if (a.name === 'antigravity') continue; // No locally verified auth/status adapter: deny by default.
    const status = call(a.name === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json']);
    if (a.name === 'codex') a.authenticated = status.status === 0 && /Logged in using ChatGPT/.test(status.stdout + status.stderr);
    else { try { a.authenticated = status.status === 0 && JSON.parse(status.stdout).loggedIn === true; } catch { a.authenticated = false; } }
    const help = call(a.name === 'codex' ? ['exec', '--help'] : ['--help']);
    a.headless = help.status === 0 && (a.name === 'codex' ? /--sandbox/.test(help.stdout) : /--print/.test(help.stdout));
    // A successful status is not proof of quota, cost authorization, or an idle agent.
    a.available = false;
  }
  return agents;
}

export function runtimeFor(directory) {
  const root = fs.realpathSync(directory);
  const common = fs.realpathSync(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')));
  const key = digest(process.platform === 'win32' ? common.toLowerCase() : common);
  // Shared physical location across agents AND sandbox-specific TEMP directories.
  // All worktrees of this Git repository resolve to the same common directory.
  return path.join(path.dirname(common), '.zafira-context', 'coordination-' + key);
}

function ensureRuntime(runtime) {
  const parent = path.dirname(runtime);
  try { fs.mkdirSync(parent, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (fs.lstatSync(parent).isSymbolicLink() || !fs.statSync(parent).isDirectory()) fail('RUNTIME_BOUNDARY');
  try { fs.mkdirSync(runtime, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (fs.lstatSync(runtime).isSymbolicLink() || !fs.statSync(runtime).isDirectory()) fail('RUNTIME_BOUNDARY');
  // Reparse points/symlinks on individual control files are never followed.
  for (const name of ['lease.json', 'events.jsonl', 'STOP']) {
    const p = path.join(runtime, name);
    try { if (fs.lstatSync(p).isSymbolicLink()) fail('RUNTIME_BOUNDARY'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

function event(runtime, type, runId) {
  const log = path.join(runtime, 'events.jsonl');
  if (fs.existsSync(log) && fs.statSync(log).size > 1024 * 1024) fail('AUDIT_LIMIT');
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), type, runId, pid: process.pid }) + '\n', { mode: 0o600 });
}

export function acquireLease(runtime) {
  ensureRuntime(runtime);
  const runId = crypto.randomUUID(), token = crypto.randomBytes(24).toString('hex');
  let fd;
  try { fd = fs.openSync(path.join(runtime, 'lease.json'), 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') fail('LEASE_BUSY'); throw e; }
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, runId, token, startedAt: new Date().toISOString(), mode: 'simulation-only' })); }
  finally { fs.closeSync(fd); }
  event(runtime, 'lease-acquired', runId);
  return { runId, token };
}

export function releaseLease(runtime, lease) {
  ensureRuntime(runtime);
  const file = path.join(runtime, 'lease.json');
  if (JSON.parse(fs.readFileSync(file, 'utf8')).token !== lease.token) fail('LEASE_OWNERSHIP');
  event(runtime, 'lease-released', lease.runId);
  fs.unlinkSync(file);
}

export function requestStop(runtime) {
  ensureRuntime(runtime);
  try { fs.writeFileSync(path.join(runtime, 'STOP'), 'simulation stop\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  event(runtime, 'stop-requested', null);
}

export function resetStop(runtime) {
  ensureRuntime(runtime);
  // Serialize reset with a simulation: checking absence then unlinking would race.
  const lease = acquireLease(runtime);
  try { try { fs.unlinkSync(path.join(runtime, 'STOP')); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  finally { releaseLease(runtime, lease); }
}

export function checkpoint(runtime, deadline) {
  ensureRuntime(runtime);
  if (fs.existsSync(path.join(runtime, 'STOP'))) fail('STOP_REQUESTED');
  if (Date.now() >= deadline) fail('TIME_LIMIT');
}

export async function simulate(root, { maxMs = 5000 } = {}) {
  if (!Number.isInteger(maxMs) || maxMs < 100 || maxMs > 5000) fail('LIMIT_INVALID');
  const runtime = runtimeFor(root), lease = acquireLease(runtime), deadline = Date.now() + maxMs;
  try {
    checkpoint(runtime, deadline);
    const before = inspectRepository(root, { deadline });
    checkpoint(runtime, deadline);
    if (before.reasons.length) { event(runtime, 'preflight-blocked', lease.runId); return { mode: 'simulation-only', runtime, blocked: before.reasons, launched: false }; }
    event(runtime, 'simulation-validated', lease.runId);
    const after = inspectRepository(root, { deadline });
    checkpoint(runtime, deadline);
    if (before.head !== after.head || after.reasons.length) fail('STATE_CHANGED');
    return { mode: 'simulation-only', runtime, task: before.observedNext.id, launched: false, repositoryUnchanged: true,
      activationBlocked: ['WRITING_NOT_AUTHORIZED', 'IDLE_AUTH_QUOTA_NOT_PROVEN', 'REMOTE_FRESHNESS_NOT_PROVEN'] };
  } finally { releaseLease(runtime, lease); }
}

export function officialContext(root) {
  const directory = fs.realpathSync(root), files = [...SOURCES, 'CLAUDE.md', 'GEMINI.md'];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const p = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) fail('SOURCE_BOUNDARY');
      if (entry.isDirectory()) walk(p); else if (/\.(md|json)$/.test(p)) files.push(p);
    }
  }
  for (const dir of ['docs/governance', 'docs/operations', 'docs/propostas']) walk(dir);
  let total = 0;
  const sources = files.map((file) => {
    const content = readInside(directory, file); total += Buffer.byteLength(content);
    if (total > 3 * 1024 * 1024) fail('CONTEXT_LIMIT');
    return { path: file, sha256: digest(content), content };
  });
  return { mode: 'context-only-no-inference', authority: 'docs/MAPA_MESTRE.md', sources,
    instruction: 'Leia integralmente as fontes oficiais. Propostas não são autorizações. Não escreva nem execute agentes. Handoff e portões são obrigatórios; decisões reservadas não podem ser inferidas.' };
}

async function main(args) {
  const [command = 'inspect', ...options] = args;
  if (!['inspect', 'context', 'simulate', 'stop', 'reset-stop', 'audit'].includes(command) || options.some((v) => v !== '--probe')) fail('UNSUPPORTED_MODE');
  if (options.length && command !== 'inspect') fail('UNSUPPORTED_OPTION');
  const root = process.cwd();
  if (command === 'inspect') return { ...inspectRepository(root), agents: discoverAgents(options.includes('--probe')), selectedAgent: null };
  if (command === 'context') return officialContext(root);
  if (command === 'simulate') return simulate(root);
  const runtime = runtimeFor(root);
  if (command === 'stop') { requestStop(runtime); return { stopRequested: true, runtime }; }
  if (command === 'reset-stop') { resetStop(runtime); return { stopReset: true, runtime }; }
  ensureRuntime(runtime);
  const log = path.join(runtime, 'events.jsonl');
  if (fs.existsSync(log) && fs.statSync(log).size > 1024 * 1024) fail('AUDIT_LIMIT');
  return { runtime, events: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').slice(-50).map(JSON.parse) : [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((value) => console.log(JSON.stringify(value, null, 2))).catch(() => {
    // Raw Git/CLI/filesystem errors can contain private paths or configuration.
    console.error(JSON.stringify({ blocked: true, code: 'COORDINATOR_REFUSED', executionEnabled: false })); process.exitCode = 1;
  });
}
