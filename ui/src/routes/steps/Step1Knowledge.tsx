// workshop_builder/ui/src/routes/steps/Step1Knowledge.tsx
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../store";
import api from "../../lib/api";
import { IconUpload, IconGlobe, IconGithub } from "../../components/icons/Icons";

type IngestMode = "upload" | "github" | "internet" | "web";

export default function Step1Knowledge() {
  const nav = useNavigate();
  const upsert = useStore((s) => s.upsert);
  const currentId = useStore((s) => s.currentId) || "draft";
  const project = useStore((s) => (s.currentId ? s.projects[s.currentId] : undefined));

  const [mode, setMode] = useState<IngestMode>("upload");
  const [collection, setCollection] = useState(
    (project?.intake?.collection as string) || "workshop_docs"
  );

  // Status & feedback
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const headline = "Stage 1 — Knowledge";
  const subline =
    "Choose where your content comes from. Upload files, point to GitHub, fetch from the web, or search the web with an LLM grounded in your chosen source of truth.";

  const onIngest = useCallback(
    async (payload: any) => {
      setBusy(true);
      setError("");
      setMessage("Ingesting…");
      try {
        const body = { collection, ...payload };
        const res = await api.ingest(body);
        setMessage("Ingest complete.");
        upsert({
          id: currentId,
          intake: {
            ...(project?.intake || {}),
            collection,
            lastIngest: { at: Date.now(), mode, response: res },
          },
        });
      } catch (e: any) {
        setError(e?.message || "Failed to ingest.");
      } finally {
        setBusy(false);
      }
    },
    [collection, currentId, mode, project?.intake, upsert]
  );

  const actionButton =
    mode === "upload" ? "Upload & Index" :
    mode === "github" ? "Clone & Index" :
    mode === "internet" ? "Fetch & Index" :
    "Search & Index";

  return (
    <section className="space-y-6">
      {/* Full-bleed black hero (uniform with other stages) */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Stage 1</div>
          <h2 className="mt-1 text-2xl font-semibold">{headline}</h2>
          <p className="mt-2 text-sm text-gray-300">{subline}</p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      {/* Source selector */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <FeatureCard
          active={mode === "upload"}
          onClick={() => setMode("upload")}
          icon={<IconUpload className="text-blue-600" size={22} />}
          title="Upload Documents"
          text="PDF, Markdown, Jupyter… Drag & drop or browse."
        />
        <FeatureCard
          active={mode === "github"}
          onClick={() => setMode("github")}
          icon={<IconGithub className="text-gray-800" size={22} />}
          title="GitHub Repository"
          text="Clone and index code & docs."
        />
        <FeatureCard
          active={mode === "internet"}
          onClick={() => setMode("internet")}
          icon={<IconGlobe className="text-emerald-700" size={22} />}
          title="From the Internet"
          text="Crawl one or many URLs."
        />
        <FeatureCard
          active={mode === "web"}
          onClick={() => setMode("web")}
          icon={<IconGlobe className="text-purple-700" size={22} />}
          title="Web Search + LLM"
          text="Search the web; choose LLM & grounding."
        />
      </div>

      {/* Dynamic form panel */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <h3 className="mb-1 text-base font-semibold">Ingest Options</h3>
            <p className="text-xs text-gray-600">
              Configure your source. We’ll chunk & index into your collection.
            </p>
          </div>
          <div>
            <label className="label">Collection</label>
            <input
              className="input"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              placeholder="workshop_docs"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Used for retrieval and previews in later stages.
            </p>
          </div>
        </div>

        {mode === "upload" && <UploadPanel onSubmit={onIngest} disabled={busy} />}
        {mode === "github" && <GithubPanel onSubmit={onIngest} disabled={busy} />}
        {mode === "internet" && <InternetPanel onSubmit={onIngest} disabled={busy} />}
        {mode === "web" && <WebSearchPanel onSubmit={onIngest} disabled={busy} />}

        {/* Footer actions & feedback */}
        <div className="mt-5 flex items-center justify-between">
          <button className="btn-secondary" onClick={() => nav("/projects")}>
            ← Back to Projects
          </button>

          <div className="flex items-center gap-3">
            {busy && (
              <span className="text-xs text-gray-600">Working…</span>
            )}
            {error && <span className="text-xs text-red-600">{error}</span>}
            {!error && message && <span className="text-xs text-emerald-700">{message}</span>}

            <button
              className={["btn", busy ? "opacity-60 pointer-events-none" : ""].join(" ")}
              onClick={() => {
                // Each panel triggers its own submit; this button is a convenience fallback.
                const el = document.getElementById("ingest-primary");
                (el as HTMLButtonElement | null)?.click();
              }}
              disabled={busy}
            >
              {actionButton}
            </button>
            <button
              className={["btn-secondary", busy ? "opacity-60 pointer-events-none" : ""].join(" ")}
              onClick={() => nav("/wizard/intent")}
              disabled={busy}
            >
              Continue to Outcomes →
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Tip: start small (a single repo or a few files). You can expand sources later.
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------
 * Panels
 * -------------------------------------------------------------------------- */

function UploadPanel({
  onSubmit,
  disabled,
}: {
  onSubmit: (payload: any) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [chunkSize, setChunkSize] = useState(1200);
  const [over, setOver] = useState(false);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length) {
      setFiles((prev) => [...prev, ...dropped]);
    }
  };

  const onBrowse = () => inputRef.current?.click();

  const humanBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={[
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition",
          over ? "border-gray-900 bg-gray-50" : "border-gray-300 hover:bg-gray-50",
        ].join(" ")}
        onClick={onBrowse}
        role="button"
        aria-label="Upload files by drag and drop or click to browse"
      >
        <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <IconUpload className="text-gray-800" size={22} />
        </div>
        <div className="text-sm font-semibold">Drag & drop files here</div>
        <div className="text-xs text-gray-600">or click to browse</div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            setFiles((prev) => [...prev, ...picked]);
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-semibold">Queued Files ({files.length})</div>
          <ul className="max-h-48 space-y-1 overflow-auto text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="truncate">{f.name}</span>
                <span className="text-xs text-gray-500">{humanBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">Chunk Size (tokens/approx)</label>
          <input
            className="input"
            type="number"
            min={200}
            step={100}
            value={chunkSize}
            onChange={(e) => setChunkSize(parseInt(e.target.value || "1200", 10))}
          />
        </div>
        <div className="md:col-span-2">
          <p className="mt-6 text-[11px] text-gray-500">
            Large PDFs/Markdown will be chunked for retrieval. Adjust only if you know what you’re doing.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          id="ingest-primary"
          className="btn"
          onClick={async () => {
            if (!files.length) return;
            // Use a FormData to send files; the /ingest handler in api.ts prefers JSON,
            // but we allowed 'body' passthrough; include a 'strategy' so the backend can route.
            const form = new FormData();
            form.set("strategy", "upload");
            form.set("chunk_size", String(chunkSize));
            files.forEach((f) => form.append("files", f, f.name));
            await onSubmit({ body: form, _rawForm: true }); // api.ts will use 'body' over 'json'
          }}
          disabled={disabled || files.length === 0}
        >
          Upload & Index
        </button>
      </div>
    </div>
  );
}

function GithubPanel({
  onSubmit,
  disabled,
}: {
  onSubmit: (payload: any) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [repo, setRepo] = useState("https://github.com/org/repo");
  const [branch, setBranch] = useState("main");
  const [path, setPath] = useState<string>("");
  const [token, setToken] = useState<string>("");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">Repository URL</label>
          <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <p className="mt-1 text-[11px] text-gray-500">Public or private (token optional).</p>
        </div>
        <div>
          <label className="label">Branch</label>
          <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
        <div>
          <label className="label">Path (optional)</label>
          <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/docs" />
        </div>
        <div>
          <label className="label">Token (optional)</label>
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          id="ingest-primary"
          className="btn"
          onClick={() =>
            onSubmit({
              strategy: "github",
              repo,
              branch,
              path,
              token: token || undefined,
            })
          }
          disabled={disabled || !repo}
        >
          Clone & Index
        </button>
      </div>
    </div>
  );
}

function InternetPanel({
  onSubmit,
  disabled,
}: {
  onSubmit: (payload: any) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [depth, setDepth] = useState<number>(0);

  const addUrl = () => {
    const u = urlInput.trim();
    if (!u) return;
    setUrls((prev) => Array.from(new Set([...prev, u])));
    setUrlInput("");
  };

  const pasteFromClipboard = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      const lines = txt.split(/\n|,|\s+/).map((x) => x.trim()).filter(Boolean);
      setUrls((prev) => Array.from(new Set([...prev, ...lines])));
    } catch {
      // ignore
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(urls.join("\n"));
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">Add URL</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/docs…"
            />
            <button className="btn-secondary" onClick={addUrl}>Add</button>
          </div>
          <div className="mt-2 flex gap-2">
            <button className="chip" onClick={pasteFromClipboard}>Paste from Clipboard</button>
            <button className="chip" onClick={copyAll} disabled={!urls.length}>Copy All</button>
          </div>
        </div>
        <div>
          <label className="label">Crawl Depth</label>
          <input
            className="input"
            type="number"
            min={0}
            max={3}
            value={depth}
            onChange={(e) => setDepth(parseInt(e.target.value || "0", 10))}
          />
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-1 text-sm font-semibold">Queue</div>
        {urls.length === 0 ? (
          <div className="text-sm text-gray-600">No URLs added yet.</div>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-auto text-sm">
            {urls.map((u, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="truncate">{u}</span>
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => setUrls((prev) => prev.filter((x) => x !== u))}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <button
          id="ingest-primary"
          className="btn"
          onClick={() =>
            onSubmit({
              strategy: "internet",
              urls,
              depth,
            })
          }
          disabled={disabled || urls.length === 0}
        >
          Fetch & Index
        </button>
      </div>
    </div>
  );
}

function WebSearchPanel({
  onSubmit,
  disabled,
}: {
  onSubmit: (payload: any) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<"google" | "bing">("google");
  const [provider, setProvider] = useState<"openai" | "gemini" | "watsonx">("openai");
  const [grounding, setGrounding] = useState<"web" | "llm">("web");

  const providerLabel = useMemo(() => {
    if (provider === "openai") return "OpenAI / ChatGPT";
    if (provider === "gemini") return "Google / Gemini";
    return "IBM / watsonx.ai";
  }, [provider]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">Search Query</label>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g., Retrieval-Augmented Generation best practices"
          />
        </div>
        <div>
          <label className="label">Search Engine</label>
          <select className="input" value={engine} onChange={(e) => setEngine(e.target.value as any)}>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">LLM Provider</label>
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as any)}>
            <option value="openai">OpenAI / ChatGPT</option>
            <option value="gemini">Google / Gemini</option>
            <option value="watsonx">IBM / watsonx.ai</option>
          </select>
        </div>
        <div>
          <label className="label">Source of Truth</label>
          <div className="flex gap-2">
            <label className={["chip", grounding === "web" ? "!bg-gray-900 !text-white" : ""].join(" ")}>
              <input
                type="radio"
                name="grounding"
                checked={grounding === "web"}
                onChange={() => setGrounding("web")}
              />
              <span className="ml-1">Grounded by Web</span>
            </label>
            <label className={["chip", grounding === "llm" ? "!bg-gray-900 !text-white" : ""].join(" ")}>
              <input
                type="radio"
                name="grounding"
                checked={grounding === "llm"}
                onChange={() => setGrounding("llm")}
              />
              <span className="ml-1">LLM as Primary</span>
            </label>
          </div>
        </div>
        <div>
          <p className="mt-7 text-[11px] text-gray-500">
            We’ll attribute results; {providerLabel} will summarize and normalize content for indexing.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          id="ingest-primary"
          className="btn"
          onClick={() =>
            onSubmit({
              strategy: "web_search",
              query,
              engine,
              llm_provider: provider,
              grounding, // "web" or "llm"
            })
          }
          disabled={disabled || !query}
        >
          Search & Index
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * UI bits
 * -------------------------------------------------------------------------- */

function FeatureCard({
  active,
  onClick,
  icon,
  title,
  text,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-gray-900/30",
        "hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-gray-900 bg-gray-900 text-white" : "bg-white",
      ].join(" ")}
    >
      <div className={["mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full",
        active ? "bg-white/10" : "bg-gray-100"].join(" ")}>
        {icon}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className={["text-sm", active ? "text-gray-200" : "text-gray-600"].join(" ")}>
        {text}
      </div>
    </button>
  );
}
