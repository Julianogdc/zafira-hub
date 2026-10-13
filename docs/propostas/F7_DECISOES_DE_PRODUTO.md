# F7 — Onboarding e Agenda: decisões de produto a resolver antes de construir

| Campo | Valor |
|---|---|
| Situação | **PREPARAÇÃO** — nenhuma funcionalidade da F7 implementada. **D1, D2 e D3 foram APROVADAS em 2026-10-12** (DEC-F7-001, 002 e 003). Pendem os dados de Calendar (C1–C5) e o processo real de onboarding (Q1–Q12) em `F7_ONBOARDING_PROPOSTA_FUNCIONAL.md`. |
| Autor / data | Claude — 2026-10-12 (decisão de Direção, item 5) |
| Base | Mapa C1 §6 (F7) e §15 (critérios F7), v1.1 §8.6 e §8.7, estado do repositório em 2026-10-12 |
| Estado do código | Não existe código de onboarding nem de Google Calendar. `IntegrationProvider` não tem valor para Calendar nem para n8n; `/conteudos` ("Conteúdos & Agenda") é do Hub 2.0 e não é a agenda da F7. |

## D1. Fonte de verdade dos eventos no Calendar — **APROVADA: opção C** (DEC-F7-001)

| Opção | Como funciona | Prós | Contras |
|---|---|---|---|
| **A. Hub mestre** | Evento nasce no Hub e é enviado ao Google Calendar; mudança feita no Google vira "divergência" para revisão | Vínculo forte com cliente/projeto; regras próprias | Equipe já usa o Google; risco de duas agendas |
| **B. Por categoria** (v1.1) | Reunião nasce no Google; captação, visita e entrega nascem no Hub; bidirecional só onde preciso | Reflete o uso real | Exige regra de precedência e resolução de conflitos antes de qualquer edição bidirecional |
| **C. Calendar mestre, Hub lê** (recomendada para a 1ª entrega) | Hub lê os calendários autorizados e **vincula localmente** evento a cliente, projeto e tipo, como já é feito com o Asana | Menor risco; sem conflito; mesmo padrão já aceito; entrega rápida | Criar evento continua no Google; Hub não cria evento nessa 1ª versão |

**Recomendação:** C na primeira entrega; evoluir depois para "Hub cria evento no Google" (um sentido só) para tipos que o proprietário escolher. Edição bidirecional só com precedência definida (regra do próprio Mapa v1.1).

**Informações que preciso do proprietário:** (1) quais calendários/contas (Workspace corporativo? um calendário compartilhado ou um por pessoa?); (2) quais tipos de evento existem (reunião, captação, visita, apresentação, treinamento, entrega, rotina…); (3) intervalo aceitável de atraso entre o Google e o Hub; (4) quem pode ver eventos de quem.

## D2. Estrutura do template de onboarding — **APROVADA: opção B** (DEC-F7-002)

| Opção | Estrutura | Observação |
|---|---|---|
| A. Checklist linear | Lista ordenada de etapas | Simples; não expressa paralelismo |
| **B. Etapas com dependências** (recomendada) | Cada etapa: responsável **por papel**, prazo **relativo** (dias úteis desde o início), predecessoras, evidência opcional (link/arquivo), ação automática opcional | Cobre as regras do Mapa; ainda simples de operar |
| C. Fases › etapas › tarefas | Três níveis | Mais poder, mais configuração; avaliar só se o onboarding real for grande |

**Regras já fixadas pelo Mapa (v1.1) que valem para qualquer opção:** etapa dependente não conclui fora de ordem sem autorização e justificativa; automações idempotentes; falha automática **não** marca etapa como concluída; mudar o template **não** altera onboardings em andamento (template versionado e imutável; a execução aponta para a versão usada).

**Informações que preciso do proprietário:** (1) o onboarding real da Zafira, etapa por etapa (a lista que a equipe usa hoje); (2) se há templates diferentes por serviço contratado ou por pacote (ex.: 8 ou 12 conteúdos); (3) quem aprova mudanças de template; (4) quais etapas têm automação (n8n).

## D3. Asana e onboarding — **APROVADA a substituição** (DEC-F7-003)

A v1.1 previa "criação assistida de … **projeto Asana**" como etapa de onboarding. Isso **contraria a DEC-ASANA-001** (Hub não cria nem altera projetos no Asana). Proposta: a etapa vira **"confirmar que o projeto foi criado no Asana e vinculá-lo ao cliente"** (vínculo local já existe). Se o proprietário quiser criação automática, é uma exceção que exige DEC própria; não será assumida.

## D4. Dependências técnicas e itens menores

| Item | Situação |
|---|---|
| Valor novo em `IntegrationProvider` (Calendar; n8n) e conexão por organização com credencial criptografada | A criar na F7 (migration ensaiada em base descartável) |
| Fuso da organização | Pronto (DEC-F6-005); eventos recorrentes devem usá-lo |
| Anexos de onboarding (documentos) | Decisão de storage de arquivos segue aberta (antes da F8); proposta: **somente links** na F7 |
| Lembretes e notificações | Pertencem à F14; na F7 apenas indicadores no painel do gestor |
| Gate de navegador da F7 | Calendar e n8n **simulados** (padrão do gate F6); sem conta real |

## D5. Sequência proposta quando o proprietário decidir

1. Registrar DEC da D1, D2 (e D3). 2. Microetapa F7-1: modelo de template/execução + regras (domínio e testes). 3. F7-2: execução e painel do gestor. 4. F7-3: conector Calendar (leitura) com vínculos. 5. F7-4: automações n8n idempotentes. 6. F7-5: Browser Gate e homologação.
