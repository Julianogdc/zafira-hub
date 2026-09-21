#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Rehearsal do Portão Multi-Organização via HTTP
# Testa o isolamento absoluto entre dois usuários e duas organizações reais,
# operando estritamente através das rotas HTTP do reverse proxy Web (/hub-api/...).
# ==============================================================================

WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:8082}"
ORG_A_ID="${ORG_A_ID:-11111111-1111-4111-8111-111111111111}"
ORG_B_ID="${ORG_B_ID:-22222222-2222-4222-8222-222222222222}"
GATE_EMAIL_A="${GATE_EMAIL_A:-gate-a@zafira.invalid}"
GATE_EMAIL_B="${GATE_EMAIL_B:-gate-b@zafira.invalid}"
GATE_PASSWORD_A="${GATE_PASSWORD_A:-}"
GATE_PASSWORD_B="${GATE_PASSWORD_B:-}"

if [ -z "${GATE_PASSWORD_A}" ] || [ -z "${GATE_PASSWORD_B}" ]; then
  echo "[-] ERRO: GATE_PASSWORD_A e GATE_PASSWORD_B são obrigatórias." >&2
  exit 1
fi

echo "[*] Iniciando ensaio do Portão Multi-Organização contra: ${WEB_BASE_URL}"

# ------------------------------------------------------------------------------
# 1. Login User A
# ------------------------------------------------------------------------------
echo "[*] Executando login do User A (Org A)..."
LOGIN_RES_A=$(curl -s -i -X POST "${WEB_BASE_URL}/hub-api/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${GATE_EMAIL_A}\",\"password\":\"${GATE_PASSWORD_A}\",\"organizationId\":\"${ORG_A_ID}\"}")

HTTP_STATUS_A=$(echo "${LOGIN_RES_A}" | grep -E '^HTTP/' | tail -n 1 | awk '{print $2}' | tr -d '\r\n')
if [ "${HTTP_STATUS_A}" -ne 200 ]; then
  echo "[-] FALHA: Login User A retornou HTTP ${HTTP_STATUS_A} (esperado 200)" >&2
  exit 1
fi

# Validação das flags do cookie
if ! echo "${LOGIN_RES_A}" | grep -qi "HttpOnly"; then
  echo "[-] FALHA: Cookie de autenticação não possui flag HttpOnly!" >&2
  exit 1
fi
if ! echo "${LOGIN_RES_A}" | grep -qi "SameSite="; then
  echo "[-] FALHA: Cookie de autenticação não possui flag SameSite!" >&2
  exit 1
fi

TOKEN_A=$(echo "${LOGIN_RES_A}" | grep -i 'set-cookie:' | sed -E 's/.*[Tt]oken=([^;[:space:]]+).*/\1/' | head -n 1 | tr -d '\r\n[:space:]')
if [ -z "${TOKEN_A}" ]; then
  echo "[-] FALHA: Token A não encontrado no Set-Cookie." >&2
  exit 1
fi
echo "ORG_A_LOGIN=PASS"

# ------------------------------------------------------------------------------
# 2. Login User B
# ------------------------------------------------------------------------------
echo "[*] Executando login do User B (Org B)..."
LOGIN_RES_B=$(curl -s -i -X POST "${WEB_BASE_URL}/hub-api/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${GATE_EMAIL_B}\",\"password\":\"${GATE_PASSWORD_B}\",\"organizationId\":\"${ORG_B_ID}\"}")

HTTP_STATUS_B=$(echo "${LOGIN_RES_B}" | grep -E '^HTTP/' | tail -n 1 | awk '{print $2}' | tr -d '\r\n')
if [ "${HTTP_STATUS_B}" -ne 200 ]; then
  echo "[-] FALHA: Login User B retornou HTTP ${HTTP_STATUS_B} (esperado 200)" >&2
  exit 1
fi

TOKEN_B=$(echo "${LOGIN_RES_B}" | grep -i 'set-cookie:' | sed -E 's/.*[Tt]oken=([^;[:space:]]+).*/\1/' | head -n 1 | tr -d '\r\n[:space:]')
if [ -z "${TOKEN_B}" ]; then
  echo "[-] FALHA: Token B não encontrado no Set-Cookie." >&2
  exit 1
fi
echo "ORG_B_LOGIN=PASS"

# ------------------------------------------------------------------------------
# 3. Cookie Isolation e Flags
# ------------------------------------------------------------------------------
if [ "${TOKEN_A}" = "${TOKEN_B}" ]; then
  echo "[-] FALHA: Tokens de usuários diferentes são idênticos!" >&2
  exit 1
fi
echo "COOKIE_FLAGS=PASS"

# ------------------------------------------------------------------------------
# 4. Foreign Organization Login Attempt (Deve retornar 403 Forbidden)
# ------------------------------------------------------------------------------
echo "[*] Testando login de User A solicitando Org B estrangeira..."
STATUS_FOREIGN_A=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${WEB_BASE_URL}/hub-api/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${GATE_EMAIL_A}\",\"password\":\"${GATE_PASSWORD_A}\",\"organizationId\":\"${ORG_B_ID}\"}")

if [ "${STATUS_FOREIGN_A}" -ne 403 ]; then
  echo "[-] FALHA: Login User A em Org B estrangeira retornou HTTP ${STATUS_FOREIGN_A} (esperado 403)" >&2
  exit 1
fi
echo "FOREIGN_ORG_LOGIN_A=403_PASS"

echo "[*] Testando login de User B solicitando Org A estrangeira..."
STATUS_FOREIGN_B=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${WEB_BASE_URL}/hub-api/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${GATE_EMAIL_B}\",\"password\":\"${GATE_PASSWORD_B}\",\"organizationId\":\"${ORG_A_ID}\"}")

if [ "${STATUS_FOREIGN_B}" -ne 403 ]; then
  echo "[-] FALHA: Login User B em Org A estrangeira retornou HTTP ${STATUS_FOREIGN_B} (esperado 403)" >&2
  exit 1
fi
echo "FOREIGN_ORG_LOGIN_B=403_PASS"

# ------------------------------------------------------------------------------
# 5. Session Proof
# ------------------------------------------------------------------------------
echo "[*] Validando sessão de User A..."
SESSION_A=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/api/v1/auth/session" \
  -H "Cookie: token=${TOKEN_A}")

if ! echo "${SESSION_A}" | grep -qE '"authenticated"[[:space:]]*:[[:space:]]*true'; then
  echo "[-] FALHA: Sessão A não autenticada. Resposta: ${SESSION_A}" >&2
  exit 1
fi
if ! echo "${SESSION_A}" | grep -q "${ORG_A_ID}"; then
  echo "[-] FALHA: Sessão A não contém ORG_A_ID." >&2
  exit 1
fi
if echo "${SESSION_A}" | grep -q "${ORG_B_ID}"; then
  echo "[-] FALHA CRÍTICA: Sessão A vazou ORG_B_ID!" >&2
  exit 1
fi
echo "SESSION_A=PASS"

echo "[*] Validando sessão de User B..."
SESSION_B=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/api/v1/auth/session" \
  -H "Cookie: token=${TOKEN_B}")

if ! echo "${SESSION_B}" | grep -qE '"authenticated"[[:space:]]*:[[:space:]]*true'; then
  echo "[-] FALHA: Sessão B não autenticada. Resposta: ${SESSION_B}" >&2
  exit 1
fi
if ! echo "${SESSION_B}" | grep -q "${ORG_B_ID}"; then
  echo "[-] FALHA: Sessão B não contém ORG_B_ID." >&2
  exit 1
fi
if echo "${SESSION_B}" | grep -q "${ORG_A_ID}"; then
  echo "[-] FALHA CRÍTICA: Sessão B vazou ORG_A_ID!" >&2
  exit 1
fi
echo "SESSION_B=PASS"

# ------------------------------------------------------------------------------
# 6. Criação de Client A via HTTP sob Sessão A
# ------------------------------------------------------------------------------
echo "[*] Criando Client A via HTTP sob Org A..."
CREATE_CLIENT_A_RES=$(curl -s -w "\n%{http_code}" -X POST "${WEB_BASE_URL}/hub-api/clients" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=${TOKEN_A}" \
  -d '{"name":"Gate Client A","status":"ACTIVE"}')

STATUS_CREATE_A=$(echo "${CREATE_CLIENT_A_RES}" | tail -n 1 | tr -d '\r\n')
BODY_CREATE_A=$(echo "${CREATE_CLIENT_A_RES}" | sed '$d')

if [ "${STATUS_CREATE_A}" -ne 201 ]; then
  echo "[-] FALHA: Criação do Client A retornou HTTP ${STATUS_CREATE_A} (esperado 201). Resposta: ${BODY_CREATE_A}" >&2
  exit 1
fi

CLIENT_A_ID=$(echo "${BODY_CREATE_A}" | sed -nE 's/.*"id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1 | tr -d '\r\n[:space:]')
if [ -z "${CLIENT_A_ID}" ]; then
  echo "[-] FALHA: ID do Client A não pôde ser extraído." >&2
  exit 1
fi
echo "CLIENT_A_CREATE=PASS"

# ------------------------------------------------------------------------------
# 7. Criação de Client B via HTTP sob Sessão B
# ------------------------------------------------------------------------------
echo "[*] Criando Client B via HTTP sob Org B..."
CREATE_CLIENT_B_RES=$(curl -s -w "\n%{http_code}" -X POST "${WEB_BASE_URL}/hub-api/clients" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=${TOKEN_B}" \
  -d '{"name":"Gate Client B","status":"ACTIVE"}')

STATUS_CREATE_B=$(echo "${CREATE_CLIENT_B_RES}" | tail -n 1 | tr -d '\r\n')
BODY_CREATE_B=$(echo "${CREATE_CLIENT_B_RES}" | sed '$d')

if [ "${STATUS_CREATE_B}" -ne 201 ]; then
  echo "[-] FALHA: Criação do Client B retornou HTTP ${STATUS_CREATE_B} (esperado 201). Resposta: ${BODY_CREATE_B}" >&2
  exit 1
fi

CLIENT_B_ID=$(echo "${BODY_CREATE_B}" | sed -nE 's/.*"id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1 | tr -d '\r\n[:space:]')
if [ -z "${CLIENT_B_ID}" ]; then
  echo "[-] FALHA: ID do Client B não pôde ser extraído." >&2
  exit 1
fi
echo "CLIENT_B_CREATE=PASS"

# ------------------------------------------------------------------------------
# 8. List Isolation
# ------------------------------------------------------------------------------
echo "[*] Verificando listagem de clientes de User A..."
LIST_A=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/clients" \
  -H "Cookie: token=${TOKEN_A}")

if ! echo "${LIST_A}" | grep -q "${CLIENT_A_ID}"; then
  echo "[-] FALHA: Listagem de A não contém Client A!" >&2
  exit 1
fi
if echo "${LIST_A}" | grep -q "${CLIENT_B_ID}" || echo "${LIST_A}" | grep -q "Gate Client B"; then
  echo "[-] FALHA CRÍTICA: Listagem de A contém Client B da outra organização!" >&2
  exit 1
fi
echo "LIST_ISOLATION_A=PASS"

echo "[*] Verificando listagem de clientes de User B..."
LIST_B=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/clients" \
  -H "Cookie: token=${TOKEN_B}")

if ! echo "${LIST_B}" | grep -q "${CLIENT_B_ID}"; then
  echo "[-] FALHA: Listagem de B não contém Client B!" >&2
  exit 1
fi
if echo "${LIST_B}" | grep -q "${CLIENT_A_ID}" || echo "${LIST_B}" | grep -q "Gate Client A"; then
  echo "[-] FALHA CRÍTICA: Listagem de B contém Client A da outra organização!" >&2
  exit 1
fi
echo "LIST_ISOLATION_B=PASS"

# ------------------------------------------------------------------------------
# 9. Direct ID Isolation (Cross-GET deve retornar 404)
# ------------------------------------------------------------------------------
echo "[*] Testando acesso direto cross-organization (User A -> Client B)..."
STATUS_CROSS_GET_A=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${WEB_BASE_URL}/hub-api/clients/${CLIENT_B_ID}" \
  -H "Cookie: token=${TOKEN_A}")

if [ "${STATUS_CROSS_GET_A}" -ne 404 ]; then
  echo "[-] FALHA: User A acessando Client B retornou HTTP ${STATUS_CROSS_GET_A} (esperado 404)" >&2
  exit 1
fi
echo "CROSS_GET_A_TO_B=404_PASS"

echo "[*] Testando acesso direto cross-organization (User B -> Client A)..."
STATUS_CROSS_GET_B=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${WEB_BASE_URL}/hub-api/clients/${CLIENT_A_ID}" \
  -H "Cookie: token=${TOKEN_B}")

if [ "${STATUS_CROSS_GET_B}" -ne 404 ]; then
  echo "[-] FALHA: User B acessando Client A retornou HTTP ${STATUS_CROSS_GET_B} (esperado 404)" >&2
  exit 1
fi
echo "CROSS_GET_B_TO_A=404_PASS"

# ------------------------------------------------------------------------------
# 10. Update Isolation (Cross-PATCH deve retornar 404 e manter dados intactos)
# ------------------------------------------------------------------------------
echo "[*] Testando modificação cross-organization (User A tenta alterar Client B)..."
STATUS_CROSS_PATCH_A=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "${WEB_BASE_URL}/hub-api/clients/${CLIENT_B_ID}" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=${TOKEN_A}" \
  -d '{"name":"TAMPERED BY USER A"}')

if [ "${STATUS_CROSS_PATCH_A}" -ne 404 ]; then
  echo "[-] FALHA: User A alterando Client B retornou HTTP ${STATUS_CROSS_PATCH_A} (esperado 404)" >&2
  exit 1
fi

# Confirma que Client B continua intacto
CLIENT_B_VERIFY=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/clients/${CLIENT_B_ID}" \
  -H "Cookie: token=${TOKEN_B}")
if ! echo "${CLIENT_B_VERIFY}" | grep -q "Gate Client B"; then
  echo "[-] FALHA CRÍTICA: Client B foi corrompido!" >&2
  exit 1
fi
echo "CROSS_PATCH_A_TO_B=404_PASS"

echo "[*] Testando modificação cross-organization (User B tenta alterar Client A)..."
STATUS_CROSS_PATCH_B=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "${WEB_BASE_URL}/hub-api/clients/${CLIENT_A_ID}" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=${TOKEN_B}" \
  -d '{"name":"TAMPERED BY USER B"}')

if [ "${STATUS_CROSS_PATCH_B}" -ne 404 ]; then
  echo "[-] FALHA: User B alterando Client A retornou HTTP ${STATUS_CROSS_PATCH_B} (esperado 404)" >&2
  exit 1
fi

# Confirma que Client A continua intacto
CLIENT_A_VERIFY=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/clients/${CLIENT_A_ID}" \
  -H "Cookie: token=${TOKEN_A}")
if ! echo "${CLIENT_A_VERIFY}" | grep -q "Gate Client A"; then
  echo "[-] FALHA CRÍTICA: Client A foi corrompido!" >&2
  exit 1
fi
echo "CROSS_PATCH_B_TO_A=404_PASS"

# ------------------------------------------------------------------------------
# 11. Header Tenant Tampering
# ------------------------------------------------------------------------------
echo "[*] Testando adulteração de header x-organization-id (User A injeta Org B)..."
TAMPER_RES_A=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/clients" \
  -H "Cookie: token=${TOKEN_A}" \
  -H "x-organization-id: ${ORG_B_ID}")

if echo "${TAMPER_RES_A}" | grep -q "${CLIENT_B_ID}" || echo "${TAMPER_RES_A}" | grep -q "Gate Client B"; then
  echo "[-] FALHA CRÍTICA: Header adulterado permitiu vazamento de dados da Org B!" >&2
  exit 1
fi

echo "[*] Testando adulteração de header x-organization-id (User B injeta Org A)..."
TAMPER_RES_B=$(curl -s -X GET "${WEB_BASE_URL}/hub-api/clients" \
  -H "Cookie: token=${TOKEN_B}" \
  -H "x-organization-id: ${ORG_A_ID}")

if echo "${TAMPER_RES_B}" | grep -q "${CLIENT_A_ID}" || echo "${TAMPER_RES_B}" | grep -q "Gate Client A"; then
  echo "[-] FALHA CRÍTICA: Header adulterado permitiu vazamento de dados da Org A!" >&2
  exit 1
fi
echo "TENANT_HEADER_TAMPERING=PASS"

# ------------------------------------------------------------------------------
# 12. Logout
# ------------------------------------------------------------------------------
echo "[*] Encerrando sessões de User A e User B..."
STATUS_LOGOUT_A=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${WEB_BASE_URL}/hub-api/api/v1/auth/logout" \
  -H "Cookie: token=${TOKEN_A}")
if [ "${STATUS_LOGOUT_A}" -ne 200 ]; then
  echo "[-] FALHA: Logout User A retornou HTTP ${STATUS_LOGOUT_A}" >&2
  exit 1
fi

STATUS_LOGOUT_B=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${WEB_BASE_URL}/hub-api/api/v1/auth/logout" \
  -H "Cookie: token=${TOKEN_B}")
if [ "${STATUS_LOGOUT_B}" -ne 200 ]; then
  echo "[-] FALHA: Logout User B retornou HTTP ${STATUS_LOGOUT_B}" >&2
  exit 1
fi

echo "=================================================="
echo "ORG_A_LOGIN=PASS"
echo "ORG_B_LOGIN=PASS"
echo "FOREIGN_ORG_LOGIN_A=403_PASS"
echo "FOREIGN_ORG_LOGIN_B=403_PASS"
echo "SESSION_A=PASS"
echo "SESSION_B=PASS"
echo "CLIENT_A_CREATE=PASS"
echo "CLIENT_B_CREATE=PASS"
echo "LIST_ISOLATION_A=PASS"
echo "LIST_ISOLATION_B=PASS"
echo "CROSS_GET_A_TO_B=404_PASS"
echo "CROSS_GET_B_TO_A=404_PASS"
echo "CROSS_PATCH_A_TO_B=404_PASS"
echo "CROSS_PATCH_B_TO_A=404_PASS"
echo "TENANT_HEADER_TAMPERING=PASS"
echo "COOKIE_FLAGS=PASS"
echo "MULTIORG_GATE=PASS"
echo "=================================================="
echo "[+] Ensaio do Portão Multi-Organização concluído com 100% de sucesso!"
