# ADR-014: Ambiente de Build e Runtime Reproduzível, Typecheck Estático da API e Docker Gates

## Status
Aceito (Passo 12D0 — Fase 1: Fundação)

## Contexto
O Zafira Hub 2.1 requer reprodutibilidade estrita em seus pipelines de integração contínua (CI) e nos builds de containers Docker antes de qualquer implantação em ambiente de homologação ou produção.

Anteriormente:
1. O CI executava `typecheck:contracts` e `typecheck:domain`, mas não possuía um gate estático dedicado para a API (`@zafira/api`), dependendo apenas do bundling do `tsup` durante o build.
2. Havia disparidade entre versões de Node.js nos Dockerfiles (`node:22-bookworm-slim` na API, `node:20-alpine` no build do Frontend e `node:24.12.0` no CI).
3. Faltava padronização declarativa de `.nvmrc`, `.node-version` e `engines` no `package.json` raiz.
4. Os Dockerfiles precisavam de auditoria para garantir funcionamento a partir de checkout limpo do monorepo, com `.dockerignore` robusto prevenindo vazamento de segredos e artefatos locais.

## Decisões Arquiteturais

### 1. Versões Canônicas de Runtime e Gerenciador de Pacotes
- **Node.js Canônico:** `24.12.0` (LTS/Current da Fundação).
- **npm Canônico:** `11.6.2`.
- A versão é declarada formalmente no `package.json` raiz via campo `engines`, no arquivo `.nvmrc` e no arquivo `.node-version`.
- Os estágios de build dos Dockerfiles da API e da Web são alinhados para `node:24.12.0-bookworm-slim` e `node:24.12.0-alpine`, garantindo a execução de `npm install -g npm@11.6.2` antes do `npm ci`.

### 2. Instalação Determinística com `npm ci`
- Todos os ambientes (CI, Docker, automações) utilizam `npm ci` baseado estritamente na autoridade do `package-lock.json`.
- É proibido o uso de `npm install` sem lockfile em pipelines automatizados.

### 3. Typecheck Estático Dedicado da API
- O build de produção da API via `tsup` é otimizado para empacotamento rápido e não substitui a validação estrita de tipos do TypeScript.
- É instituído o arquivo `apps/api/tsconfig.typecheck.json` com `noEmit: true`, cobrindo todo o código produtivo de `src/**/*` e isolando artefatos de teste.
- É adicionado o script `npm run typecheck:api` no pipeline de CI antes dos passos de build.
- Proibido o uso de `@ts-ignore`, `@ts-nocheck` ou casts indiscriminados para mascarar erros de tipo.

### 4. Isolamento do Contexto de Build Docker e `.dockerignore`
- O arquivo `.dockerignore` raiz é atualizado para excluir deterministamente: `.git`, `node_modules`, `dist`, `.env*` (exceto `.env.example`), arquivos de log, relatórios de cobertura e contextos locais (`.zafira-context`).
- Nenhuma credencial ou segredo de produção/desenvolvimento entra no contexto de build do Docker.

### 5. Suporte a Monorepo no Docker Build
- Como o `package-lock.json` referencia workspaces do monorepo (`@zafira/contracts`, `@zafira/domain`, `@zafira/api`, `@zafira/web`), os Dockerfiles copiam os respectivos manifestos `package.json` antes de disparar `npm ci`.

### 6. Variáveis de Build Supabase Legadas
- O Frontend Web mantém provisoriamente os build args `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com fallbacks para suportar stores legadas durante o processo de transição (Fases 2 a 13). A autoridade de autenticação principal da Fundação permanece exclusivamente na API Fastify (`@zafira/api`).

### 7. Docker Build Gate no CI
- Adicionado o job `Docker Build Gate` no workflow `.github/workflows/foundation-ci.yml` para comprovar que as imagens de API e Web são construídas com sucesso a partir de um checkout limpo no GitHub.
- Este passo não realiza push para nenhum registry de container (a publicação imutável é escopo do Passo 12D1).

## Consequências e Invariantes Preservadas
- Zero alterações no schema Prisma e zero novas migrations (total: 14).
- Invariantes de RBAC e escopo preservadas (0 `requireRole`, 52/52 rotas financeiras protegidas por `requirePermission`).
- Healthchecks liveness (`/health` e `/`) preservados nos Dockerfiles.
