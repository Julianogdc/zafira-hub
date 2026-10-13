#!/usr/bin/env bash
# Varredura de segredos (F6-RO.1 / ressalva 1 da SEC-ASANA.1).
#
# Uso:
#   scripts/ci/secret-scan.sh repo          # arquivos versionados no Git
#   scripts/ci/secret-scan.sh dir <caminho> # diretório gerado (ex.: bundle do web)
#
# Falha (exit 1) se encontrar algo com cara de credencial. Nunca imprime o valor
# encontrado: só arquivo, linha e tipo. Valores de teste conhecidos ficam em
# scripts/ci/secret-scan-allowlist.txt (um literal por linha, # para comentário).
set -euo pipefail

MODE="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT_DIR/scripts/ci/secret-scan-allowlist.txt"

declare -A PATTERNS=(
  [asana_token]='[0-9]/[0-9]{10,}(/[0-9]{10,})?:[0-9a-f]{20,}'
  [github_token]='(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})'
  [aws_access_key]='AKIA[0-9A-Z]{16}'
  [private_key]='-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
  [slack_token]='xox[abprs]-[A-Za-z0-9-]{10,}'
  [api_secret_key]='(^|[^A-Za-z0-9_])sk-(ant-|proj-|live_|test_)?[A-Za-z0-9_-]{24,}'
  [google_api_key]='AIza[0-9A-Za-z_-]{35}'
  [jwt]='eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  [db_url_with_password]='postgres(ql)?://[^:/[:space:]"]+:[^@[:space:]"]+@'
  # Atribuicao de credencial com valor longo (alfanumerico, inclusive com _ - . / + =), como exemplos de .env.
  # Placeholders curtos ("CHANGE_ME") e valores de teste do CI nao casam; valores de teste conhecidos vao na allowlist.
  [credential_assignment]='[A-Z0-9_]*(API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSPHRASE)[A-Z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_./+=]{30,}["'"'"']?'
)

# Arquivos de teste usam credenciais fictícias por definição.
EXCLUDE_PATH_REGEX='(__tests__/|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|(^|/)package-lock\.json$)'

load_allowlist() {
  if [[ -f "$ALLOWLIST" ]]; then
    grep -vE '^\s*(#|$)' "$ALLOWLIST" || true
  fi
}

list_files() {
  case "$MODE" in
    repo)
      git -C "$ROOT_DIR" ls-files | sed "s#^#$ROOT_DIR/#"
      ;;
    dir)
      local target="${2:-}"
      if [[ -z "$target" || ! -d "$target" ]]; then
        echo "secret-scan: diretório inválido: '$target'" >&2
        exit 2
      fi
      find "$target" -type f
      ;;
    *)
      echo "uso: $0 repo | dir <caminho>" >&2
      exit 2
      ;;
  esac
}

mapfile -t ALLOWED < <(load_allowlist)
mapfile -t FILES < <(list_files "$@" | grep -vE "$EXCLUDE_PATH_REGEX" || true)

findings=0
for name in "${!PATTERNS[@]}"; do
  regex="${PATTERNS[$name]}"
  # -o devolve só o trecho encontrado, que é comparado com a allowlist e descartado.
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    # Preserva a letra de unidade em caminhos Windows (C:/...) antes de separar arquivo:linha:trecho.
    drive=""
    if [[ "$hit" =~ ^[A-Za-z]: ]]; then
      drive="${hit:0:2}"
      hit="${hit:2}"
    fi
    location="$drive${hit%%:*}"
    rest="${hit#*:}"
    line="${rest%%:*}"
    match="${rest#*:}"
    allowed=0
    for literal in "${ALLOWED[@]}"; do
      if [[ "$match" == *"$literal"* ]]; then
        allowed=1
        break
      fi
    done
    if [[ "$allowed" -eq 0 ]]; then
      echo "SEGREDO SUSPEITO [$name]: ${location#"$ROOT_DIR/"}:$line"
      findings=$((findings + 1))
    fi
  done < <(printf '%s\0' "${FILES[@]}" | xargs -0 -r grep -HEnoI -- "$regex" 2>/dev/null || true)
done

if [[ "$findings" -gt 0 ]]; then
  echo "secret-scan ($MODE): $findings ocorrência(s) suspeita(s). Remova o segredo, revogue-o se já foi publicado, ou, se for um valor de teste, registre-o em scripts/ci/secret-scan-allowlist.txt." >&2
  exit 1
fi

echo "secret-scan ($MODE): nenhuma credencial suspeita em ${#FILES[@]} arquivo(s)."
