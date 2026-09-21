#!/usr/bin/env bash
# ==============================================================================
# ZAFIRA HUB 2.1 — VALIDADOR DE IMAGENS IMUTÁVEIS POR DIGEST
# ==============================================================================

set -euo pipefail

API_REF="${1:-${API_IMAGE_REF:-}}"
WEB_REF="${2:-${WEB_IMAGE_REF:-}}"

echo "==> Validando referências de imagens de homologação..."

if [ -z "$API_REF" ]; then
    echo "ERRO: API_IMAGE_REF não foi informada ou está vazia." >&2
    exit 1
fi

if [ -z "$WEB_REF" ]; then
    echo "ERRO: WEB_IMAGE_REF não foi informada ou está vazia." >&2
    exit 1
fi

DIGEST_REGEX="^ghcr\.io/[a-zA-Z0-9_\-]+/zafira-hub-(api|web)@sha256:[a-f0-9]{64}$"

# Validação da API
if ! echo "$API_REF" | grep -Eq "$DIGEST_REGEX"; then
    echo "ERRO: Referência da API '$API_REF' é inválida ou mutável." >&2
    echo "      Formato obrigatório: ghcr.io/<org>/zafira-hub-api@sha256:<64 hex>" >&2
    exit 1
fi

# Validação do Web
if ! echo "$WEB_REF" | grep -Eq "$DIGEST_REGEX"; then
    echo "ERRO: Referência do Web '$WEB_REF' é inválida ou mutável." >&2
    echo "      Formato obrigatório: ghcr.io/<org>/zafira-hub-web@sha256:<64 hex>" >&2
    exit 1
fi

# Rejeições explícitas de tags mutáveis
for ref in "$API_REF" "$WEB_REF"; do
    if echo "$ref" | grep -Eq ':(latest|stable|hub-2\.1|production|main|dev)$'; then
        echo "ERRO: Tag mutável detectada em '$ref'. É obrigatório o uso de digest sha256." >&2
        exit 1
    fi
done

echo "SUCESSO: Ambas as referências de imagem são imutáveis e seguem o padrão por digest SHA256."
echo "API: $API_REF"
echo "Web: $WEB_REF"
