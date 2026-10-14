# Contrato mínimo do adaptador SocialPublisher ↔ BrightBean (insumo da F8-4)

> **Situação:** proposta da avaliação final da F8-0b (DEC-F8-020), para revisão da Direção. **Não autoriza a F8-4.**
> Base: comportamento **observado** na instância (F8-0b R0, R1, R1+ e T30) e código do fork `zafira-custom-v1`, commit `4e5bef9`. Detalhes em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md` e na matriz `docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md` (§7–§10).
> Legenda: **[V]** observado em execução real; **[C]** lido no código (não observado).

## 1. Credencial e escopo
1. Uma chave de API por conexão, **com allowlist** restrita às contas do cliente; o adaptador nunca registra a chave em log, resposta ou evento. [V]
2. Permissões efetivas = chave ∩ papel do usuário emissor no workspace. O adaptador lê `GET /me/` e **recusa operar** se faltar permissão ou sobrar conta fora do esperado. [V]
3. Permissões por operação: `upload_media` (upload), `create_posts` (rascunho, edição, cancelamento), `publish_directly` (agendar e reagendar), `view_analytics` (métricas). [V]
4. Mudanças na chave levam **até 30 s** para valer em todos os processos do servidor. [V]
5. **Revogar ou expirar a chave não cancela agendamentos.** Ao desconectar um cliente, o Hub cancela antes os agendados pendentes. [C]
6. Se o workspace tiver fluxo de aprovação próprio, o agendamento responde 422: o adaptador mostra erro de configuração e **nunca** usa o fluxo de aprovação do BrightBean. [C]

## 2. Mídia
1. Validar no Hub **antes** do envio: JPG, PNG, WebP, MP4 (MOV: só depois de verificado); **imagem ≤ 20 MB e ≤ 30 megapixels**; vídeo ≤ 1 GB [C]. O Hub aceita até 100 MB (D4): imagens acima de 20 MB precisam de aviso ou conversão antes do agendamento. [V]
2. `Idempotency-Key` do upload **derivada do SHA-256 do arquivo** (e da conexão): o servidor deduplica por nome, tamanho e metadados, não pelo conteúdo. [V]
3. Usar o tipo **devolvido pelo servidor** (detectado pelo conteúdo). [V]
4. Agendar só depois de `processing_status = completed` (o vídeo começa `pending`). [V]
5. A mídia pertence ao workspace e pode ser reutilizada. [V]

## 3. Rascunho
1. **Uma conta por post.** `post_type`: `story` (exatamente 1 mídia), `reel` (exatamente 1 vídeo) ou vazio (Feed/carrossel). [V]
2. O servidor **não valida** na criação o máximo do carrossel (11 aceito) nem o `char_limit` da conta (2201 aceito): o Hub valida **carrossel 2–10** e **legenda ≤ `char_limit`** lido de `GET /me/`. [V]
3. `Idempotency-Key` estável por item da caixa de saída. Mesma chave + mesmo corpo → mesmo post (replay); corpo diferente → 422 (erro do Hub, não repetir); pedido em andamento → 409 (repetir depois com a mesma chave). Validade da chave: 24 h. [V]/[C]
4. Rascunhos **não são apagáveis pela API**. [C]

## 4. Agendamento, reagendamento e cancelamento
1. `scheduled_at` **sempre com fuso explícito** (o servidor armazena em UTC no mesmo instante). [V]
2. **O servidor não valida horário futuro:** horário passado ou próximo publica no ciclo seguinte (~15 s). O Hub **recusa** `scheduled_at` menor que agora + antecedência mínima (proposta: 5 min). [C]/[V]
3. O publicador dispara em até ~15–30 s após o horário (T30: `published` 26 s após). [V]
4. Agendar, reagendar e cancelar **não** usam `Idempotency-Key`: são idempotentes **pelo estado**. Antes de cada operação, ler o post; 409 = estado já mudou → reconciliar lendo, não repetir às cegas. [V]
5. Cancelar só existe para `scheduled` (volta a `draft` sem horário). Depois de `publishing`, não há cancelamento. [V]/[C]
6. Teto de **25 publicações por conta do Instagram em 24 h**, contando agendados; 429 traz `retry_after`. [C]
7. Limites da API: escrita 120/min, leitura 300/min por chave. [C]

## 5. Reconciliação e estados
1. Guardar o **id do post do BrightBean** logo após a criação; reconciliar **só por ele** (não existem webhooks nem busca por referência externa). [V]/[C]
2. Leitura periódica de `GET /posts/{id}`. Estados observados: `draft`, `scheduled`, `publishing`, `published`; `failed` e os estados de aprovação tratados em modo seguro (estado desconhecido falha fechado). [V]/[C]
3. `published` exige `published_at` e `platform_post_id`; permalink ausente = "pendente". [V]
4. Listagem `GET /posts/?social_account_id=&status=&limit=&offset=` só para inventário e auditoria. [V]

## 6. Falhas, retentativas e duplicidade
1. Em falha transitória, o servidor **tenta de novo sozinho** até 3 vezes (60 s, 5 min, 30 min), com o filho voltando a `scheduled`; o Hub mostra "nova tentativa automática" e não agenda outra vez. [C]
2. `failed` traz `publish_error`: exibir mensagem segura, nunca o texto bruto. [C]
3. O servidor **nunca republica** um `publishing` sem confirmação (marca `failed` em vez de arriscar duplicar). O Hub também não recria: depois de timeout, repete com a **mesma** `Idempotency-Key` em até 24 h ou procura o post pela listagem antes de qualquer nova criação. [C]
4. Publicações **não podem ser apagadas pela API**; a interface do Hub não oferece "excluir publicação". [C]

## 7. Métricas
1. Métrica de post só é dado quando `captured_at` não é nulo; antes disso o servidor devolve **0 com `series` vazias** — o Hub mostra "aguardando coleta" (ausência ≠ zero). [V]
2. Coleta de posts com menos de 24 h: rotina **de hora em hora** (depois a cada 6 h, 1 dia, 7 dias; para após 90 dias). `next_sync_eta` sem coleta anterior é sempre agora + 5 min: **não é compromisso**. [C]/[V]
3. Métricas de conta: coleta diária (`captured_at` + 24 h). [V]

## 8. Pendências que não bloqueiam o início da F8-4
Carrossel publicado de verdade; Facebook; estado `failed` e retentativa observados; coleta efetiva de métricas de post; MOV verdadeiro; limite real de vídeo; corrida e timeout com duplicidade. Todas devem estar resolvidas ou aceitas como risco **antes de ligar o despachante em ambiente real** (portão de homologação da F8-4/F8-5).
