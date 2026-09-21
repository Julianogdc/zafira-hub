#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Execução de Migrations de Homologação via Imagem Docker por Digest
# Executa 'prisma migrate deploy' utilizando estritamente a imagem da API publicada
# sem usar código-fonte local do host.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Validação das referências e proteções
"${SCRIPT_DIR}/validate-immutable-images.sh"
"${SCRIPT_DIR}/validate-database-target.sh"

NETWORK_NAME="${HOMOLOG_NETWORK:-zafira-hub-hml-network}"

echo "[*] Executando 'prisma migrate deploy' no container da API..."
echo "[*] Imagem API: ${API_IMAGE_REF}"

docker run --rm \
  --network "${NETWORK_NAME}" \
  -e DATABASE_URL="${DATABASE_URL}" \
  "${API_IMAGE_REF}" \
  npm run prisma:migrate:deploy --workspace=@zafira/api

echo "[+] Migrations aplicadas com sucesso via container da API."
