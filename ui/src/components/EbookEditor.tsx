// workshop_builder/ui/src/components/EbookEditor.tsx
// EbookEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   TYPES
   ========================================================================== */
export type EbookSectionType = "front_matter" | "body" | "index" | "sample_chapter";

export type EbookSection = {
  id: string;
  type: EbookSectionType;
  /** Human label for the section (e.g., "Preface", "Chapter 1", "Index") */
  label: string;
  /** Reading time estimate in minutes */
  readingMinutes: number;
};

export type EbookMetadata = {
  title: string;
  seriesName?: string;
  author: string;
  /** Tags/keywords without #, comma-separated in UI, serialized as array */
  tags: string[];
  /** Optional HTML used for the book description (maps to Kindle product detail). */
  descriptionHTML?: string;
  /** Simple style hint that could map to cover art theme */
  coverTheme?: "classic" | "minimal" | "bold";
};

export type EbookEditorValue = {
  metadata: EbookMetadata;
  sections: EbookSection[];
  totalReadingMinutes: number;
};

export type EbookInputJSON = {
  tierBudgetMinutes?: number; // maps "dayBudgetMinutes" → pricing/royalty constraint proxy
  step?: number; // slider/input step
  sectionMaxMinutes?: number; // hard cap per section
  readOnly?: boolean;
  metadata?: Partial<EbookMetadata>;
  sections?: Array<{
    id?: string;
    type: string; // validated to EbookSectionType
    label?: string;
    readingMinutes?: number;
  }>;
  [k: string]: unknown; // ignore unknowns safely
};

type EditorProps = {
  /** Controlled value; if omitted the editor is uncontrolled with defaults. */
  value?: Omit<EbookEditorValue, "totalReadingMinutes">;
  tierBudgetMinutes?: number;
  onChange?: (v: EbookEditorValue) => void;
  readOnly?: boolean;
  step?: number;
  sectionMaxMinutes?: number;
};

/* =============================================================================
   CONSTANTS / HELPERS
   ========================================================================== */

const MIN_READING_MINUTES: Record<EbookSectionType, number> = {
  front_matter: 1,
  body: 30, // maps "Minimum Body Content", e.g., ensure full-length content
  index: 1,
  sample_chapter: 5,
};

const DEFAULT_SECTION: Record<EbookSectionType, Omit<EbookSection, "id">> = {
  front_matter: { type: "front_matter", label: "Front Matter", readingMinutes: 5 },
  body: { type: "body", label: "Body", readingMinutes: 90 },
  index: { type: "index", label: "Index", readingMinutes: 3 },
  sample_chapter: { type: "sample_chapter", label: "Sample Chapter", readingMinutes: 10 },
};

const TYPE_LABEL: Record<EbookSectionType, string> = {
  front_matter: "Front Matter",
  body: "Body",
  index: "Index",
  sample_chapter: "Sample Chapter",
};

/** Style used as a visual proxy for "Cover Art & Book Description HTML/CSS" */
const TYPE_STYLE: Record<EbookSectionType, string> = {
  front_matter: "bg-sky-100 text-sky-800",
  body: "bg-emerald-100 text-emerald-800",
  index: "bg-amber-100 text-amber-800",
  sample_chapter: "bg-fuchsia-100 text-fuchsia-800",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function roundToStep(n: number, step: number) {
  return Math.round(n / Math.max(1, step)) * Math.max(1, step);
}
function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/* =============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ========================================================================== */

function asType(x: unknown): EbookSectionType | null {
  return x === "front_matter" || x === "body" || x === "index" || x === "sample_chapter"
    ? x
    : null;
}
function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}
function splitTags(s: string | string[] | undefined): string[] {
  if (Array.isArray(s)) return s.map((t) => String(t)).map((t) => t.trim()).filter(Boolean);
  if (typeof s === "string")
    return s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

type ParseResult = {
  config: {
    tierBudgetMinutes: number;
    step: number;
    sectionMaxMinutes: number;
    readOnly: boolean;
  };
  metadata: EbookMetadata;
  sections: EbookSection[];
  warnings: string[];
  errors: string[];
};

export function parseEbookJSON(
  src: string | EbookInputJSON,
  defaults: { tierBudgetMinutes?: number; step?: number; sectionMaxMinutes?: number; readOnly?: boolean } = {}
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

  const tierBudgetMinutes =
    asNumber(obj.tierBudgetMinutes) ?? defaults.tierBudgetMinutes ?? 360; // proxy for pricing/royalty constraint
  const step = Math.max(1, asNumber(obj.step) ?? defaults.step ?? 5);
  const sectionMaxMinutes = Math.max(1, asNumber(obj.sectionMaxMinutes) ?? defaults.sectionMaxMinutes ?? 480);
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  const md = obj.metadata ?? {};
  const metadata: EbookMetadata = {
    title: asString(md.title) ?? "Untitled Book",
    seriesName: asString(md.seriesName) ?? undefined,
    author: asString(md.author) ?? "Unknown Author",
    tags: splitTags(md.tags),
    descriptionHTML: asString(md.descriptionHTML) ?? undefined,
    coverTheme: (asString(md.coverTheme) as EbookMetadata["coverTheme"]) ?? "classic",
  };

  let rawSections: any[] = Array.isArray(obj.sections) ? obj.sections : [];
  if (rawSections.length === 0) {
    warnings.push("No sections provided in JSON. Using defaults (Front Matter, Body, Index).");
    rawSections = [
      { type: "front_matter", label: DEFAULT_SECTION.front_matter.label, readingMinutes: DEFAULT_SECTION.front_matter.readingMinutes },
      { type: "body", label: DEFAULT_SECTION.body.label, readingMinutes: DEFAULT_SECTION.body.readingMinutes },
      { type: "index", label: DEFAULT_SECTION.index.label, readingMinutes: DEFAULT_SECTION.index.readingMinutes },
    ];
  }

  const sections: EbookSection[] = [];
  rawSections.forEach((rs, i) => {
    const t = asType(rs.type);
    if (!t) {
      warnings.push(`Section ${i}: invalid "type" (${String(rs.type)}). Skipped.`);
      return;
    }
    const label = asString(rs.label) ?? TYPE_LABEL[t];
    let readingMinutes = asNumber(rs.readingMinutes);
    if (readingMinutes === null) {
      warnings.push(`Section ${i}: missing/invalid "readingMinutes". Using default for ${t}.`);
      readingMinutes = DEFAULT_SECTION[t].readingMinutes;
    }
    const id = asString(rs.id) ?? uid();
    const minForType = MIN_READING_MINUTES[t];
    const normalized = clampInt(roundToStep(readingMinutes, step), minForType, sectionMaxMinutes);
    if (normalized !== readingMinutes) {
      warnings.push(
        `Section ${i}: readingMinutes (${readingMinutes}) normalized to ${normalized} (min ${minForType}, max ${sectionMaxMinutes}, step ${step}).`
      );
    }
    sections.push({ id, type: t, label, readingMinutes: normalized });
  });

  return {
    config: { tierBudgetMinutes, step, sectionMaxMinutes, readOnly },
    metadata,
    sections,
    warnings,
    errors,
  };
}

export function serializeEbookToJSON(
  metadata: EbookMetadata,
  sections: EbookSection[],
  config: { tierBudgetMinutes: number; step: number; sectionMaxMinutes: number; readOnly: boolean }
): EbookInputJSON {
  return {
    tierBudgetMinutes: config.tierBudgetMinutes,
    step: config.step,
    sectionMaxMinutes: config.sectionMaxMinutes,
    readOnly: config.readOnly,
    metadata: {
      title: metadata.title,
      seriesName: metadata.seriesName,
      author: metadata.author,
      tags: metadata.tags,
      descriptionHTML: metadata.descriptionHTML,
      coverTheme: metadata.coverTheme,
    },
    sections: sections.map((s: EbookSection) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      readingMinutes: s.readingMinutes,
    })),
  };
}

/* =============================================================================
   CORE EDITOR (production-safe; avoids feedback loops; pointer events)
   ========================================================================== */

export function EbookEditor({
  value,
  tierBudgetMinutes = 360,
  onChange,
  readOnly = false,
  step = 5,
  sectionMaxMinutes = 480,
}: EditorProps) {
  const isControlled = value !== undefined;

  const [internalMetadata, setInternalMetadata] = useState<EbookMetadata>({
    title: "Untitled Book",
    author: "Unknown Author",
    seriesName: "",
    tags: [],
    coverTheme: "classic",
    descriptionHTML: "",
  });

  const [internalSections, setInternalSections] = useState<EbookSection[]>(() => [
    { id: uid(), ...DEFAULT_SECTION.front_matter },
    { id: uid(), ...DEFAULT_SECTION.body },
    { id: uid(), ...DEFAULT_SECTION.index },
  ]);

  // Strong typing for controlled vs uncontrolled
  const controlled = value as Omit<EbookEditorValue, "totalReadingMinutes"> | undefined;
  const metadata: EbookMetadata = isControlled ? controlled!.metadata : internalMetadata;
  const sections: EbookSection[] = isControlled ? controlled!.sections : internalSections;

  const totalReadingMinutes = useMemo(
    () =>
      sections.reduce<number>(
        (acc: number, s: EbookSection) =>
          acc + (Number.isFinite(s.readingMinutes) ? s.readingMinutes : 0),
        0
      ),
    [sections]
  );

  const commit = useCallback(
    (nextMeta: EbookMetadata, nextSections: EbookSection[]) => {
      if (!isControlled) {
        setInternalMetadata(nextMeta);
        setInternalSections(nextSections);
      }
      const nextTotal = nextSections.reduce<number>(
        (acc: number, s: EbookSection) =>
          acc + (Number.isFinite(s.readingMinutes) ? s.readingMinutes : 0),
        0
      );
      onChange?.({
        metadata: nextMeta,
        sections: nextSections,
        totalReadingMinutes: nextTotal,
      });
    },
    [isControlled, onChange]
  );

  const pct = Math.min(100, Math.round((totalReadingMinutes / Math.max(1, tierBudgetMinutes)) * 100));
  const overTier = totalReadingMinutes > tierBudgetMinutes;

  const addSection = (type: EbookSectionType) => {
    if (readOnly) return;
    const next = [...sections, { id: uid(), ...DEFAULT_SECTION[type] }];
    commit(metadata, next);
  };

  const duplicateSection = (id: string) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: EbookSection) => s.id === id);
    if (idx < 0) return;
    const original = sections[idx];
    const copy: EbookSection = { ...original, id: uid(), label: `${original.label} (copy)` };
    const out = sections.slice();
    out.splice(idx + 1, 0, copy);
    commit(metadata, out);
  };

  const removeSection = (id: string) => {
    if (readOnly) return;
    commit(metadata, sections.filter((s: EbookSection) => s.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: EbookSection) => s.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = sections.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    commit(metadata, copy);
  };

  const updateSection = (id: string, patch: Partial<EbookSection>) => {
    if (readOnly) return;
    const out = sections.map((s: EbookSection) => {
      if (s.id !== id) return s;
      const nextType = (patch.type ?? s.type) as EbookSectionType;
      const minForType = MIN_READING_MINUTES[nextType];
      const nextMinutes =
        patch.readingMinutes !== undefined
          ? clampInt(roundToStep(patch.readingMinutes, step), minForType, sectionMaxMinutes)
          : s.readingMinutes;
      return {
        ...s,
        ...patch,
        type: nextType,
        readingMinutes: nextMinutes,
      };
    });
    commit(metadata, out);
  };

  const updateMetadata = <K extends keyof EbookMetadata>(key: K, val: EbookMetadata[K]) => {
    if (readOnly) return;
    const nextMeta = { ...metadata, [key]: val };
    commit(nextMeta, sections);
  };

  return (
    <div className="card">
      {/* Top Summary / Pricing Tier Proxy */}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold">Ebook Editor</h3>
        <div className="text-sm text-gray-700">
          Tier target: <b>{fmtMin(tierBudgetMinutes)}</b> • Total reading: <b>{fmtMin(totalReadingMinutes)}</b>{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overTier ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {pct}% of tier
          </span>
        </div>
      </div>

      <div className="mb-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overTier ? "bg-red-500" : "bg-gray-800"}`}
          style={{ width: `${Math.min(100, (totalReadingMinutes / Math.max(1, tierBudgetMinutes)) * 100)}%` }}
        />
      </div>

      {/* Metadata Panel */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Ebook Metadata</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Title</span>
            <input
              className="input"
              value={metadata.title}
              onChange={(e) => updateMetadata("title", e.target.value)}
              disabled={readOnly}
              placeholder="Book Title"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Series Name (optional)</span>
            <input
              className="input"
              value={metadata.seriesName ?? ""}
              onChange={(e) => updateMetadata("seriesName", e.target.value)}
              disabled={readOnly}
              placeholder="Series Name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Author</span>
            <input
              className="input"
              value={metadata.author}
              onChange={(e) => updateMetadata("author", e.target.value)}
              disabled={readOnly}
              placeholder="Author"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Tags / Keywords (comma separated)</span>
            <input
              className="input"
              value={metadata.tags.join(", ")}
              onChange={(e) =>
                updateMetadata(
                  "tags",
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                )
              }
              disabled={readOnly}
              placeholder="fiction, adventure, fantasy"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Cover Theme</span>
            <select
              className="input"
              value={metadata.coverTheme ?? "classic"}
              onChange={(e) => updateMetadata("coverTheme", e.target.value as EbookMetadata["coverTheme"])}
              disabled={readOnly}
            >
              <option value="classic">Classic</option>
              <option value="minimal">Minimal</option>
              <option value="bold">Bold</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Book Description (HTML allowed)</span>
            <textarea
              className="input min-h-[100px]"
              value={metadata.descriptionHTML ?? ""}
              onChange={(e) => updateMetadata("descriptionHTML", e.target.value)}
              disabled={readOnly}
              placeholder="<p>A riveting tale...</p>"
            />
          </label>
        </div>
      </div>

      {/* Add Sections */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addSection("front_matter")}>
            + Add Front Matter
          </button>
          <button className="btn" onClick={() => addSection("body")}>
            + Add Body
          </button>
          <button className="btn" onClick={() => addSection("sample_chapter")}>
            + Add Sample Chapter
          </button>
          <button className="btn-secondary" onClick={() => addSection("index")}>
            + Add Index
          </button>
        </div>
      )}

      {/* Sections List */}
      <ul className="space-y-3">
        {sections.map((s: EbookSection, idx: number) => (
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
                <span className="text-sm text-gray-500">{fmtMin(s.readingMinutes)}</span>
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

            <ReadingSlider
              readingMinutes={s.readingMinutes}
              min={MIN_READING_MINUTES[s.type]}
              max={sectionMaxMinutes}
              step={step}
              onChange={(m) => updateSection(s.id, { readingMinutes: m })}
              disabled={readOnly}
            />
          </li>
        ))}
      </ul>

      {overTier && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          You exceed the current pricing/royalty tier target by{" "}
          <b>{fmtMin(totalReadingMinutes - tierBudgetMinutes)}</b>. Consider shortening sections or
          adjusting the tier.
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   SLIDER (Pointer Events; keyboard accessible)
   ========================================================================== */

function ReadingSlider({
  readingMinutes,
  min,
  max,
  step = 5,
  disabled,
  onChange,
}: {
  readingMinutes: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (m: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pct = useMemo(() => {
    const span = Math.max(1, max - min);
    return Math.max(0, Math.min(100, ((readingMinutes - min) / span) * 100));
  }, [readingMinutes, min, max]);

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
        const next = clampInt(roundToStep(readingMinutes + delta, step), min, max);
        onChangeRef.current(next);
        e.preventDefault();
      }
    },
    [disabled, max, min, readingMinutes, step]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const el = railRef.current;
      if (!el) return;
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
        aria-label="Reading time (minutes)"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={readingMinutes}
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
          className="input !w-28 !py-1"
          value={readingMinutes}
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

export type EbookEditorFromJSONProps = {
  /** JSON string/object from the previous stage. */
  source: string | EbookInputJSON;
  /** Receive normalized JSON whenever the user changes metadata/sections. */
  onChangeJSON?: (json: EbookInputJSON) => void;
  /** Show parse diagnostics (default true). */
  showDiagnostics?: boolean;
  className?: string;
};

export function EbookEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: EbookEditorFromJSONProps) {
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    metadata: EbookMetadata;
    sections: EbookSection[];
    config: { tierBudgetMinutes: number; step: number; sectionMaxMinutes: number; readOnly: boolean };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseEbookJSON(source);
    return {
      metadata: res.metadata,
      sections: res.sections,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    };
  });

  useEffect(() => {
    const res = parseEbookJSON(source);
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
    ({ metadata: md, sections: secs, totalReadingMinutes }: EbookEditorValue) => {
      // keep local controlled state
      setState((prev) => ({ ...prev, metadata: md, sections: secs }));
      // emit normalized JSON
      onChangeJSON?.(serializeEbookToJSON(md, secs, config));
      // totalReadingMinutes is available if needed by parent
      void totalReadingMinutes;
    },
    [config, onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse ebook JSON:</b>
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

      <EbookEditor
        value={{ metadata, sections }}
        tierBudgetMinutes={config.tierBudgetMinutes}
        step={config.step}
        sectionMaxMinutes={config.sectionMaxMinutes}
        readOnly={config.readOnly}
        onChange={handleChange}
      />
    </div>
  );
}

/* Default export is the JSON-bridged component for convenience */
export default EbookEditorFromJSON;

/* =============================================================================
   USAGE EXAMPLE

   <EbookEditorFromJSON
     source={{
       tierBudgetMinutes: 420,        // proxy for pricing/royalty constraint
       step: 5,
       sectionMaxMinutes: 240,
       readOnly: false,
       metadata: {
         title: "The Stars Beyond",
         seriesName: "Odyssey Saga",
         author: "A. N. Writer",
         tags: ["sci-fi", "space", "epic"],
         descriptionHTML: "<p>An odyssey among the stars...</p>",
         coverTheme: "bold"
       },
       sections: [
         { id: "fm1", type: "front_matter", label: "Preface", readingMinutes: 6 },
         { id: "b1", type: "body", label: "Ch.1 – Departure", readingMinutes: 60 },
         { id: "b2", type: "body", label: "Ch.2 – Drift", readingMinutes: 70 },
         { id: "sc1", type: "sample_chapter", label: "Sample Chapter", readingMinutes: 12 },
         { id: "ix1", type: "index", label: "Index", readingMinutes: 3 }
       ]
     }}
     onChangeJSON={(json) => {
       // send JSON to your backend / next stage
       console.log("Updated ebook JSON:", json);
     }}
   />
   ========================================================================== */
