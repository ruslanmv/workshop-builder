
<div align="center">
  <h1>🧠 Workshop Builder</h1>
  <p><b>FastAPI + watsonx.ai + RAG (Chroma) + CrewAI</b><br/>Agentic document generation — workshops, books, guides.</p>
  <p>
    <img alt="Python Version" src="https://img.shields.io/badge/python-3.11+-blue.svg">
    <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg">
    <img alt="Status" src="https://img.shields.io/badge/stack-FastAPI%20%7C%20CrewAI%20%7C%20Chroma%20%7C%20watsonx.ai-brightgreen">
  </p>
</div>

---

## ✨ What it does

**Workshop Builder** turns raw materials (Markdown, docs, repos, web pages) into polished **workshops** and **long-form documents** using:

- **Agentic pipeline (CrewAI)** — planner → researcher → writer → formatter → exporter
- **watsonx.ai** — Granite models for chat + multilingual embeddings
- **RAG** — token-aware chunking, retrieval via **Chroma** for grounded generation
- **FastAPI** backend with **SSE** streaming of live progress/logs/artifacts
- **Multi-tenant & authenticated** API (API key or JWT)

Outputs: `PDF`, `EPUB`, `MkDocs` (site), and zipped artifact bundles.

---


**Generation flow**

1. **Ingest**: Text is split (token-aware) and embedded with **watsonx.ai**.
2. **Index**: Chunks + metadata are stored in **Chroma**.
3. **Plan**: CrewAI **Planner** drafts structure (sections, schedule).
4. **Research**: **Researcher** queries RAG for highly relevant context.
5. **Write**: **Writer** composes content grounded in retrieved chunks.
6. **Format**: **Formatter** prepares layout-ready Markdown/LaTeX.
7. **Export**: Build **PDF/EPUB/MkDocs**; artifacts are surfaced over SSE.

During generation the backend emits SSE events:
- `progress` (e.g., “Writing section 3/8”), 
- `log` (info/debug),
- `artifact` (downloadable files ready),
- `done` (job completed).

---

## 🚀 Quick start

### 1) Install (local)

```bash
# Python 3.11+ recommended
make check-uv
make install
cp .env.example .env
# Fill watsonx.ai credentials in .env:
#   WATSONX_API_KEY=...
#   WATSONX_PROJECT_ID=...
#   WATSONX_REGION=us-south
````

### 2) Run backend + frontend together

```bash
make run
# Backend: http://localhost:5000
# Frontend: http://localhost:5173
```

> If you only want the API: `uv run uvicorn server.main:app --host 0.0.0.0 --port 5000 --reload`

### 3) Minimal E2E smoke test

```bash
# Uses sensible defaults: X-API-Key=dev-key-123, tenant=public
python examples/test_workshop.py --download
```

---

## 🔐 Auth & tenancy (simple by default)

* **API key**: send header `X-API-Key: dev-key-123` (change in `.env` → `API_KEYS`)
* **Tenant**: send header `X-Tenant-Id: public` (default)
* **JWT** (optional): `Authorization: Bearer <token>` with `JWT_SECRET` or JWKS config

The example and UI **default** to:

```http
X-API-Key: dev-key-123
X-Tenant-Id: public
```

---

## ⚙️ Config highlights

`.env` (or environment variables):

```
# App
APP_NAME="Workshop Builder API"
LOG_LEVEL=INFO
ENV=dev

# Static UI build
STATIC_ROOT=./ui/dist

# Auth
API_KEYS=dev-key-123
TENANCY_HEADER=X-Tenant-Id
DEFAULT_TENANT=public

# Storage
DATA_DIR=./data
JOBS_DIR=./data/jobs
CHROMA_DIR=./data/chroma

# watsonx.ai
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_REGION=us-south
WATSONX_CHAT_MODEL=ibm/granite-13b-instruct-v2
WATSONX_EMBED_MODEL=ibm/granite-embedding-278m-multilingual
```

> The backend **auto-guards** against embedding length issues (512 tokens) by chunking sensibly; if a model complains, it shrinks chunk size and retries.

---

## 🧠 RAG details

* **Splitter**: `RecursiveCharacterTextSplitter`
  `chunk_size=1200`, `chunk_overlap=160` (tunable per your corpus)
* **Embeddings**: watsonx.ai Granite multilingual embedding model
* **Similarity**: cosine (`similarity = 1 - distance`)
* **Metadata**: source path + optional title carried through, useful for previews

---

## 🤖 The agents (CrewAI)

> You can customize or extend the crew in `workers/` (planner/researcher/writer/formatter).

* **Planner**: Transforms intent + source summary → coherent outline.
* **Researcher**: Routes queries to RAG, curates evidence per section.
* **Writer**: Produces didactic, grounded prose/code labs from research.
* **Formatter**: Normalizes structure, fixes headings, adds front-matter.
* **Exporter**: Builds final **PDF/EPUB/MkDocs** and emits `artifact` events.

Each step publishes **SSE progress** so the UI feels live.

---

## 🧩 API overview

| Method | Endpoint                          | What it does                               |
| -----: | --------------------------------- | ------------------------------------------ |
|    GET | `/api/healthz`                    | Liveness                                   |
|    GET | `/api/health`                     | Alias for UI back-compat                   |
|   POST | `/api/ingest/files`               | Multipart file ingest                      |
|   POST | `/api/ingest/github`              | JSON ingest: `{files:[{path,text,title}]}` |
|   POST | `/api/knowledge/query`            | RAG query                                  |
|   POST | `/api/generate/start`             | Start a generation job                     |
|    GET | `/api/generate/stream?job_id=...` | **SSE** progress/logs/artifacts            |
|    GET | `/api/exports/{job_id}`           | List/download artifacts                    |

**Example (JSON ingest)**

```python
import os, requests
API = "http://localhost:5000/api"
HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": os.getenv("API_KEY", "dev-key-123"),
  "X-Tenant-Id": os.getenv("TENANT", "public"),
}
requests.post(f"{API}/ingest/github", headers=HEADERS, json={
  "collection": "workshop_docs",
  "files": [{"path":"tutorial.md","title":"Tutorial","text":"# My Doc ..."}]
})
```

---

## 🧪 Example workflow (CLI)

```bash
# 1) Ingest a tutorial into collection 'workshop_docs'
python examples/test_workshop.py

# 2) Follow the SSE stream in your browser
open "http://localhost:5000/api/generate/stream?job_id=<the-id>"

# 3) Fetch artifacts
curl -H "X-API-Key: dev-key-123" -H "X-Tenant-Id: public" \
  http://localhost:5000/api/exports/<job_id> | jq
```

---

## 🐳 Docker (optional)

A sample Compose file is provided in `infra/` to run the API, worker, and supporting services. Build and run:

```bash
docker compose -f infra/docker-compose.yml up --build
```

---

## 🧱 A brief note on Redis/RQ

Generation runs as a background job so the API stays snappy and you get **live streaming**.
Just ensure a local Redis is running and the **RQ worker** is attached (we include tiny scripts):

```bash
# Start/stop Redis container
bash scripts/redis_up.sh
bash scripts/redis_down.sh

# Run the worker (in another terminal)
bash scripts/rq_worker.sh
```

> That’s it — no extra Redis knowledge required. The defaults use `redis://localhost:6379/0` and queue `jobs`.

---

## 📊 Observability

* **Structured logs** (JSON) with request IDs
* **Prometheus**: `/metrics`
* **Health**: `/api/healthz` (liveness), `/api/readyz` (readiness)
* **OpenTelemetry** (optional): set `ENABLE_OTEL=true` and OTLP envs

---

## 🧰 Development scripts

* `make install` — create venv & install
* `make run` — start **backend + frontend** together
* `make ui-dev` — Vite dev server
* `make test` — pytest
* `make lint` / `make fmt` — ruff
* `make redis-up` / `make redis-down` / `make worker` — convenience hooks

---

## 🔒 Security defaults

* API key required for mutating endpoints
* CORS configured for local UI (`http://localhost:5173`)
* Tenancy header defaults to `public` (override per request)

For production:

* Rotate API keys, switch to JWT/JWKS
* Put the API behind TLS
* Harden CORS to your domain(s)

---

## 🧾 License

**Apache-2.0** — see `LICENSE`.

---

## 🙌 Credits

* **IBM watsonx.ai** Granite models
* **CrewAI** for agent orchestration
* **FastAPI**, **Chroma**, **Vite/React**

