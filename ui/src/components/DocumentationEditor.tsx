// workshop_builder/ui/src/components/DocumentationEditor.tsx
// DocumentationEditor.tsx
// Software Documentation (MkDocs) — JSON-bridged editor
// - Accepts a JSON string/object from the previous stage
// - Parses & sanitizes -> populates the editor
// - Lets a human edit (site metadata, nav structure, versioning, API docs, search boost)
// - Emits a normalized JSON on every edit for the next stage

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   TYPES
   ========================================================================== */

export type DocSectionType =
  | "api_reference"
  | "tutorial"
  | "deployment_guide"
  | "changelog";

export type DocSection = {
  id: string;
  type: DocSectionType;
  /** Page Title (also used in nav) */
  title: string;
  /** Optional relative path like "api/users.md" (used to build nav) */
  path?: string;
  /** Search keywords for this page */
  keywords: string[];
  /** Complexity score (used internally to gauge depth & optionally boost search) */
  complexity: number;
  /** 0 = top-level in nav; 1 = child, etc. */
  depth: number;
};

export type DocumentationMetadata = {
  siteName: string;
  theme?: "mkdocs" | "material";
  /** Repo integration */
  repoUrl?: string;
  repoIcon?: "github" | "gitlab" | "bitbucket";
  /** Versioning configuration (e.g., mike or Material's built-in) */
  versioning: {
    enabled: boolean;
    strategy: "mike" | "material";
    defaultVersion?: string;
    versions: string[];
  };
  /** mkdocstrings / API docs */
  api: {
    enabled: boolean;
    handlers: string[]; // e.g., ["python"]
    modules: string[]; // e.g., ["my_package", "my_package.sub"]
    watch?: string[]; // optional extra watch paths
  };
  /** Search configuration */
  search: {
    boostFromComplexity: boolean; // if true, per-page weight ~ base + complexity
    baseWeight: number; // starting weight
  };
};

export type DocumentationEditorValue = {
  metadata: DocumentationMetadata;
  sections: DocSection[];
  /** Aggregate complexity across all sections (used as a "budget" proxy) */
  totalComplexity: number;
};

/** Incoming JSON shape */
export type DocumentationInputJSON = {
  /** Complexity "budget" across the doc set (proxy for effort/versioning constraints) */
  complexityBudget?: number; // maps "dayBudgetMinutes"
  /** Input step for complexity slider */
  step?: number;
  /** Hard cap per section complexity */
  sectionMaxComplexity?: number;
  /** Disable editing */
  readOnly?: boolean;

  /** Global metadata */
  metadata?: Partial<DocumentationMetadata>;

  /** Nav/Pages */
  sections?: Array<{
    id?: string;
    type: string; // validated to DocSectionType
    title?: string;
    path?: string;
    keywords?: string[] | string; // string is comma-separated
    complexity?: number;
    depth?: number;
  }>;

  [k: string]: unknown; // ignore unknowns safely
};

type EditorProps = {
  /** Controlled value; if omitted the editor is uncontrolled with defaults. */
  value?: Omit<DocumentationEditorValue, "totalComplexity">;
  complexityBudget?: number;
  onChange?: (v: DocumentationEditorValue) => void;
  readOnly?: boolean;
  step?: number;
  sectionMaxComplexity?: number;
};

/* =============================================================================
   CONSTANTS / HELPERS (Mappings from the workshop table)
   ========================================================================== */

// "MIN_MINUTES" → Minimum docstring/complexity requirement per type
const MIN_COMPLEXITY: Record<DocSectionType, number> = {
  api_reference: 3, // API needs more structure (docstrings/params/returns)
  tutorial: 2,
  deployment_guide: 2,
  changelog: 1,
};

const DEFAULT_SECTION: Record<DocSectionType, Omit<DocSection, "id" | "depth">> = {
  api_reference: {
    type: "api_reference",
    title: "API Reference",
    path: "api/index.md",
    keywords: ["api", "reference"],
    complexity: 5,
  },
  tutorial: {
    type: "tutorial",
    title: "Getting Started",
    path: "tutorials/getting-started.md",
    keywords: ["tutorial", "guide", "start"],
    complexity: 3,
  },
  deployment_guide: {
    type: "deployment_guide",
    title: "Deployment Guide",
    path: "guides/deployment.md",
    keywords: ["deploy", "ops", "guide"],
    complexity: 4,
  },
  changelog: {
    type: "changelog",
    title: "Changelog",
    path: "changelog.md",
    keywords: ["changelog", "release notes"],
    complexity: 2,
  },
};

const TYPE_LABEL: Record<DocSectionType, string> = {
  api_reference: "API Reference",
  tutorial: "Tutorial",
  deployment_guide: "Deployment Guide",
  changelog: "Changelog",
};

/** Visual proxy for "KIND_BADGE → repo_url & icon settings" */
const TYPE_STYLE: Record<DocSectionType, string> = {
  api_reference: "bg-indigo-100 text-indigo-800",
  tutorial: "bg-emerald-100 text-emerald-800",
  deployment_guide: "bg-sky-100 text-sky-800",
  changelog: "bg-amber-100 text-amber-800",
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
function fmtComplexity(n: number) {
  return `${n} complexity`;
}

/* =============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ========================================================================== */

function asType(x: unknown): DocSectionType | null {
  return x === "api_reference" ||
    x === "tutorial" ||
    x === "deployment_guide" ||
    x === "changelog"
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
  return clampInt(n, 0, 4); // allow a bit of nesting
}

type ParseResult = {
  config: {
    complexityBudget: number;
    step: number;
    sectionMaxComplexity: number;
    readOnly: boolean;
  };
  metadata: DocumentationMetadata;
  sections: DocSection[];
  warnings: string[];
  errors: string[];
};

export function parseDocumentationJSON(
  src: string | DocumentationInputJSON,
  defaults: {
    complexityBudget?: number;
    step?: number;
    sectionMaxComplexity?: number;
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

  const complexityBudget = asNumber(obj.complexityBudget) ?? defaults.complexityBudget ?? 100;
  const step = Math.max(1, asNumber(obj.step) ?? defaults.step ?? 1);
  const sectionMaxComplexity =
    Math.max(1, asNumber(obj.sectionMaxComplexity) ?? defaults.sectionMaxComplexity ?? 20);
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  // Metadata
  const md = obj.metadata ?? {};
  const metadata: DocumentationMetadata = {
    siteName: asString(md.siteName) ?? "My Docs",
    theme: (asString(md.theme) as DocumentationMetadata["theme"]) ?? "material",
    repoUrl: asString(md.repoUrl) ?? "",
    repoIcon:
      (asString(md.repoIcon) as DocumentationMetadata["repoIcon"]) ?? "github",
    versioning: {
      enabled: typeof md?.versioning?.enabled === "boolean" ? md.versioning.enabled : false,
      strategy:
        (asString(md?.versioning?.strategy) as DocumentationMetadata["versioning"]["strategy"]) ??
        "mike",
      defaultVersion: asString(md?.versioning?.defaultVersion) ?? "latest",
      versions: Array.isArray(md?.versioning?.versions)
        ? md.versioning.versions.map(String)
        : ["latest"],
    },
    api: {
      enabled: typeof md?.api?.enabled === "boolean" ? md.api.enabled : true,
      handlers: Array.isArray(md?.api?.handlers) ? md.api.handlers.map(String) : ["python"],
      modules: Array.isArray(md?.api?.modules) ? md.api.modules.map(String) : ["my_package"],
      watch: Array.isArray(md?.api?.watch) ? md.api.watch.map(String) : [],
    },
    search: {
      boostFromComplexity:
        typeof md?.search?.boostFromComplexity === "boolean"
          ? md.search.boostFromComplexity
          : true,
      baseWeight: asNumber(md?.search?.baseWeight) ?? 100,
    },
  };

  // Sections
  let rawSections: any[] = Array.isArray(obj.sections) ? obj.sections : [];
  if (rawSections.length === 0) {
    warnings.push(
      "No sections provided. Using defaults (Tutorial, API Reference, Deployment Guide, Changelog)."
    );
    rawSections = [
      { type: "tutorial", title: DEFAULT_SECTION.tutorial.title, path: DEFAULT_SECTION.tutorial.path, keywords: DEFAULT_SECTION.tutorial.keywords, complexity: DEFAULT_SECTION.tutorial.complexity, depth: 0 },
      { type: "api_reference", title: DEFAULT_SECTION.api_reference.title, path: DEFAULT_SECTION.api_reference.path, keywords: DEFAULT_SECTION.api_reference.keywords, complexity: DEFAULT_SECTION.api_reference.complexity, depth: 0 },
      { type: "deployment_guide", title: DEFAULT_SECTION.deployment_guide.title, path: DEFAULT_SECTION.deployment_guide.path, keywords: DEFAULT_SECTION.deployment_guide.keywords, complexity: DEFAULT_SECTION.deployment_guide.complexity, depth: 0 },
      { type: "changelog", title: DEFAULT_SECTION.changelog.title, path: DEFAULT_SECTION.changelog.path, keywords: DEFAULT_SECTION.changelog.keywords, complexity: DEFAULT_SECTION.changelog.complexity, depth: 0 },
    ];
  }

  const sections: DocSection[] = [];
  rawSections.forEach((rs, i) => {
    const t = asType(rs.type);
    if (!t) {
      warnings.push(`Section ${i}: invalid "type" (${String(rs.type)}). Skipped.`);
      return;
    }
    const title = asString(rs.title) ?? TYPE_LABEL[t];
    const path = asString(rs.path) ?? DEFAULT_SECTION[t].path;
    const keywords = splitKeywords(rs.keywords);
    const id = asString(rs.id) ?? uid();

    let complexity = asNumber(rs.complexity);
    if (complexity === null) {
      warnings.push(`Section ${i}: missing/invalid "complexity". Using default for ${t}.`);
      complexity = DEFAULT_SECTION[t].complexity;
    }

    const rawDepth = asDepth(rs.depth);
    const depth = rawDepth === null ? 0 : rawDepth;

    const minForType = MIN_COMPLEXITY[t];
    const normalized = clampInt(roundToStep(complexity, step), minForType, sectionMaxComplexity);
    if (normalized !== complexity) {
      warnings.push(
        `Section ${i}: complexity (${complexity}) normalized to ${normalized} (min ${minForType}, max ${sectionMaxComplexity}, step ${step}).`
      );
    }

    sections.push({ id, type: t, title, path, keywords, complexity: normalized, depth });
  });

  // simple outline sanity: no item can be deeper than previous+1
  for (let i = 0; i < sections.length; i++) {
    const prevDepth = i === 0 ? 0 : sections[i - 1].depth;
    if (sections[i].depth > prevDepth + 1) {
      warnings.push(
        `Section ${i}: depth ${sections[i].depth} reduced to ${prevDepth + 1} to keep a valid nav.`
      );
      sections[i].depth = prevDepth + 1;
    }
  }

  return {
    config: { complexityBudget, step, sectionMaxComplexity, readOnly },
    metadata,
    sections,
    warnings,
    errors,
  };
}

export function serializeDocumentationToJSON(
  metadata: DocumentationMetadata,
  sections: DocSection[],
  config: {
    complexityBudget: number;
    step: number;
    sectionMaxComplexity: number;
    readOnly: boolean;
  }
): DocumentationInputJSON {
  return {
    complexityBudget: config.complexityBudget,
    step: config.step,
    sectionMaxComplexity: config.sectionMaxComplexity,
    readOnly: config.readOnly,
    metadata: {
      siteName: metadata.siteName,
      theme: metadata.theme,
      repoUrl: metadata.repoUrl,
      repoIcon: metadata.repoIcon,
      versioning: {
        enabled: metadata.versioning.enabled,
        strategy: metadata.versioning.strategy,
        defaultVersion: metadata.versioning.defaultVersion,
        versions: metadata.versioning.versions,
      },
      api: {
        enabled: metadata.api.enabled,
        handlers: metadata.api.handlers,
        modules: metadata.api.modules,
        watch: metadata.api.watch,
      },
      search: {
        boostFromComplexity: metadata.search.boostFromComplexity,
        baseWeight: metadata.search.baseWeight,
      },
    },
    sections: sections.map((s: DocSection) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      path: s.path,
      keywords: s.keywords,
      complexity: s.complexity,
      depth: s.depth,
    })),
  };
}

/* =============================================================================
   CORE EDITOR (production-safe; avoids feedback loops; pointer events)
   ========================================================================== */

export function DocumentationEditor({
  value,
  complexityBudget = 100,
  onChange,
  readOnly = false,
  step = 1,
  sectionMaxComplexity = 20,
}: EditorProps) {
  const isControlled = value !== undefined;

  const [internalMetadata, setInternalMetadata] = useState<DocumentationMetadata>({
    siteName: "My Docs",
    theme: "material",
    repoUrl: "",
    repoIcon: "github",
    versioning: {
      enabled: false,
      strategy: "mike",
      defaultVersion: "latest",
      versions: ["latest"],
    },
    api: {
      enabled: true,
      handlers: ["python"],
      modules: ["my_package"],
      watch: [],
    },
    search: {
      boostFromComplexity: true,
      baseWeight: 100,
    },
  });

  const [internalSections, setInternalSections] = useState<DocSection[]>(() => [
    { id: uid(), ...DEFAULT_SECTION.tutorial, depth: 0 },
    { id: uid(), ...DEFAULT_SECTION.api_reference, depth: 0 },
    { id: uid(), ...DEFAULT_SECTION.deployment_guide, depth: 0 },
    { id: uid(), ...DEFAULT_SECTION.changelog, depth: 0 },
  ]);

  // Keep strong types for controlled vs uncontrolled
  const controlled = value as Omit<DocumentationEditorValue, "totalComplexity"> | undefined;
  const metadata: DocumentationMetadata = isControlled ? controlled!.metadata : internalMetadata;
  const sections: DocSection[] = isControlled ? controlled!.sections : internalSections;

  const totalComplexity = useMemo(
    () =>
      sections.reduce<number>(
        (acc: number, s: DocSection) =>
          acc + (Number.isFinite(s.complexity) ? s.complexity : 0),
        0
      ),
    [sections]
  );

  const commit = useCallback(
    (nextMeta: DocumentationMetadata, nextSections: DocSection[]) => {
      if (!isControlled) {
        setInternalMetadata(nextMeta);
        setInternalSections(nextSections);
      }
      const nextTotal = nextSections.reduce<number>(
        (acc: number, s: DocSection) =>
          acc + (Number.isFinite(s.complexity) ? s.complexity : 0),
        0
      );
      onChange?.({
        metadata: nextMeta,
        sections: nextSections,
        totalComplexity: nextTotal,
      });
    },
    [isControlled, onChange]
  );

  const pct = Math.min(
    100,
    Math.round((totalComplexity / Math.max(1, complexityBudget)) * 100)
  );
  const overBudget = totalComplexity > complexityBudget;

  const addSection = (type: DocSectionType, depth = 0) => {
    if (readOnly) return;
    const next = [...sections, { id: uid(), ...DEFAULT_SECTION[type], depth }];
    commit(metadata, next);
  };

  const duplicateSection = (id: string) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: DocSection) => s.id === id);
    if (idx < 0) return;
    const original = sections[idx];
    const copy: DocSection = {
      ...original,
      id: uid(),
      title: `${original.title} (copy)`,
    };
    const out = sections.slice();
    out.splice(idx + 1, 0, copy);
    commit(metadata, out);
  };

  const removeSection = (id: string) => {
    if (readOnly) return;
    commit(metadata, sections.filter((s: DocSection) => s.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: DocSection) => s.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = sections.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    // outline sanity: cannot be deeper than previous+1
    const prevDepth = j === 0 ? 0 : copy[j - 1].depth;
    if (item.depth > prevDepth + 1) item.depth = prevDepth + 1;
    commit(metadata, copy);
  };

  const indent = (id: string) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: DocSection) => s.id === id);
    if (idx < 0) return;
    const out = sections.slice();
    const prevDepth = idx === 0 ? 0 : out[idx - 1].depth;
    out[idx] = {
      ...out[idx],
      depth: clampInt(out[idx].depth + 1, 0, Math.min(4, prevDepth + 1)),
    };
    commit(metadata, out);
  };

  const outdent = (id: string) => {
    if (readOnly) return;
    const idx = sections.findIndex((s: DocSection) => s.id === id);
    if (idx < 0) return;
    const out = sections.slice();
    out[idx] = { ...out[idx], depth: clampInt(out[idx].depth - 1, 0, 4) };
    commit(metadata, out);
  };

  const updateSection = (id: string, patch: Partial<DocSection>) => {
    if (readOnly) return;
    const out = sections.map((s: DocSection) => {
      if (s.id !== id) return s;
      const nextType = (patch.type ?? s.type) as DocSectionType;
      const minForType = MIN_COMPLEXITY[nextType];
      const nextComplexity =
        patch.complexity !== undefined
          ? clampInt(
              roundToStep(patch.complexity, step),
              minForType,
              sectionMaxComplexity
            )
          : s.complexity;
      const nextDepth =
        patch.depth !== undefined ? clampInt(patch.depth, 0, 4) : s.depth;
      const nextKeywords =
        patch.keywords !== undefined
          ? patch.keywords.map((k) => k.trim()).filter(Boolean)
          : s.keywords;
      return {
        ...s,
        ...patch,
        type: nextType,
        complexity: nextComplexity,
        depth: nextDepth,
        keywords: nextKeywords,
      };
    });
    // Keep outline sane
    for (let i = 0; i < out.length; i++) {
      const prevDepth = i === 0 ? 0 : out[i - 1].depth;
      if (out[i].depth > prevDepth + 1) out[i].depth = prevDepth + 1;
    }
    commit(metadata, out);
  };

  const updateMetadata = <K extends keyof DocumentationMetadata>(
    key: K,
    val: DocumentationMetadata[K]
  ) => {
    if (readOnly) return;
    const nextMeta = { ...metadata, [key]: val };
    commit(nextMeta, sections);
  };

  const updateNested = (path: string, val: any) => {
    if (readOnly) return;
    // tiny helper to update nested metadata fields
    const nextMeta: any = JSON.parse(JSON.stringify(metadata));
    const parts = path.split(".");
    let cur = nextMeta;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = val;
    commit(nextMeta, sections);
  };

  return (
    <div className="card">
      {/* Top Summary */}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold">Documentation Editor (MkDocs)</h3>
        <div className="text-sm text-gray-700">
          Complexity budget: <b>{complexityBudget}</b> • Total:{" "}
          <b>{totalComplexity}</b>{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overBudget ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {pct}% used
          </span>
        </div>
      </div>

      <div className="mb-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overBudget ? "bg-red-500" : "bg-gray-800"}`}
          style={{
            width: `${Math.min(100, (totalComplexity / Math.max(1, complexityBudget)) * 100)}%`,
          }}
        />
      </div>

      {/* Metadata Panel */}
      <div className="mb-4 rounded-xl border p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Site & Build Settings</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Site Name</span>
            <input
              className="input"
              value={metadata.siteName}
              onChange={(e) => updateMetadata("siteName", e.target.value)}
              disabled={readOnly}
              placeholder="My Docs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Theme</span>
            <select
              className="input"
              value={metadata.theme ?? "material"}
              onChange={(e) =>
                updateMetadata("theme", e.target.value as DocumentationMetadata["theme"])
              }
              disabled={readOnly}
            >
              <option value="material">Material for MkDocs</option>
              <option value="mkdocs">Default MkDocs</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Repo URL</span>
            <input
              className="input"
              value={metadata.repoUrl ?? ""}
              onChange={(e) => updateMetadata("repoUrl", e.target.value)}
              disabled={readOnly}
              placeholder="https://github.com/org/repo"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Repo Icon</span>
            <select
              className="input"
              value={metadata.repoIcon ?? "github"}
              onChange={(e) =>
                updateMetadata(
                  "repoIcon",
                  e.target.value as DocumentationMetadata["repoIcon"]
                )
              }
              disabled={readOnly}
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="bitbucket">Bitbucket</option>
            </select>
          </label>
        </div>

        <hr className="my-4" />

        <h4 className="mb-3 text-sm font-medium text-gray-700">Versioning</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={metadata.versioning.enabled}
              onChange={(e) => updateNested("versioning.enabled", e.target.checked)}
              disabled={readOnly}
            />
            <span className="text-sm">Enable versioning</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Strategy</span>
            <select
              className="input"
              value={metadata.versioning.strategy}
              onChange={(e) =>
                updateNested("versioning.strategy", e.target.value as "mike" | "material")
              }
              disabled={readOnly}
            >
              <option value="mike">mike (git-based versions)</option>
              <option value="material">Material built-in</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Default Version</span>
            <input
              className="input"
              value={metadata.versioning.defaultVersion ?? "latest"}
              onChange={(e) => updateNested("versioning.defaultVersion", e.target.value)}
              disabled={readOnly}
              placeholder="latest"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Versions (comma separated)</span>
            <input
              className="input"
              value={metadata.versioning.versions.join(", ")}
              onChange={(e) =>
                updateNested(
                  "versioning.versions",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                )
              }
              disabled={readOnly}
              placeholder="latest, 1.0, 1.1"
            />
          </label>
        </div>

        <hr className="my-4" />

        <h4 className="mb-3 text-sm font-medium text-gray-700">API Docs (mkdocstrings)</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={metadata.api.enabled}
              onChange={(e) => updateNested("api.enabled", e.target.checked)}
              disabled={readOnly}
            />
            <span className="text-sm">Enable API Reference (mkdocstrings)</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Handlers (comma separated)</span>
            <input
              className="input"
              value={metadata.api.handlers.join(", ")}
              onChange={(e) =>
                updateNested(
                  "api.handlers",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                )
              }
              disabled={readOnly}
              placeholder="python"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Modules (comma separated)</span>
            <input
              className="input"
              value={metadata.api.modules.join(", ")}
              onChange={(e) =>
                updateNested(
                  "api.modules",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                )
              }
              disabled={readOnly}
              placeholder="my_package, my_package.sub"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-gray-500">Watch Paths (optional, comma separated)</span>
            <input
              className="input"
              value={(metadata.api.watch ?? []).join(", ")}
              onChange={(e) =>
                updateNested(
                  "api.watch",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                )
              }
              disabled={readOnly}
              placeholder="src, libs/core"
            />
          </label>
        </div>

        <hr className="my-4" />

        <h4 className="mb-3 text-sm font-medium text-gray-700">Search Configuration</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={metadata.search.boostFromComplexity}
              onChange={(e) => updateNested("search.boostFromComplexity", e.target.checked)}
              disabled={readOnly}
            />
            <span className="text-sm">
              Derive per-page search weight from complexity
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Base Weight</span>
            <input
              type="number"
              className="input"
              value={metadata.search.baseWeight}
              onChange={(e) =>
                updateNested("search.baseWeight", parseInt(e.target.value || "0", 10))
              }
              disabled={readOnly}
              min={0}
              step={1}
            />
          </label>
        </div>
      </div>

      {/* Add Sections */}
      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addSection("tutorial", 0)}>
            + Add Tutorial
          </button>
          <button className="btn" onClick={() => addSection("api_reference", 0)}>
            + Add API Reference
          </button>
          <button className="btn" onClick={() => addSection("deployment_guide", 0)}>
            + Add Deployment Guide
          </button>
          <button className="btn-secondary" onClick={() => addSection("changelog", 0)}>
            + Add Changelog
          </button>
        </div>
      )}

      {/* Sections / Nav */}
      <ul className="space-y-3">
        {sections.map((s: DocSection, idx: number) => (
          <li key={s.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[s.type]}`}
                  >
                    {TYPE_LABEL[s.type]}
                  </span>
                  <span className="text-xs text-gray-500">depth {s.depth}</span>
                </div>
                <div className="grid w-full gap-2 md:grid-cols-2">
                  <div className="flex items-center gap-2 md:col-span-2">
                    <div style={{ width: s.depth * 16 }} aria-hidden="true" />
                    <input
                      className="input !py-1 text-sm flex-1"
                      value={s.title}
                      onChange={(e) => updateSection(s.id, { title: e.target.value })}
                      disabled={readOnly}
                      placeholder={`${TYPE_LABEL[s.type]} — Page Title`}
                    />
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Path</span>
                    <input
                      className="input !py-1 text-sm"
                      value={s.path ?? ""}
                      onChange={(e) => updateSection(s.id, { path: e.target.value })}
                      disabled={readOnly}
                      placeholder="api/index.md"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Keywords (comma separated)</span>
                    <input
                      className="input !py-1 text-sm"
                      value={s.keywords.join(", ")}
                      onChange={(e) =>
                        updateSection(s.id, {
                          keywords: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      disabled={readOnly}
                      placeholder="api, auth, tokens"
                    />
                  </label>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-sm text-gray-500">{fmtComplexity(s.complexity)}</span>
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
                      disabled={idx === sections.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => indent(s.id)}
                      title="Indent (nest in nav)"
                      aria-label="Indent"
                    >
                      ⇥
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => outdent(s.id)}
                      title="Outdent"
                      aria-label="Outdent"
                    >
                      ⇤
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
                  </div>
                )}
              </div>
            </div>

            {/* Complexity / Search Boost control */}
            <ComplexitySlider
              complexity={s.complexity}
              min={MIN_COMPLEXITY[s.type]}
              max={sectionMaxComplexity}
              step={step}
              onChange={(c) => updateSection(s.id, { complexity: c })}
              disabled={readOnly}
            />

            {metadata.search.boostFromComplexity && (
              <div className="mt-2 text-xs text-gray-600">
                Search weight preview: {metadata.search.baseWeight + s.complexity}
              </div>
            )}
          </li>
        ))}
      </ul>

      {overBudget && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          You exceed the complexity budget by <b>{totalComplexity - complexityBudget}</b>. Consider
          reducing complexity or adjusting the budget.
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   SLIDER (Pointer Events; keyboard accessible) — maps to "Search Configuration"
   ========================================================================== */

function ComplexitySlider({
  complexity,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  complexity: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (c: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pct = useMemo(() => {
    const span = Math.max(1, max - min);
    return Math.max(0, Math.min(100, ((complexity - min) / span) * 100));
  }, [complexity, min, max]);

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
        const next = clampInt(roundToStep(complexity + delta, step), min, max);
        onChangeRef.current(next);
        e.preventDefault();
      }
    },
    [disabled, max, min, complexity, step]
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
        aria-label="Complexity score"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={complexity}
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
          value={complexity}
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

export type DocumentationEditorFromJSONProps = {
  /** JSON string/object from the previous stage. */
  source: string | DocumentationInputJSON;
  /** Receive normalized JSON whenever the user changes site config/nav. */
  onChangeJSON?: (json: DocumentationInputJSON) => void;
  /** Show parse diagnostics (default true). */
  showDiagnostics?: boolean;
  className?: string;
};

export function DocumentationEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: DocumentationEditorFromJSONProps) {
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    metadata: DocumentationMetadata;
    sections: DocSection[];
    config: {
      complexityBudget: number;
      step: number;
      sectionMaxComplexity: number;
      readOnly: boolean;
    };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseDocumentationJSON(source);
    return {
      metadata: res.metadata,
      sections: res.sections,
      config: res.config,
      warnings: res.warnings,
      errors: res.errors,
    };
  });

  useEffect(() => {
    const res = parseDocumentationJSON(source);
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
    ({ metadata: md, sections: secs /*, totalComplexity*/ }: DocumentationEditorValue) => {
      setState((prev) => ({ ...prev, metadata: md, sections: secs }));
      // Emit normalized JSON to the next stage
      onChangeJSON?.(serializeDocumentationToJSON(md, secs, config));
    },
    [config, onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse documentation JSON:</b>
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

      <DocumentationEditor
        value={{ metadata, sections }}
        complexityBudget={config.complexityBudget}
        step={config.step}
        sectionMaxComplexity={config.sectionMaxComplexity}
        readOnly={config.readOnly}
        onChange={handleChange}
      />
    </div>
  );
}

/** Default export: JSON-bridged component for convenience */
export default DocumentationEditorFromJSON;

/* =============================================================================
   USAGE EXAMPLE

   <DocumentationEditorFromJSON
     source={{
       complexityBudget: 120,
       step: 1,
       sectionMaxComplexity: 20,
       readOnly: false,
       metadata: {
         siteName: "Acme Docs",
         theme: "material",
         repoUrl: "https://github.com/acme/widgets",
         repoIcon: "github",
         versioning: {
           enabled: true,
           strategy: "mike",
           defaultVersion: "latest",
           versions: ["latest", "1.0", "1.1"]
         },
         api: {
           enabled: true,
           handlers: ["python"],
           modules: ["acme", "acme.core"],
           watch: ["src"]
         },
         search: {
           boostFromComplexity: true,
           baseWeight: 100
         }
       },
       sections: [
         { id: "tut1", type: "tutorial", title: "Getting Started", path: "tutorials/getting-started.md", keywords: ["start","install"], complexity: 3, depth: 0 },
         { id: "api1", type: "api_reference", title: "API Reference", path: "api/index.md", keywords: ["api"], complexity: 6, depth: 0 },
         { id: "dep1", type: "deployment_guide", title: "Kubernetes", path: "guides/k8s.md", keywords: ["k8s","deploy"], complexity: 5, depth: 0 },
         { id: "chg1", type: "changelog", title: "Changelog", path: "changelog.md", keywords: ["releases"], complexity: 2, depth: 0 }
       ]
     }}
     onChangeJSON={(json) => {
       // Send to backend / next stage (e.g., generate mkdocs.yml & nav structure)
       console.log("Updated docs JSON:", json);
     }}
   />
   ========================================================================== */
