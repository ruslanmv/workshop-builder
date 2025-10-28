#!/usr/bin/env bash
# Stop and clear ANY local Redis instance so ports are freed and names don't collide.
# Safe for macOS, Linux, and WSL.
#
# Usage:
#   bash scripts/redis_kill.sh            # uses defaults (PORT=6379, CONTAINER=wb-redis)
#   REDIS_PORT=6380 bash scripts/redis_kill.sh
#   REDIS_CONTAINER=my-redis bash scripts/redis_kill.sh
#
# What it does:
#   1) If ./scripts/redis_down.sh exists, runs it to remove the wb-redis container.
#   2) Kills any other Docker containers mapping the chosen port.
#   3) Terminates any local redis-server process listening on the port.
#   4) Verifies the port is free.

set -euo pipefail

PORT="${REDIS_PORT:-6379}"
NAME="${REDIS_CONTAINER:-wb-redis}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf "%s\n" "$*"; }
warn() { printf "\033[33m⚠️  %s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✅ %s\033[0m\n" "$*"; }
err()  { printf "\033[31m❌ %s\033[0m\n" "$*" 1>&2; }

port_in_use() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -lnt "( sport = :${p} )" 2>/dev/null | grep -q LISTEN && return 0 || return 1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || return 1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -E "[:.]${p}$" -q && return 0 || return 1
  else
    return 1
  fi
}

pids_on_port() {
  local p=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"${p}" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${p}" 2>/dev/null | tr ' ' '\n' || true
  elif command -v ss >/dev/null 2>&1; then
    ss -lptn "( sport = :${p} )" 2>/dev/null | sed -n '2,$p' | sed -E 's/.*pid=([0-9]+),.*/\1/' | sort -u || true
  else
    true
  fi
}

docker_ok() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

stop_wb_container() {
  if docker_ok; then
    if docker ps -a --format '{{.Names}}' | grep -q "^${NAME}$"; then
      log "🛑 Removing container ${NAME} ..."
      docker rm -f "${NAME}" >/dev/null 2>&1 || true
      ok "Removed ${NAME}"
    fi
  fi
}

stop_containers_on_port() {
  if ! docker_ok; then return 0; fi
  # Find any running container mapping host port :${PORT} to 6379 inside
  local ids
  ids=$(docker ps --format '{{.ID}} {{.Ports}}' | awk -v pat=":${PORT}->" '$0 ~ pat {print $1}')
  if [ -n "${ids}" ]; then
    log "🛑 Stopping containers publishing :${PORT} ..."
    # shellcheck disable=SC2086
    for id in ${ids}; do
      local name
      name=$(docker ps --filter "id=${id}" --format '{{.Names}}')
      log " - ${name} (${id})"
      docker rm -f "${id}" >/dev/null 2>&1 || true
    done
    ok "Stopped container(s) on port ${PORT}"
  fi
}

kill_local_redis() {
  # Prefer killing redis-server specifically
  local rpids
  rpids=$(pgrep -f 'redis-server' || true)
  if [ -n "${rpids}" ]; then
    log "🛑 Terminating local redis-server processes: ${rpids}"
    # shellcheck disable=SC2086
    kill ${rpids} 2>/dev/null || true
    sleep 1
  fi
  # Also kill any process listening on the port
  local ppids
  ppids=$(pids_on_port "${PORT}")
  if [ -n "${ppids}" ]; then
    log "🛑 Terminating processes on :${PORT}: ${ppids}"
    # shellcheck disable=SC2086
    kill ${ppids} 2>/dev/null || true
    sleep 1
    # Force kill if needed
    local still
    still=$(pids_on_port "${PORT}")
    if [ -n "${still}" ]; then
      warn "Forcing kill for: ${still}"
      # shellcheck disable=SC2086
      kill -9 ${still} 2>/dev/null || true
    fi
  fi
}

verify_free() {
  log "⏳ Verifying port ${PORT} is free ..."
  for i in $(seq 1 10); do
    if ! port_in_use "${PORT}"; then
      ok "Port ${PORT} is free."
      return 0
    fi
    sleep 0.5
  done
  if port_in_use "${PORT}"; then
    err "Port ${PORT} is STILL in use."
    pids_on_port "${PORT}" | sed 's/^/ - PID: /'
    return 1
  fi
}

log "🧹 Killing ANY Redis on port ${PORT}"
# 1) Use project script if available (removes wb-redis cleanly)
if [ -x "${ROOT_DIR}/scripts/redis_down.sh" ]; then
  bash "${ROOT_DIR}/scripts/redis_down.sh" || true
else
  stop_wb_container
fi
# 2) Any other docker containers bound to :PORT
stop_containers_on_port
# 3) Local processes
kill_local_redis
# 4) Verify
verify_free
ok "All Redis instances stopped and port ${PORT} cleared."