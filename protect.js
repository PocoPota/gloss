// Protect patterns that should not be translated (citations, URLs, math, refs).
// Ported from the earlier Python implementation.
//
// Usage:
//   const pr = protect(text);
//   const translated = await callApi(pr.text);
//   const final = restore(translated, pr.tokens);

const TOKEN_OPEN = "⟦";   // ⟦
const TOKEN_CLOSE = "⟧";  // ⟧
const TOKEN_RE = /⟦(\d+)⟧/g;

// Order matters: match longer / more specific patterns first.
const PATTERNS = [
  // URLs
  /https?:\/\/[^\s)\]\},]+/gi,
  // DOI (explicit form)
  /\bdoi:\s*10\.\d{4,9}\/[^\s)\]]+/gi,
  // arXiv identifiers
  /\barXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?/gi,
  // Email
  /\b[\w.+-]+@[\w.-]+\.\w+\b/g,
  // Citations: [12], [12, 34], [1-3], [Smith et al., 2020]
  /\[(?:[\w\s.,\-–&]+)\]/g,
  // Figure / Table / Section / Equation references
  /\b(?:Fig\.?|Figure|Tab\.?|Table|Sec\.?|Section|Eq\.?|Equation|Alg\.?|Algorithm)\s*\d+(?:\.\d+)*[a-z]?\b/g,
  // Section number alone when preceded by §
  /§\s*\d+(?:\.\d+)*/g,
  // Inline LaTeX math
  /\$[^$\n]{1,200}\$/g,
  /\\\([^)]+\\\)/g,
];

export function protect(text) {
  const tokens = new Map();
  let counter = 0;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (match) => {
      const i = counter++;
      tokens.set(i, match);
      return `${TOKEN_OPEN}${i}${TOKEN_CLOSE}`;
    });
  }
  return { text: out, tokens };
}

export function restore(translated, tokens) {
  return translated.replace(TOKEN_RE, (match, idx) => {
    const n = parseInt(idx, 10);
    return tokens.has(n) ? tokens.get(n) : match;
  });
}

// Clean up text extracted from PDF.js selection.
//  - Join soft-hyphenated line breaks ("evolu-\ntion" → "evolution")
//  - Collapse newlines within paragraphs to spaces
//  - Collapse repeated whitespace
export function normalizeSelection(text) {
  let t = text;
  t = t.replace(/(\w)-\s*\n\s*([a-z])/g, "$1$2");
  t = t.replace(/\s*\n\s*/g, " ");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}
