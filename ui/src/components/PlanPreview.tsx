import React, { useEffect, useMemo, useState } from "react";

/**
 * PlanPreview (modernized)
 * - Left: Outline tree (Chapters & Labs)
 * - Right: Live RAG preview for the selected section
 * - Small toolbar to tweak collection / k / threshold
 * - Helpful empty states + docmap context
 */

export type Chapter = { title: string; target_path: string; sources?: string[] };
export type Lab = { title: string; target_path: string; sources?: string[] };
export type OutlinePlan = { chapters?: Chapter[]; labs?: Lab[] };

export type DocMapLike = {
  repo?: string;
  files?: Array<{ path: string; title?: string }>;
};

export type IngestResult = {
  collection?: string;
  indexed?: string[];
};

type RagHit = { text: string; score?: number; metadata?: Record<string, unknown> };
type RagResponse = { results?: RagHit[]; error?: string };

async function ragQuery(payload: {
  collection: string;
  q: string;
  k?: number;
  score_threshold?: number;
}): Promise<RagHit[]> {
  const res = await fetch("/api/ingest/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as RagResponse;
  if (!res.ok) {
    throw new Error(data?.error || res.statusText || "RAG query failed");
  }
  return data.results || [];
}

export default function PlanPreview({
  plan,
  docmap,
  ingest,
  collection,
  k = 5,
  scoreThreshold = 0.0,
}: {
  plan?: OutlinePlan | null;
  docmap?: DocMapLike | null;
  ingest?: IngestResult | null;
  collection?: string;
  k?: number;
  scoreThreshold?: number;
}) {
  const chapters = plan?.chapters || [];
  const labs = plan?.labs || [];

  // Controls: allow tweaks without prop mutation
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [localK, setLocalK] = useState<number>(k);
  const [localThreshold, setLocalThreshold] = useState<number>(scoreThreshold);
  const [localCollection, setLocalCollection] = useState<string>(
    collection ?? ingest?.collection ?? "workshop_docs"
  );

  const [hits, setHits] = useState<RagHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = useMemo(() => {
    const out: Array<{ key: string; label: string; q: string }> = [];
    chapters.forEach((c, i) =>
      out.push({
        key: `ch-${i}`,
        label: `Chapter ${i + 1}: ${c.title}`,
        q: buildQuery(c),
      })
    );
    labs.forEach((l, i) =>
      out.push({
        key: `lb-${i}`,
        label: `Lab ${i + 1}: ${l.title}`,
        q: buildQuery(l),
      })
    );
    return out;
  }, [chapters, labs]);

  // Query when selection or controls change
  useEffect(() => {
    if (!activeKey) return;
    const item = items.find((x) => x.key === activeKey);
    if (!item) return;

    (async () => {
      setLoading(true);
      setErr(null);
      setHits(null);
      try {
        const rs = await ragQuery({
          collection: localCollection,
          q: item.q,
          k: localK,
          score_threshold: localThreshold,
        });
        setHits(rs);
      } catch (e: any) {
        setErr(e?.message || "Query failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [activeKey, items, localCollection, localK, localThreshold]);

  return (
    <div className="card card-hover">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-medium">Plan Preview</h3>
          {docmap?.files?.length ? (
            <span className="badge" title={docmap.repo ? `Repo: ${docmap.repo}` : "DocMap loaded"}>
              {docmap.files.length} files
            </span>
          ) : (
            <span className="badge bg-gray-100 text-gray-600">No DocMap</span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <input
            className="input !w-44"
            placeholder="Collection"
            value={localCollection}
            onChange={(e) => setLocalCollection(e.target.value)}
            title="RAG collection"
          />
          <input
            className="input !w-20"
            type="number"
            min={1}
            max={50}
            value={localK}
            onChange={(e) =>
              setLocalK(Math.max(1, Math.min(50, parseInt(e.target.value || "1", 10))))
            }
            title="Top-K"
          />
          <input
            className="input !w-28"
            type="number"
            step={0.01}
            min={0}
            max={1}
            value={localThreshold}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLocalThreshold(Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
            }}
            title="Score threshold (0..1)"
          />
        </div>
      </div>

      {/* Body */}
      {items.length === 0 ? (
        <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-700">
          Provide an outline to preview chapters/labs. Tip: after you design your workshop or book,
          the sections will appear here—click any to preview relevant snippets from your collection.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Outline */}
          <div className="rounded-lg border p-2">
            <ul className="space-y-1" aria-label="Outline sections">
              <li className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Chapters
              </li>
              {chapters.map((c, i) => {
                const key = `ch-${i}`;
                const active = key === activeKey;
                return (
                  <li key={key}>
                    <button
                      className={`w-full rounded-md px-2 py-1 text-left text-sm transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                        active ? "bg-gray-100 font-medium" : ""
                      }`}
                      onClick={() => setActiveKey(key)}
                      aria-current={active ? "true" : undefined}
                    >
                      {i + 1}. {c.title}
                    </button>
                  </li>
                );
              })}
              <li className="mt-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Labs
              </li>
              {labs.map((l, i) => {
                const key = `lb-${i}`;
                const active = key === activeKey;
                return (
                  <li key={key}>
                    <button
                      className={`w-full rounded-md px-2 py-1 text-left text-sm transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                        active ? "bg-gray-100 font-medium" : ""
                      }`}
                      onClick={() => setActiveKey(key)}
                      aria-current={active ? "true" : undefined}
                    >
                      {i + 1}. {l.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* RAG Hits */}
          <div className="rounded-lg border p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">RAG Hits</div>
              {!activeKey && <span className="text-xs text-gray-500">Select a section</span>}
            </div>

            {/* Status */}
            <div className="space-y-2">
              {loading && (
                <div className="animate-pulse rounded-md bg-gray-100 p-3 text-sm text-gray-500">
                  Querying <b>{localCollection}</b>…
                </div>
              )}

              {err && (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {err}
                </div>
              )}

              {!loading && !err && hits?.length === 0 && activeKey && (
                <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-800">
                  No relevant hits. Consider re-ingesting or lowering the threshold.
                </div>
              )}

              {!loading &&
                !err &&
                (hits || []).map((h, i) => {
                  // Safe extraction & guard for metadata.source (unknown -> string)
                  const metaSourceUnknown =
                    (h.metadata as Record<string, unknown> | undefined)?.["source"];
                  const hasSource =
                    typeof metaSourceUnknown === "string" || typeof metaSourceUnknown === "number";
                  const metaSource = hasSource ? String(metaSourceUnknown) : undefined;

                  return (
                    <div key={i} className="rounded-md border p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                        <span>Hit {i + 1}</span>
                        <span>{h.score != null ? `score ${h.score.toFixed(3)}` : ""}</span>
                      </div>
                      <pre className="max-h-48 whitespace-pre-wrap break-words text-xs text-gray-800">
                        {String(h.text || "").trim()}
                      </pre>
                      {metaSource && (
                        <div className="mt-1 truncate text-[11px] text-gray-500">
                          source: {metaSource}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildQuery(s: { title: string; sources?: string[] }) {
  const src = (s.sources || []).slice(0, 4).join(", ");
  return `Section: ${s.title}\nUse repo knowledge to surface 3–5 concise, relevant snippets.\nSources (hints): ${src}`;
}
