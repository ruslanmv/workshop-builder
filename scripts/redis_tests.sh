#!/usr/bin/env bash
set -euo pipefail

# --- Config (env-overridable) ---
REDIS_CONTAINER_NAME="${REDIS_CONTAINER_NAME:-wb-redis}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"   # include password if needed: redis://:devsecret@localhost:6379/0
RQ_QUEUE="${RQ_QUEUE:-jobs}"
RQ_WAIT_SECONDS="${RQ_WAIT_SECONDS:-30}"
VENV="${VENV:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.venv}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Make sure the Python subprocess can see these
export REDIS_URL RQ_QUEUE RQ_WAIT_SECONDS

# Auto-activate venv if present (for rq + redis libs)
if [ -f "${VENV}/bin/activate" ]; then
  # shellcheck disable=SC1090
  source "${VENV}/bin/activate"
fi

needcmd() { command -v "$1" >/dev/null 2>&1 || { echo "❌ Missing dependency: $1"; exit 1; }; }
needcmd docker
needcmd python

# Extract REDIS_PASSWORD from URL if not provided (helps redis-cli auth inside the container)
if [ -z "${REDIS_PASSWORD:-}" ]; then
  REDIS_PASSWORD="$(python - <<'PY' 2>/dev/null || true
import os, urllib.parse
u = urllib.parse.urlparse(os.environ.get("REDIS_URL","redis://localhost:6379/0"))
print(u.password or "")
PY
)"
fi
AUTH_OPT=()
[ -n "${REDIS_PASSWORD}" ] && AUTH_OPT=( -a "${REDIS_PASSWORD}" )

echo "🔎 Using:"
echo "   - Container: ${REDIS_CONTAINER_NAME}"
echo "   - REDIS_URL: ${REDIS_URL}"
echo "   - Queue:     ${RQ_QUEUE}"

# Ensure container exists / is running
if ! docker ps -a --format '{{.Names}}' | grep -qx "${REDIS_CONTAINER_NAME}"; then
  echo "❌ Redis container '${REDIS_CONTAINER_NAME}' not found. Start it with ./scripts/redis_up.sh"
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "${REDIS_CONTAINER_NAME}"; then
  echo "⏩ Starting Redis container '${REDIS_CONTAINER_NAME}' ..."
  docker start "${REDIS_CONTAINER_NAME}" >/dev/null
fi

# 1) Ping test
echo "1) 🫀 Pinging Redis ..."
if docker exec "${REDIS_CONTAINER_NAME}" redis-cli "${AUTH_OPT[@]}" PING | grep -q "PONG"; then
  echo "   ✅ PONG"
else
  echo "   ❌ Failed to PING Redis via redis-cli"
  exit 2
fi

# 2) Read/Write round-trip
echo "2) ✍️  SET/GET round-trip ..."
KEY="smoketest:$(date +%s):$RANDOM"
VAL="ok-$RANDOM"
docker exec "${REDIS_CONTAINER_NAME}" redis-cli "${AUTH_OPT[@]}" SET "${KEY}" "${VAL}" EX 30 >/dev/null
OUT="$(docker exec "${REDIS_CONTAINER_NAME}" redis-cli "${AUTH_OPT[@]}" GET "${KEY}")"
if [ "${OUT}" = "${VAL}" ]; then
  echo "   ✅ SET/GET ok (key=${KEY})"
else
  echo "   ❌ SET/GET mismatch (got '${OUT}', expected '${VAL}')"
  exit 3
fi

# 3) RQ job end-to-end (requires a worker running on ${RQ_QUEUE})
echo "3) 🧵 RQ worker job (queue=${RQ_QUEUE}) ..."
python - <<'PY'
import os, sys, time
from redis import Redis
from rq import Queue

redis_url = os.environ.get("REDIS_URL") or "redis://localhost:6379/0"
qname = os.environ.get("RQ_QUEUE", "jobs")
wait_s = int(os.environ.get("RQ_WAIT_SECONDS", "30"))

conn = Redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2)
q = Queue(qname, connection=conn)

# Use stdlib function; pass the list directly (no extra tuple) to avoid TypeError
job = q.enqueue("math.fsum", [1.0, 2.0, 3.5], result_ttl=60, failure_ttl=60)

deadline = time.time() + wait_s
while time.time() < deadline:
    status = job.get_status(refresh=True)
    if status == "finished":
        res = job.result
        print(f"   -> job finished with result={res}")
        sys.exit(0 if abs(res - 6.5) < 1e-9 else 5)
    if status == "failed":
        print("   -> job FAILED")
        sys.exit(6)
    time.sleep(0.5)

print("   -> job TIMEOUT (no worker on this queue?)")
sys.exit(7)
PY
case $? in
  0) echo "   ✅ RQ job processed successfully";;
  5) echo "   ❌ RQ job result incorrect"; exit 5;;
  6) echo "   ❌ RQ job failed"; exit 6;;
  7) echo "   ❌ RQ job timeout (is your worker running on '${RQ_QUEUE}'?)"; exit 7;;
  *) echo "   ❌ Unknown RQ error"; exit 8;;
esac

# 4) Optional persistence check (restarts Redis; may disrupt running workers)
if [ "${TEST_PERSISTENCE:-0}" = "1" ]; then
  echo "4) 💾 Persistence check (will restart Redis container) ..."
  PKEY="persist:$(date +%s):$RANDOM"
  PVAL="persist-ok-$RANDOM"
  docker exec "${REDIS_CONTAINER_NAME}" redis-cli "${AUTH_OPT[@]}" SET "${PKEY}" "${PVAL}" >/dev/null
  docker restart "${REDIS_CONTAINER_NAME}" >/dev/null
  sleep 1
  GOT="$(docker exec "${REDIS_CONTAINER_NAME}" redis-cli "${AUTH_OPT[@]}" GET "${PKEY}")" || true
  if [ "${GOT}" = "${PVAL}" ]; then
    echo "   ✅ Key survived restart (${PKEY})"
  else
    echo "   ❌ Key did not survive restart"
    exit 9
  fi
fi

echo "🎉 All checks passed."
