"""Gemini (Google AI) translator via google-genai SDK."""

from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types as genai_types
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from ..config import get_api_key
from ._ratelimit import RateLimiter
from .base import ItemCallback, TranslationRequest

logger = logging.getLogger("gloss.gemini")

DEFAULT_MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = """あなたは学術論文を専門とする翻訳者です。入力された英語テキストを自然で読みやすい日本語に翻訳してください。

重要な規則:
1. ⟦N⟧ 形式のプレースホルダ（例: ⟦0⟧, ⟦12⟧）は引用・URL・図表番号・数式などを表します。出現位置・順序を保ち、絶対に翻訳・加工・削除しないこと。
2. 学術的で明瞭な日本語（である調）を基本とする。
3. 専門用語は確立された日本語訳を優先し、一般的でない語は原語を括弧で補う。
4. 出力は翻訳文のみ。前置き・後書き・引用符・説明は一切付けない。
5. 入力が見出しであれば短い日本語見出しとして訳す。図表キャプションであれば簡潔に訳す。
"""


class GeminiTranslator:
    name = "gemini"

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_key: str | None = None,
        max_workers: int = 2,
        rpm: int | float | None = 10,
    ):
        self.model = model
        key = api_key or get_api_key("gemini") or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise ValueError("Gemini API key not configured (set via Settings UI or GEMINI_API_KEY env var)")
        self.client = genai.Client(api_key=key)
        self.max_workers = max(1, int(max_workers))
        self._limiter = RateLimiter(rpm)

    def translate(
        self, req: TranslationRequest, on_item: ItemCallback | None = None
    ) -> list[str]:
        kinds = req.kinds or ["body"] * len(req.texts)
        n = len(req.texts)
        results: list[str] = [""] * n
        logger.info("gemini: batch start (model=%s, n=%d, workers=%d)", self.model, n, self.max_workers)
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {
                pool.submit(
                    self._translate_one,
                    text,
                    kinds[i] if i < len(kinds) else "body",
                    req,
                    i,
                    n,
                ): i
                for i, text in enumerate(req.texts)
            }
            for fut in as_completed(futures):
                idx = futures[fut]
                try:
                    results[idx] = fut.result()
                except Exception as exc:  # pragma: no cover
                    logger.error("gemini: item %d failed: %s", idx, exc)
                    results[idx] = f"[TRANSLATION ERROR: {exc}] {req.texts[idx]}"
                if on_item is not None:
                    on_item()
        logger.info("gemini: batch done (n=%d)", n)
        return results

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential_jitter(initial=1.0, max=10.0),
        reraise=True,
    )
    def _translate_one(
        self, text: str, kind: str, req: TranslationRequest, idx: int = 0, total: int = 0
    ) -> str:
        if not text.strip():
            return text

        parts: list[str] = []
        if req.document_context:
            parts.append(f"[ドキュメント文脈]\n{req.document_context}\n")
        if req.glossary:
            gloss = "\n".join(f"- {k} → {v}" for k, v in req.glossary.items())
            parts.append(f"[用語集]\n{gloss}\n")
        parts.append(f"[種別] {kind}")
        parts.append("[本文]\n" + text)
        user_msg = "\n\n".join(parts)

        self._limiter.acquire()
        t0 = time.monotonic()
        logger.info("gemini: -> item %d/%d (chars=%d, kind=%s)", idx + 1, total, len(text), kind)
        resp = self.client.models.generate_content(
            model=self.model,
            contents=user_msg,
            config=genai_types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.2,
            ),
        )
        out = (resp.text or "").strip()
        dt = time.monotonic() - t0
        logger.info(
            "gemini: <- item %d/%d (in=%d, out=%d, %.2fs)",
            idx + 1, total, len(text), len(out), dt,
        )
        return out
