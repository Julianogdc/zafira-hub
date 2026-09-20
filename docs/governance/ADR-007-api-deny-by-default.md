# ADR-007: API Deny-by-Default e Proteção de Superfície

## Contexto e Problema
A versão original da API utilizava autenticação apenas onde era estritamente declarada (opt-in) e, muitas vezes, confiava apenas em uma validação simples de role (`ADMIN`, `MANAGER`). Com a evolução para a versão 2.1, essa abordagem deixou a superfície exposta a erros de omissão e dificultou o isolamento seguro de tenants (multiempresa), além de ferir o princípio do menor privilégio.

## Decisão
Estabelecemos a regra de "Deny-by-Default" (negação por padrão) para toda a superfície da API do Zafira Hub 2.1.
1. A ausência de um mecanismo de autorização em uma rota significa que ela negará o acesso.
2. Todas as rotas atuais (existentes) e futuras devem ser explicitamente classificadas e mapeadas em uma de três categorias de acesso:
   - **HUMAN_AUTHENTICATED**: Rotas acessadas por usuários reais, requerem `authenticate` e validação de `requirePermission(...)`.
   - **MACHINE_AUTHENTICATED**: Rotas chamadas por máquinas ou serviços terceiros (ex: webhooks Asaas/Postiz), validam segredos via header (HMAC, Token), sem usar o cookie de sessão do usuário.
   - **PUBLIC_INTENTIONAL**: Rotas abertas de forma explícita e intencional, que não exigem credenciais prévias (ex: login, health check). Devem incluir o comentário explícito declarando esse estado.

## Execução Técnica Inicial (Fase 1 - Passo 10)
Nesta fase (Fase 1, Passo 10), aplicamos a política sobre as rotas existentes (Auth, Clients, Financial, Asana, Postiz, Asaas, Inter), substituindo as verificações antigas (`requireRole`) pelo motor de permissões do RBAC (`requirePermission`), usando o catálogo padrão existente (ex: `financial.view_summary`, `financial.edit`, `integrations.view`). As integrações de servidor (webhooks) foram categorizadas como `MACHINE_AUTHENTICATED` e receberam as anotações apropriadas. O schema, banco de dados e contratos de payload permanecem inalterados.

## Impacto
- Segurança reforçada pela matriz de papéis (Policy Engine) ao invés de simples role-checks embutidos no código.
- Extensibilidade imediata para futuras permissões detalhadas sem precisar alterar as rotas novamente.
- Mapeamento explícito de toda a superfície, facilitando auditorias automatizadas e detecção de anomalias (Shadow APIs).

**Data da Decisão:** 19/09/2026
**Status:** Aceito (Fase 1 - Passo 10)

## Regras Especificas e Excecoes Legitimas
- **Session como Excecao Humana:** A rota `/api/v1/auth/session` exige autenticacao valida (pertence a classe `HUMAN_AUTHENTICATED`), mas por ser uma consulta de identidade, nao exige `Permission` de negocio especifica.
- **Logout Publico Idempotente:** A rota `/api/v1/auth/logout` e classificada como `PUBLIC_INTENTIONAL`, pois seu proposito e puramente limpar o cookie de forma idempotente, nao alterando usuarios, organizacoes, nem acessos de terceiros.
- **OAuth Callback Baseado em State/Nonce:** Callbacks OAuth (como o do Asana) sao fluxos tecnicos que validam autoria atraves do parametro `state` (nonce/HMAC). Por isso, sao tratados como `MACHINE_AUTHENTICATED` ou equivalentes de fluxo tecnico, e nao exigem sessao de usuario no instante do retorno.
- **UI Nao e Autoridade:** A protecao de uma rota nunca pode depender puramente da camada de apresentacao ou interface de usuario (UI). A aplicacao de `requirePermission` valida regras estritamente no backend.
- **Aliases Legados:** Rotas duplicadas (ex: `/integrations/...` e `/api/integrations/...`) foram protegidas simultaneamente nesta fase com o mesmo nivel de rigor, mas sua unificacao ou exclusao (resolucao de aliases legados) nao e tratada nesta etapa para nao quebrar integracoes existentes de maquina.
