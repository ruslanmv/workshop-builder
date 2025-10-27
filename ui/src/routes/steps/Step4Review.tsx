// workshop_builder/ui/src/routes/steps/Step4Review.tsx
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../store";

type ConstraintTags = {
  template?: { type?: string; id?: string };
  package?: "pdf" | "zip";
  mode?: "book" | "ebook";
  includeLatex?: boolean;
};

export default function Step4Review() {
  const nav = useNavigate();
  const project = useStore((s) => (s.currentId ? s.projects[s.currentId] : undefined));
  const intent = project?.intent;
  const projectType = intent?.projectType;

  // Workshop agenda (if any)
  const schedule = (project?.outline as any)?.scheduleJson;

  // Generic plan (all types)
  const plan = project?.outline?.plan as any;

  const summary = useMemo(() => {
    // Workshop: compute timing summary
    let agenda = { blocks: [] as any[], total: 0, dayBudget: 0 };
    try {
      const src = typeof schedule === "string" ? JSON.parse(schedule) : schedule || {};
      const blocks = Array.isArray(src.blocks) ? src.blocks : [];
      const total = blocks.reduce(
        (a: number, b: any) => a + (Number.isFinite(b?.minutes) ? b.minutes : 0),
        0
      );
      agenda = { blocks, total, dayBudget: Number(src.dayBudgetMinutes) || 360 };
    } catch {
      // noop
    }

    // Cross-type plan overview
    const p = plan && typeof plan === "object" ? plan : {};
    const counts: Record<string, number> = {};
    if (Array.isArray((p as any)?.toc)) counts.toc = (p as any).toc.length; // book-style
    if (Array.isArray((p as any)?.sections)) counts.sections = (p as any).sections.length; // journal/proceedings
    if (Array.isArray((p as any)?.pages)) counts.pages = (p as any).pages.length; // mkdocs/docsite/blog
    if (Array.isArray((p as any)?.blocks)) counts.blocks = (p as any).blocks.length; // workshop/blog chunking
    if (Array.isArray(p)) counts.items = (p as any).length;

    return { agenda, counts };
  }, [schedule, plan]);

  const tags = useMemo<ConstraintTags>(
    () => parseConstraintTags(intent?.constraints),
    [intent?.constraints]
  );

  const outputsList = (intent?.outputs || []).map((o) => o.toUpperCase()).join(", ") || "—";

  const modeBadge = (tags.mode || (projectType ? String(projectType) : "—"))?.toUpperCase();

  return (
    <section className="space-y-6">
      {/* Black gradient hero — unified with Stage 2/3 */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Stage 4</div>
          <h2 className="mt-1 text-2xl font-semibold">Review</h2>
          <p className="mt-2 text-sm text-gray-300">
            Confirm the details below. You can go back to adjust anything. When everything looks good,
            continue to <b>Generate</b>.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Intent & Outputs */}
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <h3 className="text-base font-semibold">Intent</h3>
              <p className="text-xs text-gray-500">High-level objectives and destination</p>
            </div>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-700">
              Mode:&nbsp;<b className="ml-1 text-gray-900">{modeBadge}</b>
            </span>
          </div>

          <div className="space-y-2 p-4 text-sm">
            <Row label="Title" value={intent?.title} />
            <Row label="Subtitle" value={intent?.subtitle} />
            <Row label="Authors" value={(intent?.authors || []).join(", ")} />
            <Row label="Audience" value={intent?.audience} />
            <Row label="Tone" value={intent?.tone} />
            <Row label="Constraints" value={intent?.constraints} />
            <Row label="Due" value={intent?.due} />
          </div>

          <div className="border-t p-4">
            <h4 className="mb-2 text-sm font-semibold">What we’ll generate</h4>
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <Row label="Outputs" value={outputsList} />
              <Row
                label="Packaging"
                value={
                  tags.package
                    ? tags.package.toUpperCase()
                    : (projectType === "book" || projectType === "journal") ? "ZIP (default)" : "PDF"
                }
              />
              <Row
                label="Template"
                value={
                  tags.template?.id
                    ? `${(tags.template.type || projectType || "").toString()}/${tags.template.id}`
                    : "—"
                }
              />
              {(projectType === "book" || projectType === "journal") && (
                <Row label="Include LaTeX" value={tags.includeLatex ? "Yes" : "No"} />
              )}
            </div>
          </div>
        </div>

        {/* Outline / Agenda Preview */}
        <div className="space-y-3">
          {/* Cross-type plan summary */}
          <div className="card lg:sticky lg:top-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Plan Overview</h3>
              <span className="text-[11px] text-gray-500">Ready</span>
            </div>

            {hasAnyCount(summary.counts) ? (
              <ul className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(summary.counts).map(([k, v]) => (
                  <li key={k} className="rounded-md border bg-white px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500">{k}</div>
                    <div className="text-sm font-semibold text-gray-900">{v}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-600">
                No structured plan metrics detected. You can still proceed, or go back to adjust the outline.
              </div>
            )}

            <div className="mt-3 text-right">
              <button
                className="btn-secondary"
                onClick={() => exportJson("plan.json", plan ?? {})}
              >
                Export Plan JSON
              </button>
            </div>
          </div>

          {/* Workshop agenda (only when present) */}
          {Array.isArray(summary.agenda.blocks) && summary.agenda.blocks.length > 0 && (
            <div className="card lg:sticky lg:top-[420px]">
              <h3 className="mb-2 text-base font-semibold">Agenda (Workshop)</h3>
              <div className="mb-2 text-xs text-gray-600">
                Day budget: <b>{fmt(summary.agenda.total)}</b> / {fmt(summary.agenda.dayBudget)}
              </div>
              <ul className="space-y-2 text-sm">
                {summary.agenda.blocks.map((b: any, i: number) => (
                  <li key={b.id || i} className="rounded-md border p-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{b.title || b.kind}</div>
                        <div className="text-xs text-gray-500">
                          {String(b.kind || "").toUpperCase()}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600">
                        {fmt(Number(b.minutes) || 0)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-3 text-right">
                <button
                  className="btn-secondary"
                  onClick={() => exportJson("agenda.json", schedule ?? {})}
                >
                  Export Agenda JSON
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Wizard Nav */}
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <button className="btn-secondary" onClick={() => nav("/wizard/outline")}>
          ← Back
        </button>
        <button className="btn" onClick={() => nav("/wizard/generate")}>
          Generate →
        </button>
      </div>
    </section>
  );
}

/* ------------------------------- Utilities ------------------------------- */

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  const v = value ?? "—";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-[110px] shrink-0 text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="flex-1 text-gray-800">{String(v)}</div>
    </div>
  );
}

function hasAnyCount(obj: Record<string, number>) {
  return Object.values(obj).some((n) => Number.isFinite(n) && n > 0);
}

function exportJson(filename: string, data: unknown) {
  try {
    const pretty = JSON.stringify(
      typeof data === "string" ? safeParse(data) : data ?? {},
      null,
      2
    );
    const blob = new Blob([pretty], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // swallow — export is a convenience
  }
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/**
 * Parses constraint tags from the `intent.constraints` multi-line string.
 * Expected lines (case-insensitive):
 *  - template:<type>:<id>
 *  - package:pdf|zip
 *  - mode:book|ebook
 *  - includeLatex:true|false
 */
function parseConstraintTags(input?: string): ConstraintTags {
  const res: ConstraintTags = {};
  if (!input || typeof input !== "string") return res;

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#")); // ignore comments

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("template:")) {
      // template:<type>:<id>
      const parts = line.split(":");
      // Guard against unexpected shapes
      const type = (parts[1] || "").trim();
      const id = (parts[2] || "").trim();
      res.template = { type, id };
      continue;
    }

    if (lower.startsWith("package:")) {
      const val = lower.split(":")[1]?.trim();
      if (val === "pdf" || val === "zip") res.package = val;
      continue;
    }

    if (lower.startsWith("mode:")) {
      const val = lower.split(":")[1]?.trim();
      if (val === "book" || val === "ebook") res.mode = val;
      continue;
    }

    if (lower.startsWith("includelatex:")) {
      const raw = lower.split(":")[1]?.trim();
      res.includeLatex = raw === "true" || raw === "1" || raw === "yes";
      continue;
    }
  }

  return res;
}
