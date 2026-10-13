# F7-4 — Automações n8n do onboarding: especificação funcional e técnica

> **Status: APROVADA (DEC-F7-016, 2026-10-12).** Autorizada **somente a F7-4a** (backend e infraestrutura). F7-4b, F8 e P27 não iniciadas. Ver §13.
> Base: Mapa Mestre C2 (§4 fonte de verdade; §15 aceite da F7), F7-1 a F7-3, DEC-ASANA-001/002, DEC-GOV-004.
> Fora: contratos e assinatura (F9), notificações/lembretes (F14), novos serviços ou workers.

## 1. Objetivo e limites
Permitir que etapas de onboarding do tipo **AUTOMATION** (reservado desde a F7-1) acionem fluxos do **n8n** de forma **idempotente, auditável e isolada por organização**, e que o resultado volte ao Hub para concluir ou falhar a etapa.

O n8n é **executor/orquestrador**. O Hub continua dono do estado do onboarding. Nada do que o n8n faz altera dados do Hub diretamente: ele só **informa o resultado** por um canal estreito e assinado.

Limites: sem escrita no Asana (§7, D1); sem Calendar de escrita; sem lembretes; sem novo serviço, fila ou worker na VPS; sem contas, webhooks ou serviços reais em desenvolvimento, testes e CI.

## 2. Eventos que podem disparar automações
| Gatilho | Efeito | Observação |
|---|---|---|
| **Etapa AUTOMATION liberada** (`READY`) | Envia o pedido do fluxo configurado na etapa | **Único gatilho que conclui etapa** |
| Onboarding **iniciado**, **concluído** ou **cancelado** | Notificação **informativa** ao fluxo inscrito (opcional por fluxo) | Não altera nenhuma etapa; sem retorno obrigatório |

Não são gatilhos nesta fase: etapa concluída/dispensada/bloqueada, atraso, mudança de responsável, evento do Calendar (reavaliar com a F14).

## 3. O que o n8n pode fazer
**No n8n (fora do Hub):** qualquer ação que a organização configurar nos próprios fluxos e que não viole as regras abaixo (ex.: criar pasta no armazenamento, enviar convite por e-mail, preparar rascunho de contrato — F9, avisar equipe em chat, atualizar o CRM Twenty).
**Sobre o Hub (único canal):**
1. Responder o **resultado** da execução pedida: `SUCCEEDED` ou `FAILED` (com código e mensagem curta).
2. Anexar até 5 **referências externas** ao resultado (tipo, rótulo, URL) para consulta na etapa.
3. Nada mais: sem ler ou escrever clientes, etapas, usuários, vínculos ou arquivos do Hub.

Proibido (regra do Hub, aplicada no que ele controla): **escrita no Asana** (DEC-ASANA-001) — ver D1; credencial global `HUB_INTERNAL_API_KEY` **não** é entregue ao n8n.

## 4. Fonte de verdade
| Informação | Fonte |
|---|---|
| Estado do onboarding, etapas, responsáveis, prazos, histórico e auditoria | **PostgreSQL do Hub** |
| Pedido de automação enviado, tentativas, resultado e referências | **Hub** (caixa de saída e eventos) |
| Artefatos criados pela automação (pasta, convite, rascunho, registro no CRM) | **Sistema onde foram criados**; o Hub guarda só a referência |
| Projetos e tarefas | **Asana** (somente leitura no Hub) |
| Contrato e assinatura | n8n/F9 (fora desta fase) |
| Definição e logs internos do fluxo | **n8n** |

## 5. Idempotência (sem duplicar)
1. Cada pedido tem **chave de idempotência determinística**: `organização + execução + etapa + geração` (hash). `geração` só aumenta quando um **administrador** manda **refazer** de propósito (com justificativa); reenvio automático por falha usa a **mesma** chave.
2. **Banco:** índice único `(execução, etapa, geração)` na caixa de saída — duas liberações simultâneas geram **um** pedido.
3. O pedido leva a chave em cabeçalho e no corpo; o **contrato com o n8n** exige que o fluxo use essa chave para não repetir a ação (pasta, convite, projeto).
4. **Resultado idempotente:** callback duplicado, atrasado ou fora de ordem é **ignorado e auditado**; só vale o primeiro resultado final de um pedido em `SENT`.
5. Etapa cancelada, dispensada ou execução cancelada: resultado tardio é registrado, **não altera** a etapa.

## 6. Falhas, reenvios, autenticação e auditoria
**Estados do pedido:** `PENDING` → `SENT` → `SUCCEEDED` | `FAILED`; mais `RETRYING`, `TIMED_OUT`, `DEAD`.
| Situação | Comportamento |
|---|---|
| Erro de rede, 5xx, 429 | Reenvio automático com *backoff* (1 min, 5 min, 15 min, 1 h, 6 h; até 6 tentativas), mesma chave |
| 4xx permanente | `FAILED` imediato, sem repetir |
| Sem resultado em 24 h (configurável) | `TIMED_OUT`, visível na etapa |
| Esgotou tentativas | `DEAD`, alerta no painel do gestor |
| Reenvio manual | `onboarding.override`, com justificativa; mesma chave (não duplica) ou nova geração se pedido "refazer" |
| Falha final | Etapa permanece aberta com a falha visível; opções do gestor: reenviar, **dispensar com justificativa** (regras atuais) |

**Autenticação:**
- **Hub → n8n:** URL **https** de um **host permitido** (lista de ambiente; sem seguir redirecionamentos, contra SSRF); assinatura `HMAC-SHA256(timestamp.corpo)` com segredo **por organização**, cifrado (infra de `IntegrationConnection`), mais cabeçalho de chave de idempotência.
- **n8n → Hub:** endpoint exclusivo de resultado; mesma assinatura e **janela de ±5 min**; a **organização é derivada do segredo**, nunca do corpo; limite de taxa; chave de idempotência obrigatória.
- Rotação de segredo por administrador; segredos **nunca** em log, resposta, auditoria ou payload.

**Auditoria:** eventos append-only na execução (`AUTOMATION_QUEUED/SENT/RETRIED/SUCCEEDED/FAILED/TIMED_OUT/IGNORED_LATE`) e `AuditLog`, com autor (sistema ou pessoa), chave, tentativa e referência — **sem** o corpo bruto.

## 7. Modelo de dados e regras (nomes de trabalho)
| Item | Conteúdo |
|---|---|
| `onboarding_step_definitions.automationKey` | Fluxo escolhido (da lista da organização); exigido quando `kind = AUTOMATION`. Nova versão do modelo; versões publicadas continuam imutáveis |
| Condição de conclusão **`AUTOMATION_SUCCEEDED`** | Novo valor do catálogo **fechado** (exige DEC, ver D2); só o resultado assinado `SUCCEEDED` de um pedido `SENT` a satisfaz |
| `automation_flows` | `organizationId`, `key`, `name`, `description`, `enabled`, `subscribeLifecycle`, caminho do webhook (referência, não segredo). Único `(organizationId, key)` |
| `automation_outbox` | `organizationId`, `executionId`, `stepKey?`, `flowKey`, `eventType`, `generation`, `idempotencyKey` (único), `status`, `attempts`, `nextAttemptAt`, `lastError`, resultado (`resultCode`, `externalRefs` ≤ 5), timestamps. Único `(executionId, stepKey, generation)` por tipo |
| Conexão | `IntegrationConnection` com `provider = N8N` (novo valor do enum), segredo cifrado; uma por organização |
| Resultados recebidos | `WebhookEvent` existente (`dedupeKey` único) para deduplicar callbacks |

**Regras de domínio:** etapa `AUTOMATION` só conclui por resultado verificado (é o único caso de conclusão por sistema; `completedByUserId` nulo e origem registrada); bloqueio, dispensa e cancelamento valem como nas demais etapas; fluxo desabilitado ou sem conexão ⇒ condição **indisponível** (mensagem clara, igual ao Calendar); publicar modelo exige `automationKey` existente e habilitado.
**Permissões:** `automation.manage` (conexão, segredo e fluxos; padrão ADMIN) e `automation.view` (ver execuções; ADMIN/MANAGER). Reenviar/dispensar reutiliza `onboarding.override`. Entram no `rbac:bootstrap` (P22).

## 8. Isolamento entre organizações e clientes
- Conexão, segredo, fluxos e caixa de saída são **da organização**; consultas sempre filtradas por `organizationId`.
- Callback só alcança pedidos da organização do **segredo assinante**; pedido de outra organização = 404/ignorado e auditado.
- Cliente: o pedido leva apenas `clientId` e dados mínimos; a visibilidade na tela segue a **carteira** da execução (F7-2). O n8n não recebe lista de clientes nem dados de outros clientes.
- **Payload mínimo:** `organizationId`, `executionId`, `stepKey`, `flowKey`, `clientId`, `clientName` (opcional por fluxo), `idempotencyKey`, `occurredAt`. **Nunca:** e-mails de participantes, descrições, notas, evidências, dados de contrato.

## 9. Testes sem contas, webhooks ou serviços reais
1. **Simulador do n8n** (`scripts/homologation/n8n-mock.mjs`, mesmo padrão do Asana/Google): recebe pedidos, registra e responde sucesso, falha, 429/5xx, lentidão, **callback duplicado, atrasado, fora de ordem e com assinatura/horário inválidos**.
2. **Domínio:** chave de idempotência, máquina de estados, *backoff*, assinatura e janela.
3. **PostgreSQL:** índice único (dois disparos simultâneos = um pedido), isolamento A×B, segredo cifrado e ausente de respostas, callback sem/forjado/replay, resultado tardio após cancelamento, esgotamento de tentativas, desabilitar fluxo, remoção de organização, objetos SQL protegidos preservados.
4. **Browser Gate F7-4:** configurar conexão e fluxo, etapa automática do início ao resultado, falha e reenvio, dispensa com justificativa, negativos de permissão/carteira, 390 px.
5. **Segurança:** teste que falha se o código emitir requisição para host fora da lista, ou qualquer escrita para o Asana.

## 10. Infraestrutura (reuso, sem serviço novo)
- Envio e reenvio por **tarefa periódica dentro da API**, com `scheduler_leases` (padrão do espelho do Asana e da agenda): intervalo de 1 minuto, **desligada por padrão** (`N8N_DISPATCH_ENABLED`), ligada só com medição de capacidade e autorização.
- Disparo imediato best-effort após a transação que libera a etapa; a caixa de saída garante a entrega mesmo sem ele (*outbox*).
- Cifragem, auditoria, `SyncRun`/`IntegrationError` e RBAC existentes.

## 11. Decisões
| # | Decisão | Padrão proposto | Bloqueia a F7-4a? |
|---|---|---|---|
| **D1** | **Fluxos podem escrever no Asana?** (o aceite da F7 cita "sem duplicar projetos"; DEC-ASANA-001 proíbe escrita a partir do Hub) | **Não.** Criação de projeto segue manual no Asana; o Hub confirma o vínculo (D3 anterior) | **Sim — precisa de confirmação** |
| **D2** | Estender o catálogo fechado de condições com `AUTOMATION_SUCCEEDED` (B1 exige DEC para novas condições) | Aprovar | **Sim — precisa de DEC** |
| D3 | Fluxos como **lista registrada pela organização** (genérica) em vez de catálogo fixo de automações | Genérico | Não |
| D4 | Falha final: permitir "marcar como concluída manualmente"? | **Não**; só reenviar ou dispensar com justificativa | Não |
| D5 | Tentativas e prazo (6 tentativas; 24 h) | Como proposto, configurável | Não |
| D6 | Notificações de início/conclusão/cancelamento ao n8n | Opcionais por fluxo | Não |
| D7 | Onde roda o n8n e qual host permitir | Informado pelo proprietário só na homologação; não afeta o código | Não |

## 12. Fatiamento
| Fatia | Conteúdo |
|---|---|
| **F7-4a** | Migration, contratos, domínio, caixa de saída, despachante, callback assinado, conexão/fluxos, RBAC, API, simulador e testes (domínio + PostgreSQL) |
| **F7-4b** | Telas: conexão e fluxos, estado da automação na execução, reenvio/dispensa, Browser Gate F7-4 |
Cada fatia exige autorização própria, CI verde e aceite. Efeito sobre a F7: a F7 só se encerra após a F7-4b e o aceite da Direção; o refinamento visual aprofundado fica para etapa posterior (DEC-F7-015).

## 13. Aprovação e ajustes (DEC-F7-016)
- **D1:** automações vinculadas ao Hub **não** escrevem no Asana (nem projeto, tarefa ou outro dado). O Hub não controla fluxos independentes do n8n; a política vale para os fluxos **operados em nome do Hub** e deve constar da configuração futura de cada fluxo.
- **D2:** `AUTOMATION_SUCCEEDED` aprovado; só o resultado `SUCCEEDED` válido, autenticado e correspondente a pedido autorizado conclui a etapa. **Etapa bloqueada:** o resultado é registrado, mas a conclusão só é aplicada ao desbloquear (bloqueio continua valendo).
- **D3–D7:** padrões da §11. A conclusão manual da etapa automática **não existe** (somente reenviar ou dispensar com justificativa).
- **Garantias e seus limites:** o Hub garante que o pedido é **persistido antes** do envio, que a **chave de idempotência é estável** em reenvios e que um resultado só é aplicado uma vez. **Não** garante execução "exatamente uma vez" no sistema externo: isso depende de o fluxo n8n (e dos sistemas que ele toca) respeitar a chave. Falha de rede ou ausência de resposta **nunca** conclui a etapa.
- **Despachante desligado** (`N8N_DISPATCH_ENABLED` ausente/false): pedidos ficam `PENDING`, nada é enviado e nenhuma etapa automática conclui.
- **Callback:** a organização é provada pela **assinatura com o segredo da própria organização** (o identificador na URL só seleciona qual segredo verificar; qualquer organização no corpo é ignorada).
