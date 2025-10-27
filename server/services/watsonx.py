# server/services/watsonx.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List
import os

from ibm_watsonx_ai import Credentials
from ibm_watsonx_ai.foundation_models import ModelInference
try:
    # Newer SDKs
    from ibm_watsonx_ai.foundation_models import TextEmbeddingsInference as _EmbeddingsClass  # type: ignore[attr-defined]
except Exception:  # pragma: no cover
    # Older SDKs
    from ibm_watsonx_ai.foundation_models import Embeddings as _EmbeddingsClass  # type: ignore[attr-defined]

# Optional param enums (exist in several versions)
try:  # pragma: no cover
    from ibm_watsonx_ai.metanames import EmbedTextParamsMetaNames as EmbedParams
except Exception:  # pragma: no cover
    class EmbedParams:  # minimal fallback
        TRUNCATE_INPUT_TOKENS = "truncate_input_tokens"

# Specific exception class for HTTP errors from the SDK
try:  # pragma: no cover
    from ibm_watsonx_ai.wml_client_error import ApiRequestFailure
except Exception:  # pragma: no cover
    class ApiRequestFailure(Exception):
        pass


@dataclass
class WatsonxClients:
    chat: ModelInference
    embed: Any  # keep as Any for broad version compatibility


def build_clients(cfg) -> WatsonxClients:
    if not cfg.WATSONX_API_KEY or not cfg.WATSONX_PROJECT_ID:
        raise RuntimeError("watsonx.ai credentials missing (WATSONX_API_KEY / WATSONX_PROJECT_ID).")

    creds = Credentials(
        api_key=cfg.WATSONX_API_KEY,
        url=f"https://{cfg.WATSONX_REGION}.ml.cloud.ibm.com",
    )

    chat = ModelInference(
        model_id=cfg.WATSONX_CHAT_MODEL,
        credentials=creds,
        project_id=cfg.WATSONX_PROJECT_ID,
    )

    embed = _EmbeddingsClass(
        model_id=cfg.WATSONX_EMBED_MODEL,
        credentials=creds,
        project_id=cfg.WATSONX_PROJECT_ID,
    )

    return WatsonxClients(chat=chat, embed=embed)


# -------------------- helpers -------------------- #

def _is_maxlen_error(err: Exception) -> bool:
    s = (str(err) or "").lower()
    return (
        "maximum sequence length" in s
        or "exceeds the maximum sequence length" in s
        or "token sequence length" in s
    )


def _char_limit_for_model() -> int:
    """
    Rough char limit guard for embeddings. Defaults to 512 tokens × 2 chars ≈ 1024 chars.
    Leave a little headroom for BOS/EOS tokens.
    Override via:
      - WATSONX_EMBED_MAX_TOKENS or WX_MAX_EMBED_TOKENS or A2A_MAX_EMBED_TOKENS
      - WATSONX_CHARS_PER_TOKEN or A2A_CHARS_PER_TOKEN
    """
    max_toks = int(
        os.getenv("WATSONX_EMBED_MAX_TOKENS")
        or os.getenv("WX_MAX_EMBED_TOKENS")
        or os.getenv("A2A_MAX_EMBED_TOKENS", "512")
    )
    chars_per_tok = float(os.getenv("WATSONX_CHARS_PER_TOKEN") or os.getenv("A2A_CHARS_PER_TOKEN", "2.0"))
    # headroom of ~8 chars
    return max(256, int(max_toks * chars_per_tok) - 8)


def _split_to_limit(text: str, limit: int, overlap: int = 80) -> List[str]:
    if limit <= 0:
        return [text]
    if len(text) <= limit:
        return [text]
    ov = max(0, min(overlap, max(0, limit - 1)))
    step = max(1, limit - ov)
    out: List[str] = []
    i = 0
    while i < len(text):
        out.append(text[i : i + limit])
        i += step
    return out or [""]


def _avg_vectors(vectors: List[List[float]]) -> List[float]:
    if not vectors:
        return []
    n = len(vectors)
    d = len(vectors[0])
    sums = [0.0] * d
    for v in vectors:
        # be defensive about inconsistent dims
        if len(v) != d:
            d = min(d, len(v))
            sums = sums[:d]
            v = v[:d]
        for j in range(d):
            sums[j] += float(v[j])
    return [s / max(1, n) for s in sums]


# -------------------- Embedding compatibility layer -------------------- #

def _call_embed_raw(embed_client: Any, texts: List[str], params: Dict[str, Any]) -> Any:
    """
    Call the embeddings API in a way that works across multiple SDK versions.
    Tries several methods and argument names.
    """
    method_candidates = [
        ("embed", ["texts", "inputs", "input", "sentences", "text"]),
        ("embed_text", ["texts", "inputs", "input", "sentences", "text"]),
        ("create_embeddings", ["texts", "inputs", "input", "sentences", "text"]),
        ("generate", ["inputs", "input", "texts", "text", "sentences"]),
    ]

    # Prefer keyword forms (with/without parameters), then positional fallbacks.
    for method_name, kw_names in method_candidates:
        if not hasattr(embed_client, method_name):
            continue
        fn = getattr(embed_client, method_name)

        for kw in kw_names:
            try:
                return fn(**{kw: texts}, parameters=params)  # type: ignore[misc]
            except TypeError:
                pass
            try:
                return fn(**{kw: texts})  # type: ignore[misc]
            except TypeError:
                pass

        try:
            return fn(texts, parameters=params)  # type: ignore[misc]
        except TypeError:
            pass
        try:
            return fn(texts)  # type: ignore[misc]
        except TypeError:
            pass

    raise RuntimeError(
        "watsonx.ai Embeddings client has no compatible method "
        "(tried embed/embed_text/create_embeddings/generate with "
        "inputs|input|texts|text|sentences)."
    )


def _normalize_embed_response(res: Any) -> List[List[float]]:
    """
    Normalize various response shapes to List[List[float]].
    """
    if res is None:
        return []

    if isinstance(res, dict):
        if "vectors" in res and isinstance(res["vectors"], list):
            return [list(map(float, v)) for v in res["vectors"]]
        if "results" in res and isinstance(res["results"], list):
            out: List[List[float]] = []
            for it in res["results"]:
                emb = it.get("embedding") if isinstance(it, dict) else None
                if isinstance(emb, list):
                    out.append([float(x) for x in emb])
            if out:
                return out
        if "embeddings" in res and isinstance(res["embeddings"], list):
            return [list(map(float, v)) for v in res["embeddings"]]
        data = res.get("data")
        if isinstance(data, dict) and "embeddings" in data and isinstance(data["embeddings"], list):
            return [list(map(float, v)) for v in data["embeddings"]]

    if isinstance(res, list) and res and isinstance(res[0], dict) and "embedding" in res[0]:
        return [[float(x) for x in r.get("embedding", [])] for r in res]  # type: ignore[return-value]

    if isinstance(res, list) and (not res or isinstance(res[0], (list, tuple))):
        return [list(map(float, v)) for v in res]  # type: ignore[list-item]

    try:
        return [list(map(float, res))]  # type: ignore[arg-type]
    except Exception:
        raise RuntimeError(f"Unrecognized embeddings response shape: {type(res)} -> {res!r}")


def _embed_one_safe(embed_client: Any, text: str, params: Dict[str, Any]) -> List[float]:
    """
    Embed a single text. If it exceeds model limits, split into safe slices,
    embed each slice, and return the average vector so the caller still gets
    exactly ONE vector per input text.
    """
    try:
        raw = _call_embed_raw(embed_client, [text], params)
        vecs = _normalize_embed_response(raw)
        if not vecs:
            return []
        return list(map(float, vecs[0]))
    except Exception as e:
        # If not a max-length failure, bubble up
        if not _is_maxlen_error(e):
            raise

        # Split to safe size and average embeddings
        limit = _char_limit_for_model()
        parts = _split_to_limit(text, limit, overlap=80)
        # Try to embed all parts in one call first (faster), else per-part
        try:
            raw = _call_embed_raw(embed_client, parts, params)
            pvecs = _normalize_embed_response(raw)
            if len(pvecs) != len(parts) or not pvecs:
                # fall through to per-part strict path
                raise RuntimeError("partial or empty embeddings for parts")
        except Exception:
            pvecs = []
            for p in parts:
                raw_p = _call_embed_raw(embed_client, [p], params)
                v = _normalize_embed_response(raw_p)
                if v:
                    pvecs.append(v[0])

        if not pvecs:
            return []
        return _avg_vectors([list(map(float, v)) for v in pvecs])


def wx_embed_text(clients: WatsonxClients, texts: List[str]) -> List[List[float]]:
    """
    Embed a batch of texts. On model-length errors, fall back to per-item
    embedding with safe-splitting + averaging to preserve cardinality.
    """
    params: Dict[str, Any] = {}
    try:
        params[EmbedParams.TRUNCATE_INPUT_TOKENS] = 8192  # type: ignore[attr-defined]
    except Exception:
        pass

    # Try fast path (whole batch)
    try:
        raw = _call_embed_raw(clients.embed, texts, params)
        vecs = _normalize_embed_response(raw)
        # If vec count mismatches, treat as failure and go to safe path
        if len(vecs) == len(texts):
            return vecs
    except Exception as e:
        # If it's not a max-length error, we'll still try safe path per-item;
        # if that fails, the original exception will likely reoccur and surface.
        if not _is_maxlen_error(e):
            # continue to safe path
            pass

    # Safe path: per-item with length-aware splitting/averaging
    out: List[List[float]] = []
    for t in texts:
        v = _embed_one_safe(clients.embed, t, params)
        out.append(v)
    return out


# -------------------- Text generation (chat) -------------------- #

def wx_chat_generate(
    clients: WatsonxClients,
    prompt: str,
    system: str | None = None,
    temperature: float = 0.2,
) -> str:
    params: Dict[str, Any] = {
        "temperature": float(temperature),
        "decoding_method": "greedy",
        "max_new_tokens": 1024,
        "repetition_penalty": 1.1,
    }
    full_prompt = (system + "\n\n" if system else "") + prompt
    out = clients.chat.generate_text(prompt=full_prompt, params=params)
    if isinstance(out, dict):
        return out.get("results", [{}])[0].get("generated_text", "") or out.get("generated_text", "")
    return str(out)
