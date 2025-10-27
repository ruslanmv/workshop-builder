import { useCallback, useMemo, useState } from "react";

/**
 * BookDesigner
 * - Collects title/authors/seed + collection (RAG)
 * - Calls /api/books/plan to generate a structured BookPlan (LLM + heuristics)
 * - Optional preview rendering via /api/books/preview?format=markdown|latex&plan=...
 */

type PlanJson = Record<string, any>;
type PlanResponse = {
  plan: PlanJson; // strongly typed JSON object (no 'unknown')
  meta?: Record<string, any>;
};

type PreviewFormat = "markdown" | "latex";

async function postPlan(payload: any): Promise<PlanResponse> {
  const res = await fetch("/api/books/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as any;

  if (!res.ok) {
    throw new Error((data && data.error) || res.statusText || "Plan failed");
  }

  // Normalize: if backend returns { plan, meta }, use that; otherwise treat entire json as plan.
  const plan: PlanJson = (data && data.plan) ? (data.plan as PlanJson) : (data as PlanJson);
  const meta: Record<string, any> | undefined = data?.meta;

  return { plan, meta };
}

async function getPreview(plan: PlanJson, format: PreviewFormat): Promise<string> {
  const url = `/api/books/preview?format=${encodeURIComponent(
    format
  )}&plan=${encodeURIComponent(JSON.stringify(plan || {}))}`;
  const res = await fetch(url, { headers: { Accept: "text/plain" } });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || "Preview failed");
  return txt;
}

export default function BookDesigner() {
  const [title, setTitle] = useState("Foundations of Practical GenAI");
  const [subtitle, setSubtitle] = useState("From Agentic RAG to Production Exports");
  const [authors, setAuthors] = useState("Jane Doe, John Smith");
  const [collection, setCollection] = useState("workshop_docs");
  const [seed, setSeed] = useState(
    "Create a professional textbook with theory and labs for engineers; include figures/refs placeholders."
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanJson | null>(null); // <-- not unknown
  const [previewFmt, setPreviewFmt] = useState<PreviewFormat>("markdown");
  const [preview, setPreview] = useState<string>("");

  const authorList = useMemo(
    () =>
      authors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [authors]
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPlan(null);
    setPreview("");
    try {
      const payload = {
        title,
        subtitle,
        authors: authorList,
        collection,
        seed,
      };
      const res = await postPlan(payload);
      setPlan(res.plan); // already PlanJson
    } catch (e: any) {
      setError(e.message || "Failed to generate plan");
    } finally {
      setBusy(false);
    }
  }, [authorList, collection, seed, subtitle, title]);

  const runPreview = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    setPreview("");
    try {
      const txt = await getPreview(plan, previewFmt);
      setPreview(txt);
    } catch (e: any) {
      setError(e.message || "Preview failed");
    } finally {
      setBusy(false);
    }
  }, [plan, previewFmt]);

  return (
    <div className="card">
      <h2 className="mb-3 text-lg font-medium">Book Designer</h2>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Subtitle</label>
          <input
            className="input"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">Authors (comma-separated)</label>
          <input
            className="input"
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
            placeholder="First Last, Second Author"
          />
        </div>
        <div>
          <label className="label">RAG Collection</label>
          <input
            className="input"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            placeholder="workshop_docs"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Seed / Scope (used by agents &amp; heuristics)</label>
        <textarea
          className="input h-28"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
        />
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      <div className="mt-4 flex gap-2">
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? "Planning…" : "Generate Plan"}
        </button>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={previewFmt}
            onChange={(e) => setPreviewFmt(e.target.value as PreviewFormat)}
          >
            <option value="markdown">Preview: Markdown</option>
            <option value="latex">Preview: LaTeX</option>
          </select>
          <button className="btn-secondary" onClick={runPreview} disabled={busy || !plan}>
            Preview Sample
          </button>
        </div>
      </div>

      {!!plan && ( /* <-- ensure boolean guard to satisfy ReactNode typing */
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Plan (JSON)</h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-gray-50 p-3 text-xs">
              {JSON.stringify(plan, null, 2)}
            </pre>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              Preview ({previewFmt})
            </h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-gray-50 p-3 text-xs">
              {preview || "No preview yet."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
