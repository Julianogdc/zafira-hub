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
