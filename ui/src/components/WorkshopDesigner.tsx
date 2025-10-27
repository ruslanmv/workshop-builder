import React, { useCallback, useMemo, useState, useEffect } from "react";
import ScheduleEditor, { ScheduleBlock } from "./ScheduleEditor";
import type { DocMapLike } from "./PlanPreview";

/**
 * WorkshopDesigner (modernized)
 * - Drafted numeric inputs to avoid flicker while typing
 * - Debounced day budget for a smooth progress bar
 * - Clean, accessible UI with clear validation feedback
 */

type ModuleItem = {
  id: string;
  title: string;
  objectives: string[]; // bullet lines
};

type WorkshopPlanPayload = {
  title: string;
  days: number;
  hours_per_day: number;
  schedule_blocks: ScheduleBlock[];
  modules: Array<{ title: string; objectives: string[] }>;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function WorkshopDesigner({ docmap }: { docmap?: DocMapLike | null }) {
  const [title, setTitle] = useState("Agentic AI Workshop");
  const [days, setDays] = useState(2);
  const [hoursPerDay, setHoursPerDay] = useState(6);

  // Drafted numeric fields (commit on Enter/blur, ESC to revert)
  const daysField = useNumberField({ value: days, min: 1, onCommit: setDays });
  const hoursField = useNumberField({ value: hoursPerDay, min: 1, onCommit: setHoursPerDay });

  // Debounce budget to avoid progress bar jumping while the user types
  const dayBudgetMinutes = useDebounced(Math.max(1, hoursPerDay) * 60, 150);

  const [modules, setModules] = useState<ModuleItem[]>([
    { id: uid(), title: "Foundations & Safety", objectives: ["Understand agent loop", "Set guardrails"] },
    { id: uid(), title: "RAG & Evaluation", objectives: ["Index docs", "Evaluate retrieval quality"] },
  ]);
  const [blocks, setBlocks] = useState<ScheduleBlock[] | undefined>(undefined);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const totals = useMemo(() => {
    const m = (blocks || []).reduce(
      (acc, b) => {
        acc[b.kind] = (acc[b.kind] || 0) + b.minutes;
        acc.total += b.minutes;
        return acc;
      },
      { theory: 0, lab: 0, break: 0, total: 0 } as Record<string, number>
    );
    return m;
  }, [blocks]);

  const overBudget = totals.total > dayBudgetMinutes;

  const addModule = () => {
    setModules((arr) => [...arr, { id: uid(), title: "New Module", objectives: [] }]);
  };
  const removeModule = (id: string) => {
    setModules((arr) => arr.filter((m) => m.id !== id));
  };
  const updateModuleTitle = (id: string, t: string) => {
    setModules((arr) => arr.map((m) => (m.id === id ? { ...m, title: t } : m)));
  };
  const setObjectivesText = (id: string, text: string) => {
    const lines = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setModules((arr) => arr.map((m) => (m.id === id ? { ...m, objectives: lines } : m)));
  };

  const validate = useCallback(() => {
    if (!title.trim()) throw new Error("Title is required.");
    if (days < 1) throw new Error("Days must be at least 1.");
    if (hoursPerDay < 1) throw new Error("Hours per day must be ≥ 1.");
    if (!blocks?.length) throw new Error("Add at least one schedule block.");
    if (overBudget) throw new Error("Schedule exceeds day budget.");
    const empty = modules.find((m) => !m.title.trim());
    if (empty) throw new Error("All modules must have a title.");
    return true;
  }, [title, days, hoursPerDay, blocks, overBudget, modules]);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      validate();

      const payload: WorkshopPlanPayload = {
        title: title.trim(),
        days,
        hours_per_day: hoursPerDay,
        schedule_blocks: blocks || [],
        modules: modules.map((m) => ({ title: m.title.trim(), objectives: m.objectives })),
      };

      const res = await fetch("/api/workshops/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data && (data.error || data.message)) || res.statusText || "Save failed");
      setOk("Workshop plan validated and saved.");
    } catch (e: any) {
      setErr(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [blocks, days, hoursPerDay, modules, title, validate]);

  // Keep number-field drafts in sync if parent state changes externally
  useEffect(() => {
    daysField.setExternal(days);
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    hoursField.setExternal(hoursPerDay);
  }, [hoursPerDay]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <h2 className="mb-3 text-lg font-medium">Workshop Designer</h2>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">Workshop Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">
            {docmap?.files?.length
              ? `Context files available: ${docmap.files.length}`
              : "Analyze a repo to populate context."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Days</label>
            <input
              className="input"
              value={daysField.draft}
              onChange={(e) => daysField.onChange(e.target.value)}
              onBlur={daysField.onBlur}
              onKeyDown={daysField.onKeyDown}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="label">Hours / day</label>
            <input
              className="input"
              value={hoursField.draft}
              onChange={(e) => hoursField.onChange(e.target.value)}
              onBlur={hoursField.onBlur}
              onKeyDown={hoursField.onKeyDown}
              inputMode="decimal"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ScheduleEditor
          value={blocks}
          dayBudgetMinutes={dayBudgetMinutes}
          onChange={(v) => setBlocks(v.blocks)}
        />
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm text-gray-700 md:grid-cols-4">
          <Metric label="Theory" minutes={totals.theory} />
          <Metric label="Lab" minutes={totals.lab} />
          <Metric label="Break" minutes={totals.break} />
          <Metric label="Total" minutes={totals.total} warn={overBudget} />
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold">Modules & Objectives</h3>
          <button className="btn" onClick={addModule}>
            + Add Module
          </button>
        </div>
        <ul className="space-y-3">
          {modules.map((m, idx) => (
            <li key={m.id} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    {idx + 1}
                  </span>
                  <input
                    className="input !py-1"
                    value={m.title}
                    onChange={(e) => updateModuleTitle(m.id, e.target.value)}
                    placeholder="Module title"
                  />
                </div>
                <button className="btn-secondary" onClick={() => removeModule(m.id)}>
                  Remove
                </button>
              </div>
              <label className="label text-xs">Objectives (one per line)</label>
              <textarea
                className="input h-28"
                value={(m.objectives || []).join("\n")}
                onChange={(e) => setObjectivesText(m.id, e.target.value)}
                placeholder={"Explain X\nHands-on Y\nEvaluate Z"}
              />
            </li>
          ))}
        </ul>
      </div>

      {err && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}
      {ok && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
          {ok}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Validating…" : "Validate & Save"}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            try {
              validate();
              const message = document.createElement("div");
              message.className =
                "fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50";
              message.innerHTML = `
                <div class="rounded-lg bg-white p-6 shadow-xl w-80">
                  <h3 class="text-lg font-bold mb-3">Validation Success</h3>
                  <p>Looks good ✅</p>
                  <button class="mt-4 btn w-full" onclick="this.closest('.fixed').remove()">Close</button>
                </div>
              `;
              document.body.appendChild(message);
            } catch (e: any) {
              const message = document.createElement("div");
              message.className =
                "fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50";
              message.innerHTML = `
                <div class="rounded-lg bg-white p-6 shadow-xl w-80">
                  <h3 class="text-lg font-bold mb-3 text-red-600">Validation Error</h3>
                  <p class="text-sm text-red-700">${e.message || "Invalid"}</p>
                  <button class="mt-4 btn w-full" onclick="this.closest('.fixed').remove()">Close</button>
                </div>
              `;
              document.body.appendChild(message);
            }
          }}
        >
          Quick Validate
        </button>
      </div>
    </div>
  );
}

function Metric({
  label,
  minutes,
  warn = false,
}: {
  label: string;
  minutes: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-base font-semibold ${warn ? "text-red-700" : "text-gray-800"}`}>
        {fmt(minutes)}
      </div>
    </div>
  );
}

function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

/* -------------------------------------------------------------------------- */
/*                        Local lightweight helper hooks                      */
/* -------------------------------------------------------------------------- */

function useDebounced<T>(value: T, delayMs = 150): T {
  const [val, setVal] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setVal(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return val;
}

function clampNum(n: number, min?: number, max?: number) {
  let v = n;
  if (typeof min === "number") v = Math.max(min, v);
  if (typeof max === "number") v = Math.min(max, v);
  return v;
}

/**
 * Drafted number field:
 * - Keeps a string draft while typing
 * - Commit with Enter/blur; ESC reverts
 */
function useNumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // When external value changes, reflect in draft
  const setExternal = (n: number) => setDraft(String(n));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampNum(parsed, min, max);
    onCommit(clamped);
    setDraft(String(clamped));
  }, [draft, max, min, onCommit, value]);

  const onChange = (raw: string) => {
    // Allow digits and one dot, strip others
    const cleaned = raw.replace(/[^\d.]/g, "");
    // avoid multiple dots
    const onceDot = cleaned.split(".").length > 2 ? cleaned.replace(/\.+$/, "") : cleaned;
    setDraft(onceDot);
  };

  const onBlur = () => commit();

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      setDraft(String(value));
    }
  };

  return { draft, onChange, onBlur, onKeyDown, setExternal };
}
