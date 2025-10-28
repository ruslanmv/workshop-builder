

1)  High-level architecture

<!-- end list -->

```mermaid
%% Force HTML labels so <br/> works
%% (Remove this init block if your environment already enables htmlLabels)
%%{init: {"flowchart": {"htmlLabels": true}} }%%
flowchart LR
    U[User<br/>Browser] -->|HTTP 80| NX[Nginx<br/>serves UI & proxies /api/* & SSE]
    NX -->|/api/*| API[FastAPI Backend<br/>server.main]
    NX -->|/ui| UI[Vite/React Build<br/>/usr/share/nginx/html]

    subgraph SVC[Backend Services]
      API -->|enqueue job| RQ[Redis RQ<br/>queue: jobs]
      RQ --> WK[RQ Worker<br/>workers.worker]
      WK --> FL[⚙️ CrewAI Flow<br/>WorkshopBuildFlow]
      API -->|Pub/Sub| RS[Redis Pubjob]
      NX -->|/api/generate/stream| API
    end

    %% Client-side SSE consumer lives outside backend services
    API -->|SSE| BR[Browser EventSource]

    subgraph RAG[RAG Stack]
      SP[Token-aware Splitter] --> EMB[watsonx.ai Embeddings]
      EMB --> CH[Chroma DB<br/>local persistent]
      API -->|/api/ingest/*| SP
      API -->|/api/knowledge/query| CH
    end

    subgraph GEN[Generation & Exports]
      FL --> WR[Writer/Formatter Agents]
      WR --> EXP[Exporters<br/>PDF • EPUB • MkDocs]
      EXP --> FS[Artifacts on Diskartifacts]
      API -->|/api/exportsid| FS
    end

    classDef node fill:#f6f9ff,stroke:#557;
    class U,NX,API,UI,RQ,WK,FL,RS,SP,EMB,CH,WR,EXP,FS,BR node;

```

2)  Sequence — Ingest & Generate (API + Worker + SSE)

<!-- end list -->

```mermaid
sequenceDiagram
    participant Dev as User Browser
    participant NX as Nginx
    participant API as FastAPI /api
    participant RQ as Redis queue jobs
    participant W as RQ Worker
    participant Flow as CrewAI Flow
    participant CH as Chroma RAG
    participant SSE as EventSource SSE

    Dev->>NX: POST /api/ingest/github { files[] } + headers
    NX->>API: /api/ingest/github
    API->>API: Split chunk_size/overlap
    API->>API: Embed via watsonx.ai model=embedding
    API->>CH: upsert vectors + metadata
    API-->>NX: 202 Accepted { stats }

    Dev->>NX: POST /api/generate/start { project,intent }
    NX->>API: /api/generate/start
    API->>RQ: enqueue workers.worker.run_job_worker(job_id,...)
    API-->>Dev: 200 { job_id, stream_url }

    Dev->>SSE: GET /api/generate/stream?job_id=...
    activate SSE
    API->>RQ: worker picks job
    RQ->>W: perform_job
    W->>Flow: kickoff()
    Flow->>CH: similarity search RAG
    Flow-->>W: progress/logs/artifacts via emitter
    W->>API: publish(event) -> Redis Pub/Sub
    API-->>SSE: SSE: progress/log/artifact/done
    deactivate SSE
```

3)  Sequence — /knowledge ingest & query (RAG)

<!-- end list -->

```mermaid
sequenceDiagram
    participant Caller as UI/CLI/Agent
    participant API as FastAPI /api/knowledge
    participant Split as Token Splitter
    participant Emb as watsonx.ai Embeddings
    participant V as Chroma Vector DB

    Caller->>API: POST /api/ingest/files { paths,chunk_size,overlap,collection }
    API->>Split: split documents
    Split->>Emb: embed chunks (watsonx model)
    Emb->>V: upsert {ids, vectors, metadata}
    API-->>Caller: { indexed, chunk_size, overlap, collection }

    Caller->>API: POST /api/knowledge/query { q,k,threshold,collection }
    API->>Emb: embed query
    Emb->>V: similarity search (k, threshold)
    V-->>API: results [{text,score,metadata}]
    API-->>Caller: results
```

4)  Deployment topology (docker-compose)

<!-- end list -->

```mermaid
flowchart LR
    subgraph Host
      subgraph Net[Docker Compose Network]
        WEB[web: Nginx + UI<br/>ports: 80->80]:::svc
        API[api: FastAPI+Gunicorn<br/>expose: 5000]:::svc
        WRK[worker: RQ Worker]:::svc
        RED[redis:7-alpine<br/>ports: 6379->6379]:::svc
        VOL_DATA[(volume: data/)]:::vol
      end
      DEV[Developer]
    end

    DEV -->|http://localhost| WEB
    WEB -->|/api/*| API
    API -->|Redis URL| RED
    WRK -->|Redis URL| RED
    API --- VOL_DATA
    WRK --- VOL_DATA

    classDef svc fill:#eef,stroke:#557,stroke-width:1.2px;
    classDef vol fill:#ffe,stroke:#aa3,stroke-width:1.2px;
```

5)  Data lifecycle — from sources to artifacts

<!-- end list -->

```mermaid
flowchart TB
    SRC[Sources<br/>Markdown • Docs • Web/Repo JSON] --> ING[Ingest API]
    ING --> SPLIT[Token-aware Splitter]
    SPLIT --> EMB[watsonx.ai Embeddings]
    EMB --> CH[Chroma<br/>persisted collection]
    CH --> RAG[RAG Retrieval<br/>top-k contexts]
    RAG --> PLAN[Planner/Researcher CrewAI]
    PLAN --> WRITE[Writer/Formatter CrewAI]
    WRITE --> MS[Manuscript.md]
    MS --> EXP[Exporters<br/>PDF • EPUB • MkDocs]
    EXP --> ART[Artifacts on Disk artifacts]
    ART --> DL[Downloads via exports]
```

6)  Config & control plane

<!-- end list -->

```mermaid
flowchart LR
    ENV[.env / env vars] --> CFG[Pydantic Settings]
    CFG --> LLM[LLM Builde]
    CFG --> API[FastAPI App]
    LLM --> Flow[WorkshopBuildFlow CrewAI]
    API --> Q[Redis Queue RQ]
    Q --> Worker[RQ Worker]
    Worker --> Flow

    ENV --> Make[Makefile Targets]
    Make -->|local| DevRun[make run / ui-dev]
    Make -->|prod| Compose[make build-infra / run-infra]

    API --> Obs[Metrics / Logs / Traces]
    Obs --> Prom[Prometheus / OTEL]
```

These reflect your current design: FastAPI backend, Nginx front, Redis/RQ, CrewAI Flows with explicitly injected LLM (watsonx.ai by default), Chroma for vectors, and SSE for realtime progress + artifacts.