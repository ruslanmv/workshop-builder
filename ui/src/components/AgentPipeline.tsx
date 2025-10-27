import React from "react";

/** ------------------------------------------------------------------------
 * AgentPipeline
 * Visual, clickable multi-agent pipeline with step states and subtle motion.
 * - No external icon libs; inline SVGs for portability.
 * - Keyboard accessible: Tab to a step, Enter/Space to activate.
 * - ARIA: role="list" and role="listitem" + aria-current for active step.
 * -------------------------------------------------------------------------*/

export type AgentStep = {
  id: string;
  label: string;
  description?: string;
};

export const DEFAULT_STEPS: AgentStep[] = [
  { id: "intake",  label: "Intake",  description: "Fetch & stage sources" },
  { id: "index",   label: "Index",   description: "Chunk & vectorize docs" },
  { id: "plan",    label: "Plan",    description: "Synthesize outline" },
  { id: "write",   label: "Write",   description: "Draft chapters & labs" },
  { id: "edit",    label: "Edit",    description: "Refine, cite, style" },
  { id: "layout",  label: "Layout",  description: "Format for targets" },
  { id: "export",  label: "Export",  description: "Springer/EPUB/PDF/MkDocs" },
];

function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <path d="M7.628 13.707a1 1 0 0 1-1.414 0L3.293 10.786a1 1 0 0 1 1.414-1.414l2.214 2.214 7.372-7.372a1 1 0 1 1 1.414 1.414L7.628 13.707Z" />
    </svg>
  );
}

function PulseHalo() {
  return <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-indigo-400/40" />;
}

export default function AgentPipeline({
  steps = DEFAULT_STEPS,
  activeIndex = 0,
  playing = false,
  onStepClick,
}: {
  steps?: AgentStep[];
  activeIndex?: number;
  playing?: boolean;
  onStepClick?: (i: number, step: AgentStep) => void;
}) {
  return (
    <div className="card card-hover">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-medium">Multi-Agent Pipeline</h3>
        <span
          className={[
            "inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs",
            playing ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-700",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-2 w-2 rounded-full",
              playing ? "bg-emerald-500 animate-pulse" : "bg-gray-400",
            ].join(" ")}
            aria-hidden="true"
          />
          {playing ? "Running…" : "Idle"}
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <div className="flex items-center gap-5 pb-1" role="list" aria-label="Agent steps">
          {steps.map((s, i) => {
            const active = i === activeIndex;
            const done = i < activeIndex;
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  role="listitem"
                  aria-current={active ? "step" : undefined}
                  title={s.description || s.label}
                  className={[
                    "group relative flex min-w-[140px] flex-col items-center gap-1 rounded-xl border px-3 py-2 transition focus:outline-none focus:ring-2 focus:ring-indigo-500",
                    done
                      ? "border-emerald-200 bg-emerald-50"
                      : active
                      ? "border-indigo-200 bg-indigo-50"
                      : "border-gray-200 bg-white hover:bg-gray-50",
                  ].join(" ")}
                  onClick={() => onStepClick?.(i, s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onStepClick?.(i, s);
                    }
                  }}
                >
                  <div className="relative">
                    <span
                      className={[
                        "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold",
                        done
                          ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                          : active
                          ? "border-indigo-500 bg-indigo-100 text-indigo-800"
                          : "border-gray-300 bg-gray-100 text-gray-700",
                      ].join(" ")}
                    >
                      {done ? <CheckIcon /> : i + 1}
                    </span>
                    {active && <PulseHalo />}
                  </div>
                  <div className="text-sm font-medium">{s.label}</div>
                  {s.description && (
                    <div className="text-[11px] text-gray-600">{s.description}</div>
                  )}
                </button>

                {i < steps.length - 1 && (
                  <div
                    aria-hidden="true"
                    className={[
                      "h-1 w-10 rounded-full transition-colors",
                      i < activeIndex ? "bg-emerald-400" : "bg-gray-200",
                    ].join(" ")}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
