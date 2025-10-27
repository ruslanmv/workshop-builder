<div align="center">
  <a href="https://www.python.org" target="_blank"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/python/python-original.svg" alt="Python" width="60" height="60"/></a>
  <a href="https://www.docker.com/" target="_blank"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/docker/docker-original-wordmark.svg" alt="Docker" width="60" height="60"/></a>
  <a href="https://jupyter.org/" target="_blank"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/jupyter/jupyter-original-wordmark.svg" alt="Jupyter" width="60" height="60"/></a>
</div>

# Workshop Builder – Production-Ready FastAPI + watsonx.ai + RAG (Chroma) + CrewAI

<p align="center">
  <img alt="Python Version" src="https://img.shields.io/badge/python-3.11-blue.svg">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-blue.svg?logo=docker">
</p>

A **multi-tenant**, **authenticated** backend that offers:
- FastAPI API with **SSE streaming** (progress/logs/artifacts).
- **IBM watsonx.ai** for chat + embeddings (Granite models).
- **RAG** with Chroma, token-aware chunking, batched embeddings.
- **Redis + RQ** durable job queue (worker process).
- **Structured logs**, **Prometheus metrics**, health probes.
- **JWT/API-Key** auth & **tenant-isolated** collections.

---

## What You Get

- Modern packaging in `pyproject.toml`.
- Cross-platform **Makefile** with **uv** as the default installer.
- **Dockerfile** and **docker-compose** for a one-command stack.
- Ready endpoints and a worker for long-running generation jobs.

---

## Prerequisites

- Python **3.11** and **uv** (for local installs), or
- Docker (Desktop or Engine) for containerized runs.
- Redis (auto via Docker Compose).

---

## 🐳 Docker Quick Start (Recommended)

```bash
cp .env.example .env
# Fill: WATSONX_API_KEY, WATSONX_PROJECT_ID

docker compose -f infra/docker-compose.yml up --build
# API  -> http://localhost:5000
# Auth -> use header: X-API-Key: dev-key-123  (change in .env for prod)
```

> SSE endpoint: `GET /api/generate/stream?job_id=...`

---

## 🐍 Local Quick Start (uv)

```bash
make check-uv          # installs uv if needed
make install           # uv sync
cp .env.example .env   # and fill watsonx creds
uv run uvicorn server.main:app --host 0.0.0.0 --port 5000
# In another terminal:
uv run python -m workers.worker
```

Install dev tools:
```bash
uv sync --group dev  # ruff, pytest
```

---

## Authentication & Tenancy

- **API Key**: send header `X-API-Key: <your-key>`. Configure `API_KEYS` in `.env`.
- **JWT**: supply `Authorization: Bearer <token>`; set `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_URL` (or `JWT_SECRET` for HS256).
- **Tenant**: pass `X-Tenant-Id: <tenant>`; all vector collections are stored as `<tenant>:<collection>`.

---

## Endpoints (high level)

- `GET  /api/healthz` , `GET /api/readyz`
- `GET  /api/providers`
- `GET  /api/settings`
- `POST /api/ingest/files` (multipart: `files[]`, `collection?`)
- `POST /api/knowledge/query` (`{ q, collection?, k? }`)
- `POST /api/generate/start` -> returns `{ job_id, stream }`
- `GET  /api/generate/stream?job_id=...` (SSE)
- `GET  /api/exports/{job_id}` / `GET /api/exports/{job_id}/{file}`

All authenticated by default.

---

## RAG Details

- Splitter: `RecursiveCharacterTextSplitter` with `chunk_size=1200`, `overlap=160`.
- Embeddings: Watsonx **Granite Embedding 278m Multilingual** (configurable).
- Similarity: cosine distance provided by Chroma; output also includes similarity `= 1 - distance`.

---

## Observability

- JSON logs via `structlog`.
- Prometheus: `/metrics` when `ENABLE_PROMETHEUS=true`.
- Add OTEL exporter by setting `ENABLE_OTEL=true` and `OTEL_EXPORTER_OTLP_ENDPOINT`.

---

## Deployment

- Gunicorn + Uvicorn workers (see `infra/Dockerfile` & `infra/gunicorn_conf.py`).
- Add NGINX/reverse proxy and TLS in front; or use Kubernetes ingress.
- Serve static UI (if any) via CDN, not from the API.

---

## Makefile Highlights

- `make install` / `make uv-install` – install with **uv**.
- `make test` / `make lint` / `make fmt` – QA helpers (install dev deps with `uv sync --group dev`).
- Docker helpers: `make build-container`, `make run-container`, `make logs`, `make stop-container`.

> Note: Docker helpers in the Makefile are generic; prefer `docker compose -f infra/docker-compose.yml up` for the full stack.

---

## License

Licensed under the **Apache-2.0** license.
