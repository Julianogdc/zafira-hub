# Observabilidade, Métricas e Operação do Zafira Hub 2.1

## 1. Visão Geral
Este documento estabelece os padrões operacionais de observabilidade, registro de logs, métricas do Prometheus, correlation IDs e healthchecks da API e Frontend do Zafira Hub 2.1.

---

## 2. Endpoints de Diagnóstico e Saúde

### 2.1 Liveness (`GET /health`)
- **Finalidade:** Liveness probe (indica se a API HTTP está viva e recebendo conexões).
- **Acesso:** Público (`PUBLIC_INTENTIONAL`).
- **Comportamento:** Retorna status `200 OK` imediatamente, sem dependência do banco de dados ou serviços externos.
- **Resposta típica:**
  ```json
  {
    "status": "ok",
    "service": "zafira-hub-api"
  }
  ```

### 2.2 Readiness e Saúde de Dependências (`GET /health/database`)
- **Finalidade:** Readiness probe e verificação de saúde do PostgreSQL.
- **Acesso:** Público (`PUBLIC_INTENTIONAL`).
- **Comportamento:** Executa `SELECT 1` no banco de dados.
- **Respostas:**
  - **Sucesso (200 OK):**
    ```json
    {
      "status": "ok",
      "database": "connected"
    }
    ```
    *Efeito em métrica:* `zafira_database_health = 1`
  - **Falha (503 Service Unavailable):**
    ```json
    {
      "status": "error",
      "database": "disconnected"
    }
    ```
    *Efeito em métrica:* `zafira_database_health = 0`

---

## 3. Métricas Prometheus (`GET /metrics`)

### 3.1 Acesso e Autenticação (Machine-Only)
O endpoint `/metrics` exporta dados no formato Prometheus / OpenMetrics e é restrito a **serviços coletores e monitoramento de máquina**.
- **Autenticação:** Header `x-api-key: <HUB_INTERNAL_API_KEY>`.
- **Controle de Acesso:**
  - Sem credencial: `401 Unauthorized`
  - Chave inválida: `401 Unauthorized`
  - Usuário com JWT humano: `403 Forbidden` (`code: 'MACHINE_CREDENTIAL_REQUIRED'`)
- **Content-Type:** `text/plain; version=0.0.4; charset=utf-8` ou OpenMetrics.

### 3.2 Métricas Disponíveis
| Nome da Métrica | Tipo | Labels | Descrição |
|---|---|---|---|
| `zafira_http_requests_total` | Counter | `method`, `route`, `status_code` | Total de requisições HTTP processadas |
| `zafira_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições HTTP em segundos |
| `zafira_database_health` | Gauge | — | Estado da conexão com o banco (1=conectado, 0=desconectado) |
| `zafira_database_healthcheck_duration_seconds` | Histogram | — | Tempo de resposta da query de teste `SELECT 1` |
| `process_cpu_user_seconds_total` | Counter | — | Tempo de CPU gasto em espaço de usuário |
| `process_resident_memory_bytes` | Gauge | — | Memória residente (RSS) utilizada pelo Node.js |
| `nodejs_eventloop_lag_seconds` | Gauge | — | Atraso no event loop do Node.js |

### 3.3 Regras de Cardinalidade e Privacidade
- **Baixa Cardinalidade:** A label `route` utiliza estritamente o template da rota do Fastify (ex: `/api/v1/clients/:id`), nunca IDs dinâmicos.
- **Zero Dados Sensíveis:** Nenhuma métrica expõe IDs de usuários, tokens, e-mails, organizações ou payloads.

---

## 4. Logs Estruturados e Rastreamento

### 4.1 Níveis de Log (`LOG_LEVEL`)
Configurado pela variável de ambiente `LOG_LEVEL` (default: `info`). Em ambiente `NODE_ENV=test`, o logger padrão é desativado para manter os relatórios de teste limpos.

### 4.2 Request / Correlation ID (`x-request-id`)
- Toda requisição recebe um identificador único gerado pelo Fastify (`request.id`).
- O servidor injeta o header `x-request-id` em todas as respostas HTTP (incluindo sucessos e erros).
- Logs gerados no contexto da requisição (`request.log.*`) contêm automaticamente o campo `reqId`.

### 4.3 Redação de Segredos (Redaction)
O logger Pino utiliza sanitização ativa que substitui valores sensíveis por `[REDACTED]`. Campos cobertos incluem:
- Headers: `authorization`, `cookie`, `x-api-key`, `set-cookie`
- Campos em objetos/JSON: `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `clientSecret`.

---

## 5. Healthcheck em Containers Docker

### 5.1 Container da API (`apps/api/Dockerfile`)
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
```
*Justificativa:* Utiliza o endpoint `/health` (liveness) para evitar reinicializações espúrias do container Node em caso de indisponibilidades transitórias do banco de dados.

### 5.2 Container Web (`apps/web/Dockerfile`)
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
```

---

## 6. Recomendações para Monitoramento Externo

> [!IMPORTANT]
> **EXTERNAL MONITORING PENDING HOMOLOGATION**
> O monitoramento externo e alertas ativos serão configurados e acoplados após a implantação do ambiente de homologação.

### Alertas e Thresholds Recomendados
1. **API Liveness Probe:**
   - Condição: `GET /health` falhando por mais de 3 checagens consecutivas (90 segundos).
   - Severidade: Crítica (Processo fora do ar).
2. **Database Readiness Probe:**
   - Condição: `zafira_database_health == 0` por mais de 2 checagens consecutivas (60 segundos).
   - Severidade: Alta (Falha de conexão com PostgreSQL).
3. **Taxa de Erros HTTP 5xx:**
   - Condição: Taxa de `5xx` > 1% do total de requisições em uma janela de 5 minutos.
   - Severidade: Alta.
4. **Latência de Resposta (p95):**
   - Condição: Duração p95 de rotas da API > 2.0s em janela de 10 minutos.
   - Severidade: Média.
5. **Pressão de Memória / CPU:**
   - Condição: RSS do Node.js > 85% do limite alocado para o container de forma sustentada.
   - Severidade: Média.
