# gloss

PDFの選択箇所をその場で日本語に — 欄外の翻訳・注釈 (gloss) をブラウザで。

## 概要

PDFをブラウザで表示し、本文中をマウスで選択するだけで右ペインに翻訳が即時に追加されます。一度翻訳した箇所はローカルにキャッシュされ、同じ選択は無コストで再表示されます。翻訳エンジンは差し替え可能 (echo / Claude / Gemini / DeepL)。

## インストール

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## 起動

```bash
uvicorn gloss.web:app --reload
# http://localhost:8000
```

PDFを開き、ヘッダーの⚙ボタンからAPIキーを設定してください。キーは **OSのキーチェーン** (macOS Keychain / Windows Credential Manager / Linux Secret Service) に保存され、平文でディスクに残りません。

## アーキテクチャ

```
gloss/
├── config.py         # OSキーチェーンを使ったAPIキー管理
├── protect.py        # 引用・URL・図表番号を ⟦N⟧ 化 (翻訳前) / 復元 (後)
├── translate/
│   ├── base.py       # Translator Protocol + TranslationRequest
│   ├── _ratelimit.py # RPM スロットラー
│   ├── echo.py       # テスト用 ([JA] prefix)
│   ├── claude.py     # Claude API
│   ├── gemini.py     # Gemini API
│   ├── deepl.py      # DeepL
│   └── factory.py    # 引数/環境変数から translator を生成
├── web.py            # FastAPI エンドポイント
└── static/           # フロントエンド (PDF.js + 最小UI)
    ├── index.html
    ├── app.js
    └── style.css
```

### フロー

1. PDFをドラッグ＆ドロップ or ボタンで読み込み (ファイルはブラウザ内で処理される)
2. PDF.js でキャンバス描画＋選択可能なテキストレイヤーを重ねる
3. 本文選択 → `mouseup`/`keyup` を 120ms デバウンス → `POST /api/translate-text`
4. 結果を右ペインに追加、localStorage にキャッシュ
5. 同じ文字列を再選択したらキャッシュヒットで即返す。翻訳中は <kbd>Esc</kbd> で中断

## 環境変数 (任意・上級者向け)

通常はUI設定で十分です。以下の環境変数は上書き用途で使います。設定すればキーチェーンより優先されます。

| 変数 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `DEEPL_API_KEY` | APIキー (キーチェーンより優先) |
| `GLOSS_ENGINE` | デフォルトエンジン名 (`echo` / `claude` / `gemini` / `deepl`) |
| `GLOSS_CLAUDE_MODEL` / `GLOSS_GEMINI_MODEL` | モデル名の上書き |
| `GLOSS_CLAUDE_RPM` / `GLOSS_GEMINI_RPM` | レート制限 (0で無制限) |
| `GLOSS_CLAUDE_MAX_WORKERS` / `GLOSS_GEMINI_MAX_WORKERS` | 並列度 |
| `GLOSS_MAX_WORKERS` / `GLOSS_RPM` | 上記の共通フォールバック |
| `GLOSS_LOG_LEVEL` | ログレベル (`DEBUG` / `INFO` / `WARNING`) |

## 設計メモ

当初の方針検討は [DESIGN.md](./DESIGN.md) を参照。現行の実装は「選択箇所のみ逐次翻訳」方式 (DESIGN.md で言及した approach C のバリエーション) で落ち着いています。
