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
