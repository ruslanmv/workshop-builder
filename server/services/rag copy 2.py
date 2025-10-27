# server/services/rag.py
from __future__ import annotations
from typing import Any, Dict, List, Optional
import re
import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from ..config import Settings
from .watsonx import build_clients, wx_embed_text

# --- Helpers -----------------------------------------------------------------

_ALLOWED = re.compile(r"[^a-zA-Z0-9._-]+")

def _sanitize_collection(name: str) -> str:
    """
    Make a Chroma-compatible collection name (3-512 chars, [a-zA-Z0-9._-], start/end alnum).
    We DO NOT include tenant here; tenant is passed via Chroma's tenant= parameter.
    """
    name = (name or "default").strip()
    name = _ALLOWED.sub("-", name)
    # must start/end with alnum
    name = re.sub(r"^[^A-Za-z0-9]+", "", name)
    name = re.sub(r"[^A-Za-z0-9]+$", "", name)
    if len(name) < 3:
        name = (name + "-xxx")[:3]
    return name[:512]

def _split_text(md: str) -> List[str]:
    # Token-aware-ish splitter with overlap
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1200,
        chunk_overlap=160,
        separators=["\n\n", "\n", ". ", " "],
    )
    return splitter.split_text(md or "")

def _chroma(cfg: Settings):
    return chromadb.Client(ChromaSettings(persist_directory=cfg.CHROMA_DIR))

def ensure_collection(cfg: Settings, name: str, *, tenant: Optional[str] = None):
    """
    Create or get a collection under a specific tenant without putting tenant in the name.
    """
    db = _chroma(cfg)
    safe = _sanitize_collection(name)
    # get_or_create avoids race + simplifies code; pass tenant= explicitly
    try:
        return db.get_or_create_collection(name=safe, tenant=tenant)
    except TypeError:
        # Older chromadb versions may not support tenant= on get_or_create_collection.
        # Fallback to try get/create with tenant= when available.
        try:
            return db.get_collection(name=safe, tenant=tenant)  # type: ignore[call-arg]
        except Exception:
            return db.create_collection(name=safe, tenant=tenant)  # type: ignore[call-arg]

# --- Public API ---------------------------------------------------------------

def ingest_texts(cfg: Settings, collection: str, items: List[Dict[str, Any]], tenant: Optional[str] = None) -> Dict[str, Any]:
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
            metas.append({"path": path, "i": i, **({"title": title} if title else {})})

    if not texts:
        return {"count": 0}

    # Batched embeddings
    BATCH = 64
    vectors: List[List[float]] = []
    for i in range(0, len(texts), BATCH):
        vectors.extend(wx_embed_text(wx, texts[i : i + BATCH]))

    col.add(ids=ids, documents=texts, embeddings=vectors, metadatas=metas)
    return {"count": len(texts)}

def query(cfg: Settings, collection: str, q: str, k: int = 6, tenant: Optional[str] = None) -> List[Dict[str, Any]]:
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
        hits.append({"path": meta.get("path"), "text": doc, "distance": float(dist), "similarity": sim, "meta": meta})
    return hits
