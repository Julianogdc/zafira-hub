#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Smoke Test de Homologação / Rehearsal
# Testa a conectividade same-origin da Web, reverse proxy /hub-api,
# healthchecks da API, readiness do banco e proteção da rota de métricas.
# ==============================================================================

WEB_BASE_URL="${WEB_BASE_URL:-${1:-http://127.0.0.1:8082}}"
HUB_INTERNAL_API_KEY="${HUB_INTERNAL_API_KEY:-}"

echo "[*] Iniciando smoke tests contra: ${WEB_BASE_URL}"

# 1. Teste da raiz Web (GET / => 200)
echo "[*] Testando GET / ..."
ROOT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${WEB_BASE_URL}/")
if [ "${ROOT_STATUS}" -ne 200 ]; then
  echo "[-] FALHA: GET / retornou HTTP ${ROOT_STATUS} (esperado 200)" >&2
  exit 1
fi
echo "[+] GET / => 200 OK"

# 2. Teste do Liveness via Reverse Proxy (GET /hub-api/health => 200 com status ok)
echo "[*] Testando GET /hub-api/health ..."
HEALTH_BODY=$(curl -s "${WEB_BASE_URL}/hub-api/health")
if ! echo "${HEALTH_BODY}" | grep -q '"status":"ok"'; then
  echo "[-] FALHA: GET /hub-api/health não retornou status ok. Resposta: ${HEALTH_BODY}" >&2
  exit 1
fi
echo "[+] GET /hub-api/health => 200 OK (status: ok)"

# 3. Teste do Readiness do Banco via Reverse Proxy (GET /hub-api/health/database => 200 com database: connected)
echo "[*] Testando GET /hub-api/health/database ..."
DB_HEALTH_BODY=$(curl -s "${WEB_BASE_URL}/hub-api/health/database")
if ! echo "${DB_HEALTH_BODY}" | grep -q '"database":"connected"'; then
  echo "[-] FALHA: GET /hub-api/health/database não retornou database connected. Resposta: ${DB_HEALTH_BODY}" >&2
  exit 1
fi
echo "[+] GET /hub-api/health/database => 200 OK (database: connected)"

# 4. Teste de Métricas não autenticado (GET /hub-api/metrics sem key => 401)
echo "[*] Testando GET /hub-api/metrics sem autenticação ..."
METRICS_STATUS_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "${WEB_BASE_URL}/hub-api/metrics")
if [ "${METRICS_STATUS_UNAUTH}" -ne 401 ]; then
  echo "[-] FALHA: GET /hub-api/metrics desprotegido retornou HTTP ${METRICS_STATUS_UNAUTH} (esperado 401)" >&2
  exit 1
fi
echo "[+] GET /hub-api/metrics (sem header) => 401 Unauthorized (bloqueio confirmado)"

# 5. Teste de Métricas com API Key (se fornecida)
if [ -n "${HUB_INTERNAL_API_KEY}" ]; then
  echo "[*] Testando GET /hub-api/metrics com chave interna..."
  METRICS_STATUS_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -H "x-hub-internal-api-key: ${HUB_INTERNAL_API_KEY}" "${WEB_BASE_URL}/hub-api/metrics")
  if [ "${METRICS_STATUS_AUTH}" -ne 200 ]; then
    echo "[-] FALHA: GET /hub-api/metrics com x-hub-internal-api-key retornou HTTP ${METRICS_STATUS_AUTH} (esperado 200)" >&2
    exit 1
  fi
  echo "[+] GET /hub-api/metrics (com chave interna) => 200 OK"
fi

echo "[+] Todos os smoke tests passaram com sucesso!"
