# ADR-013: Observabilidade Básica da Fundação, Métricas Prometheus, Logs e Healthchecks

## Status
Aceito (Passo 12C — Fase 1: Fundação)

## Contexto
O Zafira Hub 2.1 requer uma camada sólida de observabilidade operacional para apoiar ambientes de homologação e produção sem comprometer a segurança multi-tenant ou expor dados sensíveis.

Antes deste passo, a aplicação contava apenas com logs simples do Fastify (ativados/desativados via ternário simples) e endpoints básicos `/health` e `/health/database`, sem exportação padronizada de métricas de processo, rede ou banco, sem garantia de redaction sistemático de segredos, sem correlation ID explícito nas respostas HTTP e sem healthchecks declarados nos containers Docker.

## Decisões Arquiteturais

### 1. Separação Estrita entre Log Operacional e AuditLog de Negócio
- **AuditLog (Negócio/Compliance):** Persistido no PostgreSQL com integridade referencial e retenção histórica, escopado por organização, registrando ações humanas ou de sistema de impacto no negócio (`actorUserId`, `entityType`, `entityId`, `action`, `before`, `after`, `metadata`).
- **Fastify/Pino (Log Operacional):** Logs estruturados JSON em stdout do processo para diagnóstico em tempo real, debugging e rastreamento de falhas de infraestrutura e execução HTTP.

### 2. Request / Correlation ID Canônico
- O Fastify gera um `request.id` unívoco para cada requisição recebida.
- O header `x-request-id: <request.id>` é devolvido em todas as respostas HTTP (incluindo sucessos, erros 4xx e 5xx).
- Clientes não podem forçar um correlation ID que substitua o ID gerado pelo servidor como autoridade canônica.
- Erros de rota herdam o logger de requisição (`request.log.error`) vinculando automaticamente o `reqId` correspondente.

### 3. Sanitização e Redação de Segredos (Redaction)
- Pino/Fastify é configurado com lista explícita de campos a serem redigidos com `[REDACTED]`.
- Paths obrigatórios: `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-api-key"]`, `res.headers["set-cookie"]`, `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `clientSecret`, e variações de propriedades aninhadas.
- Nenhuma credencial (JWT, API key interna `HUB_INTERNAL_API_KEY`, senhas de usuário, tokens de convite) pode ser impressa em logs, respostas ou métricas.

### 4. Padrão Prometheus / OpenMetrics e Isolamento de Registries
- As métricas são exportadas na sintaxe do Prometheus / OpenMetrics utilizando a biblioteca `prom-client`.
- Cada instância de aplicação (`buildApp()`) instancia seu próprio `Registry` independente, eliminando vazamentos de estado e colisões de `duplicate metric name` durante a execução de testes automatizados paralelos.

### 5. Baixa Cardinalidade e Proteção de Privacidade em Métricas
- Métricas são no nível de **processo e infraestrutura**, nunca no nível de inquilino (tenant) ou usuário.
- Nenhuma métrica conterá: `userId`, `email`, `organizationId`, `clientId`, `token` ou dados de payload.
- As labels HTTP permitidas são estritamente: `method`, `route`, `status_code`.
- A label `route` utiliza o **template da rota Fastify** (ex: `/api/v1/clients/:id`) e NUNCA o caminho com parâmetros reais (ex: `/api/v1/clients/c123...`) para prevenir explosão de cardinalidade.

### 6. Métricas Coletadas
- **Processo:** Métricas padrão do Node.js/V8 (`collectDefaultMetrics`) como uso de CPU, heap de memória, event loop lag e descritores de arquivo.
- **HTTP:**
  - Counter: `zafira_http_requests_total` com labels `[method, route, status_code]`.
  - Histogram: `zafira_http_request_duration_seconds` com labels `[method, route, status_code]` e buckets conservadores para APIs web.
- **Banco de Dados (Healthcheck):**
  - Gauge: `zafira_database_health` (1 = conectado, 0 = desconectado).
  - Histogram: `zafira_database_healthcheck_duration_seconds` medindo a latência do comando `SELECT 1`.

### 7. Proteção do Endpoint `/metrics` (Machine-Only)
- O endpoint `GET /metrics` é restrito a **credenciais de máquina** (`x-api-key: HUB_INTERNAL_API_KEY`).
- Sem credencial: `401 Unauthorized`.
- API key inválida: `401 Unauthorized`.
- Usuário humano autenticado (JWT): `403 Forbidden` (`code: 'MACHINE_CREDENTIAL_REQUIRED'`).
- Não são criadas permissões humanas de RBAC para acesso a métricas de processo.

### 8. Semântica de Healthchecks: Liveness vs Readiness
- **Liveness (`GET /health`):** Retorna `200 OK` quando o processo Node/Fastify está respondendo. Não consulta o banco de dados. Usado pelos orquestradores de container para saber se o processo precisa ser reiniciado.
- **Readiness / Dependency Health (`GET /health/database`):** Valida a conectividade real com o PostgreSQL via `SELECT 1`. Retorna `200 OK` com `database: connected` (gauge = 1) ou `503 Service Unavailable` com `database: disconnected` (gauge = 0).

### 9. Healthchecks em Containers Docker
- `apps/api/Dockerfile`: Adicionada diretiva `HEALTHCHECK` consultando `http://127.0.0.1:3001/health` via Node.js liveness check. Indisponibilidades transitórias do PostgreSQL não causam restart em cascata do container da API.
- `apps/web/Dockerfile`: Adicionada diretiva `HEALTHCHECK` consultando `http://127.0.0.1/` via `wget` nativo do `nginx:alpine`.

### 10. Integração de Monitoramento Externo
- O monitoramento externo (ex: Uptime Kuma, Prometheus Server) será conectado após a implantação do ambiente de homologação, utilizando o endpoint autenticado `/metrics` e os endpoints de health.

## Consequências e Invariantes Preservadas
- Zero alterações no schema Prisma e zero novas migrations.
- Invariante de RBAC preservada: 0 `requireRole` em rotas, 52/52 rotas financeiras protegidas por `requirePermission`.
- Separação estrita de escopo de clientes e squads preservada.
- Credenciais internas de máquina permanecem sem permissões ou papéis humanos.
