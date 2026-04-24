"""Claude (Anthropic API) translator."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from anthropic import Anthropic
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from ..config import get_api_key
from ._ratelimit import RateLimiter
from .base import ItemCallback, TranslationRequest

logger = logging.getLogger("gloss.claude")

DEFAULT_MODEL = "claude-sonnet-4-6"

SYSTEM_PROMPT = """あなたは学術論文を専門とする翻訳者です。入力された英語テキストを自然で読みやすい日本語に翻訳してください。

重要な規則:
1. ⟦N⟧ 形式のプレースホルダ（例: ⟦0⟧, ⟦12⟧）は引用・URL・図表番号・数式などを表します。出現位置・順序を保ち、絶対に翻訳・加工・削除しないこと。
2. 学術的で明瞭な日本語（である調）を基本とする。
3. 専門用語は確立された日本語訳を優先し、一般的でない語は原語を括弧で補う。
4. 出力は翻訳文のみ。前置き・後書き・引用符・説明は一切付けない。
5. 入力が見出しであれば短い日本語見出しとして訳す。図表キャプションであれば簡潔に訳す。
"""


class ClaudeTranslator:
    name = "claude"

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_key: str | None = None,
        max_workers: int = 4,
        rpm: int | float | None = 0,
    ):
        self.model = model
        key = api_key or get_api_key("claude")
        if not key:
            raise ValueError("Claude API key not configured (set via Settings UI or ANTHROPIC_API_KEY env var)")
        self.client = Anthropic(api_key=key)
        self.max_workers = max(1, int(max_workers))
        self._limiter = RateLimiter(rpm)

    def translate(
        self, req: TranslationRequest, on_item: ItemCallback | None = None
    ) -> list[str]:
        kinds = req.kinds or ["body"] * len(req.texts)
        n = len(req.texts)
        results: list[str] = [""] * n
        logger.info("claude: batch start (model=%s, n=%d, workers=%d)", self.model, n, self.max_workers)
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
                except Exception as exc:  # pragma: no cover - surfaced to caller
                    logger.error("claude: item %d failed: %s", idx, exc)
                    results[idx] = f"[TRANSLATION ERROR: {exc}] {req.texts[idx]}"
                if on_item is not None:
                    on_item()
        logger.info("claude: batch done (n=%d)", n)
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

        user_parts: list[str] = []
        if req.document_context:
            user_parts.append(f"[ドキュメント文脈]\n{req.document_context}\n")
        if req.glossary:
            gloss = "\n".join(f"- {k} → {v}" for k, v in req.glossary.items())
            user_parts.append(f"[用語集]\n{gloss}\n")
        user_parts.append(f"[種別] {kind}")
        user_parts.append("[本文]\n" + text)
        user_msg = "\n\n".join(user_parts)

        # max_tokens grows with input length (Japanese ~= 0.6..1.0x English chars,
        # but we allow generous headroom).
        max_tokens = min(max(int(len(text) * 2.5) + 400, 512), 8192)

        self._limiter.acquire()
        t0 = time.monotonic()
        logger.info("claude: -> item %d/%d (chars=%d, kind=%s)", idx + 1, total, len(text), kind)
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_msg}],
        )
        # Concatenate any text blocks in the response.
        out = "".join(
            block.text for block in resp.content if getattr(block, "type", "") == "text"
        )
        dt = time.monotonic() - t0
        logger.info(
            "claude: <- item %d/%d (in=%d, out=%d, %.2fs)",
            idx + 1, total, len(text), len(out), dt,
        )
        return out.strip()
