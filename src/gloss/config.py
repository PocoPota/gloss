"""API key storage — OS keychain (macOS Keychain / Windows Credential Manager /
Linux Secret Service) via the `keyring` library.

Resolution order for an engine's API key:
  1. Environment variable (e.g. ANTHROPIC_API_KEY) — wins if set
  2. OS keychain entry (service="gloss", username=<env-var-name>)
  3. None

Keys stored via this module are written to the OS keychain only — never to a
plaintext file on disk.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import keyring
from keyring.errors import KeyringError

SERVICE = "gloss"
logger = logging.getLogger("gloss.config")


@dataclass(frozen=True)
class EngineSpec:
    name: str                # translator engine name (claude/gemini/deepl)
    env_var: str             # env var users historically set
    label: str               # display label for UI
    help_url: str | None     # where to get a key


ENGINE_SPECS: dict[str, EngineSpec] = {
    "claude": EngineSpec(
        name="claude",
        env_var="ANTHROPIC_API_KEY",
        label="Claude (Anthropic)",
        help_url="https://console.anthropic.com/settings/keys",
    ),
    "gemini": EngineSpec(
        name="gemini",
        env_var="GEMINI_API_KEY",
        label="Gemini (Google AI)",
        help_url="https://aistudio.google.com/app/apikey",
    ),
    "deepl": EngineSpec(
        name="deepl",
        env_var="DEEPL_API_KEY",
        label="DeepL",
        help_url="https://www.deepl.com/account/summary",
    ),
}


def get_api_key(engine: str) -> str | None:
    """Return the effective API key for `engine`, checking env first then keychain."""
    spec = ENGINE_SPECS.get(engine)
    if spec is None:
        return None
    env_val = os.environ.get(spec.env_var)
    if env_val:
        return env_val
    try:
        return keyring.get_password(SERVICE, spec.env_var)
    except KeyringError as e:  # pragma: no cover
        logger.warning("keyring read failed for %s: %s", engine, e)
        return None


def set_api_key(engine: str, api_key: str) -> None:
    """Store an API key in the OS keychain."""
    spec = ENGINE_SPECS.get(engine)
    if spec is None:
        raise ValueError(f"unknown engine: {engine}")
    api_key = api_key.strip()
    if not api_key:
        raise ValueError("api_key is empty")
    keyring.set_password(SERVICE, spec.env_var, api_key)
    logger.info("stored key for %s in keychain", engine)


def delete_api_key(engine: str) -> bool:
    """Remove a key from the keychain. Returns True if a key was deleted."""
    spec = ENGINE_SPECS.get(engine)
    if spec is None:
        return False
    try:
        keyring.delete_password(SERVICE, spec.env_var)
        logger.info("removed key for %s from keychain", engine)
        return True
    except keyring.errors.PasswordDeleteError:
        return False


def key_status(engine: str) -> dict[str, object]:
    """Return a JSON-serialisable status for the given engine."""
    spec = ENGINE_SPECS.get(engine)
    if spec is None:
        return {"engine": engine, "configured": False, "source": None}
    env_val = os.environ.get(spec.env_var)
    if env_val:
        return {
            "engine": engine,
            "configured": True,
            "source": "env",
            "env_var": spec.env_var,
            "label": spec.label,
            "help_url": spec.help_url,
        }
    try:
        kc_val = keyring.get_password(SERVICE, spec.env_var)
    except KeyringError:  # pragma: no cover
        kc_val = None
    return {
        "engine": engine,
        "configured": bool(kc_val),
        "source": "keychain" if kc_val else None,
        "env_var": spec.env_var,
        "label": spec.label,
        "help_url": spec.help_url,
    }
