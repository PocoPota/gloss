# gloss

> PDFの選択箇所を、その場で日本語に。

論文を読みながら「この段落だけ訳を見たい」という時のためのブラウザ内翻訳ビューア。
PDFを開き、本文をマウスで選択するだけで右ペインに翻訳が現れます。

**バックエンドはありません。** 選択したテキストは、あなたのブラウザから直接 翻訳APIプロバイダ (Anthropic / Google AI / DeepL) に送られます。APIキーは中継サーバを経由せず、このデバイスに留まります。

## 特徴

- **選択翻訳** — 読みたい所だけを訳す。全文翻訳よりAPIコストが1桁少ない
- **原文そのまま** — PDF.js で忠実にレンダリング、翻訳は右に履歴として積む
- **サーバレス / 静的** — CDN に置くだけでデプロイ完了
- **APIキーは手元だけ** — サーバに送信されず、保存もオプトイン式
- **エンジン切替** — Claude / Gemini / DeepL (+ 動作確認用 echo)

## クイックスタート (ローカル)

Python標準の簡易サーバで十分:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

または Node:

```bash
npx serve
```

`file://` で直接開くとESモジュールが動きません。必ずHTTPサーバ経由で開いてください。

## 使い方

1. **PDFを開く** — ボタン、またはドロップ
2. **ヘッダー右の ⚙ からAPIキーを設定**
3. **本文を選択** — マウスドラッグで範囲を選ぶ
4. **翻訳が右に現れる** — 選択を離すと120ms後に自動で翻訳
5. **<kbd>Esc</kbd> で中断**

## APIキーの管理

設定モーダル (⚙) から:

- **入力して「保存」** — メモリに入り、すぐ使える
- **"このブラウザにキーを保存する" チェックボックス**
  - **OFF (既定)**: タブを閉じる / リロードするとキーは消える
  - **ON**: ブラウザの `localStorage` に残る。次回起動時にも使える
- **エンジンごとに削除** — 個別の「削除」ボタン
- **全キー削除** — モーダル下部のボタン

キーはこのドメインの JS からしかアクセスできません (Same-Origin Policy)。サーバには一切送信されず、各プロバイダにのみ直接送られます。

| プロバイダ | APIキー取得先 |
|---|---|
| Claude | <https://console.anthropic.com/settings/keys> |
| Gemini | <https://aistudio.google.com/app/apikey> |
| DeepL  | <https://www.deepl.com/account/summary> |

## デプロイ (GitHub Pages)

同梱の GitHub Actions ワークフロー (`.github/workflows/pages.yml`) でリポジトリのルートをそのまま公開します。

### 手順

1. GitHub にリポジトリを作成して push
2. リポジトリの **Settings → Pages** を開く
3. **Source** を "**GitHub Actions**" に設定
4. `main` に push すると自動デプロイ — `https://<user>.github.io/<repo>/` で公開

### 備考

- ビルド不要。ワークフローはリポジトリをそのまま静的サイトとして発行します
- `.nojekyll` が入っているので Jekyll による変換は行われません
- GitHub Pages は HTTP 応答ヘッダをカスタムできないため、CSP は `index.html` の `<meta http-equiv="Content-Security-Policy">` で適用されます
- 他のホスティング (Cloudflare Pages / Vercel / Netlify) にも静的ファイルをそのまま置けば動きます

## セキュリティ方針

- **CSP**: `script-src` を自サイト + jsdelivr (PDF.js) のみ、`connect-src` を 3プロバイダのAPIドメインのみに制限
- **innerHTML 禁止**: DOM操作は全て `textContent` / `createElement`、ユーザ入力を HTML としてパースしない
- **Referrer-Policy: strict-origin-when-cross-origin** — 外部サイトに余計なパスを渡さない
- **Permissions-Policy**: 不要な Browser API (カメラ / マイク / 位置情報) を無効化
- **HTTPS必須**: 上記ホスティングはすべてデフォルトHTTPS
- **APIキーは opt-in 保存**: デフォルトはメモリのみ (タブ閉じで消える)

## ファイル構成

```
gloss/
├── index.html                      # 単一のHTMLエントリ (CSP meta含む)
├── style.css
├── app.js                          # PDF描画、選択検出、キー管理、UI
├── translate.js                    # Claude / Gemini / DeepL / echo の直叩き実装
├── protect.js                      # 引用・URL・図表番号を ⟦N⟧ 化→復元
├── .nojekyll                       # GitHub Pages が Jekyll 処理を行わないように
└── .github/workflows/pages.yml     # ルートを Pages に publish
```

## ライセンス

個人利用。
