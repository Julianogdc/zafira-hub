# ADR-003 — Autenticação e sessão do Hub 2.1

Status: Aprovado

Data: 19 de setembro de 2026

## Decisão

O Zafira Hub 2.1 utilizará autenticação própria como mecanismo mestre de identidade.

A implementação será baseada em Fastify, Prisma/PostgreSQL, Argon2 e cookie HTTP-only.

Serviços externos de autenticação não serão fonte de verdade da identidade interna nesta fase.

## Identidade

User é a identidade do Hub.

OrganizationMember determina a relação do usuário com uma organização.

Nenhuma organização poderá ser escolhida implicitamente apenas por ser o primeiro registro retornado pelo banco.

## Sessão

A API canônica será:

POST /api/v1/auth/login
GET /api/v1/auth/session
POST /api/v1/auth/logout

O frontend obtém o estado autenticado exclusivamente através de /api/v1/auth/session.

Tokens de autenticação não serão expostos ao JavaScript do navegador.

## Segurança

Senhas permanecem protegidas por Argon2.

Cookies de sessão devem ser HTTP-only.

Em produção, JWT_SECRET e COOKIE_SECRET obrigatórios não poderão possuir fallback conhecido.

A aplicação deverá falhar na inicialização quando segredo obrigatório de autenticação estiver ausente em produção.

Usuário não ativo não poderá autenticar nem continuar operando através de uma sessão previamente emitida.

O backend deve validar o estado atual do usuário ao resolver uma sessão autenticada.

## Organizações

Quando o usuário possui exatamente uma associação válida, ela pode ser utilizada como organização ativa inicial.

Quando possui múltiplas associações válidas, a aplicação não pode simplesmente selecionar a primeira associação retornada.

O contrato de sessão deve representar as organizações disponíveis de forma explícita.

A seleção/troca completa de organização será consolidada junto ao escopo e RBAC da Fase 1.

## Supabase

Supabase deixa de participar da autenticação e resolução da sessão do Hub 2.1.

Outros usos legados de Supabase serão removidos nas fases correspondentes aos seus módulos.

## HTTP

Auth é o primeiro módulo migrado para a API versionada /api/v1.

As rotas legadas /auth serão removidas no mesmo conjunto de mudança somente após o frontend e os testes migrarem para a API canônica.

## Fora de escopo

Este ADR não implementa:

- RBAC granular;
- equipes;
- clientes atribuídos;
- convites;
- SSO;
- OAuth de identidade;
- recuperação de senha;
- MFA.
