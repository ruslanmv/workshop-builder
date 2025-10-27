import React from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";

const steps = [
  { to: "/wizard/knowledge", label: "1. Knowledge" },
  { to: "/wizard/outcomes",  label: "2. Outcomes" },
  { to: "/wizard/outline",   label: "3. Outline" },
  { to: "/wizard/review",    label: "4. Review" },
  { to: "/wizard/generate",  label: "5. Generate" },
] as const;

export default function WizardShell() {
  const { pathname } = useLocation();
  const activeIdx = steps.findIndex((s) => pathname.startsWith(s.to));
  const progressPct = Math.max(
    0,
    Math.min(100, Math.round((((activeIdx >= 0 ? activeIdx : -1) + 1) / steps.length) * 100))
  );

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workshop &amp; Book Builder</h1>
        <nav className="flex gap-2 text-sm">
          <Link to="/projects" className="btn-secondary">My Projects</Link>
          <Link to="/wizard/knowledge" className="btn">New</Link>
        </nav>
      </header>

      {/* Progress */}
      <div className="mb-6">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
          <span>Progress</span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-gray-900 transition-[width] duration-200 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <aside className="rounded-xl border bg-white p-4 shadow-sm">
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.to}>
                <NavLink
                  to={s.to}
                  className={({ isActive }) =>
                    [
                      "block rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-800 hover:bg-gray-50 border",
                    ].join(" ")
                  }
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ol>
        </aside>

        <main className="lg:col-span-3">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
