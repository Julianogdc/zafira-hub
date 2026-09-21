# Plano de Prontidão de Infraestrutura e Homologação (Hub 2.1)

## 1. Artifact Baseline (Artefatos Oficiais Congelados)

- **Commit Base (Passo 12D1B):** `3a37fa3a29a4e6bf412c3b0303795b037421ff46`
- **Workflow Run Aprovado:** `35603022481`
- **API Immutable Reference:**
  `ghcr.io/julianogdc/zafira-hub-api@sha256:945e08e705aa34fa032081c9127988210290a0b4844dce286a6f70881791cb87`
- **Web Immutable Reference:**
  `ghcr.io/julianogdc/zafira-hub-web@sha256:ae653b585e9e90aa63fcda7f0581d0971acc4009a2571d94b8025c8aa7b7dda2`

---

## 2. VPS Baseline

- **Sistema Operacional:** Ubuntu 24.04 LTS (x86_64 / Linux)
- **Recursos Físicos Conhecidos:**
  - CPU: ~2 vCPUs
  - Memória RAM: ~8 GB
  - Swap: ~4 GB
- **Ambiente de Orquestração:** EasyPanel / Docker Engine
- **Restrições Relevantes:**
  - Limite de 3 projetos no EasyPanel na licença/configuração atual.
  - Instância do Postiz em produção ativa e sob processo de homologação Meta.
  - Instância do Zafira Hub 2.0 em produção ativa e inviolável.

---

## 3. Current EasyPanel Topology (Auditoria Manual)

Checklist estruturado para preenchimento após execução da inspeção manual:

| Projeto | Serviço | Tipo | Imagem / Build | Limite CPU | Limite RAM | Portas | Domínio | Status / Health | Banco Associado | Crítico? | Pode Parar? | Justificativa |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| *Produção* | Hub 2.0 API | App | Node API | *Pendente* | *Pendente* | 3001 | *.easypanel.host | Healthy | zafira_hub_v2 | SIM | **NÃO** | Produção em uso ativo |
| *Produção* | Hub 2.0 Web | App | Nginx/SPA | *Pendente* | *Pendente* | 80 | *.easypanel.host | Healthy | - | SIM | **NÃO** | Interface de produção |
| *Postiz* | Postiz App | App | Postiz | *Pendente* | *Pendente* | 5000 | *.easypanel.host | Healthy | postiz_db | SIM | **NÃO** | Auditoria Meta ativa |
| *Postiz* | Postiz Redis | Database | Redis 7 | *Pendente* | *Pendente* | 6379 | - | Healthy | - | SIM | **NÃO** | Fila do Postiz |
| *Database* | PostgreSQL | Database | Postgres 16 | *Pendente* | *Pendente* | 5432 | - | Healthy | v2 / postiz | SIM | **NÃO** | Dados vitais |

*(Nenhum segredo ou credencial deve constar nesta tabela).*

---

## 4. Capacity Evidence (Plano de Observação de 7 Dias)

Conforme a Seção 4.6 do Mapa Mestre, a capacidade da VPS deve ser atestada através de coletas regulares antes de liberar o deploy físico:

- **Frequência de Amostragem:** 2 a 3 coletas diárias:
  1. Manhã (~09:00 - início da operação)
  2. Tarde (~14:30 - horário de pico/publicações Postiz)
  3. Noite (~21:00 - horário de consolidação/idle)
- **Método de Coleta:** Execução não-intrusiva do script `scripts/infra/vps-capacity-snapshot.sh` na console da VPS.
- **Registro:** Preenchimento da tabela em `docs/operations/templates/vps-capacity-observation.md`.

---

## 5. Proposed Service Limits (PROVISIONAL LIMITS — NOT APPROVED)

> [!WARNING]
> Limites provisórios para modelagem. A aprovação final depende da análise das evidências de capacidade coletadas na VPS.

- **Hub 2.1 API (Homologação):**
  - CPU Limit: `0.5 vCPU` (500m)
  - Memory Limit: `512 MB` (Soft: `384 MB`, Hard: `512 MB`)
- **Hub 2.1 Web (Homologação):**
  - CPU Limit: `0.25 vCPU` (250m)
  - Memory Limit: `128 MB` (Soft: `64 MB`, Hard: `128 MB`)
- **PostgreSQL Homologação (banco dedicado na instância compartilhada ou container isolado):**
  - Memory Overhead Estimado: `256 MB - 512 MB`

---

## 6. Upgrade Triggers (Critérios Provisórios de Alerta/Upgrade)

Gatilhos para pausar homologação ou recomendar expansão de hardware da VPS (ex: upgrade para 4 vCPU / 16 GB RAM):

1. **RAM Disponível Sustentada:** `available RAM < 1.0 GB` por mais de 30 minutos em horário comercial.
2. **Utilização de Swap:** Swap em crescimento contínuo ultrapassando `2.0 GB` com I/O wait elevado.
3. **OOM Kills:** Qualquer evento de Out-Of-Memory registrado no `dmesg` ou restart não programado de container.
4. **CPU Sustentada:** Utilização de CPU total da VPS sustentada acima de `85%` por mais de 15 minutos sem tarefas em lote conhecidas.
5. **Espaço em Disco:** Utilização de disco em `/` ou `/var/lib/docker` superior a `80%`.

---

## 7. GHCR Access Strategy (Estratégia de Pull)

Para que o orquestrador (EasyPanel / Docker da VPS) baixe as imagens privadas do GHCR:

- **Opção 1 (Recomendada):** Token de Leitura Estrito (GitHub Personal Access Token - Fine-grained) com permissão exclusiva `packages:read` sobre o repositório `julianogdc/zafira-hub`.
- **Opção 2:** Pacotes públicos no GHCR (a avaliar governança no 12D1C).
- **Regra de Segurança:** Zero permissões administrativas ou de escrita no token utilizado na VPS.

---

## 8. Database Isolation (Contrato do Banco de Homologação)

- **Regra Inegociável:** NUNCA utilizar a base de dados `zafira_hub_v2` de produção.
- **Identificação do Banco:** `zafira_hub_21_staging` (ou nome equivalente dedicado).
- **Usuário e Permissões:** Usuário PostgreSQL dedicado com acesso estritamente restrito ao schema/database de homologação.
- **Execução de Migrações:** Aplicadas de forma atômica via `prisma migrate deploy` antes de rotear tráfego.

---

## 9. Homologation Topology Candidates (Candidatos de Topologia)

### Opção A: Serviços de Homologação em Projeto EasyPanel Existente
- **Conceito:** Adicionar os serviços `hub21-api-hml`, `hub21-web-hml` dentro do projeto existente, usando portas/domínios dedicados.
- **Vantagens:** Não consome cota adicional de projetos no EasyPanel; reutiliza rede interna do Postgres.
- **Desvantagens:** Compartilhamento visual do painel do projeto; exige atenção extra no isolamento de nomes de serviço.

### Opção B: Novo Projeto Dedicado no EasyPanel (`zafira-hub-staging`)
- **Conceito:** Criar um projeto EasyPanel isolado para abrigar a stack 2.1.
- **Vantagens:** Isolamento visual, organizacional e de variáveis total.
- **Desvantagens:** Consome 1 slot do limite de 3 projetos do EasyPanel.

### Opção C: Docker Compose Externo
- **Conceito:** Subir a stack 2.1 via Docker Compose diretamente no host, fora do EasyPanel.
- **Vantagens:** Zero impacto na cota do EasyPanel.
- **Desvantagens:** Perda da gestão visual do EasyPanel; necessita gerenciar certificados SSL/reverse proxy Nginx global manualmente.

*(A escolha da opção será decidida no Passo 12D1C com base nas evidências de capacidade).*

---

## 10. Rollback Plan (Plano de Reversão de Homologação)

1. **Rollback de Aplicação:** Caso a nova versão apresente falha, reverter a referência do container no EasyPanel/Docker diretamente para o digest SHA256 anterior validado.
2. **Rollback de Banco:** Manter snapshots do banco de staging antes de cada execução de migration; reversão através de restauração de dump em base descartável.
3. **Zero Impacto em Produção:** O rollback de homologação é 100% contido e não afeta o Hub 2.0 ou o Postiz.

---

## 11. Deployment Checklist (Checklist Pré-Deploy 12D1C)

- [ ] Evidências de capacidade da VPS coletadas e aprovadas pelo Chat de Direção.
- [ ] Topologia de homologação oficialmente selecionada.
- [ ] Referências imutáveis de API e Web congeladas.
- [ ] Autenticação GHCR configurada no EasyPanel/Docker com permissão somente leitura.
- [ ] Banco `zafira_hub_21_staging` criado e isolado.
- [ ] Segredos de homologação gerados (`COOKIE_SECRET`, `JWT_SECRET`, `HUB_INTERNAL_API_KEY`).
- [ ] `prisma migrate deploy` executado com sucesso nas 14 migrações.
- [ ] Containers instanciados com limites de CPU/RAM configurados.
- [ ] Healthchecks validados (`GET /health` = 200, `GET /health/database` = 200, `GET /` = 200).
- [ ] Reverse proxy same-origin (`GET /hub-api/health` = 200) operacional.
- [ ] HTTPS configurado e certificado válido.
- [ ] Login e sessão HTTP-only testados com 2 organizações distintas.

---

## 12. Evidence Still Missing (Pendências para o Fechamento do Portão)

- [ ] Snapshot inicial de capacidade da VPS (via script `vps-capacity-snapshot.sh`).
- [ ] Amostra de observações de consumo de RAM/CPU em horário operacional.
- [ ] Inventário formal dos 3 projetos existentes do EasyPanel.
- [ ] Confirmação de disponibilidade de pelo menos 1.5 GB de RAM livre/buffer para homologação.
