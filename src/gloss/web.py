"""FastAPI web app for gloss.

Endpoints:
    GET    /                     serve the frontend (PDF viewer)
    GET    /api/engines          list available translator engines
    POST   /api/translate-text   translate a single text snippet → JSON
    GET    /api/config           list configured API keys (no values returned)
    PUT    /api/config/{engine}  save API key for engine to OS keychain
    DELETE /api/config/{engine}  remove API key from OS keychain
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config as cfg
from .protect import protect
from .translate.base import TranslationRequest
from .translate.factory import KNOWN_ENGINES, build_translator

logging.basicConfig(
    level=os.environ.get("GLOSS_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("gloss.web")

app = FastAPI(title="gloss", version="0.3.0")

_STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(_STATIC_DIR / "index.html")


@app.get("/api/engines")
def list_engines() -> JSONResponse:
    available: list[dict[str, object]] = []
    for name in KNOWN_ENGINES:
        if name == "echo":
            available.append({"name": name, "ready": True, "reason": None})
            continue
        st = cfg.key_status(name)
        ready = bool(st.get("configured"))
        reason = None if ready else f"APIキー未設定 ({st.get('env_var', '')})"
        available.append({"name": name, "ready": ready, "reason": reason})

    # Default-engine resolution:
    #   1. GLOSS_ENGINE env var (explicit override)
    #   2. First non-echo engine with a configured key
    #   3. echo
    default = os.environ.get("GLOSS_ENGINE")
    if not default:
        default = next(
            (e["name"] for e in available if e["name"] != "echo" and e["ready"]),
            "echo",
        )
    return JSONResponse({"engines": available, "default": default})


@app.get("/api/config")
def get_config() -> JSONResponse:
    """Return which engines have an API key configured and where (never the key itself)."""
    engines = [cfg.key_status(e) for e in cfg.ENGINE_SPECS]
    return JSONResponse({"engines": engines})


class ConfigBody(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=500)


@app.put("/api/config/{engine}")
def put_config(engine: str, body: ConfigBody) -> JSONResponse:
    if engine not in cfg.ENGINE_SPECS:
        raise HTTPException(404, f"unknown engine: {engine}")
    spec = cfg.ENGINE_SPECS[engine]
    if os.environ.get(spec.env_var):
        # Env var takes precedence; warn the client so the UI can explain.
        raise HTTPException(
            409,
            f"{spec.env_var} が環境変数として設定されているため、キーチェーン保存は無効になります。環境変数を外してから保存してください。",
        )
    try:
        cfg.set_api_key(engine, body.api_key)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return JSONResponse(cfg.key_status(engine))


@app.delete("/api/config/{engine}")
def delete_config(engine: str) -> JSONResponse:
    if engine not in cfg.ENGINE_SPECS:
        raise HTTPException(404, f"unknown engine: {engine}")
    removed = cfg.delete_api_key(engine)
    return JSONResponse({"engine": engine, "removed": removed, **cfg.key_status(engine)})


class TranslateTextBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    engine: str = "echo"
    source_lang: str = "en"
    target_lang: str = "ja"


@app.post("/api/translate-text")
def translate_text(body: TranslateTextBody) -> JSONResponse:
    """Translate a single text snippet. Protect/Restore tokens are applied."""
    try:
        translator = build_translator(body.engine)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    text = _normalize_selection(body.text)
    if not text.strip():
        raise HTTPException(400, "Empty selection after normalization")

    logger.info("translate-text: engine=%s chars=%d", translator.name, len(text))
    t0 = time.monotonic()

    pr = protect(text)
    req = TranslationRequest(
        texts=[pr.text],
        source_lang=body.source_lang,
        target_lang=body.target_lang,
    )
    try:
        raw = translator.translate(req)[0]
    except Exception as e:
        logger.exception("translate-text failed")
        raise HTTPException(502, f"Translation backend error: {e}") from e

    final = pr.restore(raw)
    dt = time.monotonic() - t0
    logger.info("translate-text: done in %.2fs (in=%d out=%d)", dt, len(text), len(final))
    return JSONResponse(
        {
            "translated": final,
            "source": text,
            "engine": translator.name,
            "elapsed_ms": int(dt * 1000),
        }
    )


def _normalize_selection(text: str) -> str:
    """Clean up text extracted from PDF.js selection.

    - Join soft-hyphenated line breaks (e.g. "evolu-\\ntion" → "evolution")
    - Collapse newlines within paragraphs (PDF.js yields one span per line)
    - Strip excessive whitespace
    """
    import re

    # Soft hyphen joiner: "word-\nrest" → "wordrest" (only if next char is lowercase)
    text = re.sub(r"(\w)-\s*\n\s*([a-z])", r"\1\2", text)
    # Newlines → spaces (selection often spans visual lines of the same paragraph)
    text = re.sub(r"\s*\n\s*", " ", text)
    # Collapse repeated whitespace
    text = re.sub(r"\s+", " ", text)
    return text.strip()
