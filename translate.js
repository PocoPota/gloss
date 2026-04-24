// Translator providers that call AI APIs directly from the browser.
//
// Each provider exposes:
//   name          unique id (used as storage key & selector value)
//   label         display label
//   needsKey      boolean — whether an API key is required
//   envVar        conventional env var name (only used for UI labels now)
//   helpUrl       where to obtain an API key
//   defaultModel  optional
//   translate({ text, apiKey, model, signal, sourceLang, targetLang }) → Promise<string>

const SYSTEM_PROMPT = `あなたは学術論文を専門とする翻訳者です。入力された英語テキストを自然で読みやすい日本語に翻訳してください。

重要な規則:
1. ⟦N⟧ 形式のプレースホルダ（例: ⟦0⟧, ⟦12⟧）は引用・URL・図表番号・数式などを表します。出現位置・順序を保ち、絶対に翻訳・加工・削除しないこと。
2. 学術的で明瞭な日本語（である調）を基本とする。
3. 専門用語は確立された日本語訳を優先し、一般的でない語は原語を括弧で補う。
4. 出力は翻訳文のみ。前置き・後書き・引用符・説明は一切付けない。`;

export const providers = {
  echo: {
    name: "echo",
    label: "echo (テスト用)",
    needsKey: false,
    async translate({ text }) {
      return `[JA] ${text}`;
    },
  },

  claude: {
    name: "claude",
    label: "Claude (Anthropic)",
    needsKey: true,
    envVar: "ANTHROPIC_API_KEY",
    helpUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-4-6",
    async translate({ text, apiKey, model, signal }) {
      const body = {
        model: model || this.defaultModel,
        max_tokens: Math.min(Math.max(Math.floor(text.length * 2.5) + 400, 512), 8192),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      const parts = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
      return parts.join("").trim();
    },
  },

  gemini: {
    name: "gemini",
    label: "Gemini (Google AI)",
    needsKey: true,
    envVar: "GEMINI_API_KEY",
    helpUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-2.5-flash",
    async translate({ text, apiKey, model, signal }) {
      const modelName = model || this.defaultModel;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { temperature: 0.2 },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      const candidate = data.candidates?.[0];
      const out = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
      return out.trim();
    },
  },

  deepl: {
    name: "deepl",
    label: "DeepL",
    needsKey: true,
    envVar: "DEEPL_API_KEY",
    helpUrl: "https://www.deepl.com/account/summary",
    async translate({ text, apiKey, signal, sourceLang = "en", targetLang = "ja" }) {
      // Keys ending in ":fx" are free tier.
      const endpoint = apiKey.endsWith(":fx")
        ? "https://api-free.deepl.com/v2/translate"
        : "https://api.deepl.com/v2/translate";
      const form = new URLSearchParams();
      form.append("text", text);
      form.append("source_lang", sourceLang.toUpperCase());
      form.append("target_lang", targetLang.toUpperCase());
      form.append("preserve_formatting", "1");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal,
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      return (data.translations?.[0]?.text || "").trim();
    },
  },
};

async function errorText(res) {
  let detail = "";
  try {
    detail = await res.text();
    // Try to extract a human message from JSON error shapes
    try {
      const j = JSON.parse(detail);
      detail = j.error?.message || j.message || JSON.stringify(j);
    } catch { /* plain text */ }
  } catch { /* ignore */ }
  return `${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 500)}` : ""}`;
}

export const providerOrder = ["echo", "claude", "gemini", "deepl"];
