#!/usr/bin/env bash
# ==============================================================================
# ZAFIRA HUB 2.1 — SCRIPT DE COLETA DE CAPACIDADE DA VPS (SOMENTE LEITURA)
# ==============================================================================
# FINALIDADE: Coletar métricas operacionais reais de CPU, memória, swap,
#             disco e containers em execução na VPS Ubuntu 24.04.
# SEGURANÇA:  ESTRITAMENTE LEITURA. Não altera arquivos, não reinicia containers,
#             não instala pacotes, não expõe variáveis de ambiente (.Config.Env).
# ==============================================================================

set -euo pipefail

echo "=============================================================================="
echo "ZAFIRA HUB 2.1 — VPS CAPACITY & INFRASTRUCTURE SNAPSHOT"
echo "Data da Coleta: $(date -Is)"
echo "=============================================================================="
echo ""

# 1. SISTEMA OPERACIONAL & KERNEL
echo "--- [1/6] SISTEMA & UPTIME ---"
echo "Data/Hora Local: $(date -Is)"
echo "Uptime:          $(uptime)"
echo "Kernel / SO:     $(uname -a)"
echo "Núcleos de CPU:  $(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 'N/A')"
echo ""

# 2. MEMÓRIA & SWAP
echo "--- [2/6] MEMÓRIA RAM & SWAP ---"
echo ">> free -h:"
free -h || true
echo ""
echo ">> free -b (bytes brutos):"
free -b || true
echo ""
echo ">> swapon --show:"
swapon --show || true
echo ""

# 3. ARMAZENAMENTO & INODES
echo "--- [3/6] DISCO & INODES ---"
echo ">> df -h (Espaço em disco):"
df -h -x tmpfs -x devtmpfs || true
echo ""
echo ">> df -i (Uso de Inodes):"
df -i -x tmpfs -x devtmpfs || true
echo ""

# 4. DOCKER ENGINE STATUS
echo "--- [4/6] DOCKER ENGINE STATUS ---"
if command -v docker >/dev/null 2>&1; then
    echo ">> Docker Version:"
    docker version --format 'Client: {{.Client.Version}} | Server: {{.Server.Version}}' 2>/dev/null || docker --version
    echo ""
    echo ">> Docker System DF:"
    docker system df 2>/dev/null || true
    echo ""
else
    echo "AVISO: Binário 'docker' não localizado no PATH."
fi

# 5. CONTAINERS EM EXECUÇÃO & CONSUMO ATUAL
echo "--- [5/6] CONTAINERS & ESTATÍSTICAS ---"
if command -v docker >/dev/null 2>&1; then
    echo ">> Containers Ativos (docker ps):"
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || true
    echo ""
    echo ">> Docker Stats (Consumo Instantâneo sem streaming):"
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' 2>/dev/null || true
    echo ""
    echo ">> Inspeção de Limites de Recursos dos Containers (Sem variáveis de ambiente):"
    for c in $(docker ps -q 2>/dev/null || true); do
        c_name=$(docker inspect -f '{{.Name}}' "$c" 2>/dev/null | sed 's/^\///')
        c_mem=$(docker inspect -f '{{.HostConfig.Memory}}' "$c" 2>/dev/null || echo '0')
        c_cpu=$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$c" 2>/dev/null || echo '0')
        c_restart=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c" 2>/dev/null || echo 'N/A')
        c_health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}NoHealthCheck{{end}}' "$c" 2>/dev/null || echo 'N/A')
        echo "Container: $c_name | MemoryLimit: $c_mem bytes | NanoCPUs: $c_cpu | RestartPolicy: $c_restart | Health: $c_health"
    done
    echo ""
fi

# 6. BLOCO ESTRUTURADO MACHINE READABLE (SEM SEGREDOS)
echo "--- [6/6] BLOCO MACHINE READABLE ---"
echo "--- ZAFIRA_CAPACITY_JSON_BEGIN ---"

TOTAL_MEM=$(free -b 2>/dev/null | awk '/^Mem:/{print $2}' || echo '0')
USED_MEM=$(free -b 2>/dev/null | awk '/^Mem:/{print $3}' || echo '0')
AVAIL_MEM=$(free -b 2>/dev/null | awk '/^Mem:/{print $7}' || echo '0')
TOTAL_SWAP=$(free -b 2>/dev/null | awk '/^Swap:/{print $2}' || echo '0')
USED_SWAP=$(free -b 2>/dev/null | awk '/^Swap:/{print $3}' || echo '0')
DISK_USAGE=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' || echo 'N/A')
CPU_CORES=$(nproc 2>/dev/null || echo '1')
UPTIME_STR=$(uptime -p 2>/dev/null || uptime)

cat <<EOF
{
  "timestamp": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "hostname": "$(hostname 2>/dev/null || echo 'vps')",
  "kernel": "$(uname -r 2>/dev/null || echo 'linux')",
  "cpuCores": ${CPU_CORES},
  "uptime": "${UPTIME_STR}",
  "memory": {
    "totalBytes": ${TOTAL_MEM},
    "usedBytes": ${USED_MEM},
    "availableBytes": ${AVAIL_MEM},
    "swapTotalBytes": ${TOTAL_SWAP},
    "swapUsedBytes": ${USED_SWAP}
  },
  "disk": {
    "rootUsage": "${DISK_USAGE}"
  }
}
EOF

echo "--- ZAFIRA_CAPACITY_JSON_END ---"
echo ""
echo "Coleta somente leitura finalizada com sucesso."
