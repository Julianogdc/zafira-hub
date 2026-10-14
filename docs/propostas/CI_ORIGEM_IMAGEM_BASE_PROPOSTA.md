# Proposta: origem alternativa das imagens-base do CI (2026-10-13, DEC-F8-024)

> **Situação:** **opção A aprovada (DEC-F8-025) e implementada** — ver §5.

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

## 5. Implementação (2026-10-14, DEC-F8-025)

Opção A implementada. Workflow manual `.github/workflows/mirror-base-images.yml` (`workflow_dispatch`, permissões `contents: read` + `packages: write`, token do próprio workflow; no máximo 2 origens × 2 tentativas, sem repetição indefinida) executado uma vez: run 38503699296 (https://github.com/Julianogdc/zafira-hub/actions/runs/38503699296), origem Docker Hub, **sem 429**. Cópia com `skopeo copy --all --preserve-digests` (todas as arquiteturas, inclusive atestados); equivalência verificada no índice **e** em cada manifesto de plataforma (digest do destino = digest da origem; **não houve conversão de manifesto**); acesso **anônimo** aos três pacotes confirmado no workflow e de fora do GitHub.

| Imagem oficial | Espelho (pacote público) | Digest (índice multi-arquitetura) | Uso |
|---|---|---|---|
| `node:24.12.0-bookworm-slim` | `ghcr.io/julianogdc/base-node:24.12.0-bookworm-slim` | `sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99` | `apps/api/Dockerfile` |
| `node:24.12.0-alpine` | `ghcr.io/julianogdc/base-node:24.12.0-alpine` | `sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8` | `apps/web/Dockerfile` (build) |
| `nginx:alpine` | `ghcr.io/julianogdc/base-nginx:alpine` | `sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2` | `apps/web/Dockerfile` (servidor) |
| `postgres:16` | `ghcr.io/julianogdc/base-postgres:16` | `sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d` | serviço do PostgreSQL Integration Gate e ensaio de homologação |

Os digests são os mesmos no Docker Hub e no registro público da Amazon (versões preservadas). A tag `nginx:alpine` era móvel: passa a ficar fixada no digest acima (atualização = rodar o workflow de cópia e trocar o digest em commit revisável). As referências usam `imagem:tag@digest` (o digest prevalece). O serviço PostgreSQL do Actions é baixado antes dos passos e funciona **sem login** porque o pacote é público. `deploy/homologation/docker-compose.reference.yml` (referência de implantação, fora do CI) não foi alterado.

**Resultado:** CI oficial **5/5** no run 38561948692 (https://github.com/Julianogdc/zafira-hub/actions/runs/38561948692), sem 429. **Custo:** zero (pacotes públicos no GHCR, runners padrão `ubuntu-latest`, 0 ms faturáveis, nenhuma credencial nova).
