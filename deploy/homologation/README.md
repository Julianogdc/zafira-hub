# Pacote de Homologação e Deployment de Referência (Zafira Hub 2.1)

Este diretório contém a especificação técnica reproduzível e segura para o ambiente de homologação do **Zafira Hub 2.1**.

> [!IMPORTANT]
> **Planejamento de Endereço:** O subdomínio planejado para homologação física é `https://<subdominio-de-homologacao-dedicado>`.
> Este endereço **NÃO deve ser configurado nesta sessão**, permanecendo como planejamento dependente das etapas H7 e H8.

---

## 1. Estrutura do Pacote

- `docker-compose.reference.yml`: Arquivo de referência do Compose para homologação e ensaios locais de integração.
- `homologation.env.example`: Modelo de configuração e especificação das variáveis de ambiente obrigatórias para o runtime.

---

## 2. Princípios de Segurança e Isolamento

1. **Zero Credenciais Padrão:** Não existem senhas padrão ou strings de fallback inseguras (DEC-HML-009 / P12 resolvida). Se uma variável mandatória não for fornecida no ambiente, o Compose falha imediatamente (fail-closed).
2. **Isolamento de Rede:** Os serviços de banco de dados (`postgres`) e backend (`api`) não possuem portas expostas diretamente ao host ou à internet. A comunicação ocorre exclusivamente através da bridge interna privada `zafira-hub-hml-net`. O único ponto de entrada é o serviço `web` (Nginx), que atua como proxy reverso same-origin.
3. **Segurança de Autenticação e Cookies:** As sessões utilizam cookies assinados (`COOKIE_SECRET`), tokens JWT (`JWT_SECRET`) e flags de segurança estritas (`HttpOnly`, `Secure` e `SameSite=Lax/Strict`), prevenindo vazamento cross-site e interceptação.
4. **Armazenamento S3 Privado:** Conforme homologado na HM-2, HM-3 e HM-4a, o driver `local` é terminantemente proibido. O armazenamento deve utilizar `FILE_STORAGE_DRIVER=s3` apontando para bucket privado Cloudflare R2 via HTTPS, com credenciais dedicadas e validação SHA-256.
5. **Segregação de Segredos Criptográficos:** O `startup-validator` exige que `JWT_SECRET`, `COOKIE_SECRET`, `INTEGRATION_ENCRYPTION_KEY` e `APPROVAL_MEDIA_SECRET` sejam gerados de forma independente e com alta entropia, proibindo qualquer reutilização de segredos entre diferentes funções.
6. **Modo Desconectado Resiliente:** Conforme homologado na HM-4b, todas as integrações (`PUBLICATION_DISPATCH_ENABLED`, `PUBLICATION_METRICS_ENABLED`, `GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED`, `ASANA_MIRROR_SCHEDULE_ENABLED`, `N8N_DISPATCH_ENABLED`) devem iniciar desligadas (`false`). A API inicializa com segurança em `NODE_ENV=production` sem necessidade de endpoint remoto do BrightBean, garantindo zero chamadas de rede externas no boot e em repouso.
7. **Dados Exclusivamente Sintéticos (P28):** É expressamente proibido carregar dados reais de clientes, senhas reais ou tokens de terceiros no ambiente de homologação.

---

## 3. Mapeamento de Serviços para o EasyPanel / VPS

Caso a topologia final selecionada seja gerenciada pelo EasyPanel na VPS (avaliada na etapa H7), a correspondência dos serviços ocorre da seguinte forma:

| Serviço de Referência | Tipo no EasyPanel | Origem da Imagem | Configuração e Runtime |
| :--- | :--- | :--- | :--- |
| `postgres` | **Database (PostgreSQL)** | `postgres:16` | Base dedicada: `zafira_hub_21_staging` (nunca `zafira_hub_v2`) |
| `api` | **App (Docker Image)** | `ghcr.io/julianogdc/zafira-hub-api@sha256:...` | Porta 3001 privada (rede interna), injeção de secrets e S3 |
| `web` | **App (Docker Image)** | `ghcr.io/julianogdc/zafira-hub-web@sha256:...` | Porta 80 pública (roteada via HTTPS pelo Traefik/EasyPanel), `API_UPSTREAM=http://<api-service>:3001` |

---

## 4. Limites de Recursos Provisórios

> [!WARNING]
> **STATUS:** `NOT APPROVED — AGUARDANDO ETAPA H7 (EVIDÊNCIAS DE CAPACIDADE DA VPS)`
> Os limites abaixo são provisórios e para fins de modelagem preliminar. A decisão final de topologia e alocação de memória/CPU pertence à etapa H7.

- **Hub 2.1 API (Homologação):** `0.5 vCPU / 512 MiB RAM` (Soft: `384 MiB`, Hard: `512 MiB`)
- **Hub 2.1 Web (Homologação):** `0.25 vCPU / 128 MiB RAM` (Soft: `64 MiB`, Hard: `128 MiB`)
- **PostgreSQL Dedicado (Homologação):** `~256 MiB - 512 MiB RAM`

---

## 5. Sequência Técnica de Deploy e Migrations

1. **Validação de Imagens Imutáveis:** Validar os digests SHA-256 congelados no CI oficial (`scripts/homologation/validate-immutable-images.sh`).
2. **Validação de Alvo Seguro de Banco de Dados:** Confirmar que a base apontada é `zafira_hub_21_staging` e nunca a base de produção (`scripts/homologation/validate-database-target.sh`).
3. **Execução de Migrações (Prisma Migrate Deploy):** Aplicar as migrações através do container oficial publicado (`scripts/homologation/migrate.sh`).
4. **Conferência de Migrations:** Verificar a aplicação integral de todas as **35 migrações** do Prisma (`scripts/homologation/migration-status.sh`).
5. **Verificação de Permissões RBAC (P22):** Executar `npm run rbac:bootstrap --workspace=@zafira/api -- --check`. Se houver divergência, executar o bootstrap e confirmar saída 0 no check.
6. **Inicialização dos Serviços:** Subir os containers de API e Web com as variáveis de ambiente completas e validadas.
7. **Smoke Tests e Liveness:** Executar `scripts/homologation/smoke.sh` apontando para o endpoint de homologação, validando `GET /health`, `GET /health/database` e `GET /hub-api/health`.
