import { useEffect, useMemo, useState } from "react";

/**
 * ProviderPicker
 * - Reads the active provider/model from /api/providers (GET)
 * - Updates provider/model (and optional session API key) via /api/providers (PUT)
 * NOTE: API keys entered here should be treated as *session-only* and never persisted
 * by the backend unless you explicitly implement secure storage server-side.
 */

type ProviderName = "watsonx" | "openai";

type ProviderState = {
  provider: ProviderName;
  model_id: string;
  // Optional, provider-specific fields (session only in UI)
  base_url?: string; // e.g. WATSONX_URL or OpenAI api_base
  project_id?: string; // watsonx project
  session_api_key?: string; // sent only on this PUT; not saved by UI
};

type ProviderInfoResponse = {
  provider?: ProviderName;
  model_id?: string;
  configured?: boolean;
  // Optional docs/hints from backend
  supports?: {
    providers?: ProviderName[];
    models?: Record<ProviderName, string[]>;
  };
  details?: Record<string, unknown>;
};

async function getProviders(): Promise<ProviderInfoResponse> {
  const res = await fetch("/api/providers", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to load providers: ${res.statusText}`);
  return res.json();
}

async function putProviders(payload: ProviderState): Promise<ProviderInfoResponse> {
  const res = await fetch("/api/providers", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.error as string)) || res.statusText || "Update failed";
    throw new Error(msg);
  }
  return data as ProviderInfoResponse;
}

export default function ProviderPicker() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProviderName>("watsonx");
  const [modelId, setModelId] = useState<string>("ibm/granite-3-8b-instruct");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [sessionApiKey, setSessionApiKey] = useState<string>("");

  const hints = useMemo(() => {
    if (provider === "watsonx") {
      return {
        modelPlaceholder: "ibm/granite-3-8b-instruct",
        baseUrlPlaceholder: "https://us-south.ml.cloud.ibm.com",
        projectPlaceholder: "your-project-id"
      };
    }
    return {
      modelPlaceholder: "gpt-4o-mini",
      baseUrlPlaceholder: "https://api.openai.com/v1 (optional)",
      projectPlaceholder: "(unused)"
    };
  }, [provider]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    getProviders()
      .then((info) => {
        if (!mounted) return;
        if (info.provider) setProvider(info.provider);
        if (info.model_id) setModelId(info.model_id);
        // If backend exposes details (e.g. base_url/project_id), hydrate but keep session key empty
        const details = (info.details || {}) as Record<string, string>;
        setBaseUrl((details["base_url"] as string) || "");
        setProjectId((details["project_id"] as string) || "");
      })
      .catch((e: any) => setError(e.message || "Failed to load provider"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const payload: ProviderState = {
        provider,
        model_id: modelId.trim(),
        base_url: baseUrl.trim() || undefined,
        project_id: projectId.trim() || undefined,
        session_api_key: sessionApiKey.trim() || undefined
      };
      await putProviders(payload);
      setOk("Provider settings applied. (API key treated as session-only.)");
      // Clear API key from UI memory after sending once
      setSessionApiKey("");
    } catch (e: any) {
      setError(e.message || "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium">LLM Provider</h2>
        {loading ? (
          <span className="text-sm text-gray-500">Loading…</span>
        ) : (
          <span className="badge">Active: {provider}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">Provider</label>
          <select
            className="input"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderName)}
          >
            <option value="watsonx">IBM watsonx.ai</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div>
          <label className="label">Model ID</label>
          <input
            className="input"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder={hints.modelPlaceholder}
          />
        </div>
        <div>
          <label className="label">Base URL (optional)</label>
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={hints.baseUrlPlaceholder}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mt-3">
        <div>
          <label className="label">
            {provider === "watsonx" ? "Project ID" : "Project ID (unused)"}
          </label>
          <input
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder={hints.projectPlaceholder}
            disabled={provider !== "watsonx"}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Session API Key (not persisted)</label>
          <input
            className="input"
            type="password"
            value={sessionApiKey}
            onChange={(e) => setSessionApiKey(e.target.value)}
            placeholder={
              provider === "watsonx"
                ? "WATSONX_API_KEY (sent once; not stored by UI)"
                : "OPENAI_API_KEY (sent once; not stored by UI)"
            }
          />
          <p className="mt-1 text-xs text-gray-500">
            The UI sends this key once to the backend for the current session only. Do not commit
            keys to .env in shared environments.
          </p>
        </div>
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      {ok && <div className="mt-3 text-sm text-green-700">{ok}</div>}

      <div className="mt-4 flex gap-2">
        <button className="btn" onClick={onSave} disabled={saving || loading}>
          {saving ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>
  );
}
