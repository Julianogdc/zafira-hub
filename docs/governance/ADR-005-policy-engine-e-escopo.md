# ADR-005 — Policy engine e escopo de autorização

Status: Aprovado

Data: 19 de setembro de 2026

## Decisão

Autenticação e autorização são responsabilidades distintas.

Autenticação estabelece a identidade e a organização ativa.

Autorização verifica:

- membership;
- permission;
- override individual;
- default da role;
- escopo do recurso.

A ausência de grant sempre resulta em deny.

## Ordem

1. User ACTIVE.
2. OrganizationMember válida na organização ativa.
3. Override individual.
4. RolePermission.
5. Deny quando não houver grant.
6. Validação do escopo.

## Override

OrganizationMemberPermission possui precedência sobre RolePermission.

allowed=false é um deny explícito.

allowed=true é um grant explícito.

## Escopo

ADMIN e MANAGER possuem inicialmente escopo organizacional.

MEMBER possui escopo por cliente atribuído quando o recurso estiver ligado a Client.

O vínculo de carteira utiliza UserClientAssignment baseado em OrganizationMember.

Nenhum acesso pode ser autorizado apenas por ID ou externalId.

## Frontend

O frontend poderá refletir permissões para experiência,
mas o backend é a única autoridade de autorização.

## Default roles e autoridade de runtime

ADMIN recebe todas as permissões do catálogo.

MANAGER recebe o conjunto gerencial aprovado no Passo 8C.

MEMBER recebe apenas o conjunto operacional mínimo aprovado.

A matriz estática de defaults é fonte versionada exclusivamente para bootstrap.
No runtime, a tabela `RolePermission` persistida no PostgreSQL é a autoridade real:
a ausência da respectiva `RolePermission` persistida resulta estritamente em deny.
Nenhum fallback estático em memória pode conceder acesso em runtime.


## Fora de escopo

Este ADR não:

- cria custom roles;
- cria UI administrativa;
- implementa TeamClientAssignment;
- altera integrações;
- executa migration;
- define permissões de fases ainda inexistentes além do catálogo já aprovado.
