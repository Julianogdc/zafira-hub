# Runbook: Sequência Operacional de Deploy de Homologação

Este runbook define a sequência padronizada e reproduzível para execução de deploy no ambiente de homologação do **Zafira Hub 2.1**.

> **IMPORTANTE:** Nenhuma etapa física deste runbook está autorizada a ser executada antes da aprovação formal de capacidade da VPS e do fechamento do Portão da Fase 0 / Fase 1 pelo Chat de Direção.

---

## Sequência Operacional de Deploy

```
[ 1. Capacidade Aprovada ] ──> [ 2. Seleção de Topologia ] ──> [ 3. Criação de DB Dedicado ]
                                                                             │
[ 6. Backup Staging ] <────── [ 5. Configurar GHCR Pull ] <─── [ 4. Geração de Secrets ]
        │
        ▼
[ 7. Definir Image Digests ] ─> [ 8. Migrate Deploy ] ───────> [ 9. Subir Container API ]
                                                                             │
[ 12. Domínio / HTTPS ] <──── [ 11. Subir Container Web ] <─── [ 10. Readiness / Database ]
        │
        ▼
[ 13. Smoke Tests ] ─────────> [ 14. Validação Auth ] ───────> [ 15. Organizações A/B ]
                                                                             │
[ 18. Registro de Evidências] <── [ 17. Observabilidade ] <──── [ 16. Isolation Gate ]
```

---

## Detalhamento dos Passos

### 1. Verificação e Aprovação de Capacidade
- Confirmar que a VPS atende à janela de observação mínima e possui RAM, swap e CPU disponíveis para acomodar os novos serviços de homologação.

### 2. Seleção de Topologia de Homologação
- Confirmar a topologia aprovada (EasyPanel com containers dedicados ou Docker Compose isolado).

### 3. Criação do Banco de Dados Dedicado
- Criar a base de dados dedicada `zafira_hub_21_staging` no serviço de PostgreSQL aprovado.
- Rejeitar estritamente o uso da base de produção `zafira_hub_v2`.

### 4. Geração de Secrets Criptográficos
- Gerar strings aleatórias e seguras para:
  - `COOKIE_SECRET`
  - `JWT_SECRET`
  - `HUB_INTERNAL_API_KEY`
- Configurar em runtime/painel sem salvar em repositório.

### 5. Configuração de Credenciais de Pull do GHCR
- Configurar credencial de leitura (`packages:read`) para permitir o download das imagens privadas no registry `ghcr.io`.

### 6. Backup do Banco de Staging (Se Persistente)
- Se o ambiente já contiver dados prévios de homologação, gerar backup no formato `pg_dump -Fc` antes de qualquer alteração de schema.

### 7. Definição das Imagens por Digest
- Obter os digests exatos validados no CI:
  - `API_IMAGE_REF=ghcr.io/julianogdc/zafira-hub-api@sha256:<digest>`
  - `WEB_IMAGE_REF=ghcr.io/julianogdc/zafira-hub-web@sha256:<digest>`
- Validar as referências com `./scripts/homologation/validate-immutable-images.sh`.

### 8. Execução de Migrations (Migrate Deploy)
- Executar o container da API para aplicar as migrations com `./scripts/homologation/migrate.sh`.
- Confirmar que as 14 migrations foram aplicadas com `./scripts/homologation/migration-status.sh`.

### 9. Inicialização da API
- Subir o container da API injetando `DATABASE_URL`, `PORT=3001`, `NODE_ENV=production` e secrets.
- Garantir que a API não fique exposta diretamente à internet pública.

### 10. Validação de Liveness e Database Readiness
- Aferir os endpoints da API:
  - `GET /health` => HTTP 200 `{"status":"ok"}`
  - `GET /health/database` => HTTP 200 `{"status":"connected"}`

### 11. Inicialização da Web (Frontend)
- Subir o container Web injetando `API_UPSTREAM=http://<api-host>:3001`.

### 12. Configuração de Roteamento / Domínio / HTTPS
- Configurar proxy reverso (Traefik / EasyPanel) apontando o domínio de homologação para o serviço Web.

### 13. Execução de Smoke Tests
- Executar `./scripts/homologation/smoke.sh` apontando para o domínio ou URL base de homologação.
- Validar raiz `GET /`, proxy `/hub-api/health` e `/hub-api/health/database`.

### 14. Validação de Autenticação e Sessão
- Testar fluxo de login, emissão de cookie assinado e renovação de token.

### 15. Validação de Múltiplas Organizações (A / B)
- Provisionar organizações de teste (ex.: Org Alpha e Org Beta).

### 16. Verificação do Portão de Isolamento (Isolation Gate)
- Executar testes de contenção de dados garantindo que usuários da Org A não acessem dados da Org B.

### 17. Verificação de Observabilidade e Métricas
- Confirmar que `/hub-api/metrics` retorna 401 sem autenticação e 200 com `x-hub-internal-api-key`.
- Confirmar fluxo de logs estruturados (Fastify/Pino).

### 18. Registro de Evidências e Plano de Rollback
- Registrar hash das imagens implantadas, logs de migração, status de healthcheck e par de rollback preparado em caso de falha.
