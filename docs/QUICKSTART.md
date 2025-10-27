# Quickstart

## 1) Install

- Python **3.11**
- Node.js **18+** (to build the UI)

\`\`\`bash
# create venv and install (via uv)
make install

# build UI
./scripts/build_ui.sh
\`\`\`

## 2) Run locally

Open two terminals:

# terminal 1: A2A server (with /knowledge)
\`make serve-a2a\`  # http://localhost:8000

# terminal 2: Flask UI
\`make serve-web\`  # http://localhost:5000

Or with Docker Compose:

\`docker compose up -d --build\`
# A2A: http://localhost:8000  UI: http://localhost:5000

## 3) Ingest content (RAG)

# Ingest a local repo or docs path
\`make ingest TARGET=/absolute/path/to/repo\`

# Optional: query right after ingest
\`python scripts/ingest_repo.py /abs/path --query "List endpoints" --k 6 --score-threshold 0.0\`

## 4) Design a Workshop/Book

Open \`http://localhost:5000\`:

1.  Paste a GitHub URL and click **Analyze**.
2.  Review the DocMap & Outline; tweak durations in **Workshop Designer**.
3.  Scaffold the project — files written to \`work/projects/<repo-slug>/\`.

## 5) Export

Use the API panel in the UI or:

\`\`\`bash
./scripts/export_example.sh \\
  --project work/projects/<repo-slug> \\
  --out build/book \\
  --title "Edge AI Workshop" \\
  --authors "Ada Lovelace;Alan Turing" \\
  --all
\`\`\`

Artifacts:

* MkDocs site → \`build/book/site\`
* EPUB → \`build/book/book.epub\`
* PDF (Pandoc) → \`build/book/book.pdf\`
* Springer LaTeX PDF → \`build/book/springer.pdf\`

## 6) Providers

Set \`watsonx.ai\` or \`OpenAI\` creds in \`.env\` and choose provider in the UI:

\`\`\`
LLM_PROVIDER=watsonx
WATSONX_API_KEY=...
WATSONX_URL=https://us-south.ml.cloud.ibm.com
WATSONX_PROJECT_ID=...
\`\`\`

# or OpenAI:
\`\`\`
LLM_PROVIDER=openai
OPENAI_API_KEY=...
\`\`\`

Retrieval embeddings are controlled by \`A2A_EMBEDDINGS_PROVIDER\` + \`A2A_EMBEDDINGS_MODEL\`.

---

### That’s it!
- You’ve got **scripts** to build UI and export artifacts,
- **containers** to run web + A2A + Qdrant,
- a **CLI** to ingest & test RAG,
- and a minimal **test** & **logging config**.
