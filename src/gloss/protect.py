"""Protect patterns that should not be translated (citations, URLs, math, refs).

Flow:
    protected = protect(text)
    translated = translator.translate(protected.text)   # ⟦0⟧ tokens preserved
    final = restore(translated, protected.tokens)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Use Unicode mathematical white square brackets (U+27E6 / U+27E7).
# These essentially never appear in normal text and are preserved verbatim by
# modern translation models when instructed to do so.
TOKEN_OPEN = "⟦"
TOKEN_CLOSE = "⟧"


def _token(i: int) -> str:
    return f"{TOKEN_OPEN}{i}{TOKEN_CLOSE}"


_TOKEN_RE = re.compile(rf"{TOKEN_OPEN}(\d+){TOKEN_CLOSE}")


# Order matters: match longer / more specific patterns first to avoid
# over-eating (e.g. URLs vs plain tokens like "doi.org").
PROTECT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # URLs
    ("url", re.compile(r"https?://[^\s)\]\},]+", re.IGNORECASE)),
    # DOI (explicit form)
    ("doi", re.compile(r"\bdoi:\s*10\.\d{4,9}/[^\s)\]]+", re.IGNORECASE)),
    # arXiv identifiers
    ("arxiv", re.compile(r"\barXiv:\s*\d{4}\.\d{4,5}(v\d+)?", re.IGNORECASE)),
    # Email
    ("email", re.compile(r"\b[\w.+-]+@[\w.-]+\.\w+\b")),
    # Citations: [12], [12, 34], [1-3], [Smith et al., 2020]
    ("cite", re.compile(r"\[(?:[\w\s.,\-–&]+)\]")),
    # Figure / Table / Section / Equation references (keep original casing)
    (
        "ref",
        re.compile(
            r"\b(?:Fig\.?|Figure|Tab\.?|Table|Sec\.?|Section|Eq\.?|Equation|Alg\.?|Algorithm)\s*\d+(?:\.\d+)*[a-z]?\b"
        ),
    ),
    # Section number alone when preceded by §
    ("section", re.compile(r"§\s*\d+(?:\.\d+)*")),
    # Inline LaTeX math (rarely survives PDF extraction but sometimes present)
    ("math_dollar", re.compile(r"\$[^$\n]{1,200}\$")),
    ("math_paren", re.compile(r"\\\([^)]+\\\)")),
]


@dataclass
class Protected:
    """Result of protect(): text with placeholders + token → original map."""

    text: str
    tokens: dict[int, str] = field(default_factory=dict)

    def restore(self, translated: str) -> str:
        return restore(translated, self.tokens)


def protect(text: str) -> Protected:
    """Replace protected patterns with numeric placeholder tokens.

    Placeholders are of the form ⟦N⟧ (N is an integer). The returned
    Protected.tokens maps N → the original substring.
    """
    tokens: dict[int, str] = {}
    counter = 0
    out = text

    for _kind, pattern in PROTECT_PATTERNS:

        def _sub(m: re.Match[str]) -> str:
            nonlocal counter
            idx = counter
            counter += 1
            tokens[idx] = m.group(0)
            return _token(idx)

        out = pattern.sub(_sub, out)

    return Protected(text=out, tokens=tokens)


def restore(translated: str, tokens: dict[int, str]) -> str:
    """Replace ⟦N⟧ placeholders back with their original strings.

    If a placeholder is missing (rare; translator hallucination) it is left
    as-is so it's visible on output.
    """

    def _sub(m: re.Match[str]) -> str:
        idx = int(m.group(1))
        return tokens.get(idx, m.group(0))

    return _TOKEN_RE.sub(_sub, translated)
