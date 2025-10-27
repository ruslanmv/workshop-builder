#!/usr/bin/env bash
set -euo pipefail

# Run an RQ worker attached to the same Redis as the API
# Use your venv if present

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${VENV:-${ROOT_DIR}/.venv}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
RQ_QUEUE="${RQ_QUEUE:-jobs}"

if [ -x "${VENV}/bin/activate" ] || [ -f "${VENV}/bin/activate" ]; then
  # shellcheck source=/dev/null
  source "${VENV}/bin/activate"
else
  echo "⚠️  Virtualenv not found at ${VENV}; proceeding with system Python."
fi

echo "🔗 Connecting worker to ${REDIS_URL}, queue=${RQ_QUEUE}"
export REDIS_URL RQ_QUEUE

# rq must be installed in the active Python env
if ! command -v rq >/dev/null 2>&1; then
  echo "❌ 'rq' not found. Install it with: pip install rq"
  exit 1
fi

rq worker -u "${REDIS_URL}" "${RQ_QUEUE}"
