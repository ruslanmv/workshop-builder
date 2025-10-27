from __future__ import annotations
from typing import Optional
from fastapi import Depends, HTTPException, Request
from starlette.status import HTTP_401_UNAUTHORIZED
import jwt
import json
import requests
from .config import Settings

def get_tenant_id(req: Request, cfg: Settings = Depends(lambda: Settings())) -> str:
    tid = req.headers.get(cfg.TENANCY_HEADER) or cfg.DEFAULT_TENANT
    return tid.strip()

def _validate_api_key(req: Request, cfg: Settings) -> bool:
    if not cfg.API_KEYS:
        return False
    keys = [k.strip() for k in cfg.API_KEYS.split(",") if k.strip()]
    return (req.headers.get("X-API-Key") or "").strip() in keys

def _validate_jwt(req: Request, cfg: Settings) -> bool:
    auth = req.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return False
    token = auth.split(" ", 1)[1].strip()
    try:
        if cfg.JWT_JWKS_URL:
            jwks = requests.get(cfg.JWT_JWKS_URL, timeout=3).json()
            kid = jwt.get_unverified_header(token)["kid"]
            key = next(k for k in jwks["keys"] if k["kid"] == kid)
            return jwt.decode(token, jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key)),
                              algorithms=["RS256"], audience=cfg.JWT_AUDIENCE, issuer=cfg.JWT_ISSUER) is not None
        else:
            payload = jwt.decode(token, cfg.JWT_SECRET, algorithms=["HS256"], audience=cfg.JWT_AUDIENCE, issuer=cfg.JWT_ISSUER)
            return payload is not None
    except Exception:
        return False

def require_auth(req: Request, cfg: Settings = Depends(lambda: Settings())):
    if _validate_api_key(req, cfg) or _validate_jwt(req, cfg):
        return True
    raise HTTPException(HTTP_401_UNAUTHORIZED, "Unauthorized")
