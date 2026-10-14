# Zafira Hub 2.1 — Estado Atual

> Este arquivo é **substituído** a cada sessão, nunca acumulado. O histórico fica em `docs/REGISTRO.md`.

## Controle

| Campo | Valor |
|---|---|
| Última atualização | 2026-10-14 — Antigravity — **HM-3 em execução (autorizada pela Direção Técnica)**; HM-2 aceita definitivamente (DEC-HML-003). Fase 8 não encerrada (Portão F8 aberto; F8-5e não autorizada) |
| **Sessão ativa** | Antigravity — 2026-10-14 16:40 — HM-3 |
| Branch | `hub-2.1` (nunca trabalhar em `main` ou `hub-2.0`) |
| **Baseline de código** | `817315f` no público `Julianogdc/zafira-hub` — HM-2 (driver de armazenamento S3-compatível privado, validação SHA-256 e testes) (espelho no interno: `9bd4db7`; workflows e .env.example com diferenças intencionais preservadas) |
| Situação da baseline | **CI oficial 5/5** no run 38627531741 (https://github.com/Julianogdc/zafira-hub/actions/runs/38627531741): domínio 123/123, API 850/850, web 99/99, **PostgreSQL 208/208 em duas execuções consecutivas no mesmo banco**, Docker Build, Publish Images e Homologation Rehearsal (Browser Gates F6–F8 PASS, F8 125/0); 0 ms faturáveis. **HM-2 aceita tecnicamente (DEC-HML-003).** Ressalvas: Cloudflare R2 real ainda não testado; armazenamento ainda utiliza buffers integrais; idempotência por HEAD/PUT não equivale a gravação atômica em concorrência. |

"Baseline de código" é o último commit que alterou código. Commits posteriores que só mudam `docs/`, `AGENTS.md`, `CLAUDE.md` ou `GEMINI.md` são esperados. A verificação está em `AGENTS.md`.

## Onde estamos

- **Repositórios (DEC-GOV-005):** este é o repositório **público** de desenvolvimento (código, testes, CI, Browser Gates e documentação técnica sem informação operacional). Governança integral, infraestrutura, auditorias e histórico original ficam no repositório **interno privado**; itens sensíveis aparecem aqui só como referência `INT-<n>`. Os SHAs citados nos registros anteriores pertencem ao histórico interno.

- **Fase:** **F7 — Onboarding e Agenda: ENCERRADA funcionalmente em 2026-10-12** (DEC-F7-018). **F8 — Conteúdos: EM EXECUÇÃO.** F8-0 aceita como levantamento histórico (DEC-F8-003); F8-1 aceita tecnicamente (DEC-F8-004); **F8-2 aceita tecnicamente e encerrada tecnicamente** (DEC-F8-005: commit `2fd34dc`, run 38429147116 com CI 5/5, Browser Gate F8 54/0, publicação GHCR aprovada). **F8-3 (contador de Entregas por estágio): aceita tecnicamente e concluída** (DEC-F8-008; código `38ce219`, run 38446236135, CI 5/5, Browser Gate F8 70/0). **Não autorizadas:** F8-4 (exige antes a **F8-0b**) e F8-5. Refinamento estético adiado (DEC-F7-015).
- **Ressalvas da F7 (obrigatórias):** P22 bloqueia o primeiro deploy de homologação; P28 bloqueia dados reais; Google Calendar e n8n **não homologados com contas reais**; agendadores desligados até medição de capacidade e autorização; criar/editar evento pelo Hub não existe (DEC-F7-001, evolução futura).
- **Mapa Mestre:** versão **2026.10.12-C2** — partes 13 a 17 incorporadas (critérios, portões F7–F18, transversais). Itens **[DECIDIR]** seguem pendentes. Sem nova fase para dashboards finais nem identidade visual (DEC-F6-006).
- **Decisões vigentes da trilha F7:** DEC-F7-001 a DEC-F7-018. **Trilha F8:** DEC-F8-001 a DEC-F8-033. **Trilha de homologação:** DEC-HML-001 a DEC-HML-003.
- **Resumo da HM-1 (aceita tecnicamente — DEC-HML-002):** `rbac:bootstrap` sincroniza padrões dos papéis sem tocar exceções individuais (H1/P22), guarda única do banco de testes (`lib/test-database-guard.ts`) e repetibilidade de `test:integration:db` em duas execuções consecutivas no mesmo banco (H3/P18).
- **Resumo da HM-2 (aceita tecnicamente — DEC-HML-003):** driver S3-compatível privado (`file-storage.ts`, `file-storage-s3.md`) para Cloudflare R2 ou compatíveis, bucket privado sem URLs públicas, isolamento de chave por organização (`org/<orgId>/sha256/<hash>`), integridade SHA-256 conferida na escrita e leitura, idempotência determinística, testes unitários contra emulador S3 em processo e testes de integração PostgreSQL (`storage-s3-postgres.test.ts`). **Ressalvas:** Cloudflare R2 real ainda não testado; armazenamento ainda utiliza buffers integrais; idempotência HEAD/PUT não é atômica sob concorrência.
- **Resumo da F7-3 (entregue e aceita tecnicamente — DEC-F7-013/014/015):** agenda Google **somente leitura** (F7-3a): OAuth da organização (`IntegrationConnection`, credencial cifrada), calendários escolhidos pelo administrador, sincronização por **janela móvel (−30/+180 dias) com `updatedMin`** e reconciliação diária (sem `syncToken`), participantes por **HMAC** com associação explícita, evento sem cliente invisível à agência, privado mascarado no backend, retenção só medida, agendador **desligado por padrão**. **F7-3b:** telas (agenda mensal/semanal, filtros, vínculo local, configuração, estados de conexão/revogação/desatualização) e capacidades `calendar.*`. **F7-3c:** etapas de onboarding `CALENDAR_EVENT` concluídas por pessoa com **evento já vinculado ao cliente** (condição atendida/pendente/indisponível; vínculo não conclui; cancelado/removido/desmarcado/conexão revogada tratados; instantâneo no histórico).
- **Resumo da F7-4a (entregue e aceita tecnicamente — DEC-F7-017):** etapa `AUTOMATION` com condição `AUTOMATION_SUCCEEDED` (catálogo fechado, DEC-F7-016); **conexão** por organização (`IntegrationConnection` provider `N8N`, segredo ≥32 caracteres cifrado, só impressão digital exibida) e **fluxos** por organização (destino só https e em host de `N8N_ALLOWED_HOSTS`; sem redirecionamento; só o host é exibido); **caixa de saída transacional** (`automation_outbox`: pedido gravado na mesma transação que libera a etapa, índice único por execução/etapa/fluxo/tipo/geração, chave de idempotência SHA-256 estável nos reenvios, gatilho no banco que protege identidade e resultado SUCCEEDED); **despachante** na própria API (lease `n8n-dispatch-tick`, reserva otimista, retentativas 1/5/15/60/360 min, 6 tentativas e 24 h configuráveis, DESLIGADO por padrão: `N8N_DISPATCH_ENABLED=true`); **callback** `POST /integrations/n8n/callback/:organizationId` (HMAC-SHA256 de `timestamp.corpo` com o segredo da organização, janela ±5 min, deduplicação por `WebhookEvent`, só aplica pedido `SENT` da geração vigente com etapa aberta; resultado em etapa bloqueada fica registrado e é aplicado ao desbloquear); **sem conclusão manual** (409 `AUTOMATION_MANUAL_COMPLETION_NOT_ALLOWED`); **reenvio** por `onboarding.override` com justificativa (RETRY mesma chave; REDO nova geração); permissões `automation.manage` (ADMIN) e `automation.view` (ADMIN/GERENTE); notificações de ciclo de vida opcionais por fluxo; simulador `scripts/homologation/n8n-mock.mjs`. **F7-4b (entregue, pendente de aceite):** página **Automações** (aba do onboarding, só com `automation.view`): conexão (segredo informado uma vez, só impressão digital; prazo e tentativas; remover com confirmação), fluxos (cadastro com destino https/host permitido, caminho do webhook nunca exibido, habilitar/desabilitar, avisos opcionais, nome do cliente opcional) e aviso de política do Asana; **construtor** com tipo "Automação (n8n)" e seleção do fluxo habilitado (condição derivada, publicada imutável); **execução** com estados (aguardando envio, enviada/em processamento, nova tentativa, concluída, falhou, tempo esgotado, tentativas esgotadas), resultado, referências externas (link só https), histórico por execução, concluída pelo sistema, avisos de despachante desligado e de resultado aguardando desbloqueio, **Reenviar/Refazer** (permissão de exceção, justificativa, confirmação) e **Dispensar**; etapas automáticas não contam como "sem responsável". Capacidades `automation.manage`/`automation.view` em `/auth/capabilities`.

## Mapa de progresso

| Etapa | Situação |
|---|---|
| F0–F5 | ✅ concluídas |
| **F6 (IMP.1–9, RO.0–2)** | ✅ **encerrada** (ressalva → F15) |
| F7 — Onboarding e Agenda | ✅ **encerrada funcionalmente em 2026-10-12** (DEC-F7-018), com ressalvas (P22, P28, sem homologação real de Calendar/n8n) |
| **F8 — Conteúdos** | 🟡 F8-0 a F8-3 aceitas; F8-0b encerrada com ressalvas; F8-4a, F8-4b, F8-5a a F8-5d e **F8-5p aceitas** (DEC-F8-026/028/030/032); Portão F8 aberto; F8-5e não autorizada; **Fase 8 não encerrada** |
| **Homologação (HM)** | 🟡 HM-1 aceita (DEC-HML-002); HM-2 aceita (DEC-HML-003); HM-3 em execução (autorizada pela Direção); HM-4 a HM-6 e H7 a H9 pendentes |
| F9–F18 | ⬜ pendentes (critérios e portões no Mapa, parte C2) |

## Próximo passo concreto

0. **Imediato:** itens de segurança/infraestrutura sob controle do proprietário (ver repositório interno, INT-001).
1. **Direção: revisar o plano de medição da capacidade da VPS (H7)** em repositório interno (contém dados de infraestrutura; não espelhado): avaliação do script existente (seguro, mas insuficiente para I/O, picos, OOM e estabilidade de containers), procedimento de 7 dias com comandos somente leitura executados pelo proprietário, critérios de aceitação por indicador e topologias B/C/D; decisões D-H7-1 a D-H7-5. **Nada executado e nenhum acesso à VPS.** Depois: HM-2 (driver S3-compatível; R2 preferencial, fornecedor a decidir pelo proprietário), HM-3, HM-4, HM-5, HM-6 e autenticação do GHCR, conforme `docs/propostas/HOMOLOGACAO_1_BLOQUEIOS.md` (nenhuma autorizada). Despachante e coletor **desligados**; nenhuma publicação.
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
| P18 | ~~`rbac-postgres.test.ts` falha nos testes P e Q se rodado duas vezes~~ **resolvida (2026-10-14, HM-1/H3, DEC-HML-001):** o arquivo restaura o estado-base de `ci-org-a`/`ci-org-b` antes de rodar (só o que ele altera, depois das travas), a permissão do teste M é restaurada em `finally`, P ficou escopado aos próprios registros e Q restaura a configuração; guarda única `lib/test-database-guard.ts` (nome exato `zafira_hub_ci`, host local, organizações `ci-*`); o CI roda `test:integration:db` duas vezes no mesmo banco (run 38615589824). Aceita (DEC-HML-002) | — |
| P19 | `store/usePerformanceStore.ts` (legado) ainda contém gerador de dados de exemplo, não usado por padrão | revisão do módulo de Performance |
| P20 | Não há testes de componente (as telas F6 são cobertas pelo Browser Gate no CI) | quando houver componente com lógica crítica fora do gate |
| P22 | ~~`rbac:bootstrap` só acrescenta permissões~~ **resolvida (2026-10-14, HM-1/H1, DEC-HML-001):** `rbac:bootstrap` sincroniza os padrões dos papéis (acrescenta e remove; catálogo nunca é apagado; exceções individuais e dados de organizações nunca são tocados), transacional, idempotente, com trava de padrões e `--check` pré-deploy (saída 0 em sincronia, 2 divergente); teste PostgreSQL com banco no formato antigo (MEMBER com `deliverables.complete`); documentação em `docs/operations/rbac-bootstrap.md`; o CI executa o `--check` no job PostgreSQL e na imagem publicada. Aceita (DEC-HML-002). **Ainda necessário no primeiro deploy real:** rodar `--check` e ler a lista de remoções antes do bootstrap | primeiro deploy de homologação |
| P23 | Vínculo de evidências (tarefa do Asana, arquivo) às peças não existe na tela; só link opcional (DEC-F6-002) | quando a F8 ou o proprietário exigir prova |
| P24 | Agendador do espelho do Asana desligado por padrão; ligar exige medição de capacidade e autorização | primeiro deploy de homologação com histórico |
| P25 | Tempo real depende de `WEBHOOK_BASE_URL` https do Hub 2.1 e inscrições de aviso por projeto | homologação |
| P26 | Consumo de cota da API do Asana (aviso relê o projeto; conferência noturna relê todos) | homologação |
| P27 | Pendência de segurança/infraestrutura: detalhe e critério de saída no repositório interno (INT-008) | ver interno |
| P28 | **Exclusão de cliente, retenção e privacidade** (Direção, DEC-F7-009): `ON DELETE CASCADE` entre cliente e execuções de onboarding pode apagar histórico na exclusão definitiva. Proposta em `docs/propostas/F7-2_RETENCAO_EXCLUSAO_CLIENTE_PROPOSTA.md`. Diferenciar desativação/arquivamento de exclusão definitiva e de remoção de organização. Não alterar o comportamento automaticamente | antes de homologação/produção com dados reais |
| P29 | **Retificado:** valor descritivo (placeholder), sem credencial comprovada e sem revogação exigida por esse achado; `secret-scan` ampliado e valor removido da árvore | encerrado, salvo nova evidência |
| P30 | ~~GitHub Actions sem minutos~~ **resolvida (2026-10-13):** CI oficial roda no repositório público com runners padrão gratuitos (`ubuntu-latest`); runs 38424632457, 38425797903 e 38429147116 com 0 ms faturáveis | — |
| P31 | ~~Seção 8 duplicada no `AGENTS.md` público~~ **resolvida (2026-10-13):** cópia duplicada removida, texto e regras de governança inalterados | — |
| P32 | ~~Trecho repetido na nota de abertura da parte C2 do `MAPA_MESTRE.md` público~~ **resolvida (2026-10-13):** trecho removido, texto e regras inalterados | — |
| P33 | **Limpeza da F8-0b:** 15 rascunhos e 17 mídias de teste no BrightBean (inventário no repositório interno), o Story publicado no T30 (registro no BrightBean) e **revogação da chave temporária** (validade 20/10/2026) + remoção da variável local `ZAFIRA_F80B_BB_KEY`. Rascunhos só saem pela interface. Fazer quando a Direção encerrar os testes | fim dos testes com o BrightBean |
| P34 | **Métricas do T30:** ler só por GET `GET /analytics/posts/{D6}` em ~2 h, ~6 h e ~20 h após a publicação (2026-10-14 00:25 UTC); dado só com `captured_at` preenchido; se seguir nulo após 2 ciclos horários, registrar limitação (RS3) sem nova publicação | antes de o Story completar 24 h |
| P35 | ~~Validação de megapixels no Hub~~ **resolvida (F8-5p.1, DEC-F8-031):** dimensões lidas de JPEG/PNG/WebP e gravadas uma vez (nulo → valor, imutáveis), aviso já no upload, agendamento recusado acima de 30 MP ou com dimensão ilegível; CI run 38594989571 | — |
| P36 | ~~Teste PostgreSQL do teto de 25 publicações por conta em 24 h~~ **resolvida (2026-10-14, F8-4b.1):** `publication-ui-postgres.test.ts` enche 25 ativas, a 26ª é recusada (422 `DAILY_CAP_REACHED`), fora da janela de 24 h é aceita e cancelada libera a vaga; CI run 38570183115 | — |
| P37 | ~~Resíduos legados da F8-4b~~ **resolvida (F8-5p.4):** 2 modais e 4 métodos de escrita legada removidos após auditoria de referências (vínculo/desvínculo, leitura e rotas 410 preservados); aviso de publicação com limites técnicos e formatos ainda sem publicação real | — |
| P38 | ~~Erro de consulta consome o ponto da janela~~ **resolvida (F8-5p.2):** repetições em 15, 30 e 60 min sem consumir o ponto; 429 espera o retry_after (piso 60 s); reserva contra consulta simultânea | — |
| P39 | ~~Controles do piloto ausentes~~ **resolvida (F8-5p.3):** política `PUBLICATION_PILOT_ORGANIZATION_IDS`/`PUBLICATION_PILOT_FORMATS` (fail closed antes do envio; no pedido com política ou envio ligado), vínculo reconferido antes do envio, cancelamento sempre permitido, bloqueios auditados; controles em `docs/operations/publication-pilot-controls.md`. **Limite:** retirar da política não recolhe posts já agendados no provedor (cancelar pela tela) | — |
| P40 | ~~Corrida na inicialização do PostgreSQL do ensaio no CI~~ **resolvida e aceita (2026-10-14, DEC-F8-032/033):** prontidão por TCP em `127.0.0.1`, consulta `current_database()` na base definitiva, 3 respostas seguidas, espera de até 90 s, falha explícita se o container cair; CI run 38600735586. **Ressalva de acompanhamento:** a ausência da intermitência só se confirma nos próximos runs; recorrência reabre a pendência | acompanhamento nos próximos runs |
| H2 | ~~Driver de armazenamento S3-compatível~~ **resolvida no código (2026-10-14, HM-2, DEC-HML-003):** driver S3-compatível privado implementado com integridade SHA-256 e testes em emulador local e PostgreSQL. **Ressalvas técnicas:** Cloudflare R2 real ainda não testado; armazenamento em memória por buffers integrais (demanda da HM-3); idempotência HEAD/PUT não é atômica em concorrência | teste com bucket R2 real após credenciais/bucket |

## Proibições atuais

- Deploy, VPS, EasyPanel, DNS, produção, banco real, contas Asana reais e aplicação de migrations fora de base descartável.
- Qualquer alteração na branch `hub-2.0` ou em `main`.
- Qualquer escrita no Asana a partir do Hub (exceto receber webhooks, DEC-ASANA-002).
- Tratar tarefas do Asana como idênticas às metas contratuais do Hub (não-presunção).
- **Dados fictícios em código de produção** (mocks, sessões falsas ou "planos de demonstração" como fallback de erro). Demonstração só em testes, seeds de CI ou fora do repositório.
- Criar serviço novo no servidor (worker/fila) para a sincronização (DEC-F6-003/004).
- Ligar o agendador do espelho (`ASANA_MIRROR_SCHEDULE_ENABLED=true`) em ambiente real sem medição de capacidade e autorização (P24).
- **Código da F8** (modelos, migrations, telas) antes da autorização por DEC; iniciar novos passos da P27; deploy, VPS, EasyPanel, produção; usar serviços reais (Google, n8n, Asana, BrightBean).
- Ligar `PUBLICATION_DISPATCH_ENABLED=true` ou `PUBLICATION_METRICS_ENABLED=true`, executar a F8-5e, publicar de verdade, integrar Facebook ou iniciar a F8-5 sem autorização expressa.
- Ligar `N8N_DISPATCH_ENABLED=true`, o agendador do Calendar ou o do espelho do Asana em ambiente real sem medição de capacidade e autorização; entregar ao n8n a chave global `HUB_INTERNAL_API_KEY`; criar serviço, fila ou worker novo sem autorização.
- **Configurar cobrança, tornar o repositório público, instalar runners ou alterar a infraestrutura do CI** sem autorização; disparar runs completos sem conferir o saldo de minutos; commits só de documentação sem `[skip ci]`.
- Executar upgrade amplo de dependências sem autorização por passo (P27); CI verde não equivale a ausência de vulnerabilidades.
- Criar ou alterar projetos no Asana a partir de etapas de onboarding (DEC-ASANA-001; ver D3).
- Usar `git stash` neste repositório (existe um stash antigo do proprietário em `stash@{0}`).
- Declarar aceite: só o proprietário aceita.
- Expor tokens, segredos ou dados pessoais em código, logs, documentos ou mensagens.
