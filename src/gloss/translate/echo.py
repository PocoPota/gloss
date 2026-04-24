"""Echo translator — prefixes [JA] to each input. Used for dev/testing."""

from __future__ import annotations

from .base import ItemCallback, TranslationRequest


class EchoTranslator:
    name = "echo"

    def translate(
        self, req: TranslationRequest, on_item: ItemCallback | None = None
    ) -> list[str]:
        out = []
        for t in req.texts:
            out.append(f"[JA] {t}")
            if on_item is not None:
                on_item()
        return out
