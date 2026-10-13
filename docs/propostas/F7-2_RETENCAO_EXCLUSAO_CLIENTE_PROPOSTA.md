# F7-2 — Pendência P28: exclusão de cliente, retenção e histórico de onboarding

> **Status: PROPOSTA para revisão da Direção. Nada foi alterado.** O comportamento atual de exclusão **não** muda sem revisão (DEC-F7-009).
> **Bloqueia** o uso de dados reais em homologação ou produção (junto com P22).

## 1. Problema
A migration da F7-2a liga `onboarding_executions.clientId` ao cliente com `ON DELETE CASCADE`. Excluir **definitivamente** um cliente apaga, em cascata, execuções, etapas e eventos — inclusive o histórico auditável. Os gatilhos protegem contra `DELETE` direto na tabela, mas **permitem** a remoção quando o cliente (ou a organização) já não existe, justamente para a cascata funcionar.

## 2. Três situações distintas (proposta)

| Situação | Quem/como | Efeito no histórico |
|---|---|---|
| **A. Arquivar / desativar cliente** | Ação normal da carteira (status do cliente) | **Preserva tudo.** Execuções ativas continuam (ou o gestor as encerra antes); histórico segue consultável e filtrável. É o caminho padrão. |
| **B. Exclusão definitiva controlada** | Fluxo explícito, só `ADMIN`, nova permissão (ex.: `clients.purge`), cliente já **arquivado**, sem execução `ACTIVE`, após **janela de retenção** e sem **retenção legal** marcada | **Anonimiza o titular** (nome, documento, contatos, anotações) e **mantém** o histórico operacional sem dado pessoal ("cliente removido #abc123"). Remoção física do histórico só ao fim de um prazo de retenção definido pela Direção. Tudo auditado. |
| **C. Exclusão administrativa de organização** | Operação de plataforma (não pela API de produto), com backup e autorização expressa | Cascata total é aceitável (organização inteira deixa de existir); registrar em log **fora** da organização, com contagens (dry-run) antes de executar. |

## 3. Mudanças técnicas propostas (não aplicadas)
1. `onboarding_executions → clients`: trocar `CASCADE` por `NO ACTION DEFERRABLE INITIALLY DEFERRED`. Excluir um cliente com histórico passa a **falhar** por padrão. A cascata de **organização** continua (a FK `organizationId` segue em `CASCADE`).
2. Exclusão definitiva (B) = procedimento único no servidor, em transação: valida pré-condições, anonimiza o cliente, grava evento de auditoria fora do escopo do cliente e **só então** libera a remoção física quando a retenção vencer (job administrativo, desligado por padrão).
3. O gatilho de proteção passa a aceitar a remoção do histórico **somente** dentro desse procedimento (variável de sessão local à transação) ou quando a organização não existe.
4. Testes: cliente com histórico não pode ser apagado direto; arquivar preserva; procedimento B anonimiza e mantém contagens; organização inexistente continua removendo em cascata; tentativa fora do procedimento é barrada.

## 4. Decisões que preciso da Direção (bloqueiam a implementação)
| # | Decisão | Padrão sugerido |
|---|---|---|
| R1 | Prazo de retenção do histórico após anonimização | 5 anos (ajustável; confirmar com a assessoria jurídica) |
| R2 | Anonimizar e manter histórico, ou apagar tudo ao fim da retenção | Anonimizar e manter; apagar só ao fim do prazo |
| R3 | Quem pode executar a exclusão definitiva | Apenas `ADMIN`, com confirmação reforçada e justificativa |
| R4 | Retenção legal ("legal hold") por cliente | Sim: marca que bloqueia anonimização e remoção |
| R5 | Pedido do titular (LGPD): fluxo e prazo de resposta | Registrar pedido, anonimizar (B) e responder em 15 dias |

## 5. Fatiamento
Proposta de uma fatia própria, **antes** de qualquer dado real: migration (FK + gatilho + campos de retenção), procedimento, testes de integração. **Não** faz parte da F7-2b.
