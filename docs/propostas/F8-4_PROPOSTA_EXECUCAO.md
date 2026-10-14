# F8-4 — Proposta de execução: agendamento e publicação pela versão aprovada

> **Situação:** proposta para aprovação da Direção (DEC-F8-022). **Somente preparação técnica; implementação não autorizada.**
> Base: contrato `docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md`, especificação F8 (DEC-F8-001/002), F8-0b encerrada com ressalvas (DEC-F8-022) e o padrão de caixa de saída já aceito na F7-4a (`automation_outbox`).

## 1. Objetivo
Agendar no BrightBean **exatamente a versão aprovada pelo cliente** (F8-2), com caixa de saída transacional, despachante **desligado por padrão**, simulador do BrightBean, reconciliação de estado e telas. Sem publicação real em ambiente nenhum até a homologação.

## 2. Ponto de partida no código
- `modules/integrations/social-publisher`: interface `SocialPublisherProvider` (upload, criar, ler, agendar, cancelar, métricas) e `BrightBeanProvider`; **rotas síncronas herdadas da fase 2C2** (`POST /api/v1/clients/:clientId/social/content`, `.../schedule`, `.../cancel`, `POST /api/v1/social/upload`) que falam direto com o BrightBean.
- **Achado:** essas rotas permitem criar e agendar conteúdo **sem passar pela versão aprovada** (DEC-F8-001). A F8-4 deve restringi-las (desativar a escrita, ou exigir `content.schedule` e passar pela caixa de saída), mantendo a leitura.
- Permissões já existentes no domínio: `content.schedule`, `content.publish`, `content.view`.

## 3. Desenho
### 3.1 Dados (migration nova)
- **`ContentPublication`** — uma por versão aprovada e conta social: organização, cliente, item, **versão** (FK, imutável), conta social, horário pedido (UTC), estado do Hub, `externalPostId` (id do post no BrightBean), `platformPostId`, permalink, `publishedAt`, motivo de falha seguro, timestamps.
- **`publication_outbox`** — pedidos ao BrightBean gravados **na mesma transação** da ação do usuário: tipo (`UPLOAD`, `CREATE_DRAFT`, `SCHEDULE`, `RESCHEDULE`, `CANCEL`), chave de idempotência, tentativas, próxima tentativa, lease, resultado.
- Regras no banco: índice único **por versão + conta** (uma publicação ativa); gatilho que impede agendar versão sem `ApprovalDecision = APPROVED` com o mesmo `contentHash`; histórico imutável (mesma política da F8-1/P28).

### 3.2 Estados no Hub
`AGUARDANDO_ENVIO` → `RASCUNHO_NO_PROVEDOR` → `AGENDADO` → `PUBLICANDO` → `PUBLICADO` | `FALHOU` | `CANCELADO`; mais `NOVA_TENTATIVA_DO_PROVEDOR` (o servidor voltou a `scheduled` após falha) e `AMBIGUO` (timeout sem confirmação — exige reconciliação, nunca reenvio cego).

### 3.3 Despachante (desligado por padrão)
`PUBLICATION_DISPATCH_ENABLED=false` por padrão. Lease por item, reserva otimista, retentativas com recuo, limite de tentativas; **cada passo lê o estado no BrightBean antes de agir** (contrato §4.4). Ordem: upload (chave = SHA-256 do arquivo + conexão) → aguardar `processing_status = completed` → rascunho (chave = id do item da caixa de saída) → agendar.

### 3.4 Idempotência e duplicidade
- Upload e rascunho com `Idempotency-Key` estável; 409 em andamento → repetir com a mesma chave; 422 de corpo diferente → erro do Hub, parar e alertar.
- Agendar/reagendar/cancelar idempotentes **pelo estado** (ler antes; 409 → reconciliar).
- Timeout após criar: repetir com a mesma chave em até 24 h ou procurar pela listagem por conta antes de recriar; nunca criar segundo rascunho para a mesma versão + conta.

### 3.5 Validações no Hub (o servidor não faz)
Carrossel 2–10; legenda ≤ `char_limit` de `GET /me/`; imagem ≤ 20 MB e ≤ 30 MP; vídeo ≤ 1 GB; Story = 1 mídia; Reel = 1 vídeo; **horário ≥ agora + 5 min** (horário passado publica em ~15 s); teto de 25 por conta do Instagram em 24 h; uma conta por publicação.

### 3.6 Reconciliação
Leitura periódica de `GET /posts/{externalPostId}` (sem webhooks): atualiza estado, `publishedAt`, `platformPostId`, permalink (ausente = pendente) e motivo de falha seguro. Ao desconectar um cliente, cancelar antes os agendados (revogar a chave não cancela).

### 3.7 Permissões e escopo
Agendar/reagendar/cancelar: `content.schedule`; acompanhar: `content.view`; escopo de cliente e organização em todas as rotas; nenhuma ação usa o fluxo de aprovação do BrightBean; chave do BrightBean nunca exposta.

### 3.8 Telas
No detalhe do conteúdo aprovado: escolher conta e horário (fuso da organização), agendar, reagendar, cancelar, ver estado, permalink e falha. Linguagem: "publicado" (sem "excluir publicação"); métricas só na F8-5, com "aguardando coleta" quando `captured_at` for nulo.

## 4. Simulador do BrightBean
Servidor local (no padrão de `n8n-mock.mjs`) que implementa as rotas usadas, com o comportamento **observado** na F8-0b: replay/422/409 de idempotência, validações de story/reel, `scheduled` → `publishing` → `published` com atraso, permalink tardio, e modos de falha programáveis — `failed` com `publish_error`, retentativa com volta a `scheduled` (60 s/5 min/30 min, máx. 3), timeout após criar, 429 com `retry_after`, chave sem permissão, conta fora da allowlist (404). **Substitui T33 e T34** como testes reais.

## 5. Testes
- **Domínio:** validações §3.5, transições de estado, horário mínimo, teto diário.
- **API:** permissões, escopo de cliente/organização, só versão aprovada, rotas legadas restritas, sem segredo nas respostas.
- **PostgreSQL:** índice único versão + conta, gatilho de versão aprovada, caixa de saída na mesma transação, concorrência do despachante, isolamento Org A/B.
- **Integração com o simulador:** fluxo feliz; replay e 409; timeout ambíguo sem duplicar; falha e retentativas do servidor; cancelamento antes do horário; tentativa de cancelar após `publishing`.
- **Browser Gate F8 (extensão):** agendar, reagendar, cancelar e acompanhar com o simulador; 390 px; Org B.
- **CI oficial 5/5** no repositório público.

## 6. Fatias propostas
- **F8-4a** — domínio, dados, caixa de saída, despachante desligado, simulador e testes (sem tela).
- **F8-4b** — telas, restrição das rotas legadas e Browser Gate.
- **Homologação (fora da F8-4):** ligar o despachante só com autorização, resolvendo antes as ressalvas RS1 (carrossel real, se no piloto), RS2 (falha real observada ou aceita), RS5 (MOV/vídeo) e RS6.

## 7. Decisões pedidas à Direção
- **D-F84-1:** destino das rotas síncronas herdadas (desativar a escrita — recomendado — ou mantê-las só para administração).
- **D-F84-2:** antecedência mínima do agendamento (proposta: 5 min).
- **D-F84-3:** reagendar/cancelar depois de `PUBLICANDO` não existe; confirmar que a tela só informa.
- **D-F84-4:** redes do piloto (Instagram apenas, ou com Facebook) — condiciona T32.
