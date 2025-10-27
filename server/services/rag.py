# server/services/rag.py
from __future__ import annotations
from typing import Any, Dict, List, Optional
import re
import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from ..config import Settings
from .watsonx import build_clients, wx_embed_text

# --------------------- Name sanitation & namespacing -------------------------

_ALLOWED = re.compile(r"[^a-zA-Z0-9._-]+")

def _sanitize_component(s: str | None, fallback: str) -> str:
    s = (s or fallback).strip()
    s = _ALLOWED.sub("-", s)
    # start/end must be alnum
    s = re.sub(r"^[^A-Za-z0-9]+", "", s)
    s = re.sub(r"[^A-Za-z0-9]+$", "", s)
    if not s:
        s = fallback
    return s[:200]  # keep components short so combined <=512

def _compose_collection_name(tenant: Optional[str], name: str) -> str:
    """
    Produce a Chroma-compatible collection name for a tenant + logical collection.
    Chroma allows [a-zA-Z0-9._-], 3–512 chars, must start/end alnum.
    """
    t = _sanitize_component(tenant, "public")
    n = _sanitize_component(name, "default")
    combined = f"{t}__{n}"
    # ensure overall validity and length
    combined = re.sub(r"^[^A-Za-z0-9]+", "t", combined)
    combined = re.sub(r"[^A-Za-z0-9]+$", "x", combined)
    if len(combined) < 3:
        combined = (combined + "xxx")[:3]
    return combined[:512]

# --------------------- Text split & Chroma client ---------------------------

def _split_text(md: str) -> List[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1200, chunk_overlap=160, separators=["\n\n", "\n", ". ", " "]
    )
    return splitter.split_text(md or "")

def _chroma(cfg: Settings):
    return chromadb.Client(ChromaSettings(persist_directory=cfg.CHROMA_DIR))

def ensure_collection(cfg: Settings, name: str, *, tenant: Optional[str] = None):
    """
    get_or_create a collection, **without** using Chroma's `tenant=` arg (not available
    on older client), by composing a safe name like '<tenant>__<name>'.
    """
    db = _chroma(cfg)
    safe = _compose_collection_name(tenant, name)
    # Prefer get_or_create when available; otherwise emulate.
    try:
        return db.get_or_create_collection(name=safe)
    except AttributeError:
        try:
            return db.get_collection(name=safe)
        except Exception:
            return db.create_collection(name=safe)

# --------------------- Public API -------------------------------------------

def ingest_texts(
    cfg: Settings,
    collection: str,
    items: List[Dict[str, Any]],
    tenant: Optional[str] = None,
) -> Dict[str, Any]:
    """
    items: [{ "path": "docs/x.md", "text": "...", "title": "Optional title" }, ...]
    """
    wx = build_clients(cfg)
    col = ensure_collection(cfg, collection, tenant=tenant)

    ids: List[str] = []
    texts: List[str] = []
    metas: List[Dict[str, Any]] = []

    for it in items:
        path = (it.get("path") or "doc").strip()
        title = it.get("title")
        for i, chunk in enumerate(_split_text(it.get("text") or "")):
            ids.append(f"{path}::chunk::{i}")
            texts.append(chunk)
            meta = {"path": path, "i": i}
            if title:
                meta["title"] = title
            metas.append(meta)

    if not texts:
        return {"count": 0}

    # Batched embeddings
    BATCH = 64
    vectors: List[List[float]] = []
    for i in range(0, len(texts), BATCH):
        vectors.extend(wx_embed_text(wx, texts[i : i + BATCH]))

    col.add(ids=ids, documents=texts, embeddings=vectors, metadatas=metas)
    return {"count": len(texts)}

def query(
    cfg: Settings,
    collection: str,
    q: str,
    k: int = 6,
    tenant: Optional[str] = None,
) -> List[Dict[str, Any]]:
    wx = build_clients(cfg)
    col = ensure_collection(cfg, collection, tenant=tenant)
    qvec = wx_embed_text(wx, [q])[0]
    res = col.query(query_embeddings=[qvec], n_results=int(k))
    docs = res.get("documents", [[]])[0]
    metas = res.get("metadatas", [[]])[0]
    dists = res.get("distances", [[]])[0]  # cosine distance (lower is closer)
    hits: List[Dict[str, Any]] = []
    for doc, meta, dist in zip(docs, metas, dists):
        sim = 1.0 - float(dist)
        hits.append(
            {
                "path": meta.get("path"),
                "text": doc,
                "distance": float(dist),
                "similarity": sim,
                "meta": meta,
            }
        )
    return hits
