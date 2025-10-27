// workshop_builder/ui/src/components/editors/registry.ts

// workshop_builder/ui/src/components/editors/registry.ts
import React, { lazy } from "react";
import type { Project } from "../../store";

export type OutlineEditorProps = {
  project: Project;
  /** Normalized JSON (type-specific) emitted upstream */
  onPlanChange?: (plan: unknown) => void;
};

type OutlineEditorComponent = React.ComponentType<OutlineEditorProps>;

export function pickEditor(project: Project): { Component: OutlineEditorComponent } {
  const type = project.intent?.projectType ?? "book";
  const outputs = project.intent?.outputs ?? [];

  switch (type) {
    case "workshop":
      return { Component: lazy(() => import("../WorkshopEditorBridge")) as unknown as OutlineEditorComponent };
    case "mkdocs":
      return { Component: lazy(() => import("../DocumentationEditor")) as unknown as OutlineEditorComponent };
    case "journal":
      return { Component: lazy(() => import("../JournalEditor")) as unknown as OutlineEditorComponent };
    case "proceedings":
      return { Component: lazy(() => import("../SubmissionEditor")) as unknown as OutlineEditorComponent };
    case "blog":
      return { Component: lazy(() => import("../BlogEditor")) as unknown as OutlineEditorComponent };
    case "book":
    default: {
      // For books, choose between EPUB-first or Manuscript-first
      if (outputs.includes("epub")) {
        return { Component: lazy(() => import("../EbookEditor")) as unknown as OutlineEditorComponent };
      }
      return { Component: lazy(() => import("../ManuscriptEditor")) as unknown as OutlineEditorComponent };
    }
  }
}
