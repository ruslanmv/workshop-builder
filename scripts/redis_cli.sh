#!/usr/bin/env bash
set -euo pipefail

# Open a redis-cli inside the container (or install locally if you prefer)
NAME="wb-redis"
if ! docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "❌ Container ${NAME} is not running. Start it with scripts/redis_up.sh"
  exit 1
fi

docker exec -it "${NAME}" redis-cli
