// workshop_builder/ui/src/routes/steps/Step3Outline.tsx
import React, { Suspense, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../store";
import PlanPreview from "../../components/PlanPreview";
import { pickEditor } from "../../components/editors/registry";

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 h-5 w-40 rounded bg-gray-200" />
      <div className="mb-2 h-4 w-full rounded bg-gray-200" />
      <div className="h-4 w-5/6 rounded bg-gray-200" />
    </div>
  );
}

export default function Step3Outline() {
  const nav = useNavigate();

  // Project & context
  const currentId = useStore((s) => s.currentId);
  const project = useStore((s) => (s.currentId ? s.projects[s.currentId] : undefined));
  const upsert = useStore((s) => s.upsert);

  const docmap = project?.intake?.docmap as any;
  const plan = project?.outline?.plan as any; // AI draft, optional

  // Dynamically pick the right editor for the user's Intent → Project Type
  const EditorComponent = useMemo(() => {
    if (!project) return null;
    return pickEditor(project).Component;
  }, [project]);

  const mode = project?.intent?.projectType;
  const modeLabel = (mode ? String(mode) : "unknown").toUpperCase();

  return (
    <section className="space-y-6">
      {/* Full-bleed black hero (uniform with Stage 1/2) */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Stage 3</div>
          <h2 className="mt-1 text-2xl font-semibold">Outline</h2>
          <p className="mt-2 text-sm text-gray-300">
            Your editor adapts to the selected destination (Workshop, MkDocs, Book, Journal, Proceedings, Blog).
            Make changes and the preview will update with relevant knowledge snippets.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ADAPTIVE EDITOR (scrollable for long sessions) */}
        <div className="space-y-3">
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div>
                <h3 className="text-base font-semibold">Adaptive Editor</h3>
                <p className="text-xs text-gray-500">
                  Edit your structure; we’ll normalize it for generation.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-700">
                Mode:&nbsp;<b className="ml-1 text-gray-900">{modeLabel}</b>
              </span>
            </div>

            <div className="p-4">
              <Suspense
                fallback={
                  <>
                    <SkeletonCard />
                    <SkeletonCard />
                  </>
                }
              >
                {EditorComponent ? (
                  <div className="h-[70vh] overflow-auto rounded-lg">
                    <EditorComponent
                      project={project!}
                      onPlanChange={(normalizedJson: unknown) => {
                        // Persist normalized output to a generic 'plan' (exists in OutlineData)
                        // and to a type-specific field ONLY where defined in store (scheduleJson for workshop).
                        const type = project?.intent?.projectType;
                        upsert({
                          id: currentId!,
                          outline: {
                            ...(project?.outline || {}),
                            plan: normalizedJson,
                            ...(type === "workshop" ? { scheduleJson: normalizedJson } : {}),
                          },
                        });
                      }}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border bg-white p-4 shadow-sm">
                    <div className="text-sm text-gray-600">
                      No editor available. Go back to <b>Outcomes</b> and pick a project type.
                    </div>
                  </div>
                )}
              </Suspense>
            </div>
          </div>
        </div>

        {/* PREVIEW + RAG ASSIST (sticky for quick reference) */}
        <div className="space-y-3">
          <div className="card lg:sticky lg:top-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Plan Preview</h3>
              <span className="text-[11px] text-gray-500">Live</span>
            </div>
            <p className="mb-2 text-xs text-gray-500">
              As you change the outline, we’ll surface relevant snippets from your knowledge base.
            </p>
            <PlanPreview
              plan={plan || {}}
              docmap={docmap as any}
              collection={(project?.intake as any)?.collection || "workshop_docs"}
              k={6}
              scoreThreshold={0.0}
            />
          </div>

          {/* Helpful Tips (optional lightweight guidance) */}
          <div className="card lg:sticky lg:top-[420px]">
            <h4 className="mb-2 text-sm font-semibold">Tips</h4>
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
              <li>Keep sections consistent in depth; avoid overly deep nesting.</li>
              <li>For workshops, balance theory and labs; budget time realistically.</li>
              <li>Books & journals benefit from clear metadata (title, keywords).</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Wizard Nav */}
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <button className="btn-secondary" onClick={() => nav("/wizard/intent")}>
          ← Back
        </button>
        <div className="flex gap-2">
          <button className="btn" onClick={() => nav("/wizard/review")}>
            Continue to Review →
          </button>
        </div>
      </div>
    </section>
  );
}
