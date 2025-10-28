# workers/__init__.py
"""
Expose the worker entrypoints so RQ (and the API) can import them.
Avoid importing heavy RQ classes at module import time.
"""
from .worker import run_job_worker

__all__ = ["run_job_worker"]
