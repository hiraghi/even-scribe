# Even Scribe

> Even Realities G2 スマートグラス**単体**で動く、日本語入力に特化したメモアプリ。
> かな漢字変換を備え、ノートはグラス内にローカル保存。**PC も母艦サーバも不要**で、
> 思いついた文章をその場で日本語で書き留められます。

![Platform](https://img.shields.io/badge/platform-Even%20Realities%20G2-black)
![Type](https://img.shields.io/badge/app-Even%20Hub%20plugin-blue)
![License](https://img.shields.io/badge/license-MIT-green)

```
Even G2 グラス  ◀── Even Hub アプリ (Even Scribe)
                         │
                         ├─ ノート保存：ブラウザ内 IndexedDB（オフライン）
                         └─ かな漢字変換：Google Input Tools（変換時のみ通信）
```

- 🇯🇵 **本格的な日本語 IME** — ローマ字かな入力 → かな漢字変換。候補選択・文節伸縮・変換学習まで。
- 📝 **オフラインのローカルメモ** — ノートはグラス内（IndexedDB）に保存。母艦 PC もサーバも不要。
- 🕐 **最近のノート / フォルダ閲覧 / 編集 / 新規作成** — キー操作だけで完結。
- 🔣 **記号スタック変換** — `！？` `[[` `--` など連続記号を1つの変換単位にまとめて確定。
- 🔀 **2つの変換スタイル** — 一般的な IME 風（classic）と、打鍵ごとに候補を出す逐次変換（live）。
- 🥽 **Even Hub アプリ** — 公式 SDK で G2 のディスプレイに最適化表示。QR で実機に導入。

## 必要なもの

| もの | 用途 |
|---|---|
| Even Realities G2 ＋ Even アプリ（スマホ） | グラス上でアプリを実行 |
| Node.js 20+ | ビルド（開発者向け） |
| ネットワーク | かな漢字変換候補の取得（Google Input Tools を利用） |

## 使い方（グラス上の操作）

モード: **RECENT**（最近編集したノート）→ **TREE**（フォルダ / ノート閲覧）→ **EDIT**（編集）。

| キー | RECENT / TREE | EDIT 中 |
|---|---|---|
| `↑` / `↓` | 一覧のスクロール | G2 表示行単位でカーソル移動 |
| `Enter` | 開く / 決定 | 改行 |
| `Esc` | 戻る | 編集終了（未保存なら確認） |
| `Ctrl+S` | — | 保存（`baseMtime` による楽観ロック） |
| `Ctrl+N` | 新規 `.md` ノート作成 | — |
| `Ctrl+Space` | — | かな IME の ON / OFF |

### 日本語入力（IME）

| キー | はたらき |
|---|---|
| `Space` | 変換 / 次候補（記号候補では候補送り） |
| `1`–`9` | 候補を番号で選択 |
| `Enter` | 確定 |
| `F10` | 無変換（入力したローマ字のまま）確定 |
| `Esc` | 変換取消 |
| `Shift+←` / `Shift+→` | 変換範囲（文節）の伸縮 |
| `Backspace` | 1文字削除（記号スタックは1記号ずつ戻す） |

- **記号スタック変換**: 記号を連続で打つと1つの変換ユニットに蓄積されます。例: `!` `?` →
  候補 `［！？ / ⁉ / !?］` を出し、`Enter` で `！？` を一度に確定。`[[` → `「「 / 【【 / [[`。
- **変換学習**: 選んだ候補を記憶し、次回以降の候補順に反映します。
- **変換スタイル**: 設定フォームで classic（一般的な IME 風）と live（逐次候補）を切替。

## インストール（利用者向け）

1. スマホに Even Realities アプリをインストールし、G2 とペアリング。
2. **Even Hub ストア**から「Even Scribe」を選んでインストール（公開後）。
3. 開発版・野良版を試す場合は、配布された **QR コード**を Even アプリの
   **Developer Center（開発者モード）**のスキャナで読み取ると、その場でグラスに同期されます。
   - ※ QR からの導入には、受け取った側でも **Developer Mode の有効化が必要**です。

## 開発

このリポジトリは npm workspaces 構成です（`client` ＋ 共有パッケージ `packages/jp-ime`・`packages/g2-core`）。

```sh
npm install

# 開発サーバ（Vite）
npm --workspace client run dev        # http://localhost:5175

# テスト / ビルド
npm --workspace client test
npm --workspace client run build

# Even Hub パッケージ(.ehpk)を作成
cd client
npx evenhub pack app.json dist -o even-scribe.ehpk -c
```

### エミュレータで試す（Windows）

グラスが手元になくても、Windows 上の EvenHub シミュレータで動作を確認できます。

```
start-emulator.cmd
```

`client/` の Vite 開発サーバ（ポート 5175）を起動し、`@evenrealities/evenhub-simulator` を開きます。
Even Scribe はノートをブラウザ内（IndexedDB）に保存する完全ローカルアプリなので、サーバ設定は不要です。

## GitHub Pages で公開して QR 配布する（野良配布）

Even Scribe はバックエンドを持たない静的アプリなので、**GitHub Pages** などの静的ホスティングに
そのまま置けます。同梱の GitHub Actions（`.github/workflows/pages.yml`）が `client` をビルドして
Pages にデプロイします。

1. このリポジトリを GitHub に push し、**Settings → Pages → Source =「GitHub Actions」**に設定。
2. 公開 URL（例 `https://<user>.github.io/even-scribe/`）を QR 化：
   `cd client && npx evenhub qr --url https://<user>.github.io/even-scribe/ --https`
3. 受け取った人は Even アプリの **Developer Mode → Scan QR** で読み込むと G2 に載ります。

> リポジトリ名を `even-scribe` 以外にする場合は、`client/vite.config.ts` の `base` を
> `'/<リポジトリ名>/'` に合わせてください。

## 設定ファイル

| ファイル | 内容 |
|---|---|
| `client/app.json` | Even Hub マニフェスト。`permissions[].whitelist` に変換で使う `https://www.google.com` と `https://inputtools.google.com` を記載 |
| G2 クライアント設定 | 変換スタイル等をスマホ設定フォームで入力（localStorage 保存） |

## ライセンス

MIT © hiraghi — [LICENSE](LICENSE) を参照。

> かな漢字変換は **Google Input Tools（非公式エンドポイント）**に依存しています。
> Google 側の仕様変更・提供状況によって変換機能が利用できなくなる可能性があります。
