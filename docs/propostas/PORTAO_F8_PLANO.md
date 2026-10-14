# Portão F8 / F8-5e — Plano detalhado, auditoria das pendências e controles do piloto real

> Situação: **plano, somente análise** (DEC-F8-030). Nada aqui autoriza correção, piloto, conexão de conta, despachante, coletor, VPS, credenciais ou produção.
> **Aceite técnico da F8-5a a F8-5d ≠ encerramento da Fase 8.** A Fase 8 só se encerra com o **Portão F8** ("conteúdo piloto percorre criação, revisão, aprovação, agendamento e publicação com trilha completa") e com o aceite da Direção sobre as ressalvas restantes.
> Base: Mapa Mestre (F8), DEC-F8-022/023/027/029, `F8-5_PROPOSTA_EXECUCAO.md`, `HOMOLOGACAO_1_BLOQUEIOS.md`, código em `ba0d5e7`.

## 1. Auditoria das pendências P35, P37 e P38

### P35 — Megapixels não validados no Hub
- **Evidência:** F8-0b, U9: PNG 6000×6000 (36 MP) recusado pelo provedor com 422 ("the limit is 30 megapixels"). O contrato da F8-4 manda validar no Hub antes do envio.
- **Situação no código:** `content_media` não guarda largura nem altura; `validatePublicationContent` checa tipo, quantidade e bytes, não dimensões. Uma imagem de 36 MP aprovada pelo cliente seria aceita no agendamento e falharia só no despachante (FAILED depois da aprovação).
- **Correção proposta (C-P35):**
  1. Domínio: `imageDimensions(bytes)` lê largura e altura do cabeçalho de JPEG (marcadores SOF), PNG (IHDR) e WebP (VP8/VP8L/VP8X), sem dependência nova; nulo quando não for possível ler.
  2. Banco: colunas `widthPx` e `heightPx` (nulas) em `content_media`; o gatilho `content_media_guard` passa a aceitar somente a transição nulo → valor (o arquivo continua imutável).
  3. Upload grava as dimensões. Arquivos já existentes: na hora do agendamento o Hub lê o arquivo do armazenamento, calcula e grava uma única vez.
  4. `validatePublicationContent` recusa imagem acima de 30 MP (`MEDIA_TOO_MANY_PIXELS`) e **dimensões ilegíveis** (`MEDIA_DIMENSIONS_UNKNOWN`) — nunca envia sem saber.
  5. Tela: o detalhe do conteúdo avisa ao subir o arquivo (antes da aprovação do cliente) que a imagem excede o limite de publicação.
- **Testes:** domínio (JPEG com SOF0/SOF2 depois de EXIF grande, PNG, WebP nas três variantes, arquivo truncado → nulo, 30 MP exatos aceitos, 30 MP + 1 recusado); PostgreSQL (gatilho aceita nulo → valor e recusa valor → outro; agendamento de 36 MP recusado com 422; arquivo antigo sem dimensões calculado na hora); Browser Gate (aviso na tela para imagem grande sintética).
- **Aceite:** nenhuma imagem acima de 30 MP ou com dimensões desconhecidas chega ao provedor; arquivo registrado continua imutável; CI 5/5.
- **Classificação:** **bloqueia o piloto real** (antes de ligar o despachante, como já registrado).

### P38 — Erro na consulta de métricas consome o ponto da janela
- **Situação no código:** `PublicationMetricsCollector` grava `metricsCheckedAt = now` também quando a consulta falha (`ERROR`). O ponto (1 h, 3 h, …) é dado como coberto e a próxima tentativa só ocorre no ponto seguinte; uma falha no último ponto encerra a janela sem dado. 429 já não consome o ponto.
- **Correção proposta (C-P38):** em `ERROR` (e `NOT_FOUND` transitório), **não avançar** `metricsCheckedAt`; registrar `metricsRetryAt = now + 15 min` e `metricsErrorCount`. O ponto continua devido e é repetido até 3 vezes (15 min, 30 min, 60 min); esgotadas as tentativas, o ponto é consumido com `ERROR` e o motivo preservado. `isMetricsCheckDue` passa a respeitar `metricsRetryAt`. Nenhuma consulta fora dos pontos além dessas repetições.
- **Testes:** domínio (repetição respeita o intervalo; esgotamento consome o ponto); PostgreSQL com o simulador (erro → repete em 15 min → sucesso grava a coleta no mesmo ponto; 3 erros → `ERROR` preservado; último ponto com erro não encerra antes das repetições).
- **Aceite:** falha temporária do provedor não faz perder um ponto de coleta; nenhuma duplicação; CI 5/5.
- **Classificação:** **bloqueia ligar o coletor no piloto** (sem ela, uma falha passageira pode impedir a primeira coleta observada, que é o que fecharia a RS3).

### P37 — Resíduos legados e texto de compatibilidade
- **Situação no código:** `CompositorZafiraModal.tsx` (943 linhas) e `EditarAgendamentoModal.tsx` (311) sem importação; métodos `uploadMedia`, `createPost`, `schedulePost` e `cancelPost` de `services/social-publisher.ts` sem chamador e apontando para rotas que respondem 410. O aviso `PUBLISH_COMPATIBILITY_NOTE` no detalhe ainda diz que a compatibilidade com o BrightBean não foi verificada, o que contradiz as validações da F8-4. **Mantidos de propósito:** leitura legada, `linkAccount`/`unlinkAccount` (vincular a conta Instagram ao cliente, usado no piloto) e as rotas 410.
- **Correção proposta (C-P37):** remover os dois modais e os quatro métodos sem chamador; trocar o aviso por um texto derivado das regras: "Para publicar no Instagram: JPG, PNG, WebP ou MP4; imagem até 20 MB e 30 MP; vídeo até 1 GB. MOV ainda não verificado." (texto final para a Direção, D-PF8-4), com o resultado das validações do conteúdo atual ao lado.
- **Testes:** typecheck e build do web sem os arquivos; teste de busca garantindo que nenhuma tela chama as rotas 410; teste do texto no domínio; Browser Gate confere o novo aviso.
- **Aceite:** nenhuma referência às escritas legadas; texto não contradiz as validações; CI 5/5.
- **Classificação:** **não bloqueia** o piloto; recomendada antes dele (o aviso antigo confunde o operador).

## 2. Achados novos da auditoria (controles do piloto)

| # | Achado | Risco no piloto | Correção proposta (C-CTL) |
|---|---|---|---|
| A1 | O despachante **não confere de novo o vínculo da conta com o cliente** na hora do envio (só no pedido); confere permissões e rede pelo `me()` do provedor | conta desvinculada depois do agendamento ainda seria publicada | antes de enviar, exigir `ClientIntegration` ativo (cliente + conta + rede do piloto); senão `FAILED` com `ACCOUNT_UNLINKED`, sem chamar o provedor |
| A2 | Não há **lista de organizações autorizadas** a publicar: com o despachante ligado, qualquer organização com conexão ativa do BrightBean enviaria | publicação fora do piloto | `PUBLICATION_PILOT_ORGANIZATION_IDS` (vazio = ninguém); pedido e despachante recusam fora da lista (fail closed) |
| A3 | Não há **restrição de formato** do piloto: o Hub aceita agendar carrossel e Reel, ainda não verificados com publicação real (RS1, RS5) | publicação permanente de formato não validado | `PUBLICATION_PILOT_FORMATS` (padrão `STORY,FEED_IMAGE`, D-F85-6); fora dela, 422 no pedido e `FAILED` no despachante |
| A4 | Desligar o despachante exige **mudar variável e reiniciar** o serviço | reação lenta num incidente | aceitar como procedimento (seção 5), com o tempo de reação medido no ensaio; ou chave de emergência no banco lida a cada ciclo (D-PF8-3) |
| A5 | A credencial do BrightBean da organização só entra pelo script `provision-brightbean-connection.ts` (simulação por padrão, `--apply` para gravar, chave só por variável de ambiente, nunca impressa) | — (adequado) | manter; o proprietário executa com comandos prontos fornecidos pelo agente |

## 3. Revisão de P33, P34 e RS1–RS7

| Item | Situação | Bloqueia o piloto? | Tratamento proposto |
|---|---|---|---|
| **P33** limpeza (15 rascunhos, 17 mídias, registro do Story do T30) e chave temporária | chave temporária vence em 20/10/2026, com permissões que não servem ao piloto (sem `upload_media`/`publish_directly`) | **Sim, em parte:** revogar a chave temporária e criar a **chave do piloto** (escopo mínimo, uma conta, validade curta) é pré-requisito; a limpeza dos rascunhos é **recomendada** (base limpa facilita provar "exatamente N publicações"), mas pode ficar como ressalva com inventário registrado antes do piloto | proprietário, com autorização própria |
| **P34** métricas do T30 (GET) | verificação de 2 h, 6 h e 20 h não registrada; o Story completa 24 h em **15/10/2026 00:25 UTC** | Não | opção A: uma leitura GET única, autorizada, antes ou logo após as 24 h (pode fechar a RS3 sem piloto); opção B: encerrar como limitação e deixar a RS3 para o piloto |
| **RS1** carrossel real | não testado | **Não**, com A3 (carrossel fora do piloto) | permanece ressalva; carrossel só depois de um T31 adaptado com autorização própria |
| **RS2** `failed`/retentativa reais | coberto por simulador | Não | ressalva; observar se ocorrer naturalmente |
| **RS3** coleta efetiva de métricas | nunca observada | Não (é **objetivo** do piloto) | fecha com a primeira coleta no piloto (exige P38); sem coleta, a Direção decide se o Portão fecha com ressalva |
| **RS4** Facebook | fora do piloto | Não | ressalva até decisão das redes |
| **RS5** MOV e limite de vídeo | MOV não publicável no Hub; Reel só com MP4 | Não, com A3 | Reel entra no piloto só com vídeo de teste MP4 e decisão específica |
| **RS6** corrida/timeout com duplicidade | mitigado (idempotência, leitura antes de agir, AMBIGUOUS) | Não | o piloto registra a contagem exata de posts antes e depois de cada passo como evidência |
| **RS7** limpeza | = P33 | ver P33 | — |

## 4. Pré-requisitos do piloto real (F8-5e)

**P1 — Ambiente de homologação controlado (D-F85-7).** Bloqueadores H1–H9 resolvidos, em especial: **H2 armazenamento** (o despachante lê o arquivo para enviá-lo ao provedor; sem armazenamento de produção não há envio), H5 (perfil de ambiente), H7 (infraestrutura e HTTPS), H8 (segredos próprios, incluindo `INTEGRATION_ENCRYPTION_KEY`) e H9 (backup e restauração ensaiados).
**P2 — Correções aceitas:** C-P35, C-P38 e C-CTL (A1, A2, A3), numa fatia de código própria com CI 5/5 e aceite. C-P37 recomendada.
**P3 — Credenciais (proprietário):** chave temporária revogada; chave do piloto criada com escopo mínimo (`create_posts`, `upload_media`, `publish_directly`, `view_analytics`), uma única conta Instagram de testes na allowlist e validade curta; conexão gravada pelo script de provisionamento no banco de homologação.
**P4 — Dados:** organização do piloto **sintética** em homologação; cliente de teste; conta Instagram de testes vinculada a ele pela tela de vinculação; nenhum cliente real.
**P5 — Conteúdo de teste:** uma imagem de Story e uma imagem de Feed próprias, sem marca de terceiros, dentro dos limites (JPG/PNG, ≤ 20 MB, ≤ 30 MP).
**P6 — Autorização específica da Direção** para a execução, com data, janela, formatos e número máximo de publicações.

## 5. Plano do piloto

### 5.1 Isolamento
- Somente o ambiente de homologação; produção (Hub 1.0) e Hub 2.0 intocados.
- `PUBLICATION_PILOT_ORGANIZATION_IDS` com **apenas** a organização do piloto; `PUBLICATION_PILOT_FORMATS=STORY,FEED_IMAGE`.
- Chave do BrightBean com uma única conta na allowlist; nenhuma outra conta conectada à chave.
- Agendadores do Asana, do Calendar e o despachante do n8n **desligados**.

### 5.2 Controle de publicação
- **Teto do piloto: 2 publicações** (1 Story, depois 1 Feed de imagem), uma de cada vez. A segunda só depois da evidência completa da primeira.
- Agendamento sempre para **+15 a +30 min** (acima do mínimo de 5 min), dentro de uma janela acompanhada pelo operador.
- `PUBLICATION_DISPATCH_ENABLED=true` e `PUBLICATION_METRICS_ENABLED=true` **somente durante a janela** do piloto e da coleta; desligados ao final.
- Nenhum reagendamento ou cancelamento no meio do caminho, salvo para abortar.

### 5.3 Roteiro (por publicação)
1. Inventário inicial no provedor (GET): posts da conta por estado. Registrar.
2. No Hub: criar o conteúdo, enviar o arquivo, gerar o link e aprovar como cliente de teste (N1).
3. Agendar pela tela (conta vinculada, +15–30 min). Conferir "Registrado no Hub".
4. Ligar o despachante. Acompanhar: `DRAFTED` → `SCHEDULED` ("Enviado ao provedor") → `PUBLISHING` → `PUBLISHED` com permalink.
5. Conferir no Instagram (proprietário): **exatamente uma** publicação nova.
6. Inventário final (GET): +1 publicado, 0 agendados e 0 com falha.
7. Coletor: aguardar os pontos de 1 h, 3 h e 6 h (Story: até 26 h). Registrar `capturedAt` e `fetchedAt` de cada consulta.
8. Conferir "Publicados" em Entregas (envio ativo no ambiente) e a trilha no histórico do conteúdo.

### 5.4 Evidências obrigatórias
- Linha do tempo com horários (UTC e fuso da organização) de cada estado do Hub e do provedor.
- Permalink, `platformPostId` e `externalPostId`, no repositório **interno** apenas.
- Inventários antes e depois (contagem por estado), provando a ausência de duplicidade.
- Capturas da tela (painel de publicação, desempenho, contador) e do Instagram (pelo proprietário).
- Linhas de `content_publication_metrics` (coletas) e consultas registradas.
- Logs do despachante e do coletor sem segredo.
- Trilha do conteúdo: arquivo → envio → aprovação → agendamento → publicação → coleta.

### 5.5 Critérios de interrupção (abortar imediatamente)
Estado `AMBIGUOUS` que não se resolve em 2 ciclos; mais de uma publicação na conta; publicação em conta ou formato fora do piloto; erro de autenticação ou permissão inesperado; qualquer dado sensível em log; comportamento diferente do contrato.

### 5.6 Rollback
- **Antes de `PUBLISHING`:** cancelar pela tela (pedido de cancelamento confirmado pelo provedor) e desligar o despachante.
- **Desligar:** `PUBLICATION_DISPATCH_ENABLED=false` e `PUBLICATION_METRICS_ENABLED=false` e reiniciar o serviço da API. Os pedidos ficam na caixa de saída, sem envio. O tempo de reação é medido no ensaio.
- **Depois de publicado:** a API do provedor não apaga publicações. A remoção é **manual pelo proprietário** no Instagram. O Story expira em 24 h. O registro no Hub permanece como histórico (não é apagado).
- **Credencial:** revogar a chave do piloto ao final, ou imediatamente em incidente.
- **Banco:** nenhuma migração no piloto. Restauração só pelo procedimento de H9, se houver corrupção, o que não é esperado.

## 6. Critério de fechamento do Portão F8
1. Story e Feed de imagem percorrem a trilha completa com evidências, **sem duplicidade**.
2. Estados do Hub batem com os do provedor; "Registrado no Hub" e "Enviado" exibidos corretamente.
3. Ao menos uma coleta de métricas observada (fecha a RS3), **ou** decisão da Direção de fechar com essa ressalva.
4. "Publicados" conta as publicações confirmadas no ambiente do piloto.
5. Ressalvas restantes registradas e aceitas pela Direção (RS1, RS2, RS4, RS5, RS6; P33 se não concluída).
6. **Só então** a Direção decide o encerramento da Fase 8 por DEC.

## 7. Sequência e decisões propostas

| Passo | Conteúdo | Autorização |
|---|---|---|
| F8-5p | Correções pré-piloto: C-P35, C-P38, C-CTL (A1–A3) e C-P37, com CI 5/5 | DEC de implementação |
| H | Primeira homologação sintética (H1–H9) | DECs da homologação |
| P33/P34 | Chave do piloto e revogação da temporária; limpeza ou inventário; leitura GET do T30 (opcional) | autorização própria |
| F8-5e | Piloto real (seção 5) | autorização específica |
| Fechamento | Portão F8 e decisão sobre a Fase 8 | DEC |

| # | Decisão | Recomendação |
|---|---|---|
| D-PF8-1 | Escopo da fatia F8-5p | C-P35 + C-P38 + C-CTL obrigatórios; C-P37 junto (baixo custo) |
| D-PF8-2 | Dimensões ilegíveis | recusar no agendamento (fail closed) |
| D-PF8-3 | Desligamento de emergência | procedimento de variável + reinício (sem código novo) agora; chave no banco só se o tempo medido for inaceitável |
| D-PF8-4 | Texto do aviso de compatibilidade | o derivado das regras (seção 1, P37) |
| D-PF8-5 | Teto e ordem do piloto | 2 publicações: Story, depois Feed de imagem |
| D-PF8-6 | P34 | opção A (uma leitura GET única) se ainda houver valor; senão opção B |
| D-PF8-7 | Limpeza P33 antes do piloto | revogar e criar chaves: obrigatório; limpar rascunhos: recomendado, com inventário como alternativa |
