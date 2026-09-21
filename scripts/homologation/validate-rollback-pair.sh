#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Validação de Par de Rollback (Imagens Imutáveis por Digest)
# Valida se os pares CURRENT e ROLLBACK seguem rigorosamente o formato de digest sha256.
# Não executa deploy, apenas valida o contrato dos artefatos.
# ==============================================================================

CURRENT_API="${CURRENT_API_REF:-${1:-}}"
CURRENT_WEB="${CURRENT_WEB_REF:-${2:-}}"
ROLLBACK_API="${ROLLBACK_API_REF:-${3:-}}"
ROLLBACK_WEB="${ROLLBACK_WEB_REF:-${4:-}}"

DIGEST_REGEX="^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$"

validate_ref() {
  local label="$1"
  local ref="$2"

  if [ -z "${ref}" ]; then
    echo "[-] ERRO: ${label} está vazia ou não foi informada." >&2
    return 1
  fi

  if [[ ! "${ref}" =~ ${DIGEST_REGEX} ]]; then
    echo "[-] ERRO: ${label} ('${ref}') não é uma referência imutável válida por digest sha256." >&2
    echo "[-] Formato exigido: ghcr.io/<owner>/<repo>@sha256:<64_hex_chars>" >&2
    return 1
  fi

  echo "[+] ${label} aprovada: ${ref}"
  return 0
}

echo "[*] Validando conjunto de referências para Rollback..."

validate_ref "CURRENT_API_REF" "${CURRENT_API}"
validate_ref "CURRENT_WEB_REF" "${CURRENT_WEB}"
validate_ref "ROLLBACK_API_REF" "${ROLLBACK_API}"
validate_ref "ROLLBACK_WEB_REF" "${ROLLBACK_WEB}"

echo "[+] Todas as referências de imagem (atual e rollback) são imutáveis e válidas."
