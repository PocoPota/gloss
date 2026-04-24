"""Construct a Translator from a name or environment variables."""

from __future__ import annotations

import os

from .base import Translator

KNOWN_ENGINES = ("echo", "claude", "gemini", "deepl")


def _env_int(*keys: str, default: int) -> int:
    """Return the first env var in `keys` that parses as int, else `default`."""
    for k in keys:
        v = os.environ.get(k)
        if v is None or v == "":
            continue
        try:
            return int(v)
        except ValueError:
            continue
    return default


def build_translator(name: str | None = None, **kwargs) -> Translator:
    """Create a translator by name.

    Resolution order:
    1. Explicit `name` argument.
    2. GLOSS_ENGINE env var.
    3. Default "echo".

    Rate/concurrency env vars (per engine, with shared fallback):
    - GLOSS_{ENGINE}_MAX_WORKERS or GLOSS_MAX_WORKERS
    - GLOSS_{ENGINE}_RPM         or GLOSS_RPM
    Set RPM=0 to disable throttling.
    """
    resolved = (name or os.environ.get("GLOSS_ENGINE") or "echo").lower()

    if resolved == "echo":
        from .echo import EchoTranslator

        return EchoTranslator()

    if resolved == "claude":
        from .claude import DEFAULT_MODEL, ClaudeTranslator

        model = kwargs.get("model") or os.environ.get("GLOSS_CLAUDE_MODEL", DEFAULT_MODEL)
        workers = _env_int("GLOSS_CLAUDE_MAX_WORKERS", "GLOSS_MAX_WORKERS", default=4)
        rpm = _env_int("GLOSS_CLAUDE_RPM", "GLOSS_RPM", default=0)
        return ClaudeTranslator(model=model, max_workers=workers, rpm=rpm)

    if resolved == "gemini":
        from .gemini import DEFAULT_MODEL as GEMINI_DEFAULT
        from .gemini import GeminiTranslator

        model = kwargs.get("model") or os.environ.get("GLOSS_GEMINI_MODEL", GEMINI_DEFAULT)
        workers = _env_int("GLOSS_GEMINI_MAX_WORKERS", "GLOSS_MAX_WORKERS", default=2)
        rpm = _env_int("GLOSS_GEMINI_RPM", "GLOSS_RPM", default=10)
        return GeminiTranslator(model=model, max_workers=workers, rpm=rpm)

    if resolved == "deepl":
        from .deepl import DeepLTranslator

        return DeepLTranslator()

    raise ValueError(
        f"Unknown translator engine: {resolved!r}. Known: {', '.join(KNOWN_ENGINES)}"
    )
