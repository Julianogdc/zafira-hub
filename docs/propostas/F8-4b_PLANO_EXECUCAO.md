# F8-4b — Plano de execução: agendamento na tela do conteúdo aprovado

> **Situação:** plano para revisão da Direção (DEC-F8-026). **Somente análise; nada implementado.**
> Base: F8-4a aceita (DEC-F8-026; código `b8bc5a5`, CI 5/5 run 38561948692), decisões D-F84-1 a D-F84-4 (DEC-F8-023), contrato `docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md`. P35 e P36 seguem abertas.

## 1. O que já existe (levantamento)

| Área | Situação atual | Relevância para a F8-4b |
|---|---|---|
| **Detalhe do conteúdo** (`/conteudo/:id`, `ConteudoDetalhe.tsx`) | painéis Dados, Arquivos, Prévia, **Aprovação do cliente**, Versões e Histórico; componentes oficiais do DS (`Badge`, `Button`, `ErrorState`, `LoadingState`, `PermissionState`) e `Banner`; estilos `Onboarding.module.css` | **lugar natural do agendamento**: logo abaixo da aprovação, no mesmo fluxo da versão aprovada |
| Lista de conteúdos (`/conteudo`) | lista com estado de aprovação | pode ganhar o estado da publicação (opcional) |
| Permissões na tela (`useContentCapabilities`) | lê `content.view`, `content.create`, `content.send_to_client` | falta **`content.schedule`** (ADMIN e MANAGER têm; MEMBER não) |
| Fuso da organização | `currentOrganization.timezone` (DEC-F6-005), já usado em Entregas | horário exibido e digitado no fuso da organização |
| API da F8-4a | `GET/POST /content/items/:id/publications`, `POST /content/publications/:id/reschedule` e `/cancel` | pronta; falta uma leitura das **contas elegíveis** e da **situação do envio** |
| Contas sociais do cliente | `GET /api/v1/clients/:id/social/accounts` **chama o BrightBean** | não serve para a tela (depende do provedor); usar o vínculo `ClientIntegration` do Hub |
| **Telas legadas** `/conteudos` ("Conteúdos & Agenda", `ConteudosAgenda.tsx`) e `/clientes/:id/conteudo/:postId` (`ClienteConteudoPreview.tsx`) | modais `CompositorZafiraModal` (upload + criar post) e `EditarAgendamentoModal` (agendar) chamam as rotas legadas **já bloqueadas (410, D-F84-1)** | precisam de adequação: manter a leitura, retirar as ações de escrita e orientar para o conteúdo aprovado |

## 2. Como o agendamento aparece para o usuário

**Painel "Publicação no Instagram"** no detalhe do conteúdo, abaixo de "Aprovação do cliente".

1. **Sem aprovação:** o painel explica que o agendamento fica disponível quando o cliente aprovar a versão atual (sem botão).
2. **Versão atual aprovada e permissão `content.schedule`:** formulário curto —
   - **Conta:** só as contas Instagram vinculadas ao cliente (D-F84-4); sem conta, orientação para vincular.
   - **Data e hora:** no fuso da organização, com o fuso exibido ("horário de Brasília"); o envio à API leva o **deslocamento explícito** calculado para aquele instante (D-F84-2), e a tela já avisa se faltar menos de 5 minutos.
   - **Resumo:** formato, quantidade de arquivos, tamanho da legenda frente ao limite (2200) — validações do domínio antes do envio.
   - Botão **Agendar** com confirmação ("Agendar a versão N aprovada pelo cliente em …").
3. **Acompanhamento:** lista das publicações do conteúdo com selo por estado, horário no fuso da organização, link da publicação (só https) quando publicada e motivo seguro em falha. Rótulos:

| Estado | Rótulo | Ações (com `content.schedule`) |
|---|---|---|
| `PENDING` | Aguardando envio | Reagendar, Cancelar |
| `DRAFTED` | Preparado no Instagram | Reagendar, Cancelar |
| `SCHEDULED` | Agendado | Reagendar, Cancelar |
| `PROVIDER_RETRY` | Nova tentativa automática | Reagendar, Cancelar |
| `PUBLISHING` | Publicando | — (só acompanhamento, D-F84-3) |
| `PUBLISHED` | Publicado | — (link da publicação) |
| `FAILED` | Falhou | — (motivo; pode agendar de novo) |
| `CANCELLED` | Cancelado | — |
| `AMBIGUOUS` | Em conferência | — (aguardando reconciliação) |

4. **Envio desligado:** enquanto `PUBLICATION_DISPATCH_ENABLED` estiver desligado, o painel diz com clareza: *"Agendamento registrado. O envio ao Instagram ainda não está ativo neste ambiente."* — nada parece publicado sem estar.
5. **MEMBER** (sem `content.schedule`): vê o acompanhamento, sem ações.
6. **390 px:** formulário em coluna única, sem rolagem horizontal; mesmos componentes do DS.

Nenhum fluxo editorial novo (pauta e aprovação interna seguem no Asana); nada de "excluir publicação".

## 3. Ajustes de API (pequenos, só leitura)
- `GET /content/items/:id/publication-targets` (`content.view` + escopo): contas do cliente vinculadas por `ClientIntegration`, só Instagram, com `charLimit` quando houver — **sem chamar o provedor**.
- `GET /content/publication-settings` (`content.view`): `{ dispatchEnabled, minLeadMinutes: 5, pilot: 'instagram' }` para o aviso do item 2.4.
- Capacidades: incluir `content.schedule` no `useContentCapabilities`.

## 4. Telas legadas (D-F84-1)
`/conteudos` e `/clientes/:id/conteudo/:postId` continuam para **consulta**. Os botões que abriam o compositor e a edição de agendamento passam a mostrar a orientação "Para agendar, abra o conteúdo aprovado em Arquivos de conteúdo" com link, sem chamar as rotas bloqueadas. Os modais deixam de ser abertos (código mantido até decisão de remoção).

## 5. Microetapas propostas
| Microetapa | Escopo | Testes |
|---|---|---|
| **F8-4b.1** | API de leitura (`publication-targets`, `publication-settings`); capacidade `content.schedule`; **P36** (teste PostgreSQL do teto de 25/24 h), se a Direção incluir | API e PostgreSQL |
| **F8-4b.2** | utilitários puros da tela (fuso → ISO com deslocamento, rótulos e ações por estado, validação antes do envio) + **painel "Publicação no Instagram"** no detalhe | testes de unidade da web; typecheck; lint |
| **F8-4b.3** | adequação das telas legadas (sem escrita, com orientação) | testes da web |
| **F8-4b.4** | **Browser Gate F8** estendido: agendar, reagendar, cancelar e acompanhar; MEMBER sem ações; Org B; 390 px; aviso de envio desligado | Browser Gate no CI |

Uma única rodada do CI oficial ao fim (as quatro microetapas em commits separados), salvo falha.

## 6. Decisões pedidas à Direção
- **D-F84B-1 — Local:** painel no detalhe do conteúdo aprovado (**recomendado**) ou tela separada de agenda.
- **D-F84B-2 — Telas legadas:** manter só leitura com orientação (**recomendado**) ou retirar do menu "Conteúdos & Agenda".
- **D-F84B-3 — Browser Gate:** (a) cobrir só os estados sem envio (`PENDING`/cancelamento) com o despachante desligado — **recomendado para a F8-4b**; ou (b) subir um simulador HTTP do BrightBean no ensaio do CI e ligar o despachante **só ali** para ver `SCHEDULED`/`PUBLISHED` na tela (mais cobertura, mais infraestrutura de teste).
- **D-F84B-4 — P36:** incluir o teste PostgreSQL do teto diário na F8-4b.1 (recomendado) ou manter para depois. **P35** (megapixels) segue fora da F8-4b.

## 7. Critérios de aceite
Agendar só a versão atual aprovada; contas só Instagram vinculadas ao cliente; horário no fuso da organização com deslocamento explícito e mínimo de 5 min; sem reagendar/cancelar depois de `PUBLISHING`; aviso honesto de envio desligado; MEMBER só acompanha; Org B isolada; 390 px sem rolagem horizontal; telas legadas sem escrita; identidade visual e componentes oficiais preservados; CI oficial 5/5; **despachante continua desligado e nenhuma publicação real**.

## 8. Fora do escopo
Ligar o despachante, publicação real, Facebook e outras redes, métricas (F8-5), P35, VPS e produção.
