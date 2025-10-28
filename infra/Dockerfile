# infra/Dockerfile
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps for building wheels and basic tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project files. Use .dockerignore to keep image small.
COPY . /app

# Install Python deps (editable is fine if your pyproject supports PEP 660)
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -e .

# Gunicorn config (already in repo under infra/)
# Keeping an explicit copy makes path stable regardless of working dir
COPY infra/gunicorn_conf.py /app/gunicorn_conf.py

ENV PORT=5000
EXPOSE 5000

# Default command for the API container
CMD ["gunicorn","server.main:app","-k","uvicorn.workers.UvicornWorker","-c","gunicorn_conf.py"]
