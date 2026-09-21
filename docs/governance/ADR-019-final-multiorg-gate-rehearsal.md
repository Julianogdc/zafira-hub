# ADR-019: Rehearsal do Portão Final Multi-Organização via HTTP

## Status
Aprovada

## Data
2026-09-21

## Contexto
O Zafira Hub 2.1 exige, como critério formal de aceite para isolamento multiempresa e encerramento da Fundação (Fase 1), a comprovação de que:
> "Dois usuários de organizações diferentes operam com isolamento comprovado."

Para garantir que o portão de homologação física futura seja executado de forma determinística, sem improvisações e com validação contínua em CI, é necessário estruturar um rehearsal automatizado em ambiente de integração do GitHub Actions.

## Decisões

1. **Validação Estritamente via HTTP:** A prova de isolamento e operação dos usuários deve ocorrer exclusivamente através das rotas públicas e autenticadas da aplicação Web/API (`/hub-api/...`), exercitando todo o pipeline de rede, proxy reverso, middleware de autenticação, resolução RBAC e controle de tenant.
2. **Setup de Fixture Isolado:** A preparação de ambiente (criação das duas organizações e dos dois usuários administradores) pode utilizar acesso direto via Prisma Client em script efêmero de rehearsal, garantindo determinismo.
3. **Duas Organizações Independentes:** São criadas duas organizações com IDs fixos (`ORG_A_ID` e `ORG_B_ID`) e slugs distintos.
4. **Dois Usuários Humanos ACTIVE:** São provisionados dois usuários humanos com status `ACTIVE` (`USER_A_ID` e `USER_B_ID`) com credenciais geradas dinamicamente via Argon2id.
5. **Memberships Estritas:** Cada usuário possui membership `ADMIN` com status `ACTIVE` estritamente vinculada à sua respectiva organização. Nenhum usuário possui membership ou associação com a organização alheia.
6. **Sessão JWT e Cookies de Produção:** O fluxo de autenticação utiliza o endpoint oficial `/auth/login`, gerando cookies HTTP-only assinados e avaliando as flags de segurança (`HttpOnly`, `Secure`, `SameSite`).
7. **Criação de Recursos via HTTP:** Os recursos (como clientes/clientes da agência) não são injetados diretamente no banco de dados durante o teste, mas criados via `POST /hub-api/clients` sob as sessões autenticadas de cada usuário.
8. **Isolamento de Leitura e Listagem:** O usuário da Organização A deve visualizar exclusivamente os recursos da Organização A em `GET /hub-api/clients`. Recursos da Organização B não devem aparecer na listagem. O mesmo aplica-se reciprocamente ao usuário da Organização B.
9. **Isolamento de Acesso Direto (GET/PATCH por ID):** Tentativas de acesso ou modificação de recursos cross-organization (`GET /hub-api/clients/:foreignId` e `PATCH /hub-api/clients/:foreignId`) devem retornar obrigatoriamente **HTTP 404 Not Found**, impedindo enumeração e vazamento de metadados.
10. **Rejeição de Login em Tenant Estrangeiro:** Tentativas de autenticação de um usuário informando o `organizationId` de outra organização sem que possua membership nela devem ser rejeitadas com **HTTP 403 Forbidden**.
11. **Resistência a Header Tampering:** Enviar headers como `x-organization-id` com valor de organização alheia em uma sessão válida com `activeOrganizationId` fixado no token não altera o tenant resolvido.
12. **Idempotência e Segurança de Banco:** O script de fixture deve ser idempotente (usando upserts seguros) e validar previamente que a variável `DATABASE_URL` não aponta para banco de produção (`zafira_hub_v2`).
13. **Execução no Container Publicado:** Os scripts de seed e bootstrap devem rodar dentro da imagem Docker publicada da API por digest (`API_IMAGE_REF`), sem depender do ambiente Node/Prisma do host.
14. **Zero Vazamento de Credenciais:** Nenhuma senha ou token JWT pode ser exposto em logs ou salvo como artefato.
15. **Rehearsal CI != Homologação Física:** O sucesso deste ensaio em CI não substitui a execução física do portão em ambiente de homologação nem autoriza o fechamento automático da Fase 1.
16. **Zero Dados Reais:** São utilizados exclusivamente identificadores e dados sintéticos fictícios.

## Consequências
- A mecânica do portão multi-organização passa a ser executada e verificada de forma determinística a cada pipeline de CI.
- Prova-se a integridade do isolamento relacional e de rotas sob semântica real de produção (same-origin, cookies seguros, RBAC ativo).
- Mantém-se o portão da Fase 1 aberto até a validação na infraestrutura física homologada.
