"""Smoke tests for the FastAPI endpoints using the echo translator."""

from fastapi.testclient import TestClient

from gloss.web import app

client = TestClient(app)


def test_index_returns_html():
    r = client.get("/")
    assert r.status_code == 200
    assert "<html" in r.text.lower()


def test_list_engines():
    r = client.get("/api/engines")
    assert r.status_code == 200
    data = r.json()
    names = {e["name"] for e in data["engines"]}
    assert {"echo", "claude", "gemini", "deepl"}.issubset(names)
    echo = next(e for e in data["engines"] if e["name"] == "echo")
    assert echo["ready"] is True
    # default must be a known engine name
    assert data["default"] in names


def test_list_engines_default_prefers_configured(monkeypatch):
    # Pretend Claude has a key via env var → default should become "claude".
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.delenv("GLOSS_ENGINE", raising=False)
    r = client.get("/api/engines")
    assert r.status_code == 200
    data = r.json()
    assert data["default"] == "claude"


def test_list_engines_default_falls_back_to_echo(monkeypatch):
    # No keys, no explicit GLOSS_ENGINE → default must be "echo".
    for v in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPL_API_KEY", "GLOSS_ENGINE"):
        monkeypatch.delenv(v, raising=False)
    # Note: a key set in the OS keychain would still make an engine ready.
    # This test asserts the env-only path picks echo when nothing is set.
    r = client.get("/api/engines")
    assert r.status_code == 200
    data = r.json()
    # If the dev's keychain contains a key, default may be non-echo. Skip the
    # strict assertion in that case to keep the test portable.
    configured_non_echo = [e for e in data["engines"] if e["name"] != "echo" and e["ready"]]
    if not configured_non_echo:
        assert data["default"] == "echo"


def test_translate_text_echo_basic():
    r = client.post(
        "/api/translate-text",
        json={"text": "Hello world", "engine": "echo"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["engine"] == "echo"
    assert data["translated"].startswith("[JA] ")
    assert "elapsed_ms" in data


def test_translate_text_preserves_protected_tokens():
    # Echo wraps the protected text; after restore, URL/citation must reappear.
    text = "As shown in [12], see https://example.com for details."
    r = client.post(
        "/api/translate-text",
        json={"text": text, "engine": "echo"},
    )
    assert r.status_code == 200
    out = r.json()["translated"]
    assert "[12]" in out
    assert "https://example.com" in out


def test_translate_text_normalizes_multiline_selection():
    # Simulate a PDF.js selection that spans lines with a soft hyphen.
    text = "We study evolu-\ntion of systems\nover time."
    r = client.post(
        "/api/translate-text",
        json={"text": text, "engine": "echo"},
    )
    assert r.status_code == 200
    data = r.json()
    # Hyphenation fixed AND newlines collapsed to spaces
    assert "evolution of systems over time." in data["source"]


def test_translate_text_empty_rejected():
    # empty string → pydantic validator (min_length=1) rejects with 422
    r = client.post("/api/translate-text", json={"text": "", "engine": "echo"})
    assert r.status_code == 422

    # whitespace-only passes pydantic but is rejected by our normalize check (400)
    r = client.post("/api/translate-text", json={"text": "   ", "engine": "echo"})
    assert r.status_code == 400
