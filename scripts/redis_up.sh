#!/usr/bin/env bash
set -euo pipefail

# Start (or rebuild) a local Redis container for the project
# Uses: redis/Dockerfile + redis/redis.conf
# Persists to ./data/redis

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMG="wb-redis:local"
NAME="wb-redis"
HOST_PORT="${REDIS_PORT:-6379}"
DATA_DIR="${ROOT_DIR}/data/redis"

mkdir -p "${DATA_DIR}"

echo "🔧 Building image ${IMG} from ${ROOT_DIR}/redis ..."
docker build -t "${IMG}" "${ROOT_DIR}/redis"

# Remove existing container with same name if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "♻️  Removing existing container ${NAME} ..."
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
fi

echo "🚀 Starting Redis container ${NAME} on port ${HOST_PORT} ..."
docker run -d \
  --name "${NAME}" \
  -p "${HOST_PORT}:6379" \
  -v "${DATA_DIR}:/data" \
  "${IMG}" >/dev/null

# Quick health check
sleep 0.8
if command -v nc >/dev/null 2>&1; then
  if nc -z localhost "${HOST_PORT}"; then
    echo "✅ Redis is up at redis://localhost:${HOST_PORT}/0"
  else
    echo "⚠️  Port check failed; ensure Docker is running."
  fi
else
  echo "ℹ️  Redis started. (netcat not installed, skipping port check)"
fi
