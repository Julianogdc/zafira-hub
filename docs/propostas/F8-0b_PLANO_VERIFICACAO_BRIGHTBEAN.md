# F8-0b — Preparação da verificação ativa do BrightBean (2026-10-13)

> **Status: PREPARAÇÃO (DEC-F8-009).** Nada foi criado, agendado, publicado, cancelado ou alterado. Nenhuma credencial foi usada, criada ou exibida. **Toda operação de escrita ou publicação depende de autorização expressa da Direção, teste a teste quando houver publicação.**
> Base: matriz oficial `docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md` (§2 e §5).

## 1. Diagnóstico da instância (somente leitura, sem credencial)

| Verificação | Resultado (2026-10-13) |
|---|---|
| Endereço | instância de produção da agência (endereço no repositório interno) |
| Aplicação web | responde (HTTP 302 para a tela de entrada) |
| API v1 sem credencial | `GET /api/v1/me/` → **401** `{"error": "unauthorized"}`: toda a API exige chave (sem superfície anônima) |
| Documentação OpenAPI | pública em `/api/v1/openapi.json` e `/api/v1/docs`; título "Brightbean Agent API", versão **1.0.0** |
| Código implantado | as 16 rotas publicadas são **idênticas** às do fork `Julianogdc/brightbean-studio`, branch `zafira-custom-v1`, commit **`4e5bef9`** (o mesmo registrado como implantado em 2026-09). O código-fonte desse commit foi lido para este plano |
| Contas sociais conectadas | **não verificadas nesta sessão**: exigem chave de API. A chave da homologação 2C2H foi **revogada** (2026-09) e criar uma nova é alteração de credencial, fora desta etapa. Histórico: Instagram e Facebook **reais da agência** conectados (última verificação registrada em 2026-09); a Direção informa que segue funcionando com conta conectada |

**Rotas v1 publicadas** (o que cada uma faz):

| Rota | Efeito | Risco |
|---|---|---|
| `GET /me/`, `GET /accounts/`, `GET /posts/`, `GET /posts/{id}`, `GET /media/`, `GET /media/{id}`, `GET /analytics/accounts/{id}`, `GET /analytics/posts/{id}` | leitura | **R0** |
| `POST /media/` | envia arquivo à biblioteca do workspace | **R1** (deixa resíduo: arquivo na biblioteca) |
| `POST /posts/` `action=draft`, `PATCH /posts/{id}` em rascunho | cria/edita rascunho | **R1** (rascunho não é apagável pela API; só pela interface) |
| `POST /posts/` `action=schedule`, `POST /posts/{id}/schedule`, `PATCH` de `scheduled_at` em agendado | entra na fila de publicação | **R1+** se horário distante e cancelado logo depois; **R2** se o horário chegar |
| `POST /posts/{id}/cancel` | agendado volta a rascunho | **R1+** |
| `/inbox/*`, `/mcp/` | fora do escopo da F8 | não usar |

Regras do servidor lidas no código (`4e5bef9`): limites por chave (escrita 120/min, leitura 300/min) e **por conta social 24 h (Instagram 25/dia)**; `schedule` exige o escopo `publish_directly`; chave com allowlist de contas; **posts publicados nunca são apagáveis pela API**; rascunhos só saem pela interface.

## 2. As 13 capacidades não verificadas

[C] = comportamento lido no código-fonte do servidor (`4e5bef9`) e confirmado na OpenAPI publicada; ainda **não observado em execução**.

| # | Capacidade | O que o código mostra [C] | O que falta provar | Teste | Risco |
|---|---|---|---|---|---|
| 8 | Facebook Feed | não analisado em profundidade; a publicação em rede depende do conector | aceitação real pela Meta | T32 | **R2** |
| 9 | LinkedIn, TikTok, YouTube, X | conectores existem no produto | **fora do piloto** — recomendação: **não testar** na F8-0b | — | — |
| 12 | Tipos JPG, PNG, WebP, MP4, MOV | biblioteca aceita `image/jpeg, png, webp, gif` e `video/mp4, quicktime, x-msvideo, webm` | aceitação pela biblioteca (R1) e **pela rede** na publicação (R2) | T10, T33 | R1 / R2 |
| 13 | Tamanho e duração | padrão do código: **imagem até 20 MB**, 30 megapixels; **vídeo até 1 GB** (a instância pode sobrescrever) | limites efetivos da instância | T11 | R1 |
| 15 | Mídia por conta ou workspace | a mídia pertence ao **workspace**, não à conta | reutilizar um upload em dois rascunhos | T15 | R1 |
| 18 | Publicação imediata | **não existe** ação imediata (`action` só `draft`/`schedule`) — porém **`scheduled_at` no passado não é recusado pela API e o publicador dispara em ~15 s** | confirmar o disparo (equivale a publicar) | T34 | **R2** |
| 19 | Antecedência, janela e fuso | `scheduled_at` em UTC; data sem fuso tratada como UTC; **sem validação de futuro na API** (só a interface valida) | leitura de offset (`-03:00`) sem publicar; antecedência real só publicando | T16, T30 | R1 / R2 |
| 23 | Idempotência de agendar/reagendar/cancelar | sem chave nessas rotas; **cancelar sem agendado → 409**; transições atômicas | repetição segura pelo estado | T21–T23 | R1+ |
| 24 | Não duplicar em timeout | chave por **chave de API**: mesma chave + mesmo corpo → **devolve a resposta original**; corpo diferente → **422**; pedido em andamento → **409**; limpeza em 24 h | repetição real em rascunho | T14 | R1 |
| 27 | Listar posts | **existe**: filtros `social_account_id`, `status`, `limit` (≤ 100), `offset` | resposta real e paginação | T03 | R0 |
| 28 | Busca por referência externa | **não existe** filtro por referência | — (classificar como indisponível) | — | — |
| 29 | Webhooks | **não existem** na API v1 | — (classificar como indisponível; usar leitura periódica) | — | — |
| 30 | Cancelar agendado | agendado **volta a rascunho**, de forma atômica | efeito real e estado final | T20–T21 | R1+ |

**Achados para a F8-4 (já, pelo código):**
1. **Imagens acima de 20 MB** são aceitas pelo Hub (limite D4: 100 MB) e **recusadas pelo BrightBean** por padrão: a F8-4 precisa avisar/validar antes do envio.
2. **Horário no passado publica em ~15 s**: o Hub deve recusar `scheduled_at` passado ou muito próximo antes de chamar o BrightBean.
3. **Teto de 25 publicações/dia por conta do Instagram** (contando agendados): a fila da F8-4 precisa respeitá-lo.
4. **Sem webhooks nem busca por referência**: reconciliação por `externalPostId` e leitura periódica (já previsto no §4 da matriz).

## 3. Matriz de testes

Arquivos de teste gerados (imagens/vídeos sintéticos, sem pessoas, marcas de cliente ou dados pessoais). Legendas sempre iniciando com `[TESTE F8-0b]`. Nenhuma operação em `/inbox` ou `/mcp`.

### R0 — leitura com chave (nenhum post)
| ID | Teste | Prova |
|---|---|---|
| T01 | `GET /me/` | escopos da chave, workspace, allowlist (#38) |
| T02 | `GET /accounts/` | contas conectadas, rede, `char_limit`, `needs_title`, `supports_first_comment` (#10); **identifica se a conta é de teste ou perfil real** |
| T03 | `GET /posts/` com `limit`/`offset` e filtros | listagem e paginação (#27) |
| T04 | `GET /media/` | biblioteca existente (sem baixar arquivos) |
| T05 | `GET /analytics/accounts/{id}` | métricas de conta (#37) |

### R1 — escrita sem publicação (rascunhos e uploads)
| ID | Teste | Prova |
|---|---|---|
| T10 | Upload JPG, PNG, WebP, MP4, MOV | aceitação pela biblioteca (#12) |
| T11 | Upload de imagem de 21 MB e de imagem acima de 30 MP | limites efetivos (#13) |
| T12 | Rascunhos: Feed imagem, Carrossel 2 e 10, Reel, Story imagem e vídeo; combinações inválidas | validações 201/422 por formato (#6, #7) |
| T13 | Legenda com `char_limit` e `char_limit + 1` | limite efetivo (#10) |
| T14 | Repetir `POST /posts/` (rascunho) com a mesma chave e mesmo corpo; mesma chave e corpo diferente | replay / 422 (#22, #24) |
| T15 | Mesmo upload em dois rascunhos | reutilização (#15) |
| T16 | Rascunho com `proposed_publish_at` em `-03:00` | leitura do fuso, devolvido em UTC (#19), sem fila |
| T17 | `PATCH` de legenda em rascunho | edição |

### R1+ — agendamento distante seguido de cancelamento (publicação não esperada; risco residual)
| ID | Teste | Prova |
|---|---|---|
| T20 | Agendar um rascunho para **+7 dias** | `scheduled` (#17) |
| T21 | Cancelar | volta a `draft` (#30) |
| T22 | Cancelar de novo | 409 (idempotente pelo estado, #23) |
| T23 | Agendar +7 d, reagendar para +8 d (`PATCH`), cancelar | reagendamento (#20, #23) |

### R2 — publicação real (aprovação específica da Direção, teste a teste)
| ID | Teste | Prova |
|---|---|---|
| T30 | Story imagem agendado para +2 min (enviado com offset) | antecedência, fuso, `published`, permalink, métricas (#19, #33, #36) |
| T31 | Carrossel no Instagram | #6 |
| T32 | Foto no Feed do Facebook | #8 |
| T33 | Publicação com mídia que a rede recusa (ex.: tipo/proporção inválida) | `failed`, `publish_error`, `retry_count` (#25, #32, #34) |
| T34 | `scheduled_at` no passado | disparo em ~15 s (#18) |

## 4. A conta conectada é adequada?

**Não para os testes R2.** Pelo histórico, a conta conectada é o **Instagram real da agência** e o Facebook da agência: tudo o que for publicado aparece para o público, **não pode ser removido pela API** (remoção manual, como em 2026-09) e consome o teto de 25/dia. Os testes R0, R1 e R1+ não publicam, mas **deixam rascunhos e arquivos** no workspace real (removíveis só pela interface).

Recomendação, por ordem:
1. **Conta de teste dedicada:** um Instagram profissional sem seguidores e uma Página do Facebook de teste, conectados ao BrightBean, com a chave da F8-0b restrita a essa conta pela allowlist. Conectar a conta é alteração de configuração: exige autorização e é feito pelo proprietário.
2. Se não for possível: R2 **apenas com Stories** no Instagram da agência (somem em 24 h), em horário combinado, com remoção manual imediata — decisão explícita da Direção.

## 5. Roteiro de execução (cada fase só com autorização)

| Fase | O quê | Pré-requisito |
|---|---|---|
| 0 | Preparação (este documento) | concluída |
| 1 | R0 (T01–T05) | **o proprietário cria** no BrightBean (Organização → API Keys) uma chave exclusiva da F8-0b **sem `publish_directly`**, com allowlist só da conta de teste, e a deixa como variável de ambiente na máquina que roda os testes. **A chave nunca é colada na conversa nem gravada no repositório** |
| 2 | R1 (T10–T17) | autorização da fase; conta de teste definida (§4) |
| 3 | R1+ (T20–T23) | autorização; chave com `publish_directly` |
| 4 | R2 (T30–T34) | **aprovação específica de cada teste**, conta de teste conectada ou decisão do §4.2 |
| 5 | Encerramento | matriz F8-0 atualizada; contrato do simulador da F8-4; **chave revogada**; lista de resíduos (rascunhos/arquivos) para limpeza manual |

Execução por um script de verificação do repositório (somente as rotas do teste autorizado), que **nunca imprime a chave**, grava evidências sem dados pessoais e para no primeiro resultado inesperado.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Publicação em perfil real | conta de teste dedicada; allowlist; R2 só com aprovação por teste |
| Agendado não cancelado vira publicação | horário a +7 dias; cancelar e conferir o estado na mesma sessão; inventário final de agendados |
| Horário passado publica em ~15 s | nenhum teste fora do T34 envia `scheduled_at`; validação no script |
| Resíduos (rascunhos/arquivos) no workspace real | marcação `[TESTE F8-0b]`; lista final; remoção manual pelo proprietário |
| Vazamento da chave | variável de ambiente local; nunca em chat, log ou commit; revogação ao fim |
| Teto diário do Instagram | no máximo 5 publicações R2 |
| Tokens da Meta/app compartilhados | nada de reconectar, revogar ou alterar o app Meta |

## 7. Critérios de aceite da F8-0b

1. As 13 capacidades classificadas como **Confirmada**, **Confirmada como indisponível** ou **Fora do piloto**, com evidência de execução real ou, quando indisponível, do código e da OpenAPI.
2. Nenhuma publicação além das aprovadas; nenhum dado de cliente; nenhuma alteração na VPS.
3. Chave da F8-0b revogada e rejeitando chamadas.
4. Resíduos listados e removidos (ou aceitos) pelo proprietário.
5. Matriz F8-0 atualizada e contrato do simulador da F8-4 proposto.
6. Aceite apenas da Direção.

## 8. Resultado da Fase R0 (2026-10-13, DEC-F8-010)

Execução **somente GET**, com chave temporária criada pelo proprietário e lida de variável de ambiente local (nunca exibida, gravada ou transmitida a terceiros). Evidência guardada fora do repositório; abaixo só códigos HTTP, nomes de campos e contagens.

| Endpoint | HTTP | Resultado |
|---|---|---|
| `GET /me/` | 200 | autenticação válida; campos `api_key_id`, `workspace_id`, `workspace_name`, `organization_id`, `permissions`, `storage`, `allowlisted_accounts` (sem data de validade na resposta) |
| `GET /accounts/` | 200 | **0 contas** liberadas para a chave |
| `GET /posts/?limit=2&offset=0` | 200 | listagem existe: `items`, `limit`, `offset`, `total`; total **0** (só posts das contas liberadas) |
| `GET /posts/?limit=2&offset=2` | 200 | paginação por `offset` aceita; 0 itens |
| `GET /media/?limit=2` | 200 | listagem existe com paginação por **cursor** (`items`, `limit`, `next_cursor`); 0 itens |
| `GET /posts/?social_account_id=…`, `GET /posts/{id}`, `GET /media/{id}`, `GET /analytics/accounts/{id}`, `GET /analytics/posts/{id}` | **não executados** | sem conta liberada e sem post/mídia visíveis: não havia alvo; verificação interrompida conforme a autorização |

Nenhuma rota respondeu 403: as leituras não exigem escopo específico além de uma chave válida (pelo código, `view_analytics` só é exigida nas rotas de métricas, que não puderam ser chamadas).

**Achado 1 — chave sem conta:** `allowlisted_accounts` e `/accounts/` vazios. A conta pretendida não ficou vinculada à chave (ou está em outro workspace). Com allowlist vazia, qualquer operação que mire uma conta é recusada pelo servidor.

**Achado 2 — permissões efetivas diferentes do informado:** `/me/` devolveu `permissions` = `create_posts`, `approve_posts`, `edit_others_posts`, `view_analytics`. Pelo código (`apps/api/auth.py`), esse campo é a **interseção entre as permissões gravadas na chave e as do usuário que a emitiu** — ou seja, a chave carrega mais do que `view_analytics`. Não carrega `publish_directly` nem `upload_media` (não agenda, não publica, não envia mídia), e a allowlist vazia impede criar posts. **Nenhuma escrita foi tentada.**

**Capacidades com evidência real nesta fase:** #27 listagem de posts (forma da resposta e paginação por offset); listagem de mídia com cursor; #38 modelo de permissão da chave (interseção chave ∩ emissor) e allowlist por chave. Continuam pendentes: #10/#37 (dependem de conta), #36 métricas e todo o R1/R1+/R2.

**Pendências para a R1:** (a) **reemitir a chave** (ou corrigir a atual) com a conta de teste **na allowlist** e somente as permissões da fase autorizada — para a R0 completa, apenas `view_analytics`; para a R1, `create_posts` + `upload_media`, **sem `publish_directly`**; (b) repetir T02 e T05 com a conta visível (limites da conta e métricas); (c) confirmar que a conta é de teste (§4); (d) autorização expressa da R1.

### 8.1 Reexecução da R0 após correção da chave (2026-10-13, DEC-F8-011)

Somente GET, com a mesma chave local. Portão definido antes da execução: seguir para posts, mídia e métricas **só** com permissões = `view_analytics` **e** a conta pretendida visível em `GET /accounts/`.

| Endpoint | HTTP | Resultado |
|---|---|---|
| `GET /me/` | 200 | `permissions` = **[`view_analytics`]** (corrigido); `allowlisted_accounts` com **1 conta**: plataforma `instagram_login`, `connection_status` = `connected`, `char_limit` = **2200**, `needs_title` = false, `supports_first_comment` = true, `escaped_chars` vazio; é a conta pretendida |
| `GET /accounts/` | 200 | **lista vazia (0 contas)** |
| posts, mídia, métricas | **não executados** | portão não atendido: divergência entre `/me/` e `/accounts/` |

**Diagnóstico:** a chave está correta (permissão única e conta liberada), mas a instância devolve a conta em `/me/` e **não** em `/accounts/`. No código do fork em `4e5bef9` as duas rotas leem a **mesma** lista (`api_key.social_accounts.all()`), então a instância **não se comporta como o código lido**. Hipóteses a confirmar pelo proprietário, sem alterar nada: (a) o código implantado não é exatamente `4e5bef9` nessa rota (ex.: filtro adicional por plataforma `instagram_login` ou por estado); (b) cache ou réplica de leitura. Implicação para a F8-4: **não depender de `/accounts/` para descobrir contas** até esclarecer; `/me/` traz os mesmos dados.

**Capacidades com evidência real:** #10 limites da conta (`char_limit` 2200, `needs_title`, `supports_first_comment`, `escaped_chars`) para `instagram_login`; #38 permissão efetiva = interseção chave ∩ emissor e allowlist por chave (agora com a configuração correta). Continuam pendentes: #27 com dados reais, #36/#37 métricas e R1/R1+/R2.

**Para concluir a R0:** decisão da Direção entre (1) esclarecer a divergência de `/accounts/` (verificar a versão implantada da rota, sem alterar a instância) ou (2) autorizar seguir as leituras restantes usando o identificador da conta obtido em `/me/` (posts filtrados pela conta, métricas da conta e, se houver, de um post).

### 8.2 Continuidade e conclusão da R0 (2026-10-13, DEC-F8-012)

**Conta de teste:** a Direção confirmou que a conta vinculada à chave é **conta própria destinada a testes** (identificação no repositório interno), autorizada a receber publicações experimentais em etapas futuras, sempre com autorização específica por fase.

Somente GET; parada automática em erro de autorização ou em dado de conta fora da allowlist (não ocorreu).

| Endpoint | HTTP | Resultado |
|---|---|---|
| `GET /me/` | 200 | permissões [`view_analytics`]; 1 conta na allowlist |
| `GET /accounts/` | 200 | **1 conta — a mesma do `/me/`** (divergência resolvida) |
| `GET /accounts` (sem barra) | 301 | redireciona para a forma com barra |
| `GET /accounts/?nocache=<ts>` | 200 | 1 conta (a mesma) |
| `GET /posts/?social_account_id=<conta autorizada>&limit=5` | 200 | filtro por conta aceito; total 0 |
| `GET /posts/?limit=5` | 200 | total 0 |
| `GET /posts/?social_account_id=<id fora da allowlist>` | 404 | `not_found` — **isolamento confirmado** (não revela outras contas) |
| `GET /analytics/accounts/<conta autorizada>?days=7` | 200 | `analytics_available` = true; campos `account_id`, `account_name`, `analytics_available`, `captured_at`, `connection_status`, `days`, `engagement`, `follower_growth`, `hero_metrics`, `next_sync_eta`, `platform`, `unavailable_reason` |
| `GET /media/?limit=5` | 200 | 0 itens; paginação por cursor |
| `GET /posts/{id}`, `GET /analytics/posts/{id}`, `GET /media/{id}` | não aplicável | a conta não tem posts nem mídia no workspace |

Nenhum cabeçalho de cache HTTP nas respostas (só `Vary: Cookie`).

**Causa da divergência (DEC-F8-011):** no código implantado (`apps/api_keys/services.py`, `4e5bef9`), a chave — com a lista de contas pré-carregada — fica em **cache por até 30 s em cada processo do servidor**; o próprio código documenta que outro processo pode ver a versão antiga até o cache expirar. Na reexecução, `/me/` foi atendido por um processo atualizado e `/accounts/` por um processo com a cópia anterior à correção da allowlist; expirado o cache, as duas rotas concordam. Causa **identificada pelo código e pelo desaparecimento da divergência** (não há acesso aos processos do servidor para observá-la diretamente). Implicação para a F8-4: depois de criar, alterar ou revogar uma chave, **aguardar ao menos 30 s** antes de confiar no novo escopo; revogação pode levar até 30 s para valer em todos os processos.

**Capacidades com evidência real na R0:** #10 limites da conta (`instagram_login`: `char_limit` 2200, sem título, primeiro comentário suportado); #27 listagem de posts com filtro por conta e paginação por offset; listagem de mídia com cursor; **#37 métricas de conta** (200, dados disponíveis); **#38** permissões efetivas (chave ∩ emissor), allowlist por chave e **isolamento** (conta fora da allowlist → 404); propagação de mudanças de chave em até 30 s. **Não verificáveis na R0** (sem posts/mídia na conta): detalhe de post, permalink e #36 métricas de post — ficam para depois da primeira publicação de teste (R2).

**R0 concluída**, pronta para aceite da Direção. Pendências para a R1: autorização específica; chave com `create_posts` + `upload_media`, **sem `publish_directly`**, mesma conta na allowlist; aguardar 30 s após alterar a chave.

## 9. Resultado da Fase R1 (2026-10-13, DEC-F8-013)

Uploads de mídia **sintética** (gradientes, cores e números; sem pessoas, marcas ou dados de clientes) e **somente rascunhos**, na conta própria de testes. O executor bloqueava no próprio código qualquer operação fora de `GET`, `POST /media/`, `POST /posts/` com `action=draft` (sem `scheduled_at`) e `PATCH` de legenda; conferia o estado **rascunho** na resposta e numa releitura de cada post; e parava em 5xx, 401, 403 ou 429 (não ocorreu).

**Portão (3 leituras de `/me/`, consistentes):** permissões exatamente `create_posts`, `upload_media`, `view_analytics`; **sem `publish_directly`**; 1 conta `instagram_login` conectada (conta de teste), `char_limit` 2200.

### Uploads (`POST /media/`)
| Teste | Arquivo | HTTP | Resultado |
|---|---|---|---|
| U1 | JPG 1080×1350 | 201 | `image/jpeg` |
| U1r | mesmo arquivo, mesma `Idempotency-Key` | 201 | **mesmo media_id** (replay) |
| U1x | outro arquivo, mesma chave | 422 | "idempotency_key reused with a different request body" |
| U2 | PNG 1080×1080 | 201 | `image/png` |
| U3 | WebP 1080×1080 | 201 | `image/webp` |
| U4 | JPG 1080×1920 (story) | 201 | `image/jpeg` |
| U5 | MP4 H.264 720×1280, 4 s, sem áudio | 201 | `video/mp4` |
| U6 | o mesmo vídeo com extensão `.mov` e tipo `video/quicktime` | 201 | registrado como **`video/mp4`**: o servidor detecta o tipo pelo conteúdo (um MOV QuickTime verdadeiro não foi testado) |
| C01–C11 | 11 JPG 1080×1080 | 201 | `image/jpeg` |
| U8 | PNG de 23 MB (9 MP) | 422 | "File too large. Maximum size for image files is 20MB." |
| U9 | PNG 6000×6000 (36 MP) | 422 | "the limit is 30 megapixels" |
| U10 | texto com extensão `.jpg` | 422 | "Unsupported or unrecognised file type." |

Todas as 17 mídias aceitas terminaram com `processing_status` = `completed` (o vídeo começa `pending`). Resposta do upload traz `width`, `height`, `aspect_ratio`, `duration`, `thumbnail_url`, `url`, entre outros.

### Rascunhos (`POST /posts/`, `action=draft`)
| Teste | Formato | HTTP | Resultado |
|---|---|---|---|
| D1 | Feed imagem (JPG) | 201 | rascunho |
| D2 | Carrossel 2 imagens | 201 | rascunho |
| D3 | Carrossel 10 imagens | 201 | rascunho |
| D4 | Carrossel **11** imagens | 201 | **aceito como rascunho** — o servidor **não** valida o limite de 10 na criação |
| D5 | Reel (MP4) | 201 | rascunho |
| D6 | Story imagem | 201 | rascunho |
| D7 | Story vídeo | 201 | rascunho |
| D8 | Story com 2 mídias | 422 | "post_type 'story' requires exactly 1 media asset, got 2." |
| D9 | Reel com imagem | 422 | "post_type 'reel' requires a video asset, got 'image'." |
| D10 | vídeo no Feed (sem `post_type`) | 201 | aceito como rascunho (efeito na publicação não verificado) |
| D11 | Feed PNG | 201 | rascunho |
| D12 | Feed WebP | 201 | rascunho |
| D13 | Reel com o arquivo "`.mov`" | 201 | rascunho |
| D14 | legenda com 2200 caracteres | 201 | rascunho |
| D15 | legenda com **2201** caracteres | 201 | **aceito como rascunho** — limite da conta **não** validado na criação |
| D16 / D16r | mesma chave e mesmo corpo | 201 / 201 | **mesmo post_id** (replay) |
| D16x | mesma chave, corpo diferente | 422 | "idempotency_key reused with a different request body" |
| D17 | `proposed_publish_at` enviado com `-03:00` | 201 | devolvido em UTC (`Z`), **mesmo instante**; continua rascunho (não entra na fila) |
| T17 | `PATCH` de legenda em D1 | 200 | legenda atualizada; continua rascunho |

**Inventário final** (leitura após os testes): **15 posts, todos `draft`**; 17 mídias; nenhum agendado ou publicado.

**Inventário para limpeza:** 15 rascunhos (legenda iniciando com `[TESTE F8-0b]`) e 17 arquivos (título `TESTE F8-0b`), com identificadores no repositório interno. Nada foi removido automaticamente.

**Achados para a F8-4:**
1. O BrightBean **não valida na criação do rascunho** o número de itens do carrossel (11 aceito) nem o limite de legenda da conta (2201 aceito): o Hub deve validar antes de enviar (o Hub já limita o carrossel a 10; falta validar a legenda contra o `char_limit` da conta).
2. A deduplicação do **upload** compara nome do arquivo, tamanho e metadados (não o conteúdo): a chave de idempotência deve ser única por arquivo (ex.: derivada do SHA-256).
3. O tipo é detectado pelo conteúdo (o "`.mov`" virou `video/mp4`): o Hub deve usar o tipo devolvido pelo servidor.
4. Vídeo leva alguns segundos em `pending` antes de `completed`: aguardar o processamento antes de agendar.

**Pendências para a R1+:** autorização específica; chave com `publish_directly` **somente** quando autorizada (agendar a +7 dias, reagendar e cancelar — T20 a T23); aguardar 30 s após alterar a chave; reaproveitar os rascunhos D1/D2 para os testes de agendamento e cancelamento.

## 10. Preparação da R1+ (2026-10-13, DEC-F8-014) — análise de código, sem escrita

Fonte: fork `zafira-custom-v1`, commit `4e5bef9` (`apps/api/routers/posts.py`, `apps/composer/services.py`, `apps/composer/models.py`, `apps/publisher/engine.py`). Nada foi chamado na instância.

### 10.1 Permissões exigidas
| Operação | Rota | Permissões | Observação |
|---|---|---|---|
| Agendar um rascunho (T20) | `POST /posts/{id}/schedule` com `scheduled_at` | **`create_posts` + `publish_directly`** | só leva `draft` → `scheduled`; sem rascunho → 409 |
| Reagendar um agendado (T23) | `PATCH /posts/{id}` com `scheduled_at` | **`create_posts` + `publish_directly`** (exigida quando o post está agendado) | só altera filhos `scheduled`; rascunhos não são afetados |
| Cancelar (T21/T22) | `POST /posts/{id}/cancel` | **somente `create_posts`** | `scheduled` → `draft`; sem agendado → 409 |
| Criar já agendado | `POST /posts/` com `action=schedule` | `create_posts` + `publish_directly` | **não usar** na R1+ |

**`publish_directly` é necessária para agendar e reagendar** e não é necessária para cancelar. Chave mínima da R1+: **`create_posts` + `publish_directly`** (sem `upload_media`; `view_analytics` opcional), mesma conta de teste na allowlist. **Bloqueio possível:** se o workspace tiver fluxo de aprovação ativo (`approval_workflow_mode`), o agendamento é recusado com 422 ("Workspace requires approval before scheduling") — resultado válido a registrar, sem contornar.

### 10.2 Como o servidor publica e cancela
- O publicador roda a cada **~15 s** e pega filhos com `status = scheduled` e horário efetivo (`scheduled_at` do filho ou, se vazio, do post) **≤ agora**; trava as linhas (`select_for_update`) e passa para `publishing`.
- **Cancelar** faz `scheduled` → `draft`, **apaga `scheduled_at`** e remove a entrada da fila do calendário; o post deixa de ser candidato do publicador. Transições permitidas a partir de `scheduled`: só `publishing` ou `draft`. Depois de `publishing`, **não há cancelamento** (409 "No scheduled platform posts to cancel").
- **Não há validação de horário futuro** em agendar nem em reagendar: horário passado ou muito próximo **publica no ciclo seguinte (~15 s)**.
- Horários: campo em UTC; enviar sempre com fuso explícito (`Z` ou `-03:00`, já confirmado na R1 que o servidor converte para o mesmo instante).
- **Idempotência:** agendar, reagendar e cancelar **não** usam `Idempotency-Key`; são idempotentes **pelo estado** (repetir agendar → 409; repetir cancelar → 409).
- O agendamento conta no **teto diário da conta** (Instagram 25/24 h); rascunhos não contam.
- **Revogar ou expirar a chave não cancela agendados**: o publicador não depende da chave. A validade atual (20/10/2026) cai antes de +7 dias.

### 10.3 Riscos e proteções
| Risco | Proteção no executor e no roteiro |
|---|---|
| Horário passado/próximo publica em ~15 s | o executor **recusa enviar** `scheduled_at` menor que agora + 6 dias; usa +7 d e +8 d |
| Agendado esquecido publica na data | cancelar **na mesma execução**, logo após cada verificação; inventário final por `GET /posts/?status=scheduled`; se algo restar, parar e avisar a Direção para cancelar pela interface |
| Corrida entre cancelar e o publicador | só ocorreria no minuto do horário; com +7 d não há janela |
| Publicação acidental | usar **rascunhos de Story** (somem em 24 h) na conta própria de testes, já autorizada a receber publicações experimentais |
| Operação fora do escopo | executor só permite `GET`, `POST /posts/{id}/schedule`, `PATCH` **apenas** com `scheduled_at` e `POST /posts/{id}/cancel`; nada de criar posts, upload ou `action=schedule` |
| Permissão além do necessário | portão em `/me/` (3 leituras): exatamente as permissões autorizadas e 1 conta de teste; aguardar 30 s após alterar a chave |
| Fluxo de aprovação do workspace | 422 é registrado e a fase para; não alterar configuração |

### 10.4 Reaproveitamento da R1
Sim. O agendamento usa o `post_id` de rascunhos existentes; as mídias já estão processadas (`completed`). Recomendado: **D6 (Story imagem)** para T20–T22 e **D7 (Story vídeo)** para T23. **Não usar** D4 (carrossel com 11 itens) nem D15 (legenda com 2201 caracteres), que são inválidos para publicação.

### 10.5 Sequência recomendada (após autorização)
1. Direção ajusta a chave para `create_posts` + `publish_directly` (mesma conta de teste); aguardar 30 s.
2. Portão: 3× `GET /me/`; `GET /posts/?status=scheduled` deve começar com **0**.
3. **T20:** agendar D6 para agora + 7 dias, enviado em `-03:00` → esperar 200, filho `scheduled`, horário devolvido em UTC no mesmo instante.
4. **T21:** cancelar D6 → 200, filho `draft`, `scheduled_at` vazio no post e no filho.
5. **T22:** cancelar D6 de novo → 409. Agendar D6 de novo não é necessário.
6. **T23:** agendar D7 para +7 d → reagendar (`PATCH` só com `scheduled_at`) para +8 d → conferir o novo horário → cancelar → `draft`.
7. Encerramento: `GET /posts/?status=scheduled` = **0**; releitura de D6 e D7 = `draft` sem horário; nova releitura após alguns minutos; registro das evidências.
8. Recomendado em seguida: Direção retira `publish_directly` da chave.

### 10.6 Como confirmar que o cancelamento valeu
Resposta do cancelamento com filho `draft`; `GET /posts/{id}` com post e filhos em `draft` e `scheduled_at` nulo; `GET /posts/?social_account_id=<conta>&status=scheduled` com total 0; segundo cancelamento devolvendo 409 (não há mais agendado). Como o publicador só seleciona `scheduled`, um post em `draft` sem horário **não é publicado depois**.

**Critérios de aceite da R1+:** T20–T23 com os resultados esperados (ou 422 de aprovação registrado); **nenhum post publicado nem em `publishing`**; zero agendados ao fim; evidências sem chave nem dados pessoais.

## 11. Tentativa de execução da R1+ (2026-10-13, DEC-F8-015) — interrompida no portão, sem escrita

Executor com travas no código (só D6 e D7; só agendar, reagendar com `scheduled_at` e cancelar; horário com fuso explícito e ≥ agora + 6 dias; parada na primeira resposta inesperada). Espera de 35 s após a alteração da chave antes do portão.

| Verificação | Resultado |
|---|---|
| `GET /me/` × 3 | 200 × 3, consistentes; **permissões efetivas = [`create_posts`]** — **`publish_directly` ausente** (esperado: `create_posts` + `publish_directly`) |
| Conta | 1 conta de teste, `instagram_login`, conectada |
| Decisão do portão | **interrompido; nenhuma escrita** (T20–T23 não executados) |
| D6 e D7 (final e após 3 min) | `draft`, `scheduled_at` nulo no post e no filho |
| Totais da conta (final e após 3 min) | `scheduled` 0, `publishing` 0, `published` 0, `failed` 0 |

**Diagnóstico:** as permissões efetivas são a **interseção** entre o que está gravado na chave e o que o usuário que a emitiu pode fazer no workspace (código: `apps/api/auth.py`). Com a espera de 35 s e três leituras idênticas, cache está descartado. Hipóteses, a confirmar pela Direção na interface do BrightBean, sem alteração pelo agente: (a) a opção `publish_directly` não ficou salva na chave; (b) **o usuário emissor da chave não tem `publish_directly` no seu papel do workspace** — nesse caso nenhuma chave emitida por ele terá essa permissão (indício: em nenhuma leitura desde a R0 `publish_directly` apareceu, mesmo quando a chave trouxe permissões além das selecionadas).

**Pendências:** corrigir a chave ou o papel do emissor (decisão e ação da Direção); depois, repetir a R1+ com o mesmo executor e os mesmos controles. A R2 continua dependendo da R1+.

## 12. Execução da R1+ (2026-10-13, DEC-F8-016)

Mesmo executor da §11, sem alterações (travas: só D6 e D7; só agendar, reagendar com `scheduled_at` e cancelar; horário com fuso explícito e ≥ agora + 6 dias; parada na primeira resposta inesperada). Espera de 35 s após a correção da chave.

**Portão:** 3× `GET /me/` (200, consistentes) com permissões efetivas **exatamente** `create_posts` e `publish_directly`; 1 conta de teste `instagram_login` conectada; conta com `scheduled`/`publishing`/`published`/`failed` = 0; D6 e D7 em `draft` sem horário. A permissão faltava na chave (hipótese (a) da §11).

| Teste | Operação | HTTP | Estado depois |
|---|---|---|---|
| T20 | agendar D6 (Story imagem) enviando `2026-10-20T20:08:00-03:00` | 200 (esperado 200) | post e filho `scheduled`, horário `2026-10-20T23:08:00Z` — **mesmo instante, convertido para UTC** |
| T21 | cancelar D6 | 200 (esperado 200) | post e filho `draft`, `scheduled_at` **nulo** |
| T22 | cancelar D6 de novo | **409** (esperado 409) | "No scheduled platform posts to cancel."; D6 continua `draft` sem horário |
| T23a | agendar D7 (Story vídeo) para `2026-10-20T20:08:00-03:00` | 200 | `scheduled`, `2026-10-20T23:08:00Z` |
| T23b | reagendar D7 (`PATCH` só com `scheduled_at`) para `2026-10-21T20:08:00-03:00` | 200 | `scheduled`, `2026-10-21T23:08:00Z` — mesmo instante, post e filho atualizados |
| T23c | cancelar D7 | 200 | post e filho `draft`, `scheduled_at` nulo |

**Estados finais e releitura após 3 minutos:** D6 e D7 em `draft` sem horário; conta com `scheduled` 0, `publishing` 0, `published` 0, `failed` 0. **Zero publicações e zero agendamentos de teste.** Nenhuma operação fora das autorizadas; nenhum post ou mídia criados.

**Capacidades confirmadas:** #17 agendar um rascunho; #19 fuso no agendamento (offset convertido para UTC no mesmo instante); #20 reagendar; #23 agendar/cancelar idempotentes pelo estado (repetição → 409); #30 cancelar devolve a rascunho e remove o horário.

**Observação:** o horário de +7 dias caiu depois da validade informada da chave (20/10/2026); como a revogação ou expiração da chave **não** cancela agendados, o cancelamento imediato era obrigatório e foi feito.

**Pendências para a R2:** retirar `publish_directly` da chave até a R2 ser autorizada; R2 teste a teste (T30–T34) na conta de testes, com aprovação específica; primeira publicação confirma #33 permalink, #36 métricas de post e #32/#34 estados de publicação e falha.

## 13. Preparação da R2 — primeira publicação real (T30, Story imagem D6) (2026-10-13, DEC-F8-017) — sem execução

**Leituras feitas (só GET):** `/me/` × 3 → permissões efetivas **[`create_posts`]** (`publish_directly` removida, conforme a Direção), conta de teste conectada. **D6:** `draft`, Story (`post_type` = `story`), 1 mídia (JPG 1080×1920), sem horário. Campos do filho expostos pela API: `status`, `scheduled_at`, `published_at`, `platform_post_id`, `permalink_url`, `publish_error` (`retry_count` **não** é exposto).

### 13.1 Procedimento exato
A API v1 **não tem "publicar agora"** (`action` só `draft`/`schedule`). O caminho controlado é **agendar D6 para poucos minutos à frente**: `POST /posts/{D6}/schedule` com `scheduled_at` = agora + 3 min (minuto cheio, fuso `-03:00`). O publicador roda a cada ~15 s, pega o filho `scheduled` vencido, passa para `publishing`, envia ao Instagram e grava `published` + `published_at` + `platform_post_id` + `permalink_url` (ou `failed` + `publish_error`). Horário no passado também publica (~15 s), mas **não** é o caminho escolhido (fica para o T34, se autorizado).

### 13.2 Permissões
Chave com **`create_posts` + `publish_directly` + `view_analytics`** (esta última só para ler as métricas do post), mesma conta de teste na allowlist; aguardar 30 s após a alteração. Retirar `publish_directly` logo após o teste.

### 13.3 Riscos
| Risco | Tratamento |
|---|---|
| Publicação pública no Instagram | conta própria de testes, autorizada pela Direção; Story some em 24 h; conteúdo sintético `[TESTE F8-0b]` |
| Publicação não pode ser apagada pela API | remoção, se desejada, só manual no Instagram |
| Retentativa automática do servidor | em falha transitória o filho volta a `scheduled` com nova tentativa em 60 s, 5 min e 30 min (máx. 3); o executor acompanha 25 min e **alerta** se D6 seguir agendado (cancelamento só com decisão da Direção) |
| Duplicidade | o servidor **nunca republica** um `publishing` sem confirmação (marca `failed` em vez de arriscar duplicar); o executor faz **uma única escrita**, **não reenvia** nem em falha de rede, e alerta se a conta tiver mais de 1 publicado |
| Horário errado | executor só aceita `scheduled_at` com fuso e entre agora + 2 min e agora + 10 min |
| Permalink tardio | ausência de permalink logo após `published` = "pendente"; releitura posterior |
| Métricas atrasadas | `analytics_available`/`next_sync_eta`; ausente ≠ zero; nova leitura (só GET) depois |
| Teto diário | 1 publicação no teto de 25/24 h da conta |

### 13.4 Executor (preparado, não executado)
Restrito a D6 e à conta de testes; **uma única escrita** (agendar D6, janela +2 a +10 min, fuso obrigatório); bloqueia qualquer outra rota, outro post, cancelamento e segunda escrita (travas testadas offline). Portão: 3× `/me/` com permissões exatas e conta de teste `instagram_login` conectada; conta sem agendados/publicando; D6 = Story rascunho com 1 mídia. Acompanha a cada 15 s por até 25 min: estado de D6, totais da conta por estado; encerra em `published` com permalink ou em `failed`. Final: estado de D6, totais, métricas do post (`GET /analytics/posts/{D6}`). O permalink fica **só** no repositório interno.

### 13.5 Verificações e critérios de aceite do T30
1. `schedule` → 200 com horário em UTC no mesmo instante.
2. Linha do tempo `scheduled` → `publishing` → **`published`**, com `published_at` e `platform_post_id`.
3. `permalink_url` presente (ou pendente, confirmado em releitura).
4. **Exatamente 1** publicado na conta; **zero** agendados e zero `publishing` ao final.
5. Métricas do post: HTTP 200 (disponíveis ou com `next_sync_eta`), sem tratar ausência como zero.
6. Conferência visual da Direção no perfil de testes: **um único** Story.
7. Retirada de `publish_directly` em seguida.
Falha (`failed`) também é resultado válido: registrar `publish_error` e não repetir sem nova autorização.

### 13.6 Roteiro
Direção adiciona `publish_directly` e `view_analytics` à chave → autorização expressa do T30 → executor (portão, uma escrita, acompanhamento, leitura final) → relatório → Direção confere o perfil e retira `publish_directly` → aceite. T31–T34 continuam teste a teste.

## 14. Execução do T30 — primeira publicação real (2026-10-13, DEC-F8-018)

Executor da §13 com a espera de 35 s acrescentada antes do portão (sem outra alteração). **Uma única escrita.**

**Portão:** 3× `/me/` com permissões exatas `create_posts`, `publish_directly`, `view_analytics`; 1 conta de teste `instagram_login` conectada; conta com `scheduled`/`publishing`/`published`/`failed` = 0; D6 = Story rascunho com 1 mídia, sem horário.

| Momento (UTC) | Evento | Estado de D6 | Totais da conta |
|---|---|---|---|
| — | `POST /posts/{D6}/schedule` enviando `2026-10-13T21:25:00-03:00` → **200** | `scheduled`, `2026-10-14T00:25:00Z` (mesmo instante) | — |
| 00:22:08 | leitura | `scheduled` | scheduled 1 |
| 00:25:16 | publicador assumiu (16 s após o horário) | `publishing` | publishing 1 |
| 00:25:32 | concluído | **`published`**, `published_at` = 00:25:26 UTC, `platform_post_id` e `permalink_url` presentes, `publish_error` vazio | **published 1**, demais 0 |

**Resultado:** Story publicada na conta de testes **em ~26 s após o horário agendado**, sem falha e **sem retentativa automática** (nenhum retorno a `scheduled` na linha do tempo). Permalink e identificadores registrados só no repositório interno.

**Duplicidade:** **ausente** — a conta tem exatamente **1** post publicado, e ele é o D6; zero agendados, zero `publishing`, zero `failed` (leitura final e releitura posterior). Conferência visual do perfil pela Direção pendente.

**Métricas do post** (`GET /analytics/posts/{D6}`, 200): `analytics_available` = true, 7 indicadores (`reach`, `views`, `likes`, `comments`, `saves`, `shares`, `engagement`) **todos com valor 0**, porém `captured_at` = **nulo** e `next_sync_eta` ≈ 6 min depois da publicação. **Achado:** antes da primeira coleta o BrightBean devolve **0 em vez de "indisponível"**; a F8-5 deve tratar `captured_at` nulo como **sem dado** (ausência ≠ zero), nunca como engajamento zero.

**Pendências:** conferência visual do perfil (um único Story); **retirar `publish_directly`** da chave; leitura das métricas depois da sincronização (só GET, se a Direção quiser); T31–T34 teste a teste; o Story expira em 24 h no Instagram, e o registro no BrightBean permanece `published`.
