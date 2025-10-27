// workshop_builder/ui/src/components/JournalEditor.tsx

// JournalEditor.tsx
// Scientific Journal (IMRAD) — JSON-bridged editor
// - Accepts a JSON string/object from the previous stage
// - Parses & sanitizes -> populates the editor
// - Lets a human edit (IMRAD sections, word counts, figures/tables, citation style, template)
// - Emits a normalized JSON on every edit for the next stage

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   TYPES
   ========================================================================== */

export type ArticleSectionType =
  | "abstract"
  | "introduction"
  | "methods"
  | "results"
  | "discussion"
  | "references";

export type ArticleSection = {
  id: string;
  type: ArticleSectionType;
  /** Human label for the section (e.g., "Abstract", "Results") */
  label: string;
  /** Word/character count proxy (we model words for simplicity) */
  words: number;
  /** Inline figures and tables used in this section */
  figures: number;
  tables: number;
  /** Optional flag to indicate content shifted to supplementary materials */
  supplementary?: boolean;
};

export type JournalMetadata = {
  /** Core indexing & citation metadata */
  title: string;
  doi?: string;
  journal: string;
  volume?: string;
  issue?: string;
  /** Keywords for indexing */
  keywords: string[];
  /** Citation style and template choices */
  citationStyle: "apa" | "ieee" | "vancouver" | "chicago";
  template: "latex" | "docx";
};

export type JournalEditorValue = {
  metadata: JournalMetadata;
  sections: ArticleSection[];
  totalWords: number;
};

export type JournalInputJSON = {
  /** Global manuscript word budget (e.g., 5000) */
  wordBudget?: number;
  /** Figure+Table global limit (maps from dayBudgetMinutes conceptually) */
  figureTableBudget?: number;
  /** Input step for words slider */
  step?: number;
  /** Hard cap per section */
  sectionMaxWords?: number;
  /** Disable editing */
  readOnly?: boolean;

  /** Global metadata (title, doi, journal, etc.) */
  metadata?: Partial<JournalMetadata>;

  /** IMRAD sections */
  sections?: Array<{
    id?: string;
    type: string; // validated to ArticleSectionType at runtime
    label?: string;
    words?: number;
    figures?: number;
    tables?: number;
    supplementary?: boolean;
  }>;

  [k: string]: unknown; // ignore unknowns safely
};

type EditorProps = {
  /** Controlled value; if omitted the editor is uncontrolled with defaults. */
  value?: Omit<JournalEditorValue, "totalWords">;
  /** Global budgets/constraints */
  wordBudget?: number;
  figureTableBudget?: number;
  onChange?: (v: JournalEditorValue) => void;
  readOnly?: boolean;
  step?: number;
  sectionMaxWords?: number;
};

/* =============================================================================
   CONSTANTS / HELPERS
   ========================================================================== */

// "MIN_MINUTES" → Minimum words per section (journal constraints)
const MIN_WORDS: Record<ArticleSectionType, number> = {
  abstract: 150,
  introduction: 500,
  methods: 800,
  results: 800,
  discussion: 800,
  references: 50, // references list often excluded from word count; keep minimal placeholder
};

const DEFAULT_SECTION: Record<ArticleSectionType, Omit<ArticleSection, "id">> = {
  abstract: {
    type: "abstract",
    label: "Abstract",
    words: 200,
    figures: 0,
    tables: 0,
    supplementary: false,
  },
  introduction: {
    type: "introduction",
    label: "Introduction",
    words: 1200,
    figures: 0,
    tables: 0,
    supplementary: false,
  },
  methods: {
    type: "methods",
    label: "Methods",
    words: 1500,
    figures: 1,
    tables: 0,
    supplementary: false,
  },
  results: {
    type: "results",
    label: "Results",
    words: 1500,
    figures: 2,
    tables: 1,
    supplementary: false,
  },
  discussion: {
    type: "discussion",
    label: "Discussion",
    words: 1200,
    figures: 0,
    tables: 0,
    supplementary: false,
  },
  references: {
    type: "references",
    label: "References",
    words: 150,
    figures: 0,
    tables: 0,
    supplementary: false,
  },
};

const TYPE_LABEL: Record<ArticleSectionType, string> = {
  abstract: "Abstract",
  introduction: "Introduction",
  methods: "Methods",
  results: "Results",
  discussion: "Discussion",
  references: "References",
};

/** Visual proxy for "KIND_BADGE → Template & style choice" */
const TYPE_STYLE: Record<ArticleSectionType, string> = {
  abstract: "bg-sky-100 text-sky-800",
  introduction: "bg-emerald-100 text-emerald-800",
  methods: "bg-indigo-100 text-indigo-800",
  results: "bg-violet-100 text-violet-800",
  discussion: "bg-amber-100 text-amber-800",
  references: "bg-zinc-100 text-zinc-800",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function roundToStep(n: number, step: number) {
  const s = Math.max(1, step);
  return Math.round(n / s) * s;
}
function fmtWords(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(n % 1000 === 0 ? 0 : 1)}k words`;
  }
  return `${n} words`;
}
function asType(x: unknown): ArticleSectionType | null {
  return x === "abstract" ||
    x === "introduction" ||
    x === "methods" ||
    x === "results" ||
    x === "discussion" ||
    x === "references"
    ? x
    : null;
}
function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}
function splitKeywords(k: string | string[] | undefined): string[] {
  if (Array.isArray(k)) return k.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof k === "string")
    return k
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

/* =============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ========================================================================== */

type ParseResult = {
  config: {
    wordBudget: number;
    figureTableBudget: number;
    step: number;
    sectionMaxWords: number;
    readOnly: boolean;
  };
  metadata: JournalMetadata;
  sections: ArticleSection[];
  warnings: string[];
  errors: string[];
};

export function parseJournalJSON(
  src: string | JournalInputJSON,
  defaults: {
    wordBudget?: number;
    figureTableBudget?: number;
    step?: number;
    sectionMaxWords?: number;
    readOnly?: boolean;
  } = {}
): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let obj: any;
  if (typeof src === "string") {
    try {
      obj = JSON.parse(src);
    } catch {
      errors.push("Invalid JSON: could not parse input string.");
      obj = {};
    }
  } else if (src && typeof src === "object") {
    obj = src as any;
  } else {
    errors.push("Input must be a JSON string or object.");
    obj = {};
  }

  const wordBudget = asNumber(obj.wordBudget) ?? defaults.wordBudget ?? 5000;
  const figureTableBudget =
    asNumber(obj.figureTableBudget) ?? defaults.figureTableBudget ?? 5;
  const step = Math.max(1, asNumber(obj.step) ?? defaults.step ?? 50);
  const sectionMaxWords =
    Math.max(100, asNumber(obj.sectionMaxWords) ?? defaults.sectionMaxWords ?? 3000);
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  const md = obj.metadata ?? {};
  const metadata: JournalMetadata = {
    title: asString(md.title) ?? "Untitled Article",
    doi: asString(md.doi) ?? undefined,
    journal: asString(md.journal) ?? "Journal",
    volume: asString(md.volume) ?? undefined,
    issue: asString(md.issue) ?? undefined,
    keywords: splitKeywords(md.keywords),
    citationStyle:
      (asString(md.citationStyle) as JournalMetadata["citationStyle"]) ?? "ieee",
    template: (asString(md.template) as JournalMetadata["template"]) ?? "latex",
  };

  let rawSections: any[] = Array.isArray(obj.sections) ? obj.sections : [];
  if (rawSections.length === 0) {
    warnings.push(
      "No sections provided. Using IMRAD defaults plus References."
    );
    rawSections = [
      { type: "abstract", label: DEFAULT_SECTION.abstract.label, words: DEFAULT_SECTION.abstract.words, figures: 0, tables: 0 },
      { type: "introduction", label: DEFAULT_SECTION.introduction.label, words: DEFAULT_SECTION.introduction.words, figures: 0, tables: 0 },
      { type: "methods", label: DEFAULT_SECTION.methods.label, words: DEFAULT_SECTION.methods.words, figures: 1, tables: 0 },
      { type: "results", label: DEFAULT_SECTION.results.label, words: DEFAULT_SECTION.results.words, figures: 2, tables: 1 },
      { type: "discussion", label: DEFAULT_SECTION.discussion.label, words: DEFAULT_SECTION.discussion.words, figures: 0, tables: 0 },
      { type: "references", label: DEFAULT_SECTION.references.label, words: DEFAULT_SECTION.references.words, figures: 0, tables: 0 },
    ];
  }

  const sections: ArticleSection[] = [];
  rawSections.forEach((rs, i) => {
    const t = asType(rs.type);
    if (!t) {
      warnings.push(`Section ${i}: invalid "type" (${String(rs.type)}). Skipped.`);
      return;
    }
    const label = asString(rs.label) ?? TYPE_LABEL[t];

    let words = asNumber(rs.words);
    if (words === null) {
      warnings.push(`Section ${i}: missing/invalid "words". Using default for ${t}.`);
      words = DEFAULT_SECTION[t].words;
    }
    const id = asString(rs.id) ?? uid();
    const figures = clampInt(asNumber(rs.figures) ?? DEFAULT_SECTION[t].figures, 0, 100);
    const tables = clampInt(asNumber(rs.tables) ?? DEFAULT_SECTION[t].tables, 0, 100);
    const supplementary = !!rs.supplementary;

    const minForType = MIN_WORDS[t];
    const normalized = clampInt(roundToStep(words, step), minForType, sectionMaxWords);
    if (normalized !== words) {
      warnings.push(
        `Section ${i}: words (${words}) normalized to ${normalized} (min ${minForType}, max ${sectionMaxWords}, step ${step}).`
      );
    }

    sections.push({
      id,
      type: t,
      label,
      words: normalized,
      figures,
      tables,
      supplementary,
    });
  });

  return {
    config: { wordBudget, figureTableBudget, step, sectionMaxWords, readOnly },
    metadata,
    sections,
    warnings,
    errors,
  };
}

export function serializeJournalToJSON(
  metadata: JournalMetadata,
  sections: ArticleSection[],
  config: {
    wordBudget: number;
    figureTableBudget: number;
    step: number;
    sectionMaxWords: number;
    readOnly: boolean;
  }
): JournalInputJSON {
  return {
    wordBudget: config.wordBudget,
    figureTableBudget: config.figureTableBudget,
    step: config.step,
    sectionMaxWords: config.sectionMaxWords,
    readOnly: config.readOnly,
    metadata: {
      title: metadata.title,
      doi: metadata.doi,
      journal: metadata.journal,
      volume: metadata.volume,
      issue: metadata.issue,
      keywords: metadata.keywords,
      citationStyle: metadata.citationStyle,
      template: metadata.template,
    },
    sections: sections.map((s: ArticleSection) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      words: s.words,
      figures: s.figures,
      tables: s.tables,
      supplementary: !!s.supplementary,
    })),
  };
}

/* =============================================================================
   CORE EDITOR (production-safe; avoids feedback loops; pointer events)
   ========================================================================== */

export function JournalEditor({
  value,
  wordBudget = 5000,
  figureTableBudget = 5,
  onChange,
  readOnly = false,
  step = 50,
  sectionMaxWords = 3000,
}: EditorProps) {
  const isControlled = value !== undefined;

  const [internalMetadata, setInternalMetadata] = useState<JournalMetadata>({
    title: "Untitled Article",
    doi: "",
    journal: "Journal",
    volume: "",
    issue: "",
    keywords: [],
    citationStyle: "ieee",
    template: "latex",
  });

  const [internalSections, setInternalSections] = useState<ArticleSection[]>(() => [
    { id: uid(), ...DEFAULT_SECTION.abstract },
    { id: uid(), ...DEFAULT_SECTION.introduction },
    { id: uid(), ...DEFAULT_SECTION.methods },
    { id: uid(), ...DEFAULT_SECTION.results },
    { id: uid(), ...DEFAULT_SECTION.discussion },
    { id: uid(), ...DEFAULT_SECTION.references },
  ]);

  // Strongly type controlled value access
  const controlled = value as Omit<JournalEditorValue, "totalWords"> | undefined;
  const metadata: JournalMetadata = isControlled ? controlled!.metadata : internalMetadata;
  const sections: ArticleSection[] = isControlled ? controlled!.sections : internalSections;

  const totalWords = useMemo(
    () =>
      sections.reduce<number>(
        (acc: number, s: ArticleSection) =>
          acc + (Number.isFinite(s.words) ? s.words : 0),
        0
      ),
    [sections]
  );
  const usedMedia = useMemo(
    () =>
      sections.reduce<number>(
        (acc: number, s: ArticleSection) => acc + (s.figures || 0) + (s.tables || 0),
        0
      ),
    [sections]
  );

  const commit = useCallback(
    (nextMeta: JournalMetadata, nextSections: ArticleSection[]) => {
      if (!isControlled) {
        setInternalMetadata(nextMeta);
        setInternalSections(nextSections);
      }
      const nextTotal = nextSections.reduce<number>(
        (acc: number, s: ArticleSection) =>
          acc + (Number.isFinite(s.words) ? s.words : 0),
        0
      );
      onChange?.({
        metadata: nextMeta,
        sections: nextSections,
        totalWords: nextTotal,
      });
    },
    [isControlled, onChange]
  );

  const wordPct = Math.min(100, Math.round((totalWords / Math.max(1, wordBudget)) * 100));
  const overWords = totalWords > wordBudget;

  const mediaPct = Math.min(100, Math.round((usedMedia / Math.max(1, figureTableBudget)) * 100));
  const overMedia = usedMedia > figureTableBudget;

  const addSection = (type: ArticleSectionType) => {
    if (readOnly) return;
    const next = [...sections, { id: uid(), ...DEFAULT_SECTION[type] }];
    commit(metadata, next);
  };

  const duplicateSection = (id: string) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: ArticleSection) => s.id === id);
    if (idx < 0) return;
    const original = sections[idx];
    const copy: ArticleSection = { ...original, id: uid(), label: `${original.label} (copy)` };
    const out = sections.slice();
    out.splice(idx + 1, 0, copy);
    commit(metadata, out);
  };

  const removeSection = (id: string) => {
    if (readOnly) return;
    commit(metadata, sections.filter((s: ArticleSection) => s.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: ArticleSection) => s.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = sections.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    commit(metadata, copy);
  };

  const updateSection = (id: string, patch: Partial<ArticleSection>) => {
    if (readOnly) return;
    const out = sections.map((s: ArticleSection) => {
      if (s.id !== id) return s;
      const nextType = (patch.type ?? s.type) as ArticleSectionType;
      const minForType = MIN_WORDS[nextType];
      const nextWords =
        patch.words !== undefined
          ? clampInt(roundToStep(patch.words, step), minForType, sectionMaxWords)
          : s.words;
      const nextFigures =
        patch.figures !== undefined ? clampInt(patch.figures, 0, 100) : s.figures;
      const nextTables =
        patch.tables !== undefined ? clampInt(patch.tables, 0, 100) : s.tables;
      const nextSupplementary =
        patch.supplementary !== undefined ? !!patch.supplementary : s.supplementary;

      return {
        ...s,
        ...patch,
        type: nextType,
        words: nextWords,
        figures: nextFigures,
        tables: nextTables,
        supplementary: nextSupplementary,
      };
    });
    commit(metadata, out);
  };

  const updateMetadata = <K extends keyof JournalMetadata>(key: K, val: JournalMetadata[K]) => {
    if (readOnly) return;
    const nextMeta = { ...metadata, [key]: val };
    commit(nextMeta, sections);
  };

  return (
    <div className="card">
      {/* Top Summary */}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold">Scientific Journal Editor (IMRAD)</h3>
        <div className="text-sm text-gray-700">
          Words: <b>{fmtWords(totalWords)}</b> / {fmtWords(wordBudget)}{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overWords ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {wordPct}% used
          </span>
          <span className="mx-2">•</span>
          Figures+Tables: <b>{usedMedia}</b> / {figureTableBudget}{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overMedia ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {mediaPct}% used
          </span>
        </div>
      </div>

      {/* Progress bars */}
      <div className="mb-2 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overWords ? "bg-red-500" : "bg-gray-800"}`}
          style={{ width: `${Math.min(100, (totalWords / Math.max(1, wordBudget)) * 100)}%` }}
        />
      </div>
      <div className="mb-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overMedia ? "bg-red-500" : "bg-gray-800"}`}
          style={{ width: `${Math.min(100, (usedMedia / Math.max(1, figureTableBudget)) * 100)}%` }}
        />
      </div>

      {/* Metadata Panel */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Article Metadata</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Title</span>
            <input
              className="input"
              value={metadata.title}
              onChange={(e) => updateMetadata("title", e.target.value)}
              disabled={readOnly}
              placeholder="Concise, descriptive title"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">DOI (optional)</span>
            <input
              className="input"
              value={metadata.doi ?? ""}
              onChange={(e) => updateMetadata("doi", e.target.value)}
              disabled={readOnly}
              placeholder="10.1234/abcd.2025.00123"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Journal</span>
            <input
              className="input"
              value={metadata.journal}
              onChange={(e) => updateMetadata("journal", e.target.value)}
              disabled={readOnly}
              placeholder="Journal Name"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Volume</span>
              <input
                className="input"
                value={metadata.volume ?? ""}
                onChange={(e) => updateMetadata("volume", e.target.value)}
                disabled={readOnly}
                placeholder="42"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Issue</span>
              <input
                className="input"
                value={metadata.issue ?? ""}
                onChange={(e) => updateMetadata("issue", e.target.value)}
                disabled={readOnly}
                placeholder="1"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Keywords (comma separated)</span>
            <input
              className="input"
              value={metadata.keywords.join(", ")}
              onChange={(e) =>
                updateMetadata(
                  "keywords",
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                )
              }
              disabled={readOnly}
              placeholder="machine learning, genomics, imaging"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Citation Style</span>
            <select
              className="input"
              value={metadata.citationStyle}
              onChange={(e) =>
                updateMetadata("citationStyle", e.target.value as JournalMetadata["citationStyle"])
              }
              disabled={readOnly}
            >
              <option value="ieee">IEEE</option>
              <option value="apa">APA</option>
              <option value="vancouver">Vancouver</option>
              <option value="chicago">Chicago</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Template</span>
            <select
              className="input"
              value={metadata.template}
              onChange={(e) =>
                updateMetadata("template", e.target.value as JournalMetadata["template"])
              }
              disabled={readOnly}
            >
              <option value="latex">LaTeX (publisher class)</option>
              <option value="docx">DOCX (publisher style)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Add Sections */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addSection("abstract")}>
            + Add Abstract
          </button>
          <button className="btn" onClick={() => addSection("introduction")}>
            + Add Introduction
          </button>
          <button className="btn" onClick={() => addSection("methods")}>
            + Add Methods
          </button>
          <button className="btn" onClick={() => addSection("results")}>
            + Add Results
          </button>
          <button className="btn" onClick={() => addSection("discussion")}>
            + Add Discussion
          </button>
          <button className="btn-secondary" onClick={() => addSection("references")}>
            + Add References
          </button>
        </div>
      )}

      {/* Sections */}
      <ul className="space-y-3">
        {sections.map((s: ArticleSection, idx: number) => (
          <li key={s.id} className="rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[s.type]}`}>
                  {TYPE_LABEL[s.type]}
                </span>
                <input
                  className="input !py-1 text-sm"
                  value={s.label}
                  onChange={(e) => updateSection(s.id, { label: e.target.value })}
                  disabled={readOnly}
                  placeholder={`${TYPE_LABEL[s.type]} label`}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-gray-500">{fmtWords(s.words)}</span>
                {!readOnly && (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() => move(s.id, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => move(s.id, +1)}
                      disabled={idx === sections.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => duplicateSection(s.id)}
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => removeSection(s.id)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Words / Supplementary control */}
            <WordsSlider
              words={s.words}
              min={MIN_WORDS[s.type]}
              max={sectionMaxWords}
              step={step}
              onChange={(w) => updateSection(s.id, { words: w })}
              disabled={readOnly}
            />

            {/* Figures/Tables & Supplementary */}
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">Figures</span>
                <input
                  type="number"
                  className="input !w-24 !py-1"
                  min={0}
                  step={1}
                  value={s.figures}
                  disabled={readOnly}
                  onChange={(e) => updateSection(s.id, { figures: parseInt(e.target.value || "0", 10) })}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">Tables</span>
                <input
                  type="number"
                  className="input !w-24 !py-1"
                  min={0}
                  step={1}
                  value={s.tables}
                  disabled={readOnly}
                  onChange={(e) => updateSection(s.id, { tables: parseInt(e.target.value || "0", 10) })}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={!!s.supplementary}
                  disabled={readOnly}
                  onChange={(e) => updateSection(s.id, { supplementary: e.target.checked })}
                />
                <span className="text-sm text-gray-600">Move overflow to Supplementary</span>
              </label>
            </div>
          </li>
        ))}
      </ul>

      {(overWords || overMedia) && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {overWords && (
            <div>
              Word budget exceeded by <b>{fmtWords(totalWords - wordBudget)}</b>. Reduce section
              words or adjust the journal limit.
            </div>
          )}
          {overMedia && (
            <div className="mt-1">
              Figure/Table limit exceeded by <b>{usedMedia - figureTableBudget}</b>. Consider moving
              items to Supplementary or combining panels.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   SLIDER (Pointer Events; keyboard accessible)
   ========================================================================== */

function WordsSlider({
  words,
  min,
  max,
  step = 50,
  disabled,
  onChange,
}: {
  words: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (w: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pct = useMemo(() => {
    const span = Math.max(1, max - min);
    return Math.max(0, Math.min(100, ((words - min) / span) * 100));
  }, [words, min, max]);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = railRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const raw = min + ratio * (max - min);
      const snapped = clampInt(roundToStep(raw, step), min, max);
      onChangeRef.current(snapped);
    },
    [max, min, step]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -step;
      if (e.key === "ArrowRight") delta = step;
      if (e.key === "PageDown") delta = -step * 5;
      if (e.key === "PageUp") delta = step * 5;
      if (e.key === "Home") {
        onChangeRef.current(min);
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        onChangeRef.current(max);
        e.preventDefault();
        return;
      }
      if (delta !== 0) {
        const next = clampInt(roundToStep(words + delta, step), min, max);
        onChangeRef.current(next);
        e.preventDefault();
      }
    },
    [disabled, max, min, words, step]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!railRef.current) return;
      setDragging(true);
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      setFromClientX(e.clientX);
    },
    [disabled, setFromClientX]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || disabled) return;
      setFromClientX(e.clientX);
    },
    [dragging, disabled, setFromClientX]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="mt-3">
      <div
        ref={railRef}
        className={`relative h-4 w-full select-none rounded-full ${
          disabled ? "bg-gray-200" : "cursor-pointer bg-gray-100 hover:bg-gray-200"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label="Word count"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={words}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
      >
        <div
          className={`absolute left-0 top-0 h-4 rounded-full ${
            disabled ? "bg-gray-400" : "bg-gray-800"
          }`}
          style={{ width: `${pct}%` }}
        />
        <div
          className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 translate-x-[-50%] rounded-full border-2 ${
            disabled ? "border-gray-400 bg-white" : "border-gray-800 bg-white"
          }`}
          style={{ left: `${pct}%` }}
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          className="input !w-32 !py-1"
          value={words}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) =>
            onChangeRef.current(
              clampInt(roundToStep(parseInt(e.target.value || "0", 10), step), min, max)
            )
          }
          onWheel={(e) => {
            if (document.activeElement === e.currentTarget) {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <span className="text-xs text-gray-500">
          min {min} • max {max} • step {step}
        </span>
      </div>
    </div>
  );
}

/* =============================================================================
   WRAPPER — accepts previous-stage JSON and emits updated JSON for next stage
   ========================================================================== */

export type JournalEditorFromJSONProps = {
  /** JSON string/object from the previous stage. */
  source: string | JournalInputJSON;
  /** Receive normalized JSON whenever the user changes metadata/sections. */
  onChangeJSON?: (json: JournalInputJSON) => void;
  /** Show parse diagnostics (default true). */
  showDiagnostics?: boolean;
  className?: string;
};

export function JournalEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: JournalEditorFromJSONProps) {
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    metadata: JournalMetadata;
    sections: ArticleSection[];
    config: {
      wordBudget: number;
      figureTableBudget: number;
      step: number;
      sectionMaxWords: number;
      readOnly: boolean;
    };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseJournalJSON(source);
    return {
      metadata: res.metadata,
      sections: res.sections,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    };
  });

  useEffect(() => {
    const res = parseJournalJSON(source);
    setState({
      metadata: res.metadata,
      sections: res.sections,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    });
  }, [sourceFingerprint]);

  const { metadata, sections, config, warnings, errors } = state;

  const handleChange = useCallback(
    ({ metadata: md, sections: secs }: JournalEditorValue) => {
      setState((prev) => ({ ...prev, metadata: md, sections: secs }));
      onChangeJSON?.(serializeJournalToJSON(md, secs, config));
    },
    [config, onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse journal JSON:</b>
              <ul className="ml-4 list-disc">
                {errors.map((e, i) => (
                  <li key={`err-${i}`}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <b>Parsed with warnings:</b>
              <ul className="ml-4 list-disc">
                {warnings.map((w, i) => (
                  <li key={`warn-${i}`}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <JournalEditor
        value={{ metadata, sections }}
        wordBudget={config.wordBudget}
        figureTableBudget={config.figureTableBudget}
        step={config.step}
        sectionMaxWords={config.sectionMaxWords}
        readOnly={config.readOnly}
        onChange={handleChange}
      />
    </div>
  );
}

/** Default export: JSON-bridged component for convenience */
export default JournalEditorFromJSON;

/* =============================================================================
   USAGE EXAMPLE

   <JournalEditorFromJSON
     source={{
       wordBudget: 5000,
       figureTableBudget: 5,
       step: 50,
       sectionMaxWords: 2500,
       readOnly: false,
       metadata: {
         title: "Deep Learning for Medical Imaging",
         doi: "10.1234/medim.2025.0001",
         journal: "International Journal of Imaging",
         volume: "42",
         issue: "1",
         keywords: ["deep learning", "MRI", "classification"],
         citationStyle: "ieee",
         template: "latex"
       },
       sections: [
         { id: "abs", type: "abstract", label: "Abstract", words: 200, figures: 0, tables: 0 },
         { id: "intro", type: "introduction", label: "Introduction", words: 1200, figures: 0, tables: 0 },
         { id: "meth", type: "methods", label: "Methods", words: 1500, figures: 1, tables: 0 },
         { id: "res", type: "results", label: "Results", words: 1500, figures: 2, tables: 1 },
         { id: "disc", type: "discussion", label: "Discussion", words: 1200, figures: 0, tables: 0 },
         { id: "refs", type: "references", label: "References", words: 150, figures: 0, tables: 0 }
       ]
     }}
     onChangeJSON={(json) => {
       // Send JSON to backend / next stage (e.g., build LaTeX/DOCX with citation style)
       console.log("Updated journal JSON:", json);
     }}
   />
   ========================================================================== */
