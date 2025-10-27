# Makefile — Fully Cross-Platform for workshop_builder (Universal A2A v1.3.0 + Flask UI)
# Works on Windows (PowerShell/CMD/Git Bash) and Unix-like systems (Linux/macOS).

.DEFAULT_GOAL := help

# --- User-Configurable Variables ---
PYTHON ?= python3.11
VENV   ?= .venv

# A2A / Flask runtime (override as needed)
A2A_PORT           ?= 8000
WEB_PORT           ?= 5000
A2A_BASE           ?= http://localhost:$(A2A_PORT)
A2A_UVICORN_APP    ?= a2a_universal.server:app
A2A_HOST           ?= 0.0.0.0
WEB_HOST           ?= 0.0.0.0

# Docker / Compose
DOCKER_IMAGE       ?= workshop-builder:latest
DOCKER_NAME        ?= workshop-builder
DOCKER_COMPOSE     ?= docker compose

# Packaging
DIST_DIR           ?= dist
ZIP_NAME           ?= workshop_builder_$(shell date +%Y%m%d_%H%M%S).zip

# --- OS Detection for Paths and Commands ---
ifeq ($(OS),Windows_NT)
  # Use the Python launcher on Windows
  PYTHON          := py -3.11
  # Windows settings (PowerShell-safe)
  PY_SUFFIX       := .exe
  BIN_DIR         := Scripts
  ACTIVATE        := $(VENV)\$(BIN_DIR)\activate
  # Use $$null for PowerShell redirection
  NULL_DEVICE     := $$null
  RM              := Remove-Item -Force -ErrorAction SilentlyContinue
  RMDIR           := Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  SHELL           := powershell.exe
  .SHELLFLAGS     := -NoProfile -ExecutionPolicy Bypass -Command
  # Reference to environment variables for PowerShell
  ENVREF          := $$env:
  # Docker volume source for PS (use the .Path of $PWD)
  MOUNT_SRC       := "$$PWD.Path"
  UV_RUN          := uv run
  PYRUN           := & $(PYTHON)
else
  # Unix/Linux/macOS settings
  PY_SUFFIX       :=
  BIN_DIR         := bin
  ACTIVATE        := . $(VENV)/$(BIN_DIR)/activate
  NULL_DEVICE     := /dev/null
  RM              := rm -f
  RMDIR           := rm -rf
  SHELL           := /bin/bash
  .ONESHELL:
  .SHELLFLAGS     := -eu -o pipefail -c
  # Reference to environment variables for POSIX sh/bash
  ENVREF          := $$
  # Docker volume source for POSIX shells
  MOUNT_SRC       := "$$(pwd)"
  UV_RUN          := uv run
  PYRUN           := $(PYTHON)
endif

# --- Derived Variables ---
PY_EXE  := $(VENV)/$(BIN_DIR)/python$(PY_SUFFIX)
PIP_EXE := $(VENV)/$(BIN_DIR)/pip$(PY_SUFFIX)

.PHONY: \
  help doctor env venv uv-install pip-install install dev update notebook \
  ui-build ui-dev \
  serve-a2a serve-web serve-all stop-all \
  compose-up compose-down compose-logs \
  ingest rag-test \
  test lint fmt check precommit \
  build-image run-image stop-image rm-image logs \
  package clean clean-venv distclean \
  check-python check-pyproject check-uv python-version

# =============================================================================
#  Helper Scripts (exported env vars; executed via python -c)
# =============================================================================

export HELP_SCRIPT
define HELP_SCRIPT
import re, sys, io, os
mf = os.environ.get('MAKEFILE', '$(firstword $(MAKEFILE_LIST))') or 'Makefile'
print('Usage: make <target> [OPTIONS...]\n')
print('Top targets:\n')
targets = []
with io.open(mf, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        m = re.match(r'^([a-zA-Z0-9_.-]+):.*?## (.*)$$', line)
        if m:
            targets.append(m.groups())
w = max((len(t[0]) for t in targets), default=0)
for name, help_text in targets:
    print(f'  {name:<{w}}  {help_text}')
endef

export CLEAN_SCRIPT
define CLEAN_SCRIPT
import glob, os, shutil, sys
patterns = ['*.pyc', '*.pyo', '*~', '*.egg-info', '__pycache__',
            'build', 'dist', '.mypy_cache', '.pytest_cache', '.ruff_cache',
            '.ipynb_checkpoints']
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
        print(f'Error removing {path}: {e}', file=sys.stderr)
endef

export PACKAGE_SCRIPT
define PACKAGE_SCRIPT
import os, zipfile
root = os.getcwd()
os.makedirs("$(DIST_DIR)", exist_ok=True)
zip_path = os.path.join("$(DIST_DIR)", "$(ZIP_NAME)")
excludes = {'.venv','dist','build','.git','.pytest_cache','.ruff_cache','__pycache__','.ipynb_checkpoints','node_modules','ui/node_modules'}
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, dirs, files in os.walk(root):
        rel = os.path.relpath(base, root)
        if rel == '.':
            rel = ''
        if any(part in excludes for part in rel.split(os.sep)):
            continue
        for f in files:
            p = os.path.join(base, f)
            if any(part in excludes for part in p.split(os.sep)):
                continue
            z.write(p, os.path.join(rel, f) if rel else f)
print(zip_path)
endef

# =============================================================================
#  Core Targets
# =============================================================================

help: ## Show this help message
	@$(PYRUN) -X utf8 -c "$(ENVREF)HELP_SCRIPT"

doctor: ## Quick environment check (Python, uv, docker, compose)
	@echo "🔎 Checking Python 3.11..."
	@$(MAKE) -s check-python
	@echo "🔎 Checking uv..."
	@$(MAKE) -s check-uv
	@echo "🔎 Checking docker..."
	@docker --version || true
	@echo "🔎 Checking compose..."
	@$(DOCKER_COMPOSE) version || true
	@echo "✅ doctor done."

env: ## Print important env variables
	@echo "PYTHON      = $(PYTHON)"
	@echo "VENV        = $(VENV)"
	@echo "A2A_BASE    = $(A2A_BASE)"
	@echo "A2A_APP     = $(A2A_UVICORN_APP)"
	@echo "A2A_PORT    = $(A2A_PORT)"
	@echo "WEB_PORT    = $(WEB_PORT)"
	@echo "DOCKER_IMAGE= $(DOCKER_IMAGE)"
	@echo "DOCKER_NAME = $(DOCKER_NAME)"
	@echo "DOCKER_COMPOSE = $(DOCKER_COMPOSE)"

# --- Local Python Environment ---

ifeq ($(OS),Windows_NT)
$(VENV): check-python
	@echo "Creating virtual environment at $(VENV)..."
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

uv-install: check-python check-pyproject check-uv ## [uv] Create venv & install dependencies
	@echo "Syncing environment with uv..."
	@uv sync
	@echo "✅ Done! To activate the environment, run:"
ifeq ($(OS),Windows_NT)
	@echo "    .\$(VENV)\Scripts\Activate.ps1"
else
	@echo "    source $(VENV)/bin/activate"
endif

pip-install: venv check-pyproject ## [pip] Install project in editable mode
	@$(PIP_EXE) install -U pip
	@$(PIP_EXE) install -e ".[dev]" || $(PIP_EXE) install -r requirements.txt
	@echo "✅ Installed project into $(VENV) using pip"

install: uv-install ## Install deps with uv (preferred)
dev: uv-install ## Same as install; alias

update: check-pyproject ## Upgrade/sync dependencies (prefers uv if available)
	@uv sync
	@echo "✅ Project and dependencies synchronized (uv)"

notebook: uv-install ## Register the Jupyter kernel (optional)
	@echo "📚 Registering Jupyter kernel..."
	@$(PY_EXE) -m ipykernel install --user --name "workshop-builder" --display-name "Python 3.11 (workshop-builder)" >$(NULL_DEVICE) 2>&1 || true
	@echo "✅ Jupyter kernel registered"

# --- UI ---
ui-build: ## Build React UI with Vite (outputs to ui/dist)
	@bash scripts/build_ui.sh

ui-dev: ## Run Vite dev server from ./ui (useful for local FE development)
	@cd ui && npm run dev

# --- Runtime (Local) ---

serve-a2a: uv-install ## Run Universal A2A (uvicorn) — override A2A_UVICORN_APP if needed
	@$(PY_EXE) -m uvicorn $(A2A_UVICORN_APP) --host $(A2A_HOST) --port $(A2A_PORT)

serve-web: uv-install ## Run Flask UI (repo analyzer + scaffold writer)
	@$(PY_EXE) -m flask --app app.py run --host $(WEB_HOST) --port $(WEB_PORT)

serve-all: uv-install ## Run A2A (bg) + Flask (fg) in one terminal
	@($(PY_EXE) -m uvicorn $(A2A_UVICORN_APP) --host $(A2A_HOST) --port $(A2A_PORT) & echo $$! > .a2a.pid)
	@sleep 1
	@$(PY_EXE) -m flask --app app.py run --host $(WEB_HOST) --port $(WEB_PORT)

stop-all: ## Stop background A2A (POSIX) / background jobs (Windows)
ifeq ($(OS),Windows_NT)
	@Get-Job -Name a2a -State Running -ErrorAction SilentlyContinue | Stop-Job -PassThru | Remove-Job -Force -ErrorAction SilentlyContinue
else
	@if [ -f .a2a.pid ]; then \
		kill "$$(cat .a2a.pid)" || true; rm -f .a2a.pid; \
	fi
endif

# --- Docker Compose ---

compose-up: ## Start A2A + Qdrant + Flask with Docker Compose
	@$(DOCKER_COMPOSE) up -d --build

compose-down: ## Stop and remove containers/volumes
	@$(DOCKER_COMPOSE) down -v

compose-logs: ## Tail compose logs
	@$(DOCKER_COMPOSE) logs -f

# --- Docker (single image helpers, optional) ---

build-image: check-pyproject ## Build the Docker image
	@echo "Building image '$(DOCKER_IMAGE)'..."
	@docker build -t $(DOCKER_IMAGE) .

run-image: ## Run or restart the container in detached mode
ifeq ($(OS),Windows_NT)
	@docker run -d --name $(DOCKER_NAME) -p $(WEB_PORT):5000 -p $(A2A_PORT):8000 -v $(MOUNT_SRC):/workspace --env-file .env $(DOCKER_IMAGE) > $(NULL_DEVICE) 2> $(NULL_DEVICE) || docker start $(DOCKER_NAME) > $(NULL_DEVICE) 2> $(NULL_DEVICE)
else
	@docker run -d --name $(DOCKER_NAME) -p $(WEB_PORT):5000 -p $(A2A_PORT):8000 -v $(MOUNT_SRC):/workspace --env-file .env $(DOCKER_IMAGE) > $(NULL_DEVICE) || docker start $(DOCKER_NAME)
endif
	@echo "Container is up: A2A=http://localhost:$(A2A_PORT)  UI=http://localhost:$(WEB_PORT)"

stop-image: ## Stop the running container
	@docker stop $(DOCKER_NAME) >$(NULL_DEVICE) 2>&1 || echo "Info: container not running."

rm-image: stop-image ## Remove the container
	@docker rm $(DOCKER_NAME) >$(NULL_DEVICE) 2>&1 || echo "Info: container did not exist."

logs: ## View the container logs (Ctrl-C to exit)
	@docker logs -f $(DOCKER_NAME)

# --- RAG Utilities ---

ingest: uv-install ## Ingest a file/dir into /knowledge (Usage: make ingest TARGET=/abs/path [BASE=...] [CHUNK=1400] [OVERLAP=160])
	@if [ -z "$(TARGET)" ]; then echo "ERROR: provide TARGET=/absolute/path to ingest"; exit 2; fi
	@BASE="$(or $(BASE),$(A2A_BASE))"; \
	echo "Ingesting '$${TARGET}' into $${BASE} ..."; \
	$(PY_EXE) scripts/ingest_repo.py "$${TARGET}" --base "$${BASE}" \
	  --chunk-size "$(or $(CHUNK),1400)" --chunk-overlap "$(or $(OVERLAP),160)"

rag-test: uv-install ## Run end-to-end smoke test (examples/rag_crewai_test.py). Use ARGS='--source github ...'
	@BASE="$(or $(BASE),$(A2A_BASE))"; \
	echo "Running RAG smoke test against $${BASE} ..."; \
	$(PY_EXE) examples/rag_crewai_test.py --base "$${BASE}" $(ARGS)

# --- Development & QA ---

test: uv-install ## Run tests with pytest
	@echo "🧪 Running tests..."
	@$(PY_EXE) -m pytest -q || true

lint: uv-install ## Lint with ruff
	@echo "🔍 Linting with ruff..."
	@$(PY_EXE) -m ruff check . || true

fmt: uv-install ## Format with ruff
	@echo "🎨 Formatting with ruff..."
	@$(PY_EXE) -m ruff format . || true

check: lint test ## Run all checks (lint + tests)

precommit: uv-install ## Install pre-commit hooks
	@$(PY_EXE) -m pre_commit install || true

# --- Packaging ---

package: ## Create a portable ZIP (excludes venv, caches, dist)
	@mkdir -p "$(DIST_DIR)" 2>$(NULL_DEVICE) || true
	@$(PYRUN) -X utf8 -c "$(ENVREF)PACKAGE_SCRIPT"
	@echo "✅ Wrote: $(DIST_DIR)"

# --- Utility ---

python-version: check-python ## Show resolved Python interpreter and version
	@echo "Using: $(PYTHON)"
	@$(PYTHON) -V

clean-venv: ## Force-remove the venv
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
