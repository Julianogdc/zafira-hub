# F8 — Conteúdo, Aprovação e BrightBean — Especificação funcional e técnica (REVISÃO 2, PROPOSTA)

> **Status: PROPOSTA revisada por decisão da Direção (DEC-F8-001, 2026-10-12).** Substitui a revisão 1 (commit `33c306f`, preservada no histórico do Git), que duplicava no Hub o fluxo editorial do Asana. **Nenhum código da F8 está autorizado.** Itens **[DECIDIR]** não são decisões; só valem após registro de DEC.

> **Atualização (DEC-F8-002):** revisão 2 aprovada; **D1, D2, D4 e D5 aprovadas** (ver `docs/REGISTRO.md`); D3 antes da F8-2. A **F8-0** (matriz de capacidades do BrightBean) está em `docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md` e ajusta o desenho: formatos efetivos `FEED_IMAGE`, `CAROUSEL`, `REEL` e `STORY` (o "vídeo" do Instagram vira Reel), uma conta por agendamento, nenhum uso do workflow de aprovação do BrightBean, reconciliação por `externalPostId` e F8-4 condicionada à **F8-0b**.

## 1. Novo fluxo de produto (decidido)

1. **Asana** — pauta, criação, comentários, alterações e **aprovação interna**. (Somente leitura no Hub: DEC-ASANA-001/002.)
2. **Hub** — **upload dos arquivos finais**, vinculação ao cliente e acompanhamento nas Entregas.
3. **Hub** — **aprovação do cliente por link seguro** (WhatsApp/e-mail, sem login), com **preview inspirado no Instagram** e ações *aprovar* ou *solicitar alterações*.
4. **BrightBean** — agendamento e publicação **exclusivamente da versão aprovada**.
5. **Hub** — status, permalink e métricas orgânicas disponíveis.

**Não existe no Hub:** pauta, revisão interna, comentários internos, aprovação interna, kanban editorial. O Hub gerencia a etapa **posterior** à aprovação interna e registra as versões **efetivamente encaminhadas ao cliente**.
**F16** (portal autenticado do cliente) reutilizará **exatamente** o mesmo domínio de conteúdo, versões e aprovações; a F8 não antecipa o portal completo.

## 2. Escopo e aceite

**Construção:** arquivos finais versionados; aprovação do cliente por link; nova versão e nova aprovação; agendamento/publicação da versão aprovada; sincronização de status/permalink/falha; contador de Entregas por estágio.
**Aceite (Mapa C2, mantido):** (1) o cliente aprova exatamente a versão que será agendada; (2) pedido de alteração preserva a versão anterior e o comentário; (3) feed, Reels, Stories, vídeo e carrossel classificados e exibidos corretamente; (4) retentativa de agendamento não cria publicação duplicada.
**Portão F8:** conteúdo piloto percorre upload, envio ao cliente, aprovação por link, agendamento e publicação, com trilha completa.
**Fora:** portal autenticado (F16), notificações automáticas (F14 — o link é copiado/compartilhado pelo usuário), mídia paga (F13), contratos (F9).

## 3. Regras de produto

1. **Fonte mestre:** Asana = processo editorial e aprovação interna; Hub = arquivos finais, versões encaminhadas, aprovação do cliente e Entregas; BrightBean = agendamento/publicação efetiva e métricas orgânicas.
2. **Versão imutável:** arquivos, legenda e `contentHash` não mudam depois de **enviados para aprovação do cliente**; alteração = nova versão. **Nova versão exige nova aprovação**; versões anteriores, decisões e comentários permanecem.
3. **Só a versão aprovada publica:** o agendamento referencia versão + hash; divergência bloqueia (na criação **e** no despacho). Nova versão invalida links e agendamentos pendentes da anterior (cancelamento explícito e auditado).
4. **Posse do link não é prova definitiva de identidade:** a aprovação registra *quem declarou ser o aprovador*, o canal e evidências proporcionais ao risco; o Hub nunca a apresenta como "identidade verificada" sem verificação adicional.
5. **Entregas:** uma **peça** por conteúdo; versões não criam peças novas; a meta contratual **nunca** é alterada automaticamente (não-presunção, DEC-F6-002).
6. **Sem dado fictício em produção; sem escrita no Asana; isolamento por organização e carteira em tudo, exceto o endpoint público do link, que só expõe a versão autorizada.**

## 4. Domínio (proposta; migrations só com autorização)

- **`ContentItem`** — organizationId, clientId, título, `format` (FEED | CARROSSEL | REELS | STORIES | VIDEO), `asanaTaskGid?` (vínculo local informado, sem chamar o Asana), `deliverablePieceId?`, `status`, `currentVersionId`, arquivamento. Chave natural opcional (cliente + gid) evita peça duplicada.
- **`ContentVersion`** — itemId, número, `status` (RECEIVED | SENT_FOR_APPROVAL | APPROVED | CHANGES_REQUESTED | SUPERSEDED), legenda/hashtags, `contentHash`, autor do upload, `sentForApprovalAt`. Gatilho: imutável após `sentForApprovalAt`.
- **`ContentMedia`** — versionId, ordem, tipo real, tamanho, dimensões, duração, `sha256`, `storageKey` (endereçamento por hash; §6).
- **`ApprovalLink`** — versionId, **hash do token** (o token em claro só aparece uma vez), expiração, revogação (`revokedAt/By`), rótulo do destinatário/canal, nível de identificação, contagem de acessos. Um link por versão ativa; reemitir revoga o anterior.
- **`ApprovalDecision`** — versionId, linkId, `APPROVED | CHANGES_REQUESTED`, comentário, **aprovador declarado** (nome, contato, relação com a marca), canal (WHATSAPP | EMAIL | OUTRO), evidências técnicas minimizadas (instante, hash de IP e agente, nível de verificação), append-only; no máximo **uma decisão final** por versão.
- **`ContentSchedule`** — versão aprovada, conta social, `scheduledFor` (UTC + fuso da organização), `status`, chave de idempotência, `externalPostId?`, `permalink?`, tentativas, erro seguro; **caixa de saída** como na F7-4.
- **`ContentEvent`** (append-only) + `AuditLog`.
- **P28:** `Client → Content*` **sem cascata destrutiva** (restrição) para conteúdos aprovados/publicados; exclusão de cliente exige arquivamento/regra de retenção. Histórico aprovado nunca é apagado por efeito colateral. [DECIDIR D2]

## 5. Estados

```
Arquivo recebido ──enviar ao cliente──▶ Enviado p/ aprovação ──aprovar──▶ Aprovado ──agendar──▶ Agendado ──▶ Publicado | Falhou
                                              │ solicitar alteração (comentário)
                                              └──▶ Alteração solicitada ──(nova versão: novo upload)──▶ Arquivo recebido (v+1)
```
Expiração/revogação do link volta a versão para "Recebido" lógico sem perder o histórico (novo link possível).

## 6. Armazenamento de mídia (decisão necessária)

Requisitos da Direção: preservar versões e **não depender exclusivamente do BrightBean**. Proposta: interface `FileStorage` com **dois drivers** — *local* (desenvolvimento, testes, CI) e *objeto S3-compatível privado* (homologação/produção) —, chaves **endereçadas por hash** (`org/<id>/sha256/<hash>`), imutáveis; metadados e vínculos no PostgreSQL; **URLs assinadas e curtas** para preview/aprovação; upload validado por tipo real, tamanho e conteúdo; envio ao BrightBean a partir do arquivo do Hub no agendamento (o BrightBean é destino, não cofre). Backup/retenção do storage entram no runbook de operação (P28/F18). **Provedor concreto** (qual S3, região, custo) é decisão antes da homologação, não da primeira fatia. [D1]

## 7. Aprovação por link — requisitos de segurança

- Token aleatório de **256 bits**, só o hash guardado; link `…/aprovacao/<token>`; **validade** padrão proposta 7 dias (máx. 30) e **revogação** imediata pelo Hub.
- **Escopo único:** o token só lê a versão autorizada (mídia, legenda e formato); nada de cliente, meta, outras versões, nomes internos ou outros links.
- Respostas **genéricas** para token inválido/expirado/revogado (sem enumeração); limite de taxa por IP/token; sem cookies de sessão; cabeçalhos `no-store`, `noindex`, `Referrer-Policy: no-referrer`; proteção contra ação repetida (decisão idempotente; segunda decisão = conflito).
- **Identificação proporcional ao risco:** N1 (padrão) nome + contato + confirmação explícita ("declaro ter autoridade para aprovar") + evidências técnicas minimizadas; N2 (opcional, futuro) código enviado ao contato cadastrado do cliente. O nível exigido é configurável por cliente. [D3]
- Mídia por URLs assinadas curtas; sem exibir caminho de storage; LGPD: coletar o mínimo e definir retenção das evidências (P28).
- Todas as ações auditadas; revogar/reemitir exige permissão e justificativa.

## 8. Preview (Instagram-inspirado, Design System atual)

Componente web puro: moldura de perfil + legenda truncada com "mais"; proporções 1:1, 4:5, 1,91:1 (feed), 9:16 (Reels/Stories); carrossel navegável (até 10); vídeo com player nativo; marcações de formato e avisos de limites (legenda, duração, dimensões). **Ilustrativo:** não garante a renderização da rede. Reutilizado pela F16.

## 9. Entregas (contador por estágio)

A peça de Entregas mostra o estágio de conteúdo: **arquivo recebido → enviado para aprovação → aprovado → publicado**, mapeado sobre o enum atual (`PRODUCED`, `APPROVED`, `DELIVERED`) com um novo marcador de "enviado para aprovação" **[a migrar com autorização]**. "Entregue" continua exigindo aprovado + publicado (DEC-F6-002). Versões repetidas não geram peça nova; excedente segue a regra de extra; **a meta contratual não muda automaticamente**.

## 10. BrightBean — capacidades (verificar antes do agendamento)

**Já evidente no adaptador existente:** criação como `draft` ou `schedule` (publicação imediata **não** suportada), `Idempotency-Key` enviado na criação, reagendar/cancelar, consulta de post, `permalink_url` e `scheduled_at` nas respostas, métricas por post/conta, upload de mídia.
**A confirmar na API real (sem credenciais agora):** o servidor **respeita** a chave de idempotência? consulta por referência externa? limites por rede e por formato? formatos de mídia e tamanho aceitos? semântica de cancelamento depois de publicado? retorno de falhas e de rejeição pela rede? webhooks ou apenas leitura? janela de reagendamento? Resultado vira uma **matriz de capacidades** (tarefa F8-0) e define a estratégia de retentativa: com idempotência real → reenviar com a mesma chave; sem ela → **consultar antes de recriar** + reconciliação. Nunca prometer "exatamente uma vez" sem suporte do provider.

## 11. Permissões (RBAC)

Reutilizar os códigos existentes: `content.create` (upload/versão), `content.send_to_client` (gerar/revogar link e enviar à aprovação), `content.schedule`, `content.publish`, `content.delete`; **não usar** `content.review`/`content.approve_internal` (aprovação interna é do Asana). Acrescentar, se necessário, `content.view` e `content.view_metrics` (P22 / `rbac:bootstrap`). O endpoint público do link não usa RBAC: usa o token.

## 12. Fatias propostas (simplificadas; cada uma com autorização própria)

| Fatia | Conteúdo | Pré-requisito de decisão |
|---|---|---|
| **F8-0** *(verificação, sem código de produção)* | Matriz de capacidades do BrightBean (§10) a partir da documentação/instância de teste e do adaptador; lista de lacunas | nenhuma |
| **F8-1** | Domínio e arquivos: `ContentItem/Version/Media/Event`, `FileStorage` (driver local + interface), upload validado, vínculo cliente/peça/gid, imutabilidade, RBAC, API, telas mínimas (lista e upload) | D1 (arquitetura), D2, D4, D5 |
| **F8-2** | Aprovação por link: `ApprovalLink/Decision`, página pública e preview, aprovar/pedir alteração, nova versão, revogação/expiração, acompanhamento; **Browser Gate F8-2** (segurança do link, Org B, 390 px) | D3 |
| **F8-3** | Entregas: estágios do contador (arquivo recebido → enviado → aprovado → publicado), sem alterar meta; ajustes no painel | F8-1/2 |
| **F8-4** | Agendamento/publicação: caixa de saída, despachante (desligado por padrão), simulador do BrightBean, retentativa sem duplicar; telas | F8-0, redes do piloto, fuso |
| **F8-5** | Sincronização de status/permalink/falhas, métricas orgânicas (leitura), conteúdo piloto e **Portão F8** | F8-4 |

Fatias grandes e independentes podem ser entregues sem Browser Gate novo quando só houver domínio/API (economia de CI): **um push e um run completo por fatia**; commits só de documentação com `[skip ci]`.

## 13. Decisões ainda necessárias antes da primeira fatia (F8-1)

| # | Decisão | Proposta | Observação |
|---|---|---|---|
| **D1** | Arquitetura de storage | `FileStorage` com driver local + S3-compatível, chaves por hash, URLs assinadas (§6) | provedor concreto fica para antes da homologação |
| **D2** | Integridade histórica (P28) | sem cascata destrutiva em conteúdo aprovado/publicado; exclusão de cliente exige arquivamento | confirma o desenho do §4 |
| **D4** | Tipos e limites de arquivo | JPG/PNG/WebP e MP4/MOV; limites por formato com teto de 100 MB (hoje o multipart da API) | ajustável |
| **D5** | Vínculo com o Asana | `asanaTaskGid` informado manualmente, só vínculo local, sem leitura obrigatória | |
| **D3** *(antes da F8-2)* | Validade do link e nível de identificação | 7 dias (máx. 30); N1 padrão, N2 opcional no futuro; configurável por cliente | |

**Não bloqueiam a primeira fatia:** redes do piloto, fuso/janela de publicação e métricas (F8-4/5), provedor de storage (antes da homologação), migração de legado (trilha de migração).

## 14. Testes e gates

Domínio (transições, imutabilidade, hash, bloqueio de agendamento sem aprovação); PostgreSQL (gatilhos, índices únicos, concorrência de decisão e de agendamento, isolamento entre organizações, restrição de exclusão); API (permissões, token inválido/expirado/revogado indistinguíveis, segredos fora das respostas); web (preview por formato; Browser Gate F8-2 com link, aprovação, pedido de alteração, nova versão, revogação, 390 px e Org B; simulador do BrightBean no F8-4). Sem contas reais.

## 15. Riscos

Link vazado ou encaminhado (mitigações §7 e N2); aprovação ambígua sobre a versão (hash + escopo único); publicação duplicada (§10); storage sem decisão final de provedor; crescimento para portal (F16) — limitado por esta especificação; exclusão de cliente apagando histórico (P28, §4); dependência de API do BrightBean sem garantias (F8-0); consumo de CI (§12).

## 16. Proibições mantidas

Sem código da F8, migrations, deploy, produção, credenciais ou serviços reais (BrightBean, Asana, Google, n8n); escrita no Asana proibida; agendadores desligados; P22 e P28 seguem bloqueadoras.
