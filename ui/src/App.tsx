// workshop_builder/ui/src/App.tsx
import React from "react";
import {
  Link,
  Outlet,
  useLocation,
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";

import Step1Knowledge from "./routes/steps/Step1Knowledge";
import Step2Outcome from "./routes/steps/Step2Outcome";
import Step3Outline from "./routes/steps/Step3Outline";
import Step4Review from "./routes/steps/Step4Review";
import Step5Generate from "./routes/steps/Step5Generate";

import Settings from "./routes/settings";
import Docs from "./routes/docs";
import Support from "./routes/support";

import { useStore } from "./store";
import "./styles.css";

/* ----------------------------------------------------------------------------
 *                                   Layout
 * -------------------------------------------------------------------------- */

const WIZARD_STEPS = [
  { to: "/wizard/intake", label: "1) Knowledge" },
  { to: "/wizard/intent", label: "2) Outcomes" },
  { to: "/wizard/outline", label: "3) Outline" },
  { to: "/wizard/review", label: "4) Review" },
  { to: "/wizard/generate", label: "5) Generate" },
] as const;

function WizardShell() {
  const location = useLocation();
  const activeIdx = Math.max(
    0,
    WIZARD_STEPS.findIndex((s) => location.pathname.startsWith(s.to))
  );
  const progressPct = Math.round(((activeIdx + 1) / WIZARD_STEPS.length) * 100);

  return (
    <div className="min-h-screen site-bg text-gray-900">
      <HeaderHero />

      {/* Tabs + Progress */}
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <StepNav activePath={location.pathname} />
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-700">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 pb-12 pt-6 md:px-8">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}

function HeaderHero() {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 hero-gradient animated-gradient" />
      <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -left-16 bottom-0 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />

      <header className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-12">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="text-white">
            <div className="text-xs uppercase tracking-widest text-gray-300">
              Multi-Agent Content Studio
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
              Workshop &amp; Book Builder
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-300 md:text-base">
              Ingest knowledge (files, GitHub, web), design outcomes (Workshop, MkDocs, Book, Journal),
              preview an AI-drafted outline, then generate Springer/EPUB/PDF/MkDocs deliverables.
              Powered by your LLM backend (watsonx.ai / OpenAI).
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link to="/wizard/intake" className="hero-cta hero-cta-primary">
              Start New
            </Link>
            <Link to="/projects" className="hero-cta hero-cta-secondary">
              My Projects
            </Link>
          </div>
        </div>
      </header>
    </div>
  );
}

function StepNav({ activePath }: { activePath: string }) {
  return (
    <nav className="mt-4 flex flex-wrap gap-2">
      {WIZARD_STEPS.map((t, i) => {
        const active = activePath.startsWith(t.to);
        return (
          <Link key={t.to} to={t.to} className={["tab", active ? "tab-active" : ""].join(" ")}>
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">
              {i + 1}
            </span>
            {t.label.replace(")", ".")}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer() {
  return (
    <footer className="border-t bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-6 text-xs text-gray-700 md:px-8">
        <div>© {new Date().getFullYear()} Workshop Builder</div>
        <div className="flex items-center gap-3">
          <Link className="hover:text-gray-900" to="/settings">Settings</Link>
          <Link className="hover:text-gray-900" to="/docs">Docs</Link>
          <Link className="hover:text-gray-900" to="/support">Support</Link>
        </div>
      </div>
    </footer>
  );
}

/* ----------------------------------------------------------------------------
 *                                Projects Page
 * -------------------------------------------------------------------------- */

function ProjectsPage() {
  const projects = useStore((s) => s.projects);
  const ids = Object.keys(projects).sort(
    (a, b) => (projects[b].createdAt || 0) - (projects[a].createdAt || 0)
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-8 md:px-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-600">Library</div>
          <h2 className="text-xl font-semibold">Projects</h2>
        </div>
        <Link to="/wizard/intake" className="btn">+ New</Link>
      </div>

      {ids.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-gray-700 shadow-sm">
          No saved projects yet. Use the wizard to create one.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ids.map((id) => {
            const p = projects[id];
            return (
              <li key={id} className="card card-hover">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Link to="/wizard/outline" className="btn-secondary">Open</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 *                              Router definition
 * -------------------------------------------------------------------------- */

export const router = createBrowserRouter([
  {
    path: "/",
    element: <WizardShell />,
    children: [
      { index: true, element: <Step1Knowledge /> },
      { path: "wizard/intake", element: <Step1Knowledge /> },
      { path: "wizard/intent", element: <Step2Outcome /> },
      { path: "wizard/outline", element: <Step3Outline /> },
      { path: "wizard/review", element: <Step4Review /> },
      { path: "wizard/generate", element: <Step5Generate /> },
      // Static pages
      { path: "settings", element: <Settings /> },
      { path: "docs", element: <Docs /> },
      { path: "support", element: <Support /> },
    ],
  },
  { path: "/projects", element: <ProjectsPage /> },
]);

/* ----------------------------------------------------------------------------
 *                         App wrapper (RouterProvider)
 * -------------------------------------------------------------------------- */

export default function App() {
  return <RouterProvider router={router} />;
}
