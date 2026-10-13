# ADR-001 — Arquitetura física e estratégia de modularização do Hub 2.1

**Status:** Aprovado
**Data:** 19 de setembro de 2026

## Contexto

O Hub 2.1 nasceu da baseline auditada do Hub 2.0. Atualmente o front-end React/Vite ocupa a raiz do repositório, enquanto a API Fastify possui um package independente em api/. Não existem npm workspaces. Regras de negócio, contratos compartilhados e integrações ainda não possuem packages próprios.

A auditoria da Fase 0 definiu como arquitetura-alvo conceitual:

apps/web
apps/api
packages/domain
packages/contracts
packages/integrations

A radiografia da Fase 1 confirmou que a estrutura atual ainda não corresponde a esse desenho.

## Decisão

O Zafira Hub 2.1 adotará um monorepo baseado em npm workspaces.

A arquitetura-alvo será:

apps/web
apps/api
packages/contracts
packages/domain
packages/integrations
docs/governance

A migração será incremental e controlada.

### Etapa estrutural inicial:

1. O front-end atualmente na raiz será movido mecanicamente para apps/web.
2. A API atualmente em api será movida mecanicamente para apps/api.
3. A raiz passará a atuar como orquestrador do monorepo por npm workspaces.
4. O primeiro movimento estrutural deverá preservar comportamento, builds e testes existentes.
5. Não haverá refatoração de regras de negócio durante o movimento físico.

### Packages compartilhados:

**packages/contracts:**
Será criado na Fase 1 para contratos compartilhados, schemas e tipos que precisem ser utilizados por web e API. Novos contratos HTTP devem evitar duplicação de tipos entre front e backend.

**packages/domain:**
Será criado e preenchido gradualmente apenas com regras de domínio puras e independentes de framework. Código legado não deve ser movido para este package apenas para satisfazer a estrutura física.

**packages/integrations:**
É parte da arquitetura-alvo, porém a extração dos adaptadores atuais de Asana, Postiz, Asaas, Banco Inter e demais provedores ocorrerá na Fase 2 — Plataforma de Integrações. Durante a Fase 1, os conectores existentes podem permanecer dentro de apps/api enquanto forem preservados e adaptados com segurança.

### Prisma e PostgreSQL:

O schema Prisma e as migrations permanecerão inicialmente em:

apps/api/prisma

Não será criado packages/database nesta etapa.

A localização física do Prisma só poderá ser revista por uma decisão arquitetural posterior, caso exista benefício técnico concreto.

O PostgreSQL continua sendo a fonte de verdade operacional do Hub.

### Jobs:

A estratégia inicial continuará baseada em PostgreSQL quando jobs forem introduzidos.

Redis não será introduzido preventivamente.

Sua adoção dependerá de volume e capacidade medidos.

### API:

A Fase 1 definirá uma convenção única e versionada para os contratos HTTP.

A auditoria anterior e a radiografia atual apresentaram uma divergência sobre a existência de rotas duplicadas com e sem /api.

Essa questão deverá ser validada diretamente no código antes da definição definitiva do prefixo.

Não devem existir registros duplicados permanentes apenas para manter duas convenções concorrentes.

### Front-end:

A movimentação física para apps/web não representa reutilização integral da arquitetura de produto atual.

O front existente continua sendo referência funcional, pois a arquitetura de informação e a experiência serão reconstruídas conforme o Mapa Mestre.

### Ambientes:

Hub 1.0 e Hub 2.0 permanecem preservados.

A branch hub-2.1 não substitui produção durante a construção.

Homologação será definida de forma separada e reproduzível na Fase 1.

### Princípios da migração estrutural:

- commits pequenos e reversíveis;
- um tipo de mudança por commit;
- nenhuma migration de banco durante movimentação puramente física;
- builds e testes executados após mudança estrutural;
- nenhuma alteração em produção por consequência da reorganização local;
- paths de Docker, Vite, TypeScript e scripts devem ser atualizados explicitamente;
- não copiar regras ou tipos para resolver erros de importação;
- preservar histórico Git sempre que possível;
- main e hub-2.0 permanecem intactas.

## Consequências positivas:

- separação clara entre aplicações e código compartilhado;
- caminho preparado para contratos comuns;
- redução progressiva de duplicação;
- limites explícitos entre domínio e integrações;
- maior capacidade de testar módulos isoladamente;
- raiz do repositório deixa de representar implicitamente apenas o front-end.

## Custos e riscos:

- Dockerfiles, tsconfig, Vite, aliases e scripts dependem dos caminhos atuais;
- lockfiles precisarão ser tratados na transição para workspaces;
- mudanças físicas amplas podem gerar regressões mesmo sem alteração de lógica;
- integração com EasyPanel deverá ser ajustada somente quando o ambiente de homologação for configurado;
- extração prematura de regras de negócio pode criar abstrações artificiais.

## Fora do escopo desta decisão:

- trocar React;
- trocar Fastify;
- trocar Prisma;
- trocar PostgreSQL;
- adotar microserviços;
- adotar Kubernetes;
- instalar Redis agora;
- mover Prisma para package próprio;
- migrar integrações para packages/integrations durante a Fase 1;
- alterar identidade visual;
- alterar produção.

## Critério de sucesso da transição estrutural:

A futura reorganização será aceita quando:

- apps/web construir corretamente;
- apps/api construir corretamente;
- os testes existentes da API continuarem aprovados;
- o front continuar compilando;
- Prisma generate funcionar no novo caminho;
- nenhuma migration histórica for modificada;
- nenhum comportamento funcional for intencionalmente alterado no commit estrutural;
- working tree terminar limpa;
- main e hub-2.0 permanecerem intactas.
