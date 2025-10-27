#!/usr/bin/env python3
"""
test_workshop.py
End-to-end smoke test for the Workshop Builder backend (FastAPI + watsonx.ai + RAG + CrewAI).

Steps:
1) Fetch tutorial.md from GitHub.
2) Ingest into the backend collection.
3) Start a "workshop" generation job.
4) Stream SSE progress/logs/artifacts until done.
5) List artifacts (and optionally download them).

Usage:
  python test_workshop.py \
    --api http://localhost:5000/api \
    --key dev-key-123 \
    --tenant public \
    --download

Environment variables (fallbacks for flags):
  API_BASE, API_KEY, TENANT or TENANT_ID

Requires: requests
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

import requests

TUTORIAL_URL = "https://raw.githubusercontent.com/ruslanmv/universal-a2a-agent/master/docs/tutorial.md"

# --- Hard-default credentials for local dev ---
DEFAULT_API_BASE = os.getenv("API_BASE", "http://localhost:5000/api")
DEFAULT_API_KEY = os.getenv("API_KEY", "dev-key-123")
DEFAULT_TENANT = os.getenv("TENANT", os.getenv("TENANT_ID", "public"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="E2E test: ingest tutorial.md and generate a workshop.")
    p.add_argument("--api", default=DEFAULT_API_BASE, help="API base URL (points to /api)")
    p.add_argument("--key", default=DEFAULT_API_KEY, help="X-API-Key for authenticated endpoints")
    p.add_argument("--tenant", default=DEFAULT_TENANT, help="Tenant id (X-Tenant-Id)")
    p.add_argument("--collection", default="workshop_docs", help="Logical collection name")
    p.add_argument("--title", default="Universal A2A — Hands-On Workshop",
                   help="Title used for the generated workshop")
    p.add_argument("--outputs", default="pdf,mkdocs,epub",
                   help="Comma-separated outputs (pdf,mkdocs,epub,springer)")
    p.add_argument("--download", action="store_true", help="Download artifacts after completion")
    p.add_argument("--artifacts_dir", default="./artifacts", help="Directory to save artifacts if --download")
    return p.parse_args()


def HEADERS(api_key: str, tenant: str, json_ct: bool = True) -> Dict[str, str]:
    h = {
        "X-API-Key": api_key or DEFAULT_API_KEY,
        "X-Tenant-Id": tenant or DEFAULT_TENANT,
    }
    if json_ct:
        h["Content-Type"] = "application/json"
    return h


def fatal(msg: str, code: int = 1) -> None:
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(code)


def fetch_tutorial(url: str) -> str:
    print(f"→ Fetching tutorial markdown:\n  {url}")
    r = requests.get(url, timeout=20)
    if r.status_code != 200:
        fatal(f"Failed to fetch tutorial.md (status {r.status_code})")
    text = r.text
    if not text.strip():
        fatal("tutorial.md was empty")
    print(f"  ✓ Downloaded {len(text)} bytes.")
    return text


def api_post(api_base: str, path: str, api_key: str, tenant: str, payload: Dict) -> requests.Response:
    url = f"{api_base.rstrip('/')}/{path.lstrip('/')}"
    return requests.post(url, headers=HEADERS(api_key, tenant, json_ct=True),
                         data=json.dumps(payload), timeout=60)


def api_get(api_base: str, path: str, api_key: str, tenant: str, stream: bool = False) -> requests.Response:
    url = f"{api_base.rstrip('/')}/{path.lstrip('/')}"
    return requests.get(url, headers=HEADERS(api_key, tenant, json_ct=not stream),
                        timeout=None if stream else 60, stream=stream)


def ingest_markdown(api_base: str, api_key: str, tenant: str, collection: str, md_text: str) -> Tuple[str, Dict]:
    """Use JSON-based /ingest/github ({files:[{path,text}]}) to avoid multipart."""
    body = {
        "collection": collection,
        "files": [
            {"path": "tutorial.md", "text": md_text, "title": "Universal A2A Tutorial"}
        ]
    }
    print(f"→ Ingesting into collection '{collection}' …")
    r = api_post(api_base, "/ingest/github", api_key, tenant, body)
    if r.status_code not in (200, 202):
        fatal(f"Ingest failed ({r.status_code}): {r.text[:300]}")
    resp = r.json()
    if not resp.get("ok"):
        fatal(f"Ingest returned error: {resp}")
    print(f"  ✓ Ingested {resp.get('count', 0)} chunks.")
    return collection, resp.get("docmap", {"nodes": []})


def build_project_payload(title: str, collection: str) -> Dict:
    now_ms = int(time.time() * 1000)
    return {
        "id": f"draft_{now_ms}",
        "name": title,
        "createdAt": now_ms,
        "intake": {
            "collection": collection,
            "docmap": None,
        },
        "intent": {
            "projectType": "workshop",
            "outputs": [],  # filled by caller
            "title": title,
            "subtitle": "Generated from tutorial.md",
            "authors": ["Automation"],
            "audience": "Practitioners",
            "tone": "Pragmatic",
            "constraints": "mode:workshop\npackage:zip\nincludeLatex:true",
            "due": None,
            "editorialPreset": "springer"
        },
        "outline": {
            "plan": None,
            "scheduleJson": None,
            "approved": True
        }
    }


def start_generation(api_base: str, api_key: str, tenant: str, project: Dict) -> Tuple[str, str]:
    print("→ Starting generation job …")
    r = api_post(api_base, "/generate/start", api_key, tenant, {"project": project})
    if r.status_code not in (200, 202):
        fatal(f"Start failed ({r.status_code}): {r.text[:300]}")
    resp = r.json()
    if not resp.get("ok"):
        fatal(f"Start returned error: {resp}")
    job_id = resp["job_id"]
    # Server may return '/api/generate/stream?...' or '/generate/stream?...'
    stream_path = resp.get("stream") or f"/generate/stream?job_id={job_id}"
    print(f"  ✓ job_id={job_id}")
    return job_id, stream_path


def read_sse(api_base: str, api_key: str, tenant: str, stream_path: str) -> Dict[str, Dict]:
    """Minimal SSE reader with '/api/api/...' guard."""
    # Always build a relative path
    if stream_path.startswith("/"):
        stream_url_path = stream_path.lstrip("/")
    else:
        stream_url_path = stream_path
    # If the server returned 'api/generate/stream...', drop the leading 'api/' to avoid '/api/api/...'
    if stream_url_path.startswith("api/"):
        stream_url_path = stream_url_path[len("api/"):]
    print("→ Streaming events (SSE) … (Ctrl+C to stop)")
    r = api_get(api_base, stream_url_path, api_key, tenant, stream=True)
    if r.status_code != 200:
        fatal(f"Stream failed ({r.status_code}): {r.text[:300]}")

    last: Dict[str, Dict] = {}
    event, buf = None, []

    try:
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw.strip()
            if not line:
                if event and buf:
                    data_str = "\n".join(buf)
                    try:
                        payload = json.loads(data_str) if data_str else {}
                    except json.JSONDecodeError:
                        payload = {"raw": data_str}
                    last[event] = payload
                    if event == "progress":
                        print(f"  • progress: {payload.get('percent')}% — {payload.get('label')}")
                    elif event == "log":
                        print(f"  • log[{payload.get('level','info')}]: {payload.get('msg','')}")
                    elif event == "artifact":
                        print(f"  • artifact ready: {payload.get('label', payload.get('id'))} → {payload.get('href')}")
                    elif event == "error":
                        print(f"  • ERROR: {payload}")
                    elif event == "done":
                        print("  ✓ done")
                        break
                event, buf = None, []
                continue
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                buf.append(line.split(":", 1)[1].lstrip())
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user.")
    return last


def list_artifacts(api_base: str, api_key: str, tenant: str, job_id: str) -> Dict:
    r = api_get(api_base, f"/exports/{job_id}", api_key, tenant, stream=False)
    if r.status_code != 200:
        fatal(f"List artifacts failed ({r.status_code}): {r.text[:300]}")
    return r.json()


def download_artifacts(api_base: str, api_key: str, tenant: str, job_id: str, items: Iterable[Dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for a in items:
        href = a.get("href")
        if not href:
            continue
        url = f"{api_base.rstrip('/')}/{href.lstrip('/')}"
        fn = href.split("/")[-1]
        print(f"→ Downloading {fn} …")
        with requests.get(url, headers=HEADERS(api_key, tenant, json_ct=False), stream=True, timeout=300) as resp:
            if resp.status_code != 200:
                print(f"  ! failed ({resp.status_code}) for {fn}")
                continue
            fp = out_dir / fn
            with open(fp, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 16):
                    if chunk:
                        f.write(chunk)
        print(f"  ✓ saved {fn} → {out_dir / fn}")


def main() -> None:
    args = parse_args()
    api_base = args.api.rstrip("/")
    api_key = args.key
    tenant = args.tenant
    collection = args.collection
    outputs = [o.strip() for o in args.outputs.split(",") if o.strip()]

    print("=== Workshop Builder E2E Test ===")
    print(f"API      : {api_base}")
    print(f"Tenant   : {tenant}")
    print(f"Collection: {collection}")
    print(f"Outputs  : {', '.join(outputs)}\n")

    md = fetch_tutorial(TUTORIAL_URL)
    ingest_collection, _docmap = ingest_markdown(api_base, api_key, tenant, collection, md)

    project = build_project_payload(args.title, ingest_collection)
    project["intent"]["outputs"] = outputs

    job_id, stream_path = start_generation(api_base, api_key, tenant, project)
    read_sse(api_base, api_key, tenant, stream_path)

    listing = list_artifacts(api_base, api_key, tenant, job_id)
    arts = listing.get("artifacts", [])
    if arts:
        print("\nArtifacts:")
        for a in arts:
            print(f"  - {a.get('label')}  →  {a.get('href')}  ({a.get('bytes','?')} bytes)")
        if args.download:
            download_artifacts(api_base, api_key, tenant, job_id, arts, Path(args.artifacts_dir))
    else:
        print("No artifacts reported.")

    print("\n✅ Test completed.")


if __name__ == "__main__":
    main()
