<div align="center">
  <a href="https://www.python.org" target="_blank"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/python/python-original.svg" alt="Python" width="60" height="60"/></a>
  <a href="https://www.docker.com/" target="_blank"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/docker/docker-original-wordmark.svg" alt="Docker" width="60" height="60"/></a>
  <a href="https://vitejs.dev" target="_blank"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/vitejs/vitejs-original.svg" alt="Vite" width="60" height="60"/></a>
</div>

# Workshop Builder — Universal A2A + /knowledge + Flask UI (Big Docs Ready)

A production-ready toolkit that turns a GitHub repo or local docs into a **book + MkDocs website + workshop plan**, and exposes a **persistent RAG** index via **Universal A2A** `/knowledge`. Optional **CrewAI**-driven planning and **watsonx.ai / OpenAI** providers.

> 🔐 Provide API credentials for your chosen LLM/embeddings if you enable retrieval.

---

## ✨ Features

- **Universal A2A `/knowledge`** — persistent vector index; ingest files/dirs/repos; query by collection.
- **Big-doc chunking** — defaults `1400/160` for large Markdown/codebases.
- **Chroma or Qdrant** — local on-disk by default, HA-ready with Qdrant.
- **watsonx.ai or OpenAI** — env-driven provider selection for chat/embeddings.
- **Flask UI + React (Vite)** — ingest, plan, design workshop schedules, and export book artifacts.
- **CrewAI (optional)** — researcher/writer agents to bootstrap outlines.

---

## 📁 Layout
workshop_builder/

├─ ui/                        # React + Vite + Tailwind

│  └─ dist/                   # built UI (vite build)

├─ src/                       # Python backend (Flask API)

│  ├─ app.py                  # Flask app factory (serves /api/*)

│  ├─ config.py               # Pydantic settings

│  ├─ models/                 # Pydantic models (Repo/Book/Workshop/Provider)

│  ├─ routes/                 # /api endpoints (health/ingest/workshops/books/exports)

│  ├─ services/               # repo/rag/providers/planning/schedule/export

│  ├─ templates/springer/     # LaTeX templates (Springer-like)

│  └─ utils/                  # fs/time helpers

├─ a2a_server.py              # Universal A2A FastAPI server (optional process)

├─ scripts/

│  └─ build_ui.sh             # npm ci && npm run build

├─ pyproject.toml

├─ Makefile

├─ .env.example

└─ README.md

---

## 🧩 Prerequisites

- **Python 3.11**
- **Node 18+** (to build the UI)
- **Git**
- **Docker + compose** (optional)
- **uv** (package manager; installed automatically by `make check-uv`)

---

## ⚙️ Configure

Copy and edit:

```bash
cp .env.example .env
```

Key values to review: `A2A_BASE`, `A2A_ENABLE_KNOWLEDGE`, vector DB selection, and provider credentials for watsonx/OpenAI.

## 🚀 Build & Run
1) Install backend deps
```bash
make install          # creates .venv and syncs deps with uv
```
2) Build the UI
```bash
make ui-build         # runs scripts/build_ui.sh
```
Vite outputs to `ui/dist/`. Serve via Flask or your edge (NGINX).
3) Start services
Run both A2A + Flask from one terminal:
```bash
make serve-all
# A2A → http://localhost:8000
# UI  → http://localhost:5000
```
Or run separately:
```bash
make serve-a2a
make serve-web
```
Docker Compose option:
```bash
make compose-up
```

## 📚 RAG: Ingest & Query
Ingest a path:
```bash
make ingest TARGET=/absolute/path/to/repo
```
Query:
```bash
curl -s http://localhost:8000/knowledge/query \
  -H "content-type: application/json" \
  -d '{"q":"List primary endpoints", "k":6, "score_threshold":0.0}' | jq
```

## 🧰 Workshop & Book
Open the UI: http://localhost:5000

- **Repo ingest** → DocMap
- **Plan preview** → chapters/labs
- **Workshop designer** → schedule blocks (theory/lab/break), module objectives
- **Book designer** → title/authors/sections; preview Markdown/LaTeX
- **Export panel** → EPUB/PDF/Springer (requires local pandoc/xelatex)

## 🧪 QA
```bash
make test   # pytest
make lint   # ruff check
make fmt    # ruff format
```

## 🏭 Production Notes
- Keep `/knowledge` behind your gateway; use `A2A_STRICT_INGEST_ROOT=1`.
- Prefer Qdrant for multi-node HA; Chroma for local dev.
- Inject secrets via your platform’s secret store (don’t commit `.env`).
- Reverse proxy UI + A2A with TLS, auth, and caching headers for static assets.

## 📄 License
Apache-2.0 — see `LICENSE`.
