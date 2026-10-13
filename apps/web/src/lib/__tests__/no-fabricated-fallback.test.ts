import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * F6-IMP.7A — trava de regressão: nenhum dado inventado nem sessão falsa no código de produção.
 *
 * Histórico: o commit 087cdb8 fazia o serviço de Entregas devolver um plano de demonstração
 * em qualquer erro (inclusive em produção) e criava uma sessão de ADMIN falsa, clientes e
 * tarefas do Asana inventados quando a API falhava em modo de desenvolvimento.
 * Corrigido em 1837801. Estes testes falham se esse tipo de fallback voltar.
 */
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(src, rel), 'utf8');
// Remove comentários para que a documentação não conte como código.
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GUARDED = [
  'store/useAuthStore.ts',
  'services/deliverables.ts',
  'services/asana.ts',
  'services/clients.ts',
  'components/projects/canonical/CanonicalDeliverablesView.tsx',
];

test('código de produção de sessão, clientes, Asana e Entregas não depende do modo de desenvolvimento', () => {
  for (const rel of GUARDED) {
    assert.ok(!/import\.meta\.env\.(DEV|MODE)/.test(code(rel)), `${rel} não pode ter comportamento exclusivo de desenvolvimento`);
  }
});

test('nenhum dado de demonstração, mock ou fictício nesses arquivos', () => {
  for (const rel of GUARDED) {
    assert.ok(!/mock|fake|demo|fict[ií]ci|exemplo/i.test(code(rel)), `${rel} contém indício de dado inventado`);
  }
});

test('sessão: só a resposta autenticada da API cria sessão; falha deixa o usuário deslogado', () => {
  const store = code('store/useAuthStore.ts');
  const authenticatedTrue = store.match(/isAuthenticated:\s*true/g) ?? [];
  assert.equal(authenticatedTrue.length, 1, 'isAuthenticated: true só pode existir no ramo de resposta autenticada');
  const successBranch = store.indexOf('if (response && response.authenticated)');
  assert.ok(successBranch >= 0 && store.indexOf('isAuthenticated: true') > successBranch);
  assert.ok(!/role:\s*['"](ADMIN|admin)['"]/.test(store), 'nenhum papel fixo de administrador');

  const checkSession = store.slice(store.indexOf('checkSession:'), store.indexOf('login:'));
  const catchBlock = checkSession.slice(checkSession.lastIndexOf('catch'));
  assert.match(catchBlock, /isAuthenticated:\s*false/);
  assert.match(catchBlock, /user:\s*null/);
});

test('Entregas: o serviço propaga erro da API e não tem fallback', () => {
  const service = code('services/deliverables.ts');
  assert.ok(!/\bcatch\b/.test(service), 'o serviço de Entregas não pode capturar o erro e devolver dados');
  assert.ok(!/\.catch\(/.test(service));
  assert.match(service, /apiFetch<GetDeliverablesResponse>\(/);
  assert.match(service, /plan:\s*response\?\.plan\s*\?\?\s*null/);
});

test('Entregas não dependem do Asana: aparecem sem projeto vinculado e com falha nas tarefas', () => {
  const page = code('pages/Projetos.tsx');
  assert.match(
    page,
    /\(projectsError \|\| projects\.length === 0\) && \(\s*<section[^>]*>\s*<CanonicalDeliverablesView/,
    'sem projeto Asana (ou com erro na consulta), a página deve mostrar as Entregas'
  );
  const list = code('components/projects/canonical/CanonicalTaskList.tsx');
  const deliverablesBranch = list.indexOf("if (view === 'deliverables')");
  assert.ok(deliverablesBranch >= 0);
  assert.ok(deliverablesBranch < list.indexOf('if (loading)'), 'Entregas antes do carregamento das tarefas');
  assert.ok(deliverablesBranch < list.indexOf('if (error)'), 'Entregas antes do erro das tarefas');
});

test('Entregas: a tela não monta indicadores sem plano', () => {
  const view = code('components/projects/canonical/CanonicalDeliverablesView.tsx');
  const noPlanStart = view.indexOf('{!plan ? (');
  const metricsStart = view.indexOf('styles.metricsGrid');
  assert.ok(noPlanStart >= 0 && metricsStart > noPlanStart, 'os indicadores só podem vir depois do ramo "sem plano"');
  const noPlanBranch = view.slice(noPlanStart, metricsStart);
  assert.match(noPlanBranch, /<EmptyState/, 'sem plano, a tela mostra o estado vazio');
  assert.ok(!/metrics\./.test(noPlanBranch), 'nenhum número de meta sem plano');
  // F6-IMP.7B: sem plano, o único caminho é criar um plano real (quem tem deliverables.plan).
  assert.match(noPlanBranch, /permissions\.canPlan/);
});
