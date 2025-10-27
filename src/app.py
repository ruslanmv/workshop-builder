# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import importlib
import logging
import os
import pathlib
import secrets
import time
from typing import Optional

from flask import Flask, jsonify, make_response, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

try:
    # Optional but recommended
    from flask_cors import CORS  # type: ignore
except Exception:  # pragma: no cover
    CORS = None  # type: ignore

from .config import Settings


def _configure_logging(level: str | int) -> None:
    numeric = (
        level
        if isinstance(level, int)
        else getattr(logging, str(level).upper(), logging.INFO)
    )
    logging.basicConfig(
        level=numeric,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _apply_security_headers(resp):
    # Minimal secure defaults for a single-page app + API
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    # Note: CSP customized only if you need strict script-src; left permissive for SPA bundles
    resp.headers.setdefault("Referrer-Policy", "no-referrer-when-downgrade")
    return resp


def _request_id() -> str:
    rid = request.headers.get("X-Request-ID")
    return rid or f"req_{int(time.time()*1000)}_{secrets.token_hex(6)}"


def _register_optional_blueprint(app: Flask, dotted: str, name: str, url_prefix: str):
    """
    Try to import and register a blueprint, but don't fail the app if it's missing.
    """
    try:
        module = importlib.import_module(dotted)
        bp = getattr(module, name)
        app.register_blueprint(bp, url_prefix=url_prefix)
        app.logger.info("Registered blueprint %s as %s", dotted, url_prefix)
    except Exception as e:  # pragma: no cover
        app.logger.info(
            "Optional blueprint not registered: %s (%s)", dotted, e, exc_info=False
        )


def create_app(settings: Optional[Settings] = None) -> Flask:
    """
    Application factory used by WSGI servers and `python -m flask`.

    - Serves built UI from `ui/dist` (or custom via STATIC_ROOT env)
    - Registers /api/* blueprints when present
    - Adds production middleware & headers
    """
    cfg = settings or Settings()  # pydantic-settings loads .env
    _configure_logging(cfg.LOG_LEVEL)
    app = Flask(
        __name__,
        static_folder=None,  # we serve UI manually to support custom build roots
    )

    # Honor reverse proxy headers (TLS offloading, load balancers)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # type: ignore

    # CORS (optional)
    if CORS and cfg.CORS_ENABLE:
        CORS(
            app,
            resources={r"/api/*": {"origins": cfg.CORS_ALLOW_ORIGINS}},
            supports_credentials=cfg.CORS_ALLOW_CREDENTIALS,
            methods=cfg.CORS_ALLOW_METHODS,
            allow_headers=cfg.CORS_ALLOW_HEADERS,
        )

    # -----------------------------
    # Health routes (always present)
    # -----------------------------
    @app.get("/api/health")
    def health():
        rid = _request_id()
        payload = {
            "ok": True,
            "service": "workshop-builder-api",
            "provider": cfg.LLM_PROVIDER,
            "a2a_base": cfg.A2A_BASE,
            "env_loaded": cfg.model_config.get("env_file", None) or ".env",
        }
        resp = make_response(jsonify(payload), 200)
        resp.headers["X-Request-ID"] = rid
        return _apply_security_headers(resp)

    # ---------------------------------
    # Optional blueprints (/api/* paths)
    # ---------------------------------
    _register_optional_blueprint(app, "src.routes.providers", "bp", "/api/providers")
    _register_optional_blueprint(app, "src.routes.ingest", "bp", "/api/ingest")
    _register_optional_blueprint(app, "src.routes.workshops", "bp", "/api/workshops")
    _register_optional_blueprint(app, "src.routes.books", "bp", "/api/books")
    _register_optional_blueprint(app, "src.routes.exports", "bp", "/api/exports")

    # ----------------------
    # Static UI (built SPA)
    # ----------------------
    # Default: ../ui/dist relative to this file, but env STATIC_ROOT may override
    guessed_root = pathlib.Path(__file__).resolve().parents[1]
    default_ui = guessed_root / "ui" / "dist"
    static_root = pathlib.Path(os.getenv("STATIC_ROOT", str(default_ui))).resolve()

    @app.get("/")
    def index():
        if (static_root / "index.html").exists():
            return send_from_directory(static_root, "index.html")
        # Fallback if UI not built yet
        return (
            "<!doctype html><meta charset='utf-8'>"
            "<title>Workshop Builder</title>"
            "<h1>Workshop Builder</h1>"
            "<p>UI not built yet. Run <code>npm run build</code> inside <code>ui/</code>.</p>",
            200,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    # Serve other assets (JS/CSS)
    @app.get("/assets/<path:filename>")
    def assets(filename: str):
        return send_from_directory(static_root / "assets", filename)

    # Common SPA history fallback: serve index for unknown paths (non-API)
    @app.get("/<path:rest>")
    def spa_fallback(rest: str):
        if rest.startswith("api/"):
            return jsonify({"ok": False, "error": {"message": "Not Found"}}), 404
        if (static_root / "index.html").exists():
            return send_from_directory(static_root, "index.html")
        return jsonify({"ok": False, "error": {"message": "UI not built"}}), 503

    # ----------------------
    # JSON error handlers
    # ----------------------
    @app.errorhandler(400)
    def bad_request(e):
        return _apply_security_headers(
            (jsonify({"ok": False, "error": {"message": "Bad Request"}}), 400)
        )

    @app.errorhandler(404)
    def not_found(e):
        return _apply_security_headers(
            (jsonify({"ok": False, "error": {"message": "Not Found"}}), 404)
        )

    @app.errorhandler(405)
    def method_not_allowed(e):
        return _apply_security_headers(
            (jsonify({"ok": False, "error": {"message": "Method Not Allowed"}}), 405)
        )

    @app.errorhandler(500)
    def server_error(e):
        logging.getLogger(__name__).exception("Unhandled error")
        return _apply_security_headers(
            (jsonify({"ok": False, "error": {"message": "Internal Server Error"}}), 500)
        )

    # Security headers for all responses
    @app.after_request
    def add_headers(resp):
        resp.headers.setdefault("X-Request-ID", _request_id())
        return _apply_security_headers(resp)

    app.logger.info(
        "App ready. UI root=%s, A2A_BASE=%s, Provider=%s",
        str(static_root),
        cfg.A2A_BASE,
        cfg.LLM_PROVIDER,
    )
    return app


# For `flask run` discovery
app = create_app()
