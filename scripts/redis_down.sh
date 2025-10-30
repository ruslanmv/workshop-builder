#!/usr/bin/env bash
# Cross‑platform Redis container remover (macOS, Linux, WSL, Git Bash)
# Safely removes a single container by name (default: wb-redis).
#
# Usage:
#   bash scripts/redis_down.sh
#   REDIS_CONTAINER=my-redis bash scripts/redis_down.sh

set -euo pipefail

NAME="${REDIS_CONTAINER:-wb-redis}"

# --- Pretty printing (fallback to plain text when not a TTY)
if [ -t 1 ]; then
  YELLOW='\033[33m'; GREEN='\033[32m'; BLUE='\033[34m'; RED='\033[31m'; RESET='\033[0m'
else
  YELLOW=""; GREEN=""; BLUE=""; RED=""; RESET=""
fi

log()  { printf "%s\n" "$*"; }
info() { printf "${BLUE}ℹ️  %s${RESET}\n" "$*"; }
ok()   { printf "${GREEN}✅ %s${RESET}\n" "$*"; }
warn() { printf "${YELLOW}⚠️  %s${RESET}\n" "$*"; }
err()  { printf "${RED}❌ %s${RESET}\n" "$*" 1>&2; }

# --- Docker presence/health checks (portable)
docker_installed() { command -v docker >/dev/null 2>&1; }
docker_running()   { docker info >/dev/null 2>&1; }

if ! docker_installed; then
  info "Docker CLI not found; nothing to stop."
  exit 0
fi

if ! docker_running; then
  info "Docker engine is not running; nothing to stop."
  exit 0
fi

# Find containers whose NAME exactly matches
IDS=$(docker ps -a --filter "name=^${NAME}$" --format '{{.ID}}' | tr '\n' ' ')

if [ -n "${IDS}" ]; then
  log "🛑 Removing container ${NAME} ..."
  # shellcheck disable=SC2086
  docker rm -f ${IDS} >/dev/null 2>&1 || true
  ok "${NAME} removed."
else
  info "No container named ${NAME} exists."
fi
