# ADR-009 — Configurações da Organização e Feature Flags

Status: Aprovado
Data: 21 de setembro de 2026

## Contexto

O Zafira Hub 2.1 opera sob arquitetura multiempresa isolada. Cada organização possui necessidades operacionais próprias (como timezone, moeda e idioma) e habilitação modular de funcionalidades por plano ou estágio de rollout (feature flags).

## Decisão

1. **Escopo Organizacional Estrito**:
   - `OrganizationConfig` e `OrganizationFeatureFlag` são entidades estritamente vinculadas à `Organization` (`organizationId`).
   - Nenhuma consulta ou mutação aceita `organizationId` arbitrário informado pelo cliente (seja via query, body ou cabeçalho falso). O tenant é resolvido exclusivamente pelo contexto de autorização da sessão ativa (`authContext.activeOrganizationId`).

2. **Feature Flags NÃO São Autorização**:
   - Feature flags determinam a disponibilidade sistêmica de um módulo/recurso para o tenant.
   - RBAC (`RolePermission` e permissões individuais) continua sendo a autoridade de segurança mandatória.
   - Regra: `Funcionalidade acessível = Feature flag habilitada AND Permission concedida`. Se a flag estiver ativa mas a permissão for negada, o acesso continua bloqueado (`403 Forbidden`).

3. **Catálogo Canônico e Ausência de Flag**:
   - As chaves de feature flags são definidas em catálogo tipado estático no código (`FEATURE_FLAGS`).
   - A ausência de registro de uma flag no banco de dados para a organização equivale a `enabled = false` (disabled by default).
   - O catálogo cobre apenas módulos de negócio/aplicação (ex: `CLIENT_360`, `FINANCIAL`, `CONTENT_APPROVAL`). Módulos essenciais de fundação (`AUTH`, `RBAC`, `AUDIT`, `SECURITY`) nunca são desligáveis por feature flag.

4. **Configurações Padrão e Idempotência**:
   - Caso a organização ainda não possua `OrganizationConfig` persistido, `getConfig` retorna valores padrão idempotentes:
     - `locale`: `pt-BR`
     - `timezone`: `UTC`
     - `currency`: `BRL`
   - O timezone é validado contra o catálogo padrão da IANA (via `Intl.DateTimeFormat`), a moeda deve ser código ISO de 3 letras maiúsculas e o locale deve ser válido.

5. **Auditoria Obrigatória e Atômica**:
   - Toda alteração em `OrganizationConfig` ou `OrganizationFeatureFlag` deve produzir um `AuditLog` organizacional (`organization.config_changed` ou `feature_flag.changed`).
   - A mutação e o registro no `AuditLog` devem ser executados dentro da mesma transação (`prisma.$transaction`) sempre que aplicável.

6. **Permissões de Acesso**:
   - Leitura (`GET /api/v1/organization/config`, `GET /api/v1/organization/feature-flags`): `HUMAN_AUTHENTICATED` (usuário autenticado com organização ativa).
   - Modificação (`PATCH /api/v1/organization/config`, `PATCH /api/v1/organization/feature-flags/:key`): exige permissão `admin.configure_organization`.
