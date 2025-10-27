#!/usr/bin/env bash
set -euo pipefail

NAME="wb-redis"

if docker ps -a --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "🛑 Stopping ${NAME} ..."
  docker rm -f "${NAME}" >/dev/null
  echo "✅ ${NAME} removed."
else
  echo "ℹ️  No container named ${NAME} exists."
fi
