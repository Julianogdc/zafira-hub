# ADR-016: Publicação de Artefatos de Container Imutáveis e Versionados (Hub 2.1)

## Status
Aceito

## Data
2026-09-21

## Contexto
Na Fase 1 (Fundação), após a validação completa de testes de domínio, testes de unidade, typechecks estritos, integração PostgreSQL real e container smoke local com reverse proxy (Passos 12D0, 12D1A e 12D1A.2), é necessário formalizar o processo de publicação de artefatos executáveis para deployment de homologação e produção.
O uso de tags mutáveis (como `latest` ou nomes de branch) traz riscos operacionais de sobreposição de versões, falta de reprodutibilidade e impossibilidade de rollbacks auditáveis e atômicos.

## Decisões

1. **Registry Oficial**: O GitHub Container Registry (`ghcr.io`) é o registry padrão e canônico de imagens do Zafira Hub 2.1.
2. **Imagens Independentes**:
   - API: `ghcr.io/julianogdc/zafira-hub-api`
   - Web: `ghcr.io/julianogdc/zafira-hub-web`
3. **Vínculo com Git SHA e OCI Labels**: Toda imagem publicada é estritamente vinculada ao commit SHA do repositório através de anotações e labels OCI padronizadas (`org.opencontainers.image.source` e `org.opencontainers.image.revision`).
4. **Tags como Aliases de Proveniência**: As tags publicadas utilizam convenção única baseada em Git SHA e Run ID (ex: `git-${GITHUB_SHA}-run-${GITHUB_RUN_ID}`) servindo exclusivamente como identificadores humanos de rastreabilidade.
5. **Autoridade Imutável por DIGEST SHA256**:
   - A referência canônica e imutável oficial para qualquer deployment é o **DIGEST sha256** da imagem (`image@sha256:...`).
   - Tags mutáveis como `latest`, `stable` ou `production` não são utilizadas como mecanismo operacional de deployment.
6. **Deploy e Rollback Determinísticos**: Homologação e produção realizam pull e instanciam containers exclusivamente via `image@sha256:...`. Processos de rollback consistem em apontar o orchestrator para o digest exato previamente homologado e auditado, sem reconstrução de artefatos.
7. **Independência de Segredos em Build Time**: As imagens são construídas sem conhecer ou embutir segredos, credenciais reais ou configurações de rede específicas de ambiente.
8. **Condição de Publicação Estrita**: A publicação no GHCR ocorre apenas após aprovação com sucesso dos três gates anteriores da Fundação:
   - `quality` (Code Quality and Tests)
   - `postgres-integration` (PostgreSQL Integration Gate)
   - `docker-build` (Docker Build Gate & Local Container Smoke)
9. **Escopo Operacional**:
   - Este passo formaliza a publicação e validação dos artefatos publicados via pull e smoke test por digest no CI.
   - O processo de pull, configuração de runtime e deploy na VPS/EasyPanel pertence estritamente ao Passo 12D1C.
   - O provisionamento de credenciais de pull externo para a VPS/EasyPanel será tratado na etapa de deploy.

## Consequências
- Total rastreabilidade entre o código-fonte auditado no GitHub e as imagens em execução.
- Garantia de imutabilidade criptográfica nos ambientes de homologação e produção.
- Rollback instantâneo e seguro sem dependência de builds subsequentes.
