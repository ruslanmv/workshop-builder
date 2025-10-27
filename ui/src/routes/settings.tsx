// workshop_builder/ui/src/routes/settings.tsx
import React, { useEffect, useMemo, useState } from "react";

type HealthPayload = {
  ok: boolean;
  service: string;
  provider?: string;
  a2a_base?: string;
  env_loaded?: string;
};

type Ping = { status: "idle" | "loading" | "up" | "down"; ms?: number; error?: string };

export default function Settings() {
  const [api, setApi] = useState<Ping>({ status: "loading" });
  const [a2a, setA2a] = useState<Ping>({ status: "idle" });
  const [meta, setMeta] = useState<Partial<HealthPayload>>({});

  // ping /api/health (Flask)
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const t0 = performance.now();
    setApi({ status: "loading" });
    fetch("/api/health", { signal: ctrl.signal })
      .then(async (r) => {
        const ms = Math.max(1, Math.round(performance.now() - t0));
        if (!alive) return;
        if (!r.ok) {
          setApi({ status: "down", ms, error: `${r.status} ${r.statusText}` });
          return;
        }
        const data = (await r.json()) as HealthPayload;
        setMeta(data);
        setApi({ status: data.ok ? "up" : "down", ms });
        // opportunistic A2A probe if base is present
        if (data?.a2a_base) {
          pingA2A(data.a2a_base).catch(() => void 0);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setApi({ status: "down", error: String(err?.message || err) });
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // probe A2A base if provided (optional)
  const pingA2A = async (base: string) => {
    if (!base) return;
    setA2a({ status: "loading" });
    const url = base.replace(/\/+$/, "") + "/health";
    const t0 = performance.now();
    try {
      const r = await fetch(url, { mode: "cors" as RequestMode });
      const ms = Math.max(1, Math.round(performance.now() - t0));
      if (!r.ok) return setA2a({ status: "down", ms, error: `${r.status} ${r.statusText}` });
      setA2a({ status: "up", ms });
    } catch (e: any) {
      setA2a({ status: "down", error: String(e?.message || e) });
    }
  };

  const apiBadge = useMemo(() => <StatusPill label="API" ping={api} />, [api]);
  const a2aBadge = useMemo(
    () => <StatusPill label="A2A" ping={a2a.status === "idle" && meta?.a2a_base ? { status: "loading" } : a2a} />,
    [a2a, meta?.a2a_base]
  );

  return (
    <section className="space-y-6">
      {/* Dark hero, consistent with other steps */}
      <div className="relative overflow-hidden rounded-xl hero-gradient animated-gradient px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">System</div>
          <h2 className="mt-1 text-2xl font-semibold">Settings &amp; Health</h2>
          <p className="mt-2 text-sm text-gray-300">
            Check API availability, agent stack details, and environment hints. Use this page to verify your backend
            before running multi-agent generation.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl space-y-4">
        {/* Status overview */}
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Health</div>
              <h3 className="text-base font-semibold">Service Status</h3>
            </div>
            <div className="flex items-center gap-2">
              {apiBadge}
              {a2aBadge}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 p-4 text-sm md:grid-cols-2">
            <Row label="Provider" value={meta.provider || "—"} />
            <Row label="A2A Base" value={meta.a2a_base || "—"} />
            <Row label="Environment File" value={meta.env_loaded || "—"} />
            <Row
              label="Actions"
              value={
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-outline"
                    onClick={() => window.location.reload()}
                    title="Reload the page"
                  >
                    Refresh Page
                  </button>
                  <button
                    className="btn-outline"
                    onClick={() => pingA2A(String(meta.a2a_base || ""))}
                    disabled={!meta.a2a_base}
                    title="Probe the A2A health endpoint"
                  >
                    Probe A2A
                  </button>
                </div>
              }
            />
          </div>
        </div>

        {/* Stack info + icons */}
        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Stack</h3>
          <p className="mb-3 text-sm text-gray-600">
            Universal A2A agent + Flask API + Vite React UI. Optional CrewAI planners and watsonx.ai/OpenAI model
            providers.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <a href="https://www.python.org" target="_blank" rel="noreferrer" className="opacity-80 hover:opacity-100">
              <img
                src="https://raw.githubusercontent.com/devicons/devicon/master/icons/python/python-original.svg"
                alt="Python"
                width={60}
                height={60}
              />
            </a>
            <a href="https://www.docker.com/" target="_blank" rel="noreferrer" className="opacity-80 hover:opacity-100">
              <img
                src="https://raw.githubusercontent.com/devicons/devicon/master/icons/docker/docker-original-wordmark.svg"
                alt="Docker"
                width={60}
                height={60}
              />
            </a>
            <a href="https://vitejs.dev" target="_blank" rel="noreferrer" className="opacity-80 hover:opacity-100">
              <img
                src="https://raw.githubusercontent.com/devicons/devicon/master/icons/vitejs/vitejs-original.svg"
                alt="Vite"
                width={60}
                height={60}
              />
            </a>
          </div>
        </div>

        {/* Tips */}
        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Tips</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            <li>Ensure your <code>.env</code> has provider credentials if retrieval or generation uses LLMs.</li>
            <li>Run A2A and the Flask API together (<code>make serve-all</code>) or via Docker Compose.</li>
            <li>If A2A is remote, enable CORS for the UI origin.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ label, ping }: { label: string; ping: Ping }) {
  const { status, ms, error } = ping;
  const color =
    status === "up" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : status === "loading" ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-rose-100 text-rose-800 border-rose-200";
  const text =
    status === "up" ? `${label}: UP${ms ? ` (${ms}ms)` : ""}`
    : status === "loading" ? `${label}: Checking…`
    : `${label}: DOWN${error ? ` (${error})` : ""}`;
  return <span className={`pill ${color}`}>{text}</span>;
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  const v = value ?? "—";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-[140px] shrink-0 text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="flex-1 text-gray-800">{v}</div>
    </div>
  );
}
