import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, ProjectType, OutputFormat } from "../../store";

export default function Step2Intent() {
  const nav = useNavigate();
  const upsert = useStore((s) => s.upsert);
  const currentId = useStore((s) => s.currentId) || "draft";

  const [projectType, setProjectType] = useState<ProjectType>("book");
  const [outputs, setOutputs] = useState<OutputFormat[]>(["pdf"]);
  const [title, setTitle] = useState("Foundations of Practical GenAI");
  const [subtitle, setSubtitle] = useState("");
  const [authors, setAuthors] = useState("Jane Doe, John Smith");
  const [audience, setAudience] = useState("engineers");
  const [tone, setTone] = useState("professional, concise");
  const [constraints, setConstraints] = useState("must include safety, eval, and RAG");
  const [due, setDue] = useState("");

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-medium">2) Intent</h2>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">Project Type</label>
          <select
            className="input"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value as ProjectType)}
          >
            <option value="book">Book</option>
            <option value="workshop">Workshop</option>
            <option value="mkdocs">MkDocs Site</option>
          </select>
        </div>
        <div>
          <label className="label">Outputs</label>
          <div className="flex flex-wrap gap-2">
            {(["springer", "epub", "pdf", "mkdocs"] as OutputFormat[]).map((f) => (
              <label key={f} className="chip">
                <input
                  type="checkbox"
                  checked={outputs.includes(f)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...outputs, f]
                      : outputs.filter((x) => x !== f);
                    setOutputs(next);
                  }}
                />
                <span className="ml-1">{f.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mt-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Subtitle</label>
          <input
            className="input"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mt-3">
        <div className="md:col-span-2">
          <label className="label">Authors (comma separated)</label>
          <input
            className="input"
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Due (optional)</label>
          <input
            className="input"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Audience</label>
        <input
          className="input"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        />
      </div>
      <div className="mt-3">
        <label className="label">Tone</label>
        <input className="input" value={tone} onChange={(e) => setTone(e.target.value)} />
      </div>
      <div className="mt-3">
        <label className="label">Constraints</label>
        <textarea
          className="input h-24"
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
        />
      </div>

      <div className="mt-4">
        <button
          className="btn"
          onClick={() => {
            upsert({
              id: currentId,
              intent: {
                projectType,
                outputs,
                title,
                subtitle,
                authors: authors.split(",").map((s) => s.trim()).filter(Boolean),
                audience,
                tone,
                constraints,
                due,
              },
            });
            nav("/wizard/outline");
          }}
        >
          Continue to Outline
        </button>
      </div>
    </section>
  );
}
