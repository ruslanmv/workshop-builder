from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List
from ibm_watsonx_ai import Credentials
from ibm_watsonx_ai.foundation_models import Model as FMModel, Embeddings
from ibm_watsonx_ai.metanames import EmbedTextParamsMetaNames as EmbedParams
from ..config import Settings

@dataclass
class WatsonxClients:
    chat: FMModel
    embed: Embeddings

def build_clients(cfg: Settings) -> WatsonxClients:
    if not cfg.WATSONX_API_KEY or not cfg.WATSONX_PROJECT_ID:
        raise RuntimeError("watsonx.ai credentials missing (WATSONX_API_KEY / WATSONX_PROJECT_ID)." )
    creds = Credentials(api_key=cfg.WATSONX_API_KEY, url=f"https://{cfg.WATSONX_REGION}.ml.cloud.ibm.com")
    chat = FMModel(model_id=cfg.WATSONX_CHAT_MODEL, credentials=creds, project_id=cfg.WATSONX_PROJECT_ID)
    embed = Embeddings(model_id=cfg.WATSONX_EMBED_MODEL, credentials=creds, project_id=cfg.WATSONX_PROJECT_ID)
    return WatsonxClients(chat=chat, embed=embed)

def wx_embed_text(clients: WatsonxClients, texts: List[str]) -> List[List[float]]:
    params = {EmbedParams.TRUNCATE_INPUT_TOKENS: 8192}
    res = clients.embed.embed(texts=texts, parameters=params)
    if isinstance(res, dict) and "vectors" in res:
        return res["vectors"]
    if isinstance(res, list) and res and isinstance(res[0], dict) and "embedding" in res[0]:
        return [r["embedding"] for r in res]
    return res

def wx_chat_generate(clients: WatsonxClients, prompt: str, system: str | None = None, temperature: float = 0.2) -> str:
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
