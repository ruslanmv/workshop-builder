# Makefile - Cross-Platform for Python 3.11
# Works on Windows (PowerShell/CMD/Git Bash) and Unix-like systems (Linux/macOS).

# =============================================================================
#  Configuration & Cross-Platform Setup
# =============================================================================

.DEFAULT_GOAL := uv-install

# --- User-Configurable Variables ---
PYTHON ?= python3.11
VENV   ?= .venv

# Dev server ports
PORT_BACKEND  ?= 5000
PORT_FRONTEND ?= 5173

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
MOUNT_SRC      := "$$(pwd)"
endif

# --- Derived Variables ---
PY_EXE  := $(VENV)/$(BIN_DIR)/python$(PY_SUFFIX)
PIP_EXE := $(VENV)/$(BIN_DIR)/pip$(PY_SUFFIX)

# Paths
INFRA_DIR ?= infra

.PHONY: help venv install pip-install dev uv-install update test lint fmt check shell clean distclean \
        clean-venv \
        ui-build ui-dev run run-api run-ui python-version \
        build-infra run-infra stop-infra monitor-infra \
        check-python check-pyproject check-uv

# =============================================================================
#  Helper Scripts (exported env vars; expanded by the shell)
# =============================================================================

export HELP_SCRIPT
define HELP_SCRIPT
import re, sys, io
print('Usage: make <target> [OPTIONS...]\\n')
print('Available targets:\\n')
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

ifeq ($(OS),Windows_NT)
$(VENV): check-python
	@echo "Creating virtual environment at $(VENV)..."
	# Kill stray python.exe using cmd.exe to handle || operator correctly
	@& $$env:ComSpec /c "taskkill /F /IM python.exe >NUL 2>&1 || exit 0"
	@Start-Sleep -Milliseconds 300
	@if (Test-Path '$(VENV)'){ Remove-Item -Recurse -Force '$(VENV)' -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 200 }
	@& $(PYTHON) -m venv '$(VENV)'
	@& '$(VENV)\Scripts\python.exe' -m pip install --upgrade pip
	@& '$(VENV)\Scripts\python.exe' -V | % { "✅ Created $(VENV) with $$_" }
else
$(VENV): check-python
	@echo "Creating virtual environment at $(VENV)..."
	@$(PYTHON) -m venv --clear "$(VENV)" || { rm -rf "$(VENV)"; $(PYTHON) -m venv "$(VENV)"; }
	@"$(VENV)/bin/python" -m pip install --upgrade pip
	@echo "✅ Created $(VENV) with $$("$(VENV)/bin/python" -V)"
endif

venv: $(VENV) ## [pip] Create the virtual environment if it does not exist

install: uv-install ## Install project using uv (default)

dev: uv-install ## Install project in dev mode using uv (default)

pip-install: venv check-pyproject ## [pip] Install project in non-editable mode
	@$(PIP_EXE) install .
	@echo "✅ Installed project into $(VENV) using pip"

uv-install: check-pyproject ## [uv] Create venv & install all dependencies
ifeq ($(OS),Windows_NT)
	@echo "Syncing environment with uv..."
	@$$uvCmd = (Get-Command uv -ErrorAction SilentlyContinue); if (-not $$uvCmd) { $$uvCmd = Join-Path $$env:USERPROFILE '.local\bin\uv.exe' }; if (Test-Path $$uvCmd) { & $$uvCmd sync } else { Write-Host 'Error: uv not found. Please run `make check-uv` to install it.'; exit 1 }
	@echo "Done! To activate the environment, run:"
	@echo "   .\$(VENV)\Scripts\Activate.ps1"
else
	@echo "Syncing environment with uv..."
	@uv sync
	@echo "✅ Done! To activate the environment, run:"
	@echo "   source $(VENV)/bin/activate"
endif

update: check-pyproject ## Upgrade/sync dependencies (prefers uv if available)
ifeq ($(OS),Windows_NT)
	@$$uvCmd = (Get-Command uv -ErrorAction SilentlyContinue); if (-not $$uvCmd) { $$uvCmd = Join-Path $$env:USERPROFILE '.local\bin\uv.exe' }; if (Test-Path $$uvCmd) { Write-Host 'Syncing with uv...'; & $$uvCmd sync } else { Write-Host 'uv not found, falling back to pip...'; if (-not (Test-Path '$(VENV)\Scripts\python.exe')) { & $(PYTHON) -m venv '$(VENV)'; & '$(VENV)\Scripts\python.exe' -m pip install -U pip }; & '$(VENV)\Scripts\python.exe' -m pip install -U -e ".[dev]"; Write-Host '✅ Project and dependencies upgraded (pip fallback)'; }
else
	@if command -v uv >$(NULL_DEVICE) 2>&1; then \
		echo "Syncing with uv..."; \
		uv sync; \
	else \
		echo "uv not found, falling back to pip..."; \
		[ -x "$(VENV)/bin/python" ] || $(PYTHON) -m venv "$(VENV)"; \
		"$(VENV)/bin/python" -m pip install -U pip; \
		"$(VENV)/bin/pip" install -U -e ".[dev]"; \
		echo "✅ Project and dependencies upgraded (pip fallback)"; \
	fi
endif

# --- Development & QA ---

test: venv ## Run tests with pytest
	@echo "🧪 Running tests..."
	@$(PY_EXE) -m pytest

lint: venv ## Check code style with ruff
	@echo "🔍 Linting with ruff..."
	@$(PY_EXE) -m ruff check .

fmt: venv ## Format code with ruff
	@echo "🎨 Formatting with ruff..."
	@$(PY_EXE) -m ruff format .

check: lint test ## Run all checks (linting and testing)

# --- UI ---

ui-build: ## Build React UI with Vite (outputs to ui/dist)
	# Uses scripts/build_ui.sh so we keep all Node/Vite logic in one place
ifeq ($(OS),Windows_NT)
	@bash scripts/build_ui.sh
else
	@bash scripts/build_ui.sh
endif

ui-dev: ## Run Vite dev server from ./ui (useful for local FE development)
ifeq ($(OS),Windows_NT)
	# Single-line so it runs in one PowerShell invocation
	@cd ui; if (!(Test-Path node_modules)) { npm ci }; npm run dev
else
	@cd ui && ([ -d node_modules ] || npm ci) && npm run dev
endif

# --- Run both Backend (FastAPI) and Frontend (Vite) ---

run-api: uv-install ## Start only the FastAPI backend (uvicorn --reload)
ifeq ($(OS),Windows_NT)
	@& "$(VENV)\Scripts\python.exe" -m uvicorn server.main:app --reload --host 0.0.0.0 --port $(PORT_BACKEND)
else
	@$(PY_EXE) -m uvicorn server.main:app --reload --host 0.0.0.0 --port $(PORT_BACKEND)
endif

run-ui: ## Start only the Vite frontend dev server
ifeq ($(OS),Windows_NT)
	@cd ui; if (!(Test-Path node_modules)) { npm ci }; npm run dev -- --port $(PORT_FRONTEND)
else
	@cd ui && ([ -d node_modules ] || npm ci) && npm run dev -- --port $(PORT_FRONTEND)
endif

run: uv-install ## Start backend (FastAPI) and frontend (Vite) together; Ctrl-C to stop
ifeq ($(OS),Windows_NT)
	@echo "▶ Starting FastAPI (http://localhost:$(PORT_BACKEND)) and Vite (http://localhost:$(PORT_FRONTEND))"
	@$$job = Start-Job -Name wb_backend -ScriptBlock { \
		param($root,$venv,$port); \
		Set-Location -Path $root; \
		& "$venv\Scripts\python.exe" -m uvicorn server.main:app --reload --host 0.0.0.0 --port $port \
	} -ArgumentList $$PWD.Path,"$(VENV)",$(PORT_BACKEND); \
	try { \
		Push-Location ui; \
		if (!(Test-Path node_modules)) { npm ci }; \
		npm run dev -- --port $(PORT_FRONTEND); \
		Pop-Location; \
	} finally { \
		Write-Host "⏹  Stopping backend..."; \
		Stop-Job $$job -ErrorAction SilentlyContinue; \
		Remove-Job $$job -ErrorAction SilentlyContinue; \
	}
else
	@echo "▶ Starting FastAPI (http://localhost:$(PORT_BACKEND)) and Vite (http://localhost:$(PORT_FRONTEND))"
	@trap 'echo "⏹  Stopping backend..."; kill 0' INT TERM EXIT; \
	( $(PY_EXE) -m uvicorn server.main:app --reload --host 0.0.0.0 --port $(PORT_BACKEND) & ); \
	cd ui && ([ -d node_modules ] || npm ci) && npm run dev -- --port $(PORT_FRONTEND)
endif

# =============================================================================
#  Infra (Docker Compose) Helpers
# =============================================================================
# These auto-detect Compose v2 (docker compose) vs v1 (docker-compose)

build-infra: ## Build all Docker images in infra/docker-compose.yml
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; \
	if (Get-Command docker -ErrorAction SilentlyContinue) { \
		docker compose version > $(NULL_DEVICE) 2>&1; \
		if ($$LASTEXITCODE -eq 0) { docker compose build } \
		elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose build } \
		else { Write-Error '❌ Docker Compose not found. Install Docker Desktop or docker-compose.'; Pop-Location; exit 1 } \
	} else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; \
	Pop-Location
else
	@cd "$(INFRA_DIR)"; \
	if docker compose version >/dev/null 2>&1; then \
		docker compose build; \
	elif command -v docker-compose >/dev/null 2>&1; then \
		docker-compose build; \
	else \
		echo "❌ Docker Compose not found. Install Docker Desktop or docker-compose."; exit 1; \
	fi
endif

run-infra: ## Start the full stack in background (api, worker, redis, web)
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; \
	if (Get-Command docker -ErrorAction SilentlyContinue) { \
		docker compose version > $(NULL_DEVICE) 2>&1; \
		if ($$LASTEXITCODE -eq 0) { docker compose up -d } \
		elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose up -d } \
		else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 } \
	} else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; \
	Pop-Location; \
	echo '🌐 UI:  http://localhost/'; \
	echo '🧰 API: http://localhost/api'
else
	@cd "$(INFRA_DIR)"; \
	if docker compose version >/dev/null 2>&1; then \
		docker compose up -d; \
	elif command -v docker-compose >/dev/null 2>&1; then \
		docker-compose up -d; \
	else \
		echo "❌ Docker Compose not found."; exit 1; \
	fi; \
	echo "🌐 UI:  http://localhost/"; \
	echo "🧰 API: http://localhost/api"
endif

stop-infra: ## Stop and remove the stack (containers, networks)
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; \
	if (Get-Command docker -ErrorAction SilentlyContinue) { \
		docker compose version > $(NULL_DEVICE) 2>&1; \
		if ($$LASTEXITCODE -eq 0) { docker compose down --remove-orphans } \
		elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose down --remove-orphans } \
		else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 } \
	} else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; \
	Pop-Location
else
	@cd "$(INFRA_DIR)"; \
	if docker compose version >/dev/null 2>&1; then \
		docker compose down --remove-orphans; \
	elif command -v docker-compose >/dev/null 2>&1; then \
		docker-compose down --remove-orphans; \
	else \
		echo "❌ Docker Compose not found."; exit 1; \
	fi
endif

monitor-infra: ## Tail logs for all services (Ctrl-C to stop)
ifeq ($(OS),Windows_NT)
	@Push-Location '$(INFRA_DIR)'; \
	if (Get-Command docker -ErrorAction SilentlyContinue) { \
		docker compose version > $(NULL_DEVICE) 2>&1; \
		if ($$LASTEXITCODE -eq 0) { docker compose logs -f } \
		elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { docker-compose logs -f } \
		else { Write-Error '❌ Docker Compose not found.'; Pop-Location; exit 1 } \
	} else { Write-Error '❌ Docker not found.'; Pop-Location; exit 1 }; \
	Pop-Location
else
	@cd "$(INFRA_DIR)"; \
	if docker compose version >/dev/null 2>&1; then \
		docker compose logs -f; \
	elif command -v docker-compose >/dev/null 2>&1; then \
		docker-compose logs -f; \
	else \
		echo "❌ Docker Compose not found."; exit 1; \
	fi
endif

# =============================================================================
#  Utility
# =============================================================================

python-version: check-python ## Show resolved Python interpreter and version
ifeq ($(OS),Windows_NT)
	@echo "Using: $(PYTHON)"
	@& $(PYTHON) -V
else
	@echo "Using: $(PYTHON)"
	@$(PYTHON) -V
endif

shell: venv ## Show how to activate the virtual environment shell
	@echo "Virtual environment is ready."
	@echo "To activate it, run:"
	@echo "  On Windows (CMD/PowerShell): .\$(VENV)\Scripts\Activate.ps1"
	@echo "  On Unix (Linux/macOS/Git Bash): source $(VENV)/bin/activate"

clean-venv: ## Force-remove the venv (kills python.exe on Windows)
ifeq ($(OS),Windows_NT)
	@& $$env:ComSpec /c "taskkill /F /IM python.exe >NUL 2>&1 || exit 0"
	@Start-Sleep -Milliseconds 300
	@if (Test-Path '.venv'){ Remove-Item -Recurse -Force '.venv' }
else
	@rm -rf .venv
endif

clean: ## Remove Python artifacts, caches, and the virtualenv
	@echo "Cleaning project..."
	-$(RMDIR) $(VENV)
	-$(RMDIR) .pytest_cache
	-$(RMDIR) .ruff_cache
ifeq ($(OS),Windows_NT)
	@& $(PYTHON) -c "$(ENVREF)CLEAN_SCRIPT"
else
	@$(PYTHON) -c "$(ENVREF)CLEAN_SCRIPT"
endif
	@echo "Clean complete."

distclean: clean ## Alias for clean

# =============================================================================
#  Internal Helper Targets
# =============================================================================

ifeq ($(OS),Windows_NT)
check-python:
	@echo "Checking for a Python 3.11 interpreter..."
	@& $(PYTHON) -c "import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)" 2>$(NULL_DEVICE); if ($$LASTEXITCODE -ne 0) { echo "Error: '$(PYTHON)' is not Python 3.11."; echo "Please install Python 3.11 and add it to your PATH,"; echo "or specify via: make install PYTHON='py -3.11'"; exit 1; }
	@echo "Found Python 3.11:"
	@& $(PYTHON) -V

check-pyproject:
	@if (Test-Path -LiteralPath 'pyproject.toml') { echo 'Found pyproject.toml' } else { echo ('Error: pyproject.toml not found in ' + (Get-Location)); exit 1 }

check-uv: ## Check for uv and install it if missing
	@echo "Checking for uv..."
	@$$cmd = Get-Command uv -ErrorAction SilentlyContinue; if (-not $$cmd) { echo 'Info: ''uv'' not found. Attempting to install it now...'; iwr https://astral.sh/uv/install.ps1 -UseBasicParsing | iex; $$localBin = Join-Path $$env:USERPROFILE '.local\bin'; if (Test-Path $$localBin) { $$env:Path = "$$localBin;$$env:Path" } }
	@$$cmd = Get-Command uv -ErrorAction SilentlyContinue; if (-not $$cmd) { $$candidate = Join-Path $$env:USERPROFILE '.local\bin\uv.exe'; if (Test-Path $$candidate) { echo ('Using ' + $$candidate); $$env:Path = (Split-Path $$candidate) + ';' + $$env:Path } else { echo 'Error: ''uv'' is still not available after installation.'; exit 1 } }
	@echo "✅ uv is available."
else
check-python:
	@echo "Checking for a Python 3.11 interpreter..."
	@$(PYTHON) -c "import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)" 2>$(NULL_DEVICE) || ( \
		echo "Error: '$(PYTHON)' is not Python 3.11."; \
		echo "Please install Python 3.11 and add it to your PATH,"; \
		echo 'or specify the command via make install PYTHON=\"py -3.11\"'; \
		exit 1; \
	)
	@echo "Found Python 3.11:"
	@$(PYTHON) -V

check-pyproject:
	@[ -f pyproject.toml ] || { echo "Error: pyproject.toml not found in $$(pwd)"; exit 1; }
	@echo "Found pyproject.toml"

check-uv: ## Check for uv and install it if missing
	@echo "Checking for uv..."
	@command -v uv >$(NULL_DEVICE) 2>&1 || ( \
		echo "Info: 'uv' not found. Attempting to install it now..."; \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	)
	@command -v uv >$(NULL_DEVICE) 2>&1 || ( \
		echo "Error: 'uv' is still not available after installation."; \
		exit 1; \
	)
	@echo "✅ uv is available."
endif
