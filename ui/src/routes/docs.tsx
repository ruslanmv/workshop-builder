// workshop_builder/ui/src/routes/docs.tsx
import React from "react";
import { Link } from "react-router-dom";

export default function Docs() {
  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-xl hero-gradient animated-gradient px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Guides</div>
          <h2 className="mt-1 text-2xl font-semibold">Documentation</h2>
          <p className="mt-2 text-sm text-gray-300">
            Learn how to ingest knowledge, plan outcomes, preview outlines, and generate polished deliverables.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl space-y-4">
        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Quick Start</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>Go to <Link to="/wizard/intake" className="text-indigo-600 underline">Knowledge</Link> and ingest files/repos/URLs.</li>
            <li>Select your destination in <Link to="/wizard/intent" className="text-indigo-600 underline">Outcomes</Link>.</li>
            <li>Use the adaptive editor in <Link to="/wizard/outline" className="text-indigo-600 underline">Outline</Link>.</li>
            <li>Confirm details in <Link to="/wizard/review" className="text-indigo-600 underline">Review</Link>.</li>
            <li>Run the pipeline in <Link to="/wizard/generate" className="text-indigo-600 underline">Generate</Link>.</li>
          </ol>
        </div>

        <div className="card">
          <h3 className="mb-2 text-base font-semibold">CLI & Make</h3>
          <pre className="code">{`make install
make ui-build
make serve-all   # A2A (8000) + Flask (5000)
# or:
make serve-a2a
make serve-web`}</pre>
        </div>

        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Providers & RAG</h3>
          <p className="text-sm text-gray-700">
            Configure <code>.env</code> with your LLM provider (watsonx.ai / OpenAI) and vector DB (Chroma/Qdrant).
            Use <code>/knowledge</code> for persistent RAG with large repos.
          </p>
        </div>
      </div>
    </section>
  );
}
