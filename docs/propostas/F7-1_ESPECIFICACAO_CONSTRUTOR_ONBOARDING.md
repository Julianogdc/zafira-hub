# F7-1 — Construtor de Onboarding: especificação funcional e técnica

| Campo | Valor |
|---|---|
| Situação | **APROVADA com ajustes** (DEC-F7-005, 2026-10-12). Em execução: **somente F7-1a**. F7-1b não iniciada. Ver §11. |
| Autor / data | Claude — 2026-10-12 |
| Base | Decisões da Direção de 2026-10-12 (DEC-F7-004), DEC-F7-001 a 003, Mapa C2 §13–§16, padrões já aceitos na F6 (Entregas: versão/estado, trava por registro, evento + auditoria, `expectedStatus`) |
| Substitui | A premissa "esperar o processo real de onboarding" de `F7_ONBOARDING_PROPOSTA_FUNCIONAL.md`: o processo passa a ser **configuração** feita pelo administrador. As perguntas Q1–Q12 deixam de ser bloqueantes e viram conteúdo de templates. |

## 1. Objetivo e limites

Construir, **sem alterar código**, modelos de onboarding configuráveis pelo administrador e a base para executá-los por cliente.

- **Dentro da F7-1:** modelos, versões, etapas, dependências, funções operacionais, regras de publicação e as telas do construtor.
- **Fora da F7-1 (fases seguintes da F7):** execução por cliente e painel do gestor (F7-2); leitura do Google Calendar (F7-3); automações n8n (F7-4); Browser Gate completo (F7-5).
- **Fora de toda a F7:** criar/editar projeto no Asana, criar/editar evento no Calendar (DEC-ASANA-001, DEC-F7-001), contrato (F9), notificações (F14).
- **Sem dados fictícios permanentes:** o construtor nasce **vazio**. Nenhuma migration, seed de produção ou código de aplicação cria modelo, etapa ou função. Fixtures existem só em testes e em seeds de CI, com prefixo identificável.

## 2. Conceitos

| Conceito | Definição |
|---|---|
| **Modelo** (template) | Fluxo de onboarding com nome e abrangência (serviço, pacote, tipo de cliente ou geral). Não há quantidade fixa de modelos nem de etapas. |
| **Versão** | Cópia numerada do modelo. `RASCUNHO` é editável; `PUBLICADA` é **imutável**. Editar um modelo publicado cria um novo rascunho. |
| **Etapa** | Item da versão: título, tipo, responsável, prazo, dependências, evidência e condição de conclusão. Tem **chave estável** entre versões. |
| **Função operacional** | Papel de trabalho da agência (ex.: o que o administrador cadastrar). **Não é** ADMIN/MANAGER/MEMBER e **nunca** é deduzida deles. |
| **Execução** | Aplicação de uma versão publicada a um cliente (F7-2). Fica **fixada** na versão usada. |

## 3. Interface do construtor (proposta)

Rotas: `/onboarding/modelos` (lista) e `/onboarding/modelos/:id` (construtor). Apenas quem tem `onboarding.manage_templates`.

**Lista de modelos** — tabela com nome, abrangência, versão publicada, situação (Ativo/Arquivado), execuções em andamento; ações: **Novo**, **Duplicar**, **Arquivar/Reativar**. Estado vazio explícito: "Nenhum modelo criado. Crie o primeiro para configurar seu onboarding."

**Construtor**
```
┌ Modelo: [Nome do modelo__________]  Abrangência: [Serviço ▾] [rótulo livre]   ┐
│ Versão: Rascunho v3 (base: v2 publicada)   [Salvar] [Validar] [Publicar] [Descartar rascunho] │
├────────────────────────────┬───────────────────────────────────────────────────┤
│ ETAPAS            [+ Etapa]│ CONFIGURAÇÃO DA ETAPA SELECIONADA                  │
│ 1 ▲▼ Título da etapa    ⚠  │ Título* [____________]   Descrição [_____________] │
│ 2 ▲▼ Outra etapa           │ Tipo*: ( ) Manual ( ) Confirmar projeto Asana      │
│ 3 ▲▼ …                     │        ( ) Reunião (Calendar, leitura)             │
│                            │ Responsável: ( ) Função [▾] ( ) Pessoa [▾] ( ) —   │
│ Problemas (2)              │ Prazo: [__] dias úteis a partir de [Início ▾|Liberação ▾] │
│ • Etapa 3: dependência…    │ Depende de: [multiseleção de etapas]               │
│ • Etapa 1: sem título      │ Evidência: [Nenhuma ▾ | Link | Nota | Confirmação] [Obrigatória ☐] │
│                            │ Condição de conclusão: [catálogo ▾]                │
│                            │ ☐ Bloqueia a conclusão do onboarding   [Remover]   │
└────────────────────────────┴───────────────────────────────────────────────────┘
```
- **Reordenar** por botões ▲▼ (acessível por teclado) e arrastar opcional. A ordem é de exibição; **a precedência vem das dependências**.
- **Validar** lista todos os problemas antes de publicar (ver §5). **Publicar** só habilita sem problemas e pede uma "nota da versão".
- **Publicado** abre em leitura; o botão **Editar** cria o rascunho da próxima versão.
- **Funções:** tela `/onboarding/funcoes` (ou aba) para criar, renomear e desativar funções e indicar quem as exerce.
- Estados: carregando, vazio, erro, sem permissão, salvando; 390 px sem rolagem horizontal (lista de etapas e configuração empilham); Design System da F3.

## 4. Modelo de dados proposto (Prisma, nomes de trabalho)

Todas as tabelas têm `organizationId` e FK composta com a organização; consultas sempre filtradas por ele.

| Tabela | Campos principais |
|---|---|
| `OrganizationFunction` | id, organizationId, name (único por organização), isActive |
| `OrganizationFunctionMember` | organizationId, functionId, organizationMemberId (PK composta) |
| `OnboardingTemplate` | id, organizationId, name, description, scopeKind (`GENERAL`/`SERVICE`/`PACKAGE`/`CLIENT_TYPE`), scopeLabel (texto livre), status (`ACTIVE`/`ARCHIVED`), createdByUserId, timestamps |
| `OnboardingTemplateVersion` | id, organizationId, templateId, versionNumber, status (`DRAFT`/`PUBLISHED`), changeNote, basedOnVersionId?, publishedAt, publishedByUserId; **único** (templateId, versionNumber); **no máximo um** `DRAFT` por modelo |
| `OnboardingStepDefinition` | id, organizationId, versionId, stepKey (estável entre versões), position, title, description, kind (`MANUAL`/`CONFIRM_ASANA_PROJECT`/`CALENDAR_EVENT`/`AUTOMATION` — este último **reservado e desabilitado**), assigneeMode (`NONE`/`FUNCTION`/`MEMBER`), functionId?, memberId?, dueBusinessDays?, dueAnchor (`START`/`RELEASED`), evidenceKind (`NONE`/`LINK`/`NOTE`/`CONFIRMATION`), evidenceRequired, completionCondition (catálogo, §5), blocksCompletion |
| `OnboardingStepDependency` | organizationId, versionId, stepKey, dependsOnStepKey (PK composta) |
| `OnboardingEvent` | id, organizationId, templateId, versionId?, type, actorUserId, reason?, before/after (Json), createdAt — trilha de **modelo** (criar, editar, publicar, arquivar, duplicar) + `AuditLog` |

**Reservado para a F7-2 (não criar agora):** `OnboardingExecution` (cliente, versão, origem `MANUAL`/`CONTRACT_SIGNED`, chave de idempotência, estado) e `OnboardingStepRun` (estado, responsável resolvido, prazo calculado, evidência, bloqueio, justificativas). O desenho acima já os comporta sem mudança de esquema.

**Gatilho por contrato (F9 ainda inexistente):** a execução terá `startOrigin` e `externalTriggerKey` (único por organização, cliente, modelo e origem) para que o mesmo "contrato assinado" **não** inicie duas vezes. Na F7 só `MANUAL` é aceito; `CONTRACT_SIGNED` é rejeitado com mensagem clara até a F9. Nenhuma integração com contrato é simulada.

## 5. Regras de versionamento e publicação

1. **Imutabilidade:** versão `PUBLICADA` não aceita escrita em etapas, dependências nem campos de conteúdo (garantida na API e por teste; avaliar *trigger* no banco).
2. **Editar = nova versão:** cria `DRAFT` copiando a versão publicada mais recente (mantém `stepKey`). Só existe **um** rascunho por modelo.
3. **Publicar** (em transação, com trava do modelo): exige validação sem problemas, atribui `versionNumber = max + 1`, grava `publishedAt/By` e evento. O rascunho vira publicada; não há desfazer.
4. **Execuções existentes nunca mudam** ao publicar. Quem já iniciou continua na versão fixada. Migrar uma execução para versão nova **não existe** nesta fase.
5. **Arquivar** modelo: bloqueia novas execuções; as em andamento continuam. **Reativar** é permitido. Não há exclusão de modelo publicado.
6. **Descartar rascunho** é permitido (apaga só o rascunho). **Duplicar** cria modelo novo com a última versão publicada (ou o rascunho) como `v1` em rascunho.
7. **Validações de publicação:** ≥ 1 etapa; título preenchido; `stepKey` único; dependências existentes e **sem ciclo**; nenhuma etapa dependendo de si mesma; responsável coerente com o modo (função ativa / membro ativo da organização); `AUTOMATION` rejeitado; prazo inteiro ≥ 0; evidência obrigatória só com tipo ≠ `NONE`; `CONFIRM_ASANA_PROJECT` não aceita configuração de escrita (não existe).
8. **Concorrência:** salvar rascunho envia a versão lida (`expectedUpdatedAt`); conflito devolve 409 sem sobrescrever.
9. **Catálogo fechado de condições de conclusão** (v1): `CONFIRMATION` (clique com confirmação), `EVIDENCE_PROVIDED` (exige a evidência configurada), `ASANA_PROJECT_LINKED` (confirma e grava o projeto já vinculado ao cliente — **só vínculo local**), `CALENDAR_EVENT_LINKED` (habilitada na F7-3). Novas condições entram por nova versão do produto, não por configuração livre.
10. **Dias úteis:** segunda a sexta no fuso da organização (DEC-F6-005). Feriados: tabela da organização **opcional**, fora da F7-1; a função de cálculo já aceita uma lista de feriados.

## 6. Permissões (RBAC + escopo de cliente)

| Permissão (nome de trabalho) | O que permite | Padrão ADMIN | MANAGER | MEMBER |
|---|---|---|---|---|
| `onboarding.manage_templates` | criar, editar, duplicar, publicar, arquivar modelos | ✔ | — | — |
| `onboarding.manage_functions` | criar/editar funções e seus membros | ✔ | — | — |
| `onboarding.view` | ver modelos (leitura) e execuções da carteira | ✔ | ✔ | ✔ |
| `onboarding.start` (F7-2) | iniciar onboarding de cliente da carteira | ✔ | ✔ | — |
| `onboarding.execute` (F7-2) | avançar etapas atribuídas | ✔ | ✔ | ✔ (só as suas) |
| `onboarding.override` (F7-2) | concluir fora de ordem, dispensar, reatribuir (com justificativa) | ✔ | ✔ | — |
| `onboarding.cancel` (F7-2) | cancelar execução | ✔ | ✔ | — |

Regras: negação por padrão; toda checagem no backend; modelos e funções são da **organização**, execuções seguem a **carteira do cliente** (`findClientInResourceScope`); responsável atribuído precisa ter o cliente na carteira; **função operacional nunca concede permissão**; exceções individuais por membro continuam possíveis pelo mecanismo existente de overrides. `rbac:bootstrap` sincroniza os padrões (ver P22).

## 7. API (F7-1)

`GET/POST /onboarding/templates` · `GET/PATCH /onboarding/templates/:id` (nome, abrangência) · `POST /onboarding/templates/:id/duplicate` · `POST …/archive` · `POST …/reactivate` · `GET /onboarding/templates/:id/versions` · `POST …/versions` (cria rascunho) · `PUT …/versions/:versionId` (substitui etapas e dependências do **rascunho**) · `POST …/versions/:versionId/validate` · `POST …/versions/:versionId/publish` · `DELETE …/versions/:versionId` (só rascunho) · `GET/POST/PATCH /onboarding/functions` · `PUT /onboarding/functions/:id/members`. Prefixos `/` e `/api` como nas rotas F6. Erros de domínio → 400/403/404/409 com mensagens em português.

## 8. Critérios de aceite da F7-1

**Domínio (testes unitários)**
- Detecção de ciclo e de auto-dependência; ordem topológica estável.
- Todas as validações de publicação (§5.7), uma a uma, positivas e negativas.
- Cálculo de dias úteis: fins de semana, mudança de mês, fuso da organização, lista de feriados.
- Rascunho único; numeração de versão; cópia preserva `stepKey`.

**API / banco (integração em PostgreSQL descartável)**
- Matriz de permissões: cada rota com perfil permitido e negado, por organização A e B.
- Organização B nunca lê ou altera modelo, versão ou função da A.
- Escrita em versão publicada → 409; segundo rascunho → 409; publicar duas vezes simultâneas → uma passa; salvar rascunho desatualizado → 409.
- Publicação e arquivamento geram `OnboardingEvent` e `AuditLog` com autor.
- Migration aplicada em banco descartável **vazio** e com dados anteriores intactos; **nenhuma linha** de modelo/etapa/função criada pela migration.

**Interface (Browser Gate F7-1, no CI)**
- Admin cria modelo do zero pela interface, adiciona, remove, reordena e configura etapas, valida, publica; edita criando v2; duplica; arquiva.
- Publicação bloqueada com mensagens claras para ciclo e para etapa incompleta.
- MEMBER e MANAGER não veem ações de gestão de modelos (e a API recusa).
- 390 px sem rolagem horizontal; estados vazio, erro, sem permissão e salvando.
- Gates F4, F5 e F6 continuam passando (regressão).

**Segurança e governança**
- Nenhuma chamada de escrita ao Asana ou ao Calendar existe no código da F7-1.
- Nenhum dado fictício permanente; fixtures só em testes/CI.
- Segredos, tokens e dados pessoais fora de logs e documentos.
- `docs/ESTADO_ATUAL.md` e `docs/REGISTRO.md` atualizados; DEC para cada decisão aprovada.

## 9. Decisões

### 9.1 Realmente bloqueantes para o modelo (peço confirmação da Direção)

| # | Decisão | Por que bloqueia | Padrão que adoto se aprovado |
|---|---|---|---|
| **B1** | **Condições de conclusão e bloqueios: catálogo fechado ou regras livres?** | Define se o esquema usa enumeração + parâmetros ou um motor de regras (JSON/expressões). Muda tabelas, validação e testes. | **Catálogo fechado** (§5.9) e bloqueios **manuais** (alguém marca a etapa como bloqueada, com motivo). Motor de regras só com DEC futura. |
| **B2** | **Cardinalidade:** pode haver mais de um onboarding **ativo** do mesmo modelo para o mesmo cliente? | Define a restrição de unicidade da F7-2 e a chave de idempotência. | **Um ativo por (cliente, modelo)**; modelos diferentes podem rodar em paralelo no mesmo cliente. Reabrir após concluído/cancelado é permitido. |

Se B1 e B2 forem aprovados com os padrões, **nenhuma outra decisão bloqueia a F7-1**.

### 9.2 Não bloqueantes — padrão adotado, ajustável depois sem mudar o esquema

| Tema | Padrão |
|---|---|
| Como "função" vira pessoa na execução | Na criação da execução o gestor confirma o responsável sugerido entre os membros da função com o cliente na carteira; sem resolução, a etapa fica "sem responsável" e aparece como alerta |
| Dias úteis | Segunda a sexta; feriados da organização como evolução opcional |
| Âncora do prazo | Configurável por etapa (início ou liberação); padrão: liberação |
| Dispensar etapa | Exige `onboarding.override` e justificativa; etapa dispensada satisfaz dependentes |
| Retenção de eventos do Calendar (F7-3) | Proposta inicial de **1 ano**, sujeita à avaliação de armazenamento, privacidade e política de retenção |
| Anexos | Somente links na F7 (storage de arquivos segue em aberto para a F8) |
| Notificações e lembretes | F14 |

## 10. Fatiamento proposto

| Fatia | Conteúdo | Entrega verificável |
|---|---|---|
| **F7-1a** | Esquema, contratos, domínio (ciclo, publicação, dias úteis), RBAC e testes | Domínio e API de modelos/funções com integração em banco descartável |
| **F7-1b** | Telas: lista, construtor, funções | Browser Gate F7-1 no CI |
| F7-2 | Execução, painel do gestor, gatilho manual e reserva do gatilho por contrato | Gate F7-2 |
| F7-3 | Leitura do Google Calendar e vínculos | Conector simulado no gate |
| F7-4 | Automações n8n idempotentes | Gate com n8n simulado |

## 11. Aprovação e ajustes obrigatórios (DEC-F7-005, 2026-10-12)

**Situação:** especificação **APROVADA** pela Direção com os ajustes abaixo. Autorizada **somente a F7-1a** (dados, migrations, regras, RBAC, API e testes). **F7-1b (telas) não iniciada.**

| # | Ajuste | Onde vale nesta especificação |
|---|---|---|
| 1 | **B1 aprovada:** catálogo fechado de condições; bloqueios manuais com justificativa auditável; sem motor livre | §5.9 |
| 2 | **B2 aprovada:** no máximo um onboarding ativo por cliente e modelo; concluído/cancelado permite reiniciar | §4 (F7-2) |
| 3 | Condições e tipos de etapa do **Calendar indisponíveis** até a F7-3: rejeitados ao salvar e ao publicar, por uma chave única (`ONBOARDING_CALENDAR_AVAILABLE`) que a F7-3 liga | §3, §5.7 |
| 4 | **Funções independentes do RBAC**; nunca concedem permissão | §2, §6 |
| 5 | **Imutabilidade** garantida na API **e no banco** (gatilho) | §5.1 |
| 6 | **Unicidade e concorrência no banco**: uma versão por número; **um rascunho por modelo** (índice parcial); nome de função e de modelo únicos por organização (sem diferenciar maiúsculas); trava do modelo na publicação | §4, §5 |
| 7 | **`stepKey` estável** entre versões; criado pelo cliente, preservado na cópia | §4, §5.2 |
| 8 | **P22 mantida** como bloqueador do primeiro deploy de homologação | §10 |
| 9 | Asana somente leitura; sem dados fictícios permanentes; sem produção | §1 |

**Refinamentos técnicos da F7-1a (sem mudança de decisão):**
- `evidenceKind` passa a ter só `NONE`, `LINK` e `NOTE`; "confirmação" é a condição `CONFIRMATION`, não um tipo de evidência.
- Coerência etapa × condição: `MANUAL` aceita `CONFIRMATION` ou `EVIDENCE_PROVIDED`; `CONFIRM_ASANA_PROJECT` exige `ASANA_PROJECT_LINKED` (só vínculo local, sem escrita); `EVIDENCE_PROVIDED` exige evidência `LINK` ou `NOTE` obrigatória.
- Permissões: as sete do §6 entram no catálogo agora (defaults definidos uma vez); só `view`, `manage_templates` e `manage_functions` têm uso na F7-1a.
- Execuções (`OnboardingExecution`, `OnboardingStepRun`), bloqueios manuais e a regra B2 ficam para a F7-2; nenhuma tabela de execução é criada na F7-1a.
