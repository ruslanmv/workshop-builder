# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import requests

import logging

log = logging.getLogger("workshop.services.rag")

_USER_AGENT = "workshop-builder/1.0 (+rag)"


def _join(base: str, path: str) -> str:
    base = base.rstrip("/")
    path = path if path.startswith("/") else f"/{path}"
    return f"{base}{path}"


def _post_json(url: str, payload: Dict[str, Any], timeout: int = 120) -> Dict[str, Any]:
    headers = {"Content-Type": "application/json", "User-Agent": _USER_AGENT}
    log.debug("POST", extra={"url": url, "payload": payload})
    r = requests.post(url, json=payload, timeout=timeout, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text}")
    try:
        return r.json()
    except Exception:
        return {"raw": r.text}


def _get_json(url: str, timeout: int = 30) -> Dict[str, Any]:
    headers = {"User-Agent": _USER_AGENT}
    log.debug("GET", extra={"url": url})
    r = requests.get(url, timeout=timeout, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text}")
    try:
        return r.json()
    except Exception:
        return {"raw": r.text}


# ------------------------------ Public API ------------------------------


def ingest_paths(
    base: str,
    paths: List[str],
    collection: Optional[str] = None,
    include_ext: Optional[str] = None,
    exclude_ext: Optional[str] = None,
    chunk_size: int = 1400,
    chunk_overlap: int = 160,
) -> Dict[str, Any]:
    """
    Call Universal A2A /knowledge/ingest.
    """
    payload: Dict[str, Any] = {
        "paths": paths,
        "chunk_size": int(chunk_size),
        "chunk_overlap": int(chunk_overlap),
    }
    if include_ext:
        payload["include_ext"] = [x.strip() for x in include_ext.split(",") if x.strip()]
    if exclude_ext:
        payload["exclude_ext"] = [x.strip() for x in exclude_ext.split(",") if x.strip()]

    url = _join(base, "/knowledge/ingest")
    if collection:
        url = f"{url}?{urlencode({'collection': collection})}"

    res = _post_json(url, payload, timeout=600)
    log.info("RAG ingest submitted", extra={"indexed": len(paths), "collection": collection or "default"})
    return res


def fetch_stats(base: str, collection: Optional[str] = None) -> Dict[str, Any]:
    url = _join(base, "/knowledge/stats")
    if collection:
        url = f"{url}?{urlencode({'collection': collection})}"
    try:
        return _get_json(url, timeout=20)
    except Exception as e:
        log.warning("Stats fetch failed", extra={"error": str(e)})
        return {}


def reset(base: str, collection: Optional[str] = None) -> Dict[str, Any]:
    url = _join(base, "/knowledge/reset")
    if collection:
        url = f"{url}?{urlencode({'collection': collection})}"
    return _post_json(url, {}, timeout=60)


def query(
    base: str,
    question: str,
    k: int = 6,
    score_threshold: float = 0.0,
    collection: Optional[str] = None,
) -> List[Dict[str, Any]]:
    payload: Dict[str, Any] = {"q": question, "k": int(k), "score_threshold": float(score_threshold)}
    url = _join(base, "/knowledge/query")
    if collection:
        url = f"{url}?{urlencode({'collection': collection})}"
    res = _post_json(url, payload, timeout=120)

    # Be permissive to both {"results":[...]} and bare arrays
    if isinstance(res, dict) and "results" in res and isinstance(res["results"], list):
        return res["results"]
    if isinstance(res, list):
        return res
    return [res]
