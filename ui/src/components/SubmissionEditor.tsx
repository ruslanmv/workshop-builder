// workshop_builder/ui/src/components/SubmissionEditor.tsx
// SubmissionEditor.tsx
// Conference Proceedings — JSON-bridged editor
// - Accepts a JSON string/object from the previous stage
// - Parses & sanitizes -> populates the editor
// - Lets a human edit (presentation type, duration, abstract length, pages, template, slot prefs)
// - Emits a normalized JSON on every edit for the next stage

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   TYPES
   ========================================================================== */

export type PresentationType =
  | "oral_talk"
  | "poster_session"
  | "panel_discussion"
  | "lightning_talk";

export type SubmissionItem = {
  id: string;
  type: PresentationType;

  /** Submission Metadata */
  title: string;
  track: string;
  keywords: string[];

  /** Core constraints */
  durationMinutes: number; // presentation time (<= max)
  abstractWords: number; // must be >= MIN for type
  pages: number; // counts toward page-limit budget

  /** Compliance / template */
  template: "latex" | "word";

  /** Session preference */
  preferredDay: "any" | "day1" | "day2" | "day3";
  /** 0 = morning, 50 = mid-day, 100 = evening */
  slotPreference: number; // slider
};

export type SubmissionMetadata = {
  conferenceName: string;
  year: number;
  correspondingAuthor: string;
  contactEmail: string;
  proceedingsIsDoubleBlind?: boolean;
};

export type SubmissionEditorValue = {
  metadata: SubmissionMetadata;
  items: SubmissionItem[];
  totalPages: number;
};

export type SubmissionInputJSON = {
  /** Proceedings page budget (maps from dayBudgetMinutes) */
  pageLimitPages?: number;

  /** Minute step for duration slider */
  step?: number;

  /** Hard cap for any single presentation's duration */
  maxPresentationMinutes?: number;

  /** Disable editing */
  readOnly?: boolean;

  /** Global metadata */
  metadata?: Partial<SubmissionMetadata>;

  /** Submissions list */
  items?: Array<{
    id?: string;
    type: string; // validated to PresentationType
    title?: string;
    track?: string;
    keywords?: string[] | string; // string is comma-separated
    durationMinutes?: number;
    abstractWords?: number;
    pages?: number;
    template?: string;
    preferredDay?: string;
    slotPreference?: number;
  }>;

  [k: string]: unknown; // ignore unknowns safely
};

type EditorProps = {
  /** Controlled value; if omitted the editor is uncontrolled with defaults. */
  value?: Omit<SubmissionEditorValue, "totalPages">;
  pageLimitPages?: number;
  onChange?: (v: SubmissionEditorValue) => void;
  readOnly?: boolean;
  step?: number;
  maxPresentationMinutes?: number;
};

/* =============================================================================
   CONSTANTS / HELPERS
   ========================================================================== */

// "MIN_MINUTES" → Minimum abstract length in words (conference constraint)
const MIN_ABSTRACT_WORDS: Record<PresentationType, number> = {
  oral_talk: 200,
  poster_session: 200,
  panel_discussion: 200,
  lightning_talk: 100,
};

const DEFAULT_ITEM: Record<PresentationType, Omit<SubmissionItem, "id">> = {
  oral_talk: {
    type: "oral_talk",
    title: "Oral Talk",
    track: "Main Track",
    keywords: ["talk", "research"],
    durationMinutes: 15,
    abstractWords: 200,
    pages: 6,
    template: "latex",
    preferredDay: "any",
    slotPreference: 50,
  },
  poster_session: {
    type: "poster_session",
    title: "Poster Session",
    track: "Posters",
    keywords: ["poster", "demo"],
    durationMinutes: 5,
    abstractWords: 200,
    pages: 2,
    template: "latex",
    preferredDay: "any",
    slotPreference: 50,
  },
  panel_discussion: {
    type: "panel_discussion",
    title: "Panel Discussion",
    track: "Panels",
    keywords: ["panel", "discussion"],
    durationMinutes: 30,
    abstractWords: 200,
    pages: 4,
    template: "word",
    preferredDay: "any",
    slotPreference: 50,
  },
  lightning_talk: {
    type: "lightning_talk",
    title: "Lightning Talk",
    track: "Lightning",
    keywords: ["lightning", "short"],
    durationMinutes: 5,
    abstractWords: 100,
    pages: 1,
    template: "latex",
    preferredDay: "any",
    slotPreference: 50,
  },
};

const TYPE_LABEL: Record<PresentationType, string> = {
  oral_talk: "Oral Talk",
  poster_session: "Poster Session",
  panel_discussion: "Panel Discussion",
  lightning_talk: "Lightning Talk",
};

/** Visual proxy for "KIND_BADGE → Author Instructions Template" */
const TYPE_STYLE: Record<PresentationType, string> = {
  oral_talk: "bg-indigo-100 text-indigo-800",
  poster_session: "bg-emerald-100 text-emerald-800",
  panel_discussion: "bg-sky-100 text-sky-800",
  lightning_talk: "bg-amber-100 text-amber-800",
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
function splitKeywords(k: string | string[] | undefined): string[] {
  if (Array.isArray(k)) return k.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof k === "string")
    return k
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}
function asType(x: unknown): PresentationType | null {
  return x === "oral_talk" ||
    x === "poster_session" ||
    x === "panel_discussion" ||
    x === "lightning_talk"
    ? x
    : null;
}
function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}
function asDay(x: unknown): SubmissionItem["preferredDay"] | null {
  return x === "any" || x === "day1" || x === "day2" || x === "day3" ? x : null;
}

/* =============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ========================================================================== */

type ParseResult = {
  config: {
    pageLimitPages: number;
    step: number;
    maxPresentationMinutes: number;
    readOnly: boolean;
  };
  metadata: SubmissionMetadata;
  items: SubmissionItem[];
  warnings: string[];
  errors: string[];
};

export function parseSubmissionJSON(
  src: string | SubmissionInputJSON,
  defaults: {
    pageLimitPages?: number;
    step?: number;
    maxPresentationMinutes?: number;
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

  const pageLimitPages =
    asNumber(obj.pageLimitPages) ?? defaults.pageLimitPages ?? 6;
  const step = Math.max(1, asNumber(obj.step) ?? defaults.step ?? 1);
  const maxPresentationMinutes =
    Math.max(1, asNumber(obj.maxPresentationMinutes) ?? defaults.maxPresentationMinutes ?? 30);
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  const md = obj.metadata ?? {};
  const metadata: SubmissionMetadata = {
    conferenceName: asString(md.conferenceName) ?? "Conference",
    year: asNumber(md.year) ?? new Date().getFullYear(),
    correspondingAuthor: asString(md.correspondingAuthor) ?? "Corresponding Author",
    contactEmail: asString(md.contactEmail) ?? "author@example.com",
    proceedingsIsDoubleBlind: !!md.proceedingsIsDoubleBlind,
  };

  let rawItems: any[] = Array.isArray(obj.items) ? obj.items : [];
  if (rawItems.length === 0) {
    warnings.push(
      "No submissions provided. Using defaults (Oral Talk, Poster, Lightning)."
    );
    rawItems = [
      { type: "oral_talk", title: DEFAULT_ITEM.oral_talk.title, track: DEFAULT_ITEM.oral_talk.track, keywords: DEFAULT_ITEM.oral_talk.keywords, durationMinutes: DEFAULT_ITEM.oral_talk.durationMinutes, abstractWords: DEFAULT_ITEM.oral_talk.abstractWords, pages: DEFAULT_ITEM.oral_talk.pages, template: DEFAULT_ITEM.oral_talk.template, preferredDay: "any", slotPreference: 50 },
      { type: "poster_session", title: DEFAULT_ITEM.poster_session.title, track: DEFAULT_ITEM.poster_session.track, keywords: DEFAULT_ITEM.poster_session.keywords, durationMinutes: DEFAULT_ITEM.poster_session.durationMinutes, abstractWords: DEFAULT_ITEM.poster_session.abstractWords, pages: DEFAULT_ITEM.poster_session.pages, template: DEFAULT_ITEM.poster_session.template, preferredDay: "any", slotPreference: 50 },
      { type: "lightning_talk", title: DEFAULT_ITEM.lightning_talk.title, track: DEFAULT_ITEM.lightning_talk.track, keywords: DEFAULT_ITEM.lightning_talk.keywords, durationMinutes: DEFAULT_ITEM.lightning_talk.durationMinutes, abstractWords: DEFAULT_ITEM.lightning_talk.abstractWords, pages: DEFAULT_ITEM.lightning_talk.pages, template: DEFAULT_ITEM.lightning_talk.template, preferredDay: "any", slotPreference: 50 },
    ];
  }

  const items: SubmissionItem[] = [];
  rawItems.forEach((ri, i) => {
    const t = asType(ri.type);
    if (!t) {
      warnings.push(`Item ${i}: invalid "type" (${String(ri.type)}). Skipped.`);
      return;
    }
    const id = asString(ri.id) ?? uid();
    const title = asString(ri.title) ?? TYPE_LABEL[t];
    const track = asString(ri.track) ?? DEFAULT_ITEM[t].track;
    const keywords = splitKeywords(ri.keywords);

    let durationMinutes = asNumber(ri.durationMinutes);
    if (durationMinutes === null) {
      warnings.push(`Item ${i}: missing/invalid "durationMinutes". Using default for ${t}.`);
      durationMinutes = DEFAULT_ITEM[t].durationMinutes;
    }
    const normalizedDuration = clampInt(roundToStep(durationMinutes, step), 1, maxPresentationMinutes);
    if (normalizedDuration !== durationMinutes) {
      warnings.push(
        `Item ${i}: durationMinutes (${durationMinutes}) normalized to ${normalizedDuration} (max ${maxPresentationMinutes}, step ${step}).`
      );
    }

    let abstractWords = asNumber(ri.abstractWords);
    if (abstractWords === null) {
      warnings.push(`Item ${i}: missing/invalid "abstractWords". Using default for ${t}.`);
      abstractWords = DEFAULT_ITEM[t].abstractWords;
    }
    const minAbs = MIN_ABSTRACT_WORDS[t];
    const normalizedAbstract = clampInt(abstractWords, minAbs, 20000);
    if (normalizedAbstract !== abstractWords) {
      warnings.push(
        `Item ${i}: abstractWords (${abstractWords}) normalized to ${normalizedAbstract} (min ${minAbs}).`
      );
    }

    const pages = clampInt(asNumber(ri.pages) ?? DEFAULT_ITEM[t].pages, 1, 100);

    const template =
      (asString(ri.template) as SubmissionItem["template"]) ?? DEFAULT_ITEM[t].template;

    const preferredDay = asDay(ri.preferredDay) ?? "any";
    const slotPreference = clampInt(asNumber(ri.slotPreference) ?? 50, 0, 100);

    items.push({
      id,
      type: t,
      title,
      track,
      keywords,
      durationMinutes: normalizedDuration,
      abstractWords: normalizedAbstract,
      pages,
      template,
      preferredDay,
      slotPreference,
    });
  });

  return {
    config: { pageLimitPages, step, maxPresentationMinutes, readOnly },
    metadata,
    items,
    warnings,
    errors,
  };
}

export function serializeSubmissionToJSON(
  metadata: SubmissionMetadata,
  items: SubmissionItem[],
  config: {
    pageLimitPages: number;
    step: number;
    maxPresentationMinutes: number;
    readOnly: boolean;
  }
): SubmissionInputJSON {
  return {
    pageLimitPages: config.pageLimitPages,
    step: config.step,
    maxPresentationMinutes: config.maxPresentationMinutes,
    readOnly: config.readOnly,
    metadata: {
      conferenceName: metadata.conferenceName,
      year: metadata.year,
      correspondingAuthor: metadata.correspondingAuthor,
      contactEmail: metadata.contactEmail,
      proceedingsIsDoubleBlind: metadata.proceedingsIsDoubleBlind,
    },
    items: items.map((s: SubmissionItem) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      track: s.track,
      keywords: s.keywords,
      durationMinutes: s.durationMinutes,
      abstractWords: s.abstractWords,
      pages: s.pages,
      template: s.template,
      preferredDay: s.preferredDay,
      slotPreference: s.slotPreference,
    })),
  };
}

/* =============================================================================
   CORE EDITOR (production-safe; avoids feedback loops; pointer events)
   ========================================================================== */

export function SubmissionEditor({
  value,
  pageLimitPages = 6,
  onChange,
  readOnly = false,
  step = 1,
  maxPresentationMinutes = 30,
}: EditorProps) {
  const isControlled = value !== undefined;

  const [internalMetadata, setInternalMetadata] = useState<SubmissionMetadata>({
    conferenceName: "Conference",
    year: new Date().getFullYear(),
    correspondingAuthor: "Corresponding Author",
    contactEmail: "author@example.com",
    proceedingsIsDoubleBlind: true,
  });

  const [internalItems, setInternalItems] = useState<SubmissionItem[]>(() => [
    { id: uid(), ...DEFAULT_ITEM.oral_talk },
    { id: uid(), ...DEFAULT_ITEM.poster_session },
    { id: uid(), ...DEFAULT_ITEM.lightning_talk },
  ]);

  // Strongly type controlled value access to avoid implicit any
  const controlled = value as Omit<SubmissionEditorValue, "totalPages"> | undefined;
  const metadata: SubmissionMetadata = isControlled ? controlled!.metadata : internalMetadata;
  const items: SubmissionItem[] = isControlled ? controlled!.items : internalItems;

  const totalPages = useMemo(
    () =>
      items.reduce<number>(
        (acc: number, s: SubmissionItem) => acc + (Number.isFinite(s.pages) ? s.pages : 0),
        0
      ),
    [items]
  );

  const commit = useCallback(
    (nextMeta: SubmissionMetadata, nextItems: SubmissionItem[]) => {
      if (!isControlled) {
        setInternalMetadata(nextMeta);
        setInternalItems(nextItems);
      }
      const nextTotal = nextItems.reduce<number>(
        (acc: number, s: SubmissionItem) => acc + (Number.isFinite(s.pages) ? s.pages : 0),
        0
      );
      onChange?.({
        metadata: nextMeta,
        items: nextItems,
        totalPages: nextTotal,
      });
    },
    [isControlled, onChange]
  );

  const pct = Math.min(100, Math.round((totalPages / Math.max(1, pageLimitPages)) * 100));
  const overPages = totalPages > pageLimitPages;

  const addItem = (type: PresentationType) => {
    if (readOnly) return;
    const next = [...items, { id: uid(), ...DEFAULT_ITEM[type] }];
    commit(metadata, next);
  };

  const duplicateItem = (id: string) => {
    if (readOnly) return;
    const idx = items.findIndex((s: SubmissionItem) => s.id === id);
    if (idx < 0) return;
    const original = items[idx];
    const copy: SubmissionItem = { ...original, id: uid(), title: `${original.title} (copy)` };
    const out = items.slice();
    out.splice(idx + 1, 0, copy);
    commit(metadata, out);
  };

  const removeItem = (id: string) => {
    if (readOnly) return;
    commit(metadata, items.filter((s: SubmissionItem) => s.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = items.findIndex((s: SubmissionItem) => s.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const copy = items.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    commit(metadata, copy);
  };

  const updateItem = (id: string, patch: Partial<SubmissionItem>) => {
    if (readOnly) return;
    const out = items.map((s: SubmissionItem) => {
      if (s.id !== id) return s;
      const nextType = (patch.type ?? s.type) as PresentationType;
      const minAbs = MIN_ABSTRACT_WORDS[nextType];
      const nextDuration =
        patch.durationMinutes !== undefined
          ? clampInt(roundToStep(patch.durationMinutes, step), 1, maxPresentationMinutes)
          : s.durationMinutes;
      const nextAbstract =
        patch.abstractWords !== undefined ? clampInt(patch.abstractWords, minAbs, 20000) : s.abstractWords;
      const nextPages = patch.pages !== undefined ? clampInt(patch.pages, 1, 100) : s.pages;
      const nextSlotPref =
        patch.slotPreference !== undefined ? clampInt(patch.slotPreference, 0, 100) : s.slotPreference;
      const nextTemplate =
        (patch.template as SubmissionItem["template"]) ?? s.template;
      const nextPreferredDay =
        (patch.preferredDay as SubmissionItem["preferredDay"]) ?? s.preferredDay;

      return {
        ...s,
        ...patch,
        type: nextType,
        durationMinutes: nextDuration,
        abstractWords: nextAbstract,
        pages: nextPages,
        slotPreference: nextSlotPref,
        template: nextTemplate,
        preferredDay: nextPreferredDay,
        keywords:
          patch.keywords !== undefined
            ? patch.keywords.map((k) => k.trim()).filter(Boolean)
            : s.keywords,
      };
    });
    commit(metadata, out);
  };

  const updateMetadata = <K extends keyof SubmissionMetadata>(key: K, val: SubmissionMetadata[K]) => {
    if (readOnly) return;
    const nextMeta = { ...metadata, [key]: val };
    commit(nextMeta, items);
  };

  return (
    <div className="card">
      {/* Top Summary */}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold">Conference Proceedings — Submission Editor</h3>
        <div className="text-sm text-gray-700">
          Pages: <b>{totalPages}</b> / {pageLimitPages}{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overPages ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {pct}% used
          </span>
        </div>
      </div>

      <div className="mb-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overPages ? "bg-red-500" : "bg-gray-800"}`}
          style={{ width: `${Math.min(100, (totalPages / Math.max(1, pageLimitPages)) * 100)}%` }}
        />
      </div>

      {/* Metadata Panel */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Submission Metadata</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Conference</span>
            <input
              className="input"
              value={metadata.conferenceName}
              onChange={(e) => updateMetadata("conferenceName", e.target.value)}
              disabled={readOnly}
              placeholder="ACME 2026"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Year</span>
            <input
              type="number"
              className="input"
              value={metadata.year}
              onChange={(e) => updateMetadata("year", parseInt(e.target.value || "0", 10))}
              disabled={readOnly}
              min={2000}
              step={1}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Corresponding Author</span>
            <input
              className="input"
              value={metadata.correspondingAuthor}
              onChange={(e) => updateMetadata("correspondingAuthor", e.target.value)}
              disabled={readOnly}
              placeholder="Jane Doe"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Contact Email</span>
            <input
              className="input"
              value={metadata.contactEmail}
              onChange={(e) => updateMetadata("contactEmail", e.target.value)}
              disabled={readOnly}
              placeholder="jane.doe@example.com"
            />
          </label>

          <label className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={!!metadata.proceedingsIsDoubleBlind}
              onChange={(e) => updateMetadata("proceedingsIsDoubleBlind", e.target.checked)}
              disabled={readOnly}
            />
            <span className="text-sm">Double-blind review (suppress authors in manuscript)</span>
          </label>
        </div>
      </div>

      {/* Add Items */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addItem("oral_talk")}>
            + Add Oral Talk
          </button>
          <button className="btn" onClick={() => addItem("poster_session")}>
            + Add Poster Session
          </button>
          <button className="btn" onClick={() => addItem("panel_discussion")}>
            + Add Panel Discussion
          </button>
          <button className="btn-secondary" onClick={() => addItem("lightning_talk")}>
            + Add Lightning Talk
          </button>
        </div>
      )}

      {/* Items */}
      <ul className="space-y-3">
        {items.map((s: SubmissionItem, idx: number) => (
          <li key={s.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[s.type]}`}
                  >
                    {TYPE_LABEL[s.type]}
                  </span>
                  <select
                    className="input !py-0.5 text-xs"
                    value={s.template}
                    onChange={(e) =>
                      updateItem(s.id, {
                        template: e.target.value as SubmissionItem["template"],
                      })
                    }
                    disabled={readOnly}
                    title="Author Instructions Template"
                  >
                    <option value="latex">LaTeX Template</option>
                    <option value="word">Word Template</option>
                  </select>
                  <span className="text-xs text-gray-500">
                    min abstract {MIN_ABSTRACT_WORDS[s.type]} words
                  </span>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="input !py-1 text-sm"
                    value={s.title}
                    onChange={(e) => updateItem(s.id, { title: e.target.value })}
                    disabled={readOnly}
                    placeholder={`${TYPE_LABEL[s.type]} title`}
                  />
                  <input
                    className="input !py-1 text-sm"
                    value={s.track}
                    onChange={(e) => updateItem(s.id, { track: e.target.value })}
                    disabled={readOnly}
                    placeholder="Track/Topic"
                  />
                  <input
                    className="input !py-1 text-sm md:col-span-2"
                    value={s.keywords.join(", ")}
                    onChange={(e) =>
                      updateItem(s.id, {
                        keywords: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    disabled={readOnly}
                    placeholder="keywords, comma, separated"
                  />
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-sm text-gray-500">
                  {s.durationMinutes} min • {s.pages} page(s)
                </span>
                {!readOnly && (
                  <div className="flex items-center gap-1">
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
                      disabled={idx === items.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => duplicateItem(s.id)}
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => removeItem(s.id)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Duration control (strictly enforced) */}
            <DurationSlider
              minutes={s.durationMinutes}
              max={maxPresentationMinutes}
              step={step}
              onChange={(m) => updateItem(s.id, { durationMinutes: m })}
              disabled={readOnly}
            />

            {/* Abstract words, pages, session preferences */}
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">Abstract (words)</span>
                <input
                  type="number"
                  className="input !w-28 !py-1"
                  min={MIN_ABSTRACT_WORDS[s.type]}
                  step={10}
                  value={s.abstractWords}
                  disabled={readOnly}
                  onChange={(e) =>
                    updateItem(s.id, {
                      abstractWords: parseInt(e.target.value || "0", 10),
                    })
                  }
                />
              </label>

              <label className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">Pages</span>
                <input
                  type="number"
                  className="input !w-24 !py-1"
                  min={1}
                  step={1}
                  value={s.pages}
                  disabled={readOnly}
                  onChange={(e) =>
                    updateItem(s.id, { pages: parseInt(e.target.value || "0", 10) })
                  }
                />
              </label>

              <label className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">Preferred Day</span>
                <select
                  className="input !w-28 !py-1"
                  value={s.preferredDay}
                  onChange={(e) =>
                    updateItem(s.id, {
                      preferredDay: e.target.value as SubmissionItem["preferredDay"],
                    })
                  }
                  disabled={readOnly}
                >
                  <option value="any">Any</option>
                  <option value="day1">Day 1</option>
                  <option value="day2">Day 2</option>
                  <option value="day3">Day 3</option>
                </select>
              </label>
            </div>

            <div className="mt-2">
              <SlotPreferenceSlider
                value={s.slotPreference}
                onChange={(v) => updateItem(s.id, { slotPreference: v })}
                disabled={readOnly}
              />
              <div className="mt-1 text-xs text-gray-600">
                Session preference:{" "}
                {s.slotPreference <= 20
                  ? "Morning"
                  : s.slotPreference <= 60
                  ? "Mid-day"
                  : "Evening"}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {overPages && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          You exceed the proceedings page limit by <b>{totalPages - pageLimitPages}</b> page(s).
          Reduce page counts or adjust the page limit.
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   SLIDERS (Pointer Events; keyboard accessible)
   ========================================================================== */

function DurationSlider({
  minutes,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  minutes: number;
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
    const span = Math.max(1, max - 1);
    return Math.max(0, Math.min(100, ((minutes - 1) / span) * 100));
  }, [minutes, max]);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = railRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const raw = 1 + ratio * (max - 1);
      const snapped = clampInt(roundToStep(raw, step), 1, max);
      onChangeRef.current(snapped);
    },
    [max, step]
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
        onChangeRef.current(1);
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        onChangeRef.current(max);
        e.preventDefault();
        return;
      }
      if (delta !== 0) {
        const next = clampInt(roundToStep(minutes + delta, step), 1, max);
        onChangeRef.current(next);
        e.preventDefault();
      }
    },
    [disabled, max, minutes, step]
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
      <div className="mb-1 text-xs text-gray-600">Presentation Time Limit</div>
      <div
        ref={railRef}
        className={`relative h-4 w-full select-none rounded-full ${
          disabled ? "bg-gray-200" : "cursor-pointer bg-gray-100 hover:bg-gray-200"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label="Presentation time (minutes)"
        aria-valuemin={1}
        aria-valuemax={max}
        aria-valuenow={minutes}
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
          value={minutes}
          min={1}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) =>
            onChangeRef.current(
              clampInt(roundToStep(parseInt(e.target.value || "0", 10), step), 1, max)
            )
          }
          onWheel={(e) => {
            if (document.activeElement === e.currentTarget) {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <span className="text-xs text-gray-500">
          min 1 • max {max} • step {step}
        </span>
      </div>
    </div>
  );
}

function SlotPreferenceSlider({
  value,
  disabled,
  onChange,
}: {
  value: number; // 0..100
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pct = useMemo(() => Math.max(0, Math.min(100, value)), [value]);

  const setFromClientX = useCallback((clientX: number) => {
    const el = railRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const raw = Math.round(ratio * 100);
    onChangeRef.current(clampInt(raw, 0, 100));
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -5;
      if (e.key === "ArrowRight") delta = 5;
      if (e.key === "Home") {
        onChangeRef.current(0);
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        onChangeRef.current(100);
        e.preventDefault();
        return;
      }
      if (delta !== 0) {
        onChangeRef.current(clampInt(value + delta, 0, 100));
        e.preventDefault();
      }
    },
    [disabled, value]
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!railRef.current) return;
    setDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  }, [disabled, setFromClientX]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    setFromClientX(e.clientX);
  }, [dragging, disabled, setFromClientX]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  return (
    <div className="mt-2">
      <div className="mb-1 text-xs text-gray-600">Session Slot Preference (Morning ←→ Evening)</div>
      <div
        ref={railRef}
        className={`relative h-3 w-full select-none rounded-full ${
          disabled ? "bg-gray-200" : "cursor-pointer bg-gray-100 hover:bg-gray-200"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label="Session slot preference"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
      >
        <div
          className={`absolute left-0 top-0 h-3 rounded-full ${
            disabled ? "bg-gray-400" : "bg-gray-800"
          }`}
          style={{ width: `${pct}%` }}
        />
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 translate-x-[-50%] rounded-full border-2 ${
            disabled ? "border-gray-400 bg-white" : "border-gray-800 bg-white"
          }`}
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* =============================================================================
   WRAPPER — accepts previous-stage JSON and emits updated JSON for next stage
   ========================================================================== */

export type SubmissionEditorFromJSONProps = {
  /** JSON string/object from the previous stage. */
  source: string | SubmissionInputJSON;
  /** Receive normalized JSON whenever the user changes data. */
  onChangeJSON?: (json: SubmissionInputJSON) => void;
  /** Show parse diagnostics (default true). */
  showDiagnostics?: boolean;
  className?: string;
};

export function SubmissionEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: SubmissionEditorFromJSONProps) {
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    metadata: SubmissionMetadata;
    items: SubmissionItem[];
    config: {
      pageLimitPages: number;
      step: number;
      maxPresentationMinutes: number;
      readOnly: boolean;
    };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseSubmissionJSON(source);
    return {
      metadata: res.metadata,
      items: res.items,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    };
  });

  useEffect(() => {
    const res = parseSubmissionJSON(source);
    setState({
      metadata: res.metadata,
      items: res.items,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    });
  }, [sourceFingerprint]);

  const { metadata, items, config, warnings, errors } = state;

  const handleChange = useCallback(
    ({ metadata: md, items: itms }: SubmissionEditorValue) => {
      setState((prev) => ({ ...prev, metadata: md, items: itms }));
      onChangeJSON?.(serializeSubmissionToJSON(md, itms, config));
    },
    [config, onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse submission JSON:</b>
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

      <SubmissionEditor
        value={{ metadata, items }}
        pageLimitPages={config.pageLimitPages}
        step={config.step}
        maxPresentationMinutes={config.maxPresentationMinutes}
        readOnly={config.readOnly}
        onChange={handleChange}
      />
    </div>
  );
}

/** Default export: JSON-bridged component for convenience */
export default SubmissionEditorFromJSON;

/* =============================================================================
   USAGE EXAMPLE

   <SubmissionEditorFromJSON
     source={{
       pageLimitPages: 6,
       step: 1,
       maxPresentationMinutes: 20,
       readOnly: false,
       metadata: {
         conferenceName: "ACME 2026",
         year: 2026,
         correspondingAuthor: "Jane Doe",
         contactEmail: "jane@example.com",
         proceedingsIsDoubleBlind: true
       },
       items: [
         {
           id: "oral1",
           type: "oral_talk",
           title: "Neural Widgets for Everyone",
           track: "Main Track",
           keywords: ["widgets", "neural", "inference"],
           durationMinutes: 15,
           abstractWords: 250,
           pages: 6,
           template: "latex",
           preferredDay: "day1",
           slotPreference: 20
         },
         {
           id: "poster1",
           type: "poster_session",
           title: "WidgetNet: Poster",
           track: "Posters",
           keywords: ["poster", "demo"],
           durationMinutes: 5,
           abstractWords: 220,
           pages: 2,
           template: "latex",
           preferredDay: "day2",
           slotPreference: 60
         },
         {
           id: "lt1",
           type: "lightning_talk",
           title: "Lightning: Tiny Widgets",
           track: "Lightning",
           keywords: ["lightning"],
           durationMinutes: 5,
           abstractWords: 120,
           pages: 1,
           template: "word",
           preferredDay: "any",
           slotPreference: 80
         }
       ]
     }}
     onChangeJSON={(json) => {
       // Send updated JSON to backend / next stage (e.g., schedule builder, proceedings generator)
       console.log("Updated submission JSON:", json);
     }}
   />
   ========================================================================== */
