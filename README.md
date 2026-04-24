# pdf-translater

PDF (特に論文) をレイアウトを保持したまま日本語に翻訳するためのツール。

設計の検討は [DESIGN.md](./DESIGN.md) を参照。

## 現在のフェーズ

**v0.2 — 選択翻訳ビューア**: PDFをブラウザで表示し、選択したテキストだけをその場で翻訳して右ペインに履歴として表示。トランスレーション結果は localStorage にキャッシュして同じ箇所は即応答。翻訳エンジンは差し替え可能 (echo / claude / gemini / deepl)。

## インストール

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# .env を編集し ANTHROPIC_API_KEY 等を設定
```

## 使い方

```bash
# 開発サーバー起動
uvicorn gloss.web:app --reload

# ブラウザで http://localhost:8000 を開き PDF をアップロード
```

## アーキテクチャ

```
gloss/
├── protect.py        # 引用・URL・図表番号を ⟦N⟧ 化 (翻訳前) / 復元 (後)
├── translate/
│   ├── base.py       # Translator Protocol + TranslationRequest
│   ├── _ratelimit.py # RPM スロットラー
│   ├── echo.py       # テスト用 ([JA] prefix)
│   ├── claude.py     # Claude API
│   ├── gemini.py     # Gemini API
│   ├── deepl.py      # DeepL
│   └── factory.py    # env/引数から translator を生成
├── web.py            # FastAPI (GET / , POST /api/translate-text , GET /api/engines)
└── static/
    ├── index.html    # 2ペイン (PDF.js viewer | 翻訳履歴)
    ├── app.js        # PDF描画、選択検出、API叩き、localStorageキャッシュ
    └── style.css
```

### フロー

1. PDFを `<input type=file>` かドラッグ＆ドロップで読み込み (ファイルはブラウザ内に留まる)
2. PDF.js でキャンバス描画＋テキストレイヤーを重ねる（ネイティブ選択可）
3. `selectionchange` を 200ms デバウンス → 選択テキストを `POST /api/translate-text` に送信
4. 応答を右ペインに履歴として追加、localStorage にキャッシュ
5. 同じ文字列を再選択したらキャッシュヒットで即返す
