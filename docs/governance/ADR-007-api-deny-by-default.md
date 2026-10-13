# ADR-007: API Deny-by-Default e Proteção de Superfície

## Contexto e Problema
A versão original da API utilizava autenticação apenas onde era estritamente declarada (opt-in) e, muitas vezes, confiava apenas em uma validação simples de role (`ADMIN`, `MANAGER`). Com a evolução para a versão 2.1, essa abordagem deixou a superfície exposta a erros de omissão e dificultou o isolamento seguro de tenants (multiempresa), além de ferir o princípio do menor privilégio.

Adicionalmente, o middleware de autenticação original atribuía `role: 'ADMIN'` ao contexto de API key interna, e `requirePermission()` fazia bypass para qualquer API key (com ou sem `allowedOrganizationIds`), efetivamente concedendo privilégios plenos a credenciais de máquina sobre rotas humanas.

## Decisão
Estabelecemos a regra de "Deny-by-Default" (negação por padrão) para toda a superfície da API do Zafira Hub 2.1.

### Três Classes de Acesso

1. **HUMAN_AUTHENTICATED**: Rotas acessadas por usuários reais, requerem `authenticate` e validação de `requirePermission(...)`.
2. **MACHINE_AUTHENTICATED**: Rotas chamadas por máquinas ou serviços terceiros (ex: webhooks Asaas/Asana), validam segredos via header (HMAC, Token), sem usar o cookie de sessão do usuário.
3. **PUBLIC_INTENTIONAL**: Rotas abertas de forma explícita e intencional, que não exigem credenciais prévias (ex: login, health check). Devem incluir o comentário explícito declarando esse estado.

### Regras Específicas e Exceções Legítimas

- **Deny-by-Default**: A ausência de um mecanismo de autorização em uma rota significa que ela negará o acesso por padrão.
- **Session como Exceção Humana**: A rota `/api/v1/auth/session` exige autenticação válida (classe `HUMAN_AUTHENTICATED`), mas por ser uma consulta de identidade, não exige `Permission` de negócio específica.
- **Logout Público Idempotente**: A rota `/api/v1/auth/logout` é classificada como `PUBLIC_INTENTIONAL`, pois seu propósito é puramente limpar o cookie de forma idempotente, sem alterar usuários, organizações, nem acessos de terceiros.
- **OAuth Callback Baseado em State/Nonce**: Callbacks OAuth (como o do Asana) são fluxos técnicos que validam autoria através do parâmetro `state` (nonce/HMAC). Por isso, são tratados como `MACHINE_AUTHENTICATED`, e não exigem sessão de usuário no instante do retorno.
- **UI Não é Autoridade**: A proteção de uma rota nunca pode depender puramente da camada de apresentação ou interface de usuário (UI). A aplicação de `requirePermission` valida regras estritamente no backend.
- **Aliases Legados**: Rotas duplicadas (ex: `/integrations/...` e `/api/integrations/...`) foram protegidas simultaneamente nesta fase com o mesmo nível de rigor. A unificação ou exclusão de aliases não é tratada nesta etapa para não quebrar integrações existentes de máquina.

### Hardening da API Key Interna (Passo 10C)

- **API key é credencial de MACHINE**: A `HUB_INTERNAL_API_KEY` representa exclusivamente uma credencial de servidor (`type: 'api_key'`). Ela NÃO representa um administrador humano.
- **Sem `role: 'ADMIN'`**: `AuthApiKeyContext` não possui campo `role`. Atribuir `role: 'ADMIN'` a uma credencial de máquina é proibido.
- **`requirePermission()` é autorização humana**: Se `auth.type === 'api_key'`, `requirePermission()` retorna `403 MACHINE_CREDENTIAL_NOT_ALLOWED`. Não há bypass.
- **`requireRole()` também nega API key**: Se `auth.type === 'api_key'`, `requireRole()` retorna `403 MACHINE_CREDENTIAL_NOT_ALLOWED`.
- **API key sem `allowedOrganizationIds` NÃO tem full access**: Credenciais sem `allowedOrganizationIds` configurado NÃO obtêm acesso pleno via `requirePermission`. O único caminho de autorização para API key em rotas financeiras é através do `resolveFinancialContext` com `allowedOrganizationIds` explícito e endpoint marcado como `MACHINE_AUTHENTICATED`.
- **Endpoints machine usam proteção técnica explícita**: Rotas `MACHINE_AUTHENTICATED` devem usar `internalAuthHook` ou validação HMAC/token equivalente — não `requirePermission`.

### Mapeamento de Permissions Financial (Fase 1, Passo 10C)

| Permission | Rotas |
|---|---|
| `financial.view_summary` | GET /financial/accounts/overview, /api/financial/accounts/overview |
| `financial.view_details` | GET /financial/transactions, /financial/categories, /financial/category-rules, /financial/category-rules/preview (POST), /integrations/inter/repair-duplicates/preview, /integrations/inter/diagnostics/date-fields, /integrations/inter/preview-enriched-times |
| `financial.edit` | POST/PATCH/DELETE /financial/categories/*, /financial/category-rules/*, PATCH /financial/transactions/:id/category, POST /financial/categories/:id/migrate, /integrations/inter/repair-duplicates (todos os aliases), POST /integrations/inter/apply-enriched-times |
| `financial.reconcile` | PATCH /financial/transfers/:id/confirm |
| `integrations.sync` | POST /integrations/asaas/sync-ledger, POST /integrations/inter/sync, POST /integrations/inter/reprocess |

## Execução Técnica (Fase 1 - Passos 10, 10B e 10C)

- **Passo 10**: Classificação inicial das rotas, proteção com `requirePermission`, criação do teste de superfície.
- **Passo 10B**: Auditoria completa, correção de classificações, movimentação do teste para glob padrão.
- **Passo 10C**: Hardening da `HUB_INTERNAL_API_KEY`, correção do `financial.routes.ts` (32 → 0 `requireRole`, 0 → 52 `requirePermission`), remoção do gate `ADMIN/MANAGER` do `resolveFinancialContext`, adição dos testes estáticos anti-`requireRole` e de API key.

## Impacto
- Segurança reforçada pela matriz de papéis (Policy Engine) ao invés de simples role-checks embutidos no código.
- Extensibilidade imediata para futuras permissões detalhadas sem precisar alterar as rotas novamente.
- Mapeamento explícito de toda a superfície, facilitando auditorias automatizadas e detecção de anomalias (Shadow APIs).
- Credenciais de máquina completamente isoladas de rotas humanas.

**Data da Decisão:** 19/09/2026
**Status:** Aceito (Fase 1 - Passo 10C)
