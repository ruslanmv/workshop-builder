// workshop_builder/ui/src/routes/steps/Step2Outcome.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, ProjectType, OutputFormat } from "../../store";
import { listTemplates } from "../../templates";
import { IconBook, IconHat, IconNewspaper, IconPdf, IconZip } from "../../components/icons/Icons";

/**
 * Step 2 — Outcomes / Destination
 * - Pulls template metadata from /src/templates (via listTemplates)
 * - Distinguishes Book vs Ebook (separate card & template sets)
 * - Filters outputs by type; adds LaTeX toggle for Book(non-ebook) & Journal
 * - Defaults to ZIP for Book/Journal, PDF elsewhere
 * - Persists machine-readable tags to intent.constraints:
 *     template:<type>:<id>
 *     mode:book|ebook (only for type "book")
 *     package:pdf|zip
 *     includeLatex:true (optional)
 *
 * Editors downstream:
 *   - Book  → ManuscriptEditor
 *   - Ebook → EbookEditor  (we ensure EPUB is selected)
 *   - Workshop → ScheduleEditor
 *   - MkDocs/Journal/Proceedings/Blog → respective editors
 */

// Available outputs per top-level type
const OUTPUTS_BY_TYPE: Record<ProjectType, OutputFormat[]> = {
  workshop: ["mkdocs", "pdf"],
  mkdocs: ["mkdocs", "pdf"],
  book: ["springer", "epub", "pdf"], // trimmed when isEbook = true
  journal: ["pdf"],
  proceedings: ["pdf"],
  blog: ["pdf"],
};

// Utility: editorial preset mapping (kept narrow to store union)
function mapEditorialPreset(
  type: ProjectType,
  templateId: string,
  isEbook: boolean
): "springer" | "oxford" | "acm" | "ieee" | undefined {
  if (type === "journal") {
    if (templateId.startsWith("ieee")) return "ieee";
    if (templateId.startsWith("acm")) return "acm";
    // Others (aps_pr*, apa, nature) don’t map to store union; leave undefined
    return undefined;
  }
  if (type === "book" && !isEbook) {
    if (templateId === "springer") return "springer";
    if (templateId === "oxford") return "oxford";
    if (templateId.startsWith("acm")) return "acm";
    return undefined;
  }
  return undefined;
}

export default function Step2Outcome() {
  const navigate = useNavigate();
  const upsert = useStore((s) => s.upsert);
  const currentId = useStore((s) => s.currentId) || "draft";

  // Project type and "mode" within the Book family (Book vs Ebook)
  const [projectType, setProjectType] = useState<ProjectType>("book");
  const [isEbook, setIsEbook] = useState<boolean>(false);

  // Outputs (filtered by type & ebook mode)
  const [outputs, setOutputs] = useState<OutputFormat[]>(["pdf"]);

  // Packaging — default ZIP for Book/Journal, PDF elsewhere
  const [exportAs, setExportAs] = useState<"pdf" | "zip">("zip");

  // Optional LaTeX sources (for Book non-ebook & Journal)
  const [includeLatex, setIncludeLatex] = useState<boolean>(true);

  /**
   * Template options (driven by the registry)
   * - Book mode: filter "ebook_*" IDs for Ebook view; exclude for Book view
   */
  const templateOptions = useMemo(() => {
    if (projectType === "book") {
      const all = listTemplates("book");
      return isEbook ? all.filter((t) => t.id.startsWith("ebook_")) : all.filter((t) => !t.id.startsWith("ebook_"));
    }
    return listTemplates(projectType);
  }, [projectType, isEbook]);

  // Currently selected template id
  const [templateId, setTemplateId] = useState<string>(() => templateOptions[0]?.id || "");

  // Keep template sane on type/mode changes
  useEffect(() => {
    const first = templateOptions[0]?.id || "";
    if (!templateOptions.find((t) => t.id === templateId)) {
      setTemplateId(first);
    }
  }, [templateOptions, templateId]);

  // Reset packaging & LaTeX defaults when switching type/mode
  useEffect(() => {
    if (projectType === "book") {
      setExportAs("zip"); // for both Book and Ebook, default to ZIP (full deliverables)
      setIncludeLatex(!isEbook); // no LaTeX option for Ebook
    } else if (projectType === "journal") {
      setExportAs("zip");
      setIncludeLatex(true);
    } else {
      setExportAs("pdf");
      setIncludeLatex(false);
    }
  }, [projectType, isEbook]);

  // Available outputs (trim Book when isEbook)
  const availableOutputs = useMemo<OutputFormat[]>(() => {
    if (projectType === "book" && isEbook) return ["epub", "pdf"];
    return OUTPUTS_BY_TYPE[projectType] || ["pdf"];
  }, [projectType, isEbook]);

  // Clamp outputs to availability and ensure EPUB for Ebook
  useEffect(() => {
    setOutputs((prev) => prev.filter((o) => availableOutputs.includes(o)));
    if (availableOutputs.length && outputs.length === 0) {
      setOutputs([availableOutputs[0]]);
    }
    if (projectType === "book" && isEbook && !outputs.includes("epub")) {
      setOutputs((prev) => Array.from(new Set<OutputFormat>(["epub", ...prev])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableOutputs.join("|"), projectType, isEbook]);

  // Headline by context
  const headline = useMemo(() => {
    if (projectType === "book" && isEbook) return "Publish an Ebook";
    if (projectType === "workshop") return "Design a Workshop";
    if (projectType === "mkdocs") return "Generate a MkDocs Site";
    if (projectType === "book") return "Author a Book";
    if (projectType === "journal") return "Prepare a Journal Article";
    if (projectType === "proceedings") return "Conference Proceedings";
    if (projectType === "blog") return "Write a Blog Post";
    return "Select Destination";
  }, [projectType, isEbook]);

  // Editorial preset (persisted in intent for backends that care)
  const editorialPreset = useMemo(
    () => mapEditorialPreset(projectType, templateId, isEbook),
    [projectType, templateId, isEbook]
  );

  // Card helpers
  const chooseType = (t: ProjectType) => {
    setProjectType(t);
    if (t !== "book") setIsEbook(false);
  };
  const chooseBookMode = (ebook: boolean) => {
    setProjectType("book");
    setIsEbook(ebook);
  };

  return (
    <section className="relative rounded-xl border bg-white p-0 shadow-sm">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-t-xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 px-6 py-10 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Stage 2</div>
          <h2 className="mt-1 text-2xl font-semibold">{headline}</h2>
          <p className="mt-2 text-sm text-gray-300">
            Pick your destination, template, and outputs. We’ll render a <b>preliminary outline</b> next so you can
            confirm before generating the final artifacts.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        {/* Type selection with distinct BOOK and EBOOK */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          <TypeCard
            active={projectType === "workshop"}
            onClick={() => chooseType("workshop")}
            icon={<IconHat className="text-emerald-700" />}
            title="Workshop"
            text="Hands-on, agenda, labs."
          />
          <TypeCard
            active={projectType === "mkdocs"}
            onClick={() => chooseType("mkdocs")}
            icon={<IconHat className="text-blue-700" />}
            title="MkDocs"
            text="Developer portal / docs."
          />
          <TypeCard
            active={projectType === "book" && !isEbook}
            onClick={() => chooseBookMode(false)}
            icon={<IconBook className="text-amber-700" />}
            title="Book"
            text="Chapters, figures, citations."
          />
          <TypeCard
            active={projectType === "book" && isEbook}
            onClick={() => chooseBookMode(true)}
            icon={<IconBook className="text-rose-700" />}
            title="Ebook"
            text="Kindle / Apple / EPUB3."
          />
          <TypeCard
            active={projectType === "journal"}
            onClick={() => chooseType("journal")}
            icon={<IconNewspaper className="text-purple-700" />}
            title="Journal"
            text="IMRAD & publisher rules."
          />
          <TypeCard
            active={projectType === "proceedings"}
            onClick={() => chooseType("proceedings")}
            icon={<IconNewspaper className="text-indigo-700" />}
            title="Proceedings"
            text="Program & camera-ready."
          />
          <TypeCard
            active={projectType === "blog"}
            onClick={() => chooseType("blog")}
            icon={<IconNewspaper className="text-pink-700" />}
            title="Blog"
            text="SEO + code fidelity."
          />
        </div>

        {/* Template chooser (driven by registry) */}
        <div className="card">
          <h3 className="mb-2 text-base font-semibold">
            {projectType === "workshop" && "Workshop Template"}
            {projectType === "mkdocs" && "MkDocs Theme"}
            {projectType === "book" && !isEbook && "Book Template"}
            {projectType === "book" && isEbook && "Ebook Template"}
            {projectType === "journal" && "Journal Template"}
            {projectType === "proceedings" && "Proceedings Template"}
            {projectType === "blog" && "Blog Style"}
          </h3>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {templateOptions.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => setTemplateId(tpl.id)}
                aria-pressed={templateId === tpl.id}
                className={[
                  "group rounded-lg border px-3 py-2 text-left text-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900/40",
                  templateId === tpl.id ? "border-gray-900 bg-gray-900 text-white" : "bg-white hover:bg-gray-50",
                ].join(" ")}
              >
                <div className="font-semibold">{tpl.label}</div>
                <div
                  className={[
                    "text-xs md:text-[11px]",
                    templateId === tpl.id ? "text-gray-200" : "text-gray-600",
                  ].join(" ")}
                >
                  {templateId === tpl.id ? "Selected" : tpl.blurb}
                </div>
              </button>
            ))}
          </div>

          <p className="mt-2 text-xs text-gray-500">
            Templates load from <code>/src/templates</code>. Book/Ebook are separate sets; Journal/Proceedings use
            publisher styles.
          </p>
        </div>

        {/* Outputs & packaging */}
        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Outputs & Packaging</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs text-gray-500">Select outputs</div>
              <div className="flex flex-wrap gap-2">
                {availableOutputs.map((f) => (
                  <label key={f} className="chip">
                    <input
                      type="checkbox"
                      checked={outputs.includes(f)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? Array.from(new Set([...outputs, f]))
                          : outputs.filter((x) => x !== f);
                        setOutputs(next);
                      }}
                    />
                    <span className="ml-1">{f.toUpperCase()}</span>
                  </label>
                ))}
                {(projectType === "journal" || (projectType === "book" && !isEbook)) && (
                  <label className="chip">
                    <input
                      type="checkbox"
                      checked={includeLatex}
                      onChange={(e) => setIncludeLatex(e.target.checked)}
                    />
                    <span className="ml-1">LaTeX (sources)</span>
                  </label>
                )}
              </div>

              {(projectType === "book" || projectType === "journal") && (
                <p className="mt-2 text-[11px] text-gray-500">
                  {isEbook
                    ? "EPUB targets reflowable readers; PDF for quick review."
                    : "Enable LaTeX to package source files with your export."}
                </p>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs text-gray-500">Package as</div>
              <div className="flex gap-2">
                <button
                  className={[
                    "btn-secondary inline-flex items-center gap-2 transition hover:-translate-y-0.5",
                    exportAs === "pdf" ? "!bg-gray-900 !text-white" : "",
                  ].join(" ")}
                  onClick={() => setExportAs("pdf")}
                >
                  <IconPdf /> PDF
                </button>
                <button
                  className={[
                    "btn-secondary inline-flex items-center gap-2 transition hover:-translate-y-0.5",
                    exportAs === "zip" ? "!bg-gray-900 !text-white" : "",
                  ].join(" ")}
                  onClick={() => setExportAs("zip")}
                >
                  <IconZip /> ZIP
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {projectType === "book" || projectType === "journal"
                  ? "Default is ZIP (sources, assets, compiled outputs). PDF available for quick review."
                  : "PDF for quick review, ZIP for full deliverables (assets, sources, site)."}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            Next: we’ll connect these choices and show a <b>preliminary rendered outline</b> so you can confirm before
            generation.
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => navigate("/wizard/intake")}>
              ← Back
            </button>
            <button
              className="btn"
              onClick={() => {
                // Persist machine-readable tags (keeps store types stable)
                const tags: string[] = [
                  `template:${projectType}:${templateId}`,
                  `package:${exportAs}`,
                ];
                if (projectType === "book") tags.push(`mode:${isEbook ? "ebook" : "book"}`);
                if (includeLatex && (projectType === "journal" || (projectType === "book" && !isEbook))) {
                  tags.push("includeLatex:true");
                }

                // Ensure EPUB present for Ebook so the editor registry picks EbookEditor
                const finalOutputs =
                  projectType === "book" && isEbook
                    ? Array.from(new Set<OutputFormat>(["epub", ...outputs]))
                    : outputs;

                upsert({
                  id: currentId,
                  intent: {
                    projectType, // "book" for both Book/Ebook
                    outputs: finalOutputs,
                    title: undefined,
                    subtitle: undefined,
                    authors: [],
                    audience: undefined,
                    tone: undefined,
                    constraints: tags.join("\n"),
                    due: undefined,
                    editorialPreset, // only when mapped
                  },
                });
                navigate("/wizard/outline");
              }}
            >
              Continue to Preview →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TypeCard({
  active,
  onClick,
  icon,
  title,
  text,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      className={[
        "group rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900/30",
        active ? "border-gray-900 bg-gray-900 text-white" : "bg-white",
      ].join(" ")}
    >
      <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-800 group-hover:scale-105 transition">
        {icon}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className={["text-sm", active ? "text-gray-200" : "text-gray-600"].join(" ")}>
        {text}
      </div>
    </button>
  );
}
