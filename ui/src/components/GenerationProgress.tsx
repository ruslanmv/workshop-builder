import React, { useEffect, useMemo, useRef } from "react";

/** ------------------------------------------------------------------------
 * GenerationProgress
 * Clean progress header with animated bar and live logs.
 * - Auto-scroll logs; copy & clear helpers are optional but handy.
 * - No external libs; uses navigator.clipboard when available.
 * -------------------------------------------------------------------------*/

export type LogItem = { ts: number; level: "info" | "warn" | "error"; msg: string };

function LevelPill({ level }: { level: LogItem["level"] }) {
  const cls =
    level === "error"
      ? "bg-rose-50 text-rose-700 border border-rose-200"
      : level === "warn"
      ? "bg-amber-50 text-amber-700 border border-amber-200"
      : "bg-gray-100 text-gray-700";
  return <span className={`badge ${cls}`}>{level.toUpperCase()}</span>;
}

export default function GenerationProgress({
  running,
  progress,
  currentLabel,
  logs,
  onStart,
  onCancel,
  onClearLogs,
}: {
  running: boolean;
  progress: number; // 0..100
  currentLabel?: string;
  logs: LogItem[];
  onStart: () => void;
  onCancel: () => void;
  onClearLogs?: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll logs to bottom when new lines arrive
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  const title = currentLabel || (running ? "Working…" : "Idle");

  const fullText = useMemo(
    () =>
      logs
        .map(
          (l) =>
            `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()}  ${l.msg}`
        )
        .join("\n"),
    [logs]
  );

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(fullText || "(no logs)");
    } catch {
      // no-op
    }
  };

  return (
    <div className="card card-hover">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-medium">Generation</h3>
        <div className="flex items-center gap-2">
          {!running ? (
            <button className="btn" onClick={onStart} aria-label="Start generation">
              Start
            </button>
          ) : (
            <button className="btn-secondary" onClick={onCancel} aria-label="Cancel generation">
              Cancel
            </button>
          )}
          <button className="btn-outline" onClick={copyLogs} aria-label="Copy logs">
            Copy Logs
          </button>
          <button
            className="btn-ghost"
            onClick={() => onClearLogs?.()}
            aria-label="Clear logs"
            disabled={logs.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-xs text-gray-600">
        <span>{title}</span>
        <span>{percent}%</span>
      </div>

      <div className="progress mb-3">
        <div
          className="progress-bar"
          style={{ width: `${percent}%` }}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          role="progressbar"
          aria-label="Generation progress"
        />
      </div>

      <div
        ref={listRef}
        className="max-h-64 overflow-auto rounded-lg border bg-gray-50 p-3 text-xs text-gray-800"
        aria-live="polite"
      >
        {logs.length === 0 ? (
          <div className="text-gray-500">No logs yet. Start a run to see live output.</div>
        ) : (
          logs.map((l, idx) => (
            <div key={idx} className="mb-1 leading-relaxed">
              <span className="mr-2 inline-flex w-[6.5rem] items-center gap-2 text-gray-500">
                <span className="text-gray-500">
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
                <LevelPill level={l.level} />
              </span>
              <span className="whitespace-pre-wrap break-words">{l.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
