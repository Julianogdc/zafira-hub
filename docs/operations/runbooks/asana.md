# Runbook Operacional: Integração Asana (Zafira Hub 2.1)

## 1. Visão Geral e Arquitetura Canônica

No Zafira Hub 2.1, o Asana utiliza a camada canônica de integrações:
- **Autenticação e Credenciais:** Persistidas exclusivamente na tabela `IntegrationConnection` (`provider = 'ASANA'`) com segredos criptografados (`credentialCiphertext` via AES-256-GCM).
- **Vínculos de Clientes:** Mantidos na tabela `ClientIntegration` vinculando o `clientId` local ao `externalId` (Project GID do Asana). Vínculos e históricos são **preservados** mesmo se a integração for desconectada.
- **Observabilidade:**
  - `SyncRun`: Trilha de execuções de sincronização de projetos/tarefas (`RUNNING`, `SUCCESS`, `PARTIAL`, `FAILED`).
  - `WebhookEvent`: Deduplicação determinística (`ASANA:<subscriptionId>:<sha256>`) e auditoria de eventos recebidos dos webhooks (`RECEIVED`, `PROCESSED`, `FAILED`, `IGNORED`).
  - `IntegrationError`: Registro operacional de erros (sem dados sensíveis).

---

## 2. Operações do Ciclo de Vida

### 2.1 Conectar / Autorizar (OAuth 2.0)
1. Iniciar o fluxo OAuth no endpoint oficial:
   `GET /integrations/asana/oauth/authorize`
2. O usuário autoriza o aplicativo no Asana.
3. O Asana redireciona para o callback:
   `GET /integrations/asana/oauth/callback?code=...`
4. O backend troca o código por Access Token e Refresh Token, criptografa o payload e salva em `IntegrationConnection` com status `ACTIVE`.
5. Registros legados em `OrganizationIntegration` são automaticamente limpos na migração.

### 2.2 Testar Conexão
- Executar via API canônica da Central de Integrações:
   `POST /api/v1/integrations/ASANA/test`
- O backend busca as credenciais ativas, valida chamando `GET /users/me` no Asana e retorna:
   ```json
   {
     "status": "ok",
     "data": {
       "connected": true,
       "provider": "ASANA",
       "accountName": "Nome do Usuário",
       "externalScopeId": "1234567890",
       "message": "Conexão com o Asana validada com sucesso.",
       "checkedAt": "2026-09-24T12:00:00.000Z"
     }
   }
   ```

### 2.3 Reconectar (Central de Integrações)
- Executar via API canônica:
   `POST /api/v1/integrations/ASANA/reconnect`
- Retorna uma URL segura de autorização (`authUrl`) com novo `state` assinado de uso único:
   ```json
   {
     "status": "ok",
     "data": {
       "reconnected": true,
       "authUrl": "https://app.asana.com/-/oauth_authorize?..."
     }
   }
   ```

### 2.4 Sincronização (Sync)
- Executar via endpoint canônico:
   `POST /api/v1/integrations/ASANA/sync`
- A operação cria um `SyncRun` com status `RUNNING`, processa os projetos e webhooks vinculados aos clientes da organização e finaliza como `SUCCESS`, `PARTIAL` ou `FAILED`.

### 2.5 Desconectar
1. Executar via endpoint canônico da Central:
   `POST /api/v1/integrations/ASANA/disconnect`
   (ou endpoint direto `DELETE /integrations/asana/disconnect`)
2. O backend:
   - Revoga o token remotamente no Asana via RFC 7009 (`/oauth_revoke`);
   - Remove webhooks remotos ativos;
   - Atualiza `IntegrationConnection` para o status `DISCONNECTED`;
   - Exclui registros legados remanescentes;
   - **PRESERVA TODOS** os vínculos `ClientIntegration` (projetos vinculados aos clientes permanecem para integridade histórica);
   - **NÃO** remove projetos ou tarefas reais no Asana.

---

## 3. Webhooks e Deduplicação

### 3.1 Endpoint de Recepção
- `POST /integrations/asana/webhooks/:subscriptionId`

### 3.2 Ciclo de Recepção e Deduplicação
1. **Handshake:** Ao receber `X-Hook-Secret`, salva o segredo da assinatura e ecoa o header no handshake com status `200 OK`.
2. **Validação de Assinatura:** Eventos de webhook são validados com HMAC-SHA256 usando `subscription.secret` e o corpo bruto (`rawBody`).
3. **Deduplicação:** Uma chave única determinística `ASANA:<subscriptionId>:<sha256(rawBody)>` é gravada em `WebhookEvent`.
4. **Entrega Repetida:** Se o Asana reenviar o mesmo payload (`isDuplicate === true`), a API responde `200 OK` sem reprocessar eventos.
5. **Multi-tenant:** O `organizationId` do evento é obtido estritamente do registro de assinatura associado (`subscription.organizationId`).

---

## 4. Tratamento de Incidentes e Resolução de Problemas

### 4.1 Token Expirado (401 Unauthorized)
- O `AsanaService` realiza a renovação automática de access tokens utilizando o `refreshToken` persistido em `IntegrationConnection`.
- Se o refresh falhar (ex.: refresh token revogado no painel do Asana), o status da conexão passa para `ERROR` e um registro é gravado em `IntegrationError`.
- **Ação Operacional:** Solicitar ao usuário administrador que execute a reconexão via OAuth no painel do Hub.

### 4.2 Erros de Rate Limit (429 Too Many Requests)
- O Asana possui limite de requisições por minuto.
- O conector registra falha recuperável (`retryable: true`) em `IntegrationError` e propaga o erro.

---

## 5. Onde Consultar a Observabilidade

- **Execuções de Sincronização:**
  `GET /api/v1/integrations/sync-runs?provider=ASANA`
  Exibe status (`RUNNING`, `SUCCESS`, `PARTIAL`, `FAILED`), itens processados, falhas e duração.

- **Erros Operacionais:**
  `GET /api/v1/integrations/errors?provider=ASANA&resolved=false`
  Exibe mensagem sanitizada, código e se é recuperável (`retryable`).

- **Central de Integrações (Visão Consolidada):**
  `GET /api/v1/integrations/overview`
  Exibe status de todas as integrações da organização, último teste e capacidades suportadas.

---

## 6. Rollback de Migração de Banco de Dados

Caso seja necessário reverter a migration `20260924083000_add_integration_observability_models`:

> [!WARNING]
> Esta migration é puramente aditiva (novas tabelas `sync_runs`, `webhook_events`, `integration_errors`). Sua reversão não afeta dados das tabelas de negócio existentes.

**Comando de Rollback (Ambiente Local/Testes):**
```sql
DROP TABLE IF EXISTS "integration_errors";
DROP TABLE IF EXISTS "webhook_events";
DROP TABLE IF EXISTS "sync_runs";
DROP TYPE IF EXISTS "WebhookEventStatus";
DROP TYPE IF EXISTS "SyncRunStatus";
```
