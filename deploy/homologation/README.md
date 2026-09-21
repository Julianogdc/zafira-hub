# Pacote de Homologação e Deployment de Referência (Hub 2.1)

Este diretório contém a especificação de deployment reproduzível para o ambiente de homologação do Zafira Hub 2.1.

## Estrutura do Pacote

- `docker-compose.reference.yml`: Arquivo de referência para execução de ensaios locais e testes de integração de container no CI.
- `homologation.env.example`: Modelo de configuração e injeção de variáveis de ambiente seguras para o runtime.

---

## Mapeamento de Serviços para o EasyPanel

Caso a topologia final selecionada seja gerenciada pelo EasyPanel na VPS (Opções A ou B do documento `homologation-readiness.md`), a correspondência dos serviços ocorre da seguinte forma:

| Serviço de Referência | Tipo no EasyPanel | Origem da Imagem | Configuração / Runtime |
| :--- | :--- | :--- | :--- |
| `postgres` | **Database (PostgreSQL)** | `postgres:16` | Base dedicada: `zafira_hub_21_staging` |
| `api` | **App (Docker Image)** | `ghcr.io/julianogdc/zafira-hub-api@sha256:...` | Porta 3001, injeção de `DATABASE_URL`, `COOKIE_SECRET`, `JWT_SECRET` |
| `web` | **App (Docker Image)** | `ghcr.io/julianogdc/zafira-hub-web@sha256:...` | Porta 80 (mapeada com domínio HTTPS), `API_UPSTREAM=http://<api-service-name>:3001` |

---

## Limites de Recursos Provisórios

> [!IMPORTANT]
> **STATUS:** `NOT APPROVED — SUBJECT TO CAPACITY EVIDENCE`
> Os limites abaixo são provisórios para dimensionamento e aguardam consolidação da janela de observação da VPS.

- **API Staging:** `0.5 vCPU / 512 MiB RAM`
- **Web Staging:** `0.25 vCPU / 128 MiB RAM`
- **PostgreSQL Staging Overhead:** `~256 MiB - 512 MiB RAM`

---

## Mecânica de Deploy e Migrations

1. Validar referências imutáveis (`scripts/homologation/validate-immutable-images.sh`).
2. Validar que o banco de dados NÃO é o de produção (`scripts/homologation/validate-database-target.sh`).
3. Executar as migrações através do container oficial publicado (`scripts/homologation/migrate.sh`).
4. Verificar o status de aplicação das 14 migrações (`scripts/homologation/migration-status.sh`).
5. Instanciar os serviços e executar o smoke test de conectividade (`scripts/homologation/smoke.sh`).
