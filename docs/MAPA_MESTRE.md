# Zafira Hub 2.1 — Mapa Mestre Único (OFICIAL)

**Direção • Escopo • Arquitetura • Fases • Homologação**

| Campo | Valor |
|---|---|
| Versão | 2026.10.12-C2 (C1 de 10/10/2026 preservado; parte C2 incorporada por DEC-F6-006) |
| Origem | Google Docs "Zafira Hub 2.1 — MAPA MESTRE ÚNICO — OFICIAL", transcrito para o Git na GOV-1 |
| Fonte canônica | **Este arquivo, na branch `hub-2.1`.** O Google Docs é cópia de leitura (DEC-GOV-001). |
| O que este arquivo NÃO contém | Estado atual → `docs/ESTADO_ATUAL.md`. Decisões e cronologia → `docs/REGISTRO.md`. |
| Parte C2 | Critérios de pronto/concluído, Browser Gate por fase, critérios e portões F7–F18, segurança, testes, observabilidade e migração estão nas **seções 13 a 17** (incorporadas em 2026-10-12, DEC-F6-006). Itens **[DECIDIR]** seguem pendentes. |

Trechos marcados com **[GOV-1]** foram ajustados na transcrição para refletir decisões registradas em `docs/REGISTRO.md`. O restante é o texto da versão C1.

---

## 1. Finalidade e precedência

Este documento reúne o escopo de produto, as decisões normativas, a numeração oficial das fases e os portões do Zafira Hub 2.1.

**[GOV-1]** A fonte canônica é o repositório Git (`hub-2.1`). Alterações nascem no Git; o Drive pode ser atualizado como cópia de leitura, nunca editado de forma independente.

Nenhum segundo Mapa Mestre, plano de protótipo, anexo pós-AgencyFlow ou documento em `docs/historico/` pode contrariar este texto. Arquivos antigos são históricos e não definem o próximo passo.

O proprietário é a única autoridade de decisão e aceite de produto. Nova decisão sua pode suspender imediatamente uma execução incompatível, mas só entra na versão normativa do Mapa após registro DEC com data, responsável, alternativas, impactos e aceite. Código divergente é DESVIO A CORRIGIR, não decisão automaticamente aprovada.

GitHub/CI são evidência da implementação; não são fonte de decisão de produto.

As ADRs (`docs/governance/`) e os runbooks (`docs/operations/`) são documentação TÉCNICA auxiliar, não mapas oficiais concorrentes. Preservá-los até revisão de dependências, evidências e auditoria.

## 2. Decisão de produto — Asana somente leitura

DECISÃO EXPRESSA DO PROPRIETÁRIO EM 10/10/2026: o Hub NÃO deve funcionar como gerenciador de tarefas Asana. O Asana é o motor e a fonte mestre de tarefas/projetos. O Hub usa os dados autorizados para gestão da agência.

**Autorizado na interface do Hub:** ler clientes e projetos vinculados; listar tarefas, seções, responsáveis e prazos; verificar pendências, atrasos, criticidade, progresso e carga de trabalho; filtros por cliente, equipe, colaborador e projeto; indicadores e histórico próprio; Lista, Kanban e Calendário SOMENTE VISUAIS; alertas, relatórios e links para abrir a tarefa no Asana.

**Proibido no Hub em relação ao Asana:** criar, alterar, concluir, reabrir, excluir ou mover tarefas, subtarefas, seções e projetos; mudar responsável, prazo ou status; comentar, alterar custom fields ou executar drag-and-drop que escreva no fornecedor. Essas ações são feitas no Asana. A proibição vale para FRONTEND, BACKEND, JOBS E OAUTH, inclusive rotas ainda alcançáveis por API, não somente para botões.

**Autorizado no banco do Hub:** registrar conexões corporativas, vincular localmente cliente a projeto Asana, atualizar dados de sincronização, criar snapshots e cadastrar/editar dados próprios da Zafira, como entregas contratadas, metas, planos, evidências, solicitações, aprovações e registros auditáveis. O vínculo local NÃO altera o projeto no Asana.

**[GOV-1] Webhooks Asana (DEC-ASANA-002):** PERMITIDOS como exceção técnica exclusivamente para receber eventos de leitura/sincronização e atualizar estado local do Hub. Proibidos comandos, callbacks ou fluxos que escrevam de volta no Asana. Todo webhook exige validação de assinatura, idempotência, tenant/client scope, auditoria, tratamento de erro/frescor e menor privilégio. Esta exceção não modifica a regra geral.

Interpretações anteriores de "operação controlada", "ações essenciais" ou da implementação F6-IMP.3B.2 que habilite escrita no Asana são substituídas por esta decisão. O código já construído para escritas existe como dívida de correção/isolamento, NÃO como funcionalidade aprovada.

Não fazer reversão cega de commits: preservar melhorias aceitas de leitura, segurança, tokens corporativos, paginação, escopo, estados e concorrência. Revisar todos os consumidores de API antes de bloquear rotas.

## 3. Visão de produto e papéis

O Hub reúne central administrativa e operacional da agência sem replicar integralmente motores especializados. Prioridade: Cliente 360, operação de equipe, gestão do contratado x executado, conteúdo e aprovação, histórico, métricas confiáveis e dashboards para decisão.

- **Admin:** leitura ampla e gestão autorizada, inclusive configurações, clientes, equipes, integrações, contratos e financeiro conforme permissões.
- **Gestor e Colaborador:** apenas carteiras e recursos atribuídos, tarefas Asana de leitura, entregas internas e fluxos autorizados; nunca herdar acesso por nome do cargo.
- **Cliente externo:** acesso inicialmente limitado à aprovação segura de conteúdo; não há portal completo aprovado para a primeira versão.

Experiência premium com identidade Zafira, responsividade, dark/light, Funnel Display/Funnel Sans, tokens de design e estados corretos de carregamento/erro/permissão/indisponibilidade.

## 4. Fonte de verdade por domínio

| Domínio | Fonte mestre / papel |
|---|---|
| Projetos e tarefas operacionais | Asana — somente leitura pelo Hub |
| Clientes locais, contratos, entregas, vínculos, aprovações, conteúdo, auditoria, observações históricas e snapshots | PostgreSQL do Hub |
| Agendamento/publicação social, contas e métricas orgânicas | BrightBean Studio via adaptador SocialPublisher; o Hub mantém versões de conteúdo e aprovação |
| Publicação legada | Postiz — descontinuação apenas após evidências e reconciliação |
| CRM | Twenty — o Hub pode refletir pipeline, empresas/pessoas e contexto |
| Automações e contratos | n8n |
| Caixa bancário real, saldo, extrato e conciliação | Banco Inter PJ |
| Cobranças/recebíveis | Asaas — nunca confundir com dinheiro em caixa |
| Mídia paga | Meta Ads e Google Ads (integrações próprias; BrightBean não as substitui) |
| BI analítico | Metabase |
| Agenda | Google Calendar (integração futura); arquivos sob seus próprios contratos |

Separação tecnológica: React/Vite no web, Fastify/TypeScript API, Prisma/PostgreSQL, pacote de contratos Zod, domínio, RBAC, criptografia das credenciais e adaptadores desacoplados.

## 5. Governança de desenvolvimento e segurança

**[GOV-1] Papéis (DEC-GOV-002):** o proprietário é a autoridade final de escopo, prioridades e aceite. Qualquer agente (Claude, Antigravity, ChatGPT ou outro) pode executar a microetapa autorizada, **um de cada vez**, seguindo o protocolo de `AGENTS.md`, e registra o próprio avanço em `docs/ESTADO_ATUAL.md` e `docs/REGISTRO.md`. Agentes também podem auditar e propor DECs. Nenhum agente altera direção, escopo ou aceite por conta própria.

Preservar a baseline congelada de `hub-2.0`: `43150df2b218b41575db5b1be5d96ccc8572de32`. Desenvolver na branch `hub-2.1`. Produção não é homologação.

Proibir mudança de VPS, EasyPanel, DNS, bancos produtivos, secrets e fluxos de clientes reais sem portão dedicado.

Aplicar authorization context de organização ativa, RBAC com overrides, Client Resource Scope, 401/403/404 corretos, deny-by-default, trilhas AuditLog das alterações LOCAIS relevantes, sanitização, redaction e auditoria de acessos.

Métricas do Asana: LIVE somente quando todas as páginas foram consultadas com sucesso; ERROR/UNAVAILABLE com campos null quando dados não são verificáveis; não apresentar erros como zero e listas parciais como completas. Histórico/snapshot é distinto de "consultado agora".

Fases se encerram com revisão de código, testes, CI e Browser Gate do fluxo; 5/5 jobs CI não equivale automaticamente a testes de navegação.

## 6. Numeração oficial e escopo das fases

| Fase | Escopo | Estado |
|---|---|---|
| F0 — Auditoria e baseline | Análise do Hub 2.0, inventário, segurança, congelamento, estado inicial | Concluída |
| F1 — Fundação | Autenticação corporativa, organização/membership, RBAC, permissões por campo, equipes, assignments, AuditLog, CI, Postgres, recuperação | Concluída no gate histórico |
| F2 — Integrações | IntegrationConnection, criptografia, conectores, status/erro/reconexão, SyncRun/WebhookEvent, BrightBean/SocialPublisher, Asana corporativo somente leitura, migração controlada Postiz | Concluída no escopo técnico histórico; capacidades adicionais pertencem às fases dos domínios |
| F3 — Design System e shell | Fontes, Light/Dark, navegação, sidebar/topbar, componentes, responsividade, acessibilidade, estados de dados | Concluída, baseline protegida |
| F4 — Dashboard Admin | Indicadores, ações prioritárias, contextos de cliente, carteira, drill-down, widgets, filtros, fontes/frescor, responsividade | Concluída no gate próprio |
| F5 — Clientes e Cliente 360 | Carteira e atribuições; Empresa e Marca; dados, contatos, briefings, Brand Kit; operação, projetos, solicitações e equipe; contratos/financeiro; relacionamento, reuniões e memória; integrações e histórico | Concluída — baseline `f01f4600700e28f8016de719edaa367c2a42d8a0`, Browser Gate F5 com 49 asserções |
| F6 — Projetos, Tarefas e Entregas | Cockpit de LEITURA Asana, Lista/Kanban/Calendário visuais, acompanhamento de equipe/projetos/atrasos, espelho e snapshots com proveniência, entregas próprias, vínculos e evidências | **Concluída em 2026-10-12** (DEC-F6-006), com ressalva: painel de distribuição e capacidade da equipe é requisito da F15 — seção 7 |
| F7 — Onboarding e Agenda | Templates, etapas, responsáveis, prazos, bloqueios, documentos, calendário mensal/semanal, reuniões, visitas, captações, automações n8n e Calendar | **Concluída funcionalmente em 2026-10-12** (DEC-F7-018), com ressalvas: P22 (deploy de homologação), P28 (dados reais), Calendar e n8n sem homologação com contas reais, agendadores desligados, criação de evento pelo Hub é evolução futura (DEC-F7-001) |
| F8 — Conteúdo/Aprovação/BrightBean | Arquivos finais versionados no Hub, aprovação do cliente por link seguro (sem login) com preview, agendamento/publicação da versão aprovada via adaptador, fila/status/permalink, histórico e métricas orgânicas; pauta, revisão e aprovação internas permanecem no Asana (DEC-F8-001) | **Em execução** — F8-0 aceita (levantamento, DEC-F8-003); F8-1 aceita (DEC-F8-004); **F8-2 aceita e encerrada tecnicamente (DEC-F8-005)**; **F8-3 aceita e concluída (DEC-F8-008)**; **F8-0b encerrada com ressalvas (DEC-F8-022)**; **F8-4a aceita (DEC-F8-026)**; **F8-4b aceita (DEC-F8-028)**; **F8-5a a F8-5d aceitas (DEC-F8-030)**; Portão F8 aberto (plano em `docs/propostas/PORTAO_F8_PLANO.md`); **F8-5p implementada (DEC-F8-031), pendente de aceite**; F8-5e não autorizada |
| F9 — Contratos | Preparação, modelos, versões, partes, assinatura, n8n, documento final, vencimento, renovação, histórico e vínculo com cliente | Pendente |
| F10 — Financeiro | Banco Inter, Asaas, contas, pagamentos, receitas/despesas, categorias, importação, conciliação, transferências, permissões sensíveis e fechamento; sem inflar caixa | Pendente |
| F11 — Comercial/Twenty | Leads, empresas/pessoas, pipeline, negócios, follow-ups, propostas, ganhos/perdas, origem e conversão para contrato/cliente/onboarding | Pendente |
| F12 — Health Score e Churn | Sinais de operação/financeiro/conteúdo/relacionamento/atrasos; modelo transparente e reproduzível, alertas, risco, histórico e recomendações | Pendente |
| F13 — Social/Creators/Ads/BI | Social orgânico, creators, histórico de métricas, Meta Ads/Google Ads, campanhas, relatórios e Metabase | Pendente |
| F14 — Notificações/Solicitações/Busca | Central de alertas, preferências, pedidos e solicitações, busca contextual global, ações rápidas; Novu quando útil | Pendente |
| F15 — Colaborador | Dashboard operacional, carteira autorizada, leitura de tarefas Asana, entregas do Hub, conteúdos, aprovações, agenda, notificações, sem financeiros fora de escopo | Pendente |
| F16 — Portal externo | Acesso limitado a versões de conteúdo para aprovar, comentar ou solicitar alteração; tokens/links seguros e expiração; não criar portal completo | Pendente — reutilizará o domínio de conteúdo, versões e aprovações da F8 (DEC-F8-001) |
| F17 — IA e Inteligência | Busca contextual, sumarização, recomendações, explicabilidade, registro das fontes, isolamento org/cliente, proibição de bypass RBAC | Pendente |
| F18 — Homologação e Lançamento | E2E, backup/restore, performance, segurança, migração ensaiada, reconciliação, piloto, treinamento, runbooks, janela de corte, rollback, deploy e monitoramento pós-lançamento | Pendente |

O Mapa histórico (v1.1, com F3=Clientes, F4=Asana e F5=Entregas) NÃO determina mais a numeração. O protótipo P1–P18 é artefato histórico distinto, não cronograma de engenharia.

## 7. Fase 6 — rebaseline Asana somente leitura

Marco técnico já realizado: F6-IMP.1 entrada segura `/projetos`; F6-IMP.2 confiabilidade, frescor e paginação completa; F6-IMP.3 Lista e detalhes consultivos, com implementação posterior indevida de escrita. A F6-IMP.3 NÃO será aceita como gestão com edição Asana; deve ser ajustada à direção read-only.

Sequência:

1. **F6-RO.0 — Contenção.** Auditar e bloquear todas as rotas e interfaces de escrita Asana do Hub, preservando leitura. Inventariar POST/PATCH/PUT/DELETE e handlers de tarefas, seções, subtarefas, comentários, anexos, tags, vínculos operacionais e consumidores legados; distinguir reconciliação técnica permitida (vínculos locais, webhooks de leitura) de mutação em projetos/tarefas. Remover o acesso funcional à escrita do frontend, bloquear no backend e limitar os escopos OAuth e credenciais ao mínimo de leitura. Não apagar serviços indiscriminadamente nem fazer revert global que destrua melhorias de segurança/leitura.
2. **F6-RO.1 — Segurança e testes.** Testes negativos de ausência de escrita, multi-org, client scope, 401/403/404, paginação, falha de provider, payload HTML, TypeScript web e sanitização.
3. **F6-RO.2 — Interface somente leitura.** Lista e detalhe, busca/filtros/estado/prazo/responsável/seção; deep link seguro para editar apenas no Asana.
4. **F6-IMP.4 — Kanban visual.** Agrupamento por projeto/seção/estado, SEM drag-and-drop com mutações Asana.
5. **F6-IMP.5 — Calendário visual.** Prazos e alertas de tarefas Asana; agenda interna Zafira fica na F7.
6. **F6-IMP.6 — Entregas próprias Zafira (modelo).** Contratado, período, quantidade, plano, estado, tipos e RBAC; aprovar migrations antes de executar; dados do contrato NÃO são presumidos a partir da contagem de tarefas.
7. **F6-IMP.7 — UI de Entregas e evidências.** Vínculos com Asana/Conteúdo/arquivos, revisão/fechamento e histórico auditável.
8. **F6-IMP.8 — Espelho e snapshots.** Espelho mínimo e snapshots Asana, sincronização, reconciliação, webhooks/cursores/erros/frescor. O escopo mínimo histórico e as dependências dos modelos devem ser DECIDIDOS ANTES da modelagem definitiva de Entregas, mesmo que a implementação seja escalonada.
9. **F6-IMP.9 — Homologação F6.** Browser Runtime Gate F6 (organizações, clientes, lista, filtros, Kanban somente leitura, calendário e entregas); regressão F4/F5, qualidade, performance e homologação final.

**Portão final F6:** o gestor consegue ler projetos e tarefas de clientes, verificar atrasos, responsáveis, carga, progresso, dados confiáveis e evolução histórica; consegue diferenciar contratado, previsto, entregue e pendente com evidência, sem editar tarefas Asana.

## 8. Direção UI/UX pós-AgencyFlow

O AgencyFlow é referência de ergonomia de software operacional denso, arquitetura de informação, filtros, tabelas, drawers e interações. Não copiar sua identidade, marca ou código.

O design aprovado da Zafira permanece autoridade: dark/light, fundo/cores/tipografia e tokens oficiais, responsividade com revisão em 1280px e 1440px, acessibilidade. Reavaliar cartões excessivos em favor de hierarquia clara, linhas e divisores.

O Cliente 360 utiliza seis seções: Visão Geral; Empresa & Marca; Operação; Contrato & Financeiro; Relacionamento & Memória; Integrações.

Propostas de UX devem ser classificadas como MANTER ZAFIRA, ADAPTAR REFERÊNCIA, ADICIONAR, POSTERGAR ou DESCARTAR. Aprovação de protótipo não equivale a validação de integração real. Preservar decisões visuais já homologadas, salvo bug ou mudança explícita.

## 9. Riscos e dívidas técnicas identificadas

- **A.** Interfaces e rotas que criam/editam tarefas no Asana contrariam a decisão vigente e precisam de bloqueio explícito (UI e backend), com teste negativo.
- **B.** `sectionGid` não validado como seção de projeto autorizado; atualização de seção pode falhar e apenas emitir `console.warn`. Tratar na contenção/remoção da escrita, sem aceitar falso sucesso.
- **C.** O serviço Asana importa `AuditService` sem auditar operações; rastreabilidade local deve ser exigida nas ações próprias do Hub.
- **D.** HTML externo: o `RichTextRenderer` legado desfaz escape de entidades e usa `dangerouslySetInnerHTML` sem sanitização. Não reaproveitar até corrigir; inventariar consumidores.
- **E.** Supabase legado persiste em `useAuthStore` e em módulos (CRM, Metas, IA Studio, Ferramentas); migração futura controlada sem quebrar telas.
- Detalhe de segurança omitido da versão pública (ver registro interno).
- **G.** Ausência de modelos históricos normalizados (TaskSnapshot/ExternalTask/ExternalProject) no Prisma; a F6 deve resolver antes de afirmar memória operacional.
- **H.** Git com scripts SQL, scratch e versões antigas; só limpar depois de inventariar dependências.
- **I.** Ausência de testes E2E F6 para concorrência, navegação, permissões e leitura; CI 5/5 não substitui o gate.

## 10. Critérios de homologação

**Antes de executar:** informar branch/HEAD/upstream, estado do workspace, allowlist, contexto e autorização, impacto de produção e estratégia de rollback.

**Depois:** diff exato, testes sintéticos positivos e negativos, typecheck e lint, builds, 5 jobs CI oficiais, Browser Gates relevantes, dados de mocks, evidência de isolamento e limites. Diferenciar testes de navegador real de inspeção estática.

Ações sobre VPS, EasyPanel, DNS, banco ou usuários reais só com autorização específica e em ambiente correto.

Documentar alterações de estado em `docs/ESTADO_ATUAL.md` e decisões em `docs/REGISTRO.md`, não criando mapa paralelo a cada etapa. O estado vigente é substituído, nunca somado com cabeçalhos contraditórios.

## 11. Limpeza documental controlada

**[GOV-1] Executado em 10/10/2026:** o Mapa v1.1 do Git e os documentos de governança do Drive (Registro, Consolidação, Mapa Técnico, Início) foram preservados em `docs/historico/` com cabeçalho de histórico. `AGENTS.md` passou a ser versionado.

**Ainda não executado:** retirada da superfície oficial do Drive dos documentos Mapa Mestre Pós-AgencyFlow; Direção de Produto e UI/UX Pós-AgencyFlow; AF-UX — Registro de Decisões; Escopo Funcional Oficial; Mapa Mestre do Protótipo Visual e UX; Mapa Técnico já marcado ARQUIVADO. O Guia Visual Hub 2.0 é referência histórica; antes de retirá-lo, assegurar que cores/tokens autorizados estejam registrados no design system.

ADR-001 a ADR-019 e runbooks de segurança não devem ser excluídos sem auditoria específica. Exclusão final requer: localização única confirmada, busca por referências antigas em prompts/código, backup/revisões, lista exata de arquivos e decisão nominal do proprietário. Não reescrever histórico Git. Não apagar evidências de QA/CI e scripts operacionais sem decidir se sua remoção quebra automações.

## 12. Fontes e limites

A versão C1 foi elaborada a partir de: Mapa Mestre Técnico do Drive com atualizações; Registro de Logs; Consolidação; Mapa Mestre Pós-AgencyFlow; Direção Produto/UI-UX; Registro AF-UX; Escopo Funcional de 22/09; Mapa do Protótipo; GitHub `hub-2.1` e relatórios de auditoria externos de 10/10/2026. Não houve teste de VPS nem de clientes reais.

**Decisão normativa principal: Asana somente leitura no Zafira Hub 2.1. Criação e edição de tarefas permanecem no Asana.**


---

# Parte C2 — critérios, portões e transversais

> **Incorporada em 2026-10-12 por DEC-F6-006**, a partir de `docs/propostas/MAPA_MESTRE_C2_PROPOSTA.md`, com os ajustes da Direção. Preserva integralmente as seções 1–12 (C1), a numeração de fases e as DECs existentes. Itens marcados **[DECIDIR]** continuam **pendentes**: não são decisões aprovadas e só valem após registro de DEC. Critérios detalhados por módulo da v1.1 continuam em `docs/historico/MAPA_MESTRE_v1.1_2026-09-19.md` (repositório interno) como referência.

## 13. Governança de fases: pronto, concluído, estados, DEC e Browser Gate (C2)

### 13.1 Definição de pronto para construir (antes de cada microetapa)
- Objetivo e usuários do fluxo definidos.
- Entradas, saídas, estados vazio/parcial/erro/sem permissão e exceções descritos.
- Fonte de verdade de cada dado identificada (seção 4 do C1).
- Permissões e limites por organização, cliente, equipe e função definidos.
- Dependências técnicas e de integração disponíveis (ou simuladas para teste).
- Critérios de aceite testáveis escritos.
- Impacto em migração, histórico, auditoria e infraestrutura avaliado.
- Decisões de produto necessárias registradas como DEC (nunca preenchidas por suposição).

### 13.2 Definição de concluído (para submeter ao aceite)
- Código revisado e integrado em `hub-2.1`; CI oficial 5/5 verde.
- Migrations versionadas, ensaiadas em base descartável (inclusive com dados no formato antigo quando houver renomeação), sem aplicação em banco real.
- Testes unitários, de integração em PostgreSQL descartável e **Browser Gate** do fluxo crítico no CI.
- Permissões testadas com casos permitidos e negados, inclusive entre duas organizações.
- Estados de carregamento, vazio, parcial, erro, sem permissão e sucesso cobertos.
- **Nenhum dado fictício em código de produção** (lição da F6-IMP.7A): demonstração só em testes, seeds de CI ou fora do repositório.
- Ausência de dado nunca vira zero; frescor e origem do dado visíveis.
- Datas de "hoje", prazos e períodos no **fuso da organização** (DEC-F6-005).
- Documentação (`ESTADO_ATUAL`, `REGISTRO`, Mapa quando aplicável) atualizada.
- Aceite do proprietário registrado; plano de reversão quando houver risco de dados.

### 13.3 Estados oficiais
Não iniciado · Em análise · Pronto para construir · Em desenvolvimento · Em validação · Concluído · Bloqueado · Adiado. Item parcial não é concluído.

### 13.4 Registro de decisão (DEC)
Identificador sequencial, data e responsável, problema, decisão, alternativas, impacto (módulos, dados, segurança, prazo, infraestrutura) e condição de revisão.

### 13.5 Browser Gate por fase (padrão da F6-IMP.9)
Cada fase com tela nova ganha um script em `scripts/homologation/` executado no job *Homologation Rehearsal*, contra as **imagens publicadas**, banco de ensaio e **provedores externos simulados** (somente leitura quando o provedor é de leitura; o simulado conta e reprova qualquer escrita indevida). Mínimo por gate: login real, fluxo principal, estados de erro/vazio, isolamento entre duas organizações (tela e API), 390 px sem rolagem horizontal e ausência de erros críticos de console. Os gates das fases anteriores continuam rodando como regressão.

---

## 14. Correspondência de numeração (v1.1 → C1 oficial) (C2)

| C1 (oficial) | Origem dos critérios na v1.1 | Observação |
|---|---|---|
| F7 Onboarding e Agenda | Fase 6, módulos 8.6 e 8.7 | — |
| F8 Conteúdo/Aprovação/BrightBean | Fase 7, módulo 8.8 | v1.1 citava Postiz; C1 usa BrightBean via SocialPublisher, Postiz só até descontinuação |
| F9 Contratos | Fase 8, módulo 8.9 | — |
| F10 Financeiro | Fase 10 (parte financeira), módulo 8.13 | — |
| F11 Comercial/Twenty | Fase 10 (parte comercial), módulo 8.12 | — |
| F12 Health Score e Churn | Fase 9, módulos 8.10 e 8.11 | — |
| F13 Social/Creators/Ads/BI | Fase 11, módulo 8.14 | — |
| F14 Notificações/Solicitações/Busca | Módulo 8.17 | — |
| F15 Colaborador | Módulo 8.1 (dashboards por função) e 6.3 | — |
| F16 Portal externo | Módulo 8.8 (parte de aprovação externa) | — |
| F17 IA e Inteligência | Fase 12, módulo 8.18 | — |
| F18 Homologação e Lançamento | Fases 13 e 15, seções 13 e 19 | decidido, ver 17.1 (DEC-F6-006) |

---

## 15. Critérios de aceite e portões por fase F7–F18 (C2)

Em todas as fases valem também 13.2 e 13.5. Os itens abaixo são os específicos da fase.

### F7 — Onboarding e Agenda
**Construção:** aprovar o template de onboarding da Zafira; execução com etapas, dependências, prazos e responsáveis; automações n8n idempotentes; Google Calendar; eventos com recorrência, participantes e conflitos; onboarding piloto completo.
**Aceite:**
- Um cliente piloto percorre o fluxo completo sem checklist paralelo.
- Etapas automáticas podem ser repetidas sem duplicar projetos, pastas ou convites.
- Bloqueios e responsáveis aparecem no painel do gestor.
- Evento criado no Hub aparece no calendário correto sem duplicidade; alteração externa chega ao Hub dentro do intervalo acordado.
- Participantes e fusos corretos em eventos recorrentes (fuso da organização, DEC-F6-005).
**Portão F7:** novo cliente atravessa onboarding e agenda sem controles paralelos indispensáveis.
**Decisões (2026-10-12):** DEC-F7-001 — Google Calendar é a fonte principal de eventos na 1ª entrega; o Hub lê e vincula localmente por cliente, projeto e categoria (criar/editar pelo Hub é evolução futura, com decisão própria); DEC-F7-002 — template versionado com etapas, dependências, responsável por função e prazo relativo; DEC-F7-003 — etapa de projeto Asana = confirmar projeto existente e vincular, sem escrita no Asana.
**Encerramento (2026-10-12, DEC-F7-018):** F7-1 a F7-4 entregues e aceitas tecnicamente; decisões DEC-F7-004 a 018 em `docs/REGISTRO.md`. Ressalvas: ver a linha da F7 na tabela de fases.
**[DECIDIR] antes da F7 (histórico):** calendários, contas, visibilidade e frequência de sincronização; fluxo real do onboarding da Zafira (ver `docs/propostas/F7_ONBOARDING_PROPOSTA_FUNCIONAL.md`).

### F8 — Conteúdo, Aprovação e BrightBean
> **Revisão por DEC-F8-001 (2026-10-12):** o fluxo editorial (pauta, criação, comentários, alterações e **aprovação interna**) permanece no **Asana**, somente leitura no Hub. O texto original abaixo é preservado como histórico; onde divergir, vale a DEC-F8-001 e `docs/propostas/F8_ESPECIFICACAO_CONTEUDOS.md`. Principais mudanças: aprovação do **cliente por link seguro sem login** (token, validade, revogação, escopo único, identificação proporcional ao risco, posse do link ≠ prova de identidade); Hub registra as **versões encaminhadas ao cliente**; contador de Entregas por estágio (arquivo recebido, enviado para aprovação, aprovado, publicado) sem alterar a meta contratual; storage de mídia sem dependência exclusiva do BrightBean; P28 e verificação das capacidades reais do BrightBean antes do agendamento. Portal autenticado continua sendo F16.
> **DEC-F8-002 (2026-10-12):** revisão 2 aprovada; D1 `FileStorage` (local só dev/testes; S3-compatível privado em ambientes reais), D2 sem cascata destrutiva (P28 aberta), D4 JPG/PNG/WebP/MP4/MOV até 100 MB com validação por tipo real, D5 vínculo local opcional com tarefa do Asana. Matriz de capacidades do BrightBean (F8-0) em `docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md`.
> **DEC-F8-005 (2026-10-13):** **F8-2 aceita e encerrada tecnicamente** (aprovação do cliente por link seguro; commit `2fd34dc`, CI 5/5, Browser Gate F8 54/0). F8-0 e F8-1 já aceitas (DEC-F8-003/004). Próxima microetapa prevista: **F8-3** (contador de Entregas por estágio, sem alterar a meta), ainda não autorizada; F8-4 exige a F8-0b.
> **DEC-F8-006 (2026-10-13):** interface da **F8-3** aprovada — quatro contadores no painel de Entregas (arquivos recebidos, enviados para aprovação, aprovados pelo cliente, publicados) e barra de publicadas ÷ recebidas; cumulativos por estágio, uma peça por conteúdo, meta nunca alterada automaticamente, publicação só com confirmação confiável. Contrato técnico em `docs/propostas/F8-3_CONTRATO_CONTADOR_ENTREGAS.md`; **código só após nova DEC**.
> **DEC-F8-007 (2026-10-13):** contrato da F8-3 aprovado — **D1** competência do plano da peça vinculada, senão mês do primeiro arquivo no fuso da organização; **D2** contagem derivada de Conteúdos/Aprovações, sem alterar meta nem etapas manuais de Entregas (substitui a §9 original da especificação); **D3** uma peça por conteúdo, da mesma organização e cliente (serviço e banco). Implementação autorizada; conclusão só com aceite técnico.
> **DEC-F8-008 (2026-10-13):** **F8-3 aceita e concluída** (commit `38ce219`, CI 5/5, Browser Gate F8 70/0). Próxima microetapa prevista: **F8-0b** (verificação ativa do BrightBean), pré-requisito da F8-4; exige autorização expressa.
> **DEC-F8-009 (2026-10-13):** preparação da **F8-0b** autorizada e concluída, sem escrita nem publicação (plano em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md`). Execução em fases (R0 leitura, R1 rascunhos, R1+ agendamento distante e cancelamento, R2 publicação real teste a teste), cada uma com autorização própria.
> **DEC-F8-022 (2026-10-13):** **F8-0b encerrada tecnicamente com ressalvas** (R0, R1, R1+ e T30 aceitos; T31 e T32 adiados, condicionados aos pilotos de carrossel e Facebook; T33 e T34 substituídos por simulação e testes automatizados; ressalvas RS1–RS7). **F8-4 autorizada só para preparação técnica** (proposta em `docs/propostas/F8-4_PROPOSTA_EXECUCAO.md`, contrato em `docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md`); implementação depende de nova DEC.
> **DEC-F8-023 (2026-10-13):** decisões da F8-4 — **D-F84-1** rotas legadas de escrita no BrightBean bloqueadas (consultas mantidas); **D-F84-2** antecedência mínima de 5 min com fuso explícito; **D-F84-3** sem reagendar/cancelar depois de `PUBLICANDO`; **D-F84-4** piloto exclusivamente Instagram, arquitetura aberta a outras redes. **F8-4a autorizada** (domínio, caixa de saída, despachante desligado por padrão, simulador, validações, testes); F8-4b só com nova DEC.
> **DEC-F8-026 (2026-10-14):** **F8-4a aceita definitivamente** (código `b8bc5a5`, CI 5/5; imagens-base do espelho no GHCR, DEC-F8-025). F8-4b (telas do agendamento no conteúdo aprovado) planejada em `docs/propostas/F8-4b_PLANO_EXECUCAO.md`; implementação só com nova DEC. P35 e P36 abertas.
> **DEC-F8-027 (2026-10-14):** **F8-4b autorizada e implementada** — painel "Publicação no Instagram" no detalhe do conteúdo, abaixo da aprovação (D-F84B-1); telas legadas só leitura (D-F84B-2); Browser Gate com despachante desligado (D-F84B-3); P36 resolvida na F8-4b.1 (D-F84B-4). `PROVIDER_RETRY` bloqueia reagendar/cancelar. Código `ad44325`, CI 5/5; pendente de aceite. Despachante desligado; sem publicação real.
> **DEC-F8-028 (2026-10-14):** **F8-4b aceita definitivamente** (código `ad44325`, CI 5/5, Browser Gate F8 104/0, P36 resolvida). F8-5 (status, permalink, métricas com ausência ≠ zero, Portão F8) proposta em `docs/propostas/F8-5_PROPOSTA_EXECUCAO.md`; bloqueios da primeira homologação sintética em `docs/propostas/HOMOLOGACAO_1_BLOQUEIOS.md`. Implementação só com nova DEC.
> **DEC-F8-029 (2026-10-14):** D-F85-1 a D-F85-7 aprovadas; **F8-5a a F8-5d implementadas** — coletas de métricas append-only (`capturedAt` do provedor x `fetchedAt` do Hub; ausência ≠ zero), coletor desligado por padrão, API de métricas, Publicados só com publicação confirmada (indisponível com envio desligado), desempenho na tela e Browser Gate com dados sintéticos. Código `ba0d5e7`, CI 5/5; pendente de aceite. F8-5e (piloto real do Portão F8) só em homologação controlada, com autorização específica.
> **DEC-F8-030 (2026-10-14):** **F8-5a a F8-5d aceitas definitivamente** (CI 5/5). **A Fase 8 não está encerrada:** depende do Portão F8. Plano em `docs/propostas/PORTAO_F8_PLANO.md`: correções pré-piloto F8-5p (P35, P38, controles do piloto P39, P37), pré-requisitos (homologação H1–H9, chave do piloto), piloto de 2 publicações (Story e Feed de imagem) com evidências e rollback, e critério de fechamento do Portão. Implementação só com nova DEC.
> **DEC-F8-031 (2026-10-14):** **F8-5p implementada** (correções pré-piloto): P35 dimensões e limite de 30 MP; P38 repetições controladas do coletor; P39 barreiras do piloto (organizações e formatos autorizados, vínculo reconferido, fail closed); P37 legado removido e aviso de formatos sem publicação real. Código `72ae027`, CI 5/5; pendente de aceite. Fase 8 segue aberta até o Portão F8.
**Construção:** ContentItem/ContentVersion; revisão interna e comentários; envio seguro ao cliente; aprovação, pedido de alteração e nova versão; agendamento/publicação pela versão aprovada via SocialPublisher (BrightBean); sincronização de agendamento, publicação, falhas e permalink; ligação com Entregas (as etapas "aprovada" e "postada" das peças passam a ser preenchidas por aqui — revisão prevista na DEC-F6-002).
**Aceite:**
- O cliente aprova exatamente a versão que será agendada (versão imutável).
- Pedido de alteração preserva comentários e a versão anterior.
- Feed, Reels, Stories, vídeo e carrossel classificados e exibidos corretamente.
- Retentativa de agendamento não cria publicação duplicada.
**Portão F8:** conteúdo piloto percorre criação, revisão, aprovação, agendamento e publicação com trilha completa.

### F9 — Contratos
**Construção:** mapear estados e documentos atuais; contrato, versões, partes e eventos; n8n e assinatura; alertas de vencimento e renovação; vínculo com onboarding, Entregas (meta contratada) e financeiro; testes de reenvio, expiração, duplicidade e falha.
**Aceite:** contrato percorre rascunho, envio, assinatura e arquivamento sem operação externa paralela; documento final localizável no Cliente 360; eventos duplicados não alteram o estado indevidamente.
**Portão F9:** contrato piloto é criado, enviado, assinado, arquivado e localizado dentro do Hub.

### F10 — Financeiro
**Construção:** plano de contas e regras de competência; auditoria do financeiro existente; Banco Inter (caixa real) e Asaas (recebíveis) separados; importação, conciliação, transferências; permissões sensíveis; fechamento; **exportação do relatório financeiro em PDF** (a biblioteca de PDF foi removida do web na P27.1 por não ter uso; reintroduzir já na versão corrigida e com permissão de exportação).
**Aceite:** saldo e totais do período reconciliam com a fonte escolhida; importar o mesmo arquivo de novo não duplica lançamentos; mudança de permissão remove acesso a telas, endpoints e exportações; recebível nunca aparece como dinheiro em caixa.
**Portão F10:** financeiro reconcilia com as fontes escolhidas e não expõe valores a quem não tem permissão.

### F11 — Comercial (Twenty)
**Construção:** pipeline, campos e integração Twenty; snapshots comerciais; ganho/perda e conversão para contrato/cliente/onboarding.
**Aceite:** pipeline do Hub reconcilia com amostra do Twenty; negócio ganho inicia o fluxo definido uma única vez; usuário sem acesso a valores vê a visão permitida sem vazamento por contagens ou exportações.
**Portão F11:** pipeline reconcilia com o Twenty e respeita permissões de valores.
**[DECIDIR] antes da F11:** momento de implantar o Twenty (capacidade da VPS).

### F12 — Health Score e Churn
**Construção:** taxonomia de ciclo de vida e churn; primeira fórmula do Health Score (versionada); eventos, snapshots e explicações; listas de risco e próximas ações; coortes e reconciliação; período de calibração.
**Aceite:** cada ponto da nota é reproduzível pelos sinais armazenados; o usuário entende por que a nota subiu ou caiu; baixa cobertura de dados reduz a confiança exibida; métricas de churn reconciliam cliente a cliente; receita perdida usa o valor efetivo do período; motivo não definido aparece como pendência.
**Portão F12:** métricas reproduzíveis; cada score informa fatores, cobertura e versão da fórmula.
**[DECIDIR] antes da F12:** fórmula inicial do Health Score; definição de churn.

### F13 — Social, Creators, Ads e BI
**Construção:** métricas orgânicas disponíveis; snapshots de perfis; fonte permitida para creators; conectores Meta Ads e Google Ads; armazenamento e atualização; Metabase com acesso seguro; relatórios operacionais sem duplicar o BI.
**Aceite:** cada indicador informa fonte, período e última atualização; conta desconectada preserva histórico e mostra interrupção; comparações usam a mesma definição e janela.
**Portão F13:** indicadores com fonte, período e frescor; Metabase respeita a separação de dados por organização.
**[DECIDIR] antes da F13:** arquitetura de Ads.

### F14 — Notificações, Solicitações e Busca
**Aceite:** usuário recebe só eventos do seu escopo; notificações repetidas são agrupadas; solicitação tem responsável e estado rastreável até o encerramento; busca global não retorna nada fora da carteira/permissão.
**Portão F14:** central de alertas e busca respeitam escopo e permissões em testes entre duas organizações.
**[DECIDIR]:** uso do Novu.

### F15 — Colaborador
**Aceite:** painel operacional mostra só a carteira autorizada; tarefas Asana somente leitura; Entregas, conteúdos, aprovações, agenda e notificações do escopo; nenhum dado financeiro fora de escopo (testes negativos por API e tela).
**Requisitos herdados (DEC-F6-006):** painel de **distribuição e capacidade da equipe** (carga de trabalho por responsável, que na F6 ficou parcialmente atendida por filtros e agrupamentos); completar aqui a experiência de dashboards do colaborador.
**Portão F15:** colaborador opera o dia a dia sem acessar nada fora da sua carteira e função.

### F16 — Portal externo (aprovação)
**Aceite:** acesso limitado às versões de conteúdo do próprio cliente; links/tokens imprevisíveis, com expiração e revogação; reuso ou adivinhação de link falha; ação registrada com identidade do aprovador; não há portal completo.
**Portão F16:** cliente externo aprova, comenta ou pede alteração com segurança, sem ver nada além da versão enviada.

### F17 — IA e Inteligência
**Aceite:** pergunta sobre um cliente nunca retorna dados de outro; afirmação factual relevante aponta para registro acessível; ações propostas não executam antes de confirmação e checagem de permissão; testes de prompt injection e exclusão; custo, latência e qualidade observáveis.
**Portão F17:** testes demonstram que a IA usa só contexto autorizado, cita fontes internas e não executa ações sem confirmação.

### F18 — Homologação e Lançamento
**Construção:** regressão completa (todos os Browser Gates); auditoria de segurança e permissões; migração ensaiada e reconciliada (seção 16.6); piloto por função e por cliente externo; correção de bloqueadores e aceite explícito dos riscos residuais; backup, rollback e janela de corte aprovados; treinamento e guias; migração final com monitoramento reforçado; revisões após 7, 30 e 60 dias.
**Revisões globais (DEC-F6-006):** revisão dos dashboards (fórmula, fonte, frescor e caminho até o detalhe de cada indicador) e **auditoria visual e de consistência** com o Design System da F3 em todas as telas.
**Portão F18:** produção estável, dados reconciliados, responsáveis treinados e retorno disponível dentro da janela aprovada.
**[DECIDIR] antes da F18:** topologia de produção (carga medida, disponibilidade, orçamento).

---

## 16. Segurança, testes, observabilidade e migração — transversais (C2)

### 16.1 Controles de segurança obrigatórios
Detalhe de segurança omitido da versão pública (ver registro interno).

### 16.2 Classificação de dados
Público · Interno · Confidencial (contratos, preços, financeiro, tokens: permissão específica, auditoria, criptografia) · Pessoal (finalidade, acesso mínimo, retenção) · Segredo (nunca exibir, registrar ou exportar em claro).

### 16.3 Ameaças mínimas a testar em toda fase que toque o assunto
Acesso a outro `organizationId` por URL/payload; troca de `clientId`; link público reutilizado ou adivinhado; webhook forjado, repetido ou fora da janela; upload malicioso; exportação maior que o escopo da tela; prompt injection; token em log/erro/navegador; privilégio mantido após suspensão; ação duplicada por clique repetido, retry ou reenvio (padrão F6: `expectedStage` + trava por registro).

### 16.4 Estratégia de testes
Unitário (regras, cálculos, permissões, transições) · Integração em PostgreSQL descartável (migrations, repositórios, adaptadores simulados) · Contrato (payloads dos provedores) · Browser Gate no CI (1.5) · Segurança (isolamento, escalada, tokens, uploads, links, exportações) · Migração (2.0 → 2.1 com reconciliação) · Desempenho (listas, dashboards, sincronizações) · Recuperação (backup, restore, retry, idempotência, rollback) · Aceite (cenários reais do proprietário).
**Dados de homologação:** duas organizações fictícias; clientes em todos os estados; projetos com tarefas atrasadas/sem responsável/concluídas; entregas completas, parciais, extras, canceladas e reabertas; conteúdos em todos os formatos e estados; contratos em todos os estados; recebíveis em todos os estados; integrações conectadas, expiradas, limitadas e com falha.

### 16.5 Observabilidade
`requestId`/correlação em chamadas, jobs e webhooks; logs sem conteúdo sensível; duração e contagem de sincronizações (`SyncRun`); separação entre erro recuperável, falha permanente e ação do usuário; alertas de banco, RAM/swap/CPU/disco, fila parada, webhook falhando, integração sem sincronizar, 5xx/latência, backup ausente e credencial/certificado vencendo; runbook por integração (verificar conexão, repetir sincronização com segurança, limite de API, recuperar webhook perdido, renovar credencial, desligar sem apagar histórico).

### 16.6 Migração e convivência
Hub 1.0 e 2.0 continuam disponíveis; o 2.1 começa em homologação. Passos: inventário de dados e campos sem destino → scripts idempotentes com relatório de entrada/saída/ignorados/erros → ensaio em cópia e reconciliação de contagens e amostras → piloto → janela de corte, congelamento e sincronização final → backup verificável → ativação com monitoramento → retorno possível na janela aprovada → aposentadoria das versões anteriores só após aceite e retenção.
**Reconciliação obrigatória:** organizações, usuários, membros e funções; clientes, status, responsáveis e integrações; vínculos Asana; contratos e documentos; dados financeiros; arquivos e URLs; auditoria dos registros descartados ou transformados.

---

## 17. Lacunas e decisões do proprietário (C2)

### 17.1 Dashboards finais e identidade visual (decidido — DEC-F6-006)
- **Dashboards finais:** não há fase nova. Métricas, fórmulas e drill-down são desenvolvidos nas fases dos respectivos domínios; a experiência do colaborador completa-se na F15; a revisão global é feita na F18.
- **Identidade visual:** não há fase nova. O Design System da F3 é de aplicação **obrigatória** em toda interface nova; a auditoria visual e de consistência é feita na F18.

### 17.2 Decisões pendentes herdadas (resolver na fase indicada)
| Decisão | Quando | Situação em 2026-10-12 |
|---|---|---|
| Fila PostgreSQL ou Redis | quando houver carga que justifique | DEC-F6-003/004: agendamento dentro da API, sem fila nova, até medir capacidade (P24) |
| Storage principal de arquivos | antes da F8 | aberta |
| Calendar como fonte por tipo | F7 | **decidida** — DEC-F7-001 (Google Calendar é a fonte principal na 1ª entrega; leitura e vínculo local); fonte por tipo de evento além disso segue como evolução |
| Fórmula do Health Score | F12 | aberta |
| CAC e LTV | antes dos painéis financeiros | aberta |
| Momento do Twenty | F11 | aberta |
| Arquitetura de Ads | F13 | aberta |
| Uso do Novu | F14 | aberta |
| Topologia de produção | antes da F18 | aberta; depende da medição de capacidade (Fase 0, P24) |
| Pendência de segurança de dependências | ver registro interno (INT-008) | — |

### 17.3 Riscos e respostas (mantidos da v1.1, atualizados)
Escopo crescente → fases com portão e DEC · Reescrever partes estáveis → testes de caracterização antes · Dependência de APIs → snapshots, último estado válido, frescor (padrão F6-IMP.8) · Dados inconsistentes → fonte de verdade e reconciliação · Permissões frágeis → negação por padrão e testes entre organizações · Infraestrutura saturada → medir antes de adicionar serviço · Painéis bonitos e incorretos → fórmula, fonte e drill-down · IA vazar contexto → filtros antes da recuperação e testes adversariais · Migração interromper produção → convivência, ensaio, backup e rollback · Aprovação publicar versão errada → versão imutável · Automação duplicar ações → idempotência e histórico de execução · Dados fictícios parecerem reais → proibição em código de produção e trava de regressão (F6-IMP.7A).

