# scripts/rq_worker.sh
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${VENV:-${ROOT_DIR}/.venv}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
RQ_QUEUE="${RQ_QUEUE:-jobs}"

# activate venv if present
if [ -f "${VENV}/bin/activate" ]; then
  # shellcheck source=/dev/null
  source "${VENV}/bin/activate"
fi

export PYTHONPATH="${ROOT_DIR}:${PYTHONPATH:-}"
export REDIS_URL RQ_QUEUE

if ! command -v rq >/dev/null 2>&1; then
  echo "❌ 'rq' not found. Install it: pip install rq"
  exit 1
fi

echo "🔗 Connecting worker to ${REDIS_URL}, queue=${RQ_QUEUE}"
# -P / --path ensures the root is on sys.path for the worker process too
rq worker -u "${REDIS_URL}" -P "${ROOT_DIR}" "${RQ_QUEUE}"
