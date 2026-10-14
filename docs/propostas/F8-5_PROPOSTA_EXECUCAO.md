# F8-5 — Proposta técnica de execução (status, permalink, métricas orgânicas e Portão F8)

> Situação: **proposta, somente análise** (DEC-F8-028). Nada aqui está autorizado; implementação só com nova DEC.
> Base: Mapa Mestre (F8, construção, aceite e Portão F8), `F8_ESPECIFICACAO_CONTEUDOS.md` (linha F8-5), matriz `F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md` §3, `F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md` §14–§16, contrato `F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md` e o código da F8-4 (baseline `ad44325`).

## 1. Escopo oficial

| Fonte | O que pede para a F8-5 |
|---|---|
| Especificação F8 (tabela de fatias) | sincronização de status, permalink e falhas; **métricas orgânicas (leitura)**; conteúdo piloto; **Portão F8** |
| Mapa, F8 — construção | sincronização de agendamento, publicação, falhas e permalink; ligação com Entregas (etapa "postada" preenchida pelo Hub) |
| Mapa, Portão F8 | conteúdo piloto percorre criação, revisão, aprovação, agendamento e publicação **com trilha completa** |
| Contrato F8-3 | "Publicados" deixa de ser indisponível quando houver **confirmação confiável** de publicação |
| Regra geral do Mapa | ausência de dado nunca vira zero; histórico e snapshots não são reescritos |

**Fora do escopo:** métricas da conta e histórico de perfis (F13), Facebook e outras redes (RS4), Ads, BI e relatórios (F13), carrossel publicado de verdade como requisito (RS1, ver §6).

## 2. O que já existe (F8-4, não refazer)

- O despachante da F8-4a já faz a **reconciliação por leitura** (`reconcileDue`): estado, `publishedAt`, `platformPostId`, permalink e falha. Ele roda só com `PUBLICATION_DISPATCH_ENABLED=true` (desligado por padrão).
- `PUBLISHED` só vale com `published_at` **e** `platform_post_id` (`mapRemoteState`); desconhecido vira `AMBIGUOUS`.
- O painel da F8-4b já mostra o estado, o permalink (só https), a falha e a diferença entre registrado no Hub e enviado ao provedor.
- O cliente legado tem `getPostAnalytics` (rota de leitura do social-publisher), mas ele **não está no `PublicationGateway`** e não respeita a regra de ausência.

Conclusão: a sincronização de status e permalink está **pronta no código, mas não exercitada com o provedor real** (o despachante nunca foi ligado). A F8-5 acrescenta as métricas, a ligação com Entregas e o piloto do Portão F8.

## 3. Limitações do BrightBean que moldam o desenho

| # | Limitação observada (F8-0b) | Consequência obrigatória |
|---|---|---|
| L1 | Antes da primeira coleta, `GET /analytics/posts/{id}` devolve **7 indicadores com valor 0**, `captured_at` nulo e séries vazias | **`captured_at` nulo = sem dado** ("aguardando coleta"), mesmo com `analytics_available` true e valores 0. Nunca gravar nem exibir esses zeros |
| L2 | `next_sync_eta` é móvel (sempre agora + ~5 min sem coleta) | nunca exibir nem usar como horário prometido |
| L3 | Coleta de posts com menos de 24 h é **horária**; a da conta é diária | ler no máximo de hora em hora; leituras mais frequentes não trazem dado novo |
| L4 | **Coleta efetiva nunca foi observada** (RS3; P34 sem leitura posterior registrada) | o desenho segue o contrato e o simulador; a confirmação real fica para o piloto (§5, F8-5e) |
| L5 | Story expira em 24 h no Instagram; não se sabe se a coleta segue depois disso | Story tem janela própria e estado "não coletável após expirar" se o provedor deixar de responder |
| L6 | Sem webhooks e sem busca por referência externa | tudo por polling a partir do `externalPostId` guardado |
| L7 | `engagement` vem como percentual (`kind` = percent); os demais são contagens | guardar o tipo; não somar percentuais |

## 4. Desenho proposto

### 4.1 Dados (append-only)
Tabela `content_publication_metrics`, uma linha por **coleta do provedor**:
- `organizationId`, `publicationId` (FK), `capturedAt` (do provedor, **obrigatório**), `fetchedAt` (do Hub);
- `reach`, `views`, `likes`, `comments`, `saves`, `shares` (inteiro ou nulo) e `engagementPct` (decimal ou nulo);
- `metricKinds` (json: tipo de cada indicador) e `providerAvailable` (bool).

Regras no banco: único `(publicationId, capturedAt)` (a mesma coleta não duplica); gatilho que **bloqueia UPDATE e DELETE** (histórico não é reescrito; DELETE só com a organização removida, mesma regra da F8-4a). Leitura sem `captured_at` **não grava nada**: só atualiza `metricsCheckedAt` na publicação.

### 4.2 Gateway e simulador
- `PublicationGateway.getPostMetrics(externalPostId)` normaliza a resposta: `{ available, capturedAt | null, values, kinds, unavailableReason }`.
- Simulador com modos: aguardando coleta (zeros + `captured_at` nulo), coletado, coletas sucessivas, indisponível (`analytics_available` false), erro temporário, post removido (404).

### 4.3 Coletor (dentro do agendador existente, sem serviço novo)
- Flag própria **`PUBLICATION_METRICS_ENABLED`**, desligada por padrão; também exige o despachante ligado (sem publicação não há o que medir).
- Agenda por publicação `PUBLISHED`: 1 h, 3 h, 6 h, 24 h, 72 h e 7 dias após `publishedAt`. Depois disso, para. Story: até 24 h e mais uma leitura em 26 h.
- Lote limitado por rodada, lease já existente, backoff em 429; nunca dispara outra escrita no provedor.

### 4.4 API (só leitura, `content.view` + carteira)
- `GET /content/publications/:id/metrics` devolve `{ status, latest, history[] }`, com `status`:
  - `NOT_PUBLISHED`;
  - `AWAITING_COLLECTION` (publicado, sem coleta);
  - `COLLECTED` (com `capturedAt`);
  - `UNAVAILABLE` (provedor sem análise);
  - `STOPPED` (fim da janela, com a última coleta).
- A visão da publicação (F8-4b) ganha um resumo: `metricsStatus` e `lastCapturedAt`.

### 4.5 Ligação com Entregas (contador da F8-3)
- "Publicados" passa a contar conteúdos com **publicação confirmada** (`PUBLISHED` com `publishedAt` e `platformPostId`), na mesma competência da F8-3. Continua cumulativo e conta uma peça por conteúdo.
- Enquanto a publicação não estiver ativa no ambiente (despachante desligado), segue **indisponível (null)**, nunca 0 (D-F85-2).
- A meta e as etapas manuais de Entregas continuam intocadas (DEC-F8-007 D2). Marcar "postada" automaticamente nas peças fica como [DECIDIR] (D-F85-5).

### 4.6 Tela
- **Painel de publicação:** bloco "Desempenho" por publicação publicada. Mostra "Aguardando coleta do Instagram" quando não há coleta e os valores com a data e hora da coleta no fuso da organização. Quando não há dado, mostra "Indisponível", nunca zero. Engajamento aparece em %. Sem gráfico nesta fatia.
- **Cartão "Publicados" em Entregas:** número real quando a publicação estiver ativa; "aguardando integração" caso contrário (comportamento atual).

## 5. Microetapas

| Etapa | Conteúdo | Testes | Pré-requisito |
|---|---|---|---|
| **F8-5a** | Domínio (normalização, regra de ausência, janela de coleta, Story), migração da tabela append-only, `getPostMetrics` no gateway e no simulador, coletor desligado por padrão | unidade (domínio e normalização com zeros + `captured_at` nulo); simulador (todas as variações); PostgreSQL: único por coleta, UPDATE/DELETE bloqueados, isolamento entre organizações, flag desligada não chama o provedor | DEC |
| **F8-5b** | API de métricas e resumo na visão; "Publicados" no contador da F8-3 com a regra D-F85-2 | API (permissão, carteira, Org B 404); PostgreSQL do contador (confirmado conta, `AMBIGUOUS`/`PUBLISHING` não contam, indisponível com envio desligado, sem dupla contagem) | F8-5a |
| **F8-5c** | Tela: bloco "Desempenho" e cartão "Publicados" | utilitários de apresentação (aguardando ≠ zero, percentual, fuso) | F8-5b |
| **F8-5d** | Browser Gate, cenário N: publicação e coletas **sintéticas** gravadas no banco de ensaio (como no cenário M); aguardando coleta sem zeros; coletado com data; Org B 404; membro só lê; 390 px | gate no CI (rodada única, meta 5/5) | F8-5c |
| **F8-5e** | **Piloto do Portão F8** (publicação real controlada): conta de testes, despachante ligado só nesse ambiente, um conteúdo por formato do piloto, trilha completa, leitura das métricas por GET até a primeira coleta | evidências: linha do tempo, permalink, ausência de duplicidade, primeira coleta (fecha RS3) | **autorização expressa**, P35, P37, decisão sobre RS1, ambiente controlado (ver bloqueios da homologação) |

F8-5a a F8-5d não publicam nada e não ligam o despachante. Só a F8-5e toca o provedor real.

## 6. Decisões necessárias

| # | Questão | Recomendação |
|---|---|---|
| D-F85-1 | Guardar histórico de coletas ou só a última | **Histórico append-only** (regra do Mapa, base para a F13); retenção definida na F13 |
| D-F85-2 | "Publicados" com despachante desligado | **null (indisponível)**, nunca 0; número real só com publicação ativa no ambiente |
| D-F85-3 | Janela e frequência de coleta | 1 h, 3 h, 6 h, 24 h, 72 h, 7 d (Story até 26 h), respeitando a coleta horária do provedor |
| D-F85-4 | Métricas da conta | **fora** (F13) |
| D-F85-5 | Etapa "postada" das peças de Entregas | **não automatizar** nesta fatia; só o contador (manter DEC-F8-007 D2) |
| D-F85-6 | Formatos do piloto do Portão F8 | Story e Feed de imagem; Reel se houver vídeo de teste; **carrossel só com o T31 adaptado (RS1)** |
| D-F85-7 | Onde roda o piloto (F8-5e) | na **homologação controlada**, com a conta de testes, depois da P35 e da limpeza da P33/P37 |

## 7. Critérios de aceite da F8-5

1. Nenhum zero exibido ou gravado sem `captured_at`; "aguardando coleta" distinto de "indisponível" e de valor medido.
2. Coletas são append-only: a mesma coleta não duplica e nenhuma é alterada ou apagada (comprovado em PostgreSQL).
3. Coletor e despachante desligados por padrão; com a flag desligada, nenhuma chamada ao provedor.
4. Métricas e contador respeitam a organização, a carteira e a permissão (Org B 404; membro só lê).
5. "Publicados" conta só publicação confirmada, uma por conteúdo, sem alterar meta nem etapas manuais; indisponível sem integração ativa.
6. Telas no DS, fuso da organização e 390 px sem rolagem horizontal.
7. CI oficial 5/5 (unidade, PostgreSQL, Docker, imagens, Browser Gate com o cenário N).
8. **Portão F8** (F8-5e, com autorização própria): conteúdo piloto com trilha completa (arquivo → envio → aprovação do cliente → agendamento → publicação → permalink → primeira coleta), sem duplicidade, com evidências registradas.

## 8. Riscos e ressalvas preservados

RS1 (carrossel real), RS2 (`failed` e retentativa reais), RS3 (coleta efetiva; fechada no F8-5e se a coleta ocorrer), RS4 (Facebook), RS5 (MOV e limite de vídeo), RS6 (corrida/timeout), RS7 (limpeza); P33 (limpeza e revogação da chave), P34 (métricas do T30, sem leitura posterior registrada), P35 (megapixels, **antes de ligar o despachante**), P37 (modais legados e texto de compatibilidade). Risco extra: se a coleta do provedor não acontecer no piloto, a F8-5 entrega a estrutura correta mostrando "aguardando coleta". A Direção decide se o Portão F8 fecha com ressalva.
