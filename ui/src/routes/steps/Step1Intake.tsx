import { useNavigate } from "react-router-dom";
import RepoIngestForm from "../../components/RepoIngestForm";
import { useStore } from "../../store";

export default function Step1Intake() {
  const nav = useNavigate();
  const upsert = useStore((state) => state.upsert);
  const currentId = useStore((state) => state.currentId) || "draft";

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-medium">1) Ingest content</h2>
      <RepoIngestForm
        onAfterIngest={(r) => {
          upsert({
            id: currentId,
            name: "Draft Project",
            intake: {
              collection: "workshop_docs",
              lastIngest: r,
              docmap: r.docmap,
            },
          });
          nav("/wizard/intent");
        }}
      />
    </section>
  );
}
