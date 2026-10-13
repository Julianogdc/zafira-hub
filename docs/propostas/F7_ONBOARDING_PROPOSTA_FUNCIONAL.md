# F7 — Onboarding: proposta funcional (estrutura, sem processo real)

| Campo | Valor |
|---|---|
| Situação | **SUPERADA EM PARTE por DEC-F7-004 e por `F7-1_ESPECIFICACAO_CONSTRUTOR_ONBOARDING.md`.** O processo real não é mais pré-requisito: as perguntas Q1–Q12 viram conteúdo de modelos configurados pelo administrador. Mantida como histórico dos conceitos. |
| Base | DEC-F7-001 a 003 (aprovadas 2026-10-12), Mapa C2 §15 (F7), v1.1 §8.6 |
| Autor / data | Claude — 2026-10-12 |

## 1. O que a estrutura aprovada (D2-B) permite
Um **template versionado** descreve etapas com dependências, responsável por função e prazo relativo. Uma **execução** aplica uma versão do template a um cliente. O processo real entra depois como **conteúdo do template**, sem mudar o modelo.

## 2. Conceitos
| Conceito | Descrição |
|---|---|
| **Template** | Nome, finalidade (a definir), versões. Cada versão é **imutável** depois de publicada. |
| **Etapa** (do template) | Identificador estável, título, descrição, **função responsável**, **prazo relativo**, **predecessoras**, tipo, evidência esperada, se bloqueia a conclusão. |
| **Tipo de etapa** | `manual` · `confirmar projeto Asana e vincular` (D3; só vínculo local) · `reunião` (vinculada a evento do Calendar, só leitura, D1) · `automação` (**futura**, n8n; fora da 1ª entrega). |
| **Execução** | Cliente, versão do template usada, data de início, estado geral e etapas instanciadas com a pessoa responsável **resolvida** na criação. |
| **Estados da etapa** | Pendente · Liberada (predecessoras cumpridas) · Em andamento · Bloqueada (com motivo) · Concluída · Dispensada (com justificativa) · Falha de automação (**não** conclui). |
| **Histórico** | Cada mudança gera evento auditável (quem, quando, justificativa) — mesmo padrão de Entregas. |

## 3. Regras já fixadas pelo Mapa (valem sem decisão nova)
1. Etapa dependente não conclui fora de ordem sem **autorização e justificativa**.
2. Automações são **idempotentes** (repetir não duplica nada).
3. Falha automática **não** marca etapa como concluída.
4. Mudar o template **não altera** execuções em andamento (nova versão só para novas execuções).
5. **Nenhuma escrita no Asana** (DEC-ASANA-001); etapa de projeto só confirma e vincula.
6. Prazos, "hoje" e atrasos usam o **fuso da organização** (DEC-F6-005).
7. Tudo respeita organização e carteira do cliente; teste negativo entre duas organizações.

## 4. Tela (proposta mínima)
- **Painel do gestor:** execuções em andamento por cliente, % de etapas concluídas, **bloqueios**, **atrasos**, próximos passos.
- **Detalhe da execução:** etapas em ordem, quem é responsável, prazo, estado, evidência (link), histórico.
- **Templates:** lista, versões, publicar nova versão (permissão específica).
- Estados de carregando, vazio, erro e sem permissão como nas demais telas F6; 390 px sem rolagem horizontal; Design System da F3.

## 5. Permissões (a definir com a F7-1)
Propostas de nomes, para o catálogo de RBAC: ver onboarding, executar/avançar etapas, gerir templates, autorizar fora de ordem/dispensar. Padrão: gestor e admin gerem; colaborador executa as etapas da sua carteira.

## 6. Fora da primeira entrega
n8n real; criação ou edição de eventos pelo Hub; notificações e lembretes (F14); anexos de arquivo (só links); portal do cliente (F16).

## 7. Perguntas de produto **abertas** (não presumir)

### Onboarding
| # | Pergunta | Por que importa |
|---|---|---|
| Q1 | Quais são as **etapas reais**, na ordem em que a equipe as executa hoje? | Conteúdo do template; sem isso não há o que construir |
| Q2 | O que **dispara** um onboarding: contrato assinado (F9), decisão manual, ganho do negócio (F11)? | Gatilho e dependência de fases futuras |
| Q3 | Há **templates diferentes** (por serviço, por pacote de 8 ou 12 conteúdos, por tipo de cliente)? | Número e organização dos templates |
| Q4 | Quais **funções** existem na agência (gestor de conta, designer, social media…)? São diferentes de Admin/Gestor/Colaborador do sistema? | "Responsável por função" precisa de uma lista de funções e de quem a exerce |
| Q5 | Prazos em **dias úteis ou corridos**, contados do **início** do onboarding ou da **liberação** da etapa? | Cálculo de atraso |
| Q6 | Quais etapas são **bloqueantes** e quem pode **dispensar** ou autorizar fora de ordem? | Regras de exceção e permissões |
| Q7 | Que **evidência** cada etapa exige (link, documento, confirmação simples)? | Critério de "concluída" |
| Q8 | Que **acessos e ferramentas** o onboarding provisiona hoje (pastas, contas, convites)? O Hub só registra ou algo precisa ser automatizado? | Escopo de automação futura (n8n) |
| Q9 | Quando o onboarding é considerado **encerrado**? Depende de contrato (F9) ou financeiro (F10)? | Estado final e dependências |
| Q10 | Quem pode **ver** o onboarding de um cliente? Só a carteira, ou também comercial e financeiro? | Visibilidade e RBAC |
| Q11 | Existe prazo-alvo (SLA) de onboarding por tipo de cliente? Que alerta é desejado? | Indicadores e F14 |
| Q12 | O **cliente externo** participa de alguma etapa (envio de materiais, aprovações)? | Impacto em F16; hoje fora de escopo |

### Calendar (D1 — dados que a Direção ainda definirá)
| # | Pergunta |
|---|---|
| C1 | Quais **contas e calendários** serão lidos (Workspace corporativo, um por pessoa, um compartilhado)? |
| C2 | Quais **tipos/categorias de evento** e como mapear para cliente e projeto (vínculo manual, por título, por convidado)? |
| C3 | **Visibilidade:** quem vê eventos de quem? |
| C4 | **Frequência de sincronização** aceitável (tempo quase real por aviso do Google, ou leitura periódica)? |
| C5 | Eventos passados e cancelados: por quanto tempo guardar? |

## 8. Próximos passos (quando a Direção entregar o processo real)
1. Registrar o processo real (Q1–Q12) como DEC e o conteúdo do primeiro template.
2. **F7-1:** modelo e regras (domínio e testes), migration ensaiada em banco descartável.
3. **F7-2:** execução e painel do gestor. 4. **F7-3:** leitura do Calendar e vínculos. 5. **F7-4:** automações n8n idempotentes. 6. **F7-5:** Browser Gate com Calendar e n8n simulados.
