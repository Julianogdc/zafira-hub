#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Verificação de Status de Migrations via Imagem Docker por Digest
# Executa 'prisma migrate status' utilizando estritamente a imagem da API publicada.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Validação das referências e proteções
"${SCRIPT_DIR}/validate-immutable-images.sh"
"${SCRIPT_DIR}/validate-database-target.sh"

NETWORK_NAME="${HOMOLOG_NETWORK:-zafira-hub-hml-network}"

echo "[*] Verificando status das migrations no container da API..."
echo "[*] Imagem API: ${API_IMAGE_REF}"

docker run --rm \
  --network "${NETWORK_NAME}" \
  -e DATABASE_URL="${DATABASE_URL}" \
  "${API_IMAGE_REF}" \
  npm run prisma:migrate:status --workspace=@zafira/api

echo "[+] Verificação de status de migrations concluída."
