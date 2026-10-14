# F8-0 — Matriz de capacidades do BrightBean (2026-10-12)

> **Status: ENTREGA DA F8-0 para revisão da Direção (DEC-F8-002).** Levantamento **somente documental e de código**: adaptador existente, testes, contratos e registros históricos. **Nenhum serviço real foi acessado e nenhuma credencial foi usada.** Não é homologação.

## 1. Método e critérios

**Fontes e como são tratadas**

| Marca | Fonte | O que prova |
|---|---|---|
| **[A]** | Adaptador do Hub (`brightbean.client.ts`, `brightbean.provider.ts`, `social-publisher.*`) e seus testes | **Apenas o que o Hub envia e como trata respostas.** Os testes usam `fetch` injetado: **não provam comportamento do servidor**. |
| **[H]** | Registro histórico de execuções reais (`docs/historico/REGISTRO_OFICIAL_DRIVE_ate_2026-10-10.md` (repositório interno)` (repositório interno), logs de 24–25/09/2026, BrightBean em produção no commit `33d6001`, fork `4e5bef92`) | Resultado **observado e registrado** de execuções reais anteriores. Documento histórico: **não foi reverificado** e a versão da instância hoje é desconhecida. |
| **[—]** | nenhuma | nada |

**Classificação**
- **Confirmada:** comportamento do servidor observado em execução real registrada [H].
- **Parcialmente confirmada:** parte do comportamento observada ou documentada; faltam semântica, limites ou casos relevantes; ou só o adaptador implementa [A] com indício histórico indireto.
- **Não verificada:** apenas o adaptador envia/espera, ou nenhuma evidência, ou evidências conflitantes. **Não se presume suporte do servidor.**

## 2. Matriz

### 2.1 Formatos e redes

| # | Capacidade | Classe | Evidência | Observação para a F8 |
|---|---|---|---|---|
| 1 | Instagram **Story imagem** | **Confirmada** | [H] rascunho 201 com `post_type=story`; publicação real em 24/09 | Exatamente 1 mídia; mais de 1 → 422 [H] |
| 2 | Instagram **Story vídeo** | **Confirmada** | [H] rascunho e publicação real | idem |
| 3 | Instagram **Reel** (vídeo) | **Confirmada** | [H] rascunho e publicação real; Reel + imagem → 422 | exatamente 1 vídeo |
| 4 | Facebook **Reel** (vídeo) | **Confirmada** | [H] rascunho e publicação real; Facebook Story → 422 | Story no Facebook **não** existe |
| 5 | Instagram **Feed imagem** | **Confirmada** | [H] publicação real | |
| 6 | Instagram **Carrossel** | **Parcialmente confirmada** | [A] valida ≥ 2 mídias, só Instagram/Threads; comentário do código afirma que o servidor converte múltiplas mídias em carrossel; **sem publicação real registrada** | tratar como não homologado até teste real |
| 7 | **Vídeo no Feed** do Instagram | **Parcialmente confirmada** | [A] o Hub **rejeita** (`FEED` + 1 vídeo seria publicado como Reel pelo servidor) | **não existe "vídeo de feed" no IG**: formato de vídeo vira Reel |
| 8 | Facebook Feed (foto/vídeo/link) | **Não verificada** | [A] só valida `FEED` sem regras; nenhuma publicação real | |
| 9 | LinkedIn, TikTok, YouTube, X/Twitter | **Não verificada** | [A] apenas nomes mapeados | fora do piloto |
| 10 | Limites por conta (legenda, título, 1º comentário) | **Parcialmente confirmada** | [A] `/accounts/` devolve `char_limit`, `needs_title`, `supports_first_comment`, `escaped_chars`; valores reais não registrados | usar o valor do servidor; nunca fixar no Hub |

### 2.2 Upload e limites

| # | Capacidade | Classe | Evidência | Observação |
|---|---|---|---|---|
| 11 | Upload multipart (`POST /media/`) com `Idempotency-Key` | **Confirmada** | [H] mídias reais usadas nas publicações; relatório 2C2H cita idempotência de upload; [A] retry preserva a chave (correção registrada) | |
| 12 | Tipos aceitos (**JPG, PNG, WebP, MP4, MOV**) | **Não verificada** | [H] não registra os arquivos usados; [A] o Hub só valida prefixo `image/`/`video/` | **risco:** as redes costumam restringir tipos (ex.: imagem JPEG, vídeo MP4/MOV com codecs e proporções); WebP/PNG podem exigir conversão — **não confirmado neste repositório** |
| 13 | Tamanho máximo e duração do servidor | **Não verificada** | [A] só existe o teto do Hub (100 MB no multipart) | D4 está sujeito a esses limites |
| 14 | `GET /media/{id}` (tipo/URL) | **Parcialmente confirmada** | [A] usado nas validações de formato; [H] sem registro específico | |
| 15 | Mídia vinculada a **uma** conta/workspace; reutilização entre posts | **Não verificada** | [—] | afeta reaproveitar um upload em várias contas |

### 2.3 Rascunho e agendamento

| # | Capacidade | Classe | Evidência | Observação |
|---|---|---|---|---|
| 16 | Criar **rascunho** (`action=draft`) | **Confirmada** | [H] 201 em todos os formatos testados | |
| 17 | **Agendar** (`action=schedule` + `scheduled_at`; `POST /posts/{id}/schedule`) | **Confirmada** | [H] Story agendado para +10 s e publicado | |
| 18 | **Publicação imediata** | **Não verificada** | [A] o Hub **proíbe** (draft ou schedule apenas); servidor não testado | usar agendamento com antecedência mínima |
| 19 | Antecedência mínima, janela e **fuso** de `scheduled_at` | **Não verificada** | [H] só um caso (+10 s); formato com offset não registrado | enviar sempre UTC (ISO) e confirmar |
| 20 | **Reagendar** (`PATCH /posts/{id}` com `scheduled_at`) | **Parcialmente confirmada** | [A] implementado e testado com `fetch` injetado; [H] "lifecycle completo" sem detalhe | |
| 21 | Workflow **próprio de aprovação** do BrightBean (`pending_review`, `pending_client`, `approved`, `changes_requested`, `rejected`) | **Parcialmente confirmada** | [A] o adaptador reconhece esses status; [H] chaves com escopo `publish_directly` | **sobreposição com a aprovação do Hub**: a F8 deve usar sempre draft/schedule direto e **não** o workflow do BrightBean — confirmar que `publish_directly` o dispensa |

### 2.4 Idempotência

| # | Capacidade | Classe | Evidência | Observação |
|---|---|---|---|---|
| 22 | `Idempotency-Key` em **upload** e **criação** | **Parcialmente confirmada** | [H] relatório 2C2H: "idempotência de upload/create"; [A] header enviado e exigido pelo Hub | **semântica não documentada:** validade da chave, resposta em repetição, conflito com corpo diferente, escopo (por chave de API/workspace) |
| 23 | Idempotência em **schedule, reagendar e cancelar** | **Não verificada** | [A] o adaptador **não envia** chave nessas chamadas | operações devem ser **idempotentes pelo estado** (consultar antes) |
| 24 | Garantia de **não duplicar** com timeout após criação | **Não verificada** | [H] só "0 duplicidades" nas baterias sequenciais (4/4 publicadas) | sem teste de falha de rede/concorrência |
| 25 | Retentativa **automática do servidor** (`retry_count`, `next_retry_at`) | **Parcialmente confirmada** | [H] os campos existem e foram monitorados; [A] **o adaptador não os expõe** | publicação tardia por retry do servidor é possível: expor e tratar "ambiguidade" |

### 2.5 Consulta e reconciliação

| # | Capacidade | Classe | Evidência | Observação |
|---|---|---|---|---|
| 26 | **Consultar post** (`GET /posts/{id}`) com status e permalink | **Confirmada** | [H] "confirmado PUBLISHED no Hub e BrightBean", remote id e permalink obtidos | base da reconciliação por `externalPostId` guardado no Hub |
| 27 | **Listar posts** (`GET /posts/` com filtros e paginação) | **Não verificada** | **evidências conflitantes:** [H] revisão 2C2.0V afirmou que **não existia** listagem; [A] o adaptador implementa listagem e paginação | tratar como **indisponível** até confirmar na instância atual |
| 28 | Buscar post por **referência externa/chave** | **Não verificada** | [—] sem suporte no cliente | reconciliar apenas por `externalPostId` salvo |
| 29 | **Webhooks/eventos** do BrightBean | **Não verificada** | [—] nenhum no adaptador | usar leitura periódica (polling) com frescor |

### 2.6 Cancelamento

| # | Capacidade | Classe | Evidência | Observação |
|---|---|---|---|---|
| 30 | Cancelar **agendado** (`POST /posts/{id}/cancel`) | **Não verificada** | [A] implementado (não sintetiza status "cancelado") | confirmar efeito e estado final |
| 31 | **Remover post já publicado** via API | **Confirmada como indisponível** | [H] 2C2H: `DELETE` retornou HTTP 400 (Instagram, "Unsupported delete request"); remoção foi manual | conteúdo publicado **só sai manualmente**; a UI não deve prometer "excluir publicação" |

### 2.7 Status, falhas, permalink e métricas

| # | Capacidade | Classe | Evidência | Observação |
|---|---|---|---|---|
| 32 | Vocabulário de status | **Parcialmente confirmada** | [H] observados: `draft`, `scheduled`, `publishing`, `published`; [A] também trata `failed`, `partially_published` e os de aprovação; status desconhecido **falha fechado** | `failed`/`partially_published` ainda não vistos em real |
| 33 | **Permalink** da publicação | **Confirmada** | [H] permalink e remote id obtidos (2C2H) | pode demorar a aparecer: tratar ausência como "pendente" |
| 34 | **Falha**: motivo (`publish_error`) | **Parcialmente confirmada** | [A] campo mapeado; [H] sem caso de falha real registrado | mensagens seguras; não exibir texto bruto |
| 35 | Publicação **parcial** em múltiplas contas | **Parcialmente confirmada** | [A] status `partially_published`; analytics multi-conta é recusado pelo adaptador como "irrepresentável" | F8 publica **uma conta por agendamento** |
| 36 | **Métricas de post** | **Confirmada** | [H] analytics HTTP 200 após publicação real | disponibilidade e defasagem via `analytics_available`, `next_sync_eta`; métricas variam por rede — **ausente ≠ zero** |
| 37 | **Métricas de conta** | **Parcialmente confirmada** | [A] implementado; [H] sem registro | |
| 38 | **Escopo da chave de API e lista de contas permitidas** | **Parcialmente confirmada** | [H] escopos `create_posts`, `publish_directly`, `upload_media`, `view_analytics` e allowlist de contas planejados e usados na homologação | confirmar na instância atual |

## 3. Lacunas e impacto por fatia

| Fatia | Depende do BrightBean? | Lacunas relevantes | Efeito |
|---|---|---|---|
| **F8-1** (domínio, arquivos, upload) | **Não** | #7, #12, #13: formatos e tipos publicáveis ainda não confirmados | pode começar; **o domínio deve usar os formatos que o BrightBean realmente representa** (§4) e marcar a publicabilidade de PNG/WebP/MOV como "a verificar", sem rejeitar o arquivo recebido |
| **F8-2** (aprovação por link) | Não | nenhuma | independente |
| **F8-3** (Entregas por estágio) | Não | nenhuma | independente |
| **F8-4** (agendamento/publicação) | **Sim** | #18–#25, #27–#31: idempotência real, cancelamento, reagendamento, listagem, retry do servidor | **bloqueada** até a verificação ativa (§5); simulador só com comportamentos confirmados |
| **F8-5** (status, permalink, métricas) | Sim | #27, #29, #32, #34, #36–#37 | depende da F8-4; leitura por `externalPostId` e polling |

## 4. Implicações de desenho já seguras

1. **Formatos do domínio (F8-1):** `FEED_IMAGE`, `CAROUSEL` (≥ 2 mídias), `REEL` (1 vídeo), `STORY` (1 imagem ou 1 vídeo). O "vídeo" da especificação revisão 2 **mapeia para `REEL`** no Instagram; não existe vídeo de feed.
2. **Uma conta por agendamento.** Sem publicação multi-conta.
3. **Nunca usar o workflow de aprovação do BrightBean**; criar sempre `draft` e `schedule`.
4. **Reconciliação por `externalPostId` guardado**; não depender de listagem ou busca por chave.
5. **Operações idempotentes pelo estado:** consultar antes de agendar, reagendar ou cancelar; só reutilizar `Idempotency-Key` em upload e criação.
6. **Conteúdo publicado não é removível pelo Hub.** Linguagem da interface: "publicado", sem "excluir publicação".
7. **Métricas ausentes aparecem como indisponíveis.**
8. **Limites das contas vêm do servidor** (`char_limit` etc.) e nunca são fixados no Hub.

## 5. F8-0b — verificação ativa (proposta; NÃO executada)

Exige instância de teste do BrightBean, credencial de escopo mínimo e **autorização expressa**. Sem dados de cliente. Roteiro objetivo:
1. Versão/commit da instância e escopos da chave; conta de teste.
2. Upload de JPG, PNG, WebP, MP4, MOV (e acima de 100 MB) — aceitos/recusados e mensagens.
3. Rascunho de Feed imagem, Carrossel (2 e 10), Reel, Story imagem/vídeo; limites de legenda.
4. `schedule` com antecedência 10 s, 1 min, 5 min; offset de fuso; horário passado.
5. Repetir `POST /posts/` com a mesma `Idempotency-Key` (mesmo corpo e corpo diferente) e após timeout simulado.
6. Reagendar e cancelar um agendado; cancelar rascunho; cancelar publicado.
7. `GET /posts/{id}`; `GET /posts/` com paginação (existe?); busca por referência.
8. Forçar falha (mídia inválida/conta desconectada): status `failed`, `publish_error`, `retry_count`.
9. Permalink e métricas após a publicação; defasagem.
10. Efeito do escopo `publish_directly` sobre o workflow de aprovação do BrightBean.
Resultado: esta matriz atualizada (classes) e o contrato do simulador da F8-4.

## 6. Recomendação sobre a liberação da F8-1

**Liberar a F8-1 (e, em seguida, F8-2 e F8-3) — não depende do BrightBean e D1, D2, D4, D5 estão aprovadas.** Condições:
- o domínio usa os formatos de §4.1 e guarda a **publicabilidade por tipo de arquivo como "a verificar"** (PNG, WebP, MOV aceitos como arquivo recebido; sem prometer publicação);
- P28 respeitada (sem cascata destrutiva);
- o provedor S3 e a conversão/validação de mídia ficam para antes da homologação e para a F8-4.
**Não liberar a F8-4** antes da F8-0b: 13 das 38 capacidades são "não verificadas" e a idempotência real é "parcial".

**Contagem (38):** confirmadas 12 (incluindo a indisponibilidade comprovada da remoção); parcialmente confirmadas 13; não verificadas 13.

## 7. Atualização pela F8-0b (2026-10-13 — R0 e R1, DEC-F8-010 a DEC-F8-013)

Evidência **[V]** = verificação real na instância (conta própria de testes), sem publicação. Detalhes em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md` (§8 e §9).

| # | Capacidade | Nova classe | Evidência |
|---|---|---|---|
| 6 | Carrossel | **Parcialmente confirmada** | [V] rascunho com 2, 10 e 11 imagens aceito; o servidor não valida o máximo na criação; publicação não testada |
| 7 | Vídeo no Feed | **Parcialmente confirmada** | [V] rascunho de vídeo sem `post_type` aceito; efeito na publicação não testado |
| 10 | Limites por conta | **Confirmada (leitura)** | [V] `char_limit` 2200, `needs_title` false, `supports_first_comment` true (`instagram_login`); **não aplicado na criação do rascunho** (2201 aceito) |
| 12 | Tipos aceitos | **Confirmada na biblioteca** | [V] JPG, PNG, WebP e MP4 aceitos; tipo detectado pelo conteúdo; arquivo inválido → 422; MOV QuickTime verdadeiro e aceitação pela rede na publicação **não testados** |
| 13 | Tamanho máximo | **Confirmada para imagem** | [V] imagem > 20 MB → 422; > 30 megapixels → 422; limite de vídeo (1 GB pelo código) não testado |
| 15 | Mídia por workspace e reutilização | **Confirmada** | [V] a mesma mídia usada em dois rascunhos |
| 16 | Criar rascunho | **Confirmada** | [V] Feed, carrossel, Reel, Story imagem e vídeo; story com 2 mídias e reel com imagem → 422 |
| 19 | Fuso de horários | **Parcialmente confirmada** | [V] horário com `-03:00` convertido para UTC no mesmo instante (campo de rascunho); antecedência real só com agendamento |
| 22 | Idempotência em upload e criação | **Confirmada** | [V] mesma chave + mesmo corpo → mesmo id; corpo diferente → 422; no upload, o "corpo" é nome + tamanho + metadados |
| 24 | Não duplicar ao repetir | **Parcialmente confirmada** | [V] repetição sequencial sem duplicar; corrida e timeout reais não testados |
| 27 | Listar posts | **Confirmada** | [V] filtros por conta e status, `limit`/`offset`, `total` |
| 28 | Busca por referência externa | **Confirmada como indisponível** | código e OpenAPI publicada |
| 29 | Webhooks | **Confirmada como indisponível** | código e OpenAPI publicada |
| 37 | Métricas de conta | **Confirmada** | [V] HTTP 200, `analytics_available` true |
| 38 | Escopo da chave e allowlist | **Confirmada** | [V] permissões = chave ∩ emissor; conta fora da allowlist → 404; mudança da chave leva até 30 s para valer em todos os processos |

Continuam **não verificadas**: #8 (Facebook Feed), #18 (horário passado dispara em ~15 s, pelo código), #23 e #30 (agendar/cancelar), #25, #32–#36 (publicação, falha, permalink, métricas de post). #9 fora do piloto.

## 8. Atualização pela F8-0b R1+ (2026-10-13, DEC-F8-016)

| # | Capacidade | Nova classe | Evidência |
|---|---|---|---|
| 17 | Agendar rascunho | **Confirmada** | [V] `POST /posts/{id}/schedule` → 200, `scheduled` (exige `create_posts` + `publish_directly`) |
| 19 | Fuso no agendamento | **Confirmada** | [V] horário em `-03:00` armazenado em UTC no mesmo instante; antecedência mínima não validada pelo servidor (pelo código) |
| 20 | Reagendar | **Confirmada** | [V] `PATCH` com `scheduled_at` → 200, post e filho atualizados |
| 23 | Idempotência de agendar/reagendar/cancelar | **Confirmada (pelo estado)** | [V] cancelar repetido → 409; sem `Idempotency-Key` nessas rotas |
| 30 | Cancelar agendado | **Confirmada** | [V] → `draft`, horário removido; nenhum agendado restante após 3 min |

## 9. Atualização pela F8-0b R2/T30 (2026-10-13, DEC-F8-018)

| # | Capacidade | Nova classe | Evidência |
|---|---|---|---|
| 1 | Instagram Story imagem | **Confirmada (instância atual)** | [V] publicada na conta de testes |
| 26 | Consultar post com status e permalink | **Confirmada** | [V] `GET /posts/{id}` com `status`, `published_at`, `platform_post_id`, `permalink_url`, `publish_error` |
| 32 | Vocabulário de status | **Confirmada (fluxo feliz)** | [V] `draft` → `scheduled` → `publishing` → `published`; `failed` ainda não observado |
| 33 | Permalink | **Confirmada** | [V] presente logo após `published` |
| 36 | Métricas de post | **Parcialmente confirmada** | [V] HTTP 200 e `analytics_available` true; **antes da coleta os indicadores vêm 0 com `captured_at` nulo** — tratar como sem dado |
| 18/19 | Antecedência do agendamento | **Confirmada (caso de 3 min)** | [V] publicado ~26 s após o horário |

## 10. Atualização pelo aceite do T30 (2026-10-13, DEC-F8-019)

| # | Capacidade | Nova classe | Evidência |
|---|---|---|---|
| 36 | Métricas de post | **Parcialmente confirmada** | [V] rota responde 200 e expõe 7 indicadores, mas **nenhuma coleta em 17 min** após a publicação: `captured_at` nulo, `series` vazias e valores **padrão 0**; `next_sync_eta` é estimativa móvel. Coleta efetiva não observada |
| 37 | Métricas de conta | **Confirmada** | [V] `captured_at` registrado; próxima coleta em ~24 h |
| 38 | Escopo da chave | **Confirmada** | [V] retirada de `publish_directly` refletida em `/me/` |

## 11. Encerramento da F8-0b com ressalvas (2026-10-13, DEC-F8-022)

Classificação final das 13 capacidades que estavam "não verificadas": **#12, #13, #15, #19, #23, #24, #27, #30** verificadas (algumas parcialmente, com regra definida no contrato); **#18** confirmada pelo código e pelo T30 (horário passado dispara no ciclo seguinte; o Hub bloqueia); **#28, #29** confirmadas como indisponíveis; **#8** adiada (piloto do Facebook); **#9** fora do piloto. Ressalvas RS1–RS7 em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md`, §16–§17. Métricas de post (#36) seguem **parcialmente confirmadas**: sem coleta observada até ~28 min.
