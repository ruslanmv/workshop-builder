import React, { useCallback, useMemo, useState } from "react";
import api from "../lib/api";
import type { DocMapLike as PreviewDocMapLike } from "./PlanPreview";

/** Re-export a compatible DocMapLike so other modules can import from here. */
export type DocMapLike = PreviewDocMapLike;

type RepoDocFile = { path: string; title?: string | null; size: number; sha256: string };
type RepoDocMap = { repo: string; commit?: string; files: RepoDocFile[] };

export type IngestResult = {
  indexed: string[];
  post_stats?: unknown;
  docmap?: PreviewDocMapLike | null;
  lastQuery?: { results: unknown[]; k: number; score_threshold: number; stats?: unknown };
};

type Source = "github" | "local" | "inline" | "url" | "pdf" | "txt" | "html";

type Props = {
  onAfterIngest?: (result: IngestResult) => void;
  onDocMap?: (docmap: PreviewDocMapLike | null) => void;
};

function Info({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3 text-xs text-gray-700">{children}</div>
  );
}

export default function RepoIngestForm({ onAfterIngest, onDocMap }: Props) {
  const [source, setSource] = useState<Source>("github");
  const [githubUrl, setGithubUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [collection, setCollection] = useState("workshop_docs");
  const [chunkSize, setChunkSize] = useState(1400);
  const [chunkOverlap, setChunkOverlap] = useState(160);
  const [includeExt, setIncludeExt] = useState(".md,.mdx,.py,.ipynb,.txt");
  const [excludeExt, setExcludeExt] = useState(".png,.jpg,.jpeg,.gif,.pdf");
  const [bindMap, setBindMap] = useState("");
  const [stage, setStage] = useState(true);
  const [question, setQuestion] = useState("List primary endpoints or key topics.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemsArray = useMemo(() => {
    const lines = itemsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.map((line) => {
      if (source === "inline") return { kind: "inline", text: line, name: "snippet.md" };
      if (source === "url") return { kind: "url", url: line };
      if (source === "pdf") return { kind: "pdf", path: line };
      if (source === "txt") return { kind: "txt", path: line };
      if (source === "html") return { kind: "html", path: line };
      return { kind: "unknown", value: line };
    });
  }, [itemsText, source]);

  const normalizeDocMap = (raw: unknown): PreviewDocMapLike | null => {
    try {
      const dm = raw as RepoDocMap;
      if (!dm || typeof dm !== "object" || !("files" in dm)) return null;
      const files = Array.isArray(dm.files)
        ? dm.files.map((f) => ({
            path: String((f as RepoDocFile).path),
            title: (f as RepoDocFile).title ?? undefined, // strip null -> undefined
          }))
        : [];
      return { repo: (dm as RepoDocMap).repo ?? "", files };
    } catch {
      return null;
    }
  };

  const ingest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        source,
        collection,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        include_ext: includeExt.split(",").map((s) => s.trim()).filter(Boolean),
        exclude_ext: excludeExt.split(",").map((s) => s.trim()).filter(Boolean),
      };

      if (bindMap) payload.bind_map = bindMap;
      if (stage) payload.stage_into_bind = true;

      if (source === "github") payload.github_url = githubUrl.trim();
      if (source === "local") payload.local_path = localPath.trim();
      if (["inline", "url", "pdf", "txt", "html"].includes(source)) payload.items = itemsArray;

      const res = await api.ingest(payload);
      const result: IngestResult = { indexed: res.indexed, post_stats: res.post_stats || {} };

      // Optional smoke query to verify collection readability
      if (question.trim()) {
        const q = await api.query({
          question,
          collection,
          k: 6,
          score_threshold: 0.0,
        });
        result.lastQuery = q;
      }

      onAfterIngest?.(result);

      // Try to build a DocMap (if backend supports /api/analyze)
      try {
        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(
            source === "github"
              ? { github_url: githubUrl.trim() }
              : source === "local"
              ? { local_path: localPath.trim() }
              : {}
          ),
        });
        if (analyzeRes.ok) {
          const data = await analyzeRes.json();
          const normalized = normalizeDocMap(data?.docmap);
          onDocMap?.(normalized);
          result.docmap = normalized;
        } else {
          onDocMap?.(null);
        }
      } catch {
        onDocMap?.(null);
      }
    } catch (e: any) {
      setError(e?.message || "Ingest failed");
    } finally {
      setBusy(false);
    }
  }, [
    bindMap,
    chunkOverlap,
    chunkSize,
    collection,
    excludeExt,
    githubUrl,
    includeExt,
    itemsArray,
    localPath,
    onAfterIngest,
    onDocMap,
    question,
    source,
    stage,
  ]);

  return (
    <div className="card card-hover">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-medium">Ingest Sources</h3>
        <span className={`badge ${busy ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-700"}`}>
          {busy ? "Working…" : "Ready"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">Source</label>
          <select
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
          >
            <option value="github">GitHub</option>
            <option value="local">Local Path (server)</option>
            <option value="url">URL(s)</option>
            <option value="pdf">PDF path(s)</option>
            <option value="txt">TXT path(s)</option>
            <option value="html">HTML path(s)</option>
            <option value="inline">Inline text</option>
          </select>
        </div>

        <div>
          <label className="label">Collection</label>
          <input
            className="input"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            placeholder="workshop_docs"
          />
        </div>
      </div>

      {/* Source-specific inputs */}
      {source === "github" && (
        <div>
          <label className="label">GitHub URL</label>
          <input
            className="input"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/org/repo.git"
          />
          <div className="mt-2">
            <Info>Private repos require the backend to be configured with access.</Info>
          </div>
        </div>
      )}

      {source === "local" && (
        <div>
          <label className="label">Local path (visible to server)</label>
          <input
            className="input"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/abs/path/to/file-or-folder"
          />
        </div>
      )}

      {["url", "pdf", "txt", "html", "inline"].includes(source) && (
        <div>
          <label className="label">
            {source === "inline" ? "Inline lines" : "One item per line"}
          </label>
          <textarea
            className="input h-28"
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            placeholder={
              source === "url"
                ? "https://example.com/page1\nhttps://example.com/page2"
                : source === "inline"
                ? "Paste text snippets...\nEach line becomes a small doc."
                : "/abs/path/one.pdf\n/abs/path/two.pdf"
            }
          />
        </div>
      )}

      {/* Chunking + query */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">Chunk size</label>
          <input
            type="number"
            className="input"
            value={chunkSize}
            min={256}
            onChange={(e) => setChunkSize(parseInt(e.target.value || "1400", 10) || 1400)}
          />
        </div>
        <div>
          <label className="label">Chunk overlap</label>
          <input
            type="number"
            className="input"
            value={chunkOverlap}
            min={0}
            onChange={(e) => setChunkOverlap(parseInt(e.target.value || "160", 10) || 160)}
          />
        </div>
        <div>
          <label className="label">Query (smoke test)</label>
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask something about the content..."
          />
        </div>
      </div>

      {/* Include/Exclude */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">Include extensions (CSV)</label>
          <input
            className="input"
            value={includeExt}
            onChange={(e) => setIncludeExt(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Exclude extensions (CSV)</label>
          <input
            className="input"
            value={excludeExt}
            onChange={(e) => setExcludeExt(e.target.value)}
          />
        </div>
      </div>

      {/* Bind + stage */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">Bind map (optional: HOST:CONTAINER)</label>
          <input
            className="input"
            value={bindMap}
            onChange={(e) => setBindMap(e.target.value)}
            placeholder="/Users/me/project:/work"
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={stage}
              onChange={(e) => setStage(e.target.checked)}
            />
            <span className="text-sm text-gray-700">
              Stage into bind (copy/symlink into container-visible dir)
            </span>
          </label>
        </div>
      </div>

      {/* Errors + actions */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn" onClick={ingest} disabled={busy}>
          {busy ? "Working…" : "Ingest & Test"}
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => {
            setGithubUrl("");
            setLocalPath("");
            setItemsText("");
          }}
          disabled={busy}
        >
          Clear Inputs
        </button>
      </div>

      {/* Helpful note */}
      <div className="mt-3 text-xs text-gray-500">
        After ingest, use <b>Plan Preview</b> to inspect retrieval snippets and tune your
        collection parameters.
      </div>
    </div>
  );
}
