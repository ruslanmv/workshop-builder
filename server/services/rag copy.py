from __future__ import annotations
from typing import Any, Dict, List
import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from ..config import Settings
from .watsonx import build_clients, wx_embed_text

def _split_text(md: str) -> List[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1200, chunk_overlap=160, separators=["\n\n", "\n", ". ", " "]
    )
    return splitter.split_text(md or "")

def _chroma(cfg: Settings):
    return chromadb.Client(ChromaSettings(persist_directory=cfg.CHROMA_DIR))

def ensure_collection(cfg: Settings, name: str):
    db = _chroma(cfg)
    try:
        return db.get_collection(name)
    except Exception:
        return db.create_collection(name)

def ingest_texts(cfg: Settings, collection: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    wx = build_clients(cfg)
    col = ensure_collection(cfg, collection)
    ids: List[str] = []
    texts: List[str] = []
    metas: List[Dict[str, Any]] = []
    for it in items:
        path = it.get("path") or "doc"
        for i, chunk in enumerate(_split_text(it.get("text") or "")):
            ids.append(f"{path}::chunk::{i}")
            texts.append(chunk)
            metas.append({"path": path, "i": i, "title": it.get("title")})
    if not texts:
        return {"count": 0}
    B = 64
    vectors: List[List[float]] = []
    for i in range(0, len(texts), B):
        vectors.extend(wx_embed_text(wx, texts[i:i+B]))
    col.add(ids=ids, documents=texts, embeddings=vectors, metadatas=metas)
    return {"count": len(texts)}

def query(cfg: Settings, collection: str, q: str, k: int = 6) -> List[Dict[str, Any]]:
    wx = build_clients(cfg)
    col = ensure_collection(cfg, collection)
    vec = wx_embed_text(wx, [q])[0]
    res = col.query(query_embeddings=[vec], n_results=int(k))
    docs = res.get("documents", [[]])[0]
    metas = res.get("metadatas", [[]])[0]
    dists = res.get("distances", [[]])[0]
    hits: List[Dict[str, Any]] = []
    for doc, meta, dist in zip(docs, metas, dists):
        similarity = 1.0 - float(dist)
        hits.append({"path": meta.get("path"), "text": doc, "distance": float(dist), "similarity": similarity, "score": similarity})
    return hits
