"""Translator interface. Implementations live in sibling modules."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, Field

# Called each time a single item (paragraph) is finished.
ItemCallback = Callable[[], None]


class TranslationRequest(BaseModel):
    """A batch of texts to translate with shared metadata."""

    texts: list[str]
    source_lang: str = "en"
    target_lang: str = "ja"
    # Optional glossary — keys are source-language terms to keep consistent.
    glossary: dict[str, str] = Field(default_factory=dict)
    # Per-text hint ("body", "heading", "caption") — same length as texts, or None.
    kinds: list[str] | None = None
    # Document-level context (e.g. title + abstract) for better disambiguation.
    document_context: str | None = None


@runtime_checkable
class Translator(Protocol):
    """A translator that turns a list of source texts into target texts.

    Implementations MUST:
    - Return a list of strings the same length as req.texts, in the same order.
    - Preserve ⟦N⟧ placeholder tokens in the output verbatim (see protect.py).
    - If `on_item` is given, call it once per completed item (order-agnostic).
    """

    name: str

    def translate(
        self, req: TranslationRequest, on_item: ItemCallback | None = None
    ) -> list[str]: ...
