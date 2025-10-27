// workshop_builder/ui/src/components/WorkshopEditorBridge.tsx

import React, { useMemo } from "react";
import type { Project } from "../store";
import {
  ScheduleEditorFromJSON,
  type ScheduleInputJSON,
} from "./ScheduleEditor";

// Keep this identical to the OutlineEditorProps the registry uses
export type OutlineEditorProps = {
  project: Project;
  /** Emits normalized JSON (agenda) upstream so the store / caller can persist it */
  onPlanChange?: (plan: unknown) => void;
};

const DEFAULT_SCHEDULE: ScheduleInputJSON = {
  dayBudgetMinutes: 360,
  step: 5,
  blockMaxMinutes: 480,
  readOnly: false,
  blocks: [
    { kind: "theory", title: "Introductions & Goals", minutes: 30 },
    { kind: "lab", title: "Environment Setup", minutes: 60 },
    { kind: "break", title: "Coffee Break", minutes: 10 },
    { kind: "theory", title: "Core Concepts", minutes: 45 },
  ],
};

export default function WorkshopEditorBridge({ project, onPlanChange }: OutlineEditorProps) {
  // Prefer a previously saved/AI-proposed agenda JSON if present
  const scheduleSource: string | ScheduleInputJSON = useMemo(() => {
    const fromOutline = project?.outline?.scheduleJson as ScheduleInputJSON | string | undefined;
    const fromPlan = (project?.outline?.plan as any)?.schedule as ScheduleInputJSON | undefined;
    return fromOutline || fromPlan || DEFAULT_SCHEDULE;
  }, [project]);

  const title =
    project?.intent?.title ||
    project?.name ||
    project?.id ||
    "Workshop Agenda";

  return (
    <section className="space-y-4">
      <div className="card">
        <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Workshop</div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">
          Adjust the daily agenda (theory, lab, breaks). Your edits will be serialized to JSON and
          used by the next stage (review & generate).
        </p>
      </div>

      <div className="card">
        <h3 className="mb-2 text-base font-semibold">Daily Agenda</h3>
        <ScheduleEditorFromJSON
          source={scheduleSource}
          onChangeJSON={(normalizedJson: ScheduleInputJSON) => {
            // Push normalized JSON upstream; caller (e.g., Step3Outline) will persist to store
            onPlanChange?.(normalizedJson);
          }}
        />
      </div>
    </section>
  );
}
