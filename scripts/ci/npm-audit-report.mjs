// ==============================================================================
// Relatório de vulnerabilidades das dependências de PRODUÇÃO (F6-IMP.9 / P13).
// Não bloqueia o CI: novas falhas são publicadas toda semana em bibliotecas antigas e
// bloquear quebraria o CI sem nenhuma mudança no código. Emite AVISO (annotation) quando
// críticas ou altas passam da linha de base registrada; a correção é decisão do proprietário (P27).
// Uso: node scripts/ci/npm-audit-report.mjs
// ==============================================================================
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const baseline = JSON.parse(readFileSync(new URL('./npm-audit-baseline.json', import.meta.url), 'utf8'));

let raw;
try {
  raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  // npm audit sai com código != 0 quando encontra vulnerabilidades; o JSON vem no stdout.
  raw = error.stdout;
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.log('::warning title=npm audit::Não foi possível ler o resultado do npm audit (rede ou registro indisponível).');
  process.exit(0);
}

const counts = report.metadata?.vulnerabilities ?? {};
const summary = {
  generatedAt: new Date().toISOString(),
  baseline,
  current: { critical: counts.critical ?? 0, high: counts.high ?? 0, moderate: counts.moderate ?? 0, low: counts.low ?? 0 },
  criticalOrHighPackages: Object.entries(report.vulnerabilities ?? {})
    .filter(([, v]) => v.severity === 'critical' || v.severity === 'high')
    .map(([name, v]) => ({ name, severity: v.severity })),
};

mkdirSync('artifacts/npm-audit', { recursive: true });
writeFileSync('artifacts/npm-audit/npm-audit-summary.json', JSON.stringify(summary, null, 2));
console.log(`npm audit (produção): críticas=${summary.current.critical} altas=${summary.current.high} moderadas=${summary.current.moderate} | linha de base: críticas=${baseline.critical} altas=${baseline.high}`);

if (summary.current.critical > baseline.critical || summary.current.high > baseline.high) {
  console.log(
    `::warning title=npm audit acima da linha de base::críticas ${summary.current.critical} (base ${baseline.critical}), altas ${summary.current.high} (base ${baseline.high}). Ver P27 em docs/ESTADO_ATUAL.md.`
  );
}
