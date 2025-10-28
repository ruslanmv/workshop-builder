#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${VENV:-${ROOT_DIR}/.venv}"

# Load .env if present
if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env"
  set +a
fi

# Defaults
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
RQ_QUEUES="${RQ_QUEUES:-${RQ_QUEUE:-jobs}}"
RQ_WORKER_NAME="${RQ_WORKER_NAME:-local-worker}"
RQ_LOG_LEVEL="${RQ_LOG_LEVEL:-INFO}"   # use: DEBUG|INFO|WARNING|ERROR|CRITICAL

# Choose worker class cross-platform:
# - macOS: SimpleWorker (no fork) avoids Objective-C fork crash
# - others: regular Worker (forked work-horses)
UNAME_S="$(uname -s)"
if [[ -z "${RQ_WORKER_CLASS:-}" ]]; then
  if [[ "$UNAME_S" == "Darwin" ]]; then
    RQ_WORKER_CLASS="rq.worker.SimpleWorker"
  else
    RQ_WORKER_CLASS="rq.worker.Worker"
  fi
fi

# Activate venv if present
if [ -f "${VENV}/bin/activate" ]; then
  # shellcheck source=/dev/null
  source "${VENV}/bin/activate"
fi

export PYTHONPATH="${ROOT_DIR}:${PYTHONPATH:-}"
export REDIS_URL RQ_QUEUES RQ_WORKER_CLASS

if ! command -v rq >/dev/null 2>&1; then
  echo "❌ 'rq' not found. Install it: pip install rq"
  exit 1
fi

# macOS fork-safety workaround (extra guard; SimpleWorker already avoids fork)
if [[ "$UNAME_S" == "Darwin" ]]; then
  export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
fi

# Optional: wait for Redis
echo "⏳ Waiting for Redis at ${REDIS_URL} ..."
python - <<'PY' || { echo "❌ Could not connect to Redis."; exit 1; }
import os, time, sys
import redis
url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
r = redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
for _ in range(30):
    try:
        if r.ping():
            sys.exit(0)
    except Exception:
        time.sleep(1)
print("Failed to ping Redis after 30s")
sys.exit(1)
PY

echo "🔗 Starting RQ worker name=${RQ_WORKER_NAME}, queues=${RQ_QUEUES}, url=${REDIS_URL}"
echo "   Worker class: ${RQ_WORKER_CLASS}"

# Split queues on spaces
read -r -a _QUEUES <<< "${RQ_QUEUES}"

# NOTE: your RQ CLI expects --logging_level (underscore), not --logging-level
exec rq worker \
  --url "${REDIS_URL}" \
  --name "${RQ_WORKER_NAME}" \
  --worker-class "${RQ_WORKER_CLASS}" \
  --logging_level "${RQ_LOG_LEVEL}" \
  -P "${ROOT_DIR}" \
  "${_QUEUES[@]}"
