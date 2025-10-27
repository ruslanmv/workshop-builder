# workers/__init__.py
"""
Expose the worker entrypoints so RQ can import them.
"""

# Ensure submodule is imported so `workers.worker` is an attribute on the package
from importlib import import_module as _import_module
_import_module(__name__ + ".worker")

# Re-export the callable so you can also refer to "workers.run_job_worker"
from .worker import run_job_worker

__all__ = ["run_job_worker"]
