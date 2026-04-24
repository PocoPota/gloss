"""DeepL translator — minimal wrapper around the DeepL REST API.

Note: DeepL is generally good at preserving non-Latin tokens verbatim, but
⟦N⟧ placeholders are not 100% safe. Future work: wrap placeholders in
<ph>…</ph> and use tag_handling=xml + ignore_tags=ph.
"""

from __future__ import annotations

import os

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from .base import ItemCallback, TranslationRequest


class DeepLTranslator:
    name = "deepl"

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("DEEPL_API_KEY") or ""
        if not self.api_key:
            raise ValueError("DEEPL_API_KEY is not set")
        # Keys ending in ":fx" indicate the free tier.
        self.endpoint = (
            "https://api-free.deepl.com/v2/translate"
            if self.api_key.endswith(":fx")
            else "https://api.deepl.com/v2/translate"
        )

    def translate(
        self, req: TranslationRequest, on_item: ItemCallback | None = None
    ) -> list[str]:
        if not req.texts:
            return []
        out = self._post(req)
        if on_item is not None:
            # DeepL is a single batched call — report all items at once.
            for _ in out:
                on_item()
        return out

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential_jitter(initial=1.0, max=10.0),
        reraise=True,
    )
    def _post(self, req: TranslationRequest) -> list[str]:
        # DeepL accepts repeated `text` form fields.
        data: list[tuple[str, str]] = [("text", t) for t in req.texts]
        data.extend(
            [
                ("source_lang", req.source_lang.upper()),
                ("target_lang", req.target_lang.upper()),
                ("preserve_formatting", "1"),
            ]
        )
        with httpx.Client(timeout=60) as client:
            r = client.post(
                self.endpoint,
                headers={"Authorization": f"DeepL-Auth-Key {self.api_key}"},
                data=data,
            )
            r.raise_for_status()
            payload = r.json()
        return [item["text"] for item in payload.get("translations", [])]
