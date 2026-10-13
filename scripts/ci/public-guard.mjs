#!/usr/bin/env node
// Guarda do repositorio PUBLICO: impede que informacao operacional ou credencial seja publicada.
//
// Uso:
//   node scripts/ci/public-guard.mjs repo            # arquivos versionados no Git
//   node scripts/ci/public-guard.mjs dir <caminho>   # diretorio (ex.: copia exportada)
//
// A lista de negacao contem APENAS hashes SHA-256 (scripts/ci/public-denylist-hashes.txt): hosts e
// sufixos de dominio proprios, rotulos de infraestrutura, IPs e valores de credenciais ja conhecidos.
// Alem dela, regras sem lista: qualquer IPv4 nao privado e nomes de arquivo proibidos.
// NUNCA imprime o valor encontrado: so tipo, arquivo e linha.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (v) => createHash('sha256').update(v).digest('hex');

const denyFile = path.join(root, 'scripts', 'ci', 'public-denylist-hashes.txt');
const deny = new Set(
  existsSync(denyFile)
    ? readFileSync(denyFile, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter((l) => /^[0-9a-f]{64}$/.test(l))
    : []
);

const SKIP_PATH = /(^|\/)(node_modules|dist|coverage|\.git)\//;
const SKIP_FILE = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|mp4|mov|webp)$/i;
const FORBIDDEN_NAME = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx)|id_rsa[^/]*|[^/]*\.sqlite|[^/]*\.dump)$/i;
const ALLOWED_NAME = /\.env\.example$|\.example$/;
const FORBIDDEN_DIR = /^(docs\/historico|internal-bundle|docs-internal|scratch)\//;
// Arquivos classificados como exclusivamente internos (plano de migracao): barrados por nome, mesmo sem host/credencial no conteudo.
const FORBIDDEN_INTERNAL_FILE = new RegExp(
  [
    '(^|/)SQL_[A-Za-z0-9_]+\\.sql$',
    '(^|/)EMAIL_TEMPLATE_[A-Za-z0-9_]+\\.html$',
    '(^|/)docs/governance/ADR-01[78]-',
    '(^|/)AUDITORIA_TECNICA[^/]*$',
    '(^|/)TRIAGEM_VULNERABILIDADES[^/]*$',
    '(^|/)docs/operations/homologation-(readiness|deployment-runbook|backup-and-rollback|final-gate)\\.md$',
    '(^|/)docs/operations/templates/vps-capacity-observation\\.md$',
    '(^|/)MAPA_MESTRE_C2_PROPOSTA[^/]*$',
    '(^|/)MIGRACAO_REPOSITORIO_PUBLICO[^/]*$',
    '(^|/)(ESTADO|REGISTRO)_INTERNO[^/]*$',
    '^(commit\\.ps1|regression\\.ps1|scratch-audit\\.js)$',
  ].join('|'),
  'i'
);

const isPrivateIp = (ip) =>
  /^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|255\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip);

function listFiles(mode, dir) {
  if (mode === 'repo') {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0')
      .filter(Boolean)
      .map((f) => ({ rel: f, abs: path.join(root, f) }));
  }
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push({ rel: path.relative(dir, abs).split(path.sep).join('/'), abs });
    }
  };
  walk(dir);
  return out;
}

const mode = process.argv[2];
const dirArg = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (mode !== 'repo' && !(mode === 'dir' && dirArg && existsSync(dirArg))) {
  console.error('uso: public-guard.mjs repo | dir <caminho>');
  process.exit(2);
}

const findings = [];
const add = (type, rel, line) => findings.push(`GUARDA PUBLICA [${type}]: ${rel}${line ? ':' + line : ''}`);

let scanned = 0;
for (const { rel, abs } of listFiles(mode, dirArg)) {
  if (SKIP_PATH.test(rel + '/') && !rel.startsWith('docs/')) continue;
  if (FORBIDDEN_DIR.test(rel)) add('diretorio-interno', rel);
  if (FORBIDDEN_INTERNAL_FILE.test(rel)) add('arquivo-interno', rel);
  if (FORBIDDEN_NAME.test(rel) && !ALLOWED_NAME.test(rel)) add('arquivo-proibido', rel);
  if (SKIP_FILE.test(rel)) continue;
  let text;
  try {
    if (statSync(abs).size > 5_000_000) continue;
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // hosts: compara o host e todos os sufixos com a lista
    for (const m of line.matchAll(/\b(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}\b/gi)) {
      const labels = m[0].toLowerCase().split('.');
      for (let k = 0; k < labels.length - 1; k++) {
        if (deny.has(sha('host:' + labels.slice(k).join('.')))) {
          add('host-interno', rel, i + 1);
          k = labels.length;
        }
      }
    }
    // rotulos/palavras e valores longos
    for (const m of line.matchAll(/[A-Za-z0-9][A-Za-z0-9_-]{4,}/g)) {
      const t = m[0];
      if (deny.has(sha('word:' + t.toLowerCase()))) add('rotulo-interno', rel, i + 1);
      if (t.length >= 24 && deny.has(sha('cred:' + t))) add('credencial-conhecida', rel, i + 1);
    }
    // IPv4 nao privado
    for (const m of line.matchAll(/(?<![0-9.])((?:\d{1,3}\.){3}\d{1,3})(?![0-9.])/g)) {
      const ip = m[1];
      if (ip.split('.').every((n) => Number(n) <= 255) && !isPrivateIp(ip)) add('ip-publico', rel, i + 1);
      else if (deny.has(sha('ip:' + ip))) add('ip-interno', rel, i + 1);
    }
  }
}

const unique = [...new Set(findings)];
if (unique.length > 0) {
  console.error(unique.join('\n'));
  console.error(`public-guard (${mode}): ${unique.length} ocorrencia(s). Remova a informacao operacional ou mova o arquivo para o repositorio interno.`);
  process.exit(1);
}
console.log(`public-guard (${mode}): nenhuma informacao operacional detectada em ${scanned} arquivo(s); ${deny.size} hash(es) na lista de negacao.`);
