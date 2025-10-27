// workshop_builder/ui/src/store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

// EXTENDED TYPES
export type ProjectType =
  | "book"
  | "workshop"
  | "mkdocs"
  | "journal"
  | "proceedings"
  | "blog";

export type OutputFormat = "springer" | "epub" | "pdf" | "mkdocs";

export type IntakeData = {
  collection?: string;
  lastIngest?: unknown;
  docmap?: unknown;
};

export type IntentData = {
  projectType?: ProjectType;
  outputs: OutputFormat[];
  title?: string;
  subtitle?: string;
  authors?: string[];
  audience?: string;
  tone?: string;
  constraints?: string; // we also store template tags here: template:<type>:<id>
  due?: string;
  /** optional editorial preset (eg: springer/oxford/acm/ieee), used for Book/Journal */
  editorialPreset?: "springer" | "oxford" | "acm" | "ieee";
};

// Keep this aligned with what editors may persist (type-specific normalized JSONs)
export type OutlineData = {
  /** Free-form AI plan (chapters/labs/pages) */
  plan?: unknown;

  /** A generic normalized copy if a caller wants to keep one */
  planNormalized?: unknown;

  /** Type-specific normalized payloads */
  scheduleJson?: unknown;     // workshops
  manuscriptJson?: unknown;   // books
  docsiteJson?: unknown;      // mkdocs sites
  journalJson?: unknown;      // journal articles
  proceedingsJson?: unknown;  // conference proceedings
  blogJson?: unknown;         // blog posts

  approved?: boolean;
};

export type GenerationData = {
  jobId?: string;
  progress?: number; // 0..100
  artifacts?: { label: string; href: string }[];
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  intake: IntakeData;
  intent: IntentData;
  outline: OutlineData;
  generation: GenerationData;
};

export type State = {
  currentId?: string;
  projects: Record<string, Project>;
  setCurrent: (id: string) => void;
  upsert: (p: Partial<Project> & { id: string; name?: string }) => void;
  mutate: (id: string, fn: (p: Project) => void) => void;
  remove: (id: string) => void;
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      projects: {},
      currentId: undefined,

      setCurrent: (id: string) => set({ currentId: id }),

      upsert: (patch) =>
        set((state) => {
          const prev = state.projects[patch.id];
          const base: Project =
            prev ?? {
              id: patch.id,
              name: "Untitled",
              createdAt: Date.now(),
              intake: {},
              intent: { outputs: [] },
              outline: {},
              generation: {},
            };

          const merged: Project = {
            ...base,
            name: patch.name ?? base.name,
            createdAt: base.createdAt ?? Date.now(),
            intake: { ...base.intake, ...(patch.intake ?? {}) },
            intent: { ...base.intent, ...(patch.intent ?? {}) },
            outline: { ...base.outline, ...(patch.outline ?? {}) },
            generation: { ...base.generation, ...(patch.generation ?? {}) },
          };

          return {
            projects: { ...state.projects, [patch.id]: merged },
            currentId: state.currentId ?? patch.id,
          };
        }),

      mutate: (id, fn) =>
        set((state) => {
          const current = state.projects[id];
          if (!current) return state;
          const next: Project = JSON.parse(JSON.stringify(current));
          fn(next);
          return { projects: { ...state.projects, [id]: next } };
        }),

      remove: (id) =>
        set((state) => {
          if (!(id in state.projects)) return state;
          const { [id]: _omit, ...rest } = state.projects;
          return {
            projects: rest,
            currentId: state.currentId === id ? undefined : state.currentId,
          };
        }),
    }),
    { name: "wb-projects.v1", version: 1 }
  )
);
