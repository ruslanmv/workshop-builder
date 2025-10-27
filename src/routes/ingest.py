# SPDX-License-Identifier: Apache-20
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request

from ..config import settings
from ..services import rag_service, repo_service
from ..services.ingest_pipeline import IngestPipeline
from ..utils.fs import stage_into_bind, rewrite_for_container

bp = Blueprint("ingest", __name__, url_prefix="/api/ingest")
log = logging.getLogger("routes.ingest")


@bp.post("")
def ingest() -> Any:
    """
    POST /api/ingest
    Body:
      {
        "source": "github|local|inline|url|pdf|txt",
        "github_url": "...",             # when source=github
        "local_path": "/path|dir",       # when source=local/pdf/txt/html
        "items": [ ... ],                # optional mixed items (see IngestPipeline.normalize_inputs)
        "collection": "workshop_docs",
        "chunk_size": 1400,
        "chunk_overlap": 160,
        "include_ext": [".md",".txt"],
        "exclude_ext": [".png",".jpg",".pdf"],
        "bind_map": "/host/root:/container/root",     # optional for Docker visibility
        "stage_into_bind": true                       # copies inputs into host bind
      }
    Returns: { indexed:[...], post_stats:{...} }
    """
    data: Dict[str, Any] = request.get_json(force=True) or {}
    source = str(data.get("source", "github")).lower().strip()
    collection = data.get("collection") or settings.A2A_COLLECTION
    chunk_size = int(data.get("chunk_size", settings.A2A_CHUNK_SIZE))
    chunk_overlap = int(data.get("chunk_overlap", settings.A2A_CHUNK_OVERLAP))
    include_ext = data.get("include_ext") or [x.strip() for x in settings.A2A_INCLUDE_EXT.split(",")]
    exclude_ext = data.get("exclude_ext") or [x.strip() for x in settings.A2A_EXCLUDE_EXT.split(",")]

    # Optional container bind mapping
    bind_map = data.get("bind_map")
    stage_flag = bool(data.get("stage_into_bind", False))
    host_root: Optional[str] = None
    container_root: Optional[str] = None
    if bind_map and ":" in str(bind_map):
        host_root, container_root = str(bind_map).split(":", 1)

    pipeline = IngestPipeline()

    # Resolve paths/items to feed RAG
    staged_paths: List[str] = []
    try:
        if source == "github":
            url = str(data.get("github_url") or "").strip()
            if not url:
                return jsonify({"error": "github_url is required"}), 400
            repo_dir = repo_service.safe_clone(url, settings.REPO_DIR)
            target = repo_dir  # ingest whole repo by default
            staged_paths = [str(target)]
        elif source == "local":
            lp = str(data.get("local_path") or "").strip()
            if not lp:
                return jsonify({"error": "local_path is required"}), 400
            staged_paths = [lp]
        elif source in {"inline", "url", "pdf", "txt", "html"}:
            items = data.get("items")
            if not items:
                return jsonify({"error": "items array is required for inline/url/pdf/txt/html"}), 400
            norm = pipeline.normalize_inputs(items)
            staged_paths = [str(p) for p in norm]
        else:
            return jsonify({"error": f"Unsupported source: {source}"}), 400
    except Exception as e:
        log.exception("Normalization failed")
        return jsonify({"error": f"normalization error: {e}"}), 400

    # Handle container visibility
    final_paths: List[str] = []
    for p in staged_paths:
        if stage_flag and host_root and container_root:
            host_staged, cont_path = stage_into_bind(p, host_root, container_root)
            final_paths.append(str(cont_path))
        elif host_root and container_root:
            cont = rewrite_for_container(p, host_root, container_root)
            final_paths.append(str(cont or p))
        else:
            final_paths.append(str(p))

    # Ingest
    try:
        ingest_res = rag_service.ingest_paths(
            base_url=settings.A2A_BASE,
            paths=final_paths,
            collection=collection,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            include_ext=include_ext,
            exclude_ext=exclude_ext,
            timeout_s=900,
        )
        stats = rag_service.stats(settings.A2A_BASE, collection=collection) or {}
    except Exception as e:
        log.exception("Ingest failed")
        return jsonify({"error": str(e)}), 500

    return jsonify({"indexed": ingest_res.get("indexed", final_paths), "post_stats": stats})


@bp.post("/query")
def query() -> Any:
    """
    POST /api/ingest/query
    Body:
      {
        "question": "string",
        "collection": "workshop_docs",
        "k": 6,                 # alias: top_k
        "score_threshold": 0.0
      }
    Returns:
      { "results": [...], "stats": {...}, "k": int, "score_threshold": float }
    """
    data: Dict[str, Any] = request.get_json(force=True) or {}
    question = (data.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400

    collection = data.get("collection") or settings.A2A_COLLECTION
    k = int(data.get("k") or data.get("top_k") or 6)
    score = float(data.get("score_threshold") or 0.0)

    try:
        results = rag_service.query(
            base_url=settings.A2A_BASE,
            question=question,
            collection=collection,
            k=k,
            score_threshold=score,
            timeout_s=60,
        )
        stats = rag_service.stats(settings.A2A_BASE, collection=collection) or {}
    except Exception as e:
        log.exception("Query failed")
        return jsonify({"error": str(e)}), 500

    return jsonify({"results": results, "stats": stats, "k": k, "score_threshold": score})
