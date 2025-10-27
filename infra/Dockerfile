FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends gcc curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install -e .

COPY server ./server
COPY workers ./workers
COPY ui ./ui
COPY data ./data
COPY infra/gunicorn_conf.py ./gunicorn_conf.py

ENV PORT=5000
EXPOSE 5000

CMD ["gunicorn","server.main:app","-k","uvicorn.workers.UvicornWorker","-c","gunicorn_conf.py"]
