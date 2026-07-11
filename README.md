# Even Scribe

Even Realities G2 スマートグラス上で動く、日本語入力メモアプリです。
かな漢字変換でメモを書き、ノートはグラス内に保存します。
利用にはペアリングしたスマホの Even アプリが必要です。

## できること

- かな漢字変換による日本語入力（候補選択、文節の伸縮、変換学習）
- ノートをグラス内に保存（オフラインで動作。変換候補の取得時のみ通信します）
- 最近のノート一覧・フォルダ表示・編集・新規作成

## 動作環境

- Even Realities G2 とペアリングしたスマホの Even アプリ
- ネットワーク接続（かな漢字変換の候補取得に使用）

## インストール

以下の QR コードを、Even アプリの **Developer Center（開発者モード）** のスキャナで読み取るとグラスに導入されます。
読み取りには、あらかじめ Even アプリで**Developer Mode を有効化**しておく必要があります。

![インストール用 QR コード](docs/install-qr.png)

QR は公開ページ <https://hiraghi.github.io/even-scribe/> を指しています。

## 使い方

画面は「最近のノート一覧 → フォルダ表示 → 編集」の順に移動します。

### 一覧（最近のノート / フォルダ）

| キー | 動作 |
|---|---|
| `↑` / `↓` | 項目を移動 |
| `Enter` | 開く |
| `Esc` | 戻る（フォルダ表示では親フォルダへ） |
| `Ctrl+N` | 新規ノートを作成 |

### 編集

| キー | 動作 |
|---|---|
| 文字キー | 入力 |
| `Enter` | 改行 |
| `↑` / `↓` | カーソルを移動（表示行単位） |
| `Home` / `End` | 行頭 / 行末へ |
| `PageUp` / `PageDown` | 画面単位でスクロール |
| `Shift` ＋ 上記 | 範囲選択 |
| `Backspace` | 1 文字削除 |
| `Ctrl+S` | 保存 |
| `Ctrl+Space` | かな入力の ON / OFF |
| `Esc` | 編集を終了 |

### 日本語入力（変換中）

| キー | 動作 |
|---|---|
| `Space` | 変換 / 次候補 |
| `↑` / `↓` / `←` / `→` | 候補を選ぶ |
| `1`–`9` | 候補を番号で選ぶ |
| `Enter` | 確定 |
| `Shift+←` / `Shift+→` | 変換範囲（文節）を伸縮 |
| `F10` | 変換せずに確定 |
| `Backspace` | 1 文字戻す |
| `Esc` | 変換を取り消す |

### 変換スタイル

かなから漢字への変換の出かたを 2 種類から選べます。スマホ側の設定フォームの
「IME conversion」で切り替えます（既定は Classic IME）。

- **Classic IME (Space to convert)** — 一般的な PC の IME と同じ方式です。かなを入力し終えてから `Space` で変換します。候補が並ぶので、`Space` / 矢印 / `1`–`9` で選んで `Enter` で確定します。
- **Live suggestions** — 入力しながら候補が自動で表示されます。`Space` を押さなくても候補が出るので、そのまま選んで確定できます。

## 開発

このリポジトリは npm workspaces 構成です（`client` と共有パッケージ `packages/jp-ime`・`packages/g2-core`）。
Node.js 20 以上が必要です。

```sh
npm install
npm --workspace client run dev     # 開発サーバ (http://localhost:5175)
npm --workspace client test
npm --workspace client run build
```

グラスが手元になくても、`start-emulator.cmd`（Windows）で Vite 開発サーバと EvenHub
シミュレータを起動し、動作を確認できます。

## ライセンス

MIT © hiraghi — [LICENSE](LICENSE) を参照。
