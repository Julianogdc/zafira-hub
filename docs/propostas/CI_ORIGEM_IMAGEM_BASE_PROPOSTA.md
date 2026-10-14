# Proposta: origem alternativa das imagens-base do CI (2026-10-13, DEC-F8-024)

> **Situação:** proposta para decisão da Direção. **Nenhuma alteração feita.** Mudança de infraestrutura do CI: só com autorização.

## 1. Problema
O CI baixa as imagens-base do **registro público da Amazon (ECR Public)** sem autenticação. Em 2026-10-13 o download falhou por limite de uso (**`429 Too Many Requests` / `Data limit exceeded`**) em três momentos: PostgreSQL de serviço (run 38443270005), Docker Build da API (run 38496406502, tentativas 1 e 2) e Publish Images (mesmo run, tentativa 3, em que o Docker Build passou). O limite anônimo do ECR Public é contado por endereço de origem, e os runners padrão do GitHub compartilham endereços — por isso a falha é intermitente e não depende do código.

Imagens afetadas (todas de `public.ecr.aws/docker/library/…`, espelho das imagens oficiais do Docker Hub):
| Uso | Imagem |
|---|---|
| `apps/api/Dockerfile` | `node:24.12.0-bookworm-slim` |
| `apps/web/Dockerfile` (build) | `node:24.12.0-alpine` |
| `apps/web/Dockerfile` (servidor) | `nginx:alpine` |
| CI: serviço PostgreSQL e ensaio de homologação | `postgres:16` |

## 2. Opções
| | **A. Espelho próprio no GHCR (recomendado)** | **B. Docker Hub oficial com conta** | **C. ECR Public autenticado** | **D. Só nova tentativa** |
|---|---|---|---|---|
| Como | copiar **uma vez** cada imagem, **fixada por digest**, para `ghcr.io/julianogdc/base-*` (pacote público); os Dockerfiles e o workflow passam a usar o espelho por digest | trocar para `docker.io/library/…` por digest e autenticar com conta do Docker Hub | autenticar no ECR Public com credencial da AWS | manter tudo e reexecutar quando falhar |
| Limite | o CI já baixa/publica no GHCR com o token do próprio GitHub (`GITHUB_TOKEN`); sem o limite anônimo do ECR | conta gratuita: limite maior, mas ainda existe | limite bem maior | o mesmo de hoje |
| Segurança | digest fixo = mesmo conteúdo verificado; nós controlamos o espelho; atualização é um passo explícito e revisável | digest fixo; depende de um segredo novo (token do Docker Hub) | segredo novo (AWS) e conta de nuvem | sem mudança |
| Custo | **zero** (pacotes públicos no GHCR não são cobrados; runners padrão) | zero na conta gratuita; um segredo a guardar | conta AWS (pode gerar custo) | zero, mas runs perdidos |
| Credenciais | nenhuma nova | nova (token Docker Hub) | nova (AWS) | nenhuma |
| Manutenção | atualizar o espelho quando trocar a versão (workflow manual de cópia, por digest) | trocar digest | trocar digest | nenhuma |
| Risco | baixo; primeira cópia precisa do ECR/Docker Hub uma vez (pode ser repetida até passar) | médio (segredo) | médio/alto (segredo + custo) | falhas intermitentes continuam |

## 3. Recomendação: opção A
1. Workflow **manual** (`workflow_dispatch`) no repositório público que copia cada imagem pelo **digest** atual para o GHCR (`docker buildx imagetools create` ou `crane copy`), confere que o digest do destino é **idêntico** ao da origem e publica como pacote público.
2. Trocar as quatro referências (`apps/api/Dockerfile`, `apps/web/Dockerfile` ×2, serviço PostgreSQL do workflow) para `ghcr.io/julianogdc/base-…@sha256:<digest>`; login no GHCR antes do build (já existe no Publish Images; acrescentar no Docker Build e no ensaio).
3. Registrar os digests e a data da cópia; atualização de versão = rodar o workflow de cópia e trocar os digests num commit revisável.
4. Validar com **um** CI oficial completo.

**Impacto técnico:** quatro linhas de imagem e um passo de login; nenhum código da aplicação muda; imagens idênticas byte a byte (mesmo digest). **Segurança:** melhora (digest fixo, origem sob nosso controle, nenhum segredo novo). **Custo:** nenhum.

## 4. O que fica fora
Runners pagos, VPS, produção e credenciais novas. A F8-4a só é aceita depois de um CI 5/5.
