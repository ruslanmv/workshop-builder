import { useCallback, useMemo, useState } from "react";

/**
 * ExportPanel
 * - Accepts a BookPlan (prop or pasted JSON)
 * - Lets user pick output formats: epub, pdf, springer (LaTeX)
 * - Calls /api/exports with { plan, formats, out_dir? }
 * - Displays returned artifact URLs/paths
 */

type Artifact = {
  format: "epub" | "pdf" | "springer";
  path?: string;
  url?: string;
  link?: string;
  download_url?: string;
  size_bytes?: number;
  name?: string;
};

type ExportResponse = {
  artifacts: Artifact[];
  out_dir?: string;
  warnings?: string[];
  logs?: string;
};

type Props = {
  plan?: unknown | null;
};

async function postExport(payload: any): Promise<ExportResponse> {
  const res = await fetch("/api/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.error) || res.statusText || "Export failed");
  }
  return data as ExportResponse;
}

function artifactHref(a: Artifact): string | null {
  return a.url || a.download_url || a.link || (a.path?.startsWith("/") ? a.path : null);
}

export default function ExportPanel({ plan: planProp }: Props) {
  const [paste, setPaste] = useState<string>("");
  const [formats, setFormats] = useState<{ epub: boolean; pdf: boolean; springer: boolean }>({
    epub: true,
    pdf: true,
    springer: false
  });
  const [outDir, setOutDir] = useState<string>("exports");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResponse | null>(null);

  const activePlan = useMemo(() => {
    if (planProp) return planProp;
    if (!paste.trim()) return null;
    try {
      return JSON.parse(paste);
    } catch {
      return null;
    }
  }, [paste, planProp]);

  const toggle = (k: keyof typeof formats) =>
    setFormats((f) => ({ ...f, [k]: !f[k] }));

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const chosen = (["epub", "pdf", "springer"] as const).filter((f) => formats[f]);
      if (chosen.length === 0) throw new Error("Select at least one format.");
      if (!activePlan) throw new Error("Provide a valid BookPlan (paste JSON or pass as prop).");

      const payload = {
        plan: activePlan,
        formats: chosen,
        out_dir: outDir || undefined
      };
      const res = await postExport(payload);
      setResult(res);
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setBusy(false);
    }
  }, [activePlan, formats, outDir]);

  return (
    <div className="card">
      <h2 className="mb-3 text-lg font-medium">Export Book</h2>

      {!planProp && (
        <div className="mb-3">
          <label className="label">BookPlan JSON (paste if not provided by parent)</label>
          <textarea
            className="input h-40"
            placeholder='{"title":"…","sections":[…]}'
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            The backend validates and renders the BookPlan into the selected formats.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">Formats</label>
          <div className="rounded-lg border p-3">
            <label className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={formats.epub}
                onChange={() => toggle("epub")}
              />
              <span>EPUB (Kindle-friendly)</span>
            </label>
            <label className="mb-2 flex items-center gap-2">
              <input type="checkbox" checked={formats.pdf} onChange={() => toggle("pdf")} />
              <span>PDF (XeLaTeX)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formats.springer}
                onChange={() => toggle("springer")}
              />
              <span>Springer LaTeX (ZIP/PDF)</span>
            </label>
          </div>
        </div>

        <div>
          <label className="label">Output directory (server-side)</label>
          <input
            className="input"
            value={outDir}
            onChange={(e) => setOutDir(e.target.value)}
            placeholder="exports"
          />
          <p className="mt-1 text-xs text-gray-500">Created under your project/export root.</p>
        </div>

        <div className="flex items-end">
          <button className="btn w-full" onClick={run} disabled={busy}>
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      {result && (
        <div className="mt-4">
          {result.warnings && result.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              <b>Warnings:</b>
              <ul className="ml-5 list-disc">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="mb-2 text-sm font-semibold text-gray-700">Artifacts</h3>
          {result.artifacts?.length ? (
            <ul className="space-y-2">
              {result.artifacts.map((a, i) => {
                const href = artifactHref(a);
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {a.name || a.format.toUpperCase()}
                      </div>
                      <div className="truncate text-xs text-gray-600">
                        {a.url || a.download_url || a.link || a.path || "(no path returned)"}
                      </div>
                    </div>
                    {href ? (
                      <a
                        className="btn-secondary ml-3 shrink-0"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="badge">No URL</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">No artifacts returned.</p>
          )}

          {result.logs && (
            <>
              <h4 className="mt-4 text-sm font-semibold text-gray-700">Build logs</h4>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-gray-50 p-3 text-xs">
                {result.logs}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
