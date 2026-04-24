"""FastAPI web app for pdf-translater.

Endpoints:
    GET  /                     serve the frontend (PDF viewer)
    GET  /api/engines          list available translator engines
    POST /api/translate-text   translate a single text snippet → JSON

The app is now a PDF viewer: the user uploads a PDF, selects text with the
mouse, and the selection is translated on demand.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .protect import protect
from .translate.base import TranslationRequest
from .translate.factory import KNOWN_ENGINES, build_translator

load_dotenv()

logging.basicConfig(
    level=os.environ.get("GLOSS_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("gloss.web")

app = FastAPI(title="pdf-translater", version="0.2.0")

_STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(_STATIC_DIR / "index.html")


@app.get("/api/engines")
def list_engines() -> JSONResponse:
    available: list[dict[str, object]] = []
    for name in KNOWN_ENGINES:
        ready = True
        reason: str | None = None
        if name == "claude" and not os.environ.get("ANTHROPIC_API_KEY"):
            ready = False
            reason = "ANTHROPIC_API_KEY not set"
        elif name == "gemini" and not (
            os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        ):
            ready = False
            reason = "GEMINI_API_KEY not set"
        elif name == "deepl" and not os.environ.get("DEEPL_API_KEY"):
            ready = False
            reason = "DEEPL_API_KEY not set"
        available.append({"name": name, "ready": ready, "reason": reason})
    return JSONResponse({"engines": available, "default": os.environ.get("GLOSS_ENGINE", "echo")})


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
