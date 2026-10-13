# F8-3 — Contrato técnico: contador de Entregas por estágio

> **Situação:** **aprovado pela Direção (DEC-F8-007)** com D1 = opção A, D2 e D3 aprovadas. Implementado no público em `38ce219` (run 38446236135); aceite técnico pendente.
> Base: decisão de produto da Direção de 2026-10-13 (interface aprovada); código no público `2fd34dc`.

## 1. O que existe hoje (levantamento do domínio)

| Domínio | Registro | O que serve para a F8-3 |
|---|---|---|
| Conteúdos (F8-1) | `ContentItem` (cliente, formato, `deliverablePieceId` opcional, `archivedAt`) | **unidade de contagem**: um conteúdo = uma peça |
| | `ContentVersion` (`number`, `sentForApprovalAt`, `contentHash`) | `sentForApprovalAt` marca o envio; depois disso a versão é imutável |
| | `ContentMedia` (`createdAt`, `removedAt`, `sha256`) | primeiro arquivo enviado = **arquivo recebido** |
| | `ContentEvent` (`CONTENT_CREATED`, `MEDIA_ADDED/REPLACED/REMOVED`, `VERSION_CREATED`, `CONTENT_UPDATED`) | trilha de auditoria |
| Aprovação (F8-2) | `ApprovalLink` (vários por versão; reemissão revoga o anterior) | não é unidade de contagem (reenvios não duplicam) |
| | `ApprovalDecision` (**única por versão** no banco; `APPROVED` ou `CHANGES_REQUESTED`) | primeira decisão `APPROVED` = **aprovado pelo cliente** |
| | `ContentEvent` (`APPROVAL_LINK_CREATED/REISSUED/REVOKED`, `CLIENT_APPROVED`, `CLIENT_CHANGES_REQUESTED`) | trilha de auditoria |
| Entregas (F6) | `DeliverablePlan` (cliente + competência `YYYY-MM`, `targetCount` = meta) | período do painel; **meta não é tocada** |
| | `DeliverablePiece` (etapas manuais `PRODUCED → APPROVED → DELIVERED`, DEC-F6-002) | vínculo opcional de um conteúdo; etapas manuais continuam como estão |
| Publicação | — | **não existe fonte confiável** (virá com F8-4/F8-5: confirmação do BrightBean com `externalPostId`/permalink) |

**Lacunas encontradas:**
- **L1.** `ContentItem.deliverablePieceId` não tem chave estrangeira nem unicidade: dois conteúdos podem apontar para a mesma peça.
- **L2.** `archivedAt` existe, mas nenhuma rota o preenche hoje.
- **L3.** A especificação §9 previa gravar os estágios no enum de `DeliverablePiece` com um marcador novo. Este contrato propõe **não** gravar (ver D2).

## 2. Regras de contagem

Cada conteúdo tem um **estágio alcançado**, que é o mais alto entre os quatro abaixo. Cada contador conta quem alcançou **pelo menos** aquele estágio, então os números são cumulativos e nunca crescem de baixo para cima (recebidos ≥ enviados ≥ aprovados ≥ publicados).

| Estágio | Alcançado quando (fonte gravada pela F8-1/F8-2) | Data do estágio |
|---|---|---|
| 1. Arquivo recebido | existe ao menos um `ContentMedia` do conteúdo, **inclusive removido** depois | menor `ContentMedia.createdAt` |
| 2. Enviado para aprovação | alguma versão tem `sentForApprovalAt` preenchido | menor `sentForApprovalAt` |
| 3. Aprovado pelo cliente | existe `ApprovalDecision` com `decision = APPROVED` em alguma versão | menor `createdAt` dessas decisões |
| 4. Publicado | **confirmação confiável de publicação** (F8-4/F8-5). Na F8-3: **sempre indisponível** | — |

- **Sem duplicidade:** a contagem é feita por `ContentItem`. Versões, links, reemissões e reenvios não criam peça nova.
- **Só eventos reais:** os contadores são **derivados na leitura** dos registros da F8-1/F8-2, que o banco já protege contra alteração de histórico. Não existe digitação manual de número nem cache.
- **Conteúdo arquivado** (`archivedAt` preenchido) fica fora da contagem (L2; hoje sem efeito).
- **Escrita:** a F8-3 **não grava nada** em Entregas nem em Conteúdos. Não há migration, salvo a D3 se for aprovada.

## 3. Alterações, reenvios e situações-limite

| Situação | Resultado |
|---|---|
| v1 com pedido de alteração, v2 aprovada | 1 recebido, 1 enviado, 1 aprovado |
| v1 com pedido de alteração, v2 ainda não enviada | conta em recebidos e enviados; não conta em aprovados |
| Link reemitido, revogado ou expirado sem decisão | continua contando como enviado (o estágio foi alcançado); nenhuma duplicidade |
| Aprovado e, depois, nova versão criada | continua contando como aprovado; a lista mostra o status atual ("nova versão em preparação") |
| Arquivo removido antes do envio | continua contando como recebido |
| Conteúdo criado sem arquivo | não entra em nenhum contador |
| Histórico | versões, decisões, comentários e pedidos de alteração continuam intactos e visíveis no detalhe do conteúdo |

## 4. Sem publicação

- `publicados` vem como **`null`**, com a fonte `NOT_INTEGRATED`. **Nunca vira 0.** A interface mostra "Aguardando integração da publicação".
- **A barra** (publicados ÷ recebidos) fica em estado neutro, sem percentual, com o texto "Publicação ainda não integrada (próximas etapas)". Quando houver recebidos = 0: "Sem arquivos recebidos no período", sem 0% e sem divisão por zero.
- Etapa `DELIVERED` manual da peça de Entregas e link colado **não** contam como publicação confiável.
- Quando a F8-4/F8-5 entregarem a confirmação, `publicados` passa a contar conteúdos com publicação confirmada, sem mudar as outras regras.

## 5. Escopo, permissões e interface

- **Endpoint (leitura):** `GET /clients/:id/deliverables/content-stages?period=YYYY-MM`.
  - Exige `deliverables.view` **e** `content.view`, além do escopo de cliente (`findClientInResourceScope`) e da organização da sessão.
  - Fora do escopo, a resposta é **404**, igual à de recurso inexistente.
  - Resposta: `{ period, received, sent, approved, published: null, publishedSource: 'NOT_INTEGRATED', items: [{ id, title, format, stage, stageDates, currentStatus }] }`.
  - Nenhuma URL de mídia, `storageKey` ou dado do aprovador sai nessa resposta.
- **Regra pura** em `packages/domain` (estágio de um conteúdo a partir das datas) e tipos em `packages/contracts`.
- **Interface:** no painel de Entregas existente, com os componentes e tokens do Design System já usados ali.
  - Quatro cartões (Arquivos recebidos, Enviados para aprovação, Aprovados pelo cliente, Publicados) e a barra complementar.
  - Responsivo até 390 px (cartões em 2×2).
  - Somente leitura: **nenhum botão de ação**, nenhuma etapa de aprovação interna e nenhum fluxo paralelo ao Asana.
- **Meta contratual:** `targetCount`, `deliveredQuantity` e as etapas manuais das peças **não mudam**. Os contadores ficam ao lado da meta, não no lugar dela.

## 6. Decisões para a Direção

- **D1. Período de cada conteúdo** (recomendado: **A**).
  - A: se estiver vinculado a uma peça de Entregas, vale a competência do plano dessa peça. Se não estiver, vale o mês do primeiro arquivo recebido, no fuso da organização (`OrganizationConfig.timezone`).
  - B: só conteúdos vinculados a peças aparecem no painel.
  - A opção A mantém o funil coerente: um conteúdo sempre conta no mesmo período em todos os estágios.
- **D2. Contagem derivada, sem gravar nas peças** (recomendado). Esta opção substitui a especificação §9, que mapeava os estágios no enum de `DeliverablePiece` com migration. A alternativa (§9) automatizaria as etapas que a DEC-F6-002 deixou manuais.
- **D3. Uma peça de Entregas por conteúdo** (recomendado). Índice único parcial em `content_items(organizationId, deliverablePieceId)` quando o vínculo estiver preenchido (L1). É uma migration pequena e sem dados reais afetados.

## 7. Testes de aceite

1. **Domínio:** estágio derivado em todos os casos da seção 3; contadores sempre recebidos ≥ enviados ≥ aprovados; `published` é `null`, nunca 0.
2. **API:**
   - permissões: sem `content.view` ou sem `deliverables.view`, a resposta é 403;
   - cliente fora do escopo ou de outra organização: 404, igual para os dois casos;
   - nada do aprovador nem de mídia na resposta;
   - reemissão, revogação e várias versões não duplicam a contagem;
   - período conforme D1 com o fuso da organização.
3. **PostgreSQL:**
   - isolamento entre Org A e Org B;
   - contagem correta com dados reais da F8-1/F8-2 (upload, envio, pedido de alteração, nova versão, aprovação);
   - nenhuma escrita em tabelas de Entregas durante a leitura;
   - D3 (se aprovada): o segundo vínculo à mesma peça é recusado.
4. **Web e Browser Gate F8 (extensão):**
   - os quatro cartões e a barra aparecem no painel;
   - números corretos depois do fluxo completo do gate (enviado → pedido de alteração → nova versão → aprovado);
   - "Publicados" mostra "Aguardando integração", nunca 0;
   - estados de recebidos = 0 e sem permissão;
   - 390 px sem rolagem horizontal;
   - um usuário da Org B não vê os números da Org A;
   - meta contratual inalterada antes e depois.
5. **CI oficial completo (5 jobs)** verde no repositório público. **Aceite só da Direção.**

## 8. Fora do escopo da F8-3

F8-4/F8-5 (agendamento, publicação, BrightBean), F8-0b, F16, mudanças na meta ou nas etapas manuais das peças, escrita no Asana, S3, VPS e produção.
