# F7-2 — Execução do onboarding por cliente: especificação funcional e técnica

> **Status: APROVADA (DEC-F7-008, 2026-10-12).** Autorizada **somente a F7-2a** (dados, migration, domínio, contratos, API, RBAC e testes). F7-2b, F7-3, F7-4 e P27 não iniciadas. P1–P5 aprovadas (§10); **P3 com ajuste**; salvaguardas em §12.
> Base: F7-1a/F7-1b (modelos, versões imutáveis, funções, RBAC), DEC-F7-004/005/006, B2 aprovada.
> Fora: Calendar (F7-3), n8n (F7-4), contrato assinado (F9), notificações (F14), capacidade da equipe (F15). Asana somente leitura.

## 1. Objetivo e limites

Aplicar uma **versão publicada** de um modelo a **um cliente**, acompanhar etapa a etapa (responsável, prazo em dias úteis, dependências, bloqueio, dispensa, conclusão, cancelamento), com auditoria, painel do gestor e isolamento por organização e carteira.

Limites: não cria projeto no Asana nem escreve nele; não lê Calendar; **não simula contrato assinado** (o gatilho fica reservado, §9); sem anexos (só link/nota); sem lembretes; sem migrar execução para versão nova.

## 2. Conceitos

| Conceito | Definição |
|---|---|
| **Execução** | Aplicação de uma versão publicada a um cliente. Estados: `ACTIVE`, `COMPLETED`, `CANCELLED`. Cliente, modelo e versão são **imutáveis**. |
| **Etapa em execução** (*step run*) | Uma por etapa da versão, ligada à definição imutável por `stepKey`. Estados: `WAITING` (dependência pendente), `READY`, `IN_PROGRESS`, `DONE`, `SKIPPED` (dispensada), `CANCELLED`. Mais o sinalizador independente **bloqueada** (com motivo). |
| **Responsável resolvido** | Pessoa efetiva da etapa, definida ao iniciar (ou reatribuída), com a origem registrada: modelo (pessoa), função (resolvida), reatribuição. |

## 3. Regras

### 3.1 Início manual
1. Exige `onboarding.start` e **cliente na carteira** do usuário (`findClientInResourceScope`; fora da carteira = 404).
2. Modelo `ACTIVE` com versão publicada; usa **a versão publicada mais recente no instante do início** e a fixa.
3. **B2:** no máximo **uma execução `ACTIVE` por (organização, cliente, modelo)** — índice único parcial no banco. Segunda tentativa, inclusive simultânea → `409 EXECUTION_ALREADY_ACTIVE` com o id da existente. Concluída ou cancelada permite novo início. Modelos diferentes rodam em paralelo.
4. Tudo em **uma transação**: cria a execução, materializa as etapas, resolve responsáveis, calcula prazos e libera as etapas sem dependência. Falhou = nada criado.
5. Pedido de início aceita `requestId` opcional (idempotência: repetir devolve a mesma execução).

### 3.2 Responsáveis
| Etapa do modelo | Resolução ao iniciar |
|---|---|
| Pessoa | Essa pessoa, **se** ativa **e** com o cliente na carteira. Senão: *sem responsável* (alerta). |
| Função | Membros **ativos** da função com o cliente na carteira. Exatamente 1 → atribuído. 0 ou vários → o gestor escolhe no ato do início (campo `assignments[stepKey]`); sem escolha, fica *sem responsável* (alerta). |
| Nenhum | *Sem responsável*; o gestor pode atribuir. |

- **A carteira nunca é ampliada** pela execução nem pela função operacional (função não concede permissão).
- **Pessoa inativa durante a execução:** a etapa mostra "Responsável inativo", entra no alerta do painel e só pode ser **reatribuída** por quem tem `onboarding.override` (com justificativa). A execução e o histórico não quebram.

### 3.3 Prazos e dependências
- Prazo = `dueBusinessDays` a partir da âncora (`START` = início da execução; `RELEASED` = liberação da etapa), em **dias úteis seg–sex no fuso da organização** (DEC-F6-005), gravado como **data**. Feriados: lista vazia nesta fase (a função já aceita lista).
- Etapa **sem dependência** nasce `READY`. Etapa com dependência nasce `WAITING` e vira `READY` quando **todas** as dependências estiverem `DONE` ou `SKIPPED`, na mesma transação da ação que as satisfez (sem job); a liberação grava `releasedAt` e calcula o prazo `RELEASED`.
- **Atrasada** = prazo anterior a hoje (fuso da organização) e etapa não encerrada. Atraso nunca altera estado; é indicador.

### 3.4 Ações (todas com evento auditável: autor, hora, antes/depois, motivo)
| Ação | Quem | Regra |
|---|---|---|
| Iniciar etapa (`READY→IN_PROGRESS`) | responsável ou `override` | opcional; só `READY` |
| **Concluir** | responsável com `onboarding.execute`, ou `override` | só `READY`/`IN_PROGRESS`, **não bloqueada**; cumpre a condição do catálogo: `CONFIRMATION` (confirmar), `EVIDENCE_PROVIDED` (link ou nota conforme o modelo), `ASANA_PROJECT_LINKED` (escolher entre projetos **já vinculados ao cliente**; grava o gid localmente, sem chamar o Asana). `CALENDAR_EVENT_LINKED` indisponível (F7-3). |
| **Bloquear / desbloquear** | responsável ou `override` | motivo obrigatório; etapa bloqueada não conclui; não altera dependentes |
| **Dispensar** | `override` | justificativa obrigatória; satisfaz dependentes; etapa `blocksCompletion` só por `override`, **destacada no histórico** (P4) |
| **Reatribuir** | `override` | justificativa; novo responsável ativo e com o cliente na carteira |
| **Concluir onboarding** | automático quando todas as etapas estão `DONE`/`SKIPPED`; **antecipado** por `start`/`override` (P3) | **Antecipada:** exige todas as etapas `blocksCompletion` encerradas (`DONE` ou `SKIPPED`). As demais abertas são **dispensadas explicitamente** (justificativa obrigatória, um evento `STEP_SKIPPED` por etapa) **na mesma transação** da conclusão. Nenhuma etapa fica aberta numa execução `COMPLETED`. |
| **Cancelar onboarding** | `onboarding.cancel` | motivo obrigatório; etapas abertas → `CANCELLED`; irreversível; libera nova execução (B2) |

Fora desta fase: reabrir etapa concluída; migrar de versão (propostos como evolução).

### 3.5 Modelo arquivado ou novas versões
Arquivar bloqueia **novos inícios**; execuções em andamento continuam. Publicar versão nova **não altera** execuções existentes (garantido por FK imutável e gatilho).

## 4. Modelo de dados (nomes de trabalho)

| Tabela | Campos principais |
|---|---|
| `onboarding_executions` | `id`, `organizationId`, `clientId` (FK composta org+cliente), `templateId`, `versionId` (FK composta; versão publicada), `status`, `startTrigger` (`MANUAL`), `requestId?`, `startedAt`, `startedByUserId`, `completedAt?`, `cancelledAt?`, `cancelReason?`, `updatedAt` |
| `onboarding_step_runs` | `id`, `organizationId`, `executionId`, `stepKey`, `stepDefinitionId` (FK), `status`, `blocked`, `blockedReason?`, `assigneeMemberId?`, `assigneeSource`, `functionId?` (a função de origem), `releasedAt?`, `dueDate?`, `startedAt?`, `completedAt?`, `completedByUserId?`, `evidenceLink?/evidenceNote?`, `asanaProjectGid?`, `skipReason?`, `updatedAt` |
| `onboarding_execution_events` | append-only: `executionId`, `stepRunId?`, `type`, `actorUserId?`, `reason?`, `before`, `after`, `createdAt` (+ `AuditLog` como na F7-1a) |

**Garantias no banco (além da API):**
- Índice único parcial `(organizationId, clientId, templateId) WHERE status='ACTIVE'` (B2); único `(executionId, stepKey)`; único `(organizationId, requestId)` quando houver.
- Gatilhos: imutabilidade de cliente/modelo/versão/início da execução; eventos append-only (sem UPDATE/DELETE); execução encerrada não aceita alteração de etapa; `versionId` só aponta para versão `PUBLISHED`.
- CHECKs: `DONE ⇒ completedAt`; `SKIPPED ⇒ skipReason`; `blocked ⇒ blockedReason`; `COMPLETED ⇒ completedAt`; `CANCELLED ⇒ cancelledAt`.
- FKs sem `RESTRICT` que impeçam remover organização/pessoa (mesmo padrão `NO ACTION DEFERRABLE` da F7-1a); `assigneeMemberId` sem FK, validado no serviço.
- **Objetos SQL da F7-1a e da F7-2 são protegidos:** teste de integração confere, após `migrate deploy`, a existência de cada índice parcial e gatilho pelo nome. Nenhuma migration futura pode removê-los por "diferença" com o `schema.prisma`; a nota fica no cabeçalho de cada migration.

**Concorrência:** transições por atualização condicional (`WHERE status = esperado`) dentro de transação com trava da execução (`FOR UPDATE`); duas ações simultâneas na mesma etapa → uma passa, a outra recebe `409`.

## 5. Permissões e isolamento
Permissões já existem (F7-1a): `view`, `start`, `execute`, `override`, `cancel`.

| Operação | Permissão | Escopo |
|---|---|---|
| Listar/ver execuções e painel | `view` | **carteira**: MEMBER vê só seus clientes; ADMIN/MANAGER conforme seu escopo |
| Iniciar | `start` | cliente na carteira |
| Iniciar, concluir, bloquear etapa | `execute` | só as etapas **atribuídas a si** (MEMBER); `override` amplia |
| Dispensar, reatribuir, concluir onboarding antecipado | `override` | carteira do cliente |
| Cancelar | `cancel` | carteira do cliente |

Negação por padrão; backend decide; fora da carteira ou de outra organização = **404**. Capacidades expostas em `/capabilities` só orientam a tela.

## 6. API (rascunho)
`POST /onboarding/executions` · `GET /onboarding/executions?status&clientId&templateId&assigneeId&late&blocked` · `GET /onboarding/executions/:id` · `POST /onboarding/executions/:id/cancel` · `POST /onboarding/executions/:id/complete` · `POST /onboarding/executions/:id/steps/:stepKey/{start|complete|block|unblock|skip|reassign}` · `GET /onboarding/my-steps` · `GET /onboarding/overview` (agregados do painel). Prefixos `""` e `/api`.

## 7. Painel do gestor (F7-2b)
- **Visão geral:** execuções ativas, etapas atrasadas, bloqueadas, sem responsável, concluídas no período; progresso por execução (encerradas/total).
- **Lista** filtrável (cliente, modelo, responsável, situação) e **detalhe** com linha do tempo de etapas, ações permitidas e histórico.
- **Minhas etapas** (para MEMBER): etapas abertas atribuídas a si, nos clientes da sua carteira.
- Estados vazio/erro/sem permissão; 390 px; Design System; teclado.
- **Correção do menu (DEC-F7-007 §3):** o item "Onboarding" passa a respeitar `onboarding.view`, com teste; a proteção das rotas e do backend permanece.
- Distribuição de carga e capacidade da equipe continuam na **F15**.

## 8. Critérios de aceite
**Domínio:** prazos em dias úteis (fim de semana, virada de mês, fuso, feriados); liberação por dependências; progresso; resolução de responsáveis (0, 1, vários, inativo, fora da carteira).
**API/PostgreSQL (banco descartável):** matriz de permissões por papel e organizações A/B; fora da carteira = 404; **B2 com dois inícios simultâneos** (um 201, outro 409); reiniciar após concluir/cancelar; versão e cliente imutáveis (API e gatilho); publicar v2 não altera execução em andamento; arquivar bloqueia novos inícios e preserva em andamento; condição de conclusão exigida (evidência ausente = 400); bloqueada não conclui; dispensa exige justificativa e libera dependentes; reatribuição e pessoa inativa; cancelamento libera B2; eventos append-only; ações simultâneas na mesma etapa; objetos SQL protegidos presentes; remoção de organização com execuções.
**Browser Gate F7-2:** iniciar, acompanhar, concluir, bloquear, dispensar, reatribuir, cancelar; painel e "minhas etapas"; negativos de permissão e carteira; menu respeitando `onboarding.view`; 390 px; regressão F4–F7-1.
**Governança:** nenhum dado fictício permanente; nenhuma escrita no Asana/Calendar; sem produção; P22 mantido.

## 9. Gatilho "contrato assinado" (reserva)
`startTrigger` aceita só `MANUAL` agora. O serviço de início recebe `trigger` e `sourceRef` e aplica **as mesmas regras** (B2, carteira, versão fixada); a F9 o chamará com um valor novo adicionado por migration própria. **Sem endpoint, botão, simulação ou dado de contrato** na F7-2.

## 10. Decisões
**Nenhuma decisão bloqueou a F7-2a. P1–P5 foram APROVADAS pela Direção (DEC-F7-008); P3 com ajuste:**

| # | Tema | Padrão proposto |
|---|---|---|
| P1 | Pessoa/função sem o cliente na carteira | Não é atribuída (alerta); a execução **nunca amplia carteira** |
| P2 | Quem conclui etapa de função não resolvida | Só `override` até haver responsável |
| P3 | Conclusão do onboarding | **Aprovada com ajuste:** automática ao encerrar todas as etapas; antecipada exige as `blocksCompletion` encerradas e **dispensa explícita, na mesma transação, das demais abertas** (justificativa e eventos); nenhuma etapa aberta em `COMPLETED` |
| P4 | Dispensar etapa `blocksCompletion` | Permitido só com justificativa; fica destacado no histórico |
| P5 | Reabrir etapa concluída | Fora da F7-2 |

## 11. Fatiamento
| Fatia | Conteúdo |
|---|---|
| **F7-2a** | Migration (3 tabelas, índices/gatilhos), contratos, regras de domínio, API, RBAC e testes (domínio + PostgreSQL) |
| **F7-2b** | Telas (painel, lista, detalhe, minhas etapas), correção do menu, Browser Gate F7-2 |
Cada fatia só inicia com autorização própria; CI oficial e aceite da Direção ao fim de cada uma.

## 12. Salvaguardas aprovadas (DEC-F7-008)
1. Início permitido com etapas sem responsável; a resposta informa quais atribuições precisam ser resolvidas (a tela, na F7-2b, as destaca).
2. B2 no banco, inclusive sob inícios simultâneos. 3. Cliente, modelo e versão imutáveis. 4. Desativar usuários não apaga nem corrompe histórico. 5. Índices parciais e gatilhos existentes preservados (teste por nome). 6. Nenhuma escrita no Asana ou Google Calendar. 7. Isolamento multiempresa, RBAC, carteira e eventos append-only. 8. Sem dados fictícios permanentes.
