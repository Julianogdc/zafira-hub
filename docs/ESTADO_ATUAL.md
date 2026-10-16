# Zafira Hub 2.1 — Estado Atual (derivado público saneado)

A governança integral e a trilha de correspondência de commits ficam no repositório privado. Este documento não substitui essa fonte nem autoriza publicações.

| Campo | Valor |
|---|---|
| Última atualização | 2026-10-16 — Codex — preparação local CI-PUB-PREP / DEC-CI-003 |
| **Sessão ativa** | nenhuma |
| Branch | hub-2.1 |
| Baseline pública da aplicação | 4feacac95b474d980f94d74912c8207462f221eb, histórica, preservada |
| Baseline pública do pacote | e547ff2, histórica, preservada; escopo deploy/homologation/ |
| Base desta preparação | 73b42c6346412849e9127fd8d0347583c5030f9a |
| Candidata | HEAD local preparado, não publicado, sem aceite; SHA/manifesto exatos apresentados na governança privada |
| CI | Nenhuma rodada nova; run histórico 38747057275/4feacac não valida esta candidata |

## Posição e próxima ação

F7 concluída funcionalmente com ressalvas; F8 implementada em incrementos, portão final aberto. Homologação sintética em preparação: H4-B.1/B.2 aceitas com ressalva histórica de CI na governança oficial, H4-B.3 candidata pendente. H4-B.4 somente planejada. F9–F18 pendentes conforme Mapa. Não antecipar etapas dependentes.

Esta candidata agrega orquestrador e módulos sintéticos iniciais 01–04 com teste existente, e o protótipo de coordenação somente leitura/simulação com seus testes e pontes. Nenhuma funcionalidade nova de produto, schema/migration, pacote, provedor ou infraestrutura. Guarda fail-closed exige opt-in, alvo local descartável e configuração explícita; importar módulo não conecta ao banco. Não executar seed físico nesta preparação.

Preparação local autorizada; **publicação, imagens e CI ainda não autorizados**. Próximo passo: revisar evidências/manifesto/SHA concretos na governança privada e obter decisão do proprietário antes de conectar remote ou publicar. Cinco jobs e gates pertinentes continuam obrigatórios; testes PostgreSQL locais são evidência separada e não equivalem a CI. Sem avanço automático de baseline ou aceite do HEAD inteiro por escopos não testados.

## Limites

Uma sessão modificadora por vez. Sem ações reais, credenciais/dados reais, custos, deploy, alteração de visibilidade/permissões, acesso a ambiente real ou ativação de agentes/escrita automática. Governança completa, contextos/logs locais e relatórios reservados ficam privados. Preservar guardas/saneamentos públicos e histórico. Seguir integralmente AGENTS.md.
