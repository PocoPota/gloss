# gloss

> PDFの選択箇所を、その場で日本語に。

論文を読みながら「この段落だけ訳を見たい」という時のためのローカル翻訳ビューア。PDFをブラウザで開き、本文をマウスで選択するだけで右ペインに翻訳が表示されます。読んだ箇所だけを訳すので API コストが低く、原文とも常に見比べられます。

## 特徴

- **選択翻訳** — 読みたい箇所だけ。全文翻訳と比べて API リクエストは1桁少ない
- **原文そのまま** — PDF.js で忠実にレンダリング、翻訳は右パネルに履歴として積む
- **ローカルキャッシュ** — 一度引いた訳文は `localStorage` に保存、同じ選択は即表示
- **APIキーは OS キーチェーンに** — 平文でディスクに残さない
- **エンジン切替** — Claude / Gemini / DeepL / echo (テスト用)

## クイックスタート

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn gloss.web:app --reload
```

ブラウザで <http://localhost:8000> を開き、ヘッダー右の ⚙ から使いたいエンジンの API キーを設定します。

## 使い方

1. **PDF を開く** — ヘッダーの「PDFを開く」、または画面中央にドラッグ＆ドロップ
2. **本文を選択** — マウスでドラッグ（複数行・改行跨ぎOK）
3. **翻訳が右に現れる** — マウスを離した 120ms 後に自動翻訳、履歴に追加
4. **<kbd>Esc</kbd> で中断** — 誤選択のときは即座に取消

選択テキストは送信前に正規化されます（行末ハイフネーションの修復、改行の折り畳み、`[12]` / URL / `Fig. 3` 等の保護）。

## API キー

### UI から（推奨）

ヘッダーの ⚙ を開き、使いたいエンジンの欄にキーを貼って「保存」。**OS キーチェーン**（macOS Keychain / Windows Credential Manager / Linux Secret Service）に保存されます。

| エンジン | 取得先 |
|---|---|
| Claude | <https://console.anthropic.com/settings/keys> |
| Gemini | <https://aistudio.google.com/app/apikey> |
| DeepL  | <https://www.deepl.com/account/summary> |

### 環境変数（CI / デプロイ向け）

`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `DEEPL_API_KEY` を設定するとキーチェーンより優先されます。

## 設定（環境変数・任意）

| 変数 | 用途 | 既定 |
|---|---|---|
| `GLOSS_ENGINE` | 起動時のデフォルトエンジン | `echo` |
| `GLOSS_CLAUDE_MODEL` | Claude モデル | `claude-sonnet-4-6` |
| `GLOSS_GEMINI_MODEL` | Gemini モデル | `gemini-2.5-flash` |
| `GLOSS_{CLAUDE,GEMINI}_RPM` | 分あたりリクエスト制限 (0 で無制限) | `0` / `10` |
| `GLOSS_{CLAUDE,GEMINI}_MAX_WORKERS` | 並列度 | `4` / `2` |
| `GLOSS_MAX_WORKERS` / `GLOSS_RPM` | 上2つの共通フォールバック | — |
| `GLOSS_LOG_LEVEL` | ログレベル | `INFO` |

## API

- `GET /` — フロントエンド
- `GET /api/engines` — エンジン一覧と利用可否
- `POST /api/translate-text` — 単発翻訳 `{text, engine}` → `{translated, elapsed_ms, ...}`
- `GET /api/config` — キー設定状態（キー本体は返しません）
- `PUT /api/config/{engine}` — キーチェーンに保存
- `DELETE /api/config/{engine}` — キーチェーンから削除

## アーキテクチャ

```
src/gloss/
├── web.py            # FastAPI エンドポイント
├── config.py         # OS キーチェーンによるキー管理
├── protect.py        # 引用・URL・図表番号を ⟦N⟧ 化して保護／復元
├── translate/
│   ├── base.py       # Translator Protocol
│   ├── echo.py       # テスト用（[JA] プレフィックス）
│   ├── claude.py     # Anthropic
│   ├── gemini.py     # Google AI
│   ├── deepl.py      # DeepL
│   ├── factory.py    # 名前/環境変数から translator を生成
│   └── _ratelimit.py # スレッドセーフな RPM 制御
└── static/           # PDF.js + 最小フロントエンド
    ├── index.html
    ├── app.js
    └── style.css
```

## 開発

```bash
pip install -e ".[dev]"
pytest                # 16 テスト
ruff check .
```

## ライセンス

個人利用。
