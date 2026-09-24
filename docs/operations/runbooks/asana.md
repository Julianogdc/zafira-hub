# Runbook Operacional: Integração Asana (Zafira Hub 2.1)

## 1. Visão Geral e Arquitetura Canônica

No Zafira Hub 2.1, o Asana utiliza a camada canônica de integrações:
- **Autenticação e Credenciais:** Persistidas exclusivamente na tabela `IntegrationConnection` (`provider = 'ASANA'`) com segredos criptografados (`credentialCiphertext` via AES-256-GCM).
- **Vínculos de Clientes:** Mantidos na tabela `ClientIntegration` vinculando o `clientId` local ao `externalId` (Project GID do Asana).
- **Observabilidade:**
  - `SyncRun`: Trilha de execuções de sincronização de projetos/tarefas.
  - `WebhookEvent`: Deduplicação e auditoria de eventos recebidos dos webhooks.
  - `IntegrationError`: Registro operacional de erros (sem dados sensíveis).

---

## 2. Operações do Ciclo de Vida

### 2.1 Conectar (OAuth 2.0)
1. Iniciar o fluxo OAuth no endpoint:
   `GET /api/v1/integrations/asana/oauth/authorize`
2. O usuário autoriza o aplicativo no Asana.
3. O Asana redireciona para o callback:
   `GET /api/v1/integrations/asana/oauth/callback?code=...`
4. O backend troca o código por Access Token e Refresh Token, criptografa o payload e salva em `IntegrationConnection` com status `ACTIVE`.
5. Registros legados em `OrganizationIntegration` são automaticamente limpos.

### 2.2 Testar Conexão
1. Executar via API canônica:
   `POST /api/v1/integrations/asana/test`
2. O backend busca as credenciais ativas, valida chamando `GET /users/me` no Asana e retorna:
   ```json
   {
     "success": true,
     "provider": "ASANA",
     "accountName": "Nome do Usuário",
     "workspaceId": "1234567890",
     "latencyMs": 142
   }
   ```

### 2.3 Reconectar / Atualizar Credenciais
- Para renovar permissões ou trocar o usuário administrador conectado, basta iniciar novamente o fluxo OAuth (`/api/v1/integrations/asana/oauth/authorize`). A conexão existente será atualizada no `IntegrationConnection` mantendo o histórico de projetos.

### 2.4 Sincronização (Sync)
- Executar via endpoint canônico:
   `POST /api/v1/integrations/asana/sync`
- A operação cria um `SyncRun` com status `RUNNING`, processa os projetos e webhooks vinculados aos clientes da organização e finaliza como `SUCCESS` ou `FAILED`.

### 2.5 Desconectar
1. Executar via endpoint canônico ou específico:
   `POST /api/v1/integrations/asana/disconnect`
2. O backend:
   - Revoga o token remotamente no Asana via RFC 7009 (`/oauth_revoke`).
   - Remove webhooks remotos ativos.
   - Remove os vínculos `ClientIntegration` da organização.
   - Marca `IntegrationConnection` como `DISCONNECTED`.
   - Exclui registros legados remanescentes.

---

## 3. Tratamento de Incidentes e Resolução de Problemas

### 3.1 Token Expirado (401 Unauthorized)
- O `AsanaService` realiza a renovação automática de access tokens utilizando o `refreshToken` persistido em `IntegrationConnection`.
- Se o refresh falhar (ex.: refresh token revogado no painel do Asana), o status da conexão passa para `ERROR` e um registro é gravado em `IntegrationError`.
- **Ação Operacional:** Solicitar ao usuário administrador que execute a reconexão via OAuth no painel do Hub.

### 3.2 Erros de Rate Limit (429 Too Many Requests)
- O Asana possui limite de requisições por minuto.
- O conector registra falha recuperável (`retryable: true`) em `IntegrationError` e propaga o cabeçalho `Retry-After`.

### 3.3 Falha de Webhook e Handshake
- Ao receber o handshake inicial (`X-Hook-Secret`), o Hub responde com `200 OK` e ecoa o header.
- Eventos recebidos são gravados e deduplicados em `WebhookEvent` pela chave única `provider_dedupeKey`.
- Se a assinatura HMAC for inválida, o evento é rejeitado com status `401`.

---

## 4. Onde Consultar a Observabilidade

- **Execuções de Sincronização:**
  `GET /api/v1/integrations/sync-runs?provider=ASANA`
  Exibe status, itens processados, falhas e duração.

- **Erros Operacionais:**
  `GET /api/v1/integrations/errors?provider=ASANA&resolved=false`
  Exibe mensagem sanitizada, código e se é recuperável (`retryable`).

- **Central de Integrações (Visão Consolidada):**
  `GET /api/v1/integrations/overview`
  Exibe status de todas as integrações da organização, último teste e capacidades suportadas.

---

## 5. Rollback de Migração de Banco de Dados

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
