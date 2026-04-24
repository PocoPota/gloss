from gloss.translate import build_translator
from gloss.translate.base import TranslationRequest


def test_echo_translator():
    t = build_translator("echo")
    out = t.translate(TranslationRequest(texts=["hello", "world"]))
    assert out == ["[JA] hello", "[JA] world"]


def test_factory_unknown_engine():
    import pytest

    with pytest.raises(ValueError):
        build_translator("no-such-engine")
