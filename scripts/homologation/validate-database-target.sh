#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Proteção contra Banco de Produção (Homologação / Staging)
# Valida se a variável DATABASE_URL fornecida aponta para um banco de staging/homolog
# e rejeita explicitamente qualquer apontamento para a base de produção 'zafira_hub_v2'.
# ==============================================================================

TARGET_URL="${DATABASE_URL:-${1:-}}"

if [ -z "${TARGET_URL}" ]; then
  echo "[-] ERRO: DATABASE_URL está vazia ou não foi informada." >&2
  exit 1
fi

# Extrair nome do banco de dados da URL (excluindo query params)
# Formato padrão: postgresql://user:pass@host:port/dbname?params
DB_NAME=$(echo "${TARGET_URL}" | sed -e 's/?.*$//' -e 's|^.*/||')

# Sanitizar a URL para exibição segura em logs (ocultar senha)
SANITIZED_URL=$(echo "${TARGET_URL}" | sed -E 's|://([^:]+):([^@]+)@|://\1:****@|')

echo "[*] Validando destino do banco de dados: ${SANITIZED_URL}"
echo "[*] Nome do banco detectado: ${DB_NAME}"

# 1. Rejeição explícita do banco de produção conhecido
if [[ "${DB_NAME}" == "zafira_hub_v2" || "${TARGET_URL}" =~ zafira_hub_v2 ]]; then
  echo "[-] ERRO CRÍTICO: Tentativa de apontar para o banco de PRODUÇÃO ('zafira_hub_v2') abortada!" >&2
  exit 1
fi

# 2. Aceitação estrita de sufixos/padrões seguros de staging/homologação
# Padrão preferencial: zafira_hub_21_staging ou contendo staging, homolog, hml
if [[ "${DB_NAME}" =~ (staging|homolog|hml) ]]; then
  echo "[+] Destino do banco de dados aprovado para homologação: ${DB_NAME}"
  exit 0
else
  echo "[-] ERRO: O banco '${DB_NAME}' não possui indicador de homologação (staging, homolog, hml)." >&2
  echo "[-] Operação abortada por segurança para evitar escrita em base inadequada." >&2
  exit 1
fi
