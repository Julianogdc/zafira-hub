# Controles de publicação (F8-5p.3, P39) — homologação e produção

> Referência técnica (DEC-F8-031). Não autoriza ligar nada. Ligar o envio ou o coletor exige autorização específica da Direção.

## 1. Barreiras implementadas

| Barreira | Onde | Comportamento |
|---|---|---|
| Política do piloto (`PUBLICATION_PILOT_ORGANIZATION_IDS`, `PUBLICATION_PILOT_FORMATS`) | **antes do envio** (despachante, antes de montar o gateway do provedor) | sempre estrita: ausente, vazia ou inválida → nada é enviado (`PILOT_POLICY_INVALID`); organização fora da lista → `PILOT_ORGANIZATION_NOT_AUTHORIZED`; formato fora da lista → `PILOT_FORMAT_NOT_AUTHORIZED` |
| Política do piloto | **no pedido** e no reagendamento (API) | estrita quando a política está definida **ou** o envio está ligado; no modo de simulação (envio desligado e política não definida) o pedido é registrado, e nada sai do Hub |
| Vínculo ativo cliente + conta Instagram + organização | pedido **e** antes do envio | conta desvinculada depois do agendamento → `ACCOUNT_UNLINKED`, sem chamar o provedor |
| Cancelamento | despachante | **sempre permitido**: só reduz exposição |
| Auditoria | histórico do conteúdo | cada bloqueio gera o evento `PUBLICATION_BLOCKED` (código e tipo de pedido); publicação sem rascunho no provedor encerra como `FAILED`; com rascunho ou agendada, o estado é mantido e o motivo registrado |

Formato das variáveis: listas separadas por vírgula. Organizações por id (letras, números e hífen, 8 a 64 caracteres). Formatos entre `FEED_IMAGE`, `CAROUSEL`, `REEL` e `STORY`. A tela mostra só se **esta** organização e **este** formato estão autorizados; nunca lista outras organizações.

**Limite conhecido:** retirar uma organização ou formato da política **não recolhe** posts já agendados no provedor. O BrightBean publica no horário agendado. Para impedir, **cancele** pela tela, porque o cancelamento continua permitido. O Hub não cancela sozinho, para não fazer escritas implícitas.

## 2. Homologação controlada (piloto F8-5e)

| Variável | Valor no piloto | Fora da janela do piloto |
|---|---|---|
| `PUBLICATION_DISPATCH_ENABLED` | `true` só na janela autorizada | ausente ou `false` |
| `PUBLICATION_METRICS_ENABLED` | `true` só na janela de coleta | ausente ou `false` |
| `PUBLICATION_PILOT_ORGANIZATION_IDS` | **somente** o id da organização sintética do piloto | pode permanecer (sem envio ligado, nada sai) |
| `PUBLICATION_PILOT_FORMATS` | `STORY,FEED_IMAGE` (D-F85-6); `REEL` só com decisão específica; `CAROUSEL` só depois da RS1 | idem |

Checklist antes de ligar: chave do piloto com uma única conta; conta vinculada ao cliente de teste pela tela; política conferida em `GET /content/publication-settings` (`pilotPolicy.organizationAuthorized = true` e formatos esperados); nenhuma outra organização com conexão ativa do BrightBean. Desligar: voltar as duas flags para `false` e reiniciar o serviço da API.

## 3. Produção

- **Nada ligado** até nova decisão da Direção depois do Portão F8.
- Quando houver decisão: lista de organizações **explícita** (nunca "todas"), formatos só os homologados com publicação real, revisão da lista a cada inclusão de cliente, e as mesmas flags desligadas por padrão.
- Alterações das variáveis em produção são mudança de configuração com autorização própria (AGENTS.md, seção 6), registradas no `REGISTRO.md`.
- O Browser Gate e os testes de CI rodam no **modo de simulação** (envio desligado, política não definida). Eles não exigem configuração de produção.
