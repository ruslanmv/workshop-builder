#!/usr/bin/env python3
"""
test_workshop.py
End-to-end smoke test for the Workshop Builder backend (FastAPI + watsonx.ai + RAG + CrewAI).

Works both:
- on host with Docker Compose (Nginx on :80 → http://localhost/api)
- on bare dev server (Uvicorn on :5000 → http://localhost:5000/api)
- from inside containers (http://api:5000/api or http://web/api)

Usage:
  python examples/test_workshop.py \
    --api http://localhost/api \
    --key dev-key-123 \
    --tenant public \
    --download

Env fallbacks for flags:
  API_BASE, API_KEY, TENANT or TENANT_ID
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple, List

import requests

TUTORIAL_URL = "https://raw.githubusercontent.com/ruslanmv/universal-a2a-agent/master/docs/tutorial.md"

# --- Defaults (overridden by flags or env) ---
DEFAULT_API_BASE = os.getenv("API_BASE", "").strip() or ""  # we'll autodetect if empty
DEFAULT_API_KEY = os.getenv("API_KEY", "dev-key-123")
DEFAULT_TENANT = os.getenv("TENANT", os.getenv("TENANT_ID", "public"))

# --- API discovery candidates (ordered) ---
CANDIDATE_BASES: List[str] = [
    # host → Nginx
    "http://localhost/api",
    "http://127.0.0.1/api",
    # host → dev server
    "http://localhost:5000/api",
    "http://127.0.0.1:5000/api",
    # inside containers (compose network)
    "http://api:5000/api",
    "http://web/api",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="E2E test: ingest tutorial.md and generate a workshop.")
    p.add_argument("--api", default=DEFAULT_API_BASE, help="API base URL (points to /api). Leave empty to autodetect.")
    p.add_argument("--key", default=DEFAULT_API_KEY, help="X-API-Key for authenticated endpoints")
    p.add_argument("--tenant", default=DEFAULT_TENANT, help="Tenant id (X-Tenant-Id)")
    p.add_argument("--collection", default="workshop_docs", help="Logical collection name")
    p.add_argument("--title", default="Universal A2A — Hands-On Workshop", help="Generated workshop title")
    p.add_argument("--outputs", default="pdf,mkdocs,epub", help="Comma-separated outputs (pdf,mkdocs,epub,springer)")
    p.add_argument("--download", action="store_true", help="Download artifacts after completion")
    p.add_argument("--artifacts_dir", default="./artifacts", help="Directory to save artifacts if --download")
    p.add_argument("--insecure", action="store_true", help="Skip TLS verification (only if you set https locally)")
    p.add_argument("--timeout", type=int, default=60, help="HTTP timeout (non-streaming)")
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


def try_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 3, verify: bool = True) -> Optional[requests.Response]:
    try:
        r = requests.get(url, headers=headers or {}, timeout=timeout, verify=verify)
        return r
    except Exception:
        return None


def autodiscover_api_base(explicit: str, api_key: str, tenant: str, verify: bool) -> str:
    if explicit:
        # Trust the user-provided URL
        return explicit.rstrip("/")

    # Try unauthenticated health first (if present), then authenticated providers
    for base in CANDIDATE_BASES:
        base = base.rstrip("/")
        # health (likely public)
        r = try_get(f"{base}/health", timeout=2, verify=verify)
        if r is not None and r.status_code == 200:
            return base
        # providers (auth)
        r = try_get(f"{base}/providers", headers=HEADERS(api_key, tenant, json_ct=False), timeout=2, verify=verify)
        if r is not None and r.status_code == 200:
            return base
    fatal("Could not auto-detect API base. Pass --api or set API_BASE.", 2)
    return ""  # unreachable


def fetch_tutorial(url: str, verify: bool) -> str:
    print(f"→ Fetching tutorial markdown:\n  {url}")
    r = requests.get(url, timeout=20, verify=verify if url.startswith("https://") else True)
    if r.status_code != 200:
        fatal(f"Failed to fetch tutorial.md (status {r.status_code})")
    text = r.text
    if not text.strip():
        fatal("tutorial.md was empty")
    print(f"  ✓ Downloaded {len(text)} bytes.")
    return text


def api_post(api_base: str, path: str, api_key: str, tenant: str, payload: Dict, timeout: int, verify: bool) -> requests.Response:
    url = f"{api_base.rstrip('/')}/{path.lstrip('/')}"
    return requests.post(url, headers=HEADERS(api_key, tenant, json_ct=True), data=json.dumps(payload),
                         timeout=timeout, verify=verify)


def api_get(api_base: str, path: str, api_key: str, tenant: str, stream: bool, timeout: int, verify: bool) -> requests.Response:
    url = f"{api_base.rstrip('/')}/{path.lstrip('/')}"
    headers = HEADERS(api_key, tenant, json_ct=not stream)
    if stream:
        headers["Accept"] = "text/event-stream"
    return requests.get(url, headers=headers, timeout=None if stream else timeout, stream=stream, verify=verify)


def ingest_markdown(api_base: str, api_key: str, tenant: str, collection: str, md_text: str, timeout: int, verify: bool) -> Tuple[str, Dict]:
    """Use JSON-based /ingest/github ({files:[{path,text}]}) to avoid multipart."""
    body = {
        "collection": collection,
        "files": [
            {"path": "tutorial.md", "text": md_text, "title": "Universal A2A Tutorial"}
        ]
    }
    print(f"→ Ingesting into collection '{collection}' …")
    r = api_post(api_base, "/ingest/github", api_key, tenant, body, timeout, verify)
    if r.status_code not in (200, 202):
        fatal(f"Ingest failed ({r.status_code}): {r.text[:300]}")
    resp = r.json()
    if not resp.get("ok", True):  # some versions return {ok:True,count:n}
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
            "outputs": [],  # set later
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


def start_generation(api_base: str, api_key: str, tenant: str, project: Dict, timeout: int, verify: bool) -> Tuple[str, str]:
    print("→ Starting generation job …")
    r = api_post(api_base, "/generate/start", api_key, tenant, {"project": project}, timeout, verify)
    if r.status_code not in (200, 202):
        fatal(f"Start failed ({r.status_code}): {r.text[:300]}")
    resp = r.json()
    if not resp.get("ok", True):
        fatal(f"Start returned error: {resp}")
    job_id = resp["job_id"]
    stream_path = resp.get("stream") or f"/generate/stream?job_id={job_id}"
    print(f"  ✓ job_id={job_id}")
    return job_id, stream_path


def read_sse(api_base: str, api_key: str, tenant: str, stream_path: str, timeout: int, verify: bool) -> Dict[str, Dict]:
    """Minimal SSE reader with '/api/api/...' guard and robust field names."""
    path = stream_path.lstrip("/")
    if path.startswith("api/"):
        path = path[len("api/"):]
    print("→ Streaming events (SSE) … (Ctrl+C to stop)")
    r = api_get(api_base, path, api_key, tenant, stream=True, timeout=timeout, verify=verify)
    if r.status_code != 200:
        fatal(f"Stream failed ({r.status_code}): {r.text[:300]}")

    last: Dict[str, Dict] = {}
    event, buf = None, []

    try:
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw.strip()

            # Event boundary: emit
            if not line:
                if event and buf:
                    data_str = "\n".join(buf)
                    try:
                        payload = json.loads(data_str) if data_str else {}
                    except json.JSONDecodeError:
                        payload = {"raw": data_str}
                    last[event] = payload

                    if event == "progress":
                        pct = payload.get("pct", payload.get("percent"))
                        msg = payload.get("msg", payload.get("label"))
                        print(f"  • progress: {pct}% — {msg}")
                    elif event == "log":
                        print(f"  • log[{payload.get('level','info')}]: {payload.get('msg','')}")
                    elif event == "artifact":
                        label = payload.get("label", payload.get("id", "?"))
                        href = payload.get("href") or payload.get("path")
                        size = payload.get("size") or payload.get("bytes")
                        extra = f" ({size} bytes)" if size else ""
                        print(f"  • artifact: {label} → {href}{extra}")
                    elif event == "error":
                        print(f"  • ERROR: {payload}")
                    elif event == "done":
                        ok = payload.get("ok", True)
                        print("  ✓ done" if ok else "  ✗ done (error)")
                        break

                event, buf = None, []
                continue

            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                buf.append(line.split(":", 1)[1].lstrip())
            # ignore comments/other fields
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user.")

    return last


def list_artifacts(api_base: str, api_key: str, tenant: str, job_id: str, timeout: int, verify: bool) -> Dict:
    r = api_get(api_base, f"/exports/{job_id}", api_key, tenant, stream=False, timeout=timeout, verify=verify)
    if r.status_code != 200:
        fatal(f"List artifacts failed ({r.status_code}): {r.text[:300]}")
    return r.json()


def download_artifacts(api_base: str, api_key: str, tenant: str, job_id: str, items: Iterable[Dict], out_dir: Path, verify: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for a in items:
        href = a.get("href") or a.get("path")
        if not href:
            continue
        url = f"{api_base.rstrip('/')}/{href.lstrip('/')}"
        fn = href.split("/")[-1]
        print(f"→ Downloading {fn} …")
        with requests.get(url, headers=HEADERS(api_key, tenant, json_ct=False), stream=True, timeout=300, verify=verify) as resp:
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
    verify = not args.insecure  # only relevant if you point to https locally
    timeout = int(args.timeout)

    api_base = autodiscover_api_base(args.api.strip(), args.key, args.tenant, verify)
    api_key = args.key
    tenant = args.tenant
    collection = args.collection
    outputs = [o.strip() for o in args.outputs.split(",") if o.strip()]

    print("=== Workshop Builder E2E Test ===")
    print(f"API      : {api_base}")
    print(f"Tenant   : {tenant}")
    print(f"Collection: {collection}")
    print(f"Outputs  : {', '.join(outputs)}\n")

    md = fetch_tutorial(TUTORIAL_URL, verify)
    ingest_collection, _docmap = ingest_markdown(api_base, api_key, tenant, collection, md, timeout, verify)

    project = build_project_payload(args.title, ingest_collection)
    project["intent"]["outputs"] = outputs

    job_id, stream_path = start_generation(api_base, api_key, tenant, project, timeout, verify)
    read_sse(api_base, api_key, tenant, stream_path, timeout, verify)

    listing = list_artifacts(api_base, api_key, tenant, job_id, timeout, verify)
    arts = listing.get("artifacts", [])
    if arts:
        print("\nArtifacts:")
        for a in arts:
            label = a.get("label", a.get("id", "?"))
            href = a.get("href") or a.get("path")
            size = a.get("bytes") or a.get("size") or "?"
            print(f"  - {label}  →  {href}  ({size} bytes)")
        if args.download:
            download_artifacts(api_base, api_key, tenant, job_id, arts, Path(args.artifacts_dir), verify)
    else:
        print("No artifacts reported.")

    print("\n✅ Test completed.")


if __name__ == "__main__":
    main()
