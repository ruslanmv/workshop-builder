# Makefile — Cross‑Platform for Python 3.11
# Works on Windows (PowerShell/CMD/Git Bash) and Unix-like systems (Linux/macOS).

# =============================================================================
#  Configuration & Cross-Platform Setup
# =============================================================================

.DEFAULT_GOAL := run

# --- User-Configurable Variables ---
PYTHON ?= python3.11
VENV   ?= .venv

# Dev server ports
PORT_BACKEND  ?= 5000
PORT_FRONTEND ?= 5173

# RQ/Redis defaults (host-side worker)
REDIS_URL            ?= redis://localhost:6379/0
RQ_QUEUES            ?= jobs
RQ_WORKER_NAME       ?= local-worker
RQ_WORKER_LOG_LEVEL  ?= INFO
WB_REDIS_CONTAINER   ?= wb-redis

# --- OS Detection for Paths and Commands ---
ifeq ($(OS),Windows_NT)
# Use the Python launcher on Windows
PYTHON         := py -3.11
# Windows settings (PowerShell-safe)
PY_SUFFIX      := .exe
BIN_DIR        := Scripts
ACTIVATE       := $(VENV)\$(BIN_DIR)\activate
# Use $$null for PowerShell redirection
NULL_DEVICE    := $$null
RM             := Remove-Item -Force -ErrorAction SilentlyContinue
RMDIR          := Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
SHELL          := powershell.exe
.SHELLFLAGS    := -NoProfile -ExecutionPolicy Bypass -Command
# Reference to environment variables for PowerShell
ENVREF         := $$env:
# Docker volume source for PS (use the .Path of $PWD)
MOUNT_SRC      := "$$PWD.Path"
else
# Unix/Linux/macOS settings
PY_SUFFIX      :=
BIN_DIR        := bin
ACTIVATE       := . $(VENV)/$(BIN_DIR)/activate
NULL_DEVICE    := /dev/null
RM             := rm -f
RMDIR          := rm -rf
SHELL          := /bin/bash
.ONESHELL:
.SHELLFLAGS    := -eu -o pipefail -c
# Reference to environment variables for POSIX sh/bash
ENVREF         := $$
# Docker volume source for POSIX shells
MOUNT_SRC      := "$$\(pwd\)"
endif

# --- Derived Variables ---
PY_EXE  := $(VENV)/$(BIN_DIR)/python$(PY_SUFFIX)
PIP_EXE := $(VENV)/$(BIN_DIR)/pip$(PY_SUFFIX)
UV_EXE  := $(VENV)/$(BIN_DIR)/uv$(PY_SUFFIX)
# Use local uv path if not in VENV/BIN_DIR (Windows only)
UV_LOCAL_PATH ?= $$env:USERPROFILE\.local\bin\uv.exe

# Paths
INFRA_DIR ?= infra

.PHONY: help venv ensure-venv install pip-install dev uv-install update test lint fmt check shell clean distclean \
        clean-venv ensure-env check-ports \
        ui-build ui-dev run run-api run-ui run-local redis-up redis-stop redis-down wait-redis wait-api redis-worker monitor-worker redis-url kill-ports api-free-port ui-free-port python-version \
        build-infra run-infra stop-infra monitor-infra \
        e2e e2e-infra wait-infra \
        check-python check-pyproject check-uv check-node

# =============================================================================
#  Helper Scripts (exported env vars; expanded by the shell)
# =============================================================================

export HELP_SCRIPT
define HELP_SCRIPT
import re, sys, io
print('Usage: make <target> [OPTIONS...]\n')
print('Available targets:\n')
mf = '$(firstword $(MAKEFILE_LIST))'
with io.open(mf, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        m = re.match(r'^([a-zA-Z0-9_.-]+):.*?## (.*)$$', line)
        if m:
            target, help_text = m.groups()
            print('  {0:<22} {1}'.format(target, help_text))
endef

export CLEAN_SCRIPT
define CLEAN_SCRIPT
import glob, os, shutil, sys
patterns = ['*.pyc', '*.pyo', '*~', '*.egg-info', '__pycache__', 'build', 'dist', '.mypy_cache', '.pytest_cache', '.ruff_cache']
to_remove = set()
for p in patterns:
    to_remove.update(glob.glob('**/' + p, recursive=True))
for path in sorted(to_remove, key=len, reverse=True):
    try:
        if os.path.isfile(path) or os.path.islink(path):
            os.remove(path)
        elif os.path.isdir(path):
            shutil.rmtree(path)
    except OSError as e:
        print('Error removing {0}: {1}'.format(path, e), file=sys.stderr)
endef

# =============================================================================
#  Core Targets
# =============================================================================

help: ## Show this help message
ifeq ($(OS),Windows_NT)
	@& $(PYTHON) -X utf8 -c "$(ENVREF)HELP_SCRIPT"
else
	@$(PYTHON) -X utf8 -c "$(ENVREF)HELP_SCRIPT"
endif

# --- Local Python Environment ---

# IMPORTANT: check-python is order-only; does not force rebuilds
ifeq ($(OS),Windows_NT)
$(VENV): | check-python
	@if (Test-Path '$(VENV)\Scripts\python.exe') { Write-Host "✅ Virtual env already exists at $(VENV)" } else { Write-Host "Creating virtual environment at $(VENV)..."; & $$env:ComSpec /c "taskkill /F /IM python.exe >NUL 2>&1 || exit 0"; Start-Sleep -Milliseconds 200; & $(PYTHON) -m venv '$(VENV)'; & '$(VENV)\Scripts\python.exe' -m pip install --upgrade pip; & '$(VENV)\Scripts\python.exe' -V | ForEach-Object { "✅ Created $(VENV) with $$_" } }
else
$(VENV): | check-python
	@if [ -x "$(VENV)/bin/python" ]; then echo "✅ Virtual env already exists at $(VENV)"; else echo "Creating virtual environment at $(VENV)..."; $(PYTHON) -m venv "$(VENV)"; "$(VENV)/bin/python" -m pip install --upgrade pip; echo "✅ Created $(VENV) with $$\("$(VENV)/bin/python" -V\)"; fi
endif

# Create venv only (no dependency sync)
ensure-venv: $(VENV) ## Ensure the virtual environment exists (no uv sync)
	# (no-op)

# Default workflow: uv is the installer
venv: ensure-venv ## [pip] Create the virtual environment if it does not exist

install: uv-install ## Install project using uv (default)

dev: uv-install ## Install project in dev mode using uv (default)

pip-install: ensure-venv check-pyproject ## [pip] Install project in non-editable mode
	@$(PIP_EXE) install .; echo "✅ Installed project into $(VENV) using pip"

# -----------------------------------------------------------------------------
#  Dependency sync that DOESN'T rerun on every `make run`
# -----------------------------------------------------------------------------
ENSURE_DEPS := pyproject.toml
ifneq (,$(wildcard uv.lock))
ENSURE_DEPS += uv.lock
endif

# uv sync runs only when pyproject/uv.lock change
.venv/.uv.stamp: $(ENSURE_DEPS) | $(VENV) check-uv
ifeq ($(OS),Windows_NT)
	@Write-Host "🔄 Syncing environment with uv..."; $$uv=(Get-Command uv -ErrorAction SilentlyContinue); if(-not $$uv){ $$cand='$(UV_LOCAL_PATH)'; if(Test-Path $$cand){ $$uv=Get-Item $$cand } }; if(-not $$uv){ Write-Error "Error: uv not found (after check-uv)"; exit 1 }; & $$uv.Path sync; if(-not (Test-Path '.venv')){ New-Item -ItemType Directory -Path '.venv' | Out-Null }; Set-Content -Path '.venv/.uv.stamp' -Value (Get-Date -Format o) | Out-Null; Write-Host "✅ Dependencies synchronized"
else
	@echo "🔄 Syncing environment with uv..."; uv sync; mkdir -p .venv; date > .venv/.uv.stamp; echo "✅ Dependencies synchronized"
endif

ensure-env: .venv/.uv.stamp ## Ensure venv is present and uv is synced when deps change
	# (no-op)

uv-install: ensure-env ## [uv] Create venv & install all dependencies (idempotent)

update: check-pyproject ## Upgrade/sync dependencies (prefers uv if available)
ifeq ($(OS),Windows_NT)
	@$$uvCmd = (Get-Command uv -ErrorAction SilentlyContinue); if (-not $$uvCmd) { $$uvCmd = Join-Path $$env:USERPROFILE '.local\bin\uv.exe' }; if (Test-Path $$uvCmd) { Write-Host 'Syncing with uv...'; & $$uvCmd sync; if(-not (Test-Path '.venv')){ New-Item -ItemType Directory -Path '.venv' | Out-Null }; Set-Content -Path '.venv/.uv.stamp' -Value (Get-Date -Format o) | Out-Null; Write-Host '✅ Project and dependencies upgraded (uv)'; } else { Write-Host 'uv not found, falling back to pip...'; if (-not (Test-Path '$(VENV)\Scripts\python.exe')) { & $(PYTHON) -m venv '$(VENV)'; & '$(VENV)\Scripts\python.exe' -m pip install -U pip }; & '$(VENV)\Scripts\python.exe' -m pip install -U -e ".[dev]"; Write-Host '✅ Project and dependencies upgraded (pip fallback)'; }
else
	@{ if command -v uv >$(NULL_DEVICE) 2>&1; then echo "Syncing with uv..."; uv sync; else echo "uv not found, falling back to pip..."; [ -x "$(VENV)/bin/python" ] || $(PYTHON) -m venv "$(VENV)"; "$(VENV)/bin/python" -m pip install -U pip; "$(VENV)/bin/pip" install -U -e ".[dev]"; fi; } && touch .venv/.uv.stamp && echo "✅ Project and dependencies upgraded"
endif

# --- Development & QA ---

test: ensure-env ## Run tests with pytest
	@echo "🧪 Running tests..."; $(PY_EXE) -m pytest

lint: ensure-env ## Check code style with ruff
	@echo "🔍 Linting with ruff..."; $(PY_EXE) -m ruff check .

fmt: ensure-env ## Format code with ruff
	@echo "🎨 Formatting with ruff..."; $(PY_EXE) -m ruff format .

check: lint test ## Run all checks (linting and testing)

# --- UI ---

ui-build: check-node ## Build React UI with Vite (outputs to ui/dist)
ifeq ($(OS),Windows_NT)
	@bash scripts/build_ui.sh
else
	@bash scripts/build_ui.sh
endif

ui-dev: check-node ## Start only the Vite frontend dev server
ifeq ($(OS),Windows_NT)
	@cd ui; if (!(Test-Path node_modules)) { npm ci } ; npm run dev -- --port $(PORT_FRONTEND)
else
	@cd ui && ([ -d node_modules ] || npm ci) && npm run dev -- --port $(PORT_FRONTEND)
endif

# --- Start only the FastAPI backend (uvicorn --reload) ---

run-api: ensure-venv ## Start only the FastAPI backend (uvicorn --reload)
ifeq ($(OS),Windows_NT)
	@& "$(VENV)\Scripts\python.exe" -m uvicorn server.main:app --reload --host 0.0.0.0 --port $(PORT_BACKEND)
else
	@"$(PY_EXE)" -m uvicorn server.main:app --reload --host 0.0.0.0 --port $(PORT_BACKEND)
endif

# =============================================================================
#  Local Dev Orchestration (Redis via script → Worker → API → UI)
# =============================================================================

# Bring up Redis using our custom script (builds image, handles port collisions, waits for health)
redis-up: ## Start Redis via scripts/redis_up.sh (wb-redis container)
ifeq ($(OS),Windows_NT)
	@bash scripts/redis_up.sh
else
	@bash scripts/redis_up.sh
endif

# Gracefully stop the wb-redis container (without removing it)
redis-stop: ## Stop wb-redis container (kept for later restart)
ifeq ($(OS),Windows_NT)
	@if ((docker ps --format '{{.Names}}' | Select-String -SimpleMatch '^$(WB_REDIS_CONTAINER)$$' 2>$(NULL_DEVICE))) { docker stop $(WB_REDIS_CONTAINER) | Out-Null; Write-Host '🛑 Stopped $(WB_REDIS_CONTAINER).' } else { Write-Host 'ℹ️  $(WB_REDIS_CONTAINER) is not running.' }
else
	@{ docker ps --format '{{.Names}}' | grep -q '^$(WB_REDIS_CONTAINER)$$'; } && { docker stop $(WB_REDIS_CONTAINER) >/dev/null && echo '🛑 Stopped $(WB_REDIS_CONTAINER).'; } || echo 'ℹ️  $(WB_REDIS_CONTAINER) is not running.'
endif

# Stop **and remove** the container via our script
redis-down: ## Remove wb-redis container (uses scripts/redis_down.sh)
ifeq ($(OS),Windows_NT)
	@bash scripts/redis_down.sh
else
	@bash scripts/redis_down.sh
endif

# Helper: print the effective REDIS_URL by inspecting the wb-redis port mapping
redis-url: ## Print resolved redis://localhost:<port>/0 from wb-redis
ifeq ($(OS),Windows_NT)
	@$port = (& docker port $(WB_REDIS_CONTAINER) 6379/tcp 2>$(NULL_DEVICE) | Select-Object -First 1); if (-not $$port) { $$port = '127.0.0.1:6379' }; $hp = ($$port -split ':' )[-1]; Write-Host "redis://localhost:$$hp/0"
else
	@HP=$$(docker port $(WB_REDIS_CONTAINER) 6379/tcp 2>/dev/null | head -n1 | awk -F: '{print $$NF}'); [ -n "$$HP" ] || HP=6379; echo "redis://localhost:$$HP/0"
endif

# Wait for Redis by checking container health / redis-cli PING inside the container
wait-redis: ## Ensure wb-redis is healthy and answers PING
ifeq ($(OS),Windows_NT)
	@$max=45; $ok=$False; for ($i=0; $i -lt $max; $i++) { try { $h = & docker inspect -f '{{.State.Health.Status}}' $(WB_REDIS_CONTAINER) 2>$(NULL_DEVICE); if ($h -eq 'healthy') { $ok=$True; break } } catch {} ; Start-Sleep -Seconds 1 }; if (-not $ok) { Write-Error "wb-redis not healthy in time"; exit 1 }; & docker exec $(WB_REDIS_CONTAINER) redis-cli ping | Out-Null; Write-Host "✅ Redis is ready."
else
	@for i in $$(seq 1 45); do st=$$(docker inspect -f '{{.State.Health.Status}}' $(WB_REDIS_CONTAINER) 2>/dev/null || echo starting); [ "$$st" = healthy ] && break; sleep 1; test $$i -eq 45 && { echo '❌ wb-redis not healthy in time' >&2; exit 1; } || true; done; docker exec $(WB_REDIS_CONTAINER) redis-cli ping >/dev/null && echo "✅ Redis is ready." || { echo '❌ redis-cli ping failed' >&2; exit 1; }
endif

# Start a local RQ worker (host process) that connects to the host Redis (resolved port)
redis-worker: ensure-venv wait-redis ## Start host RQ worker (connects to resolved REDIS_URL; no uv sync)
ifeq ($(OS),Windows_NT)
	@if (!(Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }; $port = (& docker port $(WB_REDIS_CONTAINER) 6379/tcp 2>$(NULL_DEVICE) | Select-Object -First 1); if (-not $$port) { $$port = '127.0.0.1:6379' }; $hp = ($$port -split ':' )[-1]; $id = [System.Guid]::NewGuid().ToString('N').Substring(0,8); $env:REDIS_URL = "redis://localhost:$$hp/0"; $env:RQ_QUEUES = "$(RQ_QUEUES)"; $env:RQ_WORKER_NAME = "$(RQ_WORKER_NAME)-$$id"; $env:RQ_LOG_LEVEL = "$(RQ_WORKER_LOG_LEVEL)"; bash scripts/rq_worker.sh 2>&1 | Tee-Object -FilePath 'logs\worker.log' -Append
else
	@mkdir -p logs; HP=$$(docker port $(WB_REDIS_CONTAINER) 6379/tcp 2>/dev/null | head -n1 | awk -F: '{print $$NF}'); [ -n "$$HP" ] || HP=6379; UNIQ=$$(hostname)-$$PPID-$$RANDOM; REDIS_URL="redis://localhost:$$HP/0" RQ_QUEUES="$(RQ_QUEUES)" RQ_WORKER_NAME="$(RQ_WORKER_NAME)-$$UNIQ" RQ_LOG_LEVEL="$(RQ_WORKER_LOG_LEVEL)" bash scripts/rq_worker.sh 2>&1 | tee -a logs/worker.log
endif

# Stream worker logs from logs/worker.log
monitor-worker: ## Tail worker logs (Ctrl-C to stop)
ifeq ($(OS),Windows_NT)
	@if (!(Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }; if (!(Test-Path 'logs\worker.log')) { New-Item -ItemType File -Path 'logs\worker.log' | Out-Null }; Write-Host "📜 Tailing logs\\worker.log (Ctrl-C to stop)..."; Get-Content -Path 'logs\worker.log' -Wait -Encoding UTF8
else
	@mkdir -p logs; touch logs/worker.log; echo "📜 Tailing logs/worker.log (Ctrl-C to stop)..."; tail -F logs/worker.log
endif

wait-api: ## Wait until API health endpoint returns 200 (robust)
ifeq ($(OS),Windows_NT)
	@Write-Host "⏳ Waiting for API health at http://localhost:$(PORT_BACKEND)/healthz ..."; $timeout = [TimeSpan]::FromSeconds(90); $sw = [Diagnostics.Stopwatch]::StartNew(); $ok=$False; while ($sw.Elapsed -lt $timeout) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$(PORT_BACKEND)/healthz" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$True; break } } catch {} ; Start-Sleep -Seconds 1 }; if (-not $ok) { Write-Error "API did not become healthy in time."; exit 1 } else { Write-Host "✅ API is healthy." }
else
	@echo "⏳ Waiting for API health at http://localhost:$(PORT_BACKEND)/healthz ..."; count=0; until curl -fsS "http://localhost:$(PORT_BACKEND)/healthz" >/dev/null 2>&1; do sleep 1; count=$$((count+1)); if [ $$count -ge 90 ]; then echo "❌ API did not become healthy in time." >&2; exit 1; fi; done; echo "✅ API is healthy."
endif

# --- Port utilities -----------------------------------------------------------
api-free-port: ## Kill any process using PORT_BACKEND
ifeq ($(OS),Windows_NT)
	@$port=$(PORT_BACKEND); Write-Host "🔪 Freeing port $$port ..."; $conns = Get-NetTCPConnection -LocalPort $$port -State Listen -ErrorAction SilentlyContinue; if ($conns) { ($conns | Select-Object -ExpandProperty OwningProcess -Unique) | ForEach-Object { try { Stop-Process -Id $$_ -Force -ErrorAction SilentlyContinue } catch {} } }
else
	@p=$(PORT_BACKEND); echo "🔪 Freeing port $$p ..."; (lsof -t -iTCP:$$p -sTCP:LISTEN 2>/dev/null | xargs -r kill) || true; sleep 0.3; (lsof -t -iTCP:$$p -sTCP:LISTEN 2>/dev/null | xargs -r kill -9) || true; (command -v fuser >/dev/null 2>&1 && fuser -k $$p/tcp >/dev/null 2>&1) || true
endif

ui-free-port: ## Kill any process using PORT_FRONTEND
ifeq ($(OS),Windows_NT)
	@$port=$(PORT_FRONTEND); Write-Host "🔪 Freeing port $$port ..."; $conns = Get-NetTCPConnection -LocalPort $$port -State Listen -ErrorAction SilentlyContinue; if ($conns) { ($conns | Select-Object -ExpandProperty OwningProcess -Unique) | ForEach-Object { try { Stop-Process -Id $$_ -Force -ErrorAction SilentlyContinue } catch {} } }
else
	@p=$(PORT_FRONTEND); echo "🔪 Freeing port $$p ..."; (lsof -t -iTCP:$$p -sTCP:LISTEN 2>/dev/null | xargs -r kill) || true; sleep 0.3; (lsof -t -iTCP:$$p -sTCP:LISTEN 2>/dev/null | xargs -r kill -9) || true; (command -v fuser >/dev/null 2>&1 && fuser -k $$p/tcp >/dev/null 2>&1) || true
endif

# Check ports only (don't kill) — used by run-local per your request
check-ports: ## Ensure Redis(6379), API($(PORT_BACKEND)), UI($(PORT_FRONTEND)) ports are free; otherwise fail
ifeq ($(OS),Windows_NT)
	@Write-Host ("🔎 Checking ports: Redis 6379, API {0}, UI {1} ..." -f $(PORT_BACKEND), $(PORT_FRONTEND)); $ports = @(6379, $(PORT_BACKEND), $(PORT_FRONTEND)); $busy=@(); foreach ($p in $ports) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { $owners = ($c | Select-Object -ExpandProperty OwningProcess -Unique) -join ','; Write-Warning ("Port {0} is in use by PID(s): {1}" -f $p, $owners); $busy += $p } }; if ($busy.Count -gt 0) { Write-Error "Some required ports are busy. Run 'make kill-ports' or change PORT_* variables."; exit 1 } else { Write-Host "✅ All required ports are free." }
else
	@ports=(6379 $(PORT_BACKEND) $(PORT_FRONTEND)); busy=0; for p in "$$ports[@]"; do if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "⚠️  Port $$p is in use"; busy=1; elif command -v ss >/dev/null 2>&1 && ss -lnt "( sport = :$$p )" 2>/dev/null | grep -q LISTEN; then echo "⚠️  Port $$p is in use"; busy=1; elif command -v netstat >/dev/null 2>&1 && netstat -lnt 2>/dev/null | awk '{print $$4}' | grep -E "[:.]$$p$$" -q; then echo "⚠️  Port $$p is in use"; busy=1; fi; done; [ $$busy -eq 0 ] && echo "✅ All required ports are free." || { echo "❌ Some required ports are busy. Run 'make kill-ports' or change PORT_* variables." >&2; exit 1; }
endif

# Kill project ports when you explicitly ask
kill-ports: ## Kill all project ports (Redis 6379 via script, API $(PORT_BACKEND), UI $(PORT_FRONTEND))
ifeq ($(OS),Windows_NT)
	@Write-Host ("Cleaning Redis, API ({0}), UI ({1}) ports..." -f $(PORT_BACKEND), $(PORT_FRONTEND)); if (Get-Command bash -ErrorAction SilentlyContinue) { bash scripts/redis_kill.sh } else { Write-Host "(redis_kill skipped: bash not found)" }; $$ports = @($(PORT_BACKEND), $(PORT_FRONTEND)); foreach ($$p in $$ports) { Write-Host ("Freeing port {0} ..." -f $$p); $$c = Get-NetTCPConnection -LocalPort $$p -State Listen -ErrorAction SilentlyContinue; if ($$c) { ($$c | Select-Object -ExpandProperty OwningProcess -Unique) | ForEach-Object { try { Stop-Process -Id $$_ -Force -ErrorAction SilentlyContinue } catch {} } } }
else
	@echo "Cleaning Redis, API ($(PORT_BACKEND)), UI ($(PORT_FRONTEND)) ports..."; bash scripts/redis_kill.sh || true; for p in $(PORT_BACKEND) $(PORT_FRONTEND); do echo "Freeing port $$p ..."; (lsof -t -iTCP:$$p -sTCP:LISTEN 2>/dev/null | xargs -r kill) || true; sleep 0.3; (lsof -t -iTCP:$$p -sTCP:LISTEN 2>/dev/null | xargs -r kill -9) || true; (command -v fuser >/dev/null 2>&1 && fuser -k $$p/tcp >/dev/null 2>&1) || true; done
endif

# --- Node tooling check -------------------------------------------------------
check-node: ## Ensure Node.js/npm are available (adds to PATH on Windows if needed)
ifeq ($(OS),Windows_NT)
	@Write-Host "Checking for Node/npm..."; $$npmCmd = Get-Command npm -ErrorAction SilentlyContinue; if (-not $$npmCmd) { $$cand1 = Join-Path $$env:ProgramFiles 'nodejs\\npm.cmd'; $$cand2 = Join-Path $$env:LOCALAPPDATA 'Programs\\node\\npm.cmd'; $$pick = $$null; if (Test-Path $$cand1) { $$pick = $$cand1 } elseif (Test-Path $$cand2) { $$pick = $$cand2 }; if ($$pick) { $$npmCmd = Get-Item $$pick; $$dir = $$npmCmd.DirectoryName; if ($$env:Path -notlike ("*" + $$dir + "*")) { $$env:Path = "$$dir;$$env:Path" } } }; if (-not $$npmCmd) { Write-Error "npm not found. Install Node.js LTS and ensure npm is on PATH (e.g. 'winget install OpenJS.NodeJS.LTS')."; exit 1 }; $$nodeCmd = Get-Command node -ErrorAction SilentlyContinue; if (-not $$nodeCmd) { $$dir = $$npmCmd.DirectoryName; $$nodeExe = Join-Path $$dir 'node.exe'; if (Test-Path $$nodeExe -and $$env:Path -notlike ("*" + $$dir + "*")) { $$env:Path = "$$dir;$$env:Path" } }; Write-Host ("✅ Node {0}, npm {1}" -f (& node -v), (& $$npmCmd.Path -v))
else
	@command -v npm >/dev/null 2>&1 || { echo "Error: npm not found. Install Node.js LTS (https://nodejs.org/)"; exit 1; }; echo "✅ Node $$(node -v), npm $$(npm -v)"
endif

#  run-local orchestrates: Redis (script) → Worker (host) → API (uvicorn) → UI (vite)
run-local: ensure-venv check-ports redis-up check-node ## Start full local dev stack; Ctrl-C to stop
ifeq ($(OS),Windows_NT)
	@Write-Host "▶ Starting Worker, FastAPI (http://localhost:$(PORT_BACKEND)) and Vite (http://localhost:$(PORT_FRONTEND))"; $$npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Path; if (-not $$npmCmd) { Write-Error "npm not found after check-node."; exit 1 }; $$workerJob = Start-Job -Name wb_worker -ScriptBlock { param($$root,$$queues,$$name,$$lvl,$$redisName); Set-Location -Path $$root; $$log = Join-Path $$root 'logs\worker.log'; if (!(Test-Path (Split-Path $$log))) { New-Item -ItemType Directory -Path (Split-Path $$log) | Out-Null }; $$port = (& docker port $$redisName 6379/tcp 2>$$null | Select-Object -First 1); if (-not $$port) { $$port = '127.0.0.1:6379' }; $$hp = ($$port -split ':' )[-1]; $$id = [System.Guid]::NewGuid().ToString('N').Substring(0,8); $$env:REDIS_URL = "redis://localhost:$$hp/0"; $$env:RQ_QUEUES=$$queues; $$env:RQ_WORKER_NAME = "$$name-$$id"; $$env:RQ_LOG_LEVEL=$$lvl; bash scripts/rq_worker.sh *>> $$log } -ArgumentList $$PWD.Path,"$(RQ_QUEUES)","$(RQ_WORKER_NAME)","$(RQ_WORKER_LOG_LEVEL)","$(WB_REDIS_CONTAINER)"; Start-Sleep -Seconds 2; $$apiJob = Start-Job -Name wb_api -ScriptBlock { param($$root,$$venv,$$port); Set-Location -Path $$root; & "$$venv\Scripts\python.exe" -m uvicorn server.main:app --reload --host 0.0.0.0 --port $$port } -ArgumentList $$PWD.Path,"$(VENV)",$(PORT_BACKEND); try { Push-Location ui; if (!(Test-Path node_modules)) { if (Test-Path package-lock.json) { & "$$npmCmd" ci } else { & "$$npmCmd" install } }; & "$$npmCmd" run dev -- --port $(PORT_FRONTEND); Pop-Location } finally { Write-Host "⏹  Stopping UI/API/Worker..."; Stop-Job $$apiJob -ErrorAction SilentlyContinue; Remove-Job $$apiJob -ErrorAction SilentlyContinue; Stop-Job $$workerJob -ErrorAction SilentlyContinue; Remove-Job $$workerJob -ErrorAction SilentlyContinue }
else
	@echo "▶ Starting Worker, FastAPI (http://localhost:$(PORT_BACKEND)) and Vite (http://localhost:$(PORT_FRONTEND))"; \
	STOPPED=0; API_PID=; UI_PID=; WORKER_PID=; \
	cleanup() { if [ $$STOPPED -eq 0 ]; then STOPPED=1; echo "\n⏹  Stopping services..."; [ -n "$$UI_PID" ] && kill $$UI_PID 2>/dev/null || true; [ -n "$$API_PID" ] && kill $$API_PID 2>/dev/null || true; [ -n "$$WORKER_PID" ] && kill $$WORKER_PID 2>/dev/null || true; wait $$UI_PID $$API_PID $$WORKER_PID 2>/dev/null || true; fi; }; \
	trap cleanup INT TERM EXIT; \
	mkdir -p logs; \
	HP=$$(docker port $(WB_REDIS_CONTAINER) 6379/tcp 2>/dev/null | head -n1 | awk -F: '{print $$NF}'); [ -n "$$HP" ] || HP=6379; \
	UNIQ=$$(hostname)-$$PPID-$$RANDOM; \
	REDIS_URL="redis://localhost:$$HP/0" RQ_QUEUES="$(RQ_QUEUES)" RQ_WORKER_NAME="$(RQ_WORKER_NAME)-$$UNIQ" RQ_LOG_LEVEL="$(RQ_WORKER_LOG_LEVEL)" bash scripts/rq_worker.sh >>logs/worker.log 2>&1 & WORKER_PID=$$!; \
	sleep 1; \
	"$(PY_EXE)" -m uvicorn server.main:app --reload --host 0.0.0.0 --port $(PORT_BACKEND) & API_PID=$$!; \
	$(MAKE) -s wait-api; \
	cd ui; [ -d node_modules ] || npm ci || npm install; npm run dev -- --port $(PORT_FRONTEND) & UI_PID=$$!; \
	wait $$UI_PID $$API_PID $$WORKER_PID
endif

# Keep backward-compatibility with previous 'run' name
run: run-local ## Alias for run-local (Redis → Worker → API → UI)

# =============================================================================
#  Infra (Docker Compose) Helpers (full stack)
# =============================================================================
# These auto-detect Compose v2 (docker compose) vs v1 (docker-compose)

build-infra: ## Build all Docker images in infra/docker-compose.yml
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; if (Get-Command docker -ErrorAction SilentlyContinue) { docker compose version > $(NULL_DEVICE) 2>&1; if ($$LASTEXITCODE -eq 0) { docker compose build } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose build } else { Write-Error '❌ Docker Compose not found. Install Docker Desktop or docker-compose.'; Pop-Location; exit 1 } } else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; Pop-Location
else
	@(cd "$(INFRA_DIR)" && { docker compose build || docker-compose build; })
endif

run-infra: ## Start the full stack in background (api, worker, redis, web)
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; if (Get-Command docker -ErrorAction SilentlyContinue) { docker compose version > $(NULL_DEVICE) 2>&1; if ($$LASTEXITCODE -eq 0) { docker compose up -d } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose up -d } else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 } } else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; Pop-Location; $(MAKE) -s wait-infra
else
	@(cd "$(INFRA_DIR)" && { docker compose up -d || docker-compose up -d; }); $(MAKE) -s wait-infra
endif

e2e-infra: ## Run the E2E test inside the api container
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; if (docker compose version > $(NULL_DEVICE) 2>&1) { docker compose exec api python examples/test_workshop.py --key dev-key-123 --tenant public } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose exec api python examples/test_workshop.py --key dev-key-123 --tenant public } else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 }; Pop-Location
else
	@(cd "$(INFRA_DIR)" && { docker compose exec api python examples/test_workshop.py --key dev-key-123 --tenant public || docker-compose exec api python examples/test_workshop.py --key dev-key-123 --tenant public; })
endif

stop-infra: ## Stop and remove the stack (containers, networks)
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; if (Get-Command docker -ErrorAction SilentlyContinue) { docker compose version > $(NULL_DEVICE) 2>&1; if ($$LASTEXITCODE -eq 0) { docker compose down --remove-orphans } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose down --remove-orphans } else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 } } else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; Pop-Location
else
	@(cd "$(INFRA_DIR)" && { docker compose down --remove-orphans || docker-compose down --remove-orphans; })
endif

monitor-infra: ## Tail logs for all services (Ctrl-C to stop)
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; if (Get-Command docker -ErrorAction SilentlyContinue) { docker compose version > $(NULL_DEVICE) 2>&1; if ($$LASTEXITCODE -eq 0) { docker compose logs -f } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose logs -f } else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 } } else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; Pop-Location
else
	@(cd "$(INFRA_DIR)" && { docker compose logs -f || docker-compose logs -f; })
endif

# --- Infra health + E2E helpers ---
wait-infra: ## Wait for API at http://localhost/api/health
ifeq ($(OS),Windows_NT)
	@Write-Host "⏳ Waiting for API health at http://localhost/api/health ..."; $timeout = [TimeSpan]::FromSeconds(90); $sw = [Diagnostics.Stopwatch]::StartNew(); $ok=$False; while ($sw.Elapsed -lt $timeout) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost/api/health" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$True; break } } catch {} ; Start-Sleep -Seconds 1 }; if (-not $ok) { Write-Error "API did not become healthy in time."; exit 1 } else { Write-Host "🌐 UI:  http://localhost/"; Write-Host "🧰 API: http://localhost/api"; Write-Host "✅ API is healthy." }
else
	@echo "⏳ Waiting for API health at http://localhost/api/health ..."; count=0; until curl -fsS "http://localhost/api/health" >/dev/null 2>&1; do sleep 1; count=$$((count+1)); if [ $$count -ge 90 ]; then echo "❌ API did not become healthy in time." >&2; exit 1; fi; done; echo "🌐 UI:  http://localhost/"; echo "🧰 API: http://localhost/api"; echo "✅ API is healthy."
endif

e2e: ensure-env ## Run end-to-end smoke test against the running stack (host)
ifeq ($(OS),Windows_NT)
	@& $(PYTHON) examples/test_workshop.py --key dev-key-123 --tenant public
else
	@"$(PY_EXE)" examples/test_workshop.py --key dev-key-123 --tenant public
endif

# =============================================================================
#  Utility
# =============================================================================

python-version: check-python ## Show resolved Python interpreter and version
ifeq ($(OS),Windows_NT)
	@echo "Using: $(PYTHON)"; & $(PYTHON) -V
else
	@echo "Using: $(PYTHON)"; $(PYTHON) -V
endif

shell: ensure-venv ## Show how to activate the virtual environment shell
	@echo "Virtual environment is ready."; echo "To activate it, run:"; echo "  On Windows (CMD/PowerShell): .\\$(VENV)\\Scripts\\Activate.ps1"; echo "  On Unix (Linux/macOS/Git Bash): source $(VENV)/bin/activate"

clean-venv: ## Force-remove the venv (kills python.exe on Windows)
ifeq ($(OS),Windows_NT)
	@& $$env:ComSpec /c "taskkill /F /IM python.exe >NUL 2>&1 || exit 0"; Start-Sleep -Milliseconds 200; if (Test-Path '.venv'){ Remove-Item -Recurse -Force '.venv' }
else
	@rm -rf .venv
endif

clean: ## Remove Python artifacts, caches, and the virtualenv
	@echo "Cleaning project..."; -$(RMDIR) $(VENV); -$(RMDIR) .pytest_cache; -$(RMDIR) .ruff_cache
ifeq ($(OS),Windows_NT)
	@& $(PYTHON) -c "$(ENVREF)CLEAN_SCRIPT"
else
	@$(PYTHON) -c "$(ENVREF)CLEAN_SCRIPT"
endif
	@echo "Clean complete."

# -----------------------------------------------------------------------------
#  uv bootstrap & checks
# -----------------------------------------------------------------------------

# Keep python check very small so it can't break on PS one-liners
ifeq ($(OS),Windows_NT)
check-python:
	@echo "Checking for a Python 3.11 interpreter..."; & $(PYTHON) -c "import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)" 2>$(NULL_DEVICE); if ($$LASTEXITCODE -ne 0) { echo "Error: '$(PYTHON)' is not Python 3.11."; echo "Please install Python 3.11 and add it to your PATH,"; echo "or specify via: make install PYTHON='py -3.11'"; exit 1 }; echo "Found Python 3.11:"; & $(PYTHON) -V

check-pyproject:
	@if (Test-Path -LiteralPath 'pyproject.toml') { echo 'Found pyproject.toml' } else { echo ('Error: pyproject.toml not found in ' + (Get-Location)); exit 1 }

check-uv: ## Check for uv and install it if missing (Windows)
	@Write-Host "Checking for uv..."; $$uvCmd = Get-Command uv -ErrorAction SilentlyContinue; if (-not $$uvCmd) { $$cand = '$(UV_LOCAL_PATH)'; if (Test-Path $$cand) { $$uvCmd = Get-Item $$cand } }; if (-not $$uvCmd) { try { iwr https://astral.sh/uv/install.ps1 -UseBasicParsing | iex } catch { Write-Error 'Failed to run uv install script.'; exit 1 }; $$uvCmd = Get-Command uv -ErrorAction SilentlyContinue; if (-not $$uvCmd) { $$cand = '$(UV_LOCAL_PATH)'; if (Test-Path $$cand) { $$uvCmd = Get-Item $$cand } } }; if ($$uvCmd) { $$uvDir = Split-Path -Path $$uvCmd.Path; if ($$env:Path -notlike ("*" + $$uvDir + "*")) { $$env:Path = "$$uvDir;$$env:Path" }; Write-Host "✅ uv is available: $$( $$uvCmd.Path )" } else { Write-Error "Error: 'uv' is still not available after installation. Check PATH or manual installation."; exit 1 }
else  # ----------------------------- POSIX (Linux/macOS)
check-python:
	@echo "Checking for a Python 3.11 interpreter..."; $(PYTHON) -c "import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)" 2>$(NULL_DEVICE) || ( echo "Error: '$(PYTHON)' is not Python 3.11."; echo "Please install Python 3.11 and add it to your PATH,"; echo 'or specify the command via make install PYTHON="py -3.11"'; exit 1; ); echo "Found Python 3.11:"; $(PYTHON) -V

check-pyproject:
	@[ -f pyproject.toml ] || { echo "Error: pyproject.toml not found in $$\(pwd\)"; exit 1; }; echo "Found pyproject.toml"

check-uv: ## Check for uv and install it if missing (POSIX)
	@echo "Checking for uv..."; command -v uv >$(NULL_DEVICE) 2>&1 || { echo "Info: 'uv' not found. Attempting to install it now..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }; command -v uv >$(NULL_DEVICE) 2>&1 || { echo "Error: 'uv' is still not available after installation."; exit 1; }; echo "✅ uv is available."
endif  # ----------------------------- end Internal Helper Targets
