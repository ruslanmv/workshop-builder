import { useCallback, useState } from "react";

/** Commit-on-blur number field with clamping & fallback. */
export function useNumberField(opts: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
}) {
  const { value, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, onCommit } = opts;
  const [draft, setDraft] = useState(String(value));

  // keep draft in sync if outer value changes elsewhere
  const sync = useCallback(
    (v: number) => setDraft(String(v)),
    []
  );

  const onChange = useCallback((s: string) => setDraft(s), []);
  const commit = useCallback(() => {
    const n = Number(draft);
    const next = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }, [draft, max, min, onCommit, value]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setDraft(String(value));
        e.currentTarget.blur();
      }
    },
    [value]
  );

  return { draft, onChange, onBlur: commit, onKeyDown, sync };
}
