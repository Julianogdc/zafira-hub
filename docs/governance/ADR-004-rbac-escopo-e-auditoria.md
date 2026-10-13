# ADR-004 — RBAC, escopo multiempresa e auditoria

Status: Aprovado

Data: 19 de setembro de 2026

## Contexto

O Hub 2.0 possui autenticação própria e um enum Role com ADMIN, MANAGER e MEMBER, mas não possui permissões granulares, equipes, atribuição de clientes ou auditoria suficiente.

A auditoria confirmou que autorização e isolamento são inconsistentes entre módulos.

O financeiro possui a implementação de isolamento mais rigorosa.

O módulo Clients ainda depende de contexto fixo da organização zafira.

## Decisão

Role permanece como enum base nesta etapa.

Permission representa capacidades granulares.

RolePermission define grants padrão de cada função.

OrganizationMemberPermission permite override explícito individual.

Um override individual sempre prevalece sobre o default da Role.

Ausência de grant resulta em deny.

## Escopo

A autorização sempre parte da OrganizationMember da organização ativa.

Team e TeamMember representam pertencimento a equipes/squads.

UserClientAssignment representa os clientes atribuídos a uma membership específica.

A aplicação não utilizará User global diretamente como vínculo de carteira.

Relações de escopo devem preservar organizationId e impedir vínculos cruzados entre organizações sempre que o banco puder garantir isso.

## Auditoria

Mudanças de acesso deverão gerar AuditLog contendo:

- organização;
- autor;
- ação;
- entidade;
- estado anterior quando aplicável;
- estado posterior quando aplicável;
- data;
- requestId quando disponível.

Segredos e credenciais não poderão ser gravados em AuditLog.

## Avaliação futura da permissão

A ordem será:

1. validar User ACTIVE;
2. validar membership da organização ativa;
3. verificar override individual;
4. se inexistente, verificar RolePermission;
5. ausência de permissão significa deny;
6. validar escopo do recurso.

O frontend poderá ocultar ações sem permissão, mas nunca será autoridade de acesso.

## Papéis

O enum atual:

ADMIN
MANAGER
MEMBER

será preservado.

Não haverá sistema de custom roles nesta etapa.

Especializações de função serão construídas com permissions e scopes.

## Fora de escopo

Este ADR não:

- implementa endpoints de administração de permissões;
- implementa UI de permissões;
- cria custom roles;
- altera integrações;
- cria feature flags;
- altera Clients ainda;
- executa migration em produção.
