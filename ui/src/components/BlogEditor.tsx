// workshop_builder/ui/src/components/BlogEditor.tsx

// BlogEditor.tsx
// Markdown Blog Post (Code & Images Focused) — JSON-bridged editor
// - Accepts a JSON string/object from the previous stage
// - Parses & sanitizes -> populates the editor
// - Lets a human edit (metadata, chunks: text/code/image/callout, code theme/line numbers, image alignment)
// - Emits a normalized JSON on every edit for the next stage

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   TYPES
   ========================================================================== */

export type BlogChunkType = "text" | "code" | "image" | "callout";

export type TextChunk = {
  id: string;
  type: "text";
  markdown: string;
};

export type CodeChunk = {
  id: string;
  type: "code";
  language: string; // e.g., "ts", "tsx", "js", "py", "bash"
  code: string;
  showLineNumbers?: boolean; // per-chunk override (optional)
};

export type ImageAlignment = "left" | "center" | "right";
export type ImageChunk = {
  id: string;
  type: "image";
  alt: string;
  caption?: string;
  src?: string; // optional path/URL
  fileSizeKB: number; // used against image budget
  fullWidth?: boolean; // if true, ignore alignment
  alignment: ImageAlignment; // visual flow control
};

export type CalloutVariant = "note" | "tip" | "warning" | "danger";
export type CalloutChunk = {
  id: string;
  type: "callout";
  variant: CalloutVariant;
  title?: string;
  markdown: string;
};

export type BlogChunk = TextChunk | CodeChunk | ImageChunk | CalloutChunk;

export type BlogMetadata = {
  title: string;
  slug: string;
  description?: string;
  tags: string[];
  categories: string[];
  author: string;
  dateISO: string; // YYYY-MM-DD or ISO datetime
};

export type CodeSettings = {
  theme: "github" | "dracula" | "one-dark" | "solarized-light" | "solarized-dark";
  lineNumbers: boolean; // global default (chunk may override)
};

export type ReadingSpeed = {
  textWPM: number; // e.g., 220
  codeWPM: number; // e.g., 80 (code is slower)
  imageLookSeconds: number; // time spent per image
};

export type BlogEditorValue = {
  metadata: BlogMetadata;
  settings: {
    imageBudgetKB: number; // "dayBudgetMinutes" mapping
    minWords: number; // "MIN_MINUTES" mapping
    code: CodeSettings;
    reading: ReadingSpeed;
  };
  chunks: BlogChunk[];
  totals: {
    words: number; // textual words (text + callout)
    imagesKB: number; // sum fileSizeKB
    estMinutes: number; // computed reading time
  };
};

/** Incoming JSON (from previous stage) */
export type BlogInputJSON = {
  imageBudgetKB?: number;
  minWords?: number;
  readOnly?: boolean;

  code?: Partial<CodeSettings>;
  reading?: Partial<ReadingSpeed>;

  metadata?: Partial<BlogMetadata>;

  chunks?: Array<
    | {
        id?: string;
        type: "text";
        markdown?: string;
      }
    | {
        id?: string;
        type: "code";
        language?: string;
        code?: string;
        showLineNumbers?: boolean;
      }
    | {
        id?: string;
        type: "image";
        alt?: string;
        caption?: string;
        src?: string;
        fileSizeKB?: number;
        fullWidth?: boolean;
        alignment?: ImageAlignment;
      }
    | {
        id?: string;
        type: "callout";
        variant?: CalloutVariant;
        title?: string;
        markdown?: string;
      }
  >;

  [k: string]: unknown;
};

type EditorProps = {
  /** Controlled value; if omitted the editor is uncontrolled with defaults. */
  value?: Omit<BlogEditorValue, "totals">;
  onChange?: (v: BlogEditorValue) => void;
  readOnly?: boolean;
};

/* =============================================================================
   CONSTANTS / HELPERS (Mappings from the workshop table)
   ========================================================================== */

const DEFAULT_READING: ReadingSpeed = {
  textWPM: 220,
  codeWPM: 80,
  imageLookSeconds: 12,
};

const DEFAULT_CODE: CodeSettings = {
  theme: "github",
  lineNumbers: true,
};

const DEFAULT_METADATA: BlogMetadata = {
  title: "Untitled Post",
  slug: "untitled-post",
  description: "",
  tags: [],
  categories: [],
  author: "Author",
  dateISO: new Date().toISOString().slice(0, 10),
};

const DEFAULT_TEXT: Omit<TextChunk, "id"> = {
  type: "text",
  markdown: "Write your introduction here...",
};

const DEFAULT_CODE_CHUNK: Omit<CodeChunk, "id"> = {
  type: "code",
  language: "ts",
  code: `// example code snippet\nexport function hello(name: string){\n  return \`Hello, \${name}!\`;\n}`,
  showLineNumbers: undefined,
};

const DEFAULT_IMAGE: Omit<ImageChunk, "id"> = {
  type: "image",
  alt: "Descriptive alt text",
  caption: "Figure: helpful caption",
  src: "",
  fileSizeKB: 250,
  fullWidth: false,
  alignment: "center",
};

const DEFAULT_CALLOUT: Omit<CalloutChunk, "id"> = {
  type: "callout",
  variant: "tip",
  title: "Pro tip",
  markdown: "Keep your functions pure and your components small.",
};

// Badge-like styles per chunk type (maps "KIND_BADGE → Code customization visuals")
const TYPE_STYLE: Record<BlogChunkType, string> = {
  text: "bg-emerald-100 text-emerald-800",
  code: "bg-indigo-100 text-indigo-800",
  image: "bg-amber-100 text-amber-800",
  callout: "bg-sky-100 text-sky-800",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function splitCSV(x: string | string[] | undefined): string[] {
  if (Array.isArray(x)) return x.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof x === "string")
    return x
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function countWordsFromMarkdown(md: string): number {
  // Crude but robust: strip code fences/inline code, images/links and count tokens
  const withoutCode = md
    .replace(/`{3}[\s\S]*?`{3}/g, " ") // fenced
    .replace(/`[^`]*`/g, " "); // inline
  const withoutLinks = withoutCode.replace(/!\[[^\]]*]\([^)]+\)|\[[^\]]*]\([^)]+\)/g, " ");
  const tokens = withoutLinks.match(/\b[\p{L}\p{N}'-]+\b/gu);
  return tokens ? tokens.length : 0;
}

function codeLines(code: string): number {
  return code ? code.split("\n").length : 0;
}

function estimateReadingMinutes(
  chunks: BlogChunk[],
  reading: ReadingSpeed
): { minutes: number; words: number; imagesKB: number } {
  let textWords = 0; // text + callout words (for SEO minimum)
  let minutes = 0;

  for (const c of chunks) {
    if (c.type === "text") {
      const w = countWordsFromMarkdown(c.markdown);
      textWords += w;
      minutes += w / Math.max(60, reading.textWPM); // guard wpm lower bound
    } else if (c.type === "callout") {
      const w = countWordsFromMarkdown(c.markdown);
      textWords += w;
      // Callouts are skimmed faster (~0.9 weight of normal text)
      minutes += (w * 0.9) / Math.max(60, reading.textWPM);
    } else if (c.type === "code") {
      const lines = codeLines(c.code);
      const wordEq = lines * 5; // approx 5 "word equivalents" per line of code
      minutes += wordEq / Math.max(40, reading.codeWPM);
    } else if (c.type === "image") {
      minutes += Math.max(3, reading.imageLookSeconds) / 60;
    }
  }

  const imagesKB = chunks
    .filter((c): c is ImageChunk => c.type === "image")
    .reduce((acc, img) => acc + (Number.isFinite(img.fileSizeKB) ? img.fileSizeKB : 0), 0);

  return { minutes: Math.ceil(minutes || 1), words: textWords, imagesKB };
}

/* =============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ========================================================================== */

type ParseResult = {
  config: {
    imageBudgetKB: number;
    minWords: number;
    readOnly: boolean;
    reading: ReadingSpeed;
    code: CodeSettings;
  };
  metadata: BlogMetadata;
  chunks: BlogChunk[];
  totals: { estMinutes: number; words: number; imagesKB: number };
  warnings: string[];
  errors: string[];
};

function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}
function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function isDateLike(x: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(x) || !Number.isNaN(Date.parse(x));
}
function asChunkType(x: unknown): BlogChunkType | null {
  return x === "text" || x === "code" || x === "image" || x === "callout" ? x : null;
}
function asAlignment(x: unknown): ImageAlignment | null {
  return x === "left" || x === "center" || x === "right" ? x : null;
}
function asCalloutVariant(x: unknown): CalloutVariant | null {
  return x === "note" || x === "tip" || x === "warning" || x === "danger" ? x : null;
}
function asTheme(x: unknown): CodeSettings["theme"] | null {
  return x === "github" ||
    x === "dracula" ||
    x === "one-dark" ||
    x === "solarized-light" ||
    x === "solarized-dark"
    ? x
    : null;
}

export function parseBlogJSON(
  src: string | BlogInputJSON,
  defaults: { imageBudgetKB?: number; minWords?: number; readOnly?: boolean } = {}
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

  const imageBudgetKB = asNumber(obj.imageBudgetKB) ?? defaults.imageBudgetKB ?? 1500;
  const minWords = asNumber(obj.minWords) ?? defaults.minWords ?? 500;
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  const cset = obj.code ?? {};
  const code: CodeSettings = {
    theme: asTheme(cset.theme) ?? DEFAULT_CODE.theme,
    lineNumbers:
      typeof cset.lineNumbers === "boolean" ? cset.lineNumbers : DEFAULT_CODE.lineNumbers,
  };

  const rset = obj.reading ?? {};
  const reading: ReadingSpeed = {
    textWPM: asNumber(rset.textWPM) ?? DEFAULT_READING.textWPM,
    codeWPM: asNumber(rset.codeWPM) ?? DEFAULT_READING.codeWPM,
    imageLookSeconds: asNumber(rset.imageLookSeconds) ?? DEFAULT_READING.imageLookSeconds,
  };

  const md = obj.metadata ?? {};
  const metaTitle = asString(md.title) ?? DEFAULT_METADATA.title;
  const metaSlugRaw = asString(md.slug) ?? slugify(metaTitle);
  const metadata: BlogMetadata = {
    title: metaTitle,
    slug: slugify(metaSlugRaw || metaTitle),
    description: asString(md.description) ?? "",
    tags: splitCSV(md.tags),
    categories: splitCSV(md.categories),
    author: asString(md.author) ?? DEFAULT_METADATA.author,
    dateISO: asString(md.dateISO) && isDateLike(md.dateISO) ? md.dateISO : DEFAULT_METADATA.dateISO,
  };

  // Chunks
  const rawChunks: any[] = Array.isArray(obj.chunks) ? obj.chunks : [];
  const chunks: BlogChunk[] = [];

  if (rawChunks.length === 0) {
    warnings.push("No chunks provided. Using default Text + Code + Image.");
    chunks.push(
      { id: uid(), ...DEFAULT_TEXT },
      { id: uid(), ...DEFAULT_CODE_CHUNK },
      { id: uid(), ...DEFAULT_IMAGE }
    );
  } else {
    rawChunks.forEach((rc, i) => {
      const t = asChunkType(rc.type);
      if (!t) {
        warnings.push(`Chunk ${i}: invalid "type" (${String(rc.type)}). Skipped.`);
        return;
      }
      const id = asString(rc.id) ?? uid();

      if (t === "text") {
        const markdown = asString(rc.markdown) ?? DEFAULT_TEXT.markdown;
        chunks.push({ id, type: "text", markdown });
      } else if (t === "code") {
        const language = asString(rc.language) ?? DEFAULT_CODE_CHUNK.language;
        const codeStr = asString(rc.code) ?? DEFAULT_CODE_CHUNK.code;
        const showLineNumbers =
          typeof rc.showLineNumbers === "boolean" ? rc.showLineNumbers : undefined;
        chunks.push({ id, type: "code", language, code: codeStr, showLineNumbers });
      } else if (t === "image") {
        const alt = asString(rc.alt) ?? DEFAULT_IMAGE.alt;
        const caption = asString(rc.caption) ?? DEFAULT_IMAGE.caption;
        const src = asString(rc.src) ?? DEFAULT_IMAGE.src;
        const fileSizeKB = asNumber(rc.fileSizeKB) ?? DEFAULT_IMAGE.fileSizeKB;
        const fullWidth = !!rc.fullWidth;
        const alignment = asAlignment(rc.alignment) ?? DEFAULT_IMAGE.alignment;
        chunks.push({
          id,
          type: "image",
          alt,
          caption,
          src,
          fileSizeKB: clampInt(fileSizeKB, 1, 1024 * 1024),
          fullWidth,
          alignment,
        });
      } else if (t === "callout") {
        const variant = asCalloutVariant(rc.variant) ?? DEFAULT_CALLOUT.variant;
        const title = asString(rc.title) ?? DEFAULT_CALLOUT.title;
        const markdown = asString(rc.markdown) ?? DEFAULT_CALLOUT.markdown;
        chunks.push({ id, type: "callout", variant, title, markdown });
      }
    });
  }

  const totalsTmp = estimateReadingMinutes(chunks, reading);

  return {
    config: {
      imageBudgetKB,
      minWords,
      readOnly,
      reading,
      code,
    },
    metadata,
    chunks,
    totals: {
      estMinutes: totalsTmp.minutes,
      words: totalsTmp.words,
      imagesKB: totalsTmp.imagesKB,
    },
    warnings,
    errors,
  };
}

export function serializeBlogToJSON(
  metadata: BlogMetadata,
  settings: { imageBudgetKB: number; minWords: number; code: CodeSettings; reading: ReadingSpeed },
  chunks: BlogChunk[]
): BlogInputJSON {
  return {
    imageBudgetKB: settings.imageBudgetKB,
    minWords: settings.minWords,
    code: {
      theme: settings.code.theme,
      lineNumbers: settings.code.lineNumbers,
    },
    reading: {
      textWPM: settings.reading.textWPM,
      codeWPM: settings.reading.codeWPM,
      imageLookSeconds: settings.reading.imageLookSeconds,
    },
    metadata: {
      title: metadata.title,
      slug: metadata.slug,
      description: metadata.description,
      tags: metadata.tags,
      categories: metadata.categories,
      author: metadata.author,
      dateISO: metadata.dateISO,
    },
    chunks: chunks.map((c) => {
      switch (c.type) {
        case "text":
          return { id: c.id, type: c.type, markdown: c.markdown };
        case "code":
          return {
            id: c.id,
            type: c.type,
            language: c.language,
            code: c.code,
            showLineNumbers: c.showLineNumbers,
          };
        case "image":
          return {
            id: c.id,
            type: c.type,
            alt: c.alt,
            caption: c.caption,
            src: c.src,
            fileSizeKB: c.fileSizeKB,
            fullWidth: !!c.fullWidth,
            alignment: c.alignment,
          };
        case "callout":
          return {
            id: c.id,
            type: c.type,
            variant: c.variant,
            title: c.title,
            markdown: c.markdown,
          };
      }
    }),
  };
}

/* =============================================================================
   CORE EDITOR (production-safe; avoids feedback loops; pointer events)
   ========================================================================== */

export function BlogEditor({
  value,
  onChange,
  readOnly = false,
}: EditorProps) {
  const isControlled = value !== undefined;

  const [internalMetadata, setInternalMetadata] = useState<BlogMetadata>({ ...DEFAULT_METADATA });
  const [internalSettings, setInternalSettings] = useState<{
    imageBudgetKB: number;
    minWords: number;
    code: CodeSettings;
    reading: ReadingSpeed;
  }>({
    imageBudgetKB: 1500,
    minWords: 500,
    code: { ...DEFAULT_CODE },
    reading: { ...DEFAULT_READING },
  });
  const [internalChunks, setInternalChunks] = useState<BlogChunk[]>(() => [
    { id: uid(), ...DEFAULT_TEXT },
    { id: uid(), ...DEFAULT_CODE_CHUNK },
    { id: uid(), ...DEFAULT_IMAGE },
  ]);

  // Keep strong types for controlled vs uncontrolled
  const controlled = value as Omit<BlogEditorValue, "totals"> | undefined;
  const metadata: BlogMetadata = isControlled ? controlled!.metadata : internalMetadata;
  const settings: {
    imageBudgetKB: number;
    minWords: number;
    code: CodeSettings;
    reading: ReadingSpeed;
  } = isControlled ? controlled!.settings : internalSettings;
  const chunks: BlogChunk[] = isControlled ? controlled!.chunks : internalChunks;

  const totals = useMemo(() => {
    const { minutes, words, imagesKB } = estimateReadingMinutes(chunks, settings.reading);
    return { estMinutes: minutes, words, imagesKB };
  }, [chunks, settings.reading]);

  const commit = useCallback(
    (nextMeta: BlogMetadata, nextSettings: typeof settings, nextChunks: BlogChunk[]) => {
      if (!isControlled) {
        setInternalMetadata(nextMeta);
        setInternalSettings(nextSettings);
        setInternalChunks(nextChunks);
      }
      const { minutes, words, imagesKB } = estimateReadingMinutes(
        nextChunks,
        nextSettings.reading
      );
      onChange?.({
        metadata: nextMeta,
        settings: nextSettings,
        chunks: nextChunks,
        totals: { estMinutes: minutes, words, imagesKB },
      });
    },
    [isControlled, onChange]
  );

  const overImageBudget = totals.imagesKB > settings.imageBudgetKB;
  const underMinWords = totals.words < settings.minWords;

  const addChunk = (type: BlogChunkType) => {
    if (readOnly) return;
    let chunk: BlogChunk;
    if (type === "text") chunk = { id: uid(), ...DEFAULT_TEXT };
    else if (type === "code") chunk = { id: uid(), ...DEFAULT_CODE_CHUNK };
    else if (type === "image") chunk = { id: uid(), ...DEFAULT_IMAGE };
    else chunk = { id: uid(), ...DEFAULT_CALLOUT };
    commit(metadata, settings, [...chunks, chunk]);
  };

  const duplicateChunk = (id: string) => {
    if (readOnly) return;
    const idx = chunks.findIndex((c: BlogChunk) => c.id === id);
    if (idx < 0) return;
    const original = chunks[idx];
    const copy: BlogChunk = JSON.parse(JSON.stringify({ ...original, id: uid() }));
    commit(metadata, settings, [...chunks.slice(0, idx + 1), copy, ...chunks.slice(idx + 1)]);
  };

  const removeChunk = (id: string) => {
    if (readOnly) return;
    commit(metadata, settings, chunks.filter((c: BlogChunk) => c.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = chunks.findIndex((c: BlogChunk) => c.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= chunks.length) return;
    const copy = chunks.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    commit(metadata, settings, copy);
  };

  const updateChunk = (id: string, patch: Partial<BlogChunk>) => {
    if (readOnly) return;
    const next = chunks.map((c: BlogChunk) => {
      if (c.id !== id) return c;
      // Merge patch while preserving discriminated union
      if (
        c.type === "text" &&
        patch &&
        (patch as any).type !== "code" &&
        (patch as any).type !== "image" &&
        (patch as any).type !== "callout"
      ) {
        return { ...c, ...(patch as Partial<TextChunk>) };
      }
      if (c.type === "code") {
        const merged = { ...c, ...(patch as Partial<CodeChunk>) };
        // normalize lineNumbers to undefined if equal to global (optional)
        return merged;
      }
      if (c.type === "image") {
        const p = patch as Partial<ImageChunk>;
        const fileSizeKB =
          p.fileSizeKB !== undefined ? clampInt(p.fileSizeKB, 1, 1024 * 1024) : c.fileSizeKB;
        const fullWidth = p.fullWidth !== undefined ? !!p.fullWidth : c.fullWidth;
        const alignment = p.alignment ?? c.alignment;
        return { ...c, ...p, fileSizeKB, fullWidth, alignment };
      }
      if (c.type === "callout") {
        return { ...c, ...(patch as Partial<CalloutChunk>) };
      }
      return c;
    });
    commit(metadata, settings, next);
  };

  const updateMetadata = <K extends keyof BlogMetadata>(key: K, val: BlogMetadata[K]) => {
    if (readOnly) return;
    let nextMeta = { ...metadata, [key]: val };
    if (key === "title" && (!metadata.slug || metadata.slug === slugify(metadata.title))) {
      // Auto-update slug when slug follows title
      nextMeta.slug = slugify(String(val));
    }
    commit(nextMeta, settings, chunks);
  };

  const updateSettings = (patch: Partial<typeof settings>) => {
    if (readOnly) return;
    commit(metadata, { ...settings, ...patch }, chunks);
  };

  const updateReading = (patch: Partial<ReadingSpeed>) => {
    updateSettings({ reading: { ...settings.reading, ...patch } });
  };

  const updateCodeSettings = (patch: Partial<CodeSettings>) => {
    updateSettings({ code: { ...settings.code, ...patch } });
  };

  return (
    <div className="card">
      {/* Top Summary */}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold">Blog Editor (Markdown + Code & Images)</h3>
        <div className="text-sm text-gray-700">
          ≈ <b>{totals.estMinutes} min read</b> • Words: <b>{totals.words}</b>{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              underMinWords ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"
            }`}
            title={`Min ${settings.minWords} words for SEO`}
          >
            {Math.round((totals.words / Math.max(1, settings.minWords)) * 100)}% of min
          </span>
          <span className="mx-2">•</span>
          Images: <b>{totals.imagesKB} KB</b> / {settings.imageBudgetKB} KB{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overImageBudget ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {Math.min(
              100,
              Math.round((totals.imagesKB / Math.max(1, settings.imageBudgetKB)) * 100)
            )}
            %
            budget
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Post Metadata</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Title</span>
            <input
              className="input"
              value={metadata.title}
              onChange={(e) => updateMetadata("title", e.target.value)}
              disabled={readOnly}
              placeholder="Great post title"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">SEO Slug</span>
            <input
              className="input"
              value={metadata.slug}
              onChange={(e) => updateMetadata("slug", slugify(e.target.value))}
              disabled={readOnly}
              placeholder="great-post-title"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Author</span>
            <input
              className="input"
              value={metadata.author}
              onChange={(e) => updateMetadata("author", e.target.value)}
              disabled={readOnly}
              placeholder="Your Name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Date</span>
            <input
              className="input"
              value={metadata.dateISO}
              onChange={(e) => updateMetadata("dateISO", e.target.value)}
              disabled={readOnly}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Description (meta)</span>
            <input
              className="input"
              value={metadata.description ?? ""}
              onChange={(e) => updateMetadata("description", e.target.value)}
              disabled={readOnly}
              placeholder="Short summary for SEO and social cards"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Tags (comma separated)</span>
            <input
              className="input"
              value={metadata.tags.join(", ")}
              onChange={(e) => updateMetadata("tags", splitCSV(e.target.value))}
              disabled={readOnly}
              placeholder="react, markdown, tips"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Categories (comma separated)</span>
            <input
              className="input"
              value={metadata.categories.join(", ")}
              onChange={(e) => updateMetadata("categories", splitCSV(e.target.value))}
              disabled={readOnly}
              placeholder="engineering, guides"
            />
          </label>
        </div>
      </div>

      {/* Global Settings */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Global Settings</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Image Budget (KB)</span>
            <input
              type="number"
              className="input"
              value={settings.imageBudgetKB}
              onChange={(e) =>
                updateSettings({
                  imageBudgetKB: clampInt(parseInt(e.target.value || "0", 10), 100, 100000),
                })
              }
              disabled={readOnly}
              min={100}
              step={50}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Minimum Words (SEO)</span>
            <input
              type="number"
              className="input"
              value={settings.minWords}
              onChange={(e) =>
                updateSettings({
                  minWords: clampInt(parseInt(e.target.value || "0", 10), 100, 100000),
                })
              }
              disabled={readOnly}
              min={100}
              step={50}
            />
          </label>
          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-medium text-gray-600">Reading Speeds</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Text WPM</span>
                <input
                  type="number"
                  className="input"
                  value={settings.reading.textWPM}
                  onChange={(e) =>
                    updateReading({
                      textWPM: clampInt(parseInt(e.target.value || "0", 10), 60, 1000),
                    })
                  }
                  disabled={readOnly}
                  min={60}
                  step={10}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Code WPM</span>
                <input
                  type="number"
                  className="input"
                  value={settings.reading.codeWPM}
                  onChange={(e) =>
                    updateReading({
                      codeWPM: clampInt(parseInt(e.target.value || "0", 10), 40, 600),
                    })
                  }
                  disabled={readOnly}
                  min={40}
                  step={10}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Image secs/img</span>
                <input
                  type="number"
                  className="input"
                  value={settings.reading.imageLookSeconds}
                  onChange={(e) =>
                    updateReading({
                      imageLookSeconds: clampInt(parseInt(e.target.value || "0", 10), 3, 120),
                    })
                  }
                  disabled={readOnly}
                  min={3}
                  step={1}
                />
              </label>
            </div>
          </div>
        </div>

        <hr className="my-4" />

        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Code Theme</span>
            <select
              className="input"
              value={settings.code.theme}
              onChange={(e) =>
                updateCodeSettings({ theme: e.target.value as CodeSettings["theme"] })
              }
              disabled={readOnly}
            >
              <option value="github">GitHub</option>
              <option value="dracula">Dracula</option>
              <option value="one-dark">One Dark</option>
              <option value="solarized-light">Solarized Light</option>
              <option value="solarized-dark">Solarized Dark</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={settings.code.lineNumbers}
              onChange={(e) => updateCodeSettings({ lineNumbers: e.target.checked })}
              disabled={readOnly}
            />
            <span className="text-sm">Show line numbers (default)</span>
          </label>
        </div>
      </div>

      {/* Add Chunks */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addChunk("text")}>
            + Add Text
          </button>
          <button className="btn" onClick={() => addChunk("code")}>
            + Add Code
          </button>
          <button className="btn" onClick={() => addChunk("image")}>
            + Add Image
          </button>
          <button className="btn-secondary" onClick={() => addChunk("callout")}>
            + Add Callout / Tip
          </button>
        </div>
      )}

      {/* Chunks */}
      <ul className="space-y-3">
        {chunks.map((c: BlogChunk, idx: number) => (
          <li key={c.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[c.type]}`}
                  >
                    {c.type.toUpperCase()}
                  </span>
                  {c.type === "text" && (
                    <span className="text-xs text-gray-500">
                      {countWordsFromMarkdown((c as TextChunk).markdown)} words
                    </span>
                  )}
                  {c.type === "code" && (
                    <span className="text-xs text-gray-500">
                      {codeLines((c as CodeChunk).code)} lines • lang{" "}
                      {(c as CodeChunk).language}
                    </span>
                  )}
                  {c.type === "image" && (
                    <span className="text-xs text-gray-500">
                      {(c as ImageChunk).fileSizeKB} KB •{" "}
                      {(c as ImageChunk).fullWidth
                        ? "full-width"
                        : (c as ImageChunk).alignment}
                    </span>
                  )}
                  {c.type === "callout" && (
                    <span className="text-xs text-gray-500">
                      {(c as CalloutChunk).variant}
                    </span>
                  )}
                </div>

                {c.type === "text" && (
                  <textarea
                    className="input min-h-[140px]"
                    value={(c as TextChunk).markdown}
                    onChange={(e) =>
                      updateChunk(c.id, { markdown: e.target.value } as Partial<TextChunk>)
                    }
                    disabled={readOnly}
                    placeholder="Markdown text..."
                  />
                )}

                {c.type === "code" && (
                  <div className="grid gap-2 md:grid-cols-4">
                    <label className="flex flex-col gap-1 md:col-span-1">
                      <span className="text-xs text-gray-500">Language</span>
                      <input
                        className="input !py-1 text-sm"
                        value={(c as CodeChunk).language}
                        onChange={(e) =>
                          updateChunk(c.id, { language: e.target.value } as Partial<CodeChunk>)
                        }
                        disabled={readOnly}
                        placeholder="ts, js, py, bash"
                      />
                    </label>
                    <label className="flex items-center gap-2 md:col-span-1">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={
                          (c as CodeChunk).showLineNumbers === undefined
                            ? settings.code.lineNumbers
                            : !!(c as CodeChunk).showLineNumbers
                        }
                        onChange={(e) =>
                          updateChunk(c.id, {
                            showLineNumbers: e.target.checked,
                          } as Partial<CodeChunk>)
                        }
                        disabled={readOnly}
                      />
                      <span className="text-sm">Line numbers (override)</span>
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-4">
                      <span className="text-xs text-gray-500">Code</span>
                      <textarea
                        className="input min-h-[140px] font-mono"
                        value={(c as CodeChunk).code}
                        onChange={(e) =>
                          updateChunk(c.id, { code: e.target.value } as Partial<CodeChunk>)
                        }
                        disabled={readOnly}
                        placeholder="// paste your snippet..."
                      />
                    </label>
                  </div>
                )}

                {c.type === "image" && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">Alt text</span>
                      <input
                        className="input !py-1 text-sm"
                        value={(c as ImageChunk).alt}
                        onChange={(e) =>
                          updateChunk(c.id, { alt: e.target.value } as Partial<ImageChunk>)
                        }
                        disabled={readOnly}
                        placeholder="A brief description for accessibility"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">Caption</span>
                      <input
                        className="input !py-1 text-sm"
                        value={(c as ImageChunk).caption ?? ""}
                        onChange={(e) =>
                          updateChunk(c.id, { caption: e.target.value } as Partial<ImageChunk>)
                        }
                        disabled={readOnly}
                        placeholder="Optional caption"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">Source (URL or path)</span>
                      <input
                        className="input !py-1 text-sm"
                        value={(c as ImageChunk).src ?? ""}
                        onChange={(e) =>
                          updateChunk(c.id, { src: e.target.value } as Partial<ImageChunk>)
                        }
                        disabled={readOnly}
                        placeholder="/assets/cover.png"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-600">File size (KB)</span>
                      <input
                        type="number"
                        className="input !w-28 !py-1"
                        value={(c as ImageChunk).fileSizeKB}
                        min={1}
                        step={10}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateChunk(c.id, {
                            fileSizeKB: clampInt(
                              parseInt(e.target.value || "0", 10),
                              1,
                              1024 * 1024
                            ),
                          } as Partial<ImageChunk>)
                        }
                        onWheel={(e) => {
                          if (document.activeElement === e.currentTarget) {
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </label>

                    <label className="flex items-center gap-2 md:col-span-2">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={!!(c as ImageChunk).fullWidth}
                        onChange={(e) =>
                          updateChunk(c.id, { fullWidth: e.target.checked } as Partial<ImageChunk>)
                        }
                        disabled={readOnly}
                      />
                      <span className="text-sm">Full-width image</span>
                    </label>

                    {!(c as ImageChunk).fullWidth && (
                      <div className="md:col-span-2">
                        <AlignmentSlider
                          value={(c as ImageChunk).alignment}
                          onChange={(align) =>
                            updateChunk(c.id, { alignment: align } as Partial<ImageChunk>)
                          }
                          disabled={readOnly}
                        />
                      </div>
                    )}
                  </div>
                )}

                {c.type === "callout" && (
                  <div className="grid gap-2 md:grid-cols-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">Variant</span>
                      <select
                        className="input !py-1 text-sm"
                        value={(c as CalloutChunk).variant}
                        onChange={(e) =>
                          updateChunk(c.id, {
                            variant: e.target.value as CalloutVariant,
                          } as Partial<CalloutChunk>)
                        }
                        disabled={readOnly}
                      >
                        <option value="note">Note</option>
                        <option value="tip">Tip</option>
                        <option value="warning">Warning</option>
                        <option value="danger">Danger</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <span className="text-xs text-gray-500">Title (optional)</span>
                      <input
                        className="input !py-1 text-sm"
                        value={(c as CalloutChunk).title ?? ""}
                        onChange={(e) =>
                          updateChunk(c.id, { title: e.target.value } as Partial<CalloutChunk>)
                        }
                        disabled={readOnly}
                        placeholder="Callout title"
                      />
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-3">
                      <span className="text-xs text-gray-500">Content (Markdown)</span>
                      <textarea
                        className="input min-h-[120px]"
                        value={(c as CalloutChunk).markdown}
                        onChange={(e) =>
                          updateChunk(c.id, { markdown: e.target.value } as Partial<CalloutChunk>)
                        }
                        disabled={readOnly}
                        placeholder="Helpful tip or warning..."
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <button
                      className="btn-secondary"
                      onClick={() => move(c.id, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => move(c.id, +1)}
                      disabled={idx === chunks.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => duplicateChunk(c.id)}
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => removeChunk(c.id)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {(underMinWords || overImageBudget) && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {underMinWords && (
            <div>
              SEO minimum not met: add <b>{settings.minWords - totals.words}</b> more word(s).
            </div>
          )}
          {overImageBudget && (
            <div className="mt-1">
              Image budget exceeded by <b>{totals.imagesKB - settings.imageBudgetKB} KB</b>. Consider
              compressing images or using fewer visuals.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   ALIGNMENT SLIDER (Pointer Events; keyboard accessible)
   Maps to: "Slider Control → Image Alignment/Floating"
   ========================================================================== */

function AlignmentSlider({
  value,
  onChange,
  disabled,
}: {
  value: ImageAlignment;
  onChange: (v: ImageAlignment) => void;
  disabled?: boolean;
}) {
  // Internally use a 0..100 scale: 0..24 = left, 25..74 = center, 75..100 = right
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const posFromAlign = (a: ImageAlignment) => (a === "left" ? 10 : a === "center" ? 50 : 90);
  const [pos, setPos] = useState<number>(posFromAlign(value));

  useEffect(() => {
    setPos(posFromAlign(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const toAlignment = (p: number): ImageAlignment => {
    if (p < 25) return "left";
    if (p < 75) return "center";
    return "right";
  };

  const setFromClientX = useCallback((clientX: number) => {
    const el = railRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const raw = Math.round(ratio * 100);
    setPos(raw);
    onChangeRef.current(toAlignment(raw));
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -10;
      if (e.key === "ArrowRight") delta = 10;
      if (e.key === "Home") {
        setPos(0);
        onChangeRef.current("left");
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        setPos(100);
        onChangeRef.current("right");
        e.preventDefault();
        return;
      }
      if (delta !== 0) {
        const next = clampInt(pos + delta, 0, 100);
        setPos(next);
        onChangeRef.current(toAlignment(next));
        e.preventDefault();
      }
    },
    [disabled, pos]
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
    } catch {}
  }, []);

  const label = toAlignment(pos);

  return (
    <div className="mt-2">
      <div className="mb-1 text-xs text-gray-600">
        Image Alignment: <b>{label}</b>
      </div>
      <div
        ref={railRef}
        className={`relative h-3 w-full select-none rounded-full ${
          disabled ? "bg-gray-200" : "cursor-pointer bg-gray-100 hover:bg-gray-200"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label="Image alignment"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pos}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
      >
        <div
          className={`absolute left-0 top-0 h-3 rounded-full ${
            disabled ? "bg-gray-400" : "bg-gray-800"
          }`}
          style={{ width: `${pos}%` }}
        />
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 translate-x-[-50%] rounded-full border-2 ${
            disabled ? "border-gray-400 bg-white" : "border-gray-800 bg-white"
          }`}
          style={{ left: `${pos}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>Left</span>
        <span>Center</span>
        <span>Right</span>
      </div>
    </div>
  );
}

/* =============================================================================
   WRAPPER — accepts previous-stage JSON and emits updated JSON for next stage
   ========================================================================== */

export type BlogEditorFromJSONProps = {
  /** JSON string/object from the previous stage. */
  source: string | BlogInputJSON;
  /** Receive normalized JSON whenever the user changes data. */
  onChangeJSON?: (json: BlogInputJSON) => void;
  /** Show parse diagnostics (default true). */
  showDiagnostics?: boolean;
  className?: string;
};

export function BlogEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: BlogEditorFromJSONProps) {
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    metadata: BlogMetadata;
    settings: {
      imageBudgetKB: number;
      minWords: number;
      code: CodeSettings;
      reading: ReadingSpeed;
    };
    chunks: BlogChunk[];
    totals: { estMinutes: number; words: number; imagesKB: number };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseBlogJSON(source);
    return {
      metadata: res.metadata,
      settings: {
        imageBudgetKB: res.config.imageBudgetKB,
        minWords: res.config.minWords,
        code: res.config.code,
        reading: res.config.reading,
      },
      chunks: res.chunks,
      totals: res.totals,
      warnings: res.warnings,
      errors: res.errors,
    };
  });

  useEffect(() => {
    const res = parseBlogJSON(source);
    setState({
      metadata: res.metadata,
      settings: {
        imageBudgetKB: res.config.imageBudgetKB,
        minWords: res.config.minWords,
        code: res.config.code,
        reading: res.config.reading,
      },
      chunks: res.chunks,
      totals: res.totals,
      warnings: res.warnings,
      errors: res.errors,
    });
  }, [sourceFingerprint]);

  const { metadata, settings, chunks, warnings, errors } = state;

  const handleChange = useCallback(
    ({ metadata: md, settings: st, chunks: ch, totals }: BlogEditorValue) => {
      setState((prev) => ({ ...prev, metadata: md, settings: st, chunks: ch, totals }));
      onChangeJSON?.(serializeBlogToJSON(md, st, ch));
    },
    [onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse blog JSON:</b>
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

      <BlogEditor value={{ metadata, settings, chunks }} onChange={handleChange} />
    </div>
  );
}

/** Default export: JSON-bridged component for convenience */
export default BlogEditorFromJSON;

/* =============================================================================
   USAGE EXAMPLE

   <BlogEditorFromJSON
     source={{
       imageBudgetKB: 1500,
       minWords: 600,
       code: { theme: "dracula", lineNumbers: true },
       reading: { textWPM: 220, codeWPM: 80, imageLookSeconds: 10 },
       metadata: {
         title: "How to Build a Clean React Slider",
         slug: "clean-react-slider",
         description: "Production-ready sliders with pointer events and accessibility.",
         tags: ["react","a11y","ui"],
         categories: ["engineering","frontend"],
         author: "Alex Dev",
         dateISO: "2025-10-27"
       },
       chunks: [
         { type: "text", markdown: "In this post, we'll build a robust slider..." },
         { type: "code", language: "tsx", code: "export function Slider() { // ... }" },
         { type: "callout", variant: "tip", title: "Keyboard support", markdown: "Use Arrow keys for tiny increments." },
         { type: "image", alt: "Slider preview", caption: "Our finished slider", src: "/img/slider.png", fileSizeKB: 220, alignment: "center", fullWidth: false }
       ]
     }}
     onChangeJSON={(json) => {
       // Send updated JSON to backend / next stage (e.g., generate Markdown with front matter)
       console.log("Updated blog JSON:", json);
     }}
   />
   ========================================================================== */
