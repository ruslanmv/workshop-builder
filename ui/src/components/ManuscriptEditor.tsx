// workshop_builder/ui/src/components/ManuscriptEditor.tsx

// ManuscriptEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   TYPES
   ========================================================================== */

export type BookPartType = "introduction" | "technical" | "case_study" | "appendix";

export type TocNode = {
  id: string;
  type: BookPartType;
  /** Chapter/Section title */
  title: string;
  /** Word count budget for this node */
  words: number;
  /** Outline depth: 0 = top-level (Part/Chapter), 1 = section, 2 = subsection ... */
  depth: number;
};

export type BookMetadata = {
  /** Book level info */
  bookTitle: string;
  subtitle?: string;
  author: string;
  /** Optional extra keywords for search / indexing */
  keywords: string[];
  /** Layout template preference (maps to publisher's LaTeX/Word, etc.) */
  layoutTemplate?: "latex" | "word" | "indesign";
  /** Optional abstract/description (HTML allowed) */
  descriptionHTML?: string;
};

export type BookEditorValue = {
  metadata: BookMetadata;
  toc: TocNode[]; // flat list + depth → nested TOC
  totalWords: number;
};

export type BookInputJSON = {
  /** Total manuscript target (maps from dayBudgetMinutes) */
  manuscriptBudgetWords?: number;
  /** Input step for words (e.g., 100/250/500) */
  step?: number;
  /** Hard cap per chapter/section */
  sectionMaxWords?: number;
  /** Disable editing */
  readOnly?: boolean;

  /** Book metadata */
  metadata?: Partial<BookMetadata>;

  /** TOC nodes */
  toc?: Array<{
    id?: string;
    type: string; // validated to BookPartType at runtime
    title?: string;
    words?: number;
    depth?: number; // default 0
  }>;

  [k: string]: unknown; // ignore unknowns safely
};

type EditorProps = {
  /** Controlled value; if omitted the editor is uncontrolled with defaults. */
  value?: Omit<BookEditorValue, "totalWords">;
  manuscriptBudgetWords?: number;
  onChange?: (v: BookEditorValue) => void;
  readOnly?: boolean;
  step?: number;
  sectionMaxWords?: number;
};

/* =============================================================================
   CONSTANTS / HELPERS
   ========================================================================== */

const MIN_WORDS: Record<BookPartType, number> = {
  introduction: 1000, // "Minimum Chapter Length" mapping
  technical: 5000,
  case_study: 3000,
  appendix: 1000,
};

const DEFAULT_NODE: Record<BookPartType, Omit<TocNode, "id" | "depth">> = {
  introduction: { type: "introduction", title: "Introduction", words: 1500 },
  technical: { type: "technical", title: "Technical Chapter", words: 7000 },
  case_study: { type: "case_study", title: "Case Study", words: 4000 },
  appendix: { type: "appendix", title: "Appendix", words: 1500 },
};

const TYPE_LABEL: Record<BookPartType, string> = {
  introduction: "Introduction",
  technical: "Technical",
  case_study: "Case Study",
  appendix: "Appendix",
};

/** Visual proxy for "Layout & Styling Template" */
const TYPE_STYLE: Record<BookPartType, string> = {
  introduction: "bg-sky-100 text-sky-800",
  technical: "bg-emerald-100 text-emerald-800",
  case_study: "bg-violet-100 text-violet-800",
  appendix: "bg-amber-100 text-amber-800",
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
  // Render k words nicely
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k words`;
  return `${n} words`;
}

/* =============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ========================================================================== */

function asType(x: unknown): BookPartType | null {
  return x === "introduction" || x === "technical" || x === "case_study" || x === "appendix"
    ? x
    : null;
}
function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}
function asDepth(x: unknown): number | null {
  const n = asNumber(x);
  if (n === null) return null;
  // Clamp allowed outline depth 0..3
  return clampInt(n, 0, 3);
}
function splitKeywords(s: string | string[] | undefined): string[] {
  if (Array.isArray(s)) return s.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof s === "string") {
    return s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

type ParseResult = {
  config: {
    manuscriptBudgetWords: number;
    step: number;
    sectionMaxWords: number;
    readOnly: boolean;
  };
  metadata: BookMetadata;
  toc: TocNode[];
  warnings: string[];
  errors: string[];
};

export function parseBookJSON(
  src: string | BookInputJSON,
  defaults: { manuscriptBudgetWords?: number; step?: number; sectionMaxWords?: number; readOnly?: boolean } = {}
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

  const manuscriptBudgetWords =
    asNumber(obj.manuscriptBudgetWords) ?? defaults.manuscriptBudgetWords ?? 80000;
  const step = Math.max(1, asNumber(obj.step) ?? defaults.step ?? 500);
  const sectionMaxWords = Math.max(500, asNumber(obj.sectionMaxWords) ?? defaults.sectionMaxWords ?? 40000);
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  // Metadata
  const md = obj.metadata ?? {};
  const metadata: BookMetadata = {
    bookTitle: asString(md.bookTitle) ?? "Untitled Manuscript",
    subtitle: asString(md.subtitle) ?? undefined,
    author: asString(md.author) ?? "Unknown Author",
    keywords: splitKeywords(md.keywords),
    layoutTemplate:
      (asString(md.layoutTemplate) as BookMetadata["layoutTemplate"]) ?? "latex",
    descriptionHTML: asString(md.descriptionHTML) ?? undefined,
  };

  // TOC
  let rawToc: any[] = Array.isArray(obj.toc) ? obj.toc : [];
  if (rawToc.length === 0) {
    warnings.push("No TOC provided. Using defaults (Introduction, Technical Chapter, Case Study, Appendix).");
    rawToc = [
      { type: "introduction", title: DEFAULT_NODE.introduction.title, words: DEFAULT_NODE.introduction.words, depth: 0 },
      { type: "technical", title: "Chapter 1 – Foundations", words: 8000, depth: 0 },
      { type: "case_study", title: "Case Study – Acme", words: 4500, depth: 0 },
      { type: "appendix", title: DEFAULT_NODE.appendix.title, words: DEFAULT_NODE.appendix.words, depth: 0 },
    ];
  }

  const toc: TocNode[] = [];
  rawToc.forEach((node, i) => {
    const t = asType(node.type);
    if (!t) {
      warnings.push(`TOC item ${i}: invalid "type" (${String(node.type)}). Skipped.`);
      return;
    }
    const title = asString(node.title) ?? TYPE_LABEL[t];
    let words = asNumber(node.words);
    if (words === null) {
      warnings.push(`TOC item ${i}: missing/invalid "words". Using default for ${t}.`);
      words = DEFAULT_NODE[t].words;
    }
    const id = asString(node.id) ?? uid();
    const rawDepth = asDepth(node.depth);
    const depth = rawDepth === null ? 0 : rawDepth;

    const minForType = MIN_WORDS[t];
    const normalized = clampInt(roundToStep(words, step), minForType, sectionMaxWords);
    if (normalized !== words) {
      warnings.push(
        `TOC item ${i}: words (${words}) normalized to ${normalized} (min ${minForType}, max ${sectionMaxWords}, step ${step}).`
      );
    }
    toc.push({ id, type: t, title, words: normalized, depth });
  });

  // Optional post-step: ensure no item is deeper than previous+1 (simple outline validity)
  for (let i = 0; i < toc.length; i++) {
    const prevDepth = i === 0 ? 0 : toc[i - 1].depth;
    if (toc[i].depth > prevDepth + 1) {
      warnings.push(`TOC item ${i}: depth ${toc[i].depth} reduced to ${prevDepth + 1} to keep a valid outline.`);
      toc[i].depth = prevDepth + 1;
    }
  }

  return {
    config: { manuscriptBudgetWords, step, sectionMaxWords, readOnly },
    metadata,
    toc,
    warnings,
    errors,
  };
}

export function serializeBookToJSON(
  metadata: BookMetadata,
  toc: TocNode[],
  config: { manuscriptBudgetWords: number; step: number; sectionMaxWords: number; readOnly: boolean }
): BookInputJSON {
  return {
    manuscriptBudgetWords: config.manuscriptBudgetWords,
    step: config.step,
    sectionMaxWords: config.sectionMaxWords,
    readOnly: config.readOnly,
    metadata: {
      bookTitle: metadata.bookTitle,
      subtitle: metadata.subtitle,
      author: metadata.author,
      keywords: metadata.keywords,
      layoutTemplate: metadata.layoutTemplate,
      descriptionHTML: metadata.descriptionHTML,
    },
    toc: toc.map((n: TocNode) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      words: n.words,
      depth: n.depth,
    })),
  };
}

/* =============================================================================
   CORE EDITOR (production-safe; avoids feedback loops; pointer events)
   ========================================================================== */

export function BookEditor({
  value,
  manuscriptBudgetWords = 80000,
  onChange,
  readOnly = false,
  step = 500,
  sectionMaxWords = 40000,
}: EditorProps) {
  const isControlled = value !== undefined;

  const [internalMetadata, setInternalMetadata] = useState<BookMetadata>({
    bookTitle: "Untitled Manuscript",
    subtitle: "",
    author: "Unknown Author",
    keywords: [],
    layoutTemplate: "latex",
    descriptionHTML: "",
  });

  const [internalToc, setInternalToc] = useState<TocNode[]>(() => [
    { id: uid(), ...DEFAULT_NODE.introduction, depth: 0 },
    { id: uid(), ...DEFAULT_NODE.technical, title: "Chapter 1 – Example", depth: 0 },
    { id: uid(), ...DEFAULT_NODE.appendix, depth: 0 },
  ]);

  // Strongly type controlled value access to avoid implicit any
  const controlled = value as Omit<BookEditorValue, "totalWords"> | undefined;
  const metadata: BookMetadata = isControlled ? controlled!.metadata : internalMetadata;
  const toc: TocNode[] = isControlled ? controlled!.toc : internalToc;

  const totalWords = useMemo(
    () =>
      toc.reduce<number>(
        (acc: number, n: TocNode) => acc + (Number.isFinite(n.words) ? n.words : 0),
        0
      ),
    [toc]
  );

  const commit = useCallback(
    (nextMeta: BookMetadata, nextToc: TocNode[]) => {
      if (!isControlled) {
        setInternalMetadata(nextMeta);
        setInternalToc(nextToc);
      }
      const nextTotal = nextToc.reduce<number>(
        (acc: number, n: TocNode) => acc + (Number.isFinite(n.words) ? n.words : 0),
        0
      );
      onChange?.({
        metadata: nextMeta,
        toc: nextToc,
        totalWords: nextTotal,
      });
    },
    [isControlled, onChange]
  );

  const pct = Math.min(100, Math.round((totalWords / Math.max(1, manuscriptBudgetWords)) * 100));
  const overBudget = totalWords > manuscriptBudgetWords;

  const addNode = (type: BookPartType, depth = 0) => {
    if (readOnly) return;
    const next = [...toc, { id: uid(), ...DEFAULT_NODE[type], depth }];
    commit(metadata, next);
  };

  const duplicateNode = (id: string) => {
    if (readOnly) return;
    const idx = toc.findIndex((n: TocNode) => n.id === id);
    if (idx < 0) return;
    const original = toc[idx];
    const copy: TocNode = { ...original, id: uid(), title: `${original.title} (copy)` };
    const out = toc.slice();
    out.splice(idx + 1, 0, copy);
    commit(metadata, out);
  };

  const removeNode = (id: string) => {
    if (readOnly) return;
    commit(metadata, toc.filter((n: TocNode) => n.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = toc.findIndex((n: TocNode) => n.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= toc.length) return;
    const copy = toc.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    // Keep outline sanity: cannot be deeper than previous+1
    const prevDepth = j === 0 ? 0 : copy[j - 1].depth;
    if (item.depth > prevDepth + 1) (item as TocNode).depth = prevDepth + 1;
    commit(metadata, copy);
  };

  const indent = (id: string) => {
    if (readOnly) return;
    const idx = toc.findIndex((n: TocNode) => n.id === id);
    if (idx < 0) return;
    const out = toc.slice();
    const prevDepth = idx === 0 ? 0 : out[idx - 1].depth;
    out[idx] = { ...out[idx], depth: clampInt(out[idx].depth + 1, 0, Math.min(3, prevDepth + 1)) };
    commit(metadata, out);
  };

  const outdent = (id: string) => {
    if (readOnly) return;
    const idx = toc.findIndex((n: TocNode) => n.id === id);
    if (idx < 0) return;
    const out = toc.slice();
    out[idx] = { ...out[idx], depth: clampInt(out[idx].depth - 1, 0, 3) };
    commit(metadata, out);
  };

  const updateNode = (id: string, patch: Partial<TocNode>) => {
    if (readOnly) return;
    const out = toc.map((n: TocNode) => {
      if (n.id !== id) return n;
      const nextType = (patch.type ?? n.type) as BookPartType;
      const minForType = MIN_WORDS[nextType];
      const nextWords =
        patch.words !== undefined
          ? clampInt(roundToStep(patch.words, step), minForType, sectionMaxWords)
          : n.words;
      const nextDepth = patch.depth !== undefined ? clampInt(patch.depth, 0, 3) : n.depth;
      return {
        ...n,
        ...patch,
        type: nextType,
        words: nextWords,
        depth: nextDepth,
      };
    });
    // Fix outline sanity: ensure no node is deeper than previous+1
    for (let i = 0; i < out.length; i++) {
      const prevDepth = i === 0 ? 0 : out[i - 1].depth;
      if (out[i].depth > prevDepth + 1) out[i].depth = prevDepth + 1;
    }
    commit(metadata, out);
  };

  const updateMetadata = <K extends keyof BookMetadata>(key: K, val: BookMetadata[K]) => {
    if (readOnly) return;
    const nextMeta = { ...metadata, [key]: val };
    commit(nextMeta, toc);
  };

  return (
    <div className="card">
      {/* Top Summary */}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold">Book Editor</h3>
        <div className="text-sm text-gray-700">
          Manuscript target: <b>{fmtWords(manuscriptBudgetWords)}</b> • Total: <b>{fmtWords(totalWords)}</b>{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overBudget ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {pct}% of target
          </span>
        </div>
      </div>

      <div className="mb-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overBudget ? "bg-red-500" : "bg-gray-800"}`}
          style={{ width: `${Math.min(100, (totalWords / Math.max(1, manuscriptBudgetWords)) * 100)}%` }}
        />
      </div>

      {/* Metadata Panel */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Book Metadata</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Title</span>
            <input
              className="input"
              value={metadata.bookTitle}
              onChange={(e) => updateMetadata("bookTitle", e.target.value)}
              disabled={readOnly}
              placeholder="Book Title"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Subtitle (optional)</span>
            <input
              className="input"
              value={metadata.subtitle ?? ""}
              onChange={(e) => updateMetadata("subtitle", e.target.value)}
              disabled={readOnly}
              placeholder="Subtitle"
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
              placeholder="publishing, writing, guide"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Layout Template</span>
            <select
              className="input"
              value={metadata.layoutTemplate ?? "latex"}
              onChange={(e) => updateMetadata("layoutTemplate", e.target.value as BookMetadata["layoutTemplate"])}
              disabled={readOnly}
            >
              <option value="latex">LaTeX</option>
              <option value="word">Word</option>
              <option value="indesign">InDesign</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Abstract / Description (HTML allowed)</span>
            <textarea
              className="input min-h-[100px]"
              value={metadata.descriptionHTML ?? ""}
              onChange={(e) => updateMetadata("descriptionHTML", e.target.value)}
              disabled={readOnly}
              placeholder="<p>This book explores...</p>"
            />
          </label>
        </div>
      </div>

      {/* Add Items */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addNode("introduction", 0)}>
            + Add Introduction
          </button>
          <button className="btn" onClick={() => addNode("technical", 0)}>
            + Add Technical Chapter
          </button>
          <button className="btn" onClick={() => addNode("case_study", 0)}>
            + Add Case Study
          </button>
          <button className="btn-secondary" onClick={() => addNode("appendix", 0)}>
            + Add Appendix
          </button>
        </div>
      )}

      {/* TOC List */}
      <ul className="space-y-3">
        {toc.map((n: TocNode, idx: number) => (
          <li key={n.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[n.type]}`}>
                    {TYPE_LABEL[n.type]}
                  </span>
                  <span className="text-xs text-gray-500">depth {n.depth}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Indentation visual */}
                  <div style={{ width: n.depth * 16 }} aria-hidden="true" />
                  <input
                    className="input !py-1 text-sm flex-1"
                    value={n.title}
                    onChange={(e) => updateNode(n.id, { title: e.target.value })}
                    disabled={readOnly}
                    placeholder={`${TYPE_LABEL[n.type]} title`}
                  />
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-sm text-gray-500">{fmtWords(n.words)}</span>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <button
                      className="btn-secondary"
                      onClick={() => move(n.id, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => move(n.id, +1)}
                      disabled={idx === toc.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => indent(n.id)}
                      title="Indent (nest)"
                      aria-label="Indent"
                    >
                      ⇥
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => outdent(n.id)}
                      title="Outdent"
                      aria-label="Outdent"
                    >
                      ⇤
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => duplicateNode(n.id)}
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => removeNode(n.id)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Words control */}
            <WordsSlider
              words={n.words}
              min={MIN_WORDS[n.type]}
              max={sectionMaxWords}
              step={step}
              onChange={(w) => updateNode(n.id, { words: w })}
              disabled={readOnly}
            />
          </li>
        ))}
      </ul>

      {overBudget && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          You exceed the manuscript length target by <b>{fmtWords(totalWords - manuscriptBudgetWords)}</b>.
          Consider shortening chapters/sections or adjusting the target.
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
  step = 500,
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

export type BookEditorFromJSONProps = {
  /** JSON string/object from the previous stage. */
  source: string | BookInputJSON;
  /** Receive normalized JSON whenever the user changes metadata/TOC. */
  onChangeJSON?: (json: BookInputJSON) => void;
  /** Show parse diagnostics (default true). */
  showDiagnostics?: boolean;
  className?: string;
};

export function BookEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: BookEditorFromJSONProps) {
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    metadata: BookMetadata;
    toc: TocNode[];
    config: { manuscriptBudgetWords: number; step: number; sectionMaxWords: number; readOnly: boolean };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseBookJSON(source);
    return {
      metadata: res.metadata,
      toc: res.toc,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    };
  });

  useEffect(() => {
    const res = parseBookJSON(source);
    setState({
      metadata: res.metadata,
      toc: res.toc,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    });
  }, [sourceFingerprint]);

  const { metadata, toc, config, warnings, errors } = state;

  const handleChange = useCallback(
    ({ metadata: md, toc: outline }: BookEditorValue) => {
      setState((prev) => ({ ...prev, metadata: md, toc: outline }));
      onChangeJSON?.(serializeBookToJSON(md, outline, config));
    },
    [config, onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse book JSON:</b>
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

      <BookEditor
        value={{ metadata, toc }}
        manuscriptBudgetWords={config.manuscriptBudgetWords}
        step={config.step}
        sectionMaxWords={config.sectionMaxWords}
        readOnly={config.readOnly}
        onChange={handleChange}
      />
    </div>
  );
}

/** Default export: JSON-bridged component for convenience */
export default BookEditorFromJSON;

/* =============================================================================
   USAGE EXAMPLE

   <BookEditorFromJSON
     source={{
       manuscriptBudgetWords: 90000,
       step: 500,
       sectionMaxWords: 25000,
       readOnly: false,
       metadata: {
         bookTitle: "Designing Reliable Systems",
         subtitle: "A Practical Guide",
         author: "J. Doe",
         keywords: ["systems", "design", "reliability"],
         layoutTemplate: "latex",
         descriptionHTML: "<p>This book covers...</p>"
       },
       toc: [
         { id: "i1", type: "introduction", title: "Preface", words: 1500, depth: 0 },
         { id: "t1", type: "technical", title: "Chapter 1 — Basics", words: 8000, depth: 0 },
         { id: "t1a", type: "technical", title: "Background", words: 3000, depth: 1 },
         { id: "c1", type: "case_study", title: "Case Study — Acme Corp", words: 5000, depth: 0 },
         { id: "a1", type: "appendix", title: "Appendix A — Data", words: 2000, depth: 0 }
       ]
     }}
     onChangeJSON={(json) => {
       // Send JSON to your backend / next stage
       console.log("Updated book JSON:", json);
     }}
   />
   ========================================================================== */
