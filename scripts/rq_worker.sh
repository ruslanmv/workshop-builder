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
# Default worker name is unique to avoid collisions with Docker workers, etc.
DEFAULT_WORKER_NAME="local-worker-$(hostname 2>/dev/null || echo host)-$$"
RQ_WORKER_NAME="${RQ_WORKER_NAME:-$DEFAULT_WORKER_NAME}"
RQ_LOG_LEVEL="${RQ_LOG_LEVEL:-INFO}"   # DEBUG|INFO|WARNING|ERROR|CRITICAL

# --- Platform detection helpers ---
UNAME_S="$(uname -s || true)"
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]; }
is_windows() {
  case "${UNAME_S}" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Choose worker class cross-platform:
# - macOS/WSL/Windows: SimpleWorker (no fork) – safest
# - Linux: SimpleWorker too unless overridden via RQ_WORKER_CLASS
if [[ -z "${RQ_WORKER_CLASS:-}" ]]; then
  if [[ "${UNAME_S}" == "Darwin" ]] || is_wsl || is_windows; then
    RQ_WORKER_CLASS="rq.worker.SimpleWorker"
  else
    RQ_WORKER_CLASS="rq.worker.SimpleWorker"
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
if [[ "${UNAME_S}" == "Darwin" ]]; then
  export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
fi

# Optional: wait for Redis to be reachable
echo "⏳ Waiting for Redis at ${REDIS_URL} ..."
python - <<'PY' || { echo "❌ Could not connect to Redis."; exit 1; }
import os, time, sys
import redis
url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
r = redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
for _ in range(30):
    try:
        if r.ping():
            sys.exit(0)
    except Exception:
        time.sleep(1)
print("Failed to ping Redis after 30s")
sys.exit(1)
PY

# If a fixed RQ_WORKER_NAME was provided and is already taken, append a suffix.
# (By default we already use a unique name.)
export _RQ_NAME_CHECK="${RQ_WORKER_NAME}"
if python - <<'PY'
import os, sys, redis
name = os.environ["_RQ_NAME_CHECK"]
url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
r = redis.Redis.from_url(url)
# RQ stores worker info under key "rq:worker:<name>"
exists = r.exists(f"rq:worker:{name}")
sys.exit(10 if exists else 0)
PY
then
  : # name is free
else
  # 10 means name exists; generate a unique suffix
  if [[ $? -eq 10 ]]; then
    suffix="$(hostname 2>/dev/null || echo host)-$$-$RANDOM"
    echo "⚠️  Worker name '${RQ_WORKER_NAME}' already exists. Using '${RQ_WORKER_NAME}-${suffix}'."
    RQ_WORKER_NAME="${RQ_WORKER_NAME}-${suffix}"
  else
    echo "⚠️  Could not verify worker name uniqueness; proceeding with '${RQ_WORKER_NAME}'."
  fi
fi
unset _RQ_NAME_CHECK

echo "🔗 Starting RQ worker name=${RQ_WORKER_NAME}, queues=${RQ_QUEUES}, url=${REDIS_URL}"
echo "   Worker class: ${RQ_WORKER_CLASS}"

# Split queues on spaces
read -r -a _QUEUES <<< "${RQ_QUEUES}"

# NOTE: RQ CLI expects --logging_level (underscore), not --logging-level
exec rq worker \
  --url "${REDIS_URL}" \
  --name "${RQ_WORKER_NAME}" \
  --worker-class "${RQ_WORKER_CLASS}" \
  --logging_level "${RQ_LOG_LEVEL}" \
  -P "${ROOT_DIR}" \
  "${_QUEUES[@]}"
