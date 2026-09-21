# ADR-017: Prontidão de Infraestrutura e Diretrizes de Homologação (Hub 2.1)

## Status
Proposto / Pending Capacity Evidence

## Data
2026-09-21

## Contexto
Após o congelamento e publicação dos artefatos imutáveis de container no GHCR (ADR-016 / Passo 12D1B), é necessário estabelecer as diretrizes operacionais, critérios de isolamento e governança de capacidade para a implantação do ambiente de homologação do Zafira Hub 2.1.
A VPS atual opera com Ubuntu 24.04 (aproximadamente 2 vCPU, 8 GB RAM, 4 GB swap) hospedando a produção do Hub 2.0 e a instância do Postiz (envolvida em processo de auditoria/Meta).
Conforme a Seção 4.6 e o Portão da Fase 0/1 do Mapa Mestre, nenhuma topologia física de homologação pode ser implantada sem evidência de capacidade e isolamento estrito da produção.

## Decisões Propostas

1. **Isolamento Lógico e Físico de Homologação**: O ambiente de homologação do Hub 2.1 deve operar de forma 100% isolada da produção.
2. **Autoridade por Digest Criptográfico**:
   - Todo deployment de homologação exige referências imutáveis `ghcr.io/...@sha256:...`.
   - É proibido o uso de `latest` ou tags mutáveis em homologação.
3. **Isolamento Estrito de Banco de Dados**:
   - O ambiente de homologação utiliza banco de dados dedicado (ex: `zafira_hub_21_staging`).
   - É terminantemente proibido conectar o ambiente de homologação ao banco de dados `zafira_hub_v2` de produção.
   - Migrações em homologação são executadas exclusivamente via `prisma migrate deploy`.
4. **Isolamento Total de Credenciais e Segredos**: Segredos de homologação (`COOKIE_SECRET`, `JWT_SECRET`, `HUB_INTERNAL_API_KEY`, etc.) devem ser gerados de forma independente, sem reutilização de valores de produção.
5. **Preservação Incondicional da Produção e do Postiz**:
   - Nenhuma instância em produção (Hub 2.0 ou Postiz) pode ser desativada, reiniciada ou sacrificada para acomodar homologação.
6. **Governança de Capacidade da VPS**:
   - A topologia definitiva de homologação depende de evidência observacional de aproximadamente 7 dias (ou dados consolidados equivalentes) para confirmar disponibilidade de RAM e CPU.
   - Limites de CPU e RAM por serviço (`api`, `web`, `postgres`) devem ser formalmente estabelecidos antes da ativação.
7. **Consideração dos Limites do EasyPanel**: A política do EasyPanel (limite conhecido de projetos) deve ser respeitada sem violar o isolamento de domínios e redes.
8. **Estratégia de Rollback Atômico**: Qualquer reversão em homologação é efetuada apontando a referência do container para um digest anterior previamente testado e aprovado.

## Consequências
- A homologação não oferecerá riscos de concorrência, sobrecarga ou corrupção aos dados de produção.
- A decisão final de topologia (Projeto dedicado vs. Serviços dedicados em projeto existente vs. Compose isolado) permanece pendente da coleta do snapshot de capacidade da VPS.
