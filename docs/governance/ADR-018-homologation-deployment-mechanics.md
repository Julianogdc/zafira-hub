# ADR-018: Mecânica de Deployment, Migrations e Rollback de Homologação (Hub 2.1)

## Status
Aceito

## Data
2026-09-21

## Contexto
Com a publicação das imagens de container imutáveis no GHCR (ADR-016) e a definição das diretrizes de infraestrutura (ADR-017), é necessário formalizar a mecânica operacional de deployment, aplicação de migrations e rollback para o ambiente de homologação e produção do Zafira Hub 2.1.
Improvisações em deploy, execuções de builds diretos na VPS ou reversões sem backups estruturados trazem riscos severos de corrupção de estado e indisponibilidade.

## Decisões

1. **Deployment Baseado Exclusivamente em Imagens Imutáveis**:
   - Todo deployment de homologação utiliza a imagem exata auditada e publicada no GHCR via digest SHA256 (`ghcr.io/...@sha256:...`).
   - Nenhuma imagem é reconstruída na VPS (`docker build` em produção/homologação é estritamente proibido).
   - Tags mutáveis como `latest`, `stable` ou nomes de branches são terminantemente proibidas.
2. **Isolamento de Banco de Dados de Homologação**:
   - O ambiente de homologação conecta-se exclusivamente a uma base de dados dedicada (ex: `zafira_hub_21_staging`).
   - É terminantemente proibido qualquer apontamento para a base `zafira_hub_v2` de produção.
3. **Mecânica de Migrations (Forward-Only)**:
   - Migrações são executadas através da própria imagem de container da API via `prisma migrate deploy`.
   - As migrações do Prisma seguem a filosofia estrita **forward-only** (sem suporte ou dependência de scripts automáticos de `down migration`).
4. **Política de Backup Pré-Migration**:
   - Antes de aplicar qualquer migração em ambiente persistente de homologação ou produção, deve ser gerado um backup consistente do banco de dados (ex: `pg_dump -Fc`).
5. **Mecânica de Rollback**:
   - **Rollback de Aplicação:** Realizado de forma atômica e instantânea reapontando a referência do container para o digest SHA256 anterior validado.
   - **Rollback de Banco:** Rollback de aplicação não implica automaticamente em rollback de banco. Caso uma migração introduza alterações incompatíveis com a versão anterior, o rollback de banco exige restauração explícita e autorizada de backup em base descartável/staging.
6. **Contrato de Health e Observabilidade**:
   - **Liveness:** `GET /health` deve responder HTTP 200 com `{ status: "ok" }`.
   - **Readiness:** `GET /health/database` deve responder HTTP 200 com status de conectividade do banco de dados.
   - **Reverse Proxy Same-Origin:** O frontend Web deve rotear todo o tráfego da API exclusivamente através do prefixo `/hub-api/`.
7. **Injeção de Segredos em Runtime**:
   - As variáveis de ambiente (`DATABASE_URL`, `COOKIE_SECRET`, `JWT_SECRET`, `HUB_INTERNAL_API_KEY`, etc.) são injetadas em tempo de execução pelo orquestrador, mantendo os artefatos de imagem 100% livres de segredos.

## Consequências
- Processo de homologação totalmente determinístico, auditável e reproduzível.
- Garantia de que a mesma imagem validada no CI é a que executa nos servidores.
- Procedimentos claros e seguros de recuperação em caso de falha.
