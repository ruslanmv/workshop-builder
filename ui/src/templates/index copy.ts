// workshop_builder/ui/src/templates/index.ts
import type { ProjectType } from "../store";

type TemplateMeta = {
  /** ProjectType from store (we keep ebook variants under "book" to match types) */
  type: ProjectType; // "book" | "workshop" | "mkdocs" | "journal" | "proceedings" | "blog"
  id: string;
  label: string;
  blurb: string;
};

export type TemplateFile<T = unknown> = {
  meta: TemplateMeta;
  /** Editor-specific input JSON payload (ScheduleInputJSON, BookInputJSON, etc.) */
  payload: T;
};

// Eagerly import all JSON templates at build time (Vite).
const raw = import.meta.glob("./**/*.json", { eager: true, import: "default" }) as Record<
  string,
  TemplateFile
>;

// Normalize to a dictionary by "<type>:<id>"
const byKey = Object.values(raw).reduce<Record<string, TemplateFile>>((acc, file) => {
  const key = `${file.meta.type}:${file.meta.id}`;
  acc[key] = file;
  return acc;
}, {});

export function listTemplates(type?: ProjectType) {
  const all = Object.values(byKey).map((f) => f.meta);
  return type ? all.filter((m) => m.type === type) : all;
}

export function getTemplate<T = unknown>(type: ProjectType, id: string): TemplateFile<T> | undefined {
  return byKey[`${type}:${id}`] as TemplateFile<T> | undefined;
}
