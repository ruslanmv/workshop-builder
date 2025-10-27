// workshop_builder/ui/src/lib/api.ts

export type Json =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type RequestOptions = Omit<RequestInit, "headers" | "method"> & {
  /** JSON body to send (sets Content-Type automatically) */
  json?: Json;
  /** Extra headers to merge */
  headers?: Record<string, string>;
  /** HTTP method (defaults to GET if neither json nor body is provided; POST if json provided) */
  method?: HttpMethod;
  /** Optional raw body passthrough (e.g., FormData). If provided, 'json' is ignored. */
  body?: BodyInit;
};

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || "/api";

/**
 * Internal fetch wrapper with:
 *  - typed JSON parsing
 *  - safer headers typing (Record<string,string>)
 *  - consistent error normalization
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  // Always use a plain record for headers so we can index safely
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  let body: BodyInit | undefined = options.body;
  let method: HttpMethod | undefined = options.method;

  if (options.json !== undefined) {
    // If caller also passed a raw body, prefer 'json' and override.
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
    // If method wasn't specified, default to POST when sending JSON
    method = method || "POST";
  } else if (!method && !body) {
    // Default GET when no body/json is provided
    method = "GET";
  }

  const res = await fetch(url, { ...options, method, headers, body });
  const rawText = await res.text();

  // Detect JSON response by header (preferred), fall back to naive check
  const contentType = res.headers.get("content-type") || "";
  const looksJson =
    contentType.includes("application/json") ||
    /^[\s]*[{[]/m.test(rawText || "");

  let data: unknown = rawText as unknown;
  if (looksJson) {
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      // keep rawText if JSON.parse fails
      data = rawText;
    }
  }

  if (!res.ok) {
    const msg =
      (isRecord(data) && (data.error as string)) ||
      res.statusText ||
      "Request failed";
    throw new Error(msg);
  }

  return data as T;
}

// Type guard for object records
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  ingest: (payload: Json) =>
    request<{ indexed: string[]; post_stats?: unknown }>("/ingest", {
      method: "POST",
      json: payload,
    }),

  query: (payload: {
    question: string;
    collection: string;
    k?: number;
    score_threshold?: number;
  }) =>
    request<{
      results: unknown[];
      stats?: unknown;
      k: number;
      score_threshold: number;
    }>("/ingest/query", {
      method: "POST",
      json: payload,
    }),

  planWorkshop: (payload: Json) =>
    request<any>("/workshops/plan", { method: "POST", json: payload }),

  previewWorkshop: (plan: Json) =>
    request<any>(
      `/workshops/preview?plan=${encodeURIComponent(JSON.stringify(plan))}`
    ),
};

export default api;
