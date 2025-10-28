#!/usr/bin/env bash
set -euo pipefail

# Stop any RQ workers so the next start doesn't collide on name/ports.
# Usage:
#   bash scripts/redis_stop.sh
#
# Env vars:
#   REDIS_URL           Redis URL (default: redis://localhost:6379/0)
#   COMPOSE_FILE        Path to compose file (default: infra/docker-compose.yml)
#   CLEAN_REDIS         1 to remove stale worker registrations (default 1)
#   WORKER_NAME_PREFIX  Only clean workers with this prefix (default local-worker)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/infra/docker-compose.yml}"
CLEAN_REDIS="${CLEAN_REDIS:-1}"
WORKER_NAME_PREFIX="${WORKER_NAME_PREFIX:-local-worker}"

echo "🧹 Stopping RQ workers (docker & local)..."

# 1) Stop docker compose 'worker' service if it exists
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if command -v docker compose >/dev/null 2>&1 && [ -f "${COMPOSE_FILE}" ]; then
    if docker compose -f "${COMPOSE_FILE}" ps --services 2>/dev/null | grep -qx worker; then
      echo " - Stopping docker compose service 'worker'..."
      docker compose -f "${COMPOSE_FILE}" stop worker >/dev/null 2>&1 || true
      docker compose -f "${COMPOSE_FILE}" rm -f worker >/dev/null 2>&1 || true
      echo "   ✓ compose worker stopped/removed"
    fi
  fi
fi

# 2) Kill local RQ worker processes (best-effort)
terminate_patterns=(
  "rq worker"
  "python -m workers.worker"
  "python3 -m workers.worker"
)
for pat in "${terminate_patterns[@]}"; do
  pids="$(pgrep -f "$pat" || true)"
  if [ -n "${pids}" ]; then
    echo " - Terminating processes matching '$pat': ${pids}"
    kill ${pids} 2>/dev/null || true
    sleep 1
    still="$(pgrep -f "$pat" || true)"
    if [ -n "${still}" ]; then
      echo "   ⚠️  Forcing kill: ${still}"
      kill -9 ${still} 2>/dev/null || true
    fi
  fi
done

# 3) Clean stale RQ worker registrations in Redis (so names won't collide)
if [ "${CLEAN_REDIS}" = "1" ]; then
  if command -v python >/dev/null 2>&1; then
    echo " - Cleaning stale RQ worker registrations in Redis (prefix='${WORKER_NAME_PREFIX}')..."
    REDIS_URL="${REDIS_URL}" WORKER_NAME_PREFIX="${WORKER_NAME_PREFIX}" python - <<'PY'
import os, sys
try:
    import redis
except Exception as e:
    print(f"   ⚠️  Skipping cleanup (redis-py not installed): {e}")
    sys.exit(0)

url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
prefix = os.environ.get("WORKER_NAME_PREFIX", "local-worker")
r = redis.Redis.from_url(url)

try:
    workers = [w.decode() if isinstance(w, bytes) else w for w in r.smembers("rq:workers")]
except Exception as e:
    print(f"   ⚠️  Could not read rq:workers set: {e}")
    sys.exit(0)

to_remove = [w for w in workers if w.startswith(prefix)]
removed = 0
for w in to_remove:
    r.srem("rq:workers", w)
    r.delete(f"rq:worker:{w}")
    removed += 1

print(f"   ✓ Removed {removed} stale worker registration(s)")
PY
  else
    echo " - Python not found; skipping Redis registry cleanup."
  fi
else
  echo " - CLEAN_REDIS=0, skipping Redis registry cleanup."
fi

echo "✅ Done. Any active/stale workers should be stopped/cleared."
