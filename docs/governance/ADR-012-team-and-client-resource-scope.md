# ADR-012: Equipes (Teams), Squads e Escopo de Recursos de Clientes

## Status
Aprovado

## Contexto
No Zafira Hub 2.1, a fundação relacional introduziu as entidades `Team` e `TeamMember`, enquanto a autorização de ações foi modelada em torno de `RolePermission` persistida em banco de dados e `OrganizationMemberPermission` para overrides individuais por usuário.
No entanto, a visibilidade de recursos de negócio — especificamente o acesso a `Client` — necessitava de uma separação formal entre **Permissão de Ação (Permission)** e **Escopo de Recurso (Resource Scope)**.

Na baseline anterior, o papel `MANAGER` possuía visibilidade irrestrita a todos os clientes da organização, enquanto `MEMBER` dependia exclusivamente de `UserClientAssignment` individual. Para permitir squads, equipes multidisciplinares e controle de visibilidade sem poluir o catálogo de permissões, faz-se necessária a introdução do `TeamClientAssignment` e da composição de escopo por união direta e indireta.

## Decisões

1. **Separação Estrita entre Permissão e Escopo de Recurso:**
   - **Permission:** responde à pergunta *"O usuário tem autorização para executar esta ação?"* (ex: `clients.view`, `clients.create`, `clients.edit`). É resolvida exclusivamente pelo Policy Engine via `RolePermission` persistida combinada com `OrganizationMemberPermission` (overrides individuais).
   - **Resource Scope:** responde à pergunta *"Sobre quais entidades específicas o usuário pode executar a ação autorizada?"* (ex: quais clientes ele pode visualizar ou editar).
   - `Team` **NÃO** concede `RolePermission`. Pertencer a uma equipe jamais transforma uma permissão negada em permitida.

2. **Hierarquia e Regras de Escopo de Clientes:**
   - **ADMIN:** Possui escopo irrestrito dentro de sua organização (`organization-wide`).
   - **MANAGER e MEMBER:** Possuem escopo restrito baseado na **união** de duas fontes:
     1. *Direct Assignment:* Vínculo direto via `UserClientAssignment` entre o membro e o cliente.
     2. *Team Assignment:* Vínculo via `TeamClientAssignment` associado a uma `Team` **ativa** (`isActive = true`) da qual o membro participe (`TeamMember`).

3. **Comportamento de Equipes Inativas:**
   - Quando uma equipe é desativada (`isActive = false`), seus vínculos com membros e clientes são preservados no banco de dados para integridade histórica.
   - Contudo, a equipe inativa deixa imediatamente de contribuir para o cálculo do escopo de recursos de seus membros.
   - Ao ser reativada (`isActive = true`), o escopo derivado é imediatamente restaurado.

4. **Preservação de Overrides Individuais:**
   - Se um membro ou gerente possui uma negação de permissão explícita (ex: `clients.view = false`), ele não terá acesso ao cliente mesmo que este esteja atribuído à sua equipe ativa. A permissão é avaliada antes do escopo.

5. **Auto-atribuição na Criação de Clientes (Non-Admin Creators):**
   - Quando um `MANAGER` ou `MEMBER` com permissão concedida cria um cliente, o sistema cria automaticamente, na mesma transação atômica (`prisma.$transaction`), um `UserClientAssignment` para o membro criador. Isso garante que o usuário não perca o acesso ao cliente recém-criado.
   - Administradores (`ADMIN`) continuam não necessitando de auto-atribuição, pois possuem escopo global na organização.

6. **Integridade Referencial e Isolamento Multi-tenant:**
   - A tabela `team_client_assignments` utiliza restrições de chave estrangeira compostas (`[organizationId, teamId]` -> `teams[organizationId, id]` e `[organizationId, clientId]` -> `clients[organizationId, id]`), garantindo no nível do banco de dados PostgreSQL que uma equipe da Organização A jamais possa ser vinculada a um cliente da Organização B.
   - Operações de substituição de membros (`replaceMembers`) e substituição de clientes (`replaceClients`) validam a integridade de todos os IDs informados, rejeitando qualquer entidade de fora da organização ativa com reversão total da transação (zero mutação parcial).

7. **Permissões de Gestão de Equipes:**
   - Introdução das permissões canônicas `teams.view` e `teams.manage`.
   - Defaults do sistema:
     - `ADMIN`: `teams.view`, `teams.manage`
     - `MANAGER`: `teams.view`
     - `MEMBER`: nenhuma (acesso somente mediante override ou customização futura).

8. **Auditoria Operacional Obrigatória:**
   - Todas as mutações de equipe (`team.created`, `team.updated`, `team.members_changed`, `team.clients_changed`) registram eventos no `AuditLog` na mesma transação atômica do banco de dados, com escopo estrito por organização.

## Consequências
- A visibilidade de clientes passa a ser granular, suportando estruturas matriciais e squads.
- O princípio de menor privilégio é reforçado para o papel `MANAGER`.
- O isolamento multi-tenant é garantido por código e por constraints relacionais rígidas.
