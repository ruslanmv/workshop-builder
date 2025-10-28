#!/usr/bin/env bash
set -euo pipefail

# Start (or rebuild) a local Redis container for the project
# Uses: redis/Dockerfile + redis/redis.conf
# Persists to ./data/redis

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMG="wb-redis:local"
NAME="wb-redis"
DEFAULT_PORT="${REDIS_PORT:-6379}"
DATA_DIR="${ROOT_DIR}/data/redis"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-45}"  # seconds (was 10s; Redis + healthcheck often needs >10s)

die() { echo "❌ $*" >&2; exit 1; }

docker_ok() { docker info >/dev/null 2>&1; }

port_in_use() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -lnt "( sport = :${p} )" | grep -q LISTEN
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -E "[:.]${p}$" -q
  else
    return 1
  fi
}

choose_free_port() {
  local start=$1
  local tries=${2:-20}
  for p in $(seq "${start}" $((start + tries))); do
    if ! port_in_use "${p}"; then
      echo "${p}"
      return 0
    fi
  done
  return 1
}

get_health_status() {
  local name=$1
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo "missing"
}

is_ready_via_cli() {
  # Try pinging from inside the container (works regardless of port mapping)
  docker exec "$1" redis-cli ping >/dev/null 2>&1
}

wait_for_ready() {
  local name=$1
  local timeout=$2
  local i=0
  while (( i < timeout )); do
    # Accept early readiness if redis-cli answers PONG
    if is_ready_via_cli "$name"; then
      return 0
    fi
    # Otherwise, rely on health if present
    case "$(get_health_status "$name")" in
      healthy) return 0 ;;
      unhealthy)
        echo "⚠️  Health reports 'unhealthy'. Recent logs:"
        docker logs --tail=100 "$name" || true
        return 2
        ;;
      none|missing|starting) ;; # keep waiting
    esac
    sleep 1
    ((i++))
  done
  return 1
}

docker_ok || die "Docker daemon not running. Start Docker Desktop / service and retry."

mkdir -p "${DATA_DIR}"

echo "🔧 Building image ${IMG} from ${ROOT_DIR}/redis ..."
docker build -t "${IMG}" "${ROOT_DIR}/redis"

# Remove existing container with same name if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "♻️  Removing existing container ${NAME} ..."
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
fi

# Resolve host port (avoid collisions)
HOST_PORT="${DEFAULT_PORT}"
if port_in_use "${HOST_PORT}"; then
  echo "⚠️  Port ${HOST_PORT} is busy. Looking for a free port…"
  HOST_PORT="$(choose_free_port $((DEFAULT_PORT + 1)) 100)" || die "No free port found near ${DEFAULT_PORT}."
  echo "➡️  Using port ${HOST_PORT} instead."
fi

echo "🚀 Starting Redis container ${NAME} on port ${HOST_PORT} ..."
docker run -d \
  --name "${NAME}" \
  -p "${HOST_PORT}:6379" \
  -v "${DATA_DIR}:/data" \
  --health-cmd "redis-cli ping || exit 1" \
  --health-interval 5s \
  --health-timeout 3s \
  --health-retries 10 \
  --health-start-period 1s \
  "${IMG}" >/dev/null

echo "⏳ Waiting for Redis readiness/health (up to ${HEALTH_TIMEOUT}s)…"
if wait_for_ready "${NAME}" "${HEALTH_TIMEOUT}"; then
  echo "✅ Redis is ready at redis://localhost:${HOST_PORT}/0"
else
  rc=$?
  if [[ $rc -eq 1 ]]; then
    echo "⚠️  Timed out waiting for readiness. Recent logs:"
    docker logs --tail=100 "${NAME}" || true
  fi
  exit 1
fi

# Best-effort host port probe (optional)
if command -v nc >/dev/null 2>&1; then
  if nc -z localhost "${HOST_PORT}"; then
    echo "🔌 Port ${HOST_PORT} is open."
  else
    echo "ℹ️  Container is ready but host port probe failed (firewall or port mapping issue)."
  fi
fi

# Optional: warn about vm.overcommit (dev-only warning)
if docker logs "${NAME}" 2>&1 | grep -q "Memory overcommit must be enabled"; then
  echo "⚠️  Kernel hint: enable memory overcommit on the host for Redis persistence:"
  echo "    sudo sysctl -w vm.overcommit_memory=1"
  echo "    echo 'vm.overcommit_memory=1' | sudo tee -a /etc/sysctl.conf"
fi
