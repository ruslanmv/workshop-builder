// workshop_builder/ui/src/templates/index.ts
import type { ProjectType } from "../store";

type TemplateMeta = {
  type: ProjectType;
  id: string;
  label: string;
  blurb: string;
};

export type TemplateFile<T = unknown> = {
  meta: TemplateMeta;
  payload: T;
};

// Eager glob of all JSON templates. Vite inlines them at build time.
const modules = import.meta.glob("./**/*.json", { eager: true, import: "default" });
// Each module is the JSON's default export (the actual object).
const byPath = modules as Record<string, TemplateFile>;

const byKey = Object.values(byPath).reduce<Record<string, TemplateFile>>((acc, file) => {
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
