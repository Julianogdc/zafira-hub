# ADR-010 — Lifecycle de usuário e membership

## Decisão

User representa identidade global.

OrganizationMember representa participação do usuário
em uma organização específica.

Suspensão operacional normal é organization-scoped.

## UserStatus

ACTIVE
INVITED
INACTIVE

## OrganizationMemberStatus

ACTIVE
INVITED
SUSPENDED

## Autenticação

Conta global precisa estar ACTIVE.

## Membership

Somente membership ACTIVE concede acesso à organização.

INVITED e SUSPENDED:

não podem autorizar recursos da organização.

## Segurança

Admin de Org A não pode suspender acesso do usuário à Org B.

User.status INACTIVE fica reservado para desativação global
de conta em nível de plataforma/futuro super-admin.
