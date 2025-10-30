#!/usr/bin/env bash
# Cross‑platform RQ worker launcher (macOS/Linux + Windows via Git Bash/WSL)
# - DOES NOT reinstall or modify .venv
# - Uses existing virtualenv if found (but never creates/updates it)
# - Waits for Redis using stdlib sockets (no redis-py dependency)
# - Ensures default worker name is unique without touching Redis
# - Picks the correct RQ logging flag regardless of RQ version
#
# Usage examples:
#   bash scripts/rq_worker.sh
#   REDIS_URL=redis://localhost:6380/0 RQ_QUEUES="high default" bash scripts/rq_worker.sh
#   RQ_WORKER_NAME=my-worker bash scripts/rq_worker.sh

set -euo pipefail

# --- Paths -------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DEFAULT="${ROOT_DIR}/.venv"
VENV="${VENV:-${VENV_DEFAULT}}"

# --- Load optional .env ------------------------------------------------------
if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env"
  set +a
fi

# --- Defaults ----------------------------------------------------------------
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
# Support legacy RQ_QUEUE then RQ_QUEUES (space‑separated list)
RQ_QUEUES="${RQ_QUEUES:-${RQ_QUEUE:-jobs}}"

# Unique default worker name to avoid collisions (no Redis lookup needed)
HOSTTAG="$(hostname 2>/dev/null || echo host)"
DEFAULT_WORKER_NAME="local-worker-${HOSTTAG}-${PPID:-$$}-${RANDOM}"
RQ_WORKER_NAME="${RQ_WORKER_NAME:-${DEFAULT_WORKER_NAME}}"
RQ_LOG_LEVEL="${RQ_LOG_LEVEL:-INFO}"    # DEBUG|INFO|WARNING|ERROR|CRITICAL

# --- Platform helpers --------------------------------------------------------
UNAME_S="$(uname -s || true)"
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]; }
is_windows() {
  case "${UNAME_S}" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Choose worker class (SimpleWorker is safest across platforms)
if [[ -z "${RQ_WORKER_CLASS:-}" ]]; then
  RQ_WORKER_CLASS="rq.worker.SimpleWorker"
fi

# --- Activate virtualenv if present (never creates/updates it) ---------------
if [ -f "${VENV}/bin/activate" ]; then
  # POSIX layout
  # shellcheck source=/dev/null
  source "${VENV}/bin/activate"
elif [ -f "${VENV}/Scripts/activate" ]; then
  # Windows venv (Git Bash layout)
  # shellcheck source=/dev/null
  # shellcheck disable=SC1091
  source "${VENV}/Scripts/activate"
fi

# Ensure PYTHONPATH contains project root so jobs can import local code
export PYTHONPATH="${ROOT_DIR}:${PYTHONPATH:-}"
export REDIS_URL RQ_QUEUES RQ_WORKER_CLASS RQ_WORKER_NAME RQ_LOG_LEVEL

# --- Tool checks -------------------------------------------------------------
# Use rq if available; otherwise try python -m rq to avoid Windows shim issues
RQ_INVOKE=(rq)
if ! command -v rq >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1 && python - <<'PY' >/dev/null 2>&1; then
import importlib, sys
mod = importlib.util.find_spec("rq") or importlib.util.find_spec("rq.cli")
sys.exit(0 if mod else 1)
PY
  then
    RQ_INVOKE=(python -m rq)
  else
    echo "ERROR: 'rq' not found on PATH and 'python -m rq' is unavailable." >&2
    echo "       Activate your venv or install RQ (e.g., 'pip install rq')." >&2
    exit 1
  fi
fi

# macOS fork-safety workaround (SimpleWorker already avoids fork)
if [[ "${UNAME_S}" == "Darwin" ]]; then
  export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
fi

# --- Wait for Redis to be reachable (no redis-py required) -------------------
echo "Waiting for Redis at ${REDIS_URL} ..."
python - <<'PY'
import os, sys, time, socket, urllib.parse
url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
p = urllib.parse.urlparse(url)
host = p.hostname or "localhost"
port = p.port or 6379
for _ in range(30):
    try:
        with socket.create_connection((host, port), timeout=1):
            sys.exit(0)
    except OSError:
        time.sleep(1)
print("Failed to connect to Redis after 30s")
sys.exit(1)
PY

# --- Determine correct logging flag for current RQ version -------------------
RQ_LOG_FLAG="--logging_level"
if "${RQ_INVOKE[@]}" worker --help 2>&1 | grep -q -- "--logging-level"; then
  RQ_LOG_FLAG="--logging-level"
fi

# --- Start worker ------------------------------------------------------------
echo "Starting RQ worker name=${RQ_WORKER_NAME}, queues=${RQ_QUEUES}, url=${REDIS_URL}"
echo "   Worker class: ${RQ_WORKER_CLASS}"

# Split queues on spaces
# shellcheck disable=SC2206
_QUEUES=( ${RQ_QUEUES} )

# Build command (array-safe)
cmd=("${RQ_INVOKE[@]}" worker --url "${REDIS_URL}" --name "${RQ_WORKER_NAME}" \
     --worker-class "${RQ_WORKER_CLASS}" "${RQ_LOG_FLAG}" "${RQ_LOG_LEVEL}" -P "${ROOT_DIR}")

# Exec
exec "${cmd[@]}" "${_QUEUES[@]}"
