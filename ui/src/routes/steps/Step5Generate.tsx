// workshop_builder/ui/src/routes/steps/Step5Generate.tsx
import React, { useCallback, useMemo, useState } from "react";
import { useStore, OutputFormat } from "../../store";
import AgentPipeline from "../../components/AgentPipeline";
import GenerationProgress from "../../components/GenerationProgress";
import ExportGallery, { Artifact } from "../../components/ExportGallery";

/**
 * Step 5 — Generate
 * - Unified black gradient hero + card layout (matches Steps 2–4)
 * - Pipeline animation, progress, logs
 * - Artifacts derived from selected outputs (intent.outputs)
 * - Constraint tags parsed for summary (template/package/mode/latex)
 *
 * Replace simulateRun() with SSE to your backend when ready.
 */

type ConstraintTags = {
  template?: { type?: string; id?: string };
  package?: "pdf" | "zip";
  mode?: "book" | "ebook";
  includeLatex?: boolean;
};

type SimStep = { label: string; ms: number; logs: string[] };

const BASE_STEPS: SimStep[] = [
  { label: "Intake sources", ms: 1000, logs: ["Cloning repo…", "Found 78 files"] },
  { label: "Index documents", ms: 1400, logs: ["Chunking…", "Vectorizing 5,921 chunks"] },
  { label: "Plan outline", ms: 1200, logs: ["Agents: planner / critic", "Outline v2 approved"] },
  { label: "Write content", ms: 2000, logs: ["Drafting Ch.1–3…", "Generating labs"] },
  { label: "Edit & QA", ms: 1400, logs: ["Style pass…", "Citations resolved"] },
  { label: "Layout targets", ms: 1000, logs: ["Templates applied…", "Page makeup"] },
  { label: "Export", ms: 900, logs: ["Rendering…", "Packaging artifacts"] },
];

export default function Step5Generate() {
  const project = useStore((s) => (s.currentId ? s.projects[s.currentId] : undefined));
  const title = project?.intent?.title || project?.name || project?.id || "Untitled";

  // Intent data
  const outputs = (project?.intent?.outputs || []) as OutputFormat[];
  const tags = useMemo<ConstraintTags>(() => parseConstraintTags(project?.intent?.constraints), [project?.intent?.constraints]);

  // Derive artifacts from outputs + editorial preset
  const initialArtifacts = useMemo<Artifact[]>(
    () => outputsToArtifacts(outputs, project?.intent?.editorialPreset),
    [outputs, project?.intent?.editorialPreset]
  );

  // UI State
  const [running, setRunning] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState<string>("Idle");
  const [logs, setLogs] = useState<{ ts: number; level: "info" | "warn" | "error"; msg: string }[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);

  // Keep artifacts in sync if user navigated back, changed outputs, and returned
  React.useEffect(() => {
    setArtifacts(initialArtifacts);
  }, [initialArtifacts]);

  const pushLog = useCallback((msg: string, level: "info" | "warn" | "error" = "info") => {
    setLogs((ls) => [...ls, { ts: Date.now(), level, msg }]);
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setActiveIndex(0);
    setProgress(0);
    setCurrentLabel("Idle");
    setLogs([]);
    setArtifacts(initialArtifacts.map((a) => ({ ...a, status: "pending" as const, href: undefined, bytes: undefined })));
  }, [initialArtifacts]);

  // Simulated run (swap with SSE streaming later)
  const simulateRun = useCallback(async () => {
    reset();
    setRunning(true);
    let pct = 0;

    // Optionally, tweak steps based on outputs (tiny UX detail)
    const steps = BASE_STEPS.map((s) => ({ ...s }));
    if (outputs.includes("mkdocs")) {
      steps[steps.length - 1].logs = [...steps[steps.length - 1].logs, "MkDocs site packaged"];
    }
    if (outputs.includes("epub")) {
      steps[steps.length - 2].logs = [...steps[steps.length - 2].logs, "EPUB spine built"];
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      setActiveIndex(i);
      setCurrentLabel(step.label);
      pushLog(`→ ${step.label}`);
      const interval = 90;
      const ticks = Math.max(1, Math.floor(step.ms / interval));
      for (let k = 0; k < ticks; k++) {
        await sleep(interval);
        pct = Math.min(100, Math.round(((i + (k + 1) / ticks) / steps.length) * 100));
        setProgress(pct);
        if (k === 0) step.logs.forEach((m) => pushLog(m));
      }
    }

    // Mark only selected artifacts ready (mock URLs) — strongly typed to Artifact[]
    const base = slugify(title || "project");
    const ready: Artifact[] = artifacts.map((a): Artifact => {
      if (a.id === "springer") return { ...a, status: "ready", href: `#${base}-springer.pdf`, bytes: 12_340_000 };
      if (a.id === "oxford")   return { ...a, status: "ready", href: `#${base}-oxford.pdf`, bytes: 12_100_000 };
      if (a.id === "acm")      return { ...a, status: "ready", href: `#${base}-acm.pdf`, bytes: 11_800_000 };
      if (a.id === "ieee")     return { ...a, status: "ready", href: `#${base}-ieee.pdf`, bytes: 11_900_000 };
      if (a.id === "epub")     return { ...a, status: "ready", href: `#${base}.epub`, bytes: 7_180_000 };
      if (a.id === "pdf")      return { ...a, status: "ready", href: `#${base}-print.pdf`, bytes: 15_510_000 };
      if (a.id === "mkdocs")   return { ...a, status: "ready", href: `#${base}-site.zip`, bytes: 2_240_000 };
      return { ...a }; // unchanged but still typed as Artifact
    });
    setArtifacts(ready);

    setCurrentLabel("Complete");
    pushLog("✔ Generation complete");
    setRunning(false);
  }, [artifacts, outputs, pushLog, reset, title]);

  const cancel = useCallback(() => {
    pushLog("Cancelled by user", "warn");
    setRunning(false);
  }, [pushLog]);

  // Pretty summary for the header card
  const summaryLines = useMemo(() => {
    const out = (project?.intent?.outputs || []).map((o) => o.toUpperCase()).join(", ") || "—";
    const pack = tags.package ? tags.package.toUpperCase() : "—";
    const tmpl = tags.template?.id ? `${tags.template.type ?? ""}/${tags.template.id}` : "—";
    const mode = tags.mode ? tags.mode.toUpperCase() : "—";
    const latex =
      project?.intent?.projectType === "book" || project?.intent?.projectType === "journal"
        ? tags.includeLatex ? "Yes" : "No"
        : "—";
    return { out, pack, tmpl, mode, latex };
  }, [project?.intent?.outputs, project?.intent?.projectType, tags]);

  return (
    <section className="space-y-6">
      {/* Black gradient hero — same family look as Steps 2–4 */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Stage 5</div>
          <h2 className="mt-1 text-2xl font-semibold">Generate</h2>
          <p className="mt-2 text-sm text-gray-300">
            We’ll orchestrate the multi-agent pipeline, stream progress and logs, and package your final artifacts.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl space-y-4">
        {/* Project summary card */}
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Project</div>
              <h3 className="text-base font-semibold">{title}</h3>
            </div>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-700">
              Mode:&nbsp;<b className="ml-1 text-gray-900">{(tags.mode || project?.intent?.projectType || "—").toString().toUpperCase()}</b>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 p-4 text-sm md:grid-cols-2">
            <Row label="Outputs" value={summaryLines.out} />
            <Row label="Packaging" value={summaryLines.pack} />
            <Row label="Template" value={summaryLines.tmpl} />
            <Row label="LaTeX (sources)" value={summaryLines.latex} />
          </div>
        </div>

        {/* Pipeline animation */}
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold">Pipeline</h3>
            <span className="text-[11px] text-gray-500">{running ? "Running…" : "Ready"}</span>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <AgentPipeline activeIndex={activeIndex} playing={running} />
          </div>
        </div>

        {/* Progress + Logs */}
        <div className="card">
          <GenerationProgress
            running={running}
            progress={progress}
            currentLabel={currentLabel}
            logs={logs}
            onStart={simulateRun}
            onCancel={cancel}
          />
        </div>

        {/* Artifacts */}
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold">Artifacts</h3>
            {!running && progress === 0 && (
              <span className="text-[11px] text-gray-500">Start the pipeline to build exports</span>
            )}
          </div>
          <ExportGallery items={artifacts} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Utilities ------------------------------- */

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  const v = value ?? "—";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-[130px] shrink-0 text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="flex-1 text-gray-800">{String(v)}</div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

/** Map selected outputs to initial artifacts (labels adapt to editorial preset) */
function outputsToArtifacts(outputs: OutputFormat[], editorial?: "springer" | "oxford" | "acm" | "ieee"): Artifact[] {
  const list: Artifact[] = [];

  // If user chose the "springer" output, label by editorial if available
  if (outputs.includes("springer")) {
    const ed = (editorial || "springer").toUpperCase();
    const id = (editorial || "springer") as "springer" | "oxford" | "acm" | "ieee";
    list.push({ id, label: `${ed} PDF`, status: "pending" });
  }

  if (outputs.includes("epub")) {
    list.push({ id: "epub", label: "EPUB", status: "pending" });
  }

  if (outputs.includes("pdf")) {
    list.push({ id: "pdf", label: "Print PDF", status: "pending" });
  }

  if (outputs.includes("mkdocs")) {
    list.push({ id: "mkdocs", label: "MkDocs Site", status: "pending" });
  }

  // If nothing selected (edge case), show a neutral placeholder
  if (list.length === 0) {
    list.push({ id: "pdf", label: "PDF", status: "pending" });
  }

  return list;
}

/**
 * Parse constraint tags from intent.constraints (multiline string):
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
    .filter((l) => !l.startsWith("#"));

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("template:")) {
      const parts = line.split(":");
      res.template = { type: (parts[1] || "").trim(), id: (parts[2] || "").trim() };
      continue;
    }
    if (lower.startsWith("package:")) {
      const v = lower.split(":")[1]?.trim();
      if (v === "pdf" || v === "zip") res.package = v;
      continue;
    }
    if (lower.startsWith("mode:")) {
      const v = lower.split(":")[1]?.trim();
      if (v === "book" || v === "ebook") res.mode = v;
      continue;
    }
    if (lower.startsWith("includelatex:")) {
      const v = lower.split(":")[1]?.trim();
      res.includeLatex = v === "true" || v === "1" || v === "yes";
      continue;
    }
  }

  return res;
}
