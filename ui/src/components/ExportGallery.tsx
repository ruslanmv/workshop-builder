import React from "react";

/** ------------------------------------------------------------------------
 * ExportGallery
 * Grid of export artifacts with clear state, file size, and actions.
 * - Uses graceful fallbacks when a.href is missing.
 * - Accessible labels and statuses.
 * -------------------------------------------------------------------------*/

export type Artifact = {
  id: string;
  label: string;                        // e.g. "Springer PDF"
  status: "pending" | "ready" | "failed";
  href?: string;                        // if ready
  bytes?: number;                       // optional size
  meta?: Record<string, unknown>;       // optional extra info
};

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function StatusTag({ status }: { status: Artifact["status"] }) {
  const map = {
    ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
  } as const;
  return (
    <span className={`badge border ${map[status]}`} aria-label={`Status: ${status}`}>
      {status === "pending" ? "Pending" : status === "failed" ? "Failed" : "Ready"}
    </span>
  );
}

function FileIcon({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Zm0 2.5V8h3.5L14 4.5Z" />
    </svg>
  );
}

export default function ExportGallery({
  items,
  onOpen,
}: {
  items: Artifact[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="card card-hover">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-medium">Exports</h3>
        <div className="text-xs text-gray-600">
          {items.length} {items.length === 1 ? "artifact" : "artifacts"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {items.map((a) => {
          const size = formatBytes(a.bytes);
          return (
            <div key={a.id} className="rounded-xl border p-4 transition hover:shadow-md bg-white">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
                    <FileIcon className="h-6 w-6 text-gray-700" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{a.label}</div>
                    <div className="text-xs text-gray-500">{size || "—"}</div>
                  </div>
                </div>
                <StatusTag status={a.status} />
              </div>

              <div className="flex gap-2">
                {a.status === "ready" && a.href ? (
                  <>
                    <a
                      className="btn"
                      href={a.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View ${a.label}`}
                    >
                      View
                    </a>
                    <a
                      className="btn-outline"
                      href={a.href}
                      download
                      aria-label={`Download ${a.label}`}
                    >
                      Download
                    </a>
                  </>
                ) : a.status === "failed" ? (
                  <button
                    className="btn-danger"
                    onClick={() => onOpen?.(a.id)}
                    aria-label={`Retry ${a.label}`}
                  >
                    Retry
                  </button>
                ) : (
                  <button className="btn-ghost" disabled aria-label={`${a.label} building`}>
                    Building…
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="mt-3 rounded-lg border bg-gray-50 p-4 text-sm text-gray-600">
          No exports yet. Start a generation to produce Springer/EPUB/PDF/MkDocs artifacts.
        </div>
      )}
    </div>
  );
}
