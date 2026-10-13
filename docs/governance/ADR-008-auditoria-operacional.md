# ADR-008 — Auditoria operacional do Hub

Status: Aprovado

Data: 21 de setembro de 2026

## Decisão

Toda alteração administrativa relevante do Hub deverá
produzir AuditLog organization-scoped.

AuditLog registra:

- organizationId;
- actorUserId quando houver ator humano;
- action;
- entityType;
- entityId quando aplicável;
- before;
- after;
- metadata segura;
- createdAt.

AuditLog é append-only em nível de aplicação.

Não existirão endpoints comuns de update/delete de AuditLog.

## Segurança

AuditLog nunca armazena:

- passwordHash;
- JWT;
- cookies;
- API keys;
- OAuth tokens;
- provider secrets;
- authorization headers;
- segredos ou credenciais equivalentes.

## Tenant

Toda consulta exige organizationId resolvido pela autorização.

Nenhum ID fornecido pelo cliente pode atravessar organização.

## Autorização de leitura

Leitura exige:

admin.view_audit

## Integração futura

Ações de:

- usuários;
- roles;
- permissões;
- assignments;
- configuração de organização;
- integrações administrativas;
- feature flags;

usarão o mesmo serviço central.
