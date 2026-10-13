# Zafira Hub 2.1 — Estado Atual

> Este arquivo é **substituído** a cada sessão, nunca acumulado. O histórico fica em `docs/REGISTRO.md`.

## Controle

| Campo | Valor |
|---|---|
| Última atualização | 2026-10-13 — Claude — **aceite técnico da F8-2 registrado (DEC-F8-005)**; P31 corrigida |
| **Sessão ativa** | nenhuma |
| Branch | `hub-2.1` (nunca trabalhar em `main` ou `hub-2.0`) |
| **Baseline de código** | `2fd34dc` no público `Julianogdc/zafira-hub` — F8-2 com correção do painel de aprovação (espelho no interno: `b7de353`) |
| Situação da baseline | **CI oficial 5/5** no público, run 38429147116 (https://github.com/Julianogdc/zafira-hub/actions/runs/38429147116): domínio 87/87, API 822/822, web 84/84, PostgreSQL 140/140; **Browser Gate F8 PASS (54 verificações, 0 falhas)** e gates F4–F7 PASS; somente runners `ubuntu-latest`, **0 ms faturáveis**. **F8-2 aceita tecnicamente pela Direção (DEC-F8-005, 2026-10-13).** |

"Baseline de código" é o último commit que alterou código. Commits posteriores que só mudam `docs/`, `AGENTS.md`, `CLAUDE.md` ou `GEMINI.md` são esperados. A verificação está em `AGENTS.md`.

## Onde estamos

- **Repositórios (DEC-GOV-005):** este é o repositório **público** de desenvolvimento (código, testes, CI, Browser Gates e documentação técnica sem informação operacional). Governança integral, infraestrutura, auditorias e histórico original ficam no repositório **interno privado**; itens sensíveis aparecem aqui só como referência `INT-<n>`. Os SHAs citados nos registros anteriores pertencem ao histórico interno.

- **Fase:** **F7 — Onboarding e Agenda: ENCERRADA funcionalmente em 2026-10-12** (DEC-F7-018). **F8 — Conteúdos: EM EXECUÇÃO.** F8-0 aceita como levantamento histórico (DEC-F8-003); F8-1 aceita tecnicamente (DEC-F8-004); **F8-2 aceita tecnicamente e encerrada tecnicamente** (DEC-F8-005: commit `2fd34dc`, run 38429147116 com CI 5/5, Browser Gate F8 54/0, publicação GHCR aprovada). **Não autorizadas:** F8-3 (próxima prevista), F8-4 (exige antes a **F8-0b**) e F8-5. Refinamento estético adiado (DEC-F7-015).
- **Ressalvas da F7 (obrigatórias):** P22 bloqueia o primeiro deploy de homologação; P28 bloqueia dados reais; Google Calendar e n8n **não homologados com contas reais**; agendadores desligados até medição de capacidade e autorização; criar/editar evento pelo Hub não existe (DEC-F7-001, evolução futura).
- **Mapa Mestre:** versão **2026.10.12-C2** — partes 13 a 17 incorporadas (critérios, portões F7–F18, transversais). Itens **[DECIDIR]** seguem pendentes. Sem nova fase para dashboards finais nem identidade visual (DEC-F6-006).
- **Decisões vigentes da trilha F7:** DEC-F7-001 a DEC-F7-018. **Trilha F8:** DEC-F8-001 a DEC-F8-005.
- **Resumo da F7-3 (entregue e aceita tecnicamente — DEC-F7-013/014/015):** agenda Google **somente leitura** (F7-3a): OAuth da organização (`IntegrationConnection`, credencial cifrada), calendários escolhidos pelo administrador, sincronização por **janela móvel (−30/+180 dias) com `updatedMin`** e reconciliação diária (sem `syncToken`), participantes por **HMAC** com associação explícita, evento sem cliente invisível à agência, privado mascarado no backend, retenção só medida, agendador **desligado por padrão**. **F7-3b:** telas (agenda mensal/semanal, filtros, vínculo local, configuração, estados de conexão/revogação/desatualização) e capacidades `calendar.*`. **F7-3c:** etapas de onboarding `CALENDAR_EVENT` concluídas por pessoa com **evento já vinculado ao cliente** (condição atendida/pendente/indisponível; vínculo não conclui; cancelado/removido/desmarcado/conexão revogada tratados; instantâneo no histórico).
- **Resumo da F7-4a (entregue e aceita tecnicamente — DEC-F7-017):** etapa `AUTOMATION` com condição `AUTOMATION_SUCCEEDED` (catálogo fechado, DEC-F7-016); **conexão** por organização (`IntegrationConnection` provider `N8N`, segredo ≥32 caracteres cifrado, só impressão digital exibida) e **fluxos** por organização (destino só https e em host de `N8N_ALLOWED_HOSTS`; sem redirecionamento; só o host é exibido); **caixa de saída transacional** (`automation_outbox`: pedido gravado na mesma transação que libera a etapa, índice único por execução/etapa/fluxo/tipo/geração, chave de idempotência SHA-256 estável nos reenvios, gatilho no banco que protege identidade e resultado SUCCEEDED); **despachante** na própria API (lease `n8n-dispatch-tick`, reserva otimista, retentativas 1/5/15/60/360 min, 6 tentativas e 24 h configuráveis, DESLIGADO por padrão: `N8N_DISPATCH_ENABLED=true`); **callback** `POST /integrations/n8n/callback/:organizationId` (HMAC-SHA256 de `timestamp.corpo` com o segredo da organização, janela ±5 min, deduplicação por `WebhookEvent`, só aplica pedido `SENT` da geração vigente com etapa aberta; resultado em etapa bloqueada fica registrado e é aplicado ao desbloquear); **sem conclusão manual** (409 `AUTOMATION_MANUAL_COMPLETION_NOT_ALLOWED`); **reenvio** por `onboarding.override` com justificativa (RETRY mesma chave; REDO nova geração); permissões `automation.manage` (ADMIN) e `automation.view` (ADMIN/GERENTE); notificações de ciclo de vida opcionais por fluxo; simulador `scripts/homologation/n8n-mock.mjs`. **F7-4b (entregue, pendente de aceite):** página **Automações** (aba do onboarding, só com `automation.view`): conexão (segredo informado uma vez, só impressão digital; prazo e tentativas; remover com confirmação), fluxos (cadastro com destino https/host permitido, caminho do webhook nunca exibido, habilitar/desabilitar, avisos opcionais, nome do cliente opcional) e aviso de política do Asana; **construtor** com tipo "Automação (n8n)" e seleção do fluxo habilitado (condição derivada, publicada imutável); **execução** com estados (aguardando envio, enviada/em processamento, nova tentativa, concluída, falhou, tempo esgotado, tentativas esgotadas), resultado, referências externas (link só https), histórico por execução, concluída pelo sistema, avisos de despachante desligado e de resultado aguardando desbloqueio, **Reenviar/Refazer** (permissão de exceção, justificativa, confirmação) e **Dispensar**; etapas automáticas não contam como "sem responsável". Capacidades `automation.manage`/`automation.view` em `/auth/capabilities`.

## Mapa de progresso

| Etapa | Situação |
|---|---|
| F0–F5 | ✅ concluídas |
| **F6 (IMP.1–9, RO.0–2)** | ✅ **encerrada** (ressalva → F15) |
| F7 — Onboarding e Agenda | ✅ **encerrada funcionalmente em 2026-10-12** (DEC-F7-018), com ressalvas (P22, P28, sem homologação real de Calendar/n8n) |
| **F8 — Conteúdos** | 🟡 F8-0, F8-1 e **F8-2 aceitas** (F8-2: DEC-F8-005, run 38429147116); **próxima prevista: F8-3, não autorizada**; F8-4 (exige F8-0b) e F8-5 não autorizadas |
| F9–F18 | ⬜ pendentes (critérios e portões no Mapa, parte C2) |

## Próximo passo concreto

0. **Imediato:** itens de segurança/infraestrutura sob controle do proprietário (ver repositório interno, INT-001).
1. **Direção: autorizar (ou não) a F8-3**, próxima microetapa prevista no Mapa (`docs/propostas/F8_ESPECIFICACAO_CONTEUDOS.md`): contador de Entregas por estágio (arquivo recebido → enviado para aprovação → aprovado → publicado), **sem alterar a meta contratual**, e ajustes no painel; dependências F8-1/F8-2 atendidas. **Antes da F8-4**, a **F8-0b**; provedor S3 antes da homologação. O CI público é o CI oficial; conferir minutos faturáveis = 0 a cada run.
2. **Direção decide as recomendações de economia do CI R1–R7** (`docs/REGISTRO.md`, entrada de 2026-10-12): estimativa de consumo de 2.276 min nos últimos 100 runs; 59% dos runs foram de documentação. **Conferir o saldo no painel de cobrança antes de qualquer run completo.**
3. **Antes de qualquer ambiente real:** `rbac:bootstrap` (**P22**); `N8N_ALLOWED_HOSTS`/`N8N_CALLBACK_BASE_URL`; despachante n8n, agendador do Calendar e do espelho do Asana **desligados** até medir capacidade e haver autorização.
4. **P28 — exclusão de cliente, retenção e privacidade:** avaliar proposta `docs/propostas/F7-2_RETENCAO_EXCLUSAO_CLIENTE_PROPOSTA.md` antes de dados reais.
5. **Dependências:** pendência P27 (vulnerabilidades de dependências) detalhada no repositório interno (INT-008).
6. **Refinamento estético** adiado para etapa posterior (DEC-F7-015).

## Pendências abertas

| # | Pendência | Antes de |
|---|---|---|
| P2 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-003) | ver interno |
| P3 | ~~Mapa Mestre C2~~ **resolvida:** incorporado ao Mapa (partes 13–17) em 2026-10-12 por DEC-F6-006. Itens [DECIDIR] continuam como decisões pendentes de cada fase | — |
| P5 | Rota de conclusão do OAuth corporativo inexistente no backend do 2.1 (`exchangeOAuthCode` sem chamador; `redirect_uri` padrão aponta para o domínio do Hub 2.0) | qualquer reconexão OAuth |
| P7 | Cópia do Drive: aviso "fonte oficial no Git" nos documentos do Drive | — (Chat de Direção) |
| P8 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-004) | ver interno |
| P9 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-005) | ver interno |
| P11 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-006) | ver interno |
| P12 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-007) | ver interno |
| P13 | Lint **completo** do web com erros em módulos legados e lint da API não configurado (código F6 já é bloqueante no CI). **Critério:** `npm run lint` do web com 0 erros e lint da API configurado e no CI. **Prazo proposto:** zerar o legado por módulo à medida que for tocado e concluir **antes do encerramento da F8**; limite absoluto: antes da F18 | F8 / F18 |
| P18 | `rbac-postgres.test.ts` (anterior à F6) falha nos testes P e Q se rodado duas vezes no mesmo banco. **Critério:** `npm run test:integration:db` passa duas vezes seguidas no mesmo banco descartável (testes limpam o que criam ou usam sufixo único). **Prazo proposto:** **antes do início da F8**; limite absoluto: antes do primeiro deploy de homologação | F8 |
| P19 | `store/usePerformanceStore.ts` (legado) ainda contém gerador de dados de exemplo, não usado por padrão | revisão do módulo de Performance |
| P20 | Não há testes de componente (as telas F6 são cobertas pelo Browser Gate no CI) | quando houver componente com lógica crítica fora do gate |
| P22 | **BLOQUEADOR do primeiro deploy de homologação** (Direção, 2026-10-12): `rbac:bootstrap` só acrescenta permissões; em bancos onde rodou antes da F6-IMP.7B, o MEMBER mantém `deliverables.complete`. **Critério de saída:** (a) bootstrap sincroniza o papel com os padrões, removendo permissões padrão que deixaram de existir, sem tocar nas exceções individuais; (b) teste de integração com banco no formato antigo prova que o MEMBER perde `deliverables.complete`; (c) checagem pré-deploy lista divergências entre `RolePermission` e os padrões | primeiro deploy de homologação |
| P23 | Vínculo de evidências (tarefa do Asana, arquivo) às peças não existe na tela; só link opcional (DEC-F6-002) | quando a F8 ou o proprietário exigir prova |
| P24 | Agendador do espelho do Asana desligado por padrão; ligar exige medição de capacidade e autorização | primeiro deploy de homologação com histórico |
| P25 | Tempo real depende de `WEBHOOK_BASE_URL` https do Hub 2.1 e inscrições de aviso por projeto | homologação |
| P26 | Consumo de cota da API do Asana (aviso relê o projeto; conferência noturna relê todos) | homologação |
| P27 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-008) | ver interno |
| P28 | **Exclusão de cliente, retenção e privacidade** (Direção, DEC-F7-009): `ON DELETE CASCADE` entre cliente e execuções de onboarding pode apagar histórico na exclusão definitiva. Proposta em `docs/propostas/F7-2_RETENCAO_EXCLUSAO_CLIENTE_PROPOSTA.md`. Diferenciar desativação/arquivamento de exclusão definitiva e de remoção de organização. Não alterar o comportamento automaticamente | antes de homologação/produção com dados reais |
| P29 | **Retificado:** valor descritivo (placeholder), sem credencial comprovada e sem revogação exigida por esse achado; `secret-scan` ampliado e valor removido da árvore | encerrado, salvo nova evidência |
| P30 | ~~GitHub Actions sem minutos~~ **resolvida (2026-10-13):** CI oficial roda no repositório público com runners padrão gratuitos (`ubuntu-latest`); runs 38424632457, 38425797903 e 38429147116 com 0 ms faturáveis | — |
| P31 | ~~Seção 8 duplicada no `AGENTS.md` público~~ **resolvida (2026-10-13):** cópia duplicada removida, texto e regras de governança inalterados | — |
| P32 | `docs/MAPA_MESTRE.md` **público**, nota de abertura da parte C2 (logo antes da seção 13): trecho repetido "`(repositório interno)` (repositório interno)" após o caminho da v1.1, resíduo do saneamento. Corrigir numa próxima edição de documentação do público | próxima edição do Mapa público |

## Proibições atuais

- Deploy, VPS, EasyPanel, DNS, produção, banco real, contas Asana reais e aplicação de migrations fora de base descartável.
- Qualquer alteração na branch `hub-2.0` ou em `main`.
- Qualquer escrita no Asana a partir do Hub (exceto receber webhooks, DEC-ASANA-002).
- Tratar tarefas do Asana como idênticas às metas contratuais do Hub (não-presunção).
- **Dados fictícios em código de produção** (mocks, sessões falsas ou "planos de demonstração" como fallback de erro). Demonstração só em testes, seeds de CI ou fora do repositório.
- Criar serviço novo no servidor (worker/fila) para a sincronização (DEC-F6-003/004).
- Ligar o agendador do espelho (`ASANA_MIRROR_SCHEDULE_ENABLED=true`) em ambiente real sem medição de capacidade e autorização (P24).
- **Código da F8** (modelos, migrations, telas) antes da autorização por DEC; iniciar novos passos da P27; deploy, VPS, EasyPanel, produção; usar serviços reais (Google, n8n, Asana, BrightBean).
- Ligar `N8N_DISPATCH_ENABLED=true`, o agendador do Calendar ou o do espelho do Asana em ambiente real sem medição de capacidade e autorização; entregar ao n8n a chave global `HUB_INTERNAL_API_KEY`; criar serviço, fila ou worker novo sem autorização.
- **Configurar cobrança, tornar o repositório público, instalar runners ou alterar a infraestrutura do CI** sem autorização; disparar runs completos sem conferir o saldo de minutos; commits só de documentação sem `[skip ci]`.
- Executar upgrade amplo de dependências sem autorização por passo (P27); CI verde não equivale a ausência de vulnerabilidades.
- Criar ou alterar projetos no Asana a partir de etapas de onboarding (DEC-ASANA-001; ver D3).
- Usar `git stash` neste repositório (existe um stash antigo do proprietário em `stash@{0}`).
- Declarar aceite: só o proprietário aceita.
- Expor tokens, segredos ou dados pessoais em código, logs, documentos ou mensagens.
