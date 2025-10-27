import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ============================================================================
   TYPES
   ============================================================================ */

export type BlockKind = "theory" | "lab" | "break";

export type ScheduleBlock = {
  id: string;
  kind: BlockKind;
  title: string;
  minutes: number; // whole minutes
};

export type ScheduleEditorValue = {
  blocks: ScheduleBlock[];
  totalMinutes: number;
};

/** JSON shape exchanged between stages */
export type ScheduleInputJSON = {
  dayBudgetMinutes?: number;
  step?: number;
  blockMaxMinutes?: number;
  readOnly?: boolean;
  blocks: Array<{
    id?: string;
    kind: string;          // validated to BlockKind at runtime
    title?: string;
    minutes: number;
  }>;
  [k: string]: unknown;    // ignore unknown fields safely
};

type Props = {
  /** Controlled blocks. If provided, the editor is fully controlled. */
  value?: ScheduleBlock[];
  /** Budget for the visible day (e.g., 6h => 360). Used only for progress/alerts (no auto-rebalance). */
  dayBudgetMinutes?: number;
  /** Called whenever user edits blocks or minutes. */
  onChange?: (v: ScheduleEditorValue) => void;
  /** Read-only mode disables all editing controls. */
  readOnly?: boolean;
  /** Minute step used by the slider and number input. */
  step?: number;
  /** Max minutes for a single block (hard clamp). */
  blockMaxMinutes?: number;
};

/* ============================================================================
   CONSTANTS & HELPERS
   ============================================================================ */

const MIN_MINUTES: Record<BlockKind, number> = {
  theory: 15,
  lab: 20,
  break: 5,
};

const DEFAULT_BLOCK: Record<BlockKind, Omit<ScheduleBlock, "id">> = {
  theory: { kind: "theory", title: "Theory Block", minutes: 45 },
  lab: { kind: "lab", title: "Lab Block", minutes: 60 },
  break: { kind: "break", title: "Break", minutes: 10 },
};

const KIND_LABEL: Record<BlockKind, string> = {
  theory: "Theory",
  lab: "Lab",
  break: "Break",
};

const KIND_BADGE: Record<BlockKind, string> = {
  theory: "bg-blue-100 text-blue-800",
  lab: "bg-emerald-100 text-emerald-800",
  break: "bg-amber-100 text-amber-800",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function roundToStep(n: number, step: number) {
  return Math.round(n / step) * step;
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/* ============================================================================
   RUNTIME VALIDATION & JSON BRIDGE
   ============================================================================ */

function asKind(x: unknown): BlockKind | null {
  return x === "theory" || x === "lab" || x === "break" ? x : null;
}
function asNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

type ParseResult = {
  config: {
    dayBudgetMinutes: number;
    step: number;
    blockMaxMinutes: number;
    readOnly: boolean;
  };
  blocks: ScheduleBlock[];
  warnings: string[];
  errors: string[];
};

/** Parse JSON (string or object) → sanitized blocks + config suitable for the editor */
export function parseScheduleJSON(
  src: string | unknown,
  defaults: { dayBudgetMinutes?: number; step?: number; blockMaxMinutes?: number; readOnly?: boolean } = {}
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

  const dayBudgetMinutes = asNumber(obj.dayBudgetMinutes) ?? defaults.dayBudgetMinutes ?? 360;
  const step = Math.max(1, asNumber(obj.step) ?? defaults.step ?? 5);
  const blockMaxMinutes = Math.max(1, asNumber(obj.blockMaxMinutes) ?? defaults.blockMaxMinutes ?? 480);
  const readOnly = typeof obj.readOnly === "boolean" ? obj.readOnly : !!defaults.readOnly;

  let rawBlocks: any[] = Array.isArray(obj.blocks) ? obj.blocks : [];
  if (rawBlocks.length === 0) {
    warnings.push("No blocks provided in JSON. Using defaults.");
    rawBlocks = [
      { kind: "theory", title: DEFAULT_BLOCK.theory.title, minutes: DEFAULT_BLOCK.theory.minutes },
      { kind: "lab", title: DEFAULT_BLOCK.lab.title, minutes: DEFAULT_BLOCK.lab.minutes },
      { kind: "break", title: DEFAULT_BLOCK.break.title, minutes: DEFAULT_BLOCK.break.minutes },
    ];
  }

  const blocks: ScheduleBlock[] = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const rb = rawBlocks[i] ?? {};
    const kind = asKind(rb.kind);
    if (!kind) {
      warnings.push(`Block ${i}: invalid "kind" (${String(rb.kind)}). Skipped.`);
      continue;
    }
    const title = asString(rb.title) ?? DEFAULT_BLOCK[kind].title;
    let minutes = asNumber(rb.minutes);
    if (minutes === null) {
      warnings.push(`Block ${i}: missing/invalid "minutes". Using default for ${kind}.`);
      minutes = DEFAULT_BLOCK[kind].minutes;
    }
    const id = asString(rb.id) ?? uid();

    // Normalize to bounds/step
    const minForKind = MIN_MINUTES[kind];
    const clamped = clampInt(roundToStep(minutes, step), minForKind, blockMaxMinutes);
    if (clamped !== minutes) {
      warnings.push(
        `Block ${i}: minutes (${minutes}) normalized to ${clamped} (min ${minForKind}, max ${blockMaxMinutes}, step ${step}).`
      );
    }

    blocks.push({ id, kind, title, minutes: clamped });
  }

  return {
    config: { dayBudgetMinutes, step, blockMaxMinutes, readOnly },
    blocks,
    warnings,
    errors,
  };
}

/** Convert editor state → JSON for the next stage */
export function serializeScheduleToJSON(
  blocks: ScheduleBlock[],
  config: { dayBudgetMinutes: number; step: number; blockMaxMinutes: number; readOnly: boolean }
): ScheduleInputJSON {
  return {
    dayBudgetMinutes: config.dayBudgetMinutes,
    step: config.step,
    blockMaxMinutes: config.blockMaxMinutes,
    readOnly: config.readOnly,
    blocks: blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      title: b.title,
      minutes: b.minutes,
    })),
  };
}

/* ============================================================================
   EDITOR (production-safe: controlled/uncontrolled + pointer events)
   ============================================================================ */

export default function ScheduleEditor({
  value,
  dayBudgetMinutes = 360,
  onChange,
  readOnly = false,
  step = 5,
  blockMaxMinutes = 480,
}: Props) {
  const isControlled = value !== undefined;

  // Uncontrolled internal state (used only when value is not provided)
  const [internalBlocks, setInternalBlocks] = useState<ScheduleBlock[]>(() => [
    { id: uid(), ...DEFAULT_BLOCK.theory },
    { id: uid(), ...DEFAULT_BLOCK.lab },
    { id: uid(), ...DEFAULT_BLOCK.break },
  ]);

  const blocks = isControlled ? (value as ScheduleBlock[]) : internalBlocks;

  const total = useMemo(
    () => blocks.reduce((acc, b) => acc + (Number.isFinite(b.minutes) ? b.minutes : 0), 0),
    [blocks]
  );

  // Single commit path to avoid re-entrant onChange loops.
  const commit = useCallback(
    (next: ScheduleBlock[]) => {
      const nextTotal = next.reduce((acc, b) => acc + (Number.isFinite(b.minutes) ? b.minutes : 0), 0);
      if (!isControlled) setInternalBlocks(next);
      onChange?.({ blocks: next, totalMinutes: nextTotal });
    },
    [isControlled, onChange]
  );

  const overBudget = total > dayBudgetMinutes;
  const pct = Math.min(100, Math.round((total / Math.max(1, dayBudgetMinutes)) * 100));

  const addBlock = (kind: BlockKind) => {
    if (readOnly) return;
    commit([...blocks, { id: uid(), ...DEFAULT_BLOCK[kind] }]);
  };

  const duplicateBlock = (id: string) => {
    if (readOnly) return;
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const original = blocks[idx];
    const copy: ScheduleBlock = { ...original, id: uid(), title: `${original.title} (copy)` };
    const out = blocks.slice();
    out.splice(idx + 1, 0, copy);
    commit(out);
  };

  const removeBlock = (id: string) => {
    if (readOnly) return;
    commit(blocks.filter((b) => b.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const copy = blocks.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(j, 0, item);
    commit(copy);
  };

  const update = (id: string, patch: Partial<ScheduleBlock>) => {
    if (readOnly) return;
    const out = blocks.map((b) => {
      if (b.id !== id) return b;
      const nextKind = (patch.kind ?? b.kind) as BlockKind;
      const minForKind = MIN_MINUTES[nextKind];
      const nextMinutes =
        patch.minutes !== undefined
          ? clampInt(roundToStep(patch.minutes, step), minForKind, blockMaxMinutes)
          : b.minutes;
      return {
        ...b,
        ...patch,
        kind: nextKind,
        minutes: nextMinutes,
      };
    });
    commit(out);
  };

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-medium">Schedule Editor</h3>
        <div className="text-sm text-gray-600">
          Day budget: <b>{fmt(total)}</b> / {fmt(dayBudgetMinutes)}{" "}
          <span
            className={`ml-2 rounded-md px-2 py-0.5 text-xs ${
              overBudget ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {pct}% used
          </span>
        </div>
      </div>

      <div className="mb-3 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${overBudget ? "bg-red-500" : "bg-gray-800"}`}
          style={{ width: `${Math.min(100, (total / Math.max(1, dayBudgetMinutes)) * 100)}%` }}
        />
      </div>

      {!readOnly && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => addBlock("theory")}>
            + Add Theory
          </button>
          <button className="btn" onClick={() => addBlock("lab")}>
            + Add Lab
          </button>
          <button className="btn-secondary" onClick={() => addBlock("break")}>
            + Add Break
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {blocks.map((b, idx) => (
          <li key={b.id} className="rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${KIND_BADGE[b.kind]}`}
                >
                  {KIND_LABEL[b.kind]}
                </span>
                <input
                  className="input !py-1 text-sm"
                  value={b.title}
                  onChange={(e) => update(b.id, { title: e.target.value })}
                  disabled={readOnly}
                  placeholder={`${KIND_LABEL[b.kind]} title`}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-gray-500">{fmt(b.minutes)}</span>
                {!readOnly && (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() => move(b.id, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => move(b.id, +1)}
                      disabled={idx === blocks.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => duplicateBlock(b.id)}
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => removeBlock(b.id)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Drag / Touch / Keyboard minutes control */}
            <MinutesSlider
              minutes={b.minutes}
              min={MIN_MINUTES[b.kind]}
              max={blockMaxMinutes}
              step={step}
              onChange={(m) => update(b.id, { minutes: m })}
              disabled={readOnly}
            />
          </li>
        ))}
      </ul>

      {overBudget && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          You are over the day budget by <b>{fmt(total - dayBudgetMinutes)}</b>. Reduce minutes or
          add another day.
        </div>
      )}
    </div>
  );
}

function MinutesSlider({
  minutes,
  min,
  max,
  step = 5,
  disabled,
  onChange,
}: {
  minutes: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (m: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Keep onChange stable inside pointer handlers
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pct = useMemo(() => {
    const span = Math.max(1, max - min);
    return Math.max(0, Math.min(100, ((minutes - min) / span) * 100));
  }, [minutes, min, max]);

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
        const next = clampInt(roundToStep(minutes + delta, step), min, max);
        onChangeRef.current(next);
        e.preventDefault();
      }
    },
    [disabled, max, min, minutes, step]
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
      // capture may already be released — ignore
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
        aria-label="Duration (minutes)"
        aria-valuemin={min}
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

/* ============================================================================
   BRIDGED COMPONENT — accepts previous-stage JSON and emits updated JSON
   ============================================================================ */

export type ScheduleEditorFromJSONProps = {
  /** JSON string or object produced by the previous stage. */
  source: string | ScheduleInputJSON;
  /** Receives normalized JSON whenever the user changes the schedule. */
  onChangeJSON?: (json: ScheduleInputJSON) => void;
  /** If true, show parse warnings/errors (default true). */
  showDiagnostics?: boolean;
  /** Optional wrapper className. */
  className?: string;
};

export function ScheduleEditorFromJSON({
  source,
  onChangeJSON,
  showDiagnostics = true,
  className,
}: ScheduleEditorFromJSONProps) {
  // Re-parse when source actually changes
  const sourceFingerprint = useMemo(() => {
    if (typeof source === "string") return source;
    try {
      return JSON.stringify(source);
    } catch {
      return "__invalid_object__";
    }
  }, [source]);

  const [state, setState] = useState<{
    blocks: ScheduleBlock[];
    config: { dayBudgetMinutes: number; step: number; blockMaxMinutes: number; readOnly: boolean };
    warnings: string[];
    errors: string[];
  }>(() => {
    const res = parseScheduleJSON(source);
    return { blocks: res.blocks, config: res.config, warnings: res.warnings, errors: res.errors };
  });

  useEffect(() => {
    const res = parseScheduleJSON(source);
    setState({ blocks: res.blocks, config: res.config, warnings: res.warnings, errors: res.errors });
  }, [sourceFingerprint]);

  const { blocks, config, warnings, errors } = state;

  const handleChange = useCallback(
    ({ blocks: nextBlocks }: ScheduleEditorValue) => {
      setState((prev) => ({ ...prev, blocks: nextBlocks }));
      onChangeJSON?.(serializeScheduleToJSON(nextBlocks, config));
    },
    [config, onChangeJSON]
  );

  return (
    <div className={className}>
      {showDiagnostics && (errors.length > 0 || warnings.length > 0) && (
        <div className="mb-3 space-y-2">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <b>Failed to fully parse schedule JSON:</b>
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

      <ScheduleEditor
        value={blocks}
        dayBudgetMinutes={config.dayBudgetMinutes}
        step={config.step}
        blockMaxMinutes={config.blockMaxMinutes}
        readOnly={config.readOnly}
        onChange={handleChange}
      />
    </div>
  );
}

/* ============================================================================
   USAGE (example)
   ----------------------------------------------------------------------------
   // 1) Populate from previous stage:
   <ScheduleEditorFromJSON
     source={{
       dayBudgetMinutes: 420,
       step: 5,
       blockMaxMinutes: 240,
       readOnly: false,
       blocks: [
         { id: "a1", kind: "theory", title: "Kinematics", minutes: 50 },
         { id: "b2", kind: "lab", title: "Projectile Lab", minutes: 75 },
         { id: "c3", kind: "break", minutes: 10 }
       ]
     }}
     // 2) Receive updated JSON for the next stage:
     onChangeJSON={(json) => {
       // send to backend / next stage
       console.log("Updated schedule JSON:", json);
     }}
   />

   // Or provide a JSON string:
   <ScheduleEditorFromJSON source='{"dayBudgetMinutes":360,"blocks":[{"kind":"theory","minutes":40},{"kind":"lab","minutes":60},{"kind":"break","minutes":10}]}' />
   ============================================================================ */
