#!/usr/bin/env python3
# scripts/ingest_repo.py
from __future__ import annotations
import argparse, os, sys, json
from pathlib import Path
import requests

def main():
    ap = argparse.ArgumentParser("Ingest a file/dir into A2A /knowledge")
    ap.add_argument("target", help="Absolute path to file or directory to ingest")
    ap.add_argument("--base", default=os.getenv("A2A_BASE","http://localhost:8000"))
    ap.add_argument("--collection", default=None)
    ap.add_argument("--chunk-size", type=int, default=int(os.getenv("A2A_CHUNK_SIZE","1400")))
    ap.add_argument("--chunk-overlap", type=int, default=int(os.getenv("A2A_CHUNK_OVERLAP","160")))
    ap.add_argument("--include-ext", default=os.getenv("A2A_INCLUDE_EXT",".md,.mdx,.py,.ipynb,.txt"))
    ap.add_argument("--exclude-ext", default=os.getenv("A2A_EXCLUDE_EXT",".png,.jpg,.jpeg,.gif,.pdf"))
    ap.add_argument("--query", default=None, help="Optional query to run after ingest")
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--score-threshold", type=float, default=0.0)
    a = ap.parse_args()

    target = Path(a.target).resolve()
    if not target.exists():
        print(f"❌ Target not found: {target}")
        return 2

    payload = {
        "paths": [str(target)],
        "chunk_size": a.chunk_size,
        "chunk_overlap": a.chunk_overlap,
        "include_ext": [x.strip() for x in a.include_ext.split(",") if x.strip()],
        "exclude_ext": [x.strip() for x in a.exclude_ext.split(",") if x.strip()],
    }
    if a.collection:
        payload["collection"] = a.collection

    print(f"→ POST {a.base}/knowledge/ingest")
    r = requests.post(f"{a.base}/knowledge/ingest", json=payload, timeout=600)
    if r.status_code != 200:
        print(f"❌ Ingest failed: {r.status_code} {r.text}"); return 5
    print("✅ Ingest ok:", json.dumps(r.json(), indent=2))

    if a.query:
        q = {
            "q": a.query,
            "k": a.k,
            "score_threshold": a.score_threshold,
        }
        if a.collection: q["collection"] = a.collection
        print(f"\n→ POST {a.base}/knowledge/query")
        r2 = requests.post(f"{a.base}/knowledge/query", json=q, timeout=60)
        if r2.status_code != 200:
            print(f"❌ Query failed: {r2.status_code} {r2.text}"); return 6
        print("✅ Results:", json.dumps(r2.json(), indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
