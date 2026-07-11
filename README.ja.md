# Even Scribe

Even G2 向けの日本語入力アプリです。かな入力を漢字へ変換して、テキストを入力できます。

## インストール

GitHub Pages で公開したアプリの QR コードからインストールします。QR コードによるインストールには Even アプリの Developer Mode が必須です。

## かな漢字変換について

かな漢字変換は非公式の Google Input Tools エンドポイントに依存しています。このエンドポイントの仕様や提供状況が変更・終了した場合、変換機能を利用できなくなる可能性があります。

## 開発

Node.js を用意してから、リポジトリのルートで依存関係をインストールし、クライアントをビルドします。

```sh
npm install
npm --workspace client run build
```

## License

[MIT License](LICENSE)
