# Dockerfile
# Multi-stage: build UI, install Python app
FROM node:20-alpine AS ui
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# System deps (git, build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy project
COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY templates/ ./templates/
COPY src/templates/ ./src/templates/
COPY a2a_server.py app.py ./
COPY scripts/ ./scripts/
COPY ui/dist/ ./ui/dist/  # fallback if no multi-stage
# Bring built UI from stage
COPY --from=ui /app/ui/dist ./ui/dist

# Install project & gunicorn
RUN python -m pip install --upgrade pip \
 && pip install ".[dev,docs]" gunicorn

# Default envs
ENV FLASK_HOST=0.0.0.0 FLASK_PORT=5000 \
    A2A_HOST=0.0.0.0 A2A_PORT=8000

EXPOSE 5000 8000
# CMD is overridden per-service in docker-compose.yml
CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app", "-w", "2", "-k", "gthread", "--threads", "8", "--timeout", "120"]
